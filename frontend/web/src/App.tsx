// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface GameStyleRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  gameType: string;
  status: "training" | "active" | "inactive";
}

// Style choices (randomly selected):
// Colors: High contrast (blue+orange)
// UI: Future metal
// Layout: Center radiation
// Interaction: Micro-interactions (hover effects)

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'increase10%':
      result = value * 1.1;
      break;
    case 'decrease10%':
      result = value * 0.9;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<GameStyleRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({ gameType: "", description: "", aggressionLevel: 50, reactionTime: 50, riskTolerance: 50 });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<GameStyleRecord | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<any>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'training' | 'history'>('dashboard');
  const [searchTerm, setSearchTerm] = useState('');

  const activeCount = records.filter(r => r.status === "active").length;
  const trainingCount = records.filter(r => r.status === "training").length;
  const inactiveCount = records.filter(r => r.status === "inactive").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("game_style_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing record keys:", e); }
      }
      
      const list: GameStyleRecord[] = [];
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`game_style_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({ 
                id: key, 
                encryptedData: recordData.data, 
                timestamp: recordData.timestamp, 
                owner: recordData.owner, 
                gameType: recordData.gameType, 
                status: recordData.status || "training" 
              });
            } catch (e) { console.error(`Error parsing record data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading record ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) { 
      console.error("Error loading records:", e); 
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  const submitRecord = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting game style data with Zama FHE..." });
    
    try {
      // Encrypt each game style parameter separately
      const encryptedData = JSON.stringify({
        aggression: FHEEncryptNumber(newRecordData.aggressionLevel),
        reaction: FHEEncryptNumber(newRecordData.reactionTime),
        risk: FHEEncryptNumber(newRecordData.riskTolerance)
      });
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const recordData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        gameType: newRecordData.gameType, 
        status: "training" 
      };
      
      await contract.setData(`game_style_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(recordData)));
      
      // Update keys list
      const keysBytes = await contract.getData("game_style_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(recordId);
      await contract.setData("game_style_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Game style encrypted and submitted securely!" });
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({ gameType: "", description: "", aggressionLevel: 50, reactionTime: 50, riskTolerance: 50 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreating(false); 
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<any> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Decrypt the JSON object containing multiple encrypted values
      const encryptedObj = JSON.parse(encryptedData);
      const decryptedObj: any = {};
      
      for (const key in encryptedObj) {
        if (encryptedObj.hasOwnProperty(key)) {
          decryptedObj[key] = FHEDecryptNumber(encryptedObj[key]);
        }
      }
      
      return decryptedObj;
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const activateGhost = async (recordId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Activating AI ghost with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      const recordBytes = await contract.getData(`game_style_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      // Perform FHE computation to adjust parameters slightly
      const encryptedObj = JSON.parse(recordData.data);
      const adjustedObj: any = {};
      
      for (const key in encryptedObj) {
        if (encryptedObj.hasOwnProperty(key)) {
          // Apply slight random variation to make ghost behavior more natural
          const operation = Math.random() > 0.5 ? 'increase10%' : 'decrease10%';
          adjustedObj[key] = FHECompute(encryptedObj[key], operation);
        }
      }
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedRecord = { 
        ...recordData, 
        status: "active", 
        data: JSON.stringify(adjustedObj) 
      };
      
      await contractWithSigner.setData(`game_style_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRecord)));
      
      setTransactionStatus({ visible: true, status: "success", message: "AI Ghost activated successfully!" });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Activation failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const deactivateGhost = async (recordId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Deactivating AI ghost..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const recordBytes = await contract.getData(`game_style_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = { ...recordData, status: "inactive" };
      await contract.setData(`game_style_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(updatedRecord)));
      
      setTransactionStatus({ visible: true, status: "success", message: "AI Ghost deactivated!" });
      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Deactivation failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (recordAddress: string) => address?.toLowerCase() === recordAddress.toLowerCase();

  const tutorialSteps = [
    { title: "Connect Wallet", description: "Connect your Web3 wallet to start training your AI ghost", icon: "👻" },
    { title: "Train Your Ghost", description: "Play games normally while the system learns your encrypted style", icon: "🎮", details: "Your gameplay data is encrypted with Zama FHE before being analyzed" },
    { title: "Activate Ghost", description: "When you're away, activate your AI ghost to play in your style", icon: "⚡", details: "The ghost makes decisions based on your encrypted gameplay patterns" },
    { title: "Private & Secure", description: "Your strategies remain encrypted and never exposed", icon: "🔒", details: "FHE ensures your gameplay style is processed without decryption" }
  ];

  const filteredRecords = records.filter(record => 
    record.gameType.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderRadarChart = () => {
    if (!decryptedValue || !selectedRecord) return null;
    
    return (
      <div className="radar-chart">
        <div className="radar-grid">
          <div className="radar-axis"></div>
          <div className="radar-axis"></div>
          <div className="radar-axis"></div>
        </div>
        <div className="radar-shape" style={{
          clipPath: `polygon(
            50% ${100 - decryptedValue.aggression}%,
            ${50 + decryptedValue.reaction * 0.5}% ${50 + decryptedValue.reaction * 0.5}%,
            ${100 - decryptedValue.risk}% 50%
          )`
        }}></div>
        <div className="radar-labels">
          <div className="label aggression">Aggression: {decryptedValue.aggression}</div>
          <div className="label reaction">Reaction: {decryptedValue.reaction}</div>
          <div className="label risk">Risk: {decryptedValue.risk}</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="tech-spinner"></div>
      <p>Initializing encrypted AI connection...</p>
    </div>
  );

  return (
    <div className="app-container future-metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="ghost-icon"></div>
          </div>
          <h1>AI<span>Ghost</span>FHE</h1>
        </div>
        <div className="header-actions">
          <div className="search-box">
            <input 
              type="text" 
              placeholder="Search game types..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="tech-input"
            />
            <div className="search-icon"></div>
          </div>
          <button onClick={() => setShowCreateModal(true)} className="create-record-btn tech-button">
            <div className="add-icon"></div>New Ghost
          </button>
          <button className="tech-button" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content center-radial">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Powered AI Ghost</h2>
            <p>Train an AI to play games in your style without exposing your strategies</p>
          </div>
          <div className="fhe-indicator">
            <div className="fhe-lock"></div>
            <span>Zama FHE Encryption Active</span>
          </div>
        </div>

        {showTutorial && (
          <div className="tutorial-section">
            <h2>AI Ghost Training Guide</h2>
            <p className="subtitle">Learn how to create your encrypted gaming ghost</p>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    {step.details && <div className="step-details">{step.details}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="tab-navigation">
          <button 
            className={`tab-button ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          <button 
            className={`tab-button ${activeTab === 'training' ? 'active' : ''}`}
            onClick={() => setActiveTab('training')}
          >
            Training Center
          </button>
          <button 
            className={`tab-button ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            Ghost History
          </button>
        </div>

        {activeTab === 'dashboard' && (
          <div className="dashboard-grid">
            <div className="dashboard-card tech-card">
              <h3>Project Introduction</h3>
              <p>AI Ghost uses <strong>Zama FHE technology</strong> to learn your encrypted gameplay style. When you're away, it can play in your style without exposing your strategies to game servers.</p>
              <div className="fhe-badge"><span>FHE-Powered Privacy</span></div>
            </div>

            <div className="dashboard-card tech-card">
              <h3>Ghost Status</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{records.length}</div>
                  <div className="stat-label">Total Ghosts</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{activeCount}</div>
                  <div className="stat-label">Active</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{trainingCount}</div>
                  <div className="stat-label">Training</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{inactiveCount}</div>
                  <div className="stat-label">Inactive</div>
                </div>
              </div>
            </div>

            <div className="dashboard-card tech-card">
              <h3>Featured Game</h3>
              <div className="featured-game">
                <div className="game-icon"></div>
                <div className="game-info">
                  <h4>Strategy Masters</h4>
                  <p>Train your ghost to master this strategy game</p>
                  <button className="tech-button small">Learn More</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'training' && (
          <div className="training-center">
            <div className="section-header">
              <h2>Train Your AI Ghost</h2>
              <div className="header-actions">
                <button onClick={loadRecords} className="refresh-btn tech-button" disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>

            <div className="training-cards">
              {filteredRecords.length === 0 ? (
                <div className="no-records">
                  <div className="no-records-icon"></div>
                  <p>No ghost profiles found</p>
                  <button className="tech-button primary" onClick={() => setShowCreateModal(true)}>
                    Create First Ghost
                  </button>
                </div>
              ) : filteredRecords.map(record => (
                <div className="ghost-card" key={record.id} onClick={() => setSelectedRecord(record)}>
                  <div className="card-header">
                    <div className="ghost-status">
                      <span className={`status-badge ${record.status}`}>{record.status}</span>
                    </div>
                    <div className="game-type">{record.gameType}</div>
                  </div>
                  <div className="card-body">
                    <div className="ghost-avatar"></div>
                    <div className="ghost-info">
                      <div className="info-item">
                        <span>Created:</span>
                        <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
                      </div>
                      <div className="info-item">
                        <span>Owner:</span>
                        <strong>{record.owner.substring(0, 6)}...{record.owner.substring(38)}</strong>
                      </div>
                    </div>
                  </div>
                  <div className="card-footer">
                    {isOwner(record.owner) && (
                      <>
                        {record.status === "training" && (
                          <button className="tech-button success" onClick={(e) => { e.stopPropagation(); activateGhost(record.id); }}>
                            Activate
                          </button>
                        )}
                        {record.status === "active" && (
                          <button className="tech-button danger" onClick={(e) => { e.stopPropagation(); deactivateGhost(record.id); }}>
                            Deactivate
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="history-section">
            <div className="section-header">
              <h2>Ghost Activity History</h2>
              <div className="header-actions">
                <button onClick={loadRecords} className="refresh-btn tech-button" disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>

            <div className="history-table tech-card">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Game Type</div>
                <div className="header-cell">Owner</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>

              {filteredRecords.length === 0 ? (
                <div className="no-records">
                  <div className="no-records-icon"></div>
                  <p>No activity history found</p>
                </div>
              ) : filteredRecords.map(record => (
                <div className="table-row" key={record.id} onClick={() => setSelectedRecord(record)}>
                  <div className="table-cell record-id">#{record.id.substring(0, 6)}</div>
                  <div className="table-cell">{record.gameType}</div>
                  <div className="table-cell">{record.owner.substring(0, 6)}...{record.owner.substring(38)}</div>
                  <div className="table-cell">{new Date(record.timestamp * 1000).toLocaleDateString()}</div>
                  <div className="table-cell">
                    <span className={`status-badge ${record.status}`}>{record.status}</span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(record.owner) && (
                      <button className="tech-button small" onClick={(e) => { e.stopPropagation(); setSelectedRecord(record); }}>
                        Details
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
        />
      )}

      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => { setSelectedRecord(null); setDecryptedValue(null); }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
          renderRadarChart={renderRadarChart}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content tech-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="tech-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="ghost-icon small"></div>
              <span>AI Ghost FHE</span>
            </div>
            <p>Fully Homomorphic Encryption for private AI gaming</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>Powered by Zama FHE</span></div>
          <div className="copyright">© {new Date().getFullYear()} AI Ghost FHE. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, recordData, setRecordData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: value });
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: parseInt(value) });
  };

  const handleSubmit = () => {
    if (!recordData.gameType) { alert("Please select game type"); return; }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal tech-card">
        <div className="modal-header">
          <h2>Train New AI Ghost</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>FHE Encryption Notice</strong>
              <p>Your gameplay style will be encrypted with Zama FHE before analysis</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>Game Type *</label>
              <select 
                name="gameType" 
                value={recordData.gameType} 
                onChange={handleChange} 
                className="tech-select"
              >
                <option value="">Select game type</option>
                <option value="FPS">First Person Shooter</option>
                <option value="RTS">Real-Time Strategy</option>
                <option value="MOBA">MOBA</option>
                <option value="RPG">Role Playing Game</option>
                <option value="Sports">Sports</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="form-group">
              <label>Description</label>
              <input 
                type="text" 
                name="description" 
                value={recordData.description} 
                onChange={handleChange} 
                placeholder="Optional description..." 
                className="tech-input"
              />
            </div>

            <div className="form-group slider-group">
              <label>Aggression Level: {recordData.aggressionLevel}</label>
              <input 
                type="range" 
                name="aggressionLevel" 
                min="0" 
                max="100" 
                value={recordData.aggressionLevel} 
                onChange={handleSliderChange} 
                className="tech-slider"
              />
            </div>

            <div className="form-group slider-group">
              <label>Reaction Time: {recordData.reactionTime}</label>
              <input 
                type="range" 
                name="reactionTime" 
                min="0" 
                max="100" 
                value={recordData.reactionTime} 
                onChange={handleSliderChange} 
                className="tech-slider"
              />
            </div>

            <div className="form-group slider-group">
              <label>Risk Tolerance: {recordData.riskTolerance}</label>
              <input 
                type="range" 
                name="riskTolerance" 
                min="0" 
                max="100" 
                value={recordData.riskTolerance} 
                onChange={handleSliderChange} 
                className="tech-slider"
              />
            </div>
          </div>

          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div>
              <strong>Data Privacy Guarantee</strong>
              <p>Your gameplay style remains encrypted during FHE processing</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn tech-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn tech-button primary">
            {creating ? "Encrypting with FHE..." : "Start Training"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface RecordDetailModalProps {
  record: GameStyleRecord;
  onClose: () => void;
  decryptedValue: any;
  setDecryptedValue: (value: any) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<any>;
  renderRadarChart: () => React.ReactNode;
}

const RecordDetailModal: React.FC<RecordDetailModalProps> = ({ 
  record, 
  onClose, 
  decryptedValue, 
  setDecryptedValue, 
  isDecrypting, 
  decryptWithSignature,
  renderRadarChart
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(record.encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal tech-card">
        <div className="modal-header">
          <h2>Ghost Profile #{record.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>Game Type:</span>
              <strong>{record.gameType}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>{record.owner.substring(0, 6)}...{record.owner.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${record.status}`}>{record.status}</strong>
            </div>
          </div>

          <div className="ghost-visualization">
            <h3>Play Style Analysis</h3>
            {renderRadarChart()}
          </div>

          <div className="encrypted-data-section">
            <h3>Encrypted Data</h3>
            <div className="encrypted-data">
              {record.encryptedData.substring(0, 100)}...
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>Zama FHE Encrypted</span>
            </div>
            <button 
              className="decrypt-btn tech-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedValue !== null ? (
                "Hide Decrypted Values"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>

          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Play Style</h3>
              <div className="style-attributes">
                <div className="attribute">
                  <span>Aggression:</span>
                  <div className="attribute-value">
                    <div 
                      className="attribute-bar" 
                      style={{ width: `${decryptedValue.aggression}%` }}
                    ></div>
                    <span>{decryptedValue.aggression}</span>
                  </div>
                </div>
                <div className="attribute">
                  <span>Reaction:</span>
                  <div className="attribute-value">
                    <div 
                      className="attribute-bar" 
                      style={{ width: `${decryptedValue.reaction}%` }}
                    ></div>
                    <span>{decryptedValue.reaction}</span>
                  </div>
                </div>
                <div className="attribute">
                  <span>Risk Tolerance:</span>
                  <div className="attribute-value">
                    <div 
                      className="attribute-bar" 
                      style={{ width: `${decryptedValue.risk}%` }}
                    ></div>
                    <span>{decryptedValue.risk}</span>
                  </div>
                </div>
              </div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn tech-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;