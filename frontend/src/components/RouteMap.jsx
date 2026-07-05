import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap, useMapEvents, Marker, ZoomControl } from 'react-leaflet';
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

const STATE_COLORS = {
  'Running': '#3b82f6',
  'Walking': '#f97316',
  'Stopped': '#ef4444'
};

const THICKNESS_MODES = {
  thin: {
    weights: { standard: 2.0, standardActive: 4.0, standardDimmed: 0.8, overlay: 2.0, overlayActive: 4.0, overlayDimmed: 0.8 },
    arrowSize: 11,
    arrowStroke: 1.5,
    fontSize: '9px',
    markerRadius: 3
  },
  medium: {
    weights: { standard: 3.5, standardActive: 5.5, standardDimmed: 1.5, overlay: 4.5, overlayActive: 6.5, overlayDimmed: 1.5 },
    arrowSize: 15,
    arrowStroke: 2.5,
    fontSize: '11px',
    markerRadius: 4
  },
  thick: {
    weights: { standard: 5.5, standardActive: 7.5, standardDimmed: 2.2, overlay: 6.5, overlayActive: 8.5, overlayDimmed: 2.0 },
    arrowSize: 19,
    arrowStroke: 3.5,
    fontSize: '13px',
    markerRadius: 5
  }
};

const REF_ZOOM = 14;

const getZoomWeight = (baseWeight, currentZoom) => {
  if (currentZoom >= REF_ZOOM) return baseWeight; 
  return Math.max(1.0, baseWeight * (currentZoom / REF_ZOOM));       
};

const getPercentile = (data, p) => {
  if (!data || data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  return sorted[Math.floor(index)] * (1 - (index % 1)) + sorted[Math.ceil(index)] * (index % 1);
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
  return ((Math.atan2(Math.sin(dLon) * Math.cos(lat2Rad), Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)) * 180) / Math.PI + 360) % 360;
};

const formatPace = (decimalMins) => {
  if (decimalMins == null || isNaN(decimalMins)) return "-:--";
  return `${Math.floor(decimalMins)}:${Math.round((decimalMins - Math.floor(decimalMins)) * 60).toString().padStart(2, '0')} /km`;
};

function FitBounds({ coords, isMobileFrame, mobileDrawerOpen, mobileTab }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.length > 0) {
      let bottomOffsetPadding = 50;
      let topOffsetPadding = 50;

      if (isMobileFrame && mobileDrawerOpen) {
        // Nudge padding: 110px from the top (to clear header/controls)
        topOffsetPadding = 110; 
        // 72% offset from the bottom keeps it centered entirely in the visible upper pane
        bottomOffsetPadding = mobileTab === 'charts' ? window.innerHeight * 0.44 : window.innerHeight * 0.72;
      }

      map.fitBounds(coords, { 
        paddingTopLeft: [40, topOffsetPadding],
        paddingBottomRight: [40, bottomOffsetPadding],
        animate: true,
        duration: 0.5
      });
    }
  }, [coords, map, isMobileFrame, mobileDrawerOpen, mobileTab]);
  return null;
}

function ZoomTracker({ onZoomChange }) {
  const map = useMapEvents({ zoomend() { onZoomChange(map.getZoom()); } });
  return null;
}

function RecenterButton({ coords, isDark, isMobileFrame }) {
  const map = useMap();
  return (
    <button
      type="button"
      onClick={() => { if (coords && coords.length > 0) map.invalidateSize(); }}
      className={`absolute z-[1000] p-2.5 rounded-xl shadow-lg border transition-all active:scale-95 flex items-center justify-center ${
        isMobileFrame ? 'bottom-4 right-3' : 'top-4 right-4'
      } ${isDark ? 'bg-slate-900 text-slate-200 border-slate-800' : 'bg-white text-slate-700 border-slate-200'}`}
      title="Recenter Visible Viewport"
    >
      <Crosshair className="w-4 h-4" />
    </button>
  );
}

export default function RouteMap({ segments, trackpoints, config, splits, activeHighlight, hoveredTrackpoint, setActiveHighlight, theme, isMobileFrame = false, mobileDrawerOpen = false, mobileTab = 'summary' }) {
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

    let motionEmoji = "👟";
    if (stateLabel === "Walking") motionEmoji = "🚶";
    if (stateLabel === "Stopped") motionEmoji = "🛑";

    return (
      <Tooltip sticky permanent={false} direction="top">
        <div className="bg-slate-950 text-white p-2.5 rounded-lg shadow-xl text-xs font-medium border border-slate-800 leading-normal min-w-[150px]">
          <div className="font-extrabold border-b border-slate-800 pb-1 mb-1 text-blue-400 flex items-center justify-between">
            <span>{motionEmoji} {stateLabel}</span>
            <span className="text-[10px] text-slate-500 font-normal">Interval {idx + 1}</span>
          </div>
          <div className="space-y-0.5 text-slate-400">
            <div className="flex justify-between"><span>Dist:</span><span className="font-bold text-white">{distKm} km</span></div>
            <div className="flex justify-between"><span>Pace:</span><span className="font-bold text-white">{formatPace(seg.avg_pace_min_per_km)}</span></div>
            <div className="flex justify-between"><span>Avg HR:</span><span className="font-bold text-white">{seg.avg_hr_bpm ? `${Math.round(seg.avg_hr_bpm)} bpm` : '-'}</span></div>
            <div className="flex justify-between"><span>Cadence:</span><span className="font-bold text-white">{cadenceVal ? `${Math.round(cadenceVal)} spm` : '-'}</span></div>
            <div className="flex justify-between"><span>Elev:</span><span className={`font-bold ${elevDeltaStr.startsWith('+') ? 'text-emerald-400' : 'text-rose-400'}`}>{elevDeltaStr}</span></div>
          </div>
        </div>
      </Tooltip>
    );
  };

  const evaluateTrackpointHighlight = useMemo(() => {
    return (tp, highlight) => {
      if (!highlight) return true;
      const hStart = highlight.start || highlight.start_time;
      const hEnd = highlight.end || highlight.end_time;
      if (hStart && hEnd) return tp.time >= hStart && tp.time <= hEnd;

      if (highlight.type === 'split' && highlight.index !== undefined) {
        const targetSplit = splits?.find(s => s.index === highlight.index);
        if (targetSplit) return tp.time >= targetSplit.start_time && tp.time <= targetSplit.end_time;
        return tp._distance_m >= (highlight.index - 1) * 1000 && tp._distance_m <= highlight.index * 1000;
      }

      if (highlight.type === 'metric') {
        const val = tp[`_${highlight.metricKey}`];
        if (val == null) return false;
        if (highlight.isFirstBin) return val <= highlight.max;
        if (highlight.isLastBin) return val >= highlight.min;
        return val >= highlight.min && val <= highlight.max;
      }
      return false;
    };
  }, [splits]);

  const baseStandardPolylines = useMemo(() => {
    if (config.overlayMetric !== 'None' || (activeHighlight?.type === 'metric')) return [];
    if (enrichedTrackpoints.length === 0) return [];

    const segmentsList = [];
    let currentChunk = [];
    let currentState = null;
    let currentHighlightStatus = null;
    const baseWeights = modeConfig.weights;

    for (let i = 0; i < enrichedTrackpoints.length; i++) {
      const tp = enrichedTrackpoints[i];
      if (!config.motionTypes[tp._motionState]) {
        if (currentChunk.length > 1) segmentsList.push({ coords: currentChunk, state: currentState, highlighted: currentHighlightStatus });
        currentChunk = []; currentState = null; continue;
      }

      const isHighlighted = evaluateTrackpointHighlight(tp, activeHighlight);
      if (currentState === null) { currentState = tp._motionState; currentHighlightStatus = isHighlighted; }

      if (tp._motionState !== currentState || isHighlighted !== currentHighlightStatus) {
        if (currentChunk.length > 0) {
          currentChunk.push([tp.latitude, tp.longitude]);
          segmentsList.push({ coords: currentChunk, state: currentState, highlighted: currentHighlightStatus });
        }
        currentChunk = [[tp.latitude, tp.longitude]]; currentState = tp._motionState; currentHighlightStatus = isHighlighted;
      } else {
        currentChunk.push([tp.latitude, tp.longitude]);
      }
    }
    if (currentChunk.length > 1) segmentsList.push({ coords: currentChunk, state: currentState, highlighted: currentHighlightStatus });

    return segmentsList.map((chunk, idx) => {
      const pathColor = STATE_COLORS[chunk.state] || '#3b82f6';
      const weight = activeHighlight ? (chunk.highlighted ? getZoomWeight(baseWeights.standardActive, currentZoom) : getZoomWeight(baseWeights.standardDimmed, currentZoom)) : getZoomWeight(baseWeights.standard, currentZoom);
      
      const parentSegmentIndex = segments.findIndex(seg => chunk.coords[0] && chunk.coords[0][0] === seg.coords[0][0]);
      const matchedSegment = segments[parentSegmentIndex] || segments[0];

      return (
        <Polyline key={`base-chunk-${idx}`} positions={chunk.coords} className="custom-leaflet-track-vector" pathOptions={{ color: pathColor, weight: weight, opacity: activeHighlight ? (chunk.highlighted ? 1.0 : 0.12) : 0.85, lineCap: 'round', strokeLinejoin: 'round' }}>
           {matchedSegment && renderSegmentTooltip(matchedSegment, parentSegmentIndex >= 0 ? parentSegmentIndex : idx)}
        </Polyline>
      );
    });
  }, [enrichedTrackpoints, config.overlayMetric, config.motionTypes, activeHighlight, currentZoom, modeConfig, evaluateTrackpointHighlight, segments]);

  const overlayPolylines = useMemo(() => {
    const activeMetricTab = config.overlayMetric !== 'None' ? config.overlayMetric : (activeHighlight?.type === 'metric' ? (activeHighlight.metricKey === 'heart_rate_bpm' ? 'Heart Rate' : 'Cadence') : 'None');
    if (activeMetricTab === 'None' || enrichedTrackpoints.length === 0) return [];
    
    const internalKey = `_${METRIC_KEYS[activeMetricTab]}`; 
    const interpolator = COLOR_SCALES[config.colorScale] || COLOR_SCALES['viridis'];
    const validValues = enrichedTrackpoints.map(tp => config.motionTypes[tp._motionState] ? tp[internalKey] : null).filter(v => v != null && isFinite(v));
    if (validValues.length === 0) return [];

    let min = getPercentile(validValues, 0.05), max = getPercentile(validValues, 0.95);
    if (internalKey === '_pace_min_per_km') max = Math.min(max, 12.0);
    if (internalKey === '_cadence') min = Math.max(min, 100);
    if (min === max) max = min + 1;

    const colorScale = d3Scale.scaleLinear().domain([min, max]).range([0, 1]).clamp(true);
    const lines = [];
    const baseWeights = modeConfig.weights;

    for (let i = 0; i < enrichedTrackpoints.length - 1; i++) {
      const p1 = enrichedTrackpoints[i], p2 = enrichedTrackpoints[i + 1];
      if (!config.motionTypes[p1._motionState]) continue;

      let val = p1[internalKey]; if (val == null) continue;
      let colorVal = colorScale(val); if (internalKey === '_pace_min_per_km' || config.colorScale === 'warmcool') colorVal = 1 - colorVal;

      const isPointSelected = evaluateTrackpointHighlight(p1, activeHighlight);
      const parentSegmentIndex = segments.findIndex(seg => p1.time >= seg.start_time && p1.time <= seg.end_time);
      const matchedSegment = segments[parentSegmentIndex];

      lines.push(
        <Polyline key={i} positions={[[p1.latitude, p1.longitude], [p2.latitude, p2.longitude]]} className="custom-leaflet-track-vector" pathOptions={{ color: interpolator(colorVal), weight: activeHighlight ? (isPointSelected ? getZoomWeight(baseWeights.overlayActive, currentZoom) : getZoomWeight(baseWeights.overlayDimmed, currentZoom)) : getZoomWeight(baseWeights.overlay, currentZoom), opacity: activeHighlight ? (isPointSelected ? 1.0 : 0.12) : 0.9, lineCap: 'round', strokeLinejoin: 'round' }}>
           {matchedSegment && renderSegmentTooltip(matchedSegment, parentSegmentIndex)}
        </Polyline>
      );
    }
    return lines;
  }, [enrichedTrackpoints, config.overlayMetric, config.colorScale, config.motionTypes, activeHighlight, currentZoom, modeConfig, evaluateTrackpointHighlight, segments]);

  const mapMarkers = useMemo(() => {
    if (!trackpoints || trackpoints.length === 0) return [];
    const markers = [];

    if (config.markers.Kilometre && splits && splits.length > 0) {
      splits.forEach(split => {
         // FIXED: Replaced brittle timestamp comparison with robust distance lookup based on your diagnostic
         const tp = trackpoints.find(t => (t.distance_m || t._distance_m) >= split.index * 1000);
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

  if (!segments || segments.length === 0 || !config) return null;

  return (
    <div className="absolute inset-0 rounded-xl overflow-hidden z-0 w-full h-full">
      <MapContainer style={{ height: '100%', width: '100%' }} zoom={13} scrollWheelZoom={true} zoomControl={false}>
        <TileLayer key={config.baseMap} url={BASE_MAPS[config.baseMap] || BASE_MAPS['Standard']} attribution='&copy; OpenStreetMap contributors' />
        <FitBounds coords={allCoords} isMobileFrame={isMobileFrame} mobileDrawerOpen={mobileDrawerOpen} mobileTab={mobileTab} />
        <ZoomTracker onZoomChange={setCurrentZoom} />

        <RecenterButton coords={allCoords} isDark={isDark} isMobileFrame={isMobileFrame} />

        {/* FIXED: Shift scale handles to bottomright to avoid red close (X) overlay overlap */}
        <ZoomControl position="bottomright" />
        
        {baseStandardPolylines}
        {overlayPolylines}

        {mapMarkers.map(m => {
          if (m.isDirectional) return <Marker key={m.id} position={m.pos} icon={m.icon} />;
          return (
            <CircleMarker key={m.id} center={m.pos} radius={modeConfig.markerRadius} pathOptions={{ color: 'white', fillColor: m.color, fillOpacity: 1, weight: 2 }}>
              <Tooltip direction="top" offset={[0, -10]} opacity={0.9} permanent className={`font-bold rounded shadow-sm border-0 px-2 py-0.5 ${isDark ? 'bg-slate-950 text-slate-200 border border-slate-800' : 'bg-white text-slate-800'}`} style={{ fontSize: modeConfig.fontSize }}>{m.text}</Tooltip>
            </CircleMarker>
          );
        })}

        {/* FIXED: Replaced standard key with dynamic coordinate-bound key to force React component mounting/unmounting */}
        {hoveredTrackpoint && (
          <CircleMarker 
            key={`hover-${hoveredTrackpoint.latitude}-${hoveredTrackpoint.longitude}`}
            center={[hoveredTrackpoint.latitude, hoveredTrackpoint.longitude]} 
            radius={modeConfig.markerRadius + 3} 
            pathOptions={{ color: 'white', fillColor: '#edc001', fillOpacity: 1, weight: 2.5 }} 
          />
        )}
      </MapContainer>
    </div>
  );
}