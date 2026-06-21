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
        bins.push({
          min: coreMin + i * coreBinSize,
          max: coreMin + (i + 1) * coreBinSize,
          count: 0,
          totalDistance: 0,
          totalDuration: 0,
          isTailOverflow: false
        });
      }
      bins.push({
        min: coreMax,
        max: Math.max(rawMax, coreMax + 0.01),
        count: 0,
        totalDistance: 0,
        totalDuration: 0,
        isTailOverflow: true
      });
    } else {
      let min = getPercentile(justNumbers, 0.05);
      let max = getPercentile(justNumbers, 0.95);
      if (metricKey === 'cadence') min = Math.max(min, 100);
      if (metricKey === 'heart_rate_bpm') {
        min = Math.max(min, 90);
        max = Math.min(getPercentile(justNumbers, 1.0), 200);
      }
      if (min === max) max = min + 1;

      let binSize = (max - min) / numBins;
      for (let i = 0; i < numBins; i++) {
        bins.push({
          min: min + i * binSize,
          max: min + (i + 1) * binSize,
          count: 0,
          totalDistance: 0,
          totalDuration: 0,
          isTailOverflow: false
        });
      }
    }

    rawValues.forEach(item => {
      let binIdx = 0;
      if (isPace) {
        if (item.value >= bins[11].min) {
          binIdx = 11; 
        } else {
          let coreMin = bins[0].min;
          let coreMax = bins[11].min;
          let coreBinSize = (coreMax - coreMin) / 11;
          binIdx = Math.floor((item.value - coreMin) / coreBinSize);
          if (binIdx > 10) binIdx = 10;
          if (binIdx < 0) binIdx = 0;
        }
      } else {
        let coreMin = bins[0].min;
        let coreMax = bins[numBins - 1].max;
        let clampedVal = Math.max(coreMin, Math.min(coreMax - 0.0001, item.value));
        let baseBinSize = (coreMax - coreMin) / numBins;
        binIdx = Math.floor((clampedVal - coreMin) / baseBinSize);
        if (binIdx >= numBins) binIdx = numBins - 1;
        if (binIdx < 0) binIdx = 0;
      }
      
      bins[binIdx].count++;
      bins[binIdx].totalDistance += item.distance;
      bins[binIdx].totalDuration += item.duration;
    });

    const maxCount = Math.max(...bins.map(b => b.count));
    const interpolator = COLOR_SCALES[config.colorScale] || COLOR_SCALES['viridis'];
    const stops = Array.from({ length: 11 }, (_, i) => {
      let t = i / 10;
      if (metricKey === 'pace_min_per_km' || config.colorScale === 'warmcool') t = 1 - t; 
      return interpolator(t);
    });
    
    return { bins, maxCount, min: bins[0].min, max: bins[11].min, rawMin, rawMax, gradient: `linear-gradient(to right, ${stops.join(', ')})`, metricKey };
  }, [config.overlayMetric, config.colorScale, config.motionTypes, segments, trackpoints]);

  const isIntegerMetric = distribution?.metricKey === 'heart_rate_bpm' || distribution?.metricKey === 'cadence';
  const precision = isIntegerMetric ? 0 : 1;

  return (
    <div className={`p-5 rounded-xl border shadow-sm flex flex-col transition-colors duration-200 ${isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>
      <h3 className="text-base font-bold mb-2 border-b pb-2">Motion Map</h3>
      <p className={`text-xs mb-5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        Explore motion-type segments, switch overlay metrics, and toggle map annotations.
      </p>

      <div className="space-y-5 text-sm flex-1">
        
        {/* DROPDOWNS MATRIX */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Base Map</label>
            <select value={config.baseMap} onChange={(e) => handleDropdown('baseMap', e.target.value)}
              className={`w-full border rounded px-2 py-1 text-xs font-medium outline-none transition-colors ${isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-700'}`}>
              <option value="Standard">Standard</option>
              <option value="Topo">Topo</option>
              <option value="Dark">Dark</option>
              <option value="No Map">No Map</option>
            </select>
          </div>
          <div>
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Overlay</label>
            <select value={config.overlayMetric} onChange={(e) => handleDropdown('overlayMetric', e.target.value)}
              className={`w-full border rounded px-2 py-1 text-xs font-medium outline-none transition-colors ${isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-700'}`}>
              <option value="None">None</option>
              <option value="Pace">Pace</option>
              <option value="Heart Rate">Heart Rate</option>
              <option value="Cadence">Cadence</option>
            </select>
          </div>
          <div>
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Color Scale</label>
            <select value={config.colorScale} onChange={(e) => handleDropdown('colorScale', e.target.value)} disabled={config.overlayMetric === 'None'}
              className={`w-full border rounded px-2 py-1 text-xs font-medium outline-none transition-colors disabled:opacity-40 ${isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-700'}`}>
              <option value="viridis">Viridis</option>
              <option value="turbo">Turbo</option>
              <option value="warmcool">Warm-Cool</option>
              <option value="cividis">Cividis</option>
              <option value="eclectic">Eclectic</option>
            </select>
          </div>
        </div>

        <hr className={isDark ? 'border-slate-800' : 'border-slate-100'} />

        {/* PARAM CHECKBOXES */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={`block text-xs font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Motion Types</label>
            <div className="space-y-1 font-medium text-xs">
              {['Running', 'Walking', 'Stopped'].map(type => (
                <label key={type} className="flex items-center space-x-2 cursor-pointer select-none">
                  <input type="checkbox" checked={config.motionTypes[type]} onChange={(e) => handleCheckbox('motionTypes', type, e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer w-4 h-4" /> 
                  <span className="opacity-95">{type}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className={`block text-xs font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Markers</label>
            <div className="space-y-1 font-medium text-xs">
              {['Kilometre', 'Time', 'Direction'].map(type => (
                <label key={type} className="flex items-center space-x-2 cursor-pointer select-none">
                  <input type="checkbox" checked={config.markers[type]} onChange={(e) => handleCheckbox('markers', type, e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer w-4 h-4" /> 
                  <span className="opacity-95">{type}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <hr className={isDark ? 'border-slate-800' : 'border-slate-100'} />

        {/* STROKE MULTIPLIER CONTROLLER */}
        <div>
          <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Line Thickness</label>
          <div className={`flex p-1 rounded-lg border transition-colors ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'}`}>
            {['thin', 'medium', 'thick'].map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => handleDropdown('thickness', mode)}
                className={`flex-1 py-1 text-xs font-bold capitalize rounded transition-all select-none ${
                  (config.thickness || 'medium') === mode 
                    ? (isDark ? 'bg-slate-700 text-blue-400 shadow-md' : 'bg-white text-blue-600 shadow-sm border border-slate-200/40') 
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
          <div className={`mt-6 pt-4 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
            <label className={`block text-xs font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              {config.overlayMetric} Distribution
            </label>
            
            <div className="w-full">
              <div className={`h-16 flex items-end justify-between space-x-[2px] mb-1 p-1 rounded border relative transition-colors ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50/50 border-slate-100'}`}>
                {distribution.bins.map((bin, idx) => {
                  const heightPct = distribution.maxCount === 0 ? 0 : (bin.count / distribution.maxCount) * 100;
                  const isBarSelected = activeHighlight?.type === 'metric' && activeHighlight.metricKey === distribution.metricKey && activeHighlight.binIdx === idx;
                  const isBarHovered = hoveredBin === idx;

                  let binLabel = "";
                  if (distribution.metricKey === 'pace_min_per_km') {
                    if (bin.isTailOverflow) {
                      binLabel = `Slower Tail: > ${formatPaceMMSS(bin.min)}`;
                    } else {
                      binLabel = `${formatPaceMMSS(bin.min)} - ${formatPaceMMSS(bin.max)}`;
                    }
                  } else {
                    if (idx === 0 && distribution.rawMin < distribution.min) binLabel = `< ${bin.max.toFixed(precision)}`;
                    else if (idx === distribution.bins.length - 1 && distribution.rawMax > distribution.max) binLabel = `> ${bin.min.toFixed(precision)}`;
                    else binLabel = `${bin.min.toFixed(precision)} - ${bin.max.toFixed(precision)}`;
                  }

                  const handleBarClick = (e) => {
                    e.stopPropagation();
                    if (isBarSelected) {
                      setActiveHighlight(null);
                    } else {
                      setActiveHighlight({
                        type: 'metric',
                        metricKey: distribution.metricKey,
                        min: bin.min,
                        max: bin.max,
                        binIdx: idx,
                        isFirstBin: idx === 0,
                        isLastBin: bin.isTailOverflow || idx === distribution.bins.length - 1
                      });
                    }
                  };

                  return (
                    <div key={idx} 
                      onClick={handleBarClick}
                      onMouseEnter={() => setHoveredBin(idx)}
                      onMouseLeave={() => setHoveredBin(null)}
                      className={`flex-1 transition-all cursor-pointer rounded-t-sm relative ${
                        isBarSelected 
                          ? 'bg-slate-400 ring-1 ring-blue-500 z-20' 
                          : (isDark ? 'bg-slate-700 hover:bg-slate-500' : 'bg-slate-300 hover:bg-slate-500')
                      }`}
                      style={{ height: `${Math.max(heightPct, 4)}%` }}
                    >
                      {isBarHovered && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-[100] bg-slate-950 border border-slate-800 text-white text-[10px] py-1.5 px-2.5 rounded whitespace-nowrap pointer-events-none shadow-xl text-center leading-normal animate-in fade-in duration-150">
                          <div className="font-bold border-b border-slate-800 pb-0.5 mb-1 text-blue-400">{binLabel}</div>
                          <div className="text-slate-400 flex flex-col items-center">
                            <span>Dist: {bin.totalDistance.toFixed(2)} km</span>
                            <span>Time: {formatDurationHHMMSS(bin.totalDuration)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="h-2 w-full rounded-full" style={{ background: distribution.gradient }} />
              <div className="flex justify-between text-[10px] font-semibold mt-1 px-1 text-slate-500">
                <span>{distribution.metricKey === 'pace_min_per_km' ? formatPaceMMSS(distribution.min) : (distribution.rawMin < distribution.min ? `< ${distribution.min.toFixed(0)}` : distribution.min.toFixed(precision))}</span>
                <span>{distribution.metricKey === 'pace_min_per_km' ? `Tail: > ${formatPaceMMSS(distribution.max)}` : (distribution.rawMax > distribution.max ? `> ${distribution.max.toFixed(0)}` : distribution.max.toFixed(precision))}</span>
              </div>
            </div>
          </div>
        )}

        {/* CHRONOLOGICAL INTERVAL SEPRATED ROW MAPS */}
        {segments && segments.length > 0 && (
          <div className={`mt-6 pt-4 border-t ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
            <label className={`block text-xs font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Activity Intervals ({segments.length})
            </label>
            <div className="max-h-40 overflow-y-auto space-y-2 pr-1 scrollbar-none">
              {segments.map((seg, idx) => {
                const stateLabel = seg.label.charAt(0).toUpperCase() + seg.label.slice(1).toLowerCase();
                const isSegSelected = activeHighlight?.type === 'time' && activeHighlight.id === `seg-${idx}`;

                const distKm = ((seg.distance_m || 0) / 1000).toFixed(2);
                const durationStr = `${Math.floor(seg.duration_s / 60)}m ${seg.duration_s % 60}s`;
                const pMin = Math.floor(seg.avg_pace_min_per_km);
                const pSec = Math.round((seg.avg_pace_min_per_km - pMin) * 60);
                const paceStr = pSec === 60 ? `${pMin + 1}:00` : `${pMin}:${pSec.toString().padStart(2, '0')}`;

                const handleSegClick = () => {
                  if (isSegSelected) setActiveHighlight(null);
                  else setActiveHighlight({ type: 'time', id: `seg-${idx}`, start: seg.start_time, end: seg.end_time });
                };

                return (
                  <div key={idx} onClick={handleSegClick}
                    className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all flex flex-col space-y-1.5 ${
                      isSegSelected 
                        ? (isDark ? 'bg-blue-950/40 border-blue-500 text-blue-300 font-bold shadow-md ring-1 ring-blue-500/20' : 'bg-blue-50 border-blue-400 font-bold text-blue-900 shadow-sm ring-1 ring-blue-400/30') 
                        : (isDark ? 'bg-slate-900/60 hover:bg-slate-800 border-slate-800 text-slate-300' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700')
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="flex items-center space-x-1.5 font-bold uppercase tracking-wide text-[10px]">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: seg.color || '#3b82f6' }} />
                        <span>{stateLabel}</span>
                      </span>
                      <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>{seg.start_time.split(' ')[1]} - {seg.end_time.split(' ')[1]}</span>
                    </div>
                    <div className={`grid grid-cols-4 gap-1 text-center font-medium ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                      <div><div className="text-[9px] text-slate-500 font-normal uppercase">Dist</div><div>{distKm} km</div></div>
                      <div><div className="text-[9px] text-slate-500 font-normal uppercase">Time</div><div>{durationStr}</div></div>
                      <div><div className="text-[9px] text-slate-500 font-normal uppercase">Pace</div><div>{paceStr} /km</div></div>
                      <div><div className="text-[9px] text-slate-500 font-normal uppercase">Avg HR</div><div>{seg.avg_hr_bpm ? Math.round(seg.avg_hr_bpm) : '-'}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PRIVACY PROTECTION FOOTER */}
        <div className={`mt-4 pt-3 border-t text-[10px] flex items-start space-x-1.5 leading-normal p-2 rounded border ${isDark ? 'bg-slate-950/40 border-slate-800 text-slate-500' : 'bg-slate-50/50 border-slate-100 text-slate-400'}`}>
          <span className="mt-0.5">🔒</span>
          <p><strong>Local Session Privacy Guarantee:</strong> All trackpoint decryption, metric percentiles, and route maps are processed locally inside your browser cache. No geolocation data or biological heart-rate metrics are transmitted to external networks.</p>
        </div>

      </div>
    </div>
  );
}