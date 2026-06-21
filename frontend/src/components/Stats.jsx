import { Timer, Route, Zap, TrendingUp } from 'lucide-react';

// Helper: Converts total seconds into MM:SS format
const formatTime = (totalSeconds) => {
  if (!totalSeconds) return "0:00";
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Helper: Converts decimal pace (e.g., 7.09) into MM:SS format (7:05)
const formatPace = (decimalMinutes) => {
  if (!decimalMinutes) return "0:00";
  const mins = Math.floor(decimalMinutes);
  const secs = Math.round((decimalMinutes - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function Stats({ summary }) {
  if (!summary) return null;

  // Extract raw values using the exact keys from your FastAPI JSON response
  const rawDistanceMeters = summary["total_distance_m"] || summary["moving_distance_m"] || 0;
  const rawMovingTimeSecs = summary["moving_time_s"] || summary["elapsed_time_s"] || 0;
  const rawAvgPaceDecMins = summary["avg_pace_min_per_km"] || 0;
  const rawAscentMeters = summary["ascent_m"] || 0;

  // Format the raw numbers for display
  const dist = (rawDistanceMeters / 1000).toFixed(2); // Convert meters to km
  const time = formatTime(rawMovingTimeSecs);
  const pace = formatPace(rawAvgPaceDecMins);
  const elev = Math.round(rawAscentMeters);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-3">
        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Route size={20} /></div>
        <div>
          <p className="text-sm text-slate-500 font-medium">Distance</p>
          <p className="text-lg font-bold text-slate-800">{dist} km</p>
        </div>
      </div>
      
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-3">
        <div className="p-2 bg-orange-50 text-orange-600 rounded-lg"><Timer size={20} /></div>
        <div>
          <p className="text-sm text-slate-500 font-medium">Moving Time</p>
          <p className="text-lg font-bold text-slate-800">{time}</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-3">
        <div className="p-2 bg-green-50 text-green-600 rounded-lg"><Zap size={20} /></div>
        <div>
          <p className="text-sm text-slate-500 font-medium">Avg Pace</p>
          <p className="text-lg font-bold text-slate-800">{pace} /km</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center space-x-3">
        <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><TrendingUp size={20} /></div>
        <div>
          <p className="text-sm text-slate-500 font-medium">Elevation</p>
          <p className="text-lg font-bold text-slate-800">{elev} m</p>
        </div>
      </div>
    </div>
  );
}