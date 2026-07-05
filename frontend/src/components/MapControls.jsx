import React, { useMemo, useState } from 'react';
import * as d3Chromatic from 'd3-scale-chromatic';

const COLOR_SCALES = {
  'viridis': d3Chromatic.interpolateViridis,
  'cividis': d3Chromatic.interpolateCividis,
  'turbo': d3Chromatic.interpolateTurbo,
  'warmcool': d3Chromatic.interpolateRdYlBu,
  'eclectic': d3Chromatic.interpolateSinebow
};

const METRIC_KEYS = {
  'Pace': 'pace_min_per_km',
  'Heart Rate': 'heart_rate_bpm',
  'Cadence': 'cadence'
};

const getPercentile = (data, p) => {
  if (!data || data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

const formatPaceMMSS = (decimalMins) => {
  if (decimalMins == null || isNaN(decimalMins)) return "-:--";
  let m = Math.floor(decimalMins);
  let s = Math.round((decimalMins - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatDurationHHMMSS = (totalSeconds) => {
  if (totalSeconds == null || isNaN(totalSeconds) || totalSeconds < 0) return "00:00:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export default function MapControls({ config, setConfig, segments, trackpoints, activeHighlight, setActiveHighlight, theme }) {
  const [hoveredBin, setHoveredBin] = useState(null);
  const isDark = theme === 'dark';

  if (!config) return null;

  const handleDropdown = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleCheckbox = (category, item, checked) => {
    setConfig(prev => ({
      ...prev,
      [category]: { ...prev[category], [item]: checked }
    }));
  };

  const distribution = useMemo(() => {
    if (config.overlayMetric === 'None' || !trackpoints || trackpoints.length === 0) return null;

    const metricKey = METRIC_KEYS[config.overlayMetric];
    const rawValues = [];
    let lastKnownValue = null;

    trackpoints.forEach((tp, i) => {
      const parentSeg = segments?.find(seg => tp.time >= seg.start_time && tp.time <= seg.end_time);
      const stateKey = parentSeg ? parentSeg.label.charAt(0).toUpperCase() + parentSeg.label.slice(1).toLowerCase() : "Running";
      
      let val = tp[metricKey];
      if (metricKey === 'pace_min_per_km' && (val == null || isNaN(val))) {
        val = parentSeg ? parentSeg.avg_pace_min_per_km : null;
      }
      
      if (val != null && isFinite(val) && !isNaN(val)) {
        lastKnownValue = val;
      }

      if (!config.motionTypes[stateKey]) return; 

      if (lastKnownValue != null) {
        let duration = 1;
        if (i > 0) {
          const t1 = new Date(trackpoints[i-1].time.replace(/-/g, '/')).getTime();
          const t2 = new Date(tp.time.replace(/-/g, '/')).getTime();
          const delta = (t2 - t1) / 1000;
          if (delta > 0 && delta < 30) duration = delta;
        }

        let distance = 0;
        if (i > 0) {
          const lat1 = trackpoints[i-1].latitude;
          const lon1 = trackpoints[i-1].longitude;
          const lat2 = tp.latitude;
          const lon2 = tp.longitude;
          const R = 6371; 
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLon = (lon2 - lon1) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          distance = R * c;
        }
        if (isNaN(distance) || !isFinite(distance) || distance > 0.5) distance = 0;

        rawValues.push({ value: lastKnownValue, duration, distance });
      }
    });

    if (rawValues.length === 0) return null;

    const justNumbers = rawValues.map(v => v.value);
    let rawMin = Math.min(...justNumbers);
    let rawMax = Math.max(...justNumbers);
    
    let numBins = 12;
    let bins = [];
    const isPace = metricKey === 'pace_min_per_km';

    // --- ADAPTIVE CORE BRACKETING PIPELINE ---
    if (isPace) {
      let coreMin = getPercentile(justNumbers, 0.02);
      let coreMax = getPercentile(justNumbers, 0.82);
      if (coreMin === coreMax) coreMax = coreMin + 1.0;
      
      let coreBinsCount = 11;
      let coreBinSize = (coreMax - coreMin) / coreBinsCount;

      for (let i = 0; i < coreBinsCount; i++) {
        bins.push({ min: coreMin + i * coreBinSize, max: coreMin + (i + 1) * coreBinSize, count: 0, totalDistance: 0, totalDuration: 0, isTailOverflow: false });
      }
      bins.push({ min: coreMax, max: Math.max(rawMax, coreMax + 0.01), count: 0, totalDistance: 0, totalDuration: 0, isTailOverflow: true });

      rawValues.forEach(v => {
        let placed = false;
        for (let i = 0; i < coreBinsCount; i++) {
          if (v.value >= bins[i].min && v.value < bins[i].max) {
            bins[i].count++; bins[i].totalDistance += v.distance; bins[i].totalDuration += v.duration; placed = true; break;
          }
        }
        if (!placed) { bins[11].count++; bins[11].totalDistance += v.distance; bins[11].totalDuration += v.duration; }
      });

    } else {
      let coreMin = getPercentile(justNumbers, 0.05);
      let coreMax = getPercentile(justNumbers, 0.95);
      if (coreMin === coreMax) coreMax = coreMin + 1.0;

      let binSize = (coreMax - coreMin) / numBins;
      for (let i = 0; i < numBins; i++) {
        bins.push({ min: coreMin + i * binSize, max: coreMin + (i + 1) * binSize, count: 0, totalDistance: 0, totalDuration: 0 });
      }

      rawValues.forEach(v => {
        if (v.value <= bins[0].max) { bins[0].count++; bins[0].totalDistance += v.distance; bins[0].totalDuration += v.duration; }
        else if (v.value >= bins[numBins - 1].min) { bins[numBins - 1].count++; bins[numBins - 1].totalDistance += v.distance; bins[numBins - 1].totalDuration += v.duration; }
        else {
          for (let i = 1; i < numBins - 1; i++) {
            if (v.value >= bins[i].min && v.value < bins[i].max) {
              bins[i].count++; bins[i].totalDistance += v.distance; bins[i].totalDuration += v.duration; break;
            }
          }
        }
      });
    }

    const maxCount = Math.max(...bins.map(b => b.count));
    const scaleFunc = COLOR_SCALES[config.colorScale] || COLOR_SCALES['viridis'];

    bins.forEach((bin, idx) => {
      let t = idx / (bins.length - 1);
      if (isPace || config.colorScale === 'warmcool') t = 1 - t;
      bin.color = scaleFunc(t);
    });

    return { rawMin, rawMax, min: bins[0].min, max: bins[bins.length - 1].max, bins, maxCount, metricKey, isPace };
  }, [config.overlayMetric, config.colorScale, trackpoints, segments, config.motionTypes]);

  // Mobile optimization sizing
  const precision = config.overlayMetric === 'Cadence' || config.overlayMetric === 'Heart Rate' ? 0 : 2;

  return (
    <div className={`p-3 rounded-xl border shadow-sm flex flex-col transition-colors duration-200 ${isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>
      
      {/* DROPDOWNS MATRIX */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={`block text-[9px] font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Base Map</label>
          <select value={config.baseMap} onChange={(e) => handleDropdown('baseMap', e.target.value)} className={`w-full border rounded px-1.5 py-1.5 text-[10px] font-medium outline-none transition-colors ${isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-700'}`}>
            <option value="Standard">Standard</option><option value="Topo">Topo</option><option value="Dark">Dark</option><option value="No Map">No Map</option>
          </select>
        </div>
        <div>
          <label className={`block text-[9px] font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Metric</label>
          <select value={config.overlayMetric} onChange={(e) => handleDropdown('overlayMetric', e.target.value)} className={`w-full border rounded px-1.5 py-1.5 text-[10px] font-medium outline-none transition-colors ${isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-700'}`}>
            <option value="None">None</option><option value="Pace">Pace</option><option value="Heart Rate">Heart Rate</option><option value="Cadence">Cadence</option>
          </select>
        </div>
        <div>
          <label className={`block text-[9px] font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Color</label>
          <select disabled={config.overlayMetric === 'None'} value={config.colorScale} onChange={(e) => handleDropdown('colorScale', e.target.value)} className={`w-full border rounded px-1.5 py-1.5 text-[10px] font-medium outline-none transition-colors disabled:opacity-30 ${isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-700'}`}>
            {Object.keys(COLOR_SCALES).map(scale => <option key={scale} value={scale}>{scale.charAt(0).toUpperCase() + scale.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <hr className={`my-3 ${isDark ? 'border-slate-800' : 'border-slate-100'}`} />

      {/* CHECKBOX GRIDS */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={`block text-[9px] font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Motion Types</label>
          <div className="flex flex-col space-y-2">
            {['Running', 'Walking', 'Stopped'].map(type => (
              <label key={type} className="flex items-center space-x-2 cursor-pointer select-none">
                <input type="checkbox" checked={config.motionTypes[type]} onChange={(e) => handleCheckbox('motionTypes', type, e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer w-3.5 h-3.5" /> 
                <span className="text-[10px] font-medium opacity-95">{type}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className={`block text-[9px] font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Map Annotations</label>
          <div className="flex flex-col space-y-2">
            {['Kilometre', 'Time', 'Direction'].map(type => (
              <label key={type} className="flex items-center space-x-2 cursor-pointer select-none">
                <input type="checkbox" checked={config.markers[type]} onChange={(e) => handleCheckbox('markers', type, e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer w-3.5 h-3.5" /> 
                <span className="text-[10px] font-medium opacity-95">{type}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* STROKE MULTIPLIER CONTROLLER (RESTORED & CONDENSED) */}
      <div className={`mt-3 pt-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
        <label className={`block text-[9px] font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Line Thickness</label>
        <div className={`flex p-0.5 rounded border transition-colors ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-slate-100 border-slate-200'}`}>
          {['thin', 'medium', 'thick'].map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => handleDropdown('thickness', mode)}
              className={`flex-1 py-1 text-[10px] font-bold capitalize rounded transition-all select-none ${
                (config.thickness || 'medium') === mode 
                  ? (isDark ? 'bg-slate-700 text-blue-400 shadow-sm' : 'bg-white text-blue-600 shadow-sm border border-slate-200/40') 
                  : (isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800')
              }`}
            >
              {mode === 'thin' ? 'Thin |' : mode === 'medium' ? 'Medium ||' : 'Thick |||'}
            </button>
          ))}
        </div>
      </div>

      {/* ADAPTIVE METRIC DENSITY GRAPH AREA */}
      {distribution && (
        <div className={`mt-3 pt-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
          <label className={`block text-[9px] font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {config.overlayMetric} Distribution
          </label>
          
          <div className="w-full">
            <div className={`h-12 flex items-end justify-between space-x-[1px] mb-1 p-0.5 rounded border relative transition-colors ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50/50 border-slate-100'}`}>
              {distribution.bins.map((bin, idx) => {
                const heightPct = distribution.maxCount === 0 ? 0 : (bin.count / distribution.maxCount) * 100;
                const isBarSelected = activeHighlight?.type === 'metric' && activeHighlight.metricKey === distribution.metricKey && activeHighlight.binIdx === idx;
                const isBarHovered = hoveredBin === idx;

                let binLabel = "";
                if (distribution.metricKey === 'pace_min_per_km') {
                  if (bin.isTailOverflow) binLabel = `Slower Tail: > ${formatPaceMMSS(bin.min)}`;
                  else binLabel = `${formatPaceMMSS(bin.min)} - ${formatPaceMMSS(bin.max)}`;
                } else {
                  if (idx === 0 && distribution.rawMin < distribution.min) binLabel = `< ${bin.max.toFixed(precision)}`;
                  else if (idx === distribution.bins.length - 1 && distribution.rawMax > distribution.max) binLabel = `> ${bin.min.toFixed(precision)}`;
                  else binLabel = `${bin.min.toFixed(precision)} - ${bin.max.toFixed(precision)}`;
                }

                const handleBarClick = (e) => {
                  e.stopPropagation();
                  if (isBarSelected) setActiveHighlight(null);
                  else setActiveHighlight({ type: 'metric', metricKey: distribution.metricKey, min: bin.min, max: bin.max, binIdx: idx, isFirstBin: idx === 0, isLastBin: bin.isTailOverflow || idx === distribution.bins.length - 1 });
                };

                return (
                  <div key={idx} onClick={handleBarClick} onMouseEnter={() => setHoveredBin(idx)} onMouseLeave={() => setHoveredBin(null)}
                    className={`flex-1 transition-all cursor-pointer rounded-t-sm relative ${isBarSelected ? 'opacity-100 ring-1 ring-offset-1 ring-offset-transparent ring-blue-500 z-10' : 'opacity-85 hover:opacity-100'}`}
                    style={{ height: `${Math.max(1, heightPct)}%`, backgroundColor: bin.color }}>
                    
                    {(isBarSelected || isBarHovered) && (
                      <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 p-1.5 rounded shadow-lg text-center z-50 min-w-[90px] border pointer-events-none ${isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>
                        <div className="font-bold text-[9px] mb-0.5 whitespace-nowrap">{binLabel}</div>
                        <div className={`text-[8px] flex justify-between uppercase font-bold tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                          <span>{(bin.totalDistance).toFixed(1)} km</span><span>{formatDurationHHMMSS(bin.totalDuration)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* CHRONOLOGICAL INTERVAL SEPARATED ROW MAPS */}
      {segments && segments.length > 0 && (
        <div className={`mt-3 pt-3 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
          <label className={`block text-[9px] font-bold uppercase tracking-wider mb-2 flex justify-between items-center ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            <span>Activity Intervals</span><span className="bg-slate-200 dark:bg-slate-800 px-1 rounded text-[8px]">{segments.length} segments</span>
          </label>
          
          <div className={`max-h-32 overflow-y-auto rounded-lg border scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 ${isDark ? 'border-slate-800 bg-slate-900/40' : 'border-slate-200 bg-slate-50'}`}>
            <table className="w-full text-left text-[9px]">
              <thead className={`sticky top-0 z-10 shadow-sm ${isDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
                <tr>
                  <th className="p-1 font-bold uppercase text-slate-500">Mode</th>
                  <th className="p-1 font-bold uppercase text-slate-500">Dist</th>
                  <th className="p-1 font-bold uppercase text-slate-500">Pace</th>
                  <th className="p-1 font-bold uppercase text-slate-500">Time</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((seg, i) => {
                  // RESTORED 7.1 PAYLOAD: Added type: 'time' back so RouteMap correctly interprets it
                  const isSegSelected = activeHighlight?.type === 'time' && activeHighlight.start === seg.start_time && activeHighlight.end === seg.end_time;
                  
                  return (
                    <tr 
                      key={i} 
                      onClick={() => setActiveHighlight(isSegSelected ? null : { type: 'time', id: `seg-${i}`, start: seg.start_time, end: seg.end_time })}
                      onMouseEnter={() => setActiveHighlight({ type: 'time', id: `seg-${i}`, start: seg.start_time, end: seg.end_time })}
                      onMouseLeave={() => setActiveHighlight(null)}
                      className={`border-b last:border-b-0 cursor-pointer transition-colors ${
                        isSegSelected 
                          ? (isDark ? 'bg-blue-950 border-blue-500' : 'bg-blue-50 border-blue-400') 
                          : (isDark ? 'border-slate-800 hover:bg-slate-800' : 'border-slate-200 hover:bg-blue-50')
                      }`}
                    >
                      <td className="p-1.5 text-[10px]">{seg.label === 'running' ? '👟' : seg.label === 'walking' ? '🚶' : '🛑'}</td>
                      <td className="p-1.5 font-medium">{(seg.distance_m / 1000).toFixed(2)}km</td>
                      <td className="p-1.5 font-medium text-blue-500">{seg.avg_pace_min_per_km ? `${Math.floor(seg.avg_pace_min_per_km)}:${Math.round((seg.avg_pace_min_per_km % 1) * 60).toString().padStart(2, '0')}` : '-:--'}</td>
                      <td className="p-1.5 font-medium text-slate-500">{seg.start_time ? seg.start_time.split(' ')[1] : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PRIVACY PROTECTION FOOTER */}
      <div className={`mt-3 pt-2 border-t text-[9px] flex items-start space-x-1.5 leading-normal p-2 rounded border ${isDark ? 'bg-slate-950/40 border-slate-800 text-slate-500' : 'bg-slate-50/50 border-slate-100 text-slate-400'}`}>
        <span className="mt-0.5">🔒</span>
        <p><strong>Local Session Privacy Guarantee:</strong> All trackpoint decryption, metric percentiles, and route maps are processed locally inside your browser cache. No geolocation data enters cloud storage unless explicitly triggered via Save Route.</p>
      </div>

    </div>
  );
}