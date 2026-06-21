import React from 'react';

const formatTime = (secs) => {
  if (!secs) return "0:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
};

const formatPace = (decimalMins) => {
  if (!decimalMins) return "-:--";
  const m = Math.floor(decimalMins);
  const s = Math.round((decimalMins - m) * 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatDate = (dateStr) => {
  if (!dateStr) return "Unknown Date";
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};

// Upgraded StatBox component to accept theme state
const StatBox = ({ label, value, isDark }) => (
  <div className="flex flex-col">
    <span className={`text-[11px] font-semibold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{label}</span>
    <span className={`text-sm font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{value}</span>
  </div>
);

export default function RunSummary({ summary, metrics, theme }) {
  if (!summary) return null;
  const isDark = theme === 'dark';

  const date = formatDate(summary["start_time"]);
  const location = summary["location_city"] || "Local Route"; 
  
  const start = summary["start_time"] ? summary["start_time"].split(' ')[1] : "--:--";
  const end = summary["end_time"] ? summary["end_time"].split(' ')[1] : "--:--";

  return (
    <div className={`p-5 rounded-xl border shadow-sm transition-colors duration-200 ${
      isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
    }`}>
      <h2 className={`text-base font-bold tracking-wide uppercase opacity-90 border-b pb-2 mb-4 ${
        isDark ? 'border-slate-800 text-slate-100' : 'text-slate-800 border-slate-200'
      }`}>
        Run Summary &mdash; {date} &mdash; {location}
      </h2>

      {/* Retained the full structured 12-item metrics panel layout grid */}
      <div className="grid grid-cols-4 gap-y-5 gap-x-2 mb-6">
        <StatBox label="Start" value={start} isDark={isDark} />
        <StatBox label="End" value={end} isDark={isDark} />
        <StatBox label="Moving Dist" value={`${((summary["moving_distance_m"] || 0) / 1000).toFixed(2)} km`} isDark={isDark} />
        <StatBox label="Moving Time" value={formatTime(summary["moving_time_s"])} isDark={isDark} />

        <StatBox label="Avg Pace" value={`${formatPace(summary["avg_pace_min_per_km"])} /km`} isDark={isDark} />
        <StatBox label="Max Pace" value={`${formatPace(summary["max_pace_min_per_km"])} /km`} isDark={isDark} />
        <StatBox label="Avg HR" value={summary["avg_hr_bpm"] ? Math.round(summary["avg_hr_bpm"]) : '-'} isDark={isDark} />
        <StatBox label="Max HR" value={summary["max_hr_bpm"] ? Math.round(summary["max_hr_bpm"]) : '-'} isDark={isDark} />

        <StatBox label="Avg Cadence" value={summary["avg_cadence_spm"] ? Math.round(summary["avg_cadence_spm"]) : '-'} isDark={isDark} />
        <StatBox label="Max Cadence" value={summary["max_cadence_spm"] ? Math.round(summary["max_cadence_spm"]) : '-'} isDark={isDark} />
        <StatBox label="Ascent" value={`${Math.round(summary["ascent_m"] || 0)} m`} isDark={isDark} />
        <StatBox label="Descent" value={`${Math.round(summary["descent_m"] || 0)} m`} isDark={isDark} />
      </div>

      {/* MOTION SUMMARY WITH RE-SHADED BG PILLS */}
      <div className={`grid grid-cols-3 gap-2 text-center mt-6 pt-4 border-t ${isDark ? 'border-slate-800' : 'border-slate-300'}`}>
        {['running', 'walking', 'stopped'].map(type => {
          const stats = summary?.motion_totals?.[type] || { distance_m: 0, duration_s: 0 };
          const distKm = ((stats.distance_m || 0) / 1000).toFixed(2);
          
          const secs = stats.duration_s || 0;
          const m = Math.floor(secs / 60);
          const s = Math.floor(secs % 60);
          const timeStr = `${m}m ${s.toString().padStart(2, '0')}`;

          return (
            <div key={type} className={`rounded p-2 transition-colors ${isDark ? 'bg-slate-950/40 text-slate-300' : 'bg-slate-100 text-slate-800'}`}>
              <div className={`text-[10px] font-bold uppercase ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>{type}</div>
              <div className={`text-sm font-black ${isDark ? 'text-white' : 'text-slate-800'}`}>{distKm} km</div>
              <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{timeStr}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}