import { useState, useEffect } from 'react';
import axios from 'axios';
import { UploadCloud, Info, X, Sun, Moon, Download, Camera, LogIn, LogOut, KeyRound, Calendar, MapPin, Trash2, Search, ArrowUpDown, BarChart3, Clock, Milestone } from 'lucide-react';

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

  // --- HISTORY MODE NAVIGATION CONFIGS ---
  const [activeSidebarTab, setActiveSidebarTab] = useState('upload'); 
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // --- SEARCH AND SORT STATE FILTERS ---
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historySortBy, setHistorySortBy] = useState('date_desc'); 

  // --- MOBILE SCREEN & HARDWARE SENSING CHASSIS ---
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [isDesktopModeEnabled, setIsDesktopModeEnabled] = useState(false);

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
    const userAgentCheck = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    setIsMobileDevice(userAgentCheck);
    if (userAgentCheck && window.innerWidth >= 1024) {
      setIsDesktopModeEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (!isDraggingSplitter) return;
    const handleMouseMove = (e) => {
      setSidebarWidth(Math.max(350, Math.min(750, e.clientX)));
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
      const res = await axios.post(`${API_BASE}/api/activities`, {
        summary: data.summary,
        segments: data.segments,
        trackpoints: data.trackpoints,
        performance: data.performance || {},
        metrics: data.metrics || {}
      }, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
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
      const response = await axios.post(`${API_BASE}/api/auth/verify-otp`, {
        email: authEmail,
        code: authOTP
      });
      const token = response.data.access_token;
      localStorage.setItem('motion_map_token', token);
      setUserToken(token);
      setAuthModalOpen(false);
      setAuthEmail(''); setAuthOTP(''); setAuthStep(1);
      setActiveSidebarTab('history');
    } catch (err) {
      setAuthError(err.response?.data?.detail || "Invalid or expired authorization code.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('motion_map_token');
    setUserToken(null); setActiveSidebarTab('upload'); handleCloseRun();
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

  // --- MATHS ACCUMULATORS & FILTERS LOGIC ---
  const cumulativeDistance = historyItems.reduce((acc, curr) => acc + (curr.distance_km || 0), 0);
  const cumulativeDuration = historyItems.reduce((acc, curr) => acc + (curr.duration_s || 0), 0);

  const convertPaceToSeconds = (paceStr) => {
    if (!paceStr || !paceStr.includes(':')) return 999999;
    const parts = paceStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  };

  const filteredAndSortedHistory = historyItems
    .filter(item => {
      if (!historySearchQuery) return true;
      const targetCity = (item.location_city || '').toLowerCase();
      return targetCity.includes(historySearchQuery.toLowerCase());
    })
    .sort((a, b) => {
      if (historySortBy === 'date_desc') {
        return new Date(b.start_time) - new Date(a.start_time);
      }
      if (historySortBy === 'distance_desc') {
        return (b.distance_km || 0) - (a.distance_km || 0);
      }
      if (historySortBy === 'pace_asc') {
        return convertPaceToSeconds(a.avg_pace_str) - convertPaceToSeconds(b.avg_pace_str);
      }
      return 0;
    });

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
        <header className="flex flex-col items-center mb-10 text-center flex-shrink-0">
          <h1 className="text-4xl font-black tracking-tight mb-1">👟📍📈 Motion Map Analyzer</h1>
          <p className={`text-xs font-bold uppercase tracking-widest ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>Interactive Workout Analytics Workspace</p>
        </header>

        {/* DYNAMIC RESPONSIVE MOBILE ACCESSIBILITY ALERT NOTICES */}
        {isMobileDevice && (
          <div className="w-full max-w-5xl mb-6 p-3 rounded-xl border text-center text-xs font-bold transition-all bg-amber-500/10 border-amber-500/20 text-amber-500 leading-normal">
            {isDesktopModeEnabled ? (
              <span>📺 Desktop mode detected! For the best experience mapping routes and sliding across split-pane telemetry graphs, we recommend using a full computer screen and mouse.</span>
            ) : (
              <span>📱 Using a phone browser? For the best workspace layout alignment, please switch your browser settings to <strong>"Request Desktop Site"</strong> or best open this app on a computer!</span>
            )}
          </div>
        )}
        
        {activeSidebarTab === 'history' && userToken ? (
          <div className={`p-6 rounded-2xl shadow-xl border w-full max-w-3xl flex flex-col h-[650px] transition-all ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
            {/* RENAMED HEADER TO WORKOUT HISTORY LOGS */}
            <h2 className="text-xl font-black tracking-tight mb-4 flex items-center justify-between">
              <span>🗂️ Workout History Logs</span>
              <button onClick={() => setActiveSidebarTab('upload')} className="text-xs text-blue-500 hover:underline font-bold">Upload a new file instead</button>
            </h2>

            {/* CUMULATIVE STATS ACCUMULATOR PANEL WIDGETS */}
            {historyItems.length > 0 && (
              <div className={`grid grid-cols-3 gap-4 mb-5 p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-950/60 border-slate-800/80' : 'bg-slate-50 border-slate-200 shadow-inner'}`}>
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg hidden sm:block"><Milestone className="w-5 h-5" /></div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Distance</p>
                    <p className="text-lg font-black tracking-tight text-blue-500">{cumulativeDistance.toFixed(2)} <span className="text-xs font-bold">km</span></p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-purple-500/10 text-purple-500 rounded-lg hidden sm:block"><Clock className="w-5 h-5" /></div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Duration</p>
                    <p className="text-lg font-black tracking-tight text-purple-500">{renderFormattedDuration(cumulativeDuration)}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg hidden sm:block"><BarChart3 className="w-5 h-5" /></div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Workouts</p>
                    <p className="text-lg font-black tracking-tight text-emerald-500">{historyItems.length} <span className="text-xs font-bold">saved</span></p>
                  </div>
                </div>
              </div>
            )}

            {/* SEARCH BAR FILTERS AND PERFORMANCE SORTING CONTROLS */}
            {historyItems.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <div className="flex-1 relative flex items-center">
                  <Search className="w-4 h-4 absolute left-3 text-slate-500" />
                  <input 
                    type="text" 
                    placeholder="Search by city or country location..." 
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                    className={`w-full pl-9 pr-4 py-2 rounded-xl text-xs font-bold border outline-none transition-all focus:ring-1 focus:ring-blue-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800 focus:border-blue-500' : 'bg-slate-50 border-slate-200 focus:bg-white shadow-sm'}`}
                  />
                </div>
                <div className="relative flex items-center">
                  <ArrowUpDown className="w-4 h-4 absolute left-3 text-slate-500 pointer-events-none" />
                  <select
                    value={historySortBy}
                    onChange={(e) => setHistorySortBy(e.target.value)}
                    className={`pl-9 pr-8 py-2 rounded-xl text-xs font-bold border outline-none appearance-none cursor-pointer focus:ring-1 focus:ring-blue-500 ${theme === 'dark' ? 'bg-slate-950 border-slate-800 focus:border-blue-500' : 'bg-slate-50 border-slate-200 shadow-sm'}`}
                  >
                    <option value="date_desc">Sort by: Newest Date</option>
                    <option value="distance_desc">Sort by: Longest Distance</option>
                    <option value="pace_asc">Sort by: Fastest Pace</option>
                  </select>
                </div>
              </div>
            )}

            {/* HISTORY CARDS GRID LEDGER */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {historyLoading ? (
                <div className="h-full flex items-center justify-center text-xs font-bold text-slate-400">Streaming Neon Database Logs...</div>
              ) : filteredAndSortedHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-slate-800/20 rounded-xl">
                  <p className="text-sm font-bold text-slate-400">{historyItems.length === 0 ? "No runs saved yet." : "No results match your search criteria."}</p>
                  {historyItems.length === 0 && <p className="text-xs text-slate-500 mt-1">Analyze an activity file and click "Save to Account" to populate this ledger!</p>}
                </div>
              ) : (
                filteredAndSortedHistory.map(item => (
                  <div key={item.id} onClick={() => handleLoadSavedActivity(item.id)} className={`p-4 rounded-xl border cursor-pointer flex items-center justify-between transition-all group ${theme === 'dark' ? 'bg-slate-950 border-slate-800 hover:border-blue-500 hover:bg-slate-900' : 'bg-slate-50 border-slate-200 hover:border-blue-500 hover:bg-white'}`}>
                    {/* OPTION-B COMPACTED 2-LINE ACTIVITY RENDERER LAYOUT SLOT */}
                    <div className="space-y-0.5">
                      {/* Line 1: Date Time, Location */}
                      <div className="flex items-center space-x-1.5 text-sm font-black tracking-tight text-slate-800 dark:text-slate-200">
                        <Calendar className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                        <span>{item.start_time.split(' ')[0]}</span>
                        <span className="font-medium text-xs opacity-50">{item.start_time.split(' ')[1]},</span>
                        <span className="font-bold text-xs text-slate-500 dark:text-slate-400 max-w-[280px] truncate">{item.location_city || 'Local Route'}</span>
                      </div>
                      
                      {/* Line 2: Distance Duration Avg Pace */}
                      <div className="flex items-center space-x-2 text-xs font-bold text-slate-400">
                        <span className="text-blue-500 text-sm font-black">
                          {item.distance_km ? `${item.distance_km.toFixed(2)} km` : '- km'}
                        </span>
                        <span className="flex items-center">⏱️ {renderFormattedDuration(item.duration_s)}</span>
                        <span className="text-purple-500 flex items-center">⚡ {item.avg_pace_str || '-:--'} /km</span>
                      </div>
                    </div>
                    <button onClick={(e) => handleDeleteSavedRun(e, item.id)} className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* STREAMLINED CONDENSED FEATURE BULLET GRID LAYOUT */
          <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* LEFT COLUMN: SCANNABLE CONDENSED METRIC BULLETS */}
            <div className="lg:col-span-7 space-y-5 p-2">
              <h2 className="text-xl font-black tracking-tight flex items-center mb-2">
                <span className="mr-2">⚡</span> Quick Start & Feature Highlights
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-sm'}`}>
                  <h3 className="text-xs font-black uppercase tracking-wider text-blue-500 mb-1.5">📁 Easy File Uploads</h3>
                  <ul className="text-xs text-slate-400 space-y-1 font-medium list-disc pl-4">
                    <li>Supports standard <code className="font-mono text-blue-400 text-[10px]">.fit</code> and Training Center Extension <code className="font-mono text-blue-400 text-[10px]">.tcx</code> sensor streams.</li>
                    <li>Instantly parses telemetry layouts from Garmin, Coros, Wahoo, and more.</li>
                  </ul>
                </div>

                <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-sm'}`}>
                  <h3 className="text-xs font-black uppercase tracking-wider text-emerald-500 mb-1.5">🔒 Smart Privacy Masking</h3>
                  <ul className="text-xs text-slate-400 space-y-1 font-medium list-disc pl-4">
                    <li>Automatically clips the first and last 500m of your map track coordinates.</li>
                    <li>Keeps all calculations accurate while keeping home/office locations hidden.</li>
                  </ul>
                </div>

                <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-sm'}`}>
                  <h3 className="text-xs font-black uppercase tracking-wider text-purple-500 mb-1.5">📊 Deep Workout Analytics</h3>
                  <ul className="text-xs text-slate-400 space-y-1 font-medium list-disc pl-4">
                    <li>Computes peak rolling intervals (400m, 1K, 5K) and auto kilometer splits.</li>
                    <li>Builds heart rate and cadence training zones with Aerobic Efficiency Factor (EF).</li>
                  </ul>
                </div>

                <div className={`p-4 rounded-xl border ${theme === 'dark' ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200/80 shadow-sm'}`}>
                  <h3 className="text-xs font-black uppercase tracking-wider text-amber-500 mb-1.5">👁️ Map & Elevation Sync</h3>
                  <ul className="text-xs text-slate-400 space-y-1 font-medium list-disc pl-4">
                    <li>Hover across your responsive elevation chart to drive a real-time sync map dot.</li>
                    <li>Pinpoints exactly where your heart rate peaked or your pace changed.</li>
                  </ul>
                </div>
              </div>

              <div className={`p-4 rounded-xl border text-center shadow-inner ${theme === 'dark' ? 'bg-blue-950/20 border-blue-900/30 text-blue-400' : 'bg-blue-500/5 border-blue-500/10 text-blue-600'}`}>
                <p className="text-[11px] font-bold leading-normal">🛡️ <span className="uppercase tracking-wider font-black mr-1">Privacy First:</span> Your workouts are processed entirely in your browser's temporary memory. Even if you choose to sign in to save your history, we never store or save your email address. Instead, it is instantly turned into an irreversible, anonymous cryptographic signature (SHA-256) so your identity and your routes stay completely yours!</p>
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

              {/* DEMO TRYOUT TRIGGER LINK */}
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
         <div className="w-full flex-shrink-0 flex flex-col space-y-2">
            {data.trackpoints && (
              <ElevationProfile trackpoints={data.trackpoints} segments={data.segments} config={mapConfig} activeHighlight={activeHighlight} setActiveHighlight={setActiveHighlight} setHoveredTrackpoint={setHoveredTrackpoint} theme={theme} />
            )}
            
            {/* FOOTER DATA NOTICE SUB-BAR */}
            <div className="text-center w-full select-none pointer-events-none pb-1">
              <span className={`text-[10px] font-bold tracking-normal opacity-40 transition-colors ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                ⚠️ <strong>Data Notice:</strong> Motion segmentation and metrics are estimations. Final map geometry and statistics may differ slightly from your native tracker due to GPS drift and algorithm smoothing.
              </span>
            </div>
         </div>
      </div>

    </div>
  );
}

export default App;