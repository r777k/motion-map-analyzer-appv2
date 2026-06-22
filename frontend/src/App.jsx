import { useState, useEffect } from 'react';
import axios from 'axios';
import { UploadCloud, Activity, Info, X, Sun, Moon, Download, Camera, LogIn, LogOut, KeyRound, Calendar, MapPin, Trash2 } from 'lucide-react';

import RunSummary from './components/RunSummary';
import PerformanceStats from './components/PerformanceStats';
import RouteMap from './components/RouteMap';
import MapControls from './components/MapControls';
import ElevationProfile from './components/ElevationProfile';

function App() {
  const [file, setFile] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hoveredTrackpoint, setHoveredTrackpoint] = useState(null);
  const [applyPrivacy, setApplyPrivacy] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(600);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const [theme, setTheme] = useState('light');

  // --- PASSWORDLESS OAUTH OPTIONAL STATE CHASSIS ---
  const [userToken, setUserToken] = useState(localStorage.getItem('motion_map_token') || null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authOTP, setAuthOTP] = useState('');
  const [authStep, setAuthStep] = useState(1); 
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  // --- PHASE 4: HISTORY MODE NAVIGATION CONFIGS ---
  const [activeSidebarTab, setActiveSidebarTab] = useState('upload'); 
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [mapConfig, setMapConfig] = useState({
    baseMap: 'Standard',
    overlayMetric: 'None',
    colorScale: 'viridis',
    motionTypes: { Running: true, Walking: true, Stopped: true },
    markers: { Kilometre: true, Time: false, Direction: false },
    thickness: 'medium'
  });

  const [activeHighlight, setActiveHighlight] = useState(null);

  useEffect(() => {
    setMapConfig(prev => ({
      ...prev,
      baseMap: theme === 'dark' ? 'Dark' : 'Standard'
    }));
  }, [theme]);

  useEffect(() => {
    if (userToken && activeSidebarTab === 'history') {
      fetchUserHistoryList();
    }
  }, [userToken, activeSidebarTab]);

  useEffect(() => {
    if (!isDraggingSplitter) return;
    const handleMouseMove = (e) => {
      const clampedWidth = Math.max(350, Math.min(750, e.clientX));
      setSidebarWidth(clampedWidth);
    };
    const handleMouseUp = () => { setIsDraggingSplitter(false); };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSplitter]);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setData(null);
  };

  const handleCloseRun = () => {
    setData(null);
    setFile(null);
    setError(null);
    setActiveHighlight(null);
    setHoveredTrackpoint(null);
  };

  const fetchUserHistoryList = async () => {
    setHistoryLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
      const res = await axios.get(`${API_BASE}/api/activities`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      setHistoryItems(res.data.history || []);
    } catch (err) {
      console.error("Failed to populate history feed:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleLoadSavedActivity = async (activityId) => {
    setLoading(true);
    setError(null);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
      const res = await axios.get(`${API_BASE}/api/activities/${activityId}`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      const historicalWorkspace = res.data.data;
      historicalWorkspace.id = activityId; 
      setData(historicalWorkspace);
    } catch (err) {
      setError("Failed to stream saved activity analytics profiles.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCurrentRun = async () => {
    if (!data || !userToken) return;
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
      const res = await axios.post(`${API_BASE}/api/activities`, {
        summary: data.summary,
        segments: data.segments,
        trackpoints: data.trackpoints,
        performance: data.performance || {},
        metrics: data.metrics || {}
      }, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      //alert("Workout saved securely to your anonymous profile index!");
      
      if (res.data && res.data.activity_id) {
        setData(prev => ({ ...prev, id: res.data.activity_id }));
      }
      
      fetchUserHistoryList();
    } catch (err) {
      alert("Failed to pin active workout data to cloud tables.");
    }
  };

  const handleDeleteSavedRun = async (e, activityId) => {
    e.stopPropagation(); 
    if (!window.confirm("Are you sure you want to permanently delete this run log?")) return;
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
      await axios.delete(`${API_BASE}/api/activities/${activityId}`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      setHistoryItems(prev => prev.filter(item => item.id !== activityId));
      if (data && data.id === activityId) {
        handleCloseRun();
      }
    } catch (err) {
      alert("Failed to erase log row records.");
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('apply_privacy', applyPrivacy);

    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
      const response = await axios.post(`${API_BASE}/api/analyze`, formData, {
        headers: userToken ? { Authorization: `Bearer ${userToken}` } : {}
      });
      setData(response.data.data);
    } catch (err) {
      setError(err.response?.data?.detail || "An error occurred connecting to the server.");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOTP = async (e) => {
    e.preventDefault();
    if (!authEmail) return;
    setAuthLoading(true);
    setAuthError(null);

    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
      await axios.post(`${API_BASE}/api/auth/send-otp`, { email: authEmail });
      setAuthStep(2); 
    } catch (err) {
      setAuthError(err.response?.data?.detail || "Failed to trigger mailing network service.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    if (!authOTP || authOTP.length < 6) return;
    setAuthLoading(true);
    setAuthError(null);

    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
      const response = await axios.post(`${API_BASE}/api/auth/verify-otp`, {
        email: authEmail,
        code: authOTP
      });
      const token = response.data.access_token;
      localStorage.setItem('motion_map_token', token);
      setUserToken(token);
      setAuthModalOpen(false);
      setAuthEmail('');
      setAuthOTP('');
      setAuthStep(1);
      setActiveSidebarTab('history');
    } catch (err) {
      setAuthError(err.response?.data?.detail || "Invalid or expired authorization code.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('motion_map_token');
    setUserToken(null);
    setActiveSidebarTab('upload');
    handleCloseRun();
  };

  const exportToCSV = () => {
    if (!data) return;
    let csvContent = "";

    const appendSectionHeader = (title) => {
      csvContent += `\n# --------------------------------------------------\n`;
      csvContent += `# ${title.toUpperCase()}\n`;
      csvContent += `# --------------------------------------------------\n`;
    };

    appendSectionHeader("Run Summary Overview");
    csvContent += "Metric,Value\n";
    if (data.summary) {
      Object.entries(data.summary).forEach(([k, v]) => {
        if (typeof v !== 'object') {
          csvContent += `"${k.replace(/_/g, ' ')}","${v}"\n`;
        }
      });
    }

    // 1 - Best Rolling Intervals Section Compiler
    const rollingKey = Object.keys(data.performance || {}).find(k => k.includes("rolling") || k.includes("best"));
    if (rollingKey && data.performance[rollingKey]?.length > 0) {
      appendSectionHeader("Best Rolling Intervals Data");
      csvContent += "Interval Window,Avg Pace,Start Time,End Time\n";
      data.performance[rollingKey].forEach(row => {
        csvContent += `"${row.window_m ?? '-'}","${row.pace_min_per_km ?? '-'}","${row.start_time ?? '-'}","${row.end_time ?? '-'}"\n`;
      });
    }

    // 2 - KM Performance Splits Section Compiler
    if (data.performance?.km_splits?.length > 0) {
      appendSectionHeader("Km Performance Splits");
      csvContent += "Split Pace,Avg HR,Avg Cadence,Start Time,End Time\n";
      data.performance.km_splits.forEach(row => {
        csvContent += `"${row.pace_min_per_km ?? '-'}","${row.avg_hr_bpm ?? '-'}","${row.avg_cadence_spm ?? '-'}","${row.start_time ?? '-'}","${row.end_time ?? '-'}"\n`;
      });
    }

    // 3 - Heart Rate Zone Bands Section Compiler
    if (data.performance?.hr_bands?.length > 0) {
      appendSectionHeader("HR Bands");
      csvContent += "Band,Time,Distance,Avg Pace,EF,Min Val,Max Val\n";
      data.performance.hr_bands.forEach(row => {
        csvContent += `"${row.band ?? '-'}","${row.time_s ?? '-'}","${row.distance_m ?? '-'}","${row.avg_pace_min_per_km ?? '-'}","${row.ef ?? '-'}","${row.min_val ?? '-'}","${row.max_val ?? '-'}"\n`;
      });
    }

    // 4 - Cadence Zone Bands Section Compiler
    if (data.performance?.cadence_bands?.length > 0) {
      appendSectionHeader("Cadence Bands");
      csvContent += "Band,Time,Distance,Avg Pace,EF,Min Val,Max Val\n";
      data.performance.cadence_bands.forEach(row => {
        csvContent += `"${row.band ?? '-'}","${row.time_s ?? '-'}","${row.distance_m ?? '-'}","${row.avg_pace_min_per_km ?? '-'}","${row.ef ?? '-'}","${row.min_val ?? '-'}","${row.max_val ?? '-'}"\n`;
      });
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `MotionMap_Export_${data.summary?.start_time?.split(' ')[0] || 'Run'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const captureVisualSnapshot = async () => {
    if (!data) return;
    const originalText = document.title;
    document.title = "Generating Card Asset...";

    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
      const response = await axios.post(`${API_BASE}/api/export-snapshot`, {
        summary: data.summary,
        segments: data.segments,
        trackpoints: data.trackpoints,
        performance: data.performance,
        config: { theme, overlayMetric: mapConfig.overlayMetric, colorScale: mapConfig.colorScale, thickness: mapConfig.thickness }
      }, { responseType: 'blob' });

      const blob = new Blob([response.data], { type: 'image/png' });
      const imgUrl = window.URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = imgUrl;
      downloadAnchor.download = `MotionMap_Card_${data.summary?.start_time?.split(' ')[0] || 'Run'}.png`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      
      document.body.removeChild(downloadAnchor);
      window.URL.revokeObjectURL(imgUrl);
    } catch (err) {
      alert("Failed to compile image card asset.");
    } finally {
      document.title = originalText;
    }
  };

  const renderFormattedDuration = (seconds) => {
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  };

/* --- ASYNCHRONOUS FRONTEND-DRIVEN DEMO FILE TRYOUT HANDLER --- */
  const handleDemoTryout = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch the static tcx asset from your local frontend server/Vercel distribution
      const res = await fetch('/demo.tcx');
      if (!res.ok) throw new Error("Could not load the built-in demo activity file asset.");
      
      const blob = await res.blob();
      
      // 2. Wrap the raw binary stream inside a native browser File instance wrapper
      const demoFile = new File([blob], 'demo.tcx', { type: 'application/octet-stream' });
      
      // 3. Package it into standard form multipart arrays to match real user file ingest streams
      const formData = new FormData();
      formData.append('file', demoFile);
      formData.append('apply_privacy', applyPrivacy); // Honors their current privacy checkbox state

      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
      const response = await axios.post(`${API_BASE}/api/analyze`, formData, {
        headers: userToken ? { Authorization: `Bearer ${userToken}` } : {}
      });
      
      setData(response.data.data);
    } catch (err) {
      setError(err.message || "An error occurred while loading the demo run workspace channels.");
    } finally {
      setLoading(false);
    }
  };

  if (!data) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-6 md:p-12 transition-colors duration-200 relative ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
        
        {/* HEADER TOOLBAR ALIGNMENT */}
        <div className="absolute top-6 right-6 flex items-center space-x-3">
          {userToken ? (
            <div className="flex items-center space-x-2">
              <button onClick={() => { setActiveSidebarTab(activeSidebarTab === 'history' ? 'upload' : 'history'); }} className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {activeSidebarTab === 'history' ? "Go to Upload" : "View History Log"}
              </button>
              <button onClick={handleLogout} className="px-4 py-2 text-xs font-black rounded-xl border flex items-center space-x-2 bg-red-500/10 border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white transition-all">
                <LogOut className="w-4 h-4" /> <span>Sign Out</span>
              </button>
            </div>
          ) : (
            <button onClick={() => { setAuthModalOpen(true); setAuthError(null); }} className={`px-4 py-2 text-xs font-black rounded-xl border flex items-center space-x-2 transition-all ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 shadow-sm'}`}>
              <LogIn className="w-4 h-4" /> <span>Sign In (Optional)</span>
            </button>
          )}

          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className={`p-2 rounded-xl border transition-all ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-amber-400 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100 shadow-sm'}`}>
            {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>

        {/* LOGO TITLE SECTION */}
        <header className="flex flex-col items-center mb-12 text-center flex-shrink-0">
          <h1 className="text-4xl font-black tracking-tight mb-1">👟📍📈 Motion Map Analyzer</h1>
          <p className={`text-xs font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>Interactive Workout Analytics Workspace</p>
        </header>
        
        {activeSidebarTab === 'history' && userToken ? (
          <div className={`p-6 rounded-2xl shadow-xl border w-full max-w-xl flex flex-col h-[500px] transition-all ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            <h2 className="text-xl font-black tracking-tight mb-4 flex items-center justify-between">
              <span>🗂️ Cloud History Logs</span>
              <button onClick={() => setActiveSidebarTab('upload')} className="text-xs text-blue-500 hover:underline font-bold">Upload a new file instead</button>
            </h2>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {historyLoading ? (
                <div className="h-full flex items-center justify-center text-xs font-bold text-slate-400">Streaming Neon Database Logs...</div>
              ) : historyItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-800/20 rounded-xl">
                  <p className="text-sm font-bold text-slate-400">No runs saved yet.</p>
                  <p className="text-xs text-slate-500 mt-1">Analyze an activity file and click "Save to Account" to populate this ledger!</p>
                </div>
              ) : (
                historyItems.map(item => (
                  <div key={item.id} onClick={() => handleLoadSavedActivity(item.id)} className={`p-4 rounded-xl border cursor-pointer flex items-center justify-between transition-all group ${theme === 'dark' ? 'bg-slate-950 border-slate-800 hover:border-blue-500 hover:bg-slate-900' : 'bg-slate-50 border-slate-200 hover:border-blue-500 hover:bg-white'}`}>
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2 text-sm font-black tracking-tight">
                        <Calendar className="w-3.5 h-3.5 text-blue-500" />
                        <span>{item.start_time.split(' ')[0]}</span>
                        <span className="text-xs opacity-40 font-medium">{item.start_time.split(' ')[1]}</span>
                      </div>
                      <div className="flex items-center space-x-3 text-xs font-bold text-slate-400">
                        <span className="text-blue-500 text-sm font-black">
                          {item.distance_km ? `${item.distance_km.toFixed(2)} km` : '- km'}
                        </span>
                        <span>⏱️ {renderFormattedDuration(item.duration_s)}</span>
                        <span className="text-purple-500">⚡ {item.avg_pace_str || '-:--'} /km</span>
                      </div>
                      <div className="text-[11px] font-bold text-slate-500 flex items-center space-x-1"><MapPin className="w-3 h-3 text-emerald-500" /> <span>{item.location_city}</span></div>
                    </div>
                    <button onClick={(e) => handleDeleteSavedRun(e, item.id)} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* RESPONSIVE DUAL-PANEL GRID LAYOUT */
          <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* LEFT COLUMN: GENTLE USER FEATURE HIGHLIGHTS */}
            <div className="lg:col-span-7 space-y-5 p-2">
              <h2 className="text-xl font-black tracking-tight flex items-center mb-2">
                <span className="mr-2">⚡</span> Quick Start & Feature Highlights
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-sm'}`}>
                  <h3 className="text-xs font-black uppercase tracking-wider text-blue-500 mb-1">📁 Easy File Uploads</h3>
                  <p className="text-xs text-slate-400 leading-normal font-medium">Drop any standard workout file. Supports raw binary (<code className="font-mono text-blue-400">.fit</code>) and Training Center Extension (<code className="font-mono text-blue-400">.tcx</code>) activity streams.</p>
                </div>

                <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-sm'}`}>
                  <h3 className="text-xs font-black uppercase tracking-wider text-emerald-500 mb-1">🔒 Smart Privacy Masking</h3>
                  <p className="text-xs text-slate-400 leading-normal font-medium">Enable the mask to auto-hide the first and last 500 meters of your route path. Your charts stay perfectly accurate, but your private locations stay private.</p>
                </div>

                <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-sm'}`}>
                  <h3 className="text-xs font-black uppercase tracking-wider text-purple-500 mb-1">📊 Deep Workout Analytics</h3>
                  <p className="text-xs text-slate-400 leading-normal font-medium">See your absolute fastest rolling intervals (400m, 1K, 5K), individual kilometer split logs, and comprehensive cardiovascular time-in-zone grids.</p>
                </div>

                <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-sm'}`}>
                  <h3 className="text-xs font-black uppercase tracking-wider text-amber-500 mb-1">👁️ Map & Elevation Sync</h3>
                  <p className="text-xs text-slate-400 leading-normal font-medium">Hover anywhere across your responsive elevation chart. A smart tracking indicator moves along your map path to show you exactly where each milestone happened.</p>
                </div>
              </div>

              <div className={`p-4 rounded-xl border text-center ${theme === 'dark' ? 'bg-blue-950/20 border-blue-900/30 text-blue-400' : 'bg-blue-500/5 border-blue-500/10 text-blue-600'}`}>
                <p className="text-[11px] font-bold leading-normal">🛡️ <span className="uppercase tracking-wider font-black mr-1">Privacy First:</span> Your workouts are processed entirely in your browser's temporary
memory. Even if you choose to sign in to save your history, we never store or save your email address. Instead, it is instantly turned into an irreversible, anonymous cryptographic signature (SHA-256) so your identity and your routes stay completely yours!</p>
              </div>
            </div>

            {/* RIGHT COLUMN: RECTANGULAR UPLOAD CONTROL CARD */}
            <div className={`lg:col-span-5 p-8 rounded-2xl shadow-xl border w-full transition-all duration-200 ${theme === 'dark' ? 'bg-slate-900 border-slate-800/80' : 'bg-white border-slate-200'}`}>
              <form onSubmit={handleUpload} className="flex flex-col items-center space-y-5">
                <div className={`p-4 rounded-full ${theme === 'dark' ? 'bg-slate-950' : 'bg-blue-50'}`}>
                  <UploadCloud className={`w-10 h-10 ${theme === 'dark' ? 'text-slate-500' : 'text-blue-500'}`} />
                </div>
                <div className="text-center">
                  <h2 className="text-lg font-black tracking-tight">Upload Workout File</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Select a tracking log asset file to execute analysis</p>
                </div>
                
                <input type="file" accept=".tcx,.fit" onChange={handleFileChange} className={`text-sm file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black w-full cursor-pointer border p-2 rounded-xl ${theme === 'dark' ? 'text-slate-400 border-slate-800 file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700' : 'text-slate-500 border-slate-100 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 shadow-inner'}`} />

                <div className={`w-full flex items-center justify-between p-3.5 border rounded-xl relative group ${theme === 'dark' ? 'bg-slate-950/40 border-slate-800' : 'bg-slate-50/50 border-slate-200'}`}>
                  <label className="flex items-center space-x-2.5 text-xs font-bold cursor-pointer select-none">
                    <input type="checkbox" checked={applyPrivacy} onChange={(e) => setApplyPrivacy(e.target.checked)} className="w-4 h-4 text-blue-600 rounded-lg border-slate-300 dark:border-slate-800 dark:bg-slate-950 focus:ring-0 cursor-pointer" />
                    <span className="opacity-90">Enable privacy zone mask</span>
                  </label>
                  <div className="relative flex items-center">
                    <Info className={`w-4 h-4 cursor-help ${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`} />
                    <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block w-52 p-2.5 bg-slate-950 text-white text-[11px] font-medium rounded-xl shadow-2xl z-50 text-center leading-normal border border-slate-800">
                      Hides the first and last 500 meters of your route to protect home/start locations.
                      <div className="absolute top-full right-1.5 -mt-1 border-4 border-transparent border-t-slate-950"></div>
                    </div>
                  </div>
                </div>

                <button type="submit" disabled={!file || loading} className="mt-2 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-wider disabled:opacity-30 transition-all shadow-md shadow-blue-600/10">
                  {loading ? 'Processing Analytics...' : 'Analyze Run Workspace'}
                </button>
              </form>

              {/* DYNAMIC TRY-OUT TRIGGER ELEMENT LINK INJECTED HERE */}
              <div className="text-center mt-4 pt-1 border-t border-dashed border-slate-500/10">
                <span className="text-xs text-slate-400">Don't have an activity file handy? </span>
                <button 
                  type="button" 
                  onClick={handleDemoTryout} 
                  disabled={loading}
                  className="text-xs text-blue-500 hover:text-blue-600 hover:underline font-bold bg-transparent border-none p-0 cursor-pointer disabled:opacity-30"
                >
                  Try our demo run
                </button>
              </div>

              {error && <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-xs font-bold text-center leading-normal">{error}</div>}
            </div>

          </div>
        )}

        {authModalOpen && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
            <div className={`w-full max-w-sm rounded-2xl border p-6 shadow-2xl relative transition-all ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-100 text-slate-800'}`}>
              <button onClick={() => { setAuthModalOpen(false); setAuthStep(1); setAuthEmail(''); setAuthOTP(''); }} className="absolute top-4 right-4 p-1.5 rounded-lg opacity-60 hover:opacity-100 transition-colors"><X className="w-4 h-4" /></button>
              
              <div className="flex items-center space-x-2.5 mb-4">
                <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl"><KeyRound className="w-5 h-5" /></div>
                <div>
                  <h3 className="font-black text-base tracking-tight">Zero-Knowledge Access</h3>
                  <p className={`text-[11px] ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>No passwords. No tracking records. Pure security.</p>
                </div>
              </div>

              {authStep === 1 ? (
                <form onSubmit={handleRequestOTP} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Email Address</label>
                    <input type="email" required placeholder="Enter email to sign up or log in" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className={`w-full px-3 py-2 rounded-xl border text-sm font-medium transition-all outline-none focus:ring-1 focus:ring-blue-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800 focus:border-blue-500' : 'bg-slate-50 border-slate-200 focus:bg-white'}`} />
                  </div>
                  <button type="submit" disabled={authLoading || !authEmail} className="w-full py-2 bg-blue-600 text-white rounded-xl font-bold">Send Verification Code</button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOTP} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">6-Digit Verification Code</label>
                    <input type="text" required maxLength={6} pattern="\d{6}" placeholder="------" value={authOTP} onChange={(e) => setAuthOTP(e.target.value)} className="w-full px-4 py-3 rounded-xl border text-center font-black text-xl bg-slate-950 border-slate-800 text-white" />
                  </div>
                  <button type="submit" disabled={authLoading || authOTP.length < 6} className="w-full py-2 bg-blue-600 text-white rounded-xl font-bold">Verify & Connect Session</button>
                </form>
              )}

              {authError && <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-xs font-bold text-center leading-normal">{authError}</div>}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`flex h-screen overflow-hidden font-sans transition-colors duration-200 ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
      
      {/* SIDEBAR PANEL */}
      <div 
        style={{ width: `${sidebarWidth}px` }}
        className={`flex-shrink-0 h-full overflow-y-auto p-5 shadow-sm flex flex-col space-y-6 border-r transition-colors duration-200 ${
          theme === 'dark' ? 'bg-slate-900/40 border-slate-800' : 'bg-slate-50/50 border-slate-200'
        }`}
      >
        <header className={`pb-4 border-b flex justify-between items-start flex-shrink-0 ${theme === 'dark' ? 'border-slate-800' : 'border-slate-200'}`}>
          <div>
            <h1 className="text-lg font-black tracking-tight flex items-center"><span className="mr-2">👟📍📈</span>Motion Map Analyzer</h1>
            <div className="flex items-center space-x-2 mt-2">
              <button onClick={exportToCSV} className={`px-2 py-1 text-[10px] font-bold rounded border ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600 shadow-sm'}`}><Download className="w-3 h-3 inline mr-1" />Export CSV</button>
              <button onClick={captureVisualSnapshot} className={`px-2 py-1 text-[10px] font-bold rounded border ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600 shadow-sm'}`}><Camera className="w-3 h-3 inline mr-1" />Share Card</button>
              
              {userToken && data.summary?.start_time && (
                data.id ? (
                  <span className="px-2 py-1 text-[10px] font-black bg-emerald-600/10 border border-emerald-500/20 text-emerald-500 rounded select-none">✓ Saved to Cloud</span>
                ) : (
                  <button onClick={handleSaveCurrentRun} className="px-2 py-1 text-[10px] font-black bg-blue-600 hover:bg-blue-700 text-white rounded shadow-sm">💾 Save to Account</button>
                )
              )}
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            {userToken && (
              <button onClick={() => { setActiveSidebarTab(activeSidebarTab === 'history' ? 'upload' : 'history'); handleCloseRun(); }} className={`p-1.5 rounded-lg border transition-colors font-bold text-xs ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-600 shadow-sm'}`}>
                {activeSidebarTab === 'history' ? "Upload" : "History"}
              </button>
            )}
            {userToken && (
              <button onClick={handleLogout} className="p-1.5 rounded-lg border bg-red-500/10 border-red-500/20 text-red-500"><LogOut className="w-4 h-4" /></button>
            )}
            <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="p-1.5 rounded-lg border">{theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-500" />}</button>
            <button onClick={handleCloseRun} className="p-1.5 rounded-lg border"><X className="w-4 h-4" /></button>
          </div>
        </header>

        {data.summary?.start_time ? (
          <div className="flex-1 space-y-6">
            <RunSummary summary={data.summary} metrics={data.metrics} theme={theme} />
            <MapControls config={mapConfig} setConfig={setMapConfig} segments={data.segments} trackpoints={data.trackpoints} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} theme={theme} />
            <PerformanceStats performance={data.performance} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} theme={theme} />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-xs font-bold text-slate-400">Loading workout workspace channels...</div>
        )}
      </div>

      <div onMouseDown={() => setIsDraggingSplitter(true)} className="w-1 h-full cursor-col-resize flex-shrink-0 bg-slate-200 dark:bg-slate-800" />

      {/* RIGHT DISPLAY CANVASES */}
      <div className="flex-1 h-full p-4 flex flex-col space-y-4 overflow-hidden min-w-0">
         <div className="flex-1 w-full relative rounded-xl overflow-hidden shadow-sm">
            {data.trackpoints && (
              <RouteMap segments={data.segments} trackpoints={data.trackpoints} config={mapConfig} splits={data.performance?.km_splits} activeHighlight={activeHighlight} hoveredTrackpoint={hoveredTrackpoint} setActiveHighlight={setActiveHighlight} theme={theme} />
            )}
         </div>
         <div className="w-full flex-shrink-0">
            {data.trackpoints && (
              <ElevationProfile trackpoints={data.trackpoints} segments={data.segments} config={mapConfig} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} setHoveredTrackpoint={setHoveredTrackpoint} theme={theme} />
            )}
         </div>
      </div>

    </div>
  );
}

export default App;
