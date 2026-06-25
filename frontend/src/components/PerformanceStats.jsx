import React from 'react';

const friendlyHeaders = {
  split: 'Split',
  pace_min_per_km: 'Pace',
  avg_pace_min_per_km: 'Avg Pace',
  avg_hr_bpm: 'Avg HR',
  avg_cadence_spm: 'Avg Cadence',
  max_pace_min_per_km: 'Max Pace',
  max_hr_bpm: 'Max HR',
  max_cadence_spm: 'Max Cadence',
  time_in_zone_s: 'Time',
  start_time: 'Start Time',
  end_time: 'End Time',
  distance_in_zone_m: 'Distance',
  distance_m: 'Distance',
  time_s: 'Time',
  heart_rate_bpm: 'HR',
  cadence: 'Cadence',
  altitude_m: 'Altitude',
  ef: 'EF',
  band: 'Band',
  min_val: 'Minimum',
  max_val: 'Maximum',
  index: 'Index',
  duration_s: 'Duration',
  window_m: 'Window',
  window: 'Window'
};

const formatTimeHHMMSS = (secs) => {
  if (secs == null || isNaN(secs)) return '-';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
};

const formatPace = (decimalMins) => {
  if (decimalMins == null || isNaN(decimalMins)) return '-';
  let m = Math.floor(decimalMins);
  let s = Math.round((decimalMins - m) * 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  return `${m}:${s.toString().padStart(2, '0')} min/km`;
};

const formatWindowDistance = (val) => {
  if (val == null) return '-';
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return num < 1000 ? `${num} m` : `${num / 1000} km`;
};

const extractTimeOnly = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return '-';
  const parts = dateStr.split(' ');
  return parts.length > 1 ? parts[1] : dateStr;
};

const toNumberOrNull = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

const buildDistanceHighlight = (row, titleLower, rowIndex) => {
  const totalDistance = toNumberOrNull(row.distance_m);
  if (titleLower.includes('split')) {
    if (totalDistance == null) return null;
    const startDistance = Math.max(0, totalDistance - 1000);
    return {
      type: 'distance',
      id: `split-${row.index ?? rowIndex}-${startDistance}-${totalDistance}`,
      startDistance,
      endDistance: totalDistance
    };
  }

  if (titleLower.includes('rolling') || titleLower.includes('best')) {
    const windowDistance = toNumberOrNull(row.window_m ?? row.window);
    const endDistance = toNumberOrNull(row.distance_m);
    if (windowDistance == null || endDistance == null) return null;
    const startDistance = Math.max(0, endDistance - windowDistance);
    return {
      type: 'distance',
      id: `rolling-${rowIndex}-${windowDistance}-${startDistance}-${endDistance}`,
      startDistance,
      endDistance
    };
  }

  return null;
};

const buildTimeHighlightFallback = (row, titleLower, rowIndex) => {
  if (!row.start_time || !row.end_time) return null;
  return {
    type: 'time',
    id: `${titleLower}-${row.index ?? rowIndex}-${row.start_time}-${row.end_time}`,
    start: row.start_time,
    end: row.end_time
  };
};

export default function PerformanceStats({ performance, activeHighlight, setActiveHighlight, theme }) {
  if (!performance || Object.keys(performance).length === 0) return null;
  const isDark = theme === 'dark';

  return (
    <div
      className={`p-5 rounded-xl border shadow-sm transition-colors duration-200 ${
        isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
      }`}
    >
      <h3 className={`text-base font-bold mb-4 border-b pb-2 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
        Performance Stats
      </h3>

      <div className="space-y-8">
        {Object.entries(performance).map(([title, tableData]) => {
          if (!tableData || !Array.isArray(tableData) || tableData.length === 0) return null;

          let rawHeaders = Object.keys(tableData[0]);
          const titleLower = title.toLowerCase();

          const isRollingTable = titleLower.includes('rolling') || titleLower.includes('best');
          const isSplitTable = titleLower.includes('splits') && !isRollingTable;
          const isBandTable = titleLower.includes('bands') || titleLower.includes('zone');

          let displayTitle = title.replace(/_/g, ' ');
          if (titleLower.includes('hr_bands') || titleLower.includes('heart')) displayTitle = 'Heart Rate Zones';
          if (titleLower.includes('cadence_bands') || titleLower.includes('cadence')) displayTitle = 'Cadence Zones';
          if (isSplitTable) displayTitle = 'Km Splits';
          if (isRollingTable) displayTitle = 'Best Rolling Intervals';

          if (isSplitTable || isRollingTable) {
            rawHeaders = rawHeaders.filter(
              (h) =>
                h.toLowerCase().includes('split') ||
                h.toLowerCase().includes('index') ||
                h.toLowerCase().includes('window') ||
                h.toLowerCase().includes('pace') ||
                h.toLowerCase().includes('hr') ||
                h.toLowerCase().includes('cadence') ||
                h.toLowerCase().includes('time') ||
                h.toLowerCase().includes('distance')
            );
          }

          if (isBandTable) {
            rawHeaders = rawHeaders.filter(
              (h) => !h.toLowerCase().includes('min_val') && !h.toLowerCase().includes('max_val')
            );
          }

          return (
            <div key={title} className="overflow-x-auto">
              <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-400' : 'text-slate-700'}`}>
                {displayTitle}
              </h4>

              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className={`transition-colors ${isDark ? 'bg-slate-950/60 text-slate-400' : 'bg-slate-50 text-slate-600'}`}>
                  <tr>
                    {rawHeaders.map((header) => {
                      const headerLower = header.toLowerCase();
                      let cleanHeader = friendlyHeaders[header] || friendlyHeaders[headerLower] || header.replace(/_/g, ' ');
                      if (isSplitTable) {
                        if (headerLower === 'index') cleanHeader = 'Split';
                        if (headerLower === 'duration_s') cleanHeader = 'Time';
                        if (headerLower === 'distance_m') cleanHeader = 'Distance';
                      }
                      if (isRollingTable) {
                        if (headerLower === 'window_m' || headerLower === 'window') cleanHeader = 'Window';
                        if (headerLower === 'distance_m') cleanHeader = 'Distance';
                      }
                      return (
                        <th key={header} className="px-3 py-2 font-semibold">
                          {cleanHeader}
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {tableData.map((row, rowIndex) => {
                    const distanceHighlight = buildDistanceHighlight(row, titleLower, rowIndex);
                    const timeHighlight = buildTimeHighlightFallback(row, titleLower, rowIndex);
                    const nextHighlight = distanceHighlight || timeHighlight;

                    const isRowActive =
                      activeHighlight &&
                      nextHighlight &&
                      activeHighlight.id === nextHighlight.id;

                    return (
                      <tr
                        key={`${title}-${rowIndex}`}
                        onClick={() => {
                          if (!nextHighlight) return;
                          setActiveHighlight(isRowActive ? null : nextHighlight);
                        }}
                        className={`border-t cursor-pointer transition-colors ${
                          isDark ? 'border-slate-800' : 'border-slate-100'
                        } ${
                          isRowActive
                            ? isDark
                              ? 'bg-blue-900/30'
                              : 'bg-blue-50'
                            : isDark
                              ? 'hover:bg-slate-800/70'
                              : 'hover:bg-slate-50'
                        }`}
                      >
                        {rawHeaders.map((header) => {
                          const val = row[header];
                          const headerLower = header.toLowerCase();

                          let displayVal = val;

                          if (headerLower.includes('pace')) displayVal = formatPace(val);
                          else if (headerLower.includes('duration') || headerLower === 'time_s') displayVal = formatTimeHHMMSS(val);
                          else if (headerLower === 'window_m' || headerLower === 'window') displayVal = formatWindowDistance(val);
                          else if (headerLower === 'distance_m' || headerLower === 'distance_in_zone_m') {
                            const num = toNumberOrNull(val);
                            displayVal = num == null ? '-' : `${(num / 1000).toFixed(2)} km`;
                          } else if (headerLower === 'start_time' || headerLower === 'end_time') {
                            displayVal = extractTimeOnly(val);
                          } else if (typeof val === 'number') {
                            displayVal = Number.isInteger(val) ? val : val.toFixed(2);
                          } else if (val == null) {
                            displayVal = '-';
                          }

                          return (
                            <td key={header} className="px-3 py-2">
                              {displayVal}
                            </td>
                          );
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