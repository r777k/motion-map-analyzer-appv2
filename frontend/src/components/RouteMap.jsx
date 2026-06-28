import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap, useMapEvents, Marker } from 'react-leaflet';
import { useEffect, useMemo, useState } from 'react';
import * as d3Scale from 'd3-scale';
import * as d3Chromatic from 'd3-scale-chromatic';
import { divIcon } from 'leaflet';
import { Crosshair } from 'lucide-react';

const BASE_MAPS = {
  'Standard': 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  'Dark': 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  'Topo': 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
};

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

const THICKNESS_MODES = {
  thin: {
    weights: { standard: 2.0, standardActive: 4.0, standardDimmed: 0.8, overlay: 2.5, overlayActive: 4.5, overlayDimmed: 1.0 },
    arrowSize: 11,
    arrowStroke: 1.5,
    fontSize: '9px',
    markerRadius: 3
  },
  medium: {
    weights: { standard: 3.5, standardActive: 5.5, standardDimmed: 1.5, overlay: 4.5, overlayActive: 6.5, overlayDimmed: 2.0 },
    arrowSize: 15,
    arrowStroke: 2.5,
    fontSize: '11px',
    markerRadius: 4
  },
  thick: {
    weights: { standard: 5.5, standardActive: 7.5, standardDimmed: 2.2, overlay: 6.5, overlayActive: 8.5, overlayDimmed: 3.0 },
    arrowSize: 19,
    arrowStroke: 3.5,
    fontSize: '13px',
    markerRadius: 5
  }
};

const REF_ZOOM = 14;

const getZoomWeight = (baseWeight, currentZoom) => {
  if (currentZoom >= REF_ZOOM) return baseWeight; 
  const factor = currentZoom / REF_ZOOM;
  return Math.max(1.0, baseWeight * factor);       
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

const formatTimeHHMMSS = (totalSeconds) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const lat1Rad = lat1 * (Math.PI / 180);
  const lat2Rad = lat2 * (Math.PI / 180);
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

const formatPace = (decimalMins) => {
  if (decimalMins == null || isNaN(decimalMins)) return "-:--";
  let m = Math.floor(decimalMins);
  let s = Math.round((decimalMins - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${s.toString().padStart(2, '0')} /km`;
};

function FitBounds({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.length > 0) {
      map.fitBounds(coords, { padding: [50, 50] });
    }
  }, [coords, map]);
  return null;
}

function ZoomTracker({ onZoomChange }) {
  const map = useMapEvents({
    zoomend() {
      onZoomChange(map.getZoom());
    }
  });
  return null;
}

function RecenterButton({ coords, isDark }) {
  const map = useMap();
  return (
    <button
      type="button"
      onClick={() => {
        if (coords && coords.length > 0) {
          map.fitBounds(coords, { padding: [50, 50] });
        }
      }}
      className={`absolute top-4 right-4 z-[1000] p-2.5 rounded-full shadow-md border transition-all duration-200 group flex items-center justify-center custom-recenter-fab-node ${
        isDark 
          ? 'bg-slate-900 text-slate-200 border-slate-800 hover:text-blue-400 hover:bg-slate-800' 
          : 'bg-white text-slate-700 border-slate-200 hover:text-blue-600 hover:shadow-lg'
      }`}
      title="Recenter Map View"
    >
      <Crosshair className="w-5 h-5 transition-transform duration-300 group-hover:rotate-90" />
    </button>
  );
}

export default function RouteMap({ segments, trackpoints, config, splits, activeHighlight, hoveredTrackpoint, setActiveHighlight, theme }) {
  // CRITICAL TO FIX EXCEPTION 300: Declare hooks FIRST before applying structural escape returns
  const [currentZoom, setCurrentZoom] = useState(13);
  const isDark = theme === 'dark';

  const allCoords = useMemo(() => {
    if (!segments || segments.length === 0) return [];
    return segments.flatMap(seg => seg.coords);
  }, [segments]);

  const modeConfig = useMemo(() => {
    const currentMode = config?.thickness || 'medium';
    return THICKNESS_MODES[currentMode];
  }, [config?.thickness]);

  const enrichedTrackpoints = useMemo(() => {
    if (!trackpoints || !segments || segments.length === 0) return [];
    let lastKnown = { 'pace_min_per_km': null, 'heart_rate_bpm': null, 'cadence': null, 'altitude_m': null, 'distance_m': null };

    return trackpoints.map(tp => {
      const parentSeg = segments.find(seg => tp.time >= seg.start_time && tp.time <= seg.end_time);
      const stateKey = parentSeg ? parentSeg.label.charAt(0).toUpperCase() + parentSeg.label.slice(1).toLowerCase() : "Running";
      const enrichedTp = { ...tp, _motionState: stateKey };

      ['pace_min_per_km', 'heart_rate_bpm', 'cadence', 'altitude_m', 'distance_m'].forEach(key => {
        let val = tp[key];
        if (key === 'pace_min_per_km' && (val == null || isNaN(val))) val = parentSeg ? parentSeg.avg_pace_min_per_km : null;
        if (val != null && isFinite(val) && !isNaN(val)) lastKnown[key] = val;
        enrichedTp[`_${key}`] = lastKnown[key];
      });
      return enrichedTp;
    });
  }, [trackpoints, segments]);

  // UNIFIED DEFENSIVE HIGHLIGHT ENGINE: Harmonizes splits, intervals, and brush slices
  const evaluateHighlightStatus = useMemo(() => {
    return (item, highlight) => {
      if (!highlight) return true;

      // Match strategy A: Direct string boundaries (rolling intervals, time blocks)
      const hStart = highlight.start || highlight.start_time;
      const hEnd = highlight.end || highlight.end_time;

      if (hStart && hEnd) {
        if (item.time) {
          return item.time >= hStart && item.time <= hEnd;
        } else if (item.start_time && item.end_time) {
          return item.start_time <= hEnd && item.end_time >= hStart;
        }
      }

      // Match strategy B: Coarse index mapping fallback
      if (highlight.type === 'split' && highlight.index !== undefined) {
        const targetSplit = splits?.find(s => s.index === highlight.index);
        if (targetSplit) {
          if (item.time) return item.time >= targetSplit.start_time && item.time <= targetSplit.end_time;
          if (item.start_time && item.end_time) return item.start_time <= targetSplit.end_time && item.end_time >= targetSplit.start_time;
        }
        if (item._distance_m !== undefined) {
          const sDist = (highlight.index - 1) * 1000;
          const eDist = highlight.index * 1000;
          return item._distance_m >= sDist && item._distance_m <= eDist;
        }
      }
      return false;
    };
  }, [splits]);

  // Clean boundary protection exit
  if (!segments || segments.length === 0 || !config) return null;

  const renderSegmentTooltip = (seg, idx) => {
    const stateLabel = seg.label.charAt(0).toUpperCase() + seg.label.slice(1).toLowerCase();
    const distKm = ((seg.distance_m || 0) / 1000).toFixed(2);
    const cadenceVal = seg.avg_cadence_spm || seg.avg_cadence || 0;

    const segPoints = enrichedTrackpoints.filter(t => t.time >= seg.start_time && t.time <= seg.end_time);
    let elevDeltaStr = "0.0 m";
    if (segPoints.length > 1) {
      const elevDiff = (segPoints[segPoints.length - 1]._altitude_m || 0) - (segPoints[0]._altitude_m || 0);
      elevDeltaStr = `${elevDiff >= 0 ? '+' : ''}${elevDiff.toFixed(1)} m`;
    }

    let motionEmoji = "🏃";
    if (stateLabel === "Walking") motionEmoji = "🚶";
    if (stateLabel === "Stopped") motionEmoji = "🛑";

    return (
      <Tooltip sticky permanent={false} direction="top">
        <div className="bg-slate-950 text-white p-2.5 rounded-lg shadow-xl text-xs font-medium border border-slate-800 leading-normal min-w-[150px]">
          <div className="font-extrabold border-b border-slate-800 pb-1 mb-1.5 text-blue-400 flex items-center justify-between">
            <span>{motionEmoji} {stateLabel}</span>
            <span className="text-[10px] text-slate-500 font-normal">Interval {idx + 1}</span>
          </div>
          <div className="space-y-0.5 text-slate-400">
            <div className="flex justify-between"><span>Dist:</span><span className="font-bold text-white">{distKm} km</span></div>
            <div className="flex justify-between"><span>Pace:</span><span className="font-bold text-white">{formatPace(seg.avg_pace_min_per_km)}</span></div>
            <div className="flex justify-between"><span>Avg HR:</span><span className="font-bold text-white">{seg.avg_hr_bpm ? `${Math.round(seg.avg_hr_bpm)} bpm` : '-'}</span></div>
            <div className="flex justify-between"><span>Cadence:</span><span className="font-bold text-white">{cadenceVal ? `${Math.round(cadenceVal)} spm` : '-'}</span></div>
            <div className="flex justify-between"><span>Elev:</span><span className={`font-bold ${elevDeltaStr.startsWith('+') ? 'text-emerald-400' : elevDeltaStr.startsWith('-') ? 'text-rose-400' : 'text-white'}`}>{elevDeltaStr}</span></div>
          </div>
        </div>
      </Tooltip>
    );
  };

  const overlayPolylines = useMemo(() => {
    const activeMetricTab = config.overlayMetric !== 'None' 
      ? config.overlayMetric 
      : (activeHighlight?.type === 'metric' ? (activeHighlight.metricKey === 'heart_rate_bpm' ? 'Heart Rate' : 'Cadence') : 'None');
    
    if (activeMetricTab === 'None' || enrichedTrackpoints.length === 0) return [];
    
    const rawMetricKey = METRIC_KEYS[activeMetricTab];
    const internalKey = `_${rawMetricKey}`; 
    const interpolator = COLOR_SCALES[config.colorScale] || COLOR_SCALES['viridis'];

    const validValues = [];
    enrichedTrackpoints.forEach(tp => {
      if (!config.motionTypes[tp._motionState]) return; 
      let val = tp[internalKey];
      if (val != null && isFinite(val) && !isNaN(val)) validValues.push(val);
    });

    if (validValues.length === 0) return [];

    let min = getPercentile(validValues, 0.05);
    let max = getPercentile(validValues, 0.95);

    if (rawMetricKey === 'pace_min_per_km') max = Math.min(max, 12.0);
    if (rawMetricKey === 'cadence') min = Math.max(min, 100);
    if (rawMetricKey === 'heart_rate_bpm') {
      min = Math.max(min, 90);
      max = getPercentile(validValues, 1);
      max = Math.min(max, 200);
    }

    if (min === max) max = min + 1;
    const colorScale = d3Scale.scaleLinear().domain([min, max]).range([0, 1]).clamp(true);
    const lines = [];
    const baseWeights = modeConfig.weights;

    for (let i = 0; i < enrichedTrackpoints.length - 1; i++) {
      const p1 = enrichedTrackpoints[i], p2 = enrichedTrackpoints[i + 1];
      if (!config.motionTypes[p1._motionState]) continue;

      let val = p1[internalKey];
      if (val == null) continue;
      
      let colorVal = colorScale(val);
      if (internalKey === '_pace_min_per_km' || config.colorScale === 'warmcool') colorVal = 1 - colorVal;

      let isPointSelected = true;
      if (activeHighlight) {
        if (activeHighlight.type === 'metric') {
          const targetPointValue = p1[`_${activeHighlight.metricKey}`];
          if (targetPointValue != null) {
            if (activeHighlight.isFirstBin) isPointSelected = targetPointValue <= activeHighlight.max;
            else if (activeHighlight.isLastBin) isPointSelected = targetPointValue >= activeHighlight.min;
            else isPointSelected = targetPointValue >= activeHighlight.min && targetPointValue <= activeHighlight.max;
          } else {
            isPointSelected = false;
          }
        } else {
          isPointSelected = evaluateHighlightStatus(p1, activeHighlight);
        }
      }

      const parentSegmentIndex = segments.findIndex(seg => p1.time >= seg.start_time && p1.time <= seg.end_time);
      const matchedSegment = segments[parentSegmentIndex];

      const polylineHandlers = {
        click: () => {
          if (matchedSegment && setActiveHighlight) {
            const uniqueId = `seg-${parentSegmentIndex}`;
            if (activeHighlight?.id === uniqueId) setActiveHighlight(null);
            else setActiveHighlight({ type: 'time', id: uniqueId, start: matchedSegment.start_time, end: matchedSegment.end_time });
          }
        }
      };

      lines.push(
        <Polyline key={i} positions={[[p1.latitude, p1.longitude], [p2.latitude, p2.longitude]]} 
          eventHandlers={polylineHandlers}
          className="custom-leaflet-track-vector"
          pathOptions={{ 
            color: interpolator(colorVal), 
            weight: activeHighlight 
              ? (isPointSelected ? getZoomWeight(baseWeights.overlayActive, currentZoom) : getZoomWeight(baseWeights.overlayDimmed, currentZoom)) 
              : getZoomWeight(baseWeights.overlay, currentZoom), 
            opacity: activeHighlight ? (isPointSelected ? 1.0 : 0.15) : 0.9, 
            lineCap: 'round', strokeLinejoin: 'round' 
          }} 
        >
          {matchedSegment && renderSegmentTooltip(matchedSegment, parentSegmentIndex)}
        </Polyline>
      );
    }
    return lines;
  }, [enrichedTrackpoints, config.overlayMetric, config.colorScale, config.motionTypes, activeHighlight, currentZoom, modeConfig, segments, evaluateHighlightStatus, setActiveHighlight]);

  const mapMarkers = useMemo(() => {
    if (!trackpoints || trackpoints.length === 0) return [];
    const markers = [];

    if (config.markers.Kilometre && splits && splits.length > 0) {
      splits.forEach(split => {
         const tp = trackpoints.find(t => t.time >= split.end_time);
         if (tp) markers.push({ id: `km-${split.index}`, pos: [tp.latitude, tp.longitude], text: `${split.index} km`, color: '#3b82f6' });
      });
    }

    if (config.markers.Time) {
       const startTime = new Date(trackpoints[0].time.replace(/-/g, '/')).getTime(); 
       const tenMins = 10 * 60 * 1000;
       let nextMarkerTime = startTime + tenMins;

       trackpoints.forEach(tp => {
          const tpTime = new Date(tp.time.replace(/-/g, '/')).getTime();
          if (tpTime >= nextMarkerTime) {
             const elapsedSecs = Math.floor((tpTime - startTime) / 1000);
             markers.push({ id: `time-${elapsedSecs}`, pos: [tp.latitude, tp.longitude], text: formatTimeHHMMSS(elapsedSecs), color: '#f59e0b' });
             nextMarkerTime += tenMins;
          }
       });
    }

    if (config.markers.Direction && trackpoints.length > 1) {
      const STEP_SIZE = 75; 
      for (let i = 0; i < trackpoints.length - STEP_SIZE; i += STEP_SIZE) {
        const currentPt = trackpoints[i];
        const nextPt = trackpoints[i + STEP_SIZE];
        
        const parentSeg = segments.find(seg => currentPt.time >= seg.start_time && currentPt.time <= seg.end_time);
        const stateKey = parentSeg ? parentSeg.label.charAt(0).toUpperCase() + parentSeg.label.slice(1).toLowerCase() : "Running";
        if (!config.motionTypes[stateKey]) continue;

        const bearing = calculateBearing(currentPt.latitude, currentPt.longitude, nextPt.latitude, nextPt.longitude);
        const arrowIcon = divIcon({
          className: 'strava-dir-arrow',
          html: `
            <div style="transform: rotate(${bearing}deg); display: flex; align-items: center; justify-content: center; width: ${modeConfig.arrowSize}px; height: ${modeConfig.arrowSize}px;">
              <svg width="${modeConfig.arrowSize - 2}" height="${modeConfig.arrowSize - 2}" viewBox="0 0 24 24" fill="#1e293b" stroke="white" stroke-width="${modeConfig.arrowStroke}" stroke-linejoin="round">
                <polygon points="12 2 22 22 12 17 2 22 12 2" />
              </svg>
            </div>
          `,
          iconSize: [modeConfig.arrowSize, modeConfig.arrowSize], iconAnchor: [modeConfig.arrowSize / 2, modeConfig.arrowSize / 2]
        });

        markers.push({ id: `dir-${i}`, pos: [currentPt.latitude, currentPt.longitude], isDirectional: true, icon: arrowIcon });
      }
    }

    return markers;
  }, [trackpoints, splits, config.markers, config.motionTypes, segments, modeConfig]);

  const tileUrl = BASE_MAPS[config.baseMap];
  const useBaseMapTiles = config.baseMap !== 'No Map';
  const baseWeights = modeConfig.weights;

  return (
    <div className={`absolute inset-0 rounded-xl shadow-md border overflow-hidden z-0 transition-all duration-200 ${
      !useBaseMapTiles 
        ? (isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-200') 
        : (isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200')
    }`}>
      <MapContainer style={{ height: '100%', width: '100%' }} zoom={13} scrollWheelZoom={true}>
        {useBaseMapTiles && <TileLayer key={config.baseMap} url={tileUrl} attribution='&copy; OpenStreetMap contributors' />}
        <FitBounds coords={allCoords} />
        <ZoomTracker onZoomChange={setCurrentZoom} />
        
        <RecenterButton coords={allCoords} isDark={isDark} />
        
        {config.overlayMetric === 'None' && (!activeHighlight || activeHighlight.type !== 'metric') && 
          segments.filter(seg => config.motionTypes[seg.label.charAt(0).toUpperCase() + seg.label.slice(1).toLowerCase()]).map((seg, index) => {
            const isHighlighted = evaluateHighlightStatus(seg, activeHighlight);

            const polylineHandlers = {
              click: () => {
                if (setActiveHighlight) {
                  const uniqueId = `seg-${index}`;
                  if (activeHighlight?.id === uniqueId) setActiveHighlight(null);
                  else setActiveHighlight({ type: 'time', id: uniqueId, start: seg.start_time, end: seg.end_time });
                }
              }
            };

            return (
              <Polyline key={index} positions={seg.coords} 
                eventHandlers={polylineHandlers}
                className="custom-leaflet-track-vector"
                pathOptions={{ 
                  color: seg.color || '#3b82f6', 
                  weight: activeHighlight 
                    ? (isHighlighted ? getZoomWeight(baseWeights.standardActive, currentZoom) : getZoomWeight(baseWeights.standardDimmed, currentZoom)) 
                    : getZoomWeight(baseWeights.standard, currentZoom), 
                  opacity: activeHighlight ? (isHighlighted ? 1.0 : 0.15) : 0.8, 
                  dashArray: seg.dashArray || null 
                }} 
              >
                {renderSegmentTooltip(seg, index)}
              </Polyline>
            );
        })}

        {((config.overlayMetric !== 'None') || (activeHighlight?.type === 'metric')) && overlayPolylines}

        {mapMarkers.map(m => {
          if (m.isDirectional) return <Marker key={m.id} position={m.pos} icon={m.icon} />;
          return (
            <CircleMarker key={m.id} center={m.pos} radius={modeConfig.markerRadius} pathOptions={{ color: 'white', fillColor: m.color, fillOpacity: 1, weight: 2 }}>
              <Tooltip direction="top" offset={[0, -10]} opacity={0.9} permanent 
                className={`font-bold rounded shadow-sm border-0 px-2 py-1 transition-colors duration-200 ${
                  isDark ? 'bg-slate-950 text-slate-200 border border-slate-800' : 'bg-white text-slate-800'
                }`} 
                style={{ fontSize: modeConfig.fontSize }}
              >
                {m.text}
              </Tooltip>
            </CircleMarker>
          );
        })}

        {hoveredTrackpoint && (
          <CircleMarker 
            key={`tracker-${hoveredTrackpoint.time}-${hoveredTrackpoint.latitude}`} 
            center={[hoveredTrackpoint.latitude, hoveredTrackpoint.longitude]} 
            radius={modeConfig.markerRadius + 3} 
            pathOptions={{ 
              color: 'white', 
              fillColor: '#edc001', 
              fillOpacity: 1, 
              weight: 2.5,
              className: 'animate-pulse'
            }} 
          />
        )}
      </MapContainer>
    </div>
  );
}