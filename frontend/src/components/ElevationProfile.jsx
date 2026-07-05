import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceArea } from 'recharts';

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

const formatElapsedHHMMSS = (totalSeconds) => {
  if (totalSeconds == null || isNaN(totalSeconds) || totalSeconds < 0) return "00:00:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export default function ElevationProfile({ trackpoints, segments, config, activeHighlight, setActiveHighlight, setHoveredTrackpoint, theme }) {
  const [metricStates, setMetricStates] = useState({ Pace: 'on', HR: 'on', Cadence: 'on' });
  const [refAreaLeft, setRefAreaLeft] = useState('');
  const [refAreaRight, setRefAreaRight] = useState('');
  const isDark = theme === 'dark';

  if (!trackpoints || trackpoints.length === 0 || !config) return null;

  const { chartData, elevBounds } = useMemo(() => {
    let accumulatedDistance = 0;
    let lastKnown = { pace_min_per_km: null, heart_rate_bpm: null, cadence: null };
    const startTime = trackpoints[0]?.time ? new Date(trackpoints[0].time.replace(/-/g, '/')).getTime() : 0;

    const rawElevations = [];
    const rawHrs = [];
    const rawCadences = [];
    const rawPaces = [];

    trackpoints.forEach(tp => {
      const parentSeg = segments?.find(seg => tp.time >= seg.start_time && tp.time <= seg.end_time);
      const stateKey = parentSeg ? parentSeg.label.charAt(0).toUpperCase() + parentSeg.label.slice(1).toLowerCase() : "Running";
      if (config.motionTypes && !config.motionTypes[stateKey]) return;

      if (tp.altitude_m != null) rawElevations.push(tp.altitude_m);
      
      let hr = tp.heart_rate_bpm ?? tp.heart_rate ?? tp.hr;
      if (hr != null) rawHrs.push(hr);

      let cad = tp.cadence ?? tp.cadence_spm ?? tp.stride_cadence;
      if (cad != null) rawCadences.push(cad);

      let pace = tp.pace_min_per_km == null && parentSeg ? parentSeg.avg_pace_min_per_km : tp.pace_min_per_km;
      if (pace != null) rawPaces.push(pace);
    });

    let elevMin = rawElevations.length > 0 ? Math.min(...rawElevations) : 0;
    let elevMax = rawElevations.length > 0 ? Math.max(...rawElevations) : 100;
    elevMin = Math.max(0, elevMin - 5);
    elevMax = elevMax + 5;
    if (elevMin >= elevMax) elevMax = elevMin + 10;

    let hrMin = rawHrs.length > 0 ? Math.max(getPercentile(rawHrs, 0.05), 90) : 90;
    let hrMax = rawHrs.length > 0 ? Math.min(getPercentile(rawHrs, 1.0), 200) : 200;
    if (hrMin >= hrMax) hrMax = hrMin + 50;

    let cadMin = rawCadences.length > 0 ? Math.max(getPercentile(rawCadences, 0.05), 100) : 100;
    let cadMax = rawCadences.length > 0 ? getPercentile(rawCadences, 0.95) : 180;
    if (cadMin >= cadMax) cadMax = cadMin + 40;

    let paceMin = rawPaces.length > 0 ? getPercentile(rawPaces, 0.05) : 4.0;
    let paceMax = rawPaces.length > 0 ? Math.min(getPercentile(rawPaces, 0.95), 12.0) : 12.0;
    if (paceMin >= paceMax) paceMax = paceMin + 4.0;

    const dataPoints = [];
    
    trackpoints.forEach((tp, idx) => {
      const parentSeg = segments?.find(seg => tp.time >= seg.start_time && tp.time <= seg.end_time);
      
      if (idx > 0) {
        const lat1 = trackpoints[idx - 1].latitude;
        const lon1 = trackpoints[idx - 1].longitude;
        const lat2 = tp.latitude;
        const lon2 = tp.longitude;
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
        const distDelta = R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
        if (!isNaN(distDelta) && isFinite(distDelta) && distDelta < 0.4) {
          accumulatedDistance += distDelta;
        }
      }

      const stateKey = parentSeg ? parentSeg.label.charAt(0).toUpperCase() + parentSeg.label.slice(1).toLowerCase() : "Running";
      if (config.motionTypes && !config.motionTypes[stateKey]) return;

      let elev = tp.altitude_m ?? (rawElevations.length > 0 ? rawElevations[0] : 0);
      let hr = tp.heart_rate_bpm ?? tp.heart_rate ?? tp.hr ?? lastKnown.heart_rate_bpm;
      let cad = tp.cadence ?? tp.cadence_spm ?? tp.stride_cadence ?? lastKnown.cadence;
      let pace = tp.pace_min_per_km ?? (parentSeg ? parentSeg.avg_pace_min_per_km : lastKnown.pace_min_per_km);

      if (hr != null) lastKnown.heart_rate_bpm = hr;
      if (cad != null) lastKnown.cadence = cad;
      if (pace != null) lastKnown.pace_min_per_km = pace;

      const normHr = rawHrs.length > 0 && hr != null ? Math.max(0, Math.min(1, (hr - hrMin) / (hrMax - hrMin))) : 0.5;
      const normCad = rawCadences.length > 0 && cad != null ? Math.max(0, Math.min(1, (cad - cadMin) / (cadMax - cadMin))) : 0.5;
      const normPace = rawPaces.length > 0 && pace != null ? Math.max(0, Math.min(1, (paceMax - pace) / (paceMax - paceMin))) : 0.5;
      const normElev = ((elev - elevMin) / (elevMax - elevMin || 1)) * 35;

      let elapsedSeconds = 0;
      if (startTime && tp.time) {
        elapsedSeconds = Math.max(0, Math.floor((new Date(tp.time.replace(/-/g, '/')).getTime() - startTime) / 1000));
      }

      dataPoints.push({
        distance: parseFloat(accumulatedDistance.toFixed(3)),
        elevation: elev,
        heartRate: hr,
        cadence: cad,
        pace: pace,
        normElev: normElev,
        normHR: normHr * 100,      
        normCadence: normCad * 100,
        normPace: normPace * 100,
        elapsedTimeStr: formatElapsedHHMMSS(elapsedSeconds),
        rawPoint: tp,
        motionState: stateKey
      });
    });

    return { chartData: dataPoints, elevBounds: { min: elevMin, max: elevMax } };
  }, [trackpoints, segments, config.motionTypes]);

  // CRITICAL HOOK FIX: Shifted from JSX block expression to top-level function context
  const motionBlocks = useMemo(() => {
    if (chartData.length === 0) return null;
    const blocks = [];
    let currentType = chartData[0].motionState;
    let startDist = chartData[0].distance;

    for (let i = 1; i < chartData.length; i++) {
      if (chartData[i].motionState !== currentType || i === chartData.length - 1) {
        const endDist = chartData[i].distance;
        const totalSpan = chartData[chartData.length - 1].distance || 1;
        const pctWidth = ((endDist - startDist) / totalSpan) * 100;

        let color = '#3b82f6'; 
        if (currentType === 'Walking') color = '#f97316'; 
        if (currentType === 'Stopped') color = '#ef4444'; 

        blocks.push(
          <div key={i} style={{ width: `${pctWidth}%`, backgroundColor: color }} className="h-full relative group">
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-slate-950 text-white text-[9px] px-1.5 py-0.5 rounded shadow-md pointer-events-none whitespace-nowrap z-50">
              {currentType}
            </div>
          </div>
        );
        startDist = endDist;
        currentType = chartData[i].motionState;
      }
    }
    return blocks;
  }, [chartData]);

  const cycleMetricState = (metricKey) => {
    setMetricStates(prev => {
      let nextState = prev[metricKey] === 'on' ? 'front' : prev[metricKey] === 'front' ? 'off' : 'on';
      const updated = { ...prev, [metricKey]: nextState };
      if (nextState === 'front') {
        Object.keys(updated).forEach(k => { if (k !== metricKey && updated[k] === 'front') updated[k] = 'on'; });
      }
      return updated;
    });
  };

  const handleChartMouseMove = (e) => {
    if (e && e.activeTooltipIndex !== undefined && chartData[e.activeTooltipIndex]) {
      const activeRecord = chartData[e.activeTooltipIndex];
      setHoveredTrackpoint(activeRecord.rawPoint);
      // TYPO RECOVERY FIX: Safely bind pointer updates to valid object keys instead of undefined 'r'
      if (refAreaLeft) setRefAreaRight(activeRecord.distance);
    }
  };

  const handleChartMouseDown = (e) => {
    if (e && e.activeTooltipIndex !== undefined && chartData[e.activeTooltipIndex]) {
      setRefAreaLeft(chartData[e.activeTooltipIndex].distance);
    }
  };

  const handleChartMouseLeave = () => {
    setHoveredTrackpoint(null);
    setRefAreaLeft('');
    setRefAreaRight('');
  };

  const handleChartMouseUp = () => {
    if (!refAreaLeft || !refAreaRight || refAreaLeft === refAreaRight) {
      if (activeHighlight) setActiveHighlight(null);
      setRefAreaLeft('');
      setRefAreaRight('');
      return;
    }
    const s = chartData.find(d => d.distance >= Math.min(refAreaLeft, refAreaRight));
    const e = [...chartData].reverse().find(d => d.distance <= Math.max(refAreaLeft, refAreaRight));
    if (s && e) {
      setActiveHighlight({
        type: 'time',
        id: `brush-${refAreaLeft}-${refAreaRight}`,
        start: s.rawPoint.time,
        end: e.rawPoint.time
      });
    }
    setRefAreaLeft('');
    setRefAreaRight('');
  };

  const sortedMetricsToRender = useMemo(() => {
    return [
      { id: 'Pace', dataKey: 'normPace', stroke: '#3b82f6', fill: '#3b82f6' },
      { id: 'HR', dataKey: 'normHR', stroke: '#ef4444', fill: '#ef4444' },
      { id: 'Cadence', dataKey: 'normCadence', stroke: '#a855f7', fill: '#a855f7' }
    ]
    .filter(m => metricStates[m.id] !== 'off')
    .sort((a, b) => (metricStates[a.id] === 'front' ? 1 : metricStates[b.id] === 'front' ? -1 : 0));
  }, [metricStates]);

  const getButtonClassName = (key, baseColor) => {
    const s = metricStates[key];
    const base = "px-2.5 py-0.5 rounded-full border text-[10px] font-bold uppercase transition-all shadow-sm select-none flex items-center space-x-1 ";
    if (s === 'off') return base + (isDark ? "bg-slate-800 border-slate-700 text-slate-500" : "bg-slate-100 border-slate-200 text-slate-400");
    if (s === 'on') {
      if (baseColor === 'blue') return base + "bg-blue-500/10 border-blue-500/30 text-blue-400";
      if (baseColor === 'red') return base + "bg-red-500/10 border-red-500/30 text-red-400";
      return base + "bg-purple-500/10 border-purple-500/30 text-purple-400";
    }
    if (baseColor === 'blue') return base + "bg-blue-600 border-blue-700 text-white";
    if (baseColor === 'red') return base + "bg-red-600 border-red-700 text-white";
    return base + "bg-purple-600 border-purple-700 text-white";
  };

  return (
    <div className={`p-5 rounded-xl border shadow-sm mt-2 flex flex-col select-none min-w-0 transition-colors duration-200 ${isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>


      <div className="flex space-x-2 mb-4">
        {['Pace', 'HR', 'Cadence'].map(k => (
          <button key={k} onClick={() => cycleMetricState(k)} className={getButtonClassName(k, k === 'Pace' ? 'blue' : k === 'HR' ? 'red' : 'purple')}>
            <span>{k === 'HR' ? '❤️ HR' : k === 'Pace' ? '⏱️ Pace' : '▰ Cadence'}</span>
            <span className="text-[9px] opacity-70 bg-black/10 px-1 rounded ml-1">{metricStates[k]}</span>
          </button>
        ))}
      </div>

      <div className="w-full text-[10px] min-w-0" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height={200} minWidth={0}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -30, bottom: 0 }}
            onMouseDown={handleChartMouseDown} onMouseMove={handleChartMouseMove} onMouseUp={handleChartMouseUp} onMouseLeave={handleChartMouseLeave}>
            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#f1f5f9"} vertical={false} />
            <XAxis dataKey="distance" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => `${v.toFixed(1)} km`} stroke={isDark ? "#475569" : "#94a3b8"} />
            <YAxis domain={[0, 100]} tick={false} axisLine={false} />
            
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const data = payload[0].payload;
              return (
                <div className="bg-slate-950 border border-slate-800 text-white px-3 py-2 rounded-lg shadow-xl text-[11px] min-w-[140px]">
                  <div className="font-bold border-b border-slate-800 pb-0.5 mb-1.5 flex justify-between text-blue-400">
                    <span>📍 {data.distance.toFixed(2)} km</span>
                    <span className="text-slate-500 font-normal text-[10px]">{data.elapsedTimeStr}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 text-slate-400">
                    <span>Pace:</span><span className="text-white text-right font-bold">{formatPaceMMSS(data.pace)}</span>
                    <span>HR:</span><span className="text-white text-right font-bold">{data.heartRate ? `${Math.round(data.heartRate)} bpm` : '-'}</span>
                    <span>Cadence:</span><span className="text-white text-right font-bold">{data.cadence ? `${Math.round(data.cadence)} spm` : '-'}</span>
                    <span>Elev:</span><span className="text-white text-right font-bold">{data.elevation.toFixed(1)} m</span>
                  </div>
                </div>
              );
            }} />

            <Area type="monotone" dataKey="normElev" stroke={isDark ? "#334155" : "#cbd5e1"} fill={isDark ? "#1e293b" : "#f1f5f9"} fillOpacity={isDark ? 0.35 : 1.0} strokeWidth={1.5} activeDot={false} isAnimationActive={false} />

            {sortedMetricsToRender.map(metric => {
              const isFront = metricStates[metric.id] === 'front';
              return (
                <Area
                  key={metric.id}
                  type="monotone"
                  dataKey={metric.dataKey}
                  stroke={metric.stroke}
                  strokeWidth={isFront ? 2.5 : 1.5}
                  fill={metric.fill}
                  fillOpacity={isFront ? 0.35 : 0.12}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              );
            })}

            {refAreaLeft && refAreaRight ? (
              <ReferenceArea x1={refAreaLeft} x2={refAreaRight} fill="#3b82f6" fillOpacity={0.15} />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className={`h-1.5 w-full mt-3 flex rounded-full overflow-hidden border ${isDark ? 'border-slate-950 bg-slate-950' : 'border-slate-100 bg-slate-100'}`}>
        {motionBlocks}
      </div>
      <div className={`flex justify-between items-center border-b pb-2 mb-2 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
        <div className={`text-[11px] font-semibold px-2 py-1 rounded border ${isDark ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
          ⛰️ Base: {elevBounds.min.toFixed(0)}m | Peak: {elevBounds.max.toFixed(0)}m
        </div>
      </div>
    </div>
  );
}