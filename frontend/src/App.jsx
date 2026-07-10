import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  UploadCloud, Info, X, Sun, Moon, Download, Camera, LogIn, LogOut, 
  KeyRound, Calendar, Trash2, BarChart3, Clock, AlertTriangle, Eye, EyeOff, Layers, Sparkles
} from 'lucide-react';

import RunSummary from './components/RunSummary';
import PerformanceStats from './components/PerformanceStats';
import RouteMap from './components/RouteMap';
import MapControls from './components/MapControls';
import ElevationProfile from './components/ElevationProfile';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const FEATURE_LIST = [
  { id: 'f1', icon: '📁', title: 'Multi-Format Activity Import', desc: 'Upload .FIT or .TCX files, or connect to Strava to access your activities.', color: 'text-blue-500' },
  { id: 'f2', icon: '🔒', title: 'Smart Privacy Masking', desc: 'Keeps sensitive locations private when sharing; by clipping the start and end, 500m, of your route.', color: 'text-emerald-500' },
  { id: 'f3', icon: '📊', title: 'Deep Workout Analytics', desc: 'Track peak rolling intervals (400m, 1K, 5K), km splits, and aerobic efficiency (EF).', color: 'text-purple-500' },
  { id: 'f4', icon: '👁️', title: 'Activity Insights Map', desc: 'Map your run with precision - track exactly where your heart rate peaked, cadence dropped, and pace shifted.', color: 'text-amber-500' },
  { id: 'f5', icon: '🛡️', title: 'Privacy Isolation Guard', desc: 'Your workouts are processed in secure, temporary memory. For saved history, emails are converted into irreversible cryptographic signatures—so your identity and location stay protected. Your email is never stored!', color: 'text-slate-500' }
];

function App() {
  // --- CORE WORKSPACE STATE ---
  const [file, setFile] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hoveredTrackpoint, setHoveredTrackpoint] = useState(null);
  const [applyPrivacy, setApplyPrivacy] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(600);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const [theme, setTheme] = useState('light');

  // --- UPLOAD PROGRESS SIMULATION STATE ---
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSimulatingProgress, setIsSimulatingProgress] = useState(false);
  const progressIntervalRef = useRef(null);

  // --- OAUTH & SESSION STATE ---
  const [userToken, setUserToken] = useState(localStorage.getItem('motion_map_token') || null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authOTP, setAuthOTP] = useState('');
  const [authStep, setAuthStep] = useState(1); 
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false); 

  // --- NAVIGATION & FEED STATE ---
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historySortBy, setHistorySortBy] = useState('date_desc'); 
  const [stravaFeedItems, setStravaFeedItems] = useState([]);

  // --- MOBILE SPA STATE ---
  const [mobileTab, setMobileTab] = useState('summary'); 
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(true); 

  const [mapConfig, setMapConfig] = useState({
    baseMap: 'Standard', overlayMetric: 'None', colorScale: 'viridis',
    motionTypes: { Running: true, Walking: true, Stopped: true },
    markers: { Kilometre: true, Time: false, Direction: false },
    thickness: 'medium'
  });

  const [activeHighlight, setActiveHighlight] = useState(null);

  // Responsive defaults
  useEffect(() => {
    if (window.innerWidth < 1024) setMapConfig(prev => ({ ...prev, thickness: 'thin' }));
  }, []);

  useEffect(() => {
    setMapConfig(prev => ({ ...prev, baseMap: theme === 'dark' ? 'Dark' : 'Standard' }));
  }, [theme]);

  // --- AUTHENTICATION & API HOOKS ---
  const handleLogout = (isTimeout = false) => {
    localStorage.removeItem('motion_map_token');
    setUserToken(null); 
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
      const res = await axios.get(`${API_BASE}/api/activities`, { headers: { Authorization: `Bearer ${activeToken}` } });
      setHistoryItems(res.data.history || []);
      setSessionExpired(false);
    } catch (err) {
      if (err.response?.status === 401) handleLogout(true);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (userToken) {
      fetchUserHistoryList(userToken);
      axios.get(`${API_BASE}/api/strava/latest-activities`, { headers: { Authorization: `Bearer ${userToken}` } })
        .then(res => setStravaFeedItems(res.data.activities || []))
        .catch((err) => { if (err.response?.status === 401) handleLogout(true); });
    }
  }, [userToken]);

  // Strava OAuth Exchange Hook
  useEffect(() => {
    const stravaCode = new URLSearchParams(window.location.search).get("code");
    if (stravaCode) {
      setLoading(true);
      window.history.replaceState({}, document.title, window.location.pathname);
      axios.post(`${API_BASE}/api/auth/strava/exchange`, { code: stravaCode }, { headers: userToken ? { Authorization: `Bearer ${userToken}` } : {} })
      .then((res) => {
        if (res.data && res.data.access_token) {
          localStorage.setItem('motion_map_token', res.data.access_token);
          setUserToken(res.data.access_token);
          setSessionExpired(false);
          fetchUserHistoryList(res.data.access_token);
        }
      }).catch(() => setError("Failed to verify credentials linkage with Strava.")).finally(() => setLoading(false));
    }
  }, []);

  const simulateProgress = () => {
    setIsSimulatingProgress(true);
    setUploadProgress(0);
    let currentProgress = 0;
    progressIntervalRef.current = setInterval(() => {
      if (currentProgress < 85) currentProgress += Math.random() * 12; 
      else if (currentProgress < 95) currentProgress += Math.random() * 1.5; 
      if (currentProgress > 95) currentProgress = 95;
      setUploadProgress(currentProgress);
    }, 150);
  };

  const finishProgress = () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setUploadProgress(100);
  };

  const resetProgress = () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setIsSimulatingProgress(false);
    setUploadProgress(0);
  };

  const handleLoadStravaActivity = async (id) => {
    if (!userToken) return;
    setLoading(true); setError(null);
    simulateProgress();
    try {
      const res = await axios.get(`${API_BASE}/api/strava/analyze-activity/${id}`, { headers: { Authorization: `Bearer ${userToken}` } });
      finishProgress();
      setTimeout(() => {
        setData(res.data.data);
        resetProgress();
      }, 400);
    } catch (err) {
      resetProgress();
      setError("Failed to download telemetry from Strava.");
      if (err.response?.status === 401) handleLogout(true);
    } finally { setLoading(false); }
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setData(null);
  };

  const handleCloseRun = () => { setData(null); setFile(null); setError(null); setActiveHighlight(null); setHoveredTrackpoint(null); };

  const handleLoadSavedActivity = async (id) => {
    if (!userToken) return;
    setLoading(true); setError(null);
    simulateProgress();
    try {
      const res = await axios.get(`${API_BASE}/api/activities/${id}`, { headers: { Authorization: `Bearer ${userToken}` } });
      finishProgress();
      setTimeout(() => {
        setData({ ...res.data.data, id });
        resetProgress();
      }, 400);
    } catch (err) {
      resetProgress();
      setError("Failed to stream saved profile.");
      if (err.response?.status === 401) handleLogout(true);
    } finally { setLoading(false); }
  };

  const handleSaveCurrentRun = async () => {
    if (!data || !userToken) return;
    try {
      const res = await axios.post(`${API_BASE}/api/activities`, { summary: data.summary, segments: data.segments, trackpoints: data.trackpoints, performance: data.performance || {}, metrics: data.metrics || {} }, { headers: { Authorization: `Bearer ${userToken}` } });
      if (res.data?.activity_id) setData(prev => ({ ...prev, id: res.data.activity_id }));
      fetchUserHistoryList(userToken);
    } catch (err) {
      alert("Failed to pin active workout.");
      if (err.response?.status === 401) handleLogout(true);
    }
  };

  const handleDeleteSavedRun = async (e, id) => {
    e.stopPropagation(); 
    if (!window.confirm("Delete this log?")) return;
    try {
      await axios.delete(`${API_BASE}/api/activities/${id}`, { headers: { Authorization: `Bearer ${userToken}` } });
      setHistoryItems(prev => prev.filter(item => item.id !== id));
      if (data && data.id === id) handleCloseRun();
    } catch (err) {
      alert("Failed to erase record.");
      if (err.response?.status === 401) handleLogout(true);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setLoading(true); setError(null);
    simulateProgress();
    
    const formData = new FormData(); 
    formData.append('file', file); 
    formData.append('apply_privacy', applyPrivacy);
    
    try {
      const res = await axios.post(`${API_BASE}/api/analyze`, formData, { headers: userToken ? { Authorization: `Bearer ${userToken}` } : {} });
      finishProgress();
      setTimeout(() => {
        setData(res.data.data);
        resetProgress();
      }, 400);
    } catch (err) {
      resetProgress();
      setError(err.response?.data?.detail || "Connection error.");
      if (err.response?.status === 401) handleLogout(true);
    } finally { setLoading(false); }
  };

  const handleDemoTryout = async () => {
    setLoading(true); setError(null);
    simulateProgress();
    try {
      const res = await fetch('/demo.tcx');
      const blob = await res.blob();
      const formData = new FormData(); 
      formData.append('file', new File([blob], 'demo.tcx')); 
      formData.append('apply_privacy', applyPrivacy);
      
      const output = await axios.post(`${API_BASE}/api/analyze`, formData, { headers: userToken ? { Authorization: `Bearer ${userToken}` } : {} });
      finishProgress();
      setTimeout(() => {
        setData(output.data.data);
        resetProgress();
      }, 400);
    } catch (err) { 
      resetProgress();
      setError("Failed to load built-in demo."); 
    } finally { setLoading(false); }
  };

  const handleRequestOTP = async (e) => {
    e.preventDefault();
    if (!authEmail) return;
    setAuthLoading(true); setAuthError(null);
    try { 
      await axios.post(`${API_BASE}/api/auth/send-otp`, { email: authEmail }); 
      setAuthStep(2); 
    } catch (err) { setAuthError(err.response?.data?.detail || "Failed to trigger mailing service."); } 
    finally { setAuthLoading(false); }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    if (!authOTP || authOTP.length < 6) return;
    setAuthLoading(true); setAuthError(null);
    try {
      const res = await axios.post(`${API_BASE}/api/auth/verify-otp`, { email: authEmail, code: authOTP });
      localStorage.setItem('motion_map_token', res.data.access_token);
      setUserToken(res.data.access_token);
      setAuthModalOpen(false); setSessionExpired(false); setAuthEmail(''); setAuthOTP(''); setAuthStep(1);
      fetchUserHistoryList(res.data.access_token);
    } catch (err) { setAuthError(err.response?.data?.detail || "Invalid authorization code."); } 
    finally { setAuthLoading(false); }
  };

  // --- EXPORT & SHARE FUNCTIONS ---
  const exportToCSV = () => {
    if (!data) return;
    let csvContent = "";
    const appendHeader = (title) => { csvContent += `\n# --------------------------------------------------\n# ${title.toUpperCase()}\n# --------------------------------------------------\n`; };
    appendHeader("Run Summary Overview"); csvContent += "Metric,Value\n";
    if (data.summary) Object.entries(data.summary).forEach(([k, v]) => { if (typeof v !== 'object') csvContent += `"${k.replace(/_/g, ' ')}","${v}"\n`; });
    if (data.performance) {
      const p = data.performance;
      const rollingKey = Object.keys(p).find(k => k.includes("rolling") || k.includes("best"));
      if (rollingKey && p[rollingKey]?.length > 0) {
        appendHeader("Best Rolling Intervals Data");
        const headers = Object.keys(p[rollingKey][0]); csvContent += headers.join(",") + "\n";
        p[rollingKey].forEach(row => { csvContent += headers.map(h => `"${row[h] ?? '-'}"`).join(",") + "\n"; });
      }
      if (p.km_splits?.length > 0) {
        appendHeader("Km Performance Splits");
        const headers = Object.keys(p.km_splits[0]); csvContent += headers.join(",") + "\n";
        p.km_splits.forEach(row => { csvContent += headers.map(h => `"${row[h] ?? '-'}"`).join(",") + "\n"; });
      }
      ['hr_bands', 'cadence_bands'].forEach(zoneKey => {
        if (p[zoneKey]?.length > 0) {
          appendHeader(zoneKey.replace(/_/g, ' '));
          const headers = Object.keys(p[zoneKey][0]); csvContent += headers.join(",") + "\n";
          p[zoneKey].forEach(row => { csvContent += headers.map(h => `"${row[h] ?? '-'}"`).join(",") + "\n"; });
        }
      });
    }
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", `MotionMap_Export_${data.summary?.start_time?.split(' ')[0] || 'Run'}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const captureVisualSnapshot = async () => {
    if (!data) return;
    const originalText = document.title; document.title = "Generating Card Asset...";
    try {
      const res = await axios.post(`${API_BASE}/api/export-snapshot`, { 
        summary: data.summary, segments: data.segments, trackpoints: data.trackpoints, performance: data.performance, 
        config: { theme, overlayMetric: mapConfig.overlayMetric, colorScale: mapConfig.colorScale, thickness: mapConfig.thickness } 
      }, { responseType: 'blob' });
      const downloadAnchor = document.createElement('a'); downloadAnchor.href = window.URL.createObjectURL(new Blob([res.data], { type: 'image/png' }));
      downloadAnchor.download = `MotionMap_Card_${data.summary?.start_time?.split(' ')[0] || 'Run'}.png`;
      document.body.appendChild(downloadAnchor); downloadAnchor.click(); document.body.removeChild(downloadAnchor);
    } catch (err) { alert("Failed to compile image card asset."); } 
    finally { document.title = originalText; }
  };

  const renderFormattedDuration = (seconds) => {
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  };

  const convertPaceToSeconds = (paceStr) => {
    if (!paceStr || !paceStr.includes(':')) return 999999;
    const parts = paceStr.split(':'); return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  };

  const filteredHistory = historyItems
    .filter(item => !historySearchQuery || (item.location_city || '').toLowerCase().includes(historySearchQuery.toLowerCase()))
    .sort((a, b) => {
      if (historySortBy === 'date_desc') return new Date(b.start_time) - new Date(a.start_time);
      if (historySortBy === 'distance_desc') return (b.distance_km || 0) - (a.distance_km || 0);
      if (historySortBy === 'pace_asc') return convertPaceToSeconds(a.avg_pace_str) - convertPaceToSeconds(b.avg_pace_str);
      return 0;
    });

  const cumulativeDistance = historyItems.reduce((acc, curr) => acc + (curr.distance_km || 0), 0);
  const cumulativeDuration = historyItems.reduce((acc, curr) => acc + (curr.duration_s || 0), 0);

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

  const renderCinematicTeaser = () => (
    <div className={`relative w-full h-[380px] md:h-[500px] flex items-center justify-center overflow-hidden rounded-2xl shadow-sm border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200'} perspective-[1200px]`}>
      <style>{`
        .iso-container {
          transform: rotateX(55deg) rotateY(0deg) rotateZ(-45deg) scale(1.1);
          transform-style: preserve-3d;
          position: relative;
          width: 400px; height: 260px;
        }
        
        .iso-layer {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          border-radius: 12px;
          background-repeat: no-repeat;
          border: 1px solid ${theme === 'dark' ? 'rgba(30, 41, 59, 0.8)' : 'rgba(226, 232, 240, 0.8)'};
          box-shadow: ${theme === 'dark' ? '-35px 35px 50px rgba(0,0,0,0.6)' : '-35px 35px 50px rgba(0,0,0,0.1)'};
        }

        /* 1. Vertical Scroll (For Stats) */
        .layer-vertical {
          background-size: 100% auto; 
          animation: floatLayer 6s ease-in-out infinite, scrollVertical 10s linear infinite alternate;
        }

        /* 2. Horizontal Scroll (For Elevation Chart) */
        .layer-horizontal {
          background-size: auto 100%; /* Height fits, width overflows */
          animation: floatLayer 6s ease-in-out infinite, scrollHorizontal 15s linear infinite alternate;
        }

        /* 3. Map Cycling + Vertical Scroll */
        .layer-map-cycle {
          background-size: 100% auto;
          animation: floatLayer 6s ease-in-out infinite, scrollVertical 12s linear infinite alternate, cycleMaps 9s infinite;
        }

        /* The Animation Keyframes */
        @keyframes scrollVertical {
          0% { background-position: 0% 0%; }
          100% { background-position: 0% 100%; }
        }

        @keyframes scrollHorizontal {
          0% { background-position: 0% 0%; }
          100% { background-position: 100% 0%; }
        }

        @keyframes floatLayer {
          0%, 100% { transform: translateZ(var(--z-offset)) translateY(0px); }
          50% { transform: translateZ(var(--z-offset)) translateY(-15px); }
        }

        @keyframes cycleMaps {
          0%, 30% { background-image: url('/map-pace.png'); }
          35%, 65% { background-image: url('/map-cadence.png'); }
          70%, 100% { background-image: url('/map-splits.png'); }
        }
      `}</style>

      <div className="iso-container">
        {/* BOTTOM CARD: Stats (Scrolls vertically) */}
        <div 
          className="iso-layer layer-vertical" 
          style={{ 
            '--z-offset': '-110px', 
            backgroundImage: "url('/stats-layer.png')",
            backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff',
            animationDelay: '0s'
          }} 
        />

        {/* MIDDLE CARD: Elevation (Scrolls horizontally) */}
        <div 
          className="iso-layer layer-horizontal" 
          style={{ 
            '--z-offset': '0px', 
            backgroundImage: "url('/chart-layer.png')",
            backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff',
            animationDelay: '0.2s',
            opacity: 0.5
          }} 
        />

        {/* TOP CARD: Map (Cycles + Scrolls vertically) */}
        <div 
          className="iso-layer layer-map-cycle" 
          style={{ 
            '--z-offset': '110px', 
            backgroundColor: theme === 'dark' ? '#0f172a' : '#ffffff',
            animationDelay: '0.4s',
            opacity: 0.75
          }} 
        />
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // DASHBOARD LANDING ARCHITECTURE
  // ---------------------------------------------------------------------------
  if (!data) {
    return (
      <div className={`min-h-screen flex flex-col items-center p-4 md:p-8 relative overflow-x-hidden ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
        
        {/* Absolute Floating Control Header */}
        <div className="absolute top-4 right-4 flex items-center space-x-2 z-50">
          {userToken ? (
            <button onClick={() => handleLogout(false)} className="p-2 rounded-xl bg-red-500/10 text-red-500 border border-red-500/10"><LogOut className="w-4 h-4" /></button>
          ) : (
            <button onClick={() => { setAuthModalOpen(true); setAuthError(null); }} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-xl border flex items-center space-x-1.5 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}><LogIn className="w-3.5 h-3.5" /> <span>Sign In</span></button>
          )}
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="p-2 rounded-xl border dark:border-slate-800">{theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-500" />}</button>
        </div>

        <header className="flex flex-col items-center mb-6 mt-4 text-center select-none flex-shrink-0">
          <img src="/logo.png" alt="Logo" className="w-16 h-16 mb-2 drop-shadow-md" />
          <h1 className="text-2xl font-black tracking-tight">Motion Map Analyzer</h1>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-40 mt-0.5">Interactive Multi-Stream Telemetry Dashboard</p>
        </header>

        {sessionExpired && (
          <div className="w-full max-w-md mb-4 p-3 rounded-xl border flex items-center space-x-2.5 bg-red-500/10 border-red-500/20 text-red-500 text-xs font-bold"><AlertTriangle className="w-4 h-4 flex-shrink-0" /><span className="flex-1">Session identity window has closed. Please request a fresh login code link.</span><X className="w-4 h-4 cursor-pointer" onClick={() => setSessionExpired(false)} /></div>
        )}

        <div className="w-full max-w-[1200px] flex flex-col space-y-6">
           
           {/* Section 1: Dynamic Hero (Marquee + 3D Teaser) */}
           <div className={`w-full rounded-2xl shadow-sm border overflow-hidden ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
                 
                 {/* Left Side: Infinite Scrolling Features */}
                 <div className="lg:col-span-5 p-6 md:p-10 flex flex-col relative border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 h-[400px] md:h-[450px]">
                    <h2 className="text-xs font-black uppercase tracking-wider flex items-center opacity-80 mb-6 flex-shrink-0">
                      <Sparkles className="w-4 h-4 mr-1.5 text-blue-500" /> Quick Start & Feature Highlights
                    </h2>
                    
                    <style>{`
                      @keyframes scrollVerticalList {
                        0% { transform: translateY(0); }
                        100% { transform: translateY(-50%); }
                      }
                      .animate-marquee {
                        animation: scrollVerticalList 20s linear infinite;
                      }
                      .marquee-container:hover .animate-marquee {
                        animation-play-state: paused;
                      }
                    `}</style>

                    <div className="relative flex-1 overflow-hidden marquee-container">
                       {/* Top/Bottom Fade Masks */}
                       <div className={`absolute top-0 left-0 w-full h-12 z-20 pointer-events-none bg-gradient-to-b ${theme === 'dark' ? 'from-slate-900' : 'from-white'} to-transparent`} />
                       <div className={`absolute bottom-0 left-0 w-full h-12 z-20 pointer-events-none bg-gradient-to-t ${theme === 'dark' ? 'from-slate-900' : 'from-white'} to-transparent`} />
                       
                       {/* Outer Absolute Wrapper to establish full boundary area */}
                       <div className="absolute inset-0 w-full h-full">
                         {/* Inner scrolling element remains relative to calculate its true 100% height */}
                         <div className="animate-marquee flex flex-col gap-6 pb-6">
                            {[...FEATURE_LIST, ...FEATURE_LIST].map((feature, idx) => (
                               <div key={`${feature.id}-${idx}`} className="flex items-start space-x-3 opacity-90 hover:opacity-100 transition-opacity">
                                  <div className={`text-lg mt-0.5 ${feature.color}`}>{feature.icon}</div>
                                  <div>
                                     <h3 className={`text-[11px] font-black uppercase tracking-wider mb-1 ${feature.color}`}>{feature.title}</h3>
                                     <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">{feature.desc}</p>
                                  </div>
                               </div>
                            ))}
                         </div>
                       </div>
                    </div>
                 </div>

                 {/* Right Side: 3D Isometric Teaser */}
                 <div className="lg:col-span-7 relative h-[400px] md:h-[450px] flex items-center justify-center bg-slate-50/50 dark:bg-slate-950/40 perspective-[1200px] overflow-hidden">
                    {renderCinematicTeaser()}
                 </div>
              </div>
           </div>

           {/* Section 2: Upload and Data LEDGERS Container */}
           <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch pb-10">
              
              {/* Left Column: Dedicated Upload Module with Simulated Progress */}
              <div className={`p-6 md:p-8 rounded-2xl shadow-xl border w-full flex flex-col justify-center ${theme === 'dark' ? 'bg-slate-900 border-slate-800/80' : 'bg-white border-slate-200'}`}>
                <form onSubmit={handleUpload} className="flex flex-col items-center space-y-6">
                  <div className={`p-4 rounded-full ${theme === 'dark' ? 'bg-slate-950' : 'bg-blue-50'}`}><UploadCloud className={`w-10 h-10 ${theme === 'dark' ? 'text-slate-500' : 'text-blue-500'}`} /></div>
                  <div className="text-center">
                    <h2 className="text-sm font-black uppercase tracking-wider">Upload Local File</h2>
                    <p className="text-xs text-slate-400 mt-1">Drop a high-resolution .tcx or .fit tracking stream asset</p>
                  </div>
                  <input type="file" accept=".tcx,.fit" onChange={handleFileChange} disabled={isSimulatingProgress} className={`text-sm file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black w-full cursor-pointer border p-2 rounded-xl disabled:opacity-50 ${theme === 'dark' ? 'text-slate-400 border-slate-800 file:bg-slate-800 file:text-slate-200' : 'text-slate-500 border-slate-100 file:bg-blue-50 file:text-blue-700 shadow-inner'}`} />
                  <div className={`w-full flex items-center justify-between p-3 border rounded-xl relative group ${theme === 'dark' ? 'bg-slate-950/40 border-slate-800' : 'bg-slate-50/50 border-slate-200'}`}>
                    <label className="flex items-center space-x-2.5 text-xs font-bold cursor-pointer"><input type="checkbox" checked={applyPrivacy} onChange={(e) => setApplyPrivacy(e.target.checked)} disabled={isSimulatingProgress} className="w-4 h-4 text-blue-600 rounded focus:ring-0 disabled:opacity-50" /><span>Enable home obfuscation mask</span></label>
                    <Info className="w-4 h-4 text-slate-400" />
                  </div>
                  
                  {isSimulatingProgress ? (
                    <div className="w-full space-y-2 mt-2">
                      <div className="flex justify-between text-[10px] font-black uppercase tracking-wider text-blue-500">
                        <span>Parsing Telemetry Array...</span>
                        <span>{Math.round(uploadProgress)}%</span>
                      </div>
                      <div className={`w-full h-2.5 rounded-full overflow-hidden border ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'}`}>
                        <div className="h-full bg-blue-500 transition-all duration-150 ease-out" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    </div>
                  ) : (
                    <button type="submit" disabled={!file || loading} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-wider disabled:opacity-30 shadow-md shadow-blue-600/10">
                      Analyze Run Workspace
                    </button>
                  )}
                  <button type="button" onClick={handleDemoTryout} disabled={loading || isSimulatingProgress} className="text-xs text-blue-500 hover:underline font-bold disabled:opacity-50">Launch Built-In Demo Workspace</button>
                </form>
                {error && <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-xs font-bold text-center">{error}</div>}
              </div>

              {/* Right Column: Feeds & Integrations */}
              <div className="flex flex-col space-y-6 h-full min-h-[500px]">
                 
                 {/* Top Half: Active Strava Webhook */}
                 <div className={`p-6 rounded-2xl shadow-xl border w-full flex-shrink-0 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                    <h2 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center text-[#FC6100]">🧡 Connect Strava Profile</h2>
                    {!userToken ? (
                      <div className="text-center py-4 text-xs text-slate-400 font-medium">Log in to view synchronized activities.</div>
                    ) : (
                      stravaFeedItems.length > 0 ? (
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                          {stravaFeedItems.map(act => {
                            const cleanDate = act.start_date ? act.start_date.split('T')[0] : 'Recent';
                            const cleanTime = act.start_date ? act.start_date.split('T')[1].substring(0, 5) : '';
                            return (
                              <div key={act.id} onClick={() => handleLoadStravaActivity(act.id)} className={`p-3 rounded-xl border cursor-pointer min-w-[165px] text-xs font-bold dark:bg-slate-950 dark:border-slate-800 hover:border-[#FC6100]`}>
                                <p className="truncate opacity-90 text-slate-800 dark:text-slate-200">{act.name}</p>
                                <p className="text-[10px] font-medium text-slate-400 mt-0.5">🗓️ {cleanDate} <span className="opacity-60 font-normal ml-0.5">{cleanTime}</span></p>
                                <div className="flex justify-between text-[10px] mt-2.5 text-blue-500 font-black"><span>{act.distance_km} km</span><span className="text-slate-400 font-normal">⏱️ {Math.floor(act.duration_s / 60)}m</span></div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center">
                           <button type="button" disabled={loading || isSimulatingProgress} onClick={() => { const redirectURI = encodeURIComponent("https://motion-map-analyzer-appv2.vercel.app"); window.location.href = `https://www.strava.com/oauth/authorize?client_id=${import.meta.env.VITE_STRAVA_CLIENT_ID || '260297'}&response_type=code&redirect_uri=${redirectURI}&approval_prompt=auto&scope=activity:read_all`; }} className="px-4 py-2.5 bg-[#FC6100] text-white text-xs font-black rounded-xl shadow-md border-0 w-full disabled:opacity-50">Authenticate via Strava OAuth</button>
                        </div>
                      )
                    )}
                 </div>

                 {/* Bottom Half: Cloud Ledger History */}
                 <div className={`p-6 rounded-2xl shadow-xl border w-full flex-1 flex flex-col ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                    <h2 className="text-sm font-black uppercase tracking-wider mb-4 flex justify-between items-center"><span>🗂️ Cloud History Feed</span></h2>
                    {!userToken ? (
                      <div className="text-center py-10 flex-1 flex items-center justify-center text-xs text-slate-400 font-medium">Authentication required to view cloud history.</div>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-3 mb-4 p-3 rounded-xl border dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 text-center">
                          <div><p className="text-[9px] font-bold uppercase text-slate-400">Total Distance</p><p className="text-sm font-black text-blue-500">{cumulativeDistance.toFixed(1)} km</p></div>
                          <div><p className="text-[9px] font-bold uppercase text-slate-400">Moving Time</p><p className="text-sm font-black text-purple-500 truncate">{renderFormattedDuration(cumulativeDuration)}</p></div>
                          <div><p className="text-[9px] font-bold uppercase text-slate-400">Logs Saved</p><p className="text-sm font-black text-emerald-500">{historyItems.length}</p></div>
                        </div>
                        <div className="flex gap-2 mb-4">
                          <input type="text" placeholder="Filter by city location..." value={historySearchQuery} onChange={(e) => setHistorySearchQuery(e.target.value)} className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border outline-none ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`} />
                          <select value={historySortBy} onChange={(e) => setHistorySortBy(e.target.value)} className="px-2 py-2 rounded-xl text-xs font-bold border dark:bg-slate-950 dark:border-slate-800"><option value="date_desc">Newest</option><option value="distance_desc">Distance</option></select>
                        </div>
                        <div className="flex-1 max-h-[250px] overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                          {historyLoading ? (
                            <div className="text-center py-6 text-xs text-slate-400 font-bold">Streaming Neon Ledger Rows...</div>
                          ) : filteredHistory.length === 0 ? (
                            <div className="text-center py-8 text-xs text-slate-400 font-medium border border-dashed rounded-xl dark:border-slate-800">No workout matches found.</div>
                          ) : (
                            filteredHistory.map(item => (
                              <div key={item.id} onClick={() => handleLoadSavedActivity(item.id)} className={`p-3 rounded-xl border cursor-pointer flex justify-between items-center group text-xs font-bold dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-blue-500`}>
                                <div>
                                  <div className="flex items-center space-x-1.5 truncate"><Calendar className="w-3 h-3 text-blue-500" /><span>{item.start_time.split(' ')[0]}</span><span className="opacity-40 text-[10px] truncate max-w-[120px]">{item.location_city || 'Local Route'}</span></div>
                                  <div className="flex items-center space-x-3 text-[11px] mt-1.5"><span className="text-blue-500 font-black">{item.distance_km?.toFixed(2)} km</span><span className="text-slate-400">⏱️ {renderFormattedDuration(item.duration_s)}</span></div>
                                </div>
                                <button onClick={(e) => handleDeleteSavedRun(e, item.id)} className="p-1 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    )}
                 </div>
              </div>
           </div>
        </div>
        {authModalDialogMarkup}
      </div>
    );
  }

  const isOverlayFilterApplied = mapConfig.overlayMetric !== 'None' || activeHighlight !== null || Object.values(mapConfig.motionTypes).includes(false);

  // ---------------------------------------------------------------------------
  // MAIN APPLICATION VIEWER (DESKTOP & MOBILE SPA)
  // ---------------------------------------------------------------------------
  return (
    <div className={`flex h-screen w-full overflow-hidden font-sans select-none transition-colors duration-200 overscroll-none touch-pan-x touch-pan-y ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
      
      {/* 💻 DESKTOP DUAL CANVAS LAYOUT */}
      <div className="hidden lg:flex h-full w-full overflow-hidden flex-row">
        <div style={{ width: `${sidebarWidth}px` }} className={`flex-shrink-0 h-full overflow-y-auto p-5 shadow-sm flex flex-col space-y-6 border-r ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800' : 'bg-slate-50/50 border-slate-200'}`}>
          <header className="pb-4 border-b flex justify-between items-start flex-shrink-0 dark:border-slate-800">
            <div>
              <h1 className="text-base font-black tracking-tight flex items-center space-x-2"><img src="/logo.png" alt="Logo" className="w-5 h-5" /><span>Motion Map Analyzer</span></h1>
              <div className="flex items-center space-x-1.5 mt-2.5">
                <button onClick={exportToCSV} className="px-2 py-1 text-[10px] font-bold rounded border dark:border-slate-700 bg-transparent"><Download className="w-3 h-3 inline mr-1" />Export CSV</button>
                <button onClick={captureVisualSnapshot} className="px-2 py-1 text-[10px] font-bold rounded border dark:border-slate-700 bg-transparent"><Camera className="w-3 h-3 inline mr-1" />Share Card</button>
                {userToken && data.summary?.start_time && (data.id ? <span className="px-2 py-1 text-[10px] font-black bg-emerald-600/10 text-emerald-500 rounded border border-emerald-500/10">✓ Saved</span> : <button onClick={handleSaveCurrentRun} className="px-2 py-1 text-[10px] font-black bg-blue-600 hover:bg-blue-700 text-white rounded shadow-sm">💾 Save to Account</button>)}
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
              <div className="text-center w-full select-none pb-0.5 opacity-40 text-[9px] font-bold">
                ⚠️ Motion segmentation and metrics are computational models. Coordinates match tracking centers but may vary from localized hardware records.
              </div>
           </div>
        </div>
      </div>

      {/* 📱 PORTRAIT TOUCH-OPTIMIZED WEB SPA VIEWPORT LAYOUT */}
      <div className="flex lg:hidden h-screen w-full flex-col relative overflow-hidden bg-slate-50 dark:bg-slate-950 overscroll-none">
         
         <div className="absolute top-3 left-3 right-3 z-50 flex items-center justify-between pointer-events-none">
            <div className="p-1.5 px-2.5 bg-white/80 dark:bg-slate-900/80 text-slate-900 dark:text-slate-100 rounded-lg shadow-sm border border-slate-200/50 dark:border-slate-700/50 flex items-center space-x-2 pointer-events-auto select-none backdrop-blur-md">
               <img src="/logo.png" alt="Logo" className="w-4 h-4 flex-shrink-0" />
               <span className="text-[10px] font-black uppercase tracking-wider truncate max-w-[120px]">{data.summary?.location_city?.split(',')[0] || "Route View"}</span>
            </div>
            <div className="flex items-center space-x-1.5 pointer-events-auto">
               <button onClick={captureVisualSnapshot} title="Share Image Card" className="p-1.5 bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm text-slate-500 dark:text-slate-400 active:bg-slate-100"><Camera className="w-3.5 h-3.5" /></button>
               <button onClick={exportToCSV} title="Download CSV" className="p-1.5 bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm text-slate-500 dark:text-slate-400 active:bg-slate-100"><Download className="w-3.5 h-3.5" /></button>
               <button onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)} className="p-1.5 bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm text-slate-500 dark:text-slate-400 active:bg-slate-100">
                  {mobileDrawerOpen ? <EyeOff className="w-3.5 h-3.5 text-blue-500" /> : <Eye className="w-3.5 h-3.5" />}
               </button>
               <button onClick={handleCloseRun} className="p-1.5 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-lg shadow-sm active:bg-rose-500 active:text-white transition-colors"><X className="w-3.5 h-3.5" /></button>
            </div>
         </div>

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

         {mobileDrawerOpen && (
            <div className={`absolute left-2 right-2 z-40 transition-all duration-300 shadow-2xl border flex flex-col p-3 rounded-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 ${mobileTab === 'charts' ? 'bottom-[72px] max-h-[35vh]' : 'bottom-[72px] max-h-[50vh]'}`}>
               <div className="w-8 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-2 flex-shrink-0" />
               <div className="flex-1 overflow-y-auto min-w-0 pr-0.5 scrollbar-none">
                  {mobileTab === 'summary' && (
                     <div className="space-y-3">
                        <RunSummary summary={data.summary} metrics={data.metrics} theme={theme} />
                        <div className="border-t border-dashed dark:border-slate-800 pt-2">
                           <PerformanceStats performance={data.performance} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} theme={theme} />
                        </div>
                     </div>
                  )}
                  {mobileTab === 'map' && <div className="p-0"><MapControls config={mapConfig} setConfig={setMapConfig} segments={data.segments} trackpoints={data.trackpoints} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} theme={theme} /></div>}
                  {mobileTab === 'charts' && (
                     <div className="w-full overflow-x-auto min-w-0 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 snap-x">
                        <div className="w-[1000px] h-[25vh] min-h-[180px] snap-center pr-2">
                           <ElevationProfile trackpoints={data.trackpoints} segments={data.segments} config={mapConfig} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} setHoveredTrackpoint={setHoveredTrackpoint} theme={theme} isMobileFrame={true} />
                        </div>
                     </div>
                  )}
               </div>
            </div>
         )}

         <footer className="absolute bottom-0 left-0 right-0 h-[64px] bg-slate-950 text-white flex justify-around items-center z-50 border-t border-slate-800/80 shadow-2xl">
            <button onClick={() => { setMobileTab('summary'); setMobileDrawerOpen(true); }} className={`flex-1 h-full flex flex-col items-center justify-center space-y-0.5 text-[10px] font-black uppercase tracking-wider border-0 bg-transparent ${mobileTab === 'summary' && mobileDrawerOpen ? 'text-blue-400' : 'text-slate-500'}`}><BarChart3 className="w-4 h-4" /><span>Performance</span></button>
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