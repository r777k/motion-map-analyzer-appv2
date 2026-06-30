import { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  UploadCloud, Info, X, Sun, Moon, Download, Camera, LogIn, LogOut, 
  KeyRound, Calendar, MapPin, Trash2, Search, ArrowUpDown, BarChart3, 
  Clock, Milestone, AlertTriangle, Mail, Eye, EyeOff, Layers, Sparkles
} from 'lucide-react';

import RunSummary from './components/RunSummary';
import PerformanceStats from './components/PerformanceStats';
import RouteMap from './components/RouteMap';
import MapControls from './components/MapControls';
import ElevationProfile from './components/ElevationProfile';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

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

  // --- PASSWORDLESS OAUTH STATE ---
  const [userToken, setUserToken] = useState(localStorage.getItem('motion_map_token') || null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authOTP, setAuthOTP] = useState('');
  const [authStep, setAuthStep] = useState(1); 
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false); 

  // --- NAVIGATION STATE FILTERS ---
  const [activeSidebarTab, setActiveSidebarTab] = useState('upload'); 
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historySortBy, setHistorySortBy] = useState('date_desc'); 

  // --- INTEGRATED STRAVA FEED STATE ---
  const [stravaFeedItems, setStravaFeedItems] = useState([]);
  const [stravaFeedLoading, setStravaFeedLoading] = useState(false);

  // --- MOBILE SPA VIEWPORT STATE CORE ---
  const [mobileTab, setMobileTab] = useState('summary'); 
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(true); 

  const [mapConfig, setMapConfig] = useState({
    baseMap: 'Standard',
    overlayMetric: 'None',
    colorScale: 'viridis',
    motionTypes: { Running: true, Walking: true, Stopped: true },
    markers: { Kilometre: true, Time: false, Direction: false },
    thickness: 'medium'
  });

  const [activeHighlight, setActiveHighlight] = useState(null);

  // Automatically switch default stroke weights down to thin on mobile form factors
  useEffect(() => {
    if (window.innerWidth < 1024) {
      setMapConfig(prev => ({ ...prev, thickness: 'thin' }));
    }
  }, []);

  useEffect(() => {
    setMapConfig(prev => ({
      ...prev,
      baseMap: theme === 'dark' ? 'Dark' : 'Standard'
    }));
  }, [theme]);

  useEffect(() => {
    if (userToken && activeSidebarTab === 'history') {
      fetchUserHistoryList(userToken);
    }
  }, [userToken, activeSidebarTab]);

  const handleLogout = (isTimeout = false) => {
    localStorage.removeItem('motion_map_token');
    setUserToken(null); 
    setActiveSidebarTab('upload'); 
    handleCloseRun();
    setHistoryItems([]);
    setStravaFeedItems([]);
    setSessionExpired(isTimeout === true);
  };

  const fetchUserHistoryList = async (tokenOverride = null) => {
    const activeToken = tokenOverride || userToken;
    if (!activeToken) return;
    setHistoryLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/activities`, {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      setHistoryItems(res.data.history || []);
      setSessionExpired(false);
    } catch (err) {
      console.error("Failed to populate history feed:", err);
      if (err.response?.status === 401) handleLogout(true);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (userToken && activeSidebarTab === 'history') {
      setStravaFeedLoading(true);
      axios.get(`${API_BASE}/api/strava/latest-activities`, {
        headers: { Authorization: `Bearer ${userToken}` }
      })
      .then(res => setStravaFeedItems(res.data.activities || []))
      .catch((err) => {
        if (err.response?.status === 401) handleLogout(true);
      })
      .finally(() => setStravaFeedLoading(false));
    }
  }, [userToken, activeSidebarTab]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const stravaCode = urlParams.get("code");
    if (stravaCode) {
      setLoading(true);
      window.history.replaceState({}, document.title, window.location.pathname);
      axios.post(`${API_BASE}/api/auth/strava/exchange`, { code: stravaCode }, {
        headers: userToken ? { Authorization: `Bearer ${userToken}` } : {}
      })
      .then((res) => {
        if (res.data && res.data.access_token) {
          const freshToken = res.data.access_token;
          localStorage.setItem('motion_map_token', freshToken);
          setUserToken(freshToken);
          setSessionExpired(false);
          setActiveSidebarTab('history');
          fetchUserHistoryList(freshToken);
        }
      })
      .catch((err) => {
        setError(err.response?.data?.detail || "Failed to verify credentials linkage with Strava.");
      })
      .finally(() => setLoading(false));
    }
  }, []);

  const handleLoadStravaActivity = async (stravaActivityId) => {
    if (!userToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/strava/analyze-activity/${stravaActivityId}`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      setData(res.data.data);
    } catch (err) {
      setError("Failed to download and parse high-resolution telemetry from Strava.");
      if (err.response?.status === 401) handleLogout(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isDraggingSplitter) return;
    const handleMouseMove = (e) => { setSidebarWidth(Math.max(350, Math.min(750, e.clientX))); };
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

  const handleLoadSavedActivity = async (activityId) => {
    if (!userToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/activities/${activityId}`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      const historicalWorkspace = res.data.data;
      historicalWorkspace.id = activityId; 
      setData(historicalWorkspace);
    } catch (err) {
      setError("Failed to stream saved activity analytics profiles.");
      if (err.response?.status === 401) handleLogout(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCurrentRun = async () => {
    if (!data || !userToken) return;
    try {
      const res = await axios.post(`${API_BASE}/api/activities`, {
        summary: data.summary, segments: data.segments, trackpoints: data.trackpoints,
        performance: data.performance || {}, metrics: data.metrics || {}
      }, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      if (res.data && res.data.activity_id) {
        setData(prev => ({ ...prev, id: res.data.activity_id }));
      }
      fetchUserHistoryList(userToken);
    } catch (err) {
      alert("Failed to pin active workout data to cloud tables.");
      if (err.response?.status === 401) handleLogout(true);
    }
  };

  const handleDeleteSavedRun = async (e, activityId) => {
    e.stopPropagation(); 
    if (!window.confirm("Are you sure you want to permanently delete this run log?")) return;
    try {
      await axios.delete(`${API_BASE}/api/activities/${activityId}`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
      setHistoryItems(prev => prev.filter(item => item.id !== activityId));
      if (data && data.id === activityId) handleCloseRun();
    } catch (err) {
      alert("Failed to erase log row records.");
      if (err.response?.status === 401) handleLogout(true);
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
      const response = await axios.post(`${API_BASE}/api/analyze`, formData, {
        headers: userToken ? { Authorization: `Bearer ${userToken}` } : {}
      });
      setData(response.data.data);
    } catch (err) {
      setError(err.response?.data?.detail || "An error occurred connecting to the server.");
      if (err.response?.status === 401) handleLogout(true);
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
      const response = await axios.post(`${API_BASE}/api/auth/verify-otp`, { email: authEmail, code: authOTP });
      const token = response.data.access_token;
      localStorage.setItem('motion_map_token', token);
      setUserToken(token);
      setAuthModalOpen(false);
      setSessionExpired(false);
      setAuthEmail(''); setAuthOTP(''); setAuthStep(1);
      setActiveSidebarTab('history');
      fetchUserHistoryList(token);
    } catch (err) {
      setAuthError(err.response?.data?.detail || "Invalid or expired authorization code.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleDemoTryout = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/demo.tcx');
      if (!res.ok) throw new Error("Could not load the built-in demo activity file asset.");
      const blob = await res.blob();
      const demoFile = new File([blob], 'demo.tcx', { type: 'application/octet-stream' });
      const formData = new FormData();
      formData.append('file', demoFile);
      formData.append('apply_privacy', applyPrivacy);

      const response = await axios.post(`${API_BASE}/api/analyze`, formData, {
        headers: userToken ? { Authorization: `Bearer ${userToken}` } : {}
      });
      setData(response.data.data);
    } catch (err) {
      setError(err.message || "An error occurred while loading the demo run workspace.");
    } finally {
      setLoading(false);
    }
  };

  // COMPLETE MULTI-SECTION SPREADSHEET ANALYSIS EXPORTER
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
        if (typeof v !== 'object') csvContent += `"${k.replace(/_/g, ' ')}","${v}"\n`;
      });
    }

    if (data.performance) {
      const p = data.performance;
      const rollingKey = Object.keys(p).find(k => k.includes("rolling") || k.includes("best"));
      if (rollingKey && p[rollingKey]?.length > 0) {
        appendSectionHeader("Best Rolling Intervals Data");
        const headers = Object.keys(p[rollingKey][0]);
        csvContent += headers.join(",") + "\n";
        p[rollingKey].forEach(row => { csvContent += headers.map(h => `"${row[h] ?? '-'}"`).join(",") + "\n"; });
      }

      if (p.km_splits?.length > 0) {
        appendSectionHeader("Km Performance Splits");
        const headers = Object.keys(p.km_splits[0]);
        csvContent += headers.join(",") + "\n";
        p.km_splits.forEach(row => { csvContent += headers.map(h => `"${row[h] ?? '-'}"`).join(",") + "\n"; });
      }

      ['hr_bands', 'cadence_bands'].forEach(zoneKey => {
        if (p[zoneKey]?.length > 0) {
          appendSectionHeader(zoneKey.replace(/_/g, ' '));
          const headers = Object.keys(p[zoneKey][0]);
          csvContent += headers.join(",") + "\n";
          p[zoneKey].forEach(row => { csvContent += headers.map(h => `"${row[h] ?? '-'}"`).join(",") + "\n"; });
        }
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
      const response = await axios.post(`${API_BASE}/api/export-snapshot`, {
        summary: data.summary, segments: data.segments, trackpoints: data.trackpoints, performance: data.performance,
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

  const convertPaceToSeconds = (paceStr) => {
    if (!paceStr || !paceStr.includes(':')) return 999999;
    const parts = paceStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  };

  const cumulativeDistance = historyItems.reduce((acc, curr) => acc + (curr.distance_km || 0), 0);
  const cumulativeDuration = historyItems.reduce((acc, curr) => acc + (curr.duration_s || 0), 0);

  const filteredAndSortedHistory = historyItems
    .filter(item => {
      if (!historySearchQuery) return true;
      return (item.location_city || '').toLowerCase().includes(historySearchQuery.toLowerCase());
    })
    .sort((a, b) => {
      if (historySortBy === 'date_desc') return new Date(b.start_time) - new Date(a.start_time);
      if (historySortBy === 'distance_desc') return (b.distance_km || 0) - (a.distance_km || 0);
      if (historySortBy === 'pace_asc') return convertPaceToSeconds(a.avg_pace_str) - convertPaceToSeconds(b.avg_pace_str);
      return 0;
    });

  const renderSharedUploadCard = () => (
    <div className={`p-6 md:p-8 rounded-2xl shadow-xl border w-full ${theme === 'dark' ? 'bg-slate-900 border-slate-800/80' : 'bg-white border-slate-200'}`}>
      <form onSubmit={handleUpload} className="flex flex-col items-center space-y-5">
        <div className={`p-4 rounded-full ${theme === 'dark' ? 'bg-slate-950' : 'bg-blue-50'}`}><UploadCloud className={`w-10 h-10 ${theme === 'dark' ? 'text-slate-500' : 'text-blue-500'}`} /></div>
        <div className="text-center">
          <h2 className="text-sm font-black uppercase tracking-wider">Analyze Activity Trace</h2>
          <p className="text-xs text-slate-400 mt-0.5">Drop a high-resolution .tcx or .fit tracking stream asset</p>
        </div>
        <input type="file" accept=".tcx,.fit" onChange={handleFileChange} className={`text-sm file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black w-full cursor-pointer border p-2 rounded-xl ${theme === 'dark' ? 'text-slate-400 border-slate-800 file:bg-slate-800 file:text-slate-200' : 'text-slate-500 border-slate-100 file:bg-blue-50 file:text-blue-700 shadow-inner'}`} />
        <div className={`w-full flex items-center justify-between p-3 border rounded-xl relative group ${theme === 'dark' ? 'bg-slate-950/40 border-slate-800' : 'bg-slate-50/50 border-slate-200'}`}>
          <label className="flex items-center space-x-2.5 text-xs font-bold cursor-pointer"><input type="checkbox" checked={applyPrivacy} onChange={(e) => setApplyPrivacy(e.target.checked)} className="w-4 h-4 text-blue-600 rounded focus:ring-0" /><span>Enable home obfuscation mask</span></label>
          <Info className="w-4 h-4 text-slate-400" />
        </div>
        <button type="submit" disabled={!file || loading} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-wider disabled:opacity-30 shadow-md shadow-blue-600/10">{loading ? 'Executing Engine Models...' : 'Analyze Run Workspace'}</button>
      </form>
      <div className="text-center mt-5 pt-3 border-t border-dashed border-slate-500/10 flex flex-col items-center space-y-3">
        <div><span className="text-xs text-slate-400">Missing an active file? </span><button type="button" onClick={handleDemoTryout} disabled={loading} className="text-xs text-blue-500 hover:underline font-bold">Launch Built-In Demo</button></div>
        <button type="button" disabled={loading} onClick={() => {
          const clientID = import.meta.env.VITE_STRAVA_CLIENT_ID || '260297';
          const redirectURI = encodeURIComponent("https://motion-map-analyzer-appv2.vercel.app");
          window.location.href = `https://www.strava.com/oauth/authorize?client_id=${clientID}&response_type=code&redirect_uri=${redirectURI}&approval_prompt=auto&scope=activity:read_all`;
        }} className="px-4 py-2 bg-[#FC6100] text-white text-[11px] font-black rounded-xl shadow-sm flex items-center space-x-2 border-0"><span>🧡 Connect Strava Profile</span></button>
      </div>
      {error && <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-xs font-bold text-center">{error}</div>}
    </div>
  );

  const renderSharedHistoryLedger = () => (
    <div className={`p-6 rounded-2xl shadow-xl border w-full flex flex-col ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
      <h2 className="text-base font-black uppercase tracking-wider mb-4 flex justify-between items-center"><span>🗂️ Cloud History Feed</span><button onClick={() => setActiveSidebarTab('upload')} className="text-xs text-blue-500 hover:underline font-bold">Upload Local File</button></h2>
      {historyItems.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4 p-3 rounded-xl border dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 text-center">
          <div><p className="text-[9px] font-bold uppercase text-slate-400">Total Distance</p><p className="text-sm font-black text-blue-500">{cumulativeDistance.toFixed(1)} km</p></div>
          <div><p className="text-[9px] font-bold uppercase text-slate-400">Moving Time</p><p className="text-sm font-black text-purple-500 truncate">{renderFormattedDuration(cumulativeDuration)}</p></div>
          <div><p className="text-[9px] font-bold uppercase text-slate-400">Logs Saved</p><p className="text-sm font-black text-emerald-500">{historyItems.length}</p></div>
        </div>
      )}
      {historyItems.length > 0 && (
        <div className="flex gap-2 mb-4">
          <input type="text" placeholder="Filter by city location..." value={historySearchQuery} onChange={(e) => setHistorySearchQuery(e.target.value)} className={`flex-1 px-3 py-1.5 rounded-xl text-xs font-bold border outline-none ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`} />
          <select value={historySortBy} onChange={(e) => setHistorySortBy(e.target.value)} className="px-2 py-1.5 rounded-xl text-xs font-bold border dark:bg-slate-950 dark:border-slate-800"><option value="date_desc">Newest</option><option value="distance_desc">Distance</option></select>
        </div>
      )}
      
      {/* RESTORED BUG #1: Strava Link Feeds contain formatted granular date/time lines */}
      {userToken && stravaFeedItems.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[10px] font-black uppercase tracking-wider text-[#FC6100] mb-2">🧡 Active Strava Link Feed</h3>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
            {stravaFeedItems.map(act => {
              const cleanDate = act.start_date ? act.start_date.split('T')[0] : 'Recent';
              const cleanTime = act.start_date ? act.start_date.split('T')[1].substring(0, 5) : '';

              return (
                <div key={act.id} onClick={() => handleLoadStravaActivity(act.id)} className={`p-2.5 rounded-xl border cursor-pointer min-w-[155px] text-xs font-bold dark:bg-slate-950 dark:border-slate-800 hover:border-[#FC6100]`}>
                  <p className="truncate opacity-90 text-slate-800 dark:text-slate-200">{act.name}</p>
                  <p className="text-[10px] font-medium text-slate-400 mt-0.5">🗓️ {cleanDate} <span className="opacity-60 font-normal ml-0.5">{cleanTime}</span></p>
                  <div className="flex justify-between text-[10px] mt-2 text-blue-500 font-black"><span>{act.distance_km} km</span><span className="text-slate-400 font-normal">⏱️ {Math.floor(act.duration_s / 60)}m</span></div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
        {historyLoading ? (
          <div className="text-center py-6 text-xs text-slate-400 font-bold">Streaming Neon Ledger Rows...</div>
        ) : filteredAndSortedHistory.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400 font-medium border border-dashed rounded-xl dark:border-slate-800">No workout matches found. Analyze an activity and hit Save!</div>
        ) : (
          filteredAndSortedHistory.map(item => (
            <div key={item.id} onClick={() => handleLoadSavedActivity(item.id)} className={`p-3 rounded-xl border cursor-pointer flex justify-between items-center group text-xs font-bold dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-blue-500`}>
              <div>
                <div className="flex items-center space-x-1.5 truncate"><Calendar className="w-3 h-3 text-blue-500" /><span>{item.start_time.split(' ')[0]}</span><span className="opacity-40 text-[10px] truncate max-w-[120px]">{item.location_city || 'Local Route'}</span></div>
                <div className="flex items-center space-x-3 text-[11px] mt-1"><span className="text-blue-500 font-black">{item.distance_km?.toFixed(2)} km</span><span className="text-slate-400">⏱️ {renderFormattedDuration(item.duration_s)}</span></div>
              </div>
              <button onClick={(e) => handleDeleteSavedRun(e, item.id)} className="p-1 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  // --- PASSWORDLESS OVERLAY MARKUP COMPONENT ---
  const authModalDialogMarkup = authModalOpen && (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[9000] p-4 animate-fadeIn">
      <div className={`max-w-md w-full rounded-2xl border p-6 shadow-2xl relative ${theme === 'dark' ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>
        <button onClick={() => { setAuthModalOpen(false); setAuthStep(1); setAuthError(null); }} className="absolute top-4 right-4 p-1.5 rounded-lg border dark:border-slate-800"><X className="w-4 h-4" /></button>
        <div className="flex flex-col items-center text-center space-y-3">
          <div className={`p-3 rounded-full ${theme === 'dark' ? 'bg-slate-950 text-blue-400' : 'bg-blue-50 text-blue-600'}`}><KeyRound className="w-6 h-6" /></div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider">Zero-Knowledge Access</h3>
            <p className="text-xs text-slate-400 mt-1 leading-normal">Your email profile is instantly converted to a blind cryptographic signature hash before database storage lookups.</p>
          </div>
        </div>
        {authStep === 1 ? (
          <form onSubmit={handleRequestOTP} className="mt-5 space-y-4">
            <input type="email" required placeholder="runner@example.com" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className={`w-full px-4 py-2.5 rounded-xl text-xs font-bold border outline-none ${theme === 'dark' ? 'bg-slate-950 border-slate-800 focus:border-blue-500' : 'bg-slate-50 border-slate-200 focus:bg-white'}`} />
            <button type="submit" disabled={authLoading} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md">{authLoading ? "Issuing Token..." : "Send Security Code"}</button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOTP} className="mt-5 space-y-4">
            <input type="text" required maxLength={6} placeholder="000000" value={authOTP} onChange={(e) => setAuthOTP(e.target.value.replace(/\D/g, ''))} className="w-full tracking-[0.5em] text-center py-2.5 rounded-xl text-sm font-black border dark:bg-slate-950 dark:border-slate-800" />
            <button type="submit" disabled={authLoading} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md">Verify & Log In</button>
          </form>
        )}
        {authError && <div className="mt-3 p-2.5 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-xs font-bold text-center">{authError}</div>}
      </div>
    </div>
  );

  const isOverlayFilterApplied = mapConfig.overlayMetric !== 'None' || activeHighlight !== null || Object.values(mapConfig.motionTypes).includes(false);

  // ---------------------------------------------------------------------------
  // OMISSION #2 RESTORED: Full 12-Column Responsive Landing Workspace
  // ---------------------------------------------------------------------------
  if (!data) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 md:p-12 relative ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
        
        {/* Navigation Action Anchors */}
        <div className="absolute top-4 right-4 flex items-center space-x-2 z-50">
          {userToken ? (
            <div className="flex items-center space-x-2">
              <button onClick={() => setActiveSidebarTab(activeSidebarTab === 'history' ? 'upload' : 'history')} className={`px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-xl border ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                {activeSidebarTab === 'history' ? "Go to Upload" : "Open History Log"}
              </button>
              <button onClick={() => handleLogout(false)} className="p-2 rounded-xl bg-red-500/10 text-red-500 border border-red-500/10"><LogOut className="w-4 h-4" /></button>
            </div>
          ) : (
            <button onClick={() => { setAuthModalOpen(true); setAuthError(null); }} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-xl border flex items-center space-x-1.5 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}><LogIn className="w-3.5 h-3.5" /> <span>Sign In</span></button>
          )}
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="p-2 rounded-xl border dark:border-slate-800">{theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-500" />}</button>
        </div>

        <header className="flex flex-col items-center mb-10 text-center select-none flex-shrink-0">
          <img src="/logo.png" alt="Logo" className="w-16 h-16 mb-2 drop-shadow-md" />
          <h1 className="text-2xl font-black tracking-tight">Motion Map Analyzer</h1>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-40 mt-0.5">Interactive Multi-Stream Telemetry Dashboard</p>
        </header>

        {sessionExpired && (
          <div className="w-full max-w-md mb-4 p-3 rounded-xl border flex items-center space-x-2.5 bg-red-500/10 border-red-500/20 text-red-500 text-xs font-bold">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">Session identity window has closed. Please request a fresh login code link.</span>
            <X className="w-4 h-4 cursor-pointer" onClick={() => setSessionExpired(false)} />
          </div>
        )}

        {/* RESTORED HIGH-FIDELITY TWIN CANVAS LANDING SYSTEM */}
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column Workspace: Core App Features description list blocks */}
          <div className="lg:col-span-7 space-y-5">
            <h2 className="text-xl font-black tracking-tight flex items-center opacity-90">
              <span className="mr-2">⚡</span> Quick Start & Feature Highlights
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-xs'}`}>
                <h3 className="text-xs font-black uppercase tracking-wider text-blue-500 mb-1">📁 Multi-Format Ingestion</h3>
                <p className="text-xs text-slate-400 leading-normal font-medium">Parses standard high-density Garmin/Coros training center xml logs (.tcx) and binary multi-channel loops (.fit) accurately.</p>
              </div>
              <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-xs'}`}>
                <h3 className="text-xs font-black uppercase tracking-wider text-emerald-500 mb-1">🔒 Zero-Knowledge Ledger</h3>
                <p className="text-xs text-slate-400 leading-normal font-medium">Applies irreversible SHA-256 signatures to isolate identity variables. No real-world context profiles touch storage.</p>
              </div>
              <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-xs'}`}>
                <h3 className="text-xs font-black uppercase tracking-wider text-purple-500 mb-1">📊 Peak Rolling Intervals</h3>
                <p className="text-xs text-slate-400 leading-normal font-medium">Computes mathematical best rolling workout spans (400m, 1K, 5K) and splits paired with aerobic Efficiency Factors (EF).</p>
              </div>
              <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-xs'}`}>
                <h3 className="text-xs font-black uppercase tracking-wider text-amber-500 mb-1">👁️ Cross-Pane Sync Engine</h3>
                <p className="text-xs text-slate-400 leading-normal font-medium">Scrubbing or touching coordinates instantly locks crosshairs and moves spatial visualizers on the map framework cleanly.</p>
              </div>
            </div>
            <div className={`p-4 rounded-xl border text-center shadow-inner ${theme === 'dark' ? 'bg-blue-950/20 border-blue-900/30 text-blue-400' : 'bg-blue-50/5 border-blue-500/10 text-blue-600'}`}>
              <p className="text-[11px] font-bold leading-normal">🛡️ <span className="uppercase tracking-wider font-black mr-1">Privacy Isolation Guard:</span> Workouts process locally inside secure temporary state buffers. For athletes using history saves, emails drop instantly into irreversible cryptographic signature matrices, protecting locations from identity vectors.</p>
            </div>
          </div>

          {/* Right Column Workspace: Ingestion Engine or History logs list options */}
          <div className="lg:col-span-5 w-full">
            {activeSidebarTab === 'history' && userToken ? renderSharedHistoryLedger() : renderSharedUploadCard()}
          </div>
        </div>

        {authModalDialogMarkup}
      </div>
    );
  }

  return (
    <div className={`flex h-screen w-full overflow-hidden font-sans select-none transition-colors duration-200 ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
      
      {/* 💻 DESKTOP DUAL CANVAS HARNESS */}
      <div className="hidden lg:flex h-full w-full overflow-hidden flex-row">
        <div style={{ width: `${sidebarWidth}px` }} className={`flex-shrink-0 h-full overflow-y-auto p-5 shadow-sm flex flex-col space-y-6 border-r ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800' : 'bg-slate-50/50 border-slate-200'}`}>
          <header className="pb-4 border-b flex justify-between items-start flex-shrink-0 dark:border-slate-800">
            <div>
              <h1 className="text-base font-black tracking-tight flex items-center space-x-2"><img src="/logo.png" alt="Logo" className="w-5 h-5" /><span>Motion Map Analyzer</span></h1>
              <div className="flex items-center space-x-1.5 mt-2.5">
                <button onClick={exportToCSV} className="px-2 py-1 text-[10px] font-bold rounded border dark:border-slate-700 bg-transparent"><Download className="w-3 h-3 inline mr-1" />Export CSV</button>
                <button onClick={captureVisualSnapshot} className="px-2 py-1 text-[10px] font-bold rounded border dark:border-slate-700 bg-transparent"><Camera className="w-3 h-3 inline mr-1" />Share Card</button>
                {userToken && data.summary?.start_time && (data.id ? <span className="px-2 py-1 text-[10px] font-black bg-emerald-600/10 text-emerald-500 rounded border border-emerald-500/10">✓ Synced Cloud Log</span> : <button onClick={handleSaveCurrentRun} className="px-2 py-1 text-[10px] font-black bg-blue-600 hover:bg-blue-700 text-white rounded shadow-sm">💾 Save to Account</button>)}
              </div>
            </div>
            <div className="flex items-center space-x-1.5">
              <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="p-1.5 rounded-lg border dark:border-slate-700"><Sun className="w-3.5 h-3.5 hidden dark:block text-amber-400" /><Moon className="w-3.5 h-3.5 block dark:hidden text-slate-500" /></button>
              <button onClick={handleCloseRun} className="p-1.5 rounded-lg border dark:border-slate-700"><X className="w-3.5 h-3.5" /></button>
            </div>
          </header>
          <div className="flex-1 space-y-6">
            <RunSummary summary={data.summary} metrics={data.metrics} theme={theme} />
            <MapControls config={mapConfig} setConfig={setMapConfig} segments={data.segments} trackpoints={data.trackpoints} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} theme={theme} />
            <PerformanceStats performance={data.performance} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} theme={theme} />
          </div>
        </div>
        <div onMouseDown={() => setIsDraggingSplitter(true)} className="w-1 h-full cursor-col-resize flex-shrink-0 bg-slate-200 dark:bg-slate-800 hover:bg-blue-500 transition-colors" />
        <div className="flex-1 h-full p-4 flex flex-col space-y-4 overflow-hidden min-w-0">
           <div className="flex-1 w-full relative rounded-xl overflow-hidden shadow-xs border dark:border-slate-800">
              {data.trackpoints && <RouteMap segments={data.segments} trackpoints={data.trackpoints} config={mapConfig} splits={data.performance?.km_splits} activeHighlight={activeHighlight} hoveredTrackpoint={hoveredTrackpoint} setActiveHighlight={setActiveHighlight} theme={theme} />}
           </div>
           <div className="w-full flex-shrink-0 flex flex-col space-y-2">
              {data.trackpoints && <ElevationProfile trackpoints={data.trackpoints} segments={data.segments} config={mapConfig} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} setHoveredTrackpoint={setHoveredTrackpoint} theme={theme} />}
              
              {/* OMISSION #1 RESTORED: High-fidelity desktop telemetry disclaimer sub-bar node */}
              <div className="text-center w-full select-none pb-0.5 opacity-40 text-[9px] font-bold">
                ⚠️ Motion segmentation and metrics are computational models. Coordinates match tracking centers but may vary from localized hardware records.
              </div>
           </div>
        </div>
      </div>

      {/* 📱 PORTRAIT TOUCH-OPTIMIZED WEB SPA APPLICATION CHASSIS */}
      <div className="flex lg:hidden h-screen w-full flex-col relative overflow-hidden bg-slate-50 dark:bg-slate-950">
         
         {/* HUD Row Container */}
         <div className="absolute top-3 left-3 right-3 z-50 flex items-center justify-between pointer-events-none">
            <div className="p-2 bg-slate-900/95 text-white rounded-xl shadow-lg border border-slate-800 flex items-center space-x-2 pointer-events-auto select-none">
               <img src="/logo.png" alt="Logo" className="w-5 h-5 flex-shrink-0" />
               <span className="text-[10px] font-black uppercase tracking-wider">{data.summary?.location_city?.split(',')[0] || "Route View"}</span>
            </div>
            
            <div className="flex items-center space-x-1.5 pointer-events-auto">
               <button onClick={exportToCSV} title="Download Workout CSV Spreadsheet" className="p-2 bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-xl shadow-md text-slate-500 dark:text-slate-400 active:bg-slate-100"><Download className="w-4 h-4" /></button>
               <button onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)} title={mobileDrawerOpen ? "Hide Metrics Panel Overlay" : "Show Metrics Panel Overlay"} className="p-2 bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-xl shadow-md text-slate-500 dark:text-slate-400 active:bg-slate-100">
                  {mobileDrawerOpen ? <EyeOff className="w-4 h-4 text-blue-500" /> : <Eye className="w-4 h-4" />}
               </button>
               <button onClick={handleCloseRun} title="Close Workspace & Unload Active File" className="p-2 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-xl shadow-md active:bg-rose-500 active:text-white transition-colors"><X className="w-4 h-4" /></button>
            </div>
         </div>

         {/* Backdrop leaflet map engine view */}
         <div className="absolute inset-0 z-0">
            {data.trackpoints && (
              <RouteMap 
                segments={data.segments} 
                trackpoints={data.trackpoints} 
                config={mapConfig} 
                splits={data.performance?.km_splits} 
                activeHighlight={activeHighlight} 
                hoveredTrackpoint={hoveredTrackpoint} 
                setActiveHighlight={setActiveHighlight} 
                theme={theme}
                isMobileFrame={true}
                mobileDrawerOpen={mobileDrawerOpen}
                mobileTab={mobileTab}
              />
            )}
         </div>

         {/* Floating Expandable Overlay Bottom Sheet */}
         {mobileDrawerOpen && (
            <div className={`absolute left-3 right-3 z-40 transition-all duration-300 shadow-2xl border flex flex-col p-4 rounded-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 ${mobileTab === 'charts' ? 'bottom-20 max-h-[42vh]' : 'bottom-20 max-h-[58vh]'}`}>
               <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-2.5 flex-shrink-0" />
               <div className="flex-1 overflow-y-auto min-w-0 pr-0.5 scrollbar-none">
                  {mobileTab === 'summary' && (
                     <div className="space-y-4">
                        <RunSummary summary={data.summary} metrics={data.metrics} theme={theme} />
                        <div className="border-t border-dashed dark:border-slate-800 pt-3">
                           <PerformanceStats performance={data.performance} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} theme={theme} />
                        </div>
                     </div>
                  )}
                  {mobileTab === 'map' && <div className="p-1"><MapControls config={mapConfig} setConfig={setMapConfig} segments={data.segments} trackpoints={data.trackpoints} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} theme={theme} /></div>}
                  {mobileTab === 'charts' && <div className="min-w-0 w-full h-full -mt-2"><ElevationProfile trackpoints={data.trackpoints} segments={data.segments} config={mapConfig} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} setHoveredTrackpoint={setHoveredTrackpoint} theme={theme} /></div>}
               </div>
            </div>
         )}

         {/* Thumb Tab Navigation footer Bar */}
         <footer className="absolute bottom-0 left-0 right-0 h-16 bg-slate-950 text-white flex justify-around items-center z-50 border-t border-slate-800/80 shadow-2xl">
            <button onClick={() => { setMobileTab('summary'); setMobileDrawerOpen(true); }} className={`flex-1 h-full flex flex-col items-center justify-center space-y-0.5 text-[10px] font-black uppercase tracking-wider border-0 bg-transparent ${mobileTab === 'summary' && mobileDrawerOpen ? 'text-blue-400' : 'text-slate-500'}`}><BarChart3 className="w-4 h-4" /><span>Biometrics</span></button>
            <button onClick={() => { setMobileTab('charts'); setMobileDrawerOpen(true); }} className={`flex-1 h-full flex flex-col items-center justify-center space-y-0.5 text-[10px] font-black uppercase tracking-wider border-0 bg-transparent ${mobileTab === 'charts' && mobileDrawerOpen ? 'text-blue-400' : 'text-slate-500'}`}><Clock className="w-4 h-4" /><span>Timeline</span></button>
            <button onClick={() => { setMobileTab('map'); setMobileDrawerOpen(true); }} className={`flex-1 h-full flex flex-col items-center justify-center space-y-0.5 text-[10px] font-black uppercase tracking-wider border-0 bg-transparent relative ${mobileTab === 'map' && mobileDrawerOpen ? 'text-blue-400' : 'text-slate-500'}`}>
               <Layers className="w-4 h-4" />
               <span>Overlays</span>
               {isOverlayFilterApplied && <span className="absolute top-2 right-6 w-2 h-2 rounded-full bg-rose-500 border border-slate-950 animate-pulse" />}
            </button>
         </footer>
      </div>

      {authModalDialogMarkup}
    </div>
  );
}

export default App;