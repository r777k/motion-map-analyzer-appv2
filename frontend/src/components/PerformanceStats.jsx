import React from 'react';

const friendlyHeaders = {
  "split": "Split",
  "pace_min_per_km": "Pace",
  "avg_pace_min_per_km": "Avg Pace",
  "avg_hr_bpm": "Avg HR",
  "avg_cadence_spm": "Avg Cadence",
  "max_pace_min_per_km": "Max Pace",
  "max_hr_bpm": "Max HR",
  "max_cadence_spm": "Max Cadence",
  "time_in_zone_s": "Time",
  "start_time": "Start Time",
  "end_time": "End Time",
  "distance_in_zone_m": "Distance",
  "distance_m": "Distance",
  "time_s": "Time",
  "heart_rate_bpm": "HR",
  "cadence": "Cadence",
  "altitude_m": "Altitude",
  "ef": "EF",
  "band": "Band",
  "min_val":"Minimum",
  "max_val":"Maximum",
  "index": "Index",
  "duration_s": "Duration",
  "window_m": "Window",
  "window": "Window"
};

const formatTimeHHMMSS = (secs) => {
  if (secs == null || isNaN(secs)) return "-";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const formatPace = (decimalMins) => {
  if (decimalMins == null || isNaN(decimalMins)) return "-:--";
  const mins = Math.floor(decimalMins);
  const secs = Math.round((decimalMins - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')} /km`;
};

const extractTimeOnly = (dtStr) => {
  if (!dtStr) return "-";
  const parts = dtStr.split(" ");
  return parts.length > 1 ? parts[1] : dtStr;
};

const formatWindowDistance = (val) => {
  const num = parseInt(val, 10);
  if (isNaN(num)) return val;
  if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${num}m`;
};

export default function PerformanceStats({ performance, activeHighlight, setActiveHighlight, theme }) {
  if (!performance || Object.keys(performance).length === 0) return null;
  const isDark = theme === 'dark';

  return (
    <div className={`mt-2 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
      <h2 className="text-sm font-black uppercase tracking-wider mb-4 flex items-center space-x-2">
        <span className="text-blue-500">📊</span>
        <span>Splits & Zones</span>
      </h2>
      <div className="space-y-6">
        {Object.entries(performance).map(([title, tableData]) => {
          if (!Array.isArray(tableData) || tableData.length === 0) return null;

          let rawHeaders = Object.keys(tableData[0]);
          const titleLower = title.toLowerCase();
          
          const isRollingTable = titleLower.includes("rolling") || titleLower.includes("best");
          const isSplitTable = titleLower.includes("splits") && !isRollingTable;
          const isBandTable = titleLower.includes("bands") || titleLower.includes("zone");

          let displayTitle = title.replace(/_/g, ' ');
          if (titleLower.includes("hr_bands") || titleLower.includes("heart")) displayTitle = "Heart Rate Zones";
          if (titleLower.includes("cadence_bands") || titleLower.includes("cadence")) displayTitle = "Cadence Zones";
          if (isSplitTable) displayTitle = "Km Splits";
          if (isRollingTable) displayTitle = "Best Rolling Intervals";

          if (isSplitTable || isRollingTable) {
            rawHeaders = rawHeaders.filter(h => 
              h.toLowerCase().includes("split") || 
              h.toLowerCase() === "index" ||
              h.toLowerCase().includes("window") || 
              h.toLowerCase().includes("pace") ||
              h.toLowerCase().includes("hr") ||        
              h.toLowerCase().includes("cadence") ||
              h.toLowerCase().includes("time") ||
              h.toLowerCase().includes("ef") // FIXED: Whitelist EF to prevent stripping
            );
          }
          
          if (isBandTable) {
            rawHeaders = rawHeaders.filter(h => 
              h.toLowerCase().includes("band") || 
              h.toLowerCase().includes("time") || 
              h.toLowerCase().includes("distance") ||
              h.toLowerCase() === "ef" // FIXED: Whitelist EF here too just in case
            );
          }

          if (rawHeaders.length === 0) return null;

          return (
            <div key={title} className={`overflow-x-auto rounded-xl shadow-xs border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className={`px-4 py-2 text-xs font-black uppercase tracking-wider border-b ${isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                {displayTitle}
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`border-b ${isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}>
                    {rawHeaders.map(header => {
                      // FIXED: Explicitly define headerLower in this map loop scope
                      const headerLower = header.toLowerCase(); 
                      return (
                        <th key={header} className="px-3 py-2 font-bold uppercase tracking-wider text-[10px] opacity-70 whitespace-nowrap">
                          {friendlyHeaders[headerLower] || header.replace(/_/g, ' ')}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, idx) => {
                    const rowUniqueId = `perf-${titleLower}-${row.index || row.window || idx}`;
                    const isRowSelected = activeHighlight?.id === rowUniqueId;

                    // FIX: Standardized highlight routing for both Hover and Click interactions
                    const updateHighlightState = (isActive) => {
                      if (!isActive) {
                        setActiveHighlight(null);
                        return;
                      }

                      if (isSplitTable || isRollingTable) {
                        if (row.start_time && row.end_time) {
                          setActiveHighlight({ type: 'time', id: rowUniqueId, start: row.start_time, end: row.end_time });
                        }
                      } else if (isBandTable) {
                        // FIX: Stronger substring match for Metric overlays
                        const isHr = titleLower.includes("hr") || titleLower.includes("heart");
                        const metricKey = isHr ? "heart_rate_bpm" : "cadence";
                        const minBound = row.min_val != null ? row.min_val : 0;
                        const maxBound = row.max_val != null ? row.max_val : 999;

                        setActiveHighlight({
                          type: 'metric', id: rowUniqueId, metricKey, min: minBound, max: maxBound,
                          isFirstBin: row.min_val == null || minBound === 0,
                          isLastBin: row.max_val == null || maxBound === 999
                        });
                      }
                    };

                    return (
                      <tr 
                        key={idx} 
                        onClick={() => updateHighlightState(!isRowSelected)}
                        onMouseEnter={() => updateHighlightState(true)}
                        onMouseLeave={() => updateHighlightState(false)}
                        className={`transition-colors duration-150 cursor-pointer select-none ${
                          isRowSelected 
                            ? (isDark ? 'bg-blue-950/40 text-blue-400 font-bold border-l-4 border-l-blue-500 shadow-sm' : 'bg-blue-50 text-blue-900 font-semibold border-l-4 border-l-blue-500') 
                            : (isDark ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50/80')
                        }`}
                      >
                        {rawHeaders.map(header => {
                          let val = row[header];
                          const headerLower = header.toLowerCase();
                          
                          if ((headerLower.includes("split") || headerLower === "index") && isSplitTable && val !== null) {
                              val = `Km ${val}`;
                          } else if ((headerLower.includes("window") || headerLower === "index") && isRollingTable && val !== null) {
                              val = formatWindowDistance(val);
                          } else if (headerLower.includes("start_time") || headerLower.includes("end_time")) {
                              val = extractTimeOnly(val);
                          } else if (headerLower.includes("pace")) {
                              val = formatPace(val);
                          } else if (headerLower.includes("time") && typeof val === 'number') {
                              val = formatTimeHHMMSS(val);
                          } else if (headerLower.includes("distance") && typeof val === 'number') {
                              val = (val / 1000).toFixed(2) + " km";
                          } else if (headerLower.includes("hr") || headerLower.includes("cadence")) {
                              val = val !== null ? Math.round(val) : '-'; 
                          } else if (headerLower === "ef" && val !== null) {
                              // FIXED: explicitly target EF format styling (limit to 2 decimals)
                              val = parseFloat(val).toFixed(2);
                          } else if (typeof val === 'number') {
                              val = Number.isInteger(val) ? val : parseFloat(val.toFixed(2));
                          } 

                          return <td key={header} className="px-3 py-2 font-medium">{val !== null ? val : '-'}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
