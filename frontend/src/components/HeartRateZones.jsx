import { Heart } from 'lucide-react';

export default function HeartRateZones({ performance }) {
  if (!performance) return null;

  // Robustly extract the zone data (handling both array and dict JSON formats)
  const perfObj = Array.isArray(performance) ? performance[0] : performance;

  // Define the standard 5 zones with their specific UI colors
  const zones = [
    { key: "Zone 5", label: "Z5 - Anaerobic", dot: "bg-red-500", text: "text-red-700", bg: "bg-red-50" },
    { key: "Zone 4", label: "Z4 - Threshold", dot: "bg-orange-500", text: "text-orange-700", bg: "bg-orange-50" },
    { key: "Zone 3", label: "Z3 - Tempo", dot: "bg-green-500", text: "text-green-700", bg: "bg-green-50" },
    { key: "Zone 2", label: "Z2 - Aerobic", dot: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50" },
    { key: "Zone 1", label: "Z1 - Recovery", dot: "bg-slate-400", text: "text-slate-700", bg: "bg-slate-50" },
  ];

  // Helper to find the correct time value in the backend data
  const getZoneValue = (zoneKey) => {
    if (Array.isArray(performance)) {
      const row = performance.find(p => p.Metric && p.Metric.includes(zoneKey));
      return row ? row.Value : "0:00";
    }
    const key = Object.keys(perfObj).find(k => k.includes(zoneKey));
    return key ? perfObj[key] : "0:00";
  };

  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
      <div className="flex items-center space-x-2 mb-4 pb-3 border-b border-slate-100">
        <Heart className="w-5 h-5 text-red-500" />
        <h3 className="font-semibold text-slate-800">Heart Rate Zones</h3>
      </div>
      
      <div className="space-y-3">
        {zones.map((zone) => {
          const value = getZoneValue(zone.key);
          return (
            <div key={zone.key} className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className={`w-3 h-3 rounded-full ${zone.dot}`}></span>
                <span className="text-sm font-medium text-slate-700">{zone.label}</span>
              </div>
              <span className={`text-sm font-semibold px-2 py-1 rounded-md ${zone.bg} ${zone.text}`}>
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}