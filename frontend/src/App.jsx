import { useState, useEffect } from 'react';
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

  const [userToken, setUserToken] = useState(localStorage.getItem('motion_map_token') || null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authOTP, setAuthOTP] = useState('');
  const [authStep, setAuthStep] = useState(1); 
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false); 

  const [activeSidebarTab, setActiveSidebarTab] = useState('upload'); 
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historySortBy, setHistorySortBy] = useState('date_desc'); 
  const [stravaFeedItems, setStravaFeedItems] = useState([]);

  const [mobileTab, setMobileTab] = useState('summary'); 
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(true); 

  const [mapConfig, setMapConfig] = useState({
    baseMap: 'Standard', overlayMetric: 'None', colorScale: 'viridis',
    motionTypes: { Running: true, Walking: true, Stopped: true },
    markers: { Kilometre: true, Time: false, Direction: false },
    thickness: 'medium'
  });

  const [activeHighlight, setActiveHighlight] = useState(null);

  useEffect(() => { if (window.innerWidth < 1024) setMapConfig(prev => ({ ...prev, thickness: 'thin' })); }, []);
  useEffect(() => { setMapConfig(prev => ({ ...prev, baseMap: theme === 'dark' ? 'Dark' : 'Standard' })); }, [theme]);

  const handleLogout = (isTimeout = false) => {
    localStorage.removeItem('motion_map_token'); setUserToken(null); 
    handleCloseRun(); setHistoryItems([]); setStravaFeedItems([]); setSessionExpired(isTimeout === true);
  };

  const fetchUserHistoryList = async (tokenOverride = null) => {
    const activeToken = tokenOverride || userToken; if (!activeToken) return;
    setHistoryLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/activities`, { headers: { Authorization: `Bearer ${activeToken}` } });
      setHistoryItems(res.data.history || []); setSessionExpired(false);
    } catch (err) { if (err.response?.status === 401) handleLogout(true); } finally { setHistoryLoading(false); }
  };

  useEffect(() => {
    if (userToken) {
      fetchUserHistoryList(userToken);
      axios.get(`${API_BASE}/api/strava/latest-activities`, { headers: { Authorization: `Bearer ${userToken}` } })
        .then(res => setStravaFeedItems(res.data.activities || []))
        .catch((err) => { if (err.response?.status === 401) handleLogout(true); });
    }
  }, [userToken]);

  useEffect(() => {
    const stravaCode = new URLSearchParams(window.location.search).get("code");
    if (stravaCode) {
      setLoading(true); window.history.replaceState({}, document.title, window.location.pathname);
      axios.post(`${API_BASE}/api/auth/strava/exchange`, { code: stravaCode }, { headers: userToken ? { Authorization: `Bearer ${userToken}` } : {} })
      .then((res) => {
        if (res.data && res.data.access_token) {
          localStorage.setItem('motion_map_token', res.data.access_token); setUserToken(res.data.access_token);
          setSessionExpired(false); fetchUserHistoryList(res.data.access_token);
        }
      }).catch(() => setError("Failed to verify Strava linkage.")).finally(() => setLoading(false));
    }
  }, []);

  const handleLoadStravaActivity = async (id) => {
    if (!userToken) return; setLoading(true); setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/strava/analyze-activity/${id}`, { headers: { Authorization: `Bearer ${userToken}` } });
      setData(res.data.data);
    } catch (err) { setError("Failed to download telemetry."); if (err.response?.status === 401) handleLogout(true); } finally { setLoading(false); }
  };

  useEffect(() => {
    if (!isDraggingSplitter) return;
    const handleMouseMove = (e) => setSidebarWidth(Math.max(350, Math.min(750, e.clientX)));
    const handleMouseUp = () => setIsDraggingSplitter(false);
    document.addEventListener('mousemove', handleMouseMove); document.addEventListener('mouseup', handleMouseUp);
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
  }, [isDraggingSplitter]);

  const handleFileChange = (e) => { setFile(e.target.files[0]); setData(null); };
  const handleCloseRun = () => { setData(null); setFile(null); setError(null); setActiveHighlight(null); setHoveredTrackpoint(null); };

  const handleLoadSavedActivity = async (id) => {
    if (!userToken) return; setLoading(true); setError(null);
    try {
      const res = await axios.get(`${API_BASE}/api/activities/${id}`, { headers: { Authorization: `Bearer ${userToken}` } });
      setData({ ...res.data.data, id });
    } catch (err) { setError("Failed to stream saved profile."); if (err.response?.status === 401) handleLogout(true); } finally { setLoading(false); }
  };

  const handleSaveCurrentRun = async () => {
    if (!data || !userToken) return;
    try {
      const res = await axios.post(`${API_BASE}/api/activities`, { summary: data.summary, segments: data.segments, trackpoints: data.trackpoints, performance: data.performance || {}, metrics: data.metrics || {} }, { headers: { Authorization: `Bearer ${userToken}` } });
      if (res.data?.activity_id) setData(prev => ({ ...prev, id: res.data.activity_id })); fetchUserHistoryList(userToken);
    } catch (err) { alert("Failed to pin active workout."); if (err.response?.status === 401) handleLogout(true); }
  };

  const handleDeleteSavedRun = async (e, id) => {
    e.stopPropagation(); if (!window.confirm("Delete this log?")) return;
    try {
      await axios.delete(`${API_BASE}/api/activities/${id}`, { headers: { Authorization: `Bearer ${userToken}` } });
      setHistoryItems(prev => prev.filter(item => item.id !== id)); if (data && data.id === id) handleCloseRun();
    } catch (err) { alert("Failed to erase record."); if (err.response?.status === 401) handleLogout(true); }
  };

  const handleUpload = async (e) => {
    e.preventDefault(); if (!file) return; setLoading(true); setError(null);
    const formData = new FormData(); formData.append('file', file); formData.append('apply_privacy', applyPrivacy);
    try {
      const res = await axios.post(`${API_BASE}/api/analyze`, formData, { headers: userToken ? { Authorization: `Bearer ${userToken}` } : {} });
      setData(res.data.data);
    } catch (err) { setError(err.response?.data?.detail || "Connection error."); if (err.response?.status === 401) handleLogout(true); } finally { setLoading(false); }
  };

  const handleRequestOTP = async (e) => {
    e.preventDefault(); if (!authEmail) return; setAuthLoading(true); setAuthError(null);
    try { await axios.post(`${API_BASE}/api/auth/send-otp`, { email: authEmail }); setAuthStep(2); } catch (err) { setAuthError("Failed to trigger mailing service."); } finally { setAuthLoading(false); }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault(); if (!authOTP || authOTP.length < 6) return; setAuthLoading(true); setAuthError(null);
    try {
      const res = await axios.post(`${API_BASE}/api/auth/verify-otp`, { email: authEmail, code: authOTP });
      localStorage.setItem('motion_map_token', res.data.access_token); setUserToken(res.data.access_token);
      setAuthModalOpen(false); setSessionExpired(false); setAuthEmail(''); setAuthOTP(''); setAuthStep(1); fetchUserHistoryList(res.data.access_token);
    } catch (err) { setAuthError("Invalid authorization code."); } finally { setAuthLoading(false); }
  };

  const exportToCSV = () => {
    if (!data) return;
    let csvContent = ""; const appendHeader = (title) => { csvContent += `\n# --------------------------------------------------\n# ${title.toUpperCase()}\n# --------------------------------------------------\n`; };
    appendHeader("Run Summary Overview"); csvContent += "Metric,Value\n";
    if (data.summary) Object.entries(data.summary).forEach(([k, v]) => { if (typeof v !== 'object') csvContent += `"${k.replace(/_/g, ' ')}","${v}"\n`; });
    if (data.performance) {
      const p = data.performance; const rollingKey = Object.keys(p).find(k => k.includes("rolling") || k.includes("best"));
      if (rollingKey && p[rollingKey]?.length > 0) { appendHeader("Best Rolling Intervals Data"); const headers = Object.keys(p[rollingKey][0]); csvContent += headers.join(",") + "\n"; p[rollingKey].forEach(row => { csvContent += headers.map(h => `"${row[h] ?? '-'}"`).join(",") + "\n"; }); }
      if (p.km_splits?.length > 0) { appendHeader("Km Performance Splits"); const headers = Object.keys(p.km_splits[0]); csvContent += headers.join(",") + "\n"; p.km_splits.forEach(row => { csvContent += headers.map(h => `"${row[h] ?? '-'}"`).join(",") + "\n"; }); }
      ['hr_bands', 'cadence_bands'].forEach(zoneKey => { if (p[zoneKey]?.length > 0) { appendHeader(zoneKey.replace(/_/g, ' ')); const headers = Object.keys(p[zoneKey][0]); csvContent += headers.join(",") + "\n"; p[zoneKey].forEach(row => { csvContent += headers.map(h => `"${row[h] ?? '-'}"`).join(",") + "\n"; }); } });
    }
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); link.setAttribute("href", URL.createObjectURL(blob));
    link.setAttribute("download", `MotionMap_Export_${data.summary?.start_time?.split(' ')[0] || 'Run'}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const captureVisualSnapshot = async () => {
    if (!data) return; const originalText = document.title; document.title = "Generating Card Asset...";
    try {
      const res = await axios.post(`${API_BASE}/api/export-snapshot`, { summary: data.summary, segments: data.segments, trackpoints: data.trackpoints, performance: data.performance, config: { theme, overlayMetric: mapConfig.overlayMetric, colorScale: mapConfig.colorScale, thickness: mapConfig.thickness } }, { responseType: 'blob' });
      const downloadAnchor = document.createElement('a'); downloadAnchor.href = window.URL.createObjectURL(new Blob([res.data], { type: 'image/png' }));
      downloadAnchor.download = `MotionMap_Card_${data.summary?.start_time?.split(' ')[0] || 'Run'}.png`;
      document.body.appendChild(downloadAnchor); downloadAnchor.click(); document.body.removeChild(downloadAnchor);
    } catch (err) { alert("Failed to compile image card asset."); } finally { document.title = originalText; }
  };

  const renderAppFeatureDescriptionsGrid = () => (
    <div className="space-y-4 w-full mt-4">
      <h2 className="text-xs font-black uppercase tracking-wider flex items-center opacity-80"><Sparkles className="w-4 h-4 mr-1.5 text-blue-500" /> Quick Start & Feature Highlights</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-xs'}`}><h3 className="text-xs font-black uppercase tracking-wider text-blue-500 mb-1">📁 Multi-Format Activity Import</h3><p className="text-xs text-slate-400 leading-normal font-medium">Upload .FIT or .TCX files, or connect to Strava to access your activities.</p></div>
        <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-xs'}`}><h3 className="text-xs font-black uppercase tracking-wider text-emerald-500 mb-1">🔒 Smart Privacy Masking</h3><p className="text-xs text-slate-400 leading-normal font-medium">Keeps sensitive locations private when sharing; by clipping the start and end, 500m, of your route.</p></div>
        <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-xs'}`}><h3 className="text-xs font-black uppercase tracking-wider text-purple-500 mb-1">📊 Deep Workout Analytics</h3><p className="text-xs text-slate-400 leading-normal font-medium">Track peak rolling intervals (400m, 1K, 5K), km splits, and aerobic efficiency (EF).</p></div>
        <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-xs'}`}><h3 className="text-xs font-black uppercase tracking-wider text-amber-500 mb-1">👁️ Activity Insights Map</h3><p className="text-xs text-slate-400 leading-normal font-medium">Map your run with precision - track exactly where your heart rate peaked, cadence dropped, and pace shifted.</p></div>
      </div>
      <div className={`p-4 rounded-xl border text-xs leading-relaxed font-medium ${theme === 'dark' ? 'bg-slate-900/20 border-slate-800/60 text-slate-400' : 'bg-slate-100/60 border-slate-200 text-slate-500'}`}><span className="font-black text-slate-700 dark:text-slate-200 block mb-1">🛡️ Privacy Isolation Guard:</span> Your workouts are processed in secure, temporary memory. For saved history, emails are converted into irreversible cryptographic signatures—so your identity and location stay protected. Your email is never stored!</div>
    </div>
  );

  if (!data) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 md:p-8 relative ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
        <div className="absolute top-4 right-4 flex items-center space-x-2 z-50">
          {userToken ? <button onClick={() => handleLogout(false)} className="p-2 rounded-xl bg-red-500/10 text-red-500 border border-red-500/10"><LogOut className="w-4 h-4" /></button> : <button onClick={() => setAuthModalOpen(true)} className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-xl border flex items-center space-x-1.5 ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}><LogIn className="w-3.5 h-3.5" /> <span>Sign In</span></button>}
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="p-2 rounded-xl border dark:border-slate-800">{theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-500" />}</button>
        </div>
        <header className="flex flex-col items-center mb-6 text-center select-none flex-shrink-0"><img src="/logo.png" alt="Logo" className="w-16 h-16 mb-2 drop-shadow-md" /><h1 className="text-2xl font-black tracking-tight">Motion Map Analyzer</h1><p className="text-[10px] font-black uppercase tracking-widest opacity-40 mt-0.5">Interactive Multi-Stream Telemetry Dashboard</p></header>
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"><div className="lg:col-span-7 space-y-5">{renderAppFeatureDescriptionsGrid()}</div></div>
      </div>
    );
  }

  // FIXED #11: "overscroll-none" added to the root block prevents mobile pull-to-refresh resets
  return (
    <div className={`flex h-screen w-full overflow-hidden font-sans select-none transition-colors duration-200 overscroll-none touch-pan-x touch-pan-y ${theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>
      
      {/* 💻 DESKTOP LAYOUT (Unchanged) */}
      <div className="hidden lg:flex h-full w-full overflow-hidden flex-row">
        {/* ... desktop sidebar code ... */}
        <div className="flex-1 h-full p-4 flex flex-col space-y-4 overflow-hidden min-w-0">
           <div className="flex-1 w-full relative rounded-xl overflow-hidden shadow-xs border dark:border-slate-800">
              {data.trackpoints && <RouteMap segments={data.segments} trackpoints={data.trackpoints} config={mapConfig} splits={data.performance?.km_splits} activeHighlight={activeHighlight} hoveredTrackpoint={hoveredTrackpoint} setActiveHighlight={setActiveHighlight} theme={theme} />}
           </div>
        </div>
      </div>

      {/* 📱 MOBILE SPA LAYOUT */}
      <div className="flex lg:hidden h-screen w-full flex-col relative overflow-hidden bg-slate-50 dark:bg-slate-950 overscroll-none">
         
         {/* FIXED #7 & #10: Lighter translucent background for logo + Added Camera Export icon */}
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
            {data.trackpoints && <RouteMap segments={data.segments} trackpoints={data.trackpoints} config={mapConfig} splits={data.performance?.km_splits} activeHighlight={activeHighlight} hoveredTrackpoint={hoveredTrackpoint} setActiveHighlight={setActiveHighlight} theme={theme} isMobileFrame={true} mobileDrawerOpen={mobileDrawerOpen} mobileTab={mobileTab} />}
         </div>

         {/* FIXED #2, #3, #5: Reduced padding (p-3 instead of p-4), tightened chart dimensions */}
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
    </div>
  );
}

export default App;