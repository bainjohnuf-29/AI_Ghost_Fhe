pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AIGhostFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds = 60;
    bool public paused = false;
    uint256 public currentBatchId = 0;
    bool public batchOpen = false;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    // Encrypted state for the AI model
    euint32 internal encryptedTotalGamesPlayed;
    euint32 internal encryptedTotalWins;
    euint32 internal encryptedTotalLosses;
    euint32 internal encryptedTotalScore;

    // Encrypted state for a specific batch's aggregated data
    euint32 internal encryptedBatchGamesPlayed;
    euint32 internal encryptedBatchWins;
    euint32 internal encryptedBatchLosses;
    euint32 internal encryptedBatchScore;

    // Events
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event CooldownSecondsUpdated(uint256 oldCooldown, uint256 newCooldown);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event GameDataSubmitted(address indexed provider, uint256 indexed batchId, euint32 gamesPlayed, euint32 wins, euint32 losses, euint32 score);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint32 totalGamesPlayed, uint32 totalWins, uint32 totalLosses, uint32 totalScore, uint32 batchGamesPlayed, uint32 batchWins, uint32 batchLosses, uint32 batchScore);

    // Errors
    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error ReplayDetected();
    error StateMismatch();
    error InvalidBatchId();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        emit OwnershipTransferred(address(0), owner);
        _initIfNeeded();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setCooldownSeconds(uint256 newCooldown) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldown;
        emit CooldownSecondsUpdated(oldCooldown, newCooldown);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert Paused(); // Already unpaused
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batchOpen = true;
        // Reset batch-specific encrypted accumulators
        encryptedBatchGamesPlayed = FHE.asEuint32(0);
        encryptedBatchWins = FHE.asEuint32(0);
        encryptedBatchLosses = FHE.asEuint32(0);
        encryptedBatchScore = FHE.asEuint32(0);
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchNotOpen();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitGameData(
        euint32 gamesPlayed,
        euint32 wins,
        euint32 losses,
        euint32 score
    ) external onlyProvider whenNotPaused checkSubmissionCooldown {
        if (!batchOpen) revert BatchNotOpen();
        _initIfNeeded();

        lastSubmissionTime[msg.sender] = block.timestamp;

        encryptedBatchGamesPlayed = encryptedBatchGamesPlayed.add(gamesPlayed);
        encryptedBatchWins = encryptedBatchWins.add(wins);
        encryptedBatchLosses = encryptedBatchLosses.add(losses);
        encryptedBatchScore = encryptedBatchScore.add(score);

        emit GameDataSubmitted(msg.sender, currentBatchId, gamesPlayed, wins, losses, score);
    }

    function requestBatchDecryption() external onlyProvider whenNotPaused checkDecryptionCooldown {
        if (batchOpen) revert BatchNotOpen(); // Batch must be closed to request decryption
        if (currentBatchId == 0) revert InvalidBatchId(); // No batch processed yet

        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        euint32[8] memory cts = [
            encryptedTotalGamesPlayed,
            encryptedTotalWins,
            encryptedTotalLosses,
            encryptedTotalScore,
            encryptedBatchGamesPlayed,
            encryptedBatchWins,
            encryptedBatchLosses,
            encryptedBatchScore
        ];

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        emit DecryptionRequested(requestId, currentBatchId, stateHash);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        DecryptionContext memory ctx = decryptionContexts[requestId];
        if (ctx.processed) revert ReplayDetected();

        // Rebuild ciphertexts array in the exact same order as in requestBatchDecryption
        euint32[8] memory cts = [
            encryptedTotalGamesPlayed,
            encryptedTotalWins,
            encryptedTotalLosses,
            encryptedTotalScore,
            encryptedBatchGamesPlayed,
            encryptedBatchWins,
            encryptedBatchLosses,
            encryptedBatchScore
        ];

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != ctx.stateHash) {
            revert StateMismatch();
        }

        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode cleartexts in the same order
        uint32 totalGamesPlayed = abi.decode(cleartexts, (uint32));
        cleartexts = cleartexts[32:];
        uint32 totalWins = abi.decode(cleartexts, (uint32));
        cleartexts = cleartexts[32:];
        uint32 totalLosses = abi.decode(cleartexts, (uint32));
        cleartexts = cleartexts[32:];
        uint32 totalScore = abi.decode(cleartexts, (uint32));
        cleartexts = cleartexts[32:];
        uint32 batchGamesPlayed = abi.decode(cleartexts, (uint32));
        cleartexts = cleartexts[32:];
        uint32 batchWins = abi.decode(cleartexts, (uint32));
        cleartexts = cleartexts[32:];
        uint32 batchLosses = abi.decode(cleartexts, (uint32));
        cleartexts = cleartexts[32:];
        uint32 batchScore = abi.decode(cleartexts, (uint32));

        // Update global encrypted state with the decrypted batch data
        encryptedTotalGamesPlayed = FHE.asEuint32(totalGamesPlayed + batchGamesPlayed);
        encryptedTotalWins = FHE.asEuint32(totalWins + batchWins);
        encryptedTotalLosses = FHE.asEuint32(totalLosses + batchLosses);
        encryptedTotalScore = FHE.asEuint32(totalScore + batchScore);

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, ctx.batchId, totalGamesPlayed, totalWins, totalLosses, totalScore, batchGamesPlayed, batchWins, batchLosses, batchScore);
    }

    function _initIfNeeded() internal {
        if (!FHE.isInitialized(encryptedTotalGamesPlayed)) {
            encryptedTotalGamesPlayed = FHE.asEuint32(0);
            encryptedTotalWins = FHE.asEuint32(0);
            encryptedTotalLosses = FHE.asEuint32(0);
            encryptedTotalScore = FHE.asEuint32(0);
        }
    }

    function _hashCiphertexts(euint32[8] memory cts) internal pure returns (bytes32) {
        bytes32[8] memory ctsAsBytes;
        for (uint i = 0; i < 8; i++) {
            ctsAsBytes[i] = FHE.toBytes32(cts[i]);
        }
        return keccak256(abi.encode(ctsAsBytes, address(this)));
    }
}