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
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
};

const formatPace = (decimalMins) => {
  if (decimalMins == null || isNaN(decimalMins)) return "-";
  let m = Math.floor(decimalMins);
  let s = Math.round((decimalMins - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${s.toString().padStart(2, '0')} min/km`;
};

const formatWindowDistance = (val) => {
  if (val == null) return "-";
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return num < 1000 ? `${num} m` : `${num / 1000} km`;
};

const extractTimeOnly = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return "-";
  const parts = dateStr.split(' ');
  return parts.length > 1 ? parts[1] : dateStr;
};

export default function PerformanceStats({ performance, activeHighlight, setActiveHighlight, theme }) {
  if (!performance || Object.keys(performance).length === 0) return null;
  const isDark = theme === 'dark';

  return (
    <div className={`p-5 rounded-xl border shadow-sm transition-colors duration-200 ${
      isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
    }`}>
      <h3 className={`text-base font-bold mb-4 border-b pb-2 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
        Performance Stats
      </h3>
      
      <div className="space-y-8">
        {/* Preserved the entire original dynamic multi-table object mapper entry loop intact */}
        {Object.entries(performance).map(([title, tableData]) => {
          if (!document || !Array.isArray(tableData) || tableData.length === 0) return null;
          
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
              h.toLowerCase().includes("time")
            );
          }
          
          if (isBandTable) {
            rawHeaders = rawHeaders.filter(h => 
              !h.toLowerCase().includes("min_val") && 
              !h.toLowerCase().includes("max_val")
            );
          }

          return (
            <div key={title} className="overflow-x-auto">
              <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-400' : 'text-slate-700'}`}>{displayTitle}</h4>
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className={`transition-colors ${isDark ? 'bg-slate-950/60 text-slate-400' : 'bg-slate-50 text-slate-600'}`}>
                  <tr>
                    {rawHeaders.map(header => {
                      const headerLower = header.toLowerCase();
                      let cleanHeader = friendlyHeaders[header] || friendlyHeaders[headerLower] || header.replace(/_/g, ' ');
                      
                      if (isSplitTable) {
                        if (headerLower === "index") cleanHeader = "Split";
                        if (headerLower.includes("pace")) cleanHeader = "Pace";
                      }
                      if (isRollingTable) {
                        if (headerLower === "index" || headerLower.includes("window")) cleanHeader = "Interval Window";
                        if (headerLower.includes("pace")) cleanHeader = "Avg Pace";
                      }

                      return (
                        <th key={header} className={`px-3 py-2 border-b font-bold uppercase tracking-wider text-[10px] ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
                          {cleanHeader}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className={`divide-y transition-colors ${isDark ? 'divide-slate-800/40 text-slate-300' : 'divide-slate-100 text-slate-700'}`}>
                  {tableData.map((row, idx) => {
                    const rowUniqueId = `perf-${titleLower}-${row.index || row.window || idx}`;
                    const isRowSelected = activeHighlight?.id === rowUniqueId;

                    const handleRowClick = () => {
                      if (isRowSelected) {
                        setActiveHighlight(null);
                        return;
                      }

                      if (isSplitTable || isRollingTable) {
                        if (row.start_time && row.end_time) {
                          setActiveHighlight({ type: 'time', id: rowUniqueId, start: row.start_time, end: row.end_time });
                        }
                      } else if (isBandTable) {
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
                        onClick={handleRowClick}
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