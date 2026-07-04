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

const METRIC_KEYS = { 'Pace': 'pace_min_per_km', 'Heart Rate': 'heart_rate_bpm', 'Cadence': 'cadence' };
const STATE_COLORS = { 'Running': '#3b82f6', 'Walking': '#f97316', 'Stopped': '#ef4444' };

const THICKNESS_MODES = {
  thin: { weights: { standard: 2.0, standardActive: 4.0, standardDimmed: 0.8, overlay: 2.0, overlayActive: 4.0, overlayDimmed: 0.8 }, arrowSize: 11, arrowStroke: 1.5, fontSize: '9px', markerRadius: 3 },
  medium: { weights: { standard: 3.5, standardActive: 5.5, standardDimmed: 1.5, overlay: 4.5, overlayActive: 6.5, overlayDimmed: 1.5 }, arrowSize: 15, arrowStroke: 2.5, fontSize: '11px', markerRadius: 4 },
  thick: { weights: { standard: 5.5, standardActive: 7.5, standardDimmed: 2.2, overlay: 6.5, overlayActive: 8.5, overlayDimmed: 2.0 }, arrowSize: 19, arrowStroke: 3.5, fontSize: '13px', markerRadius: 5 }
};

const REF_ZOOM = 14;
const getZoomWeight = (baseWeight, currentZoom) => currentZoom >= REF_ZOOM ? baseWeight : Math.max(1.0, baseWeight * (currentZoom / REF_ZOOM));       
const getPercentile = (data, p) => {
  if (!data || data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  return sorted[Math.floor(index)] * (1 - (index % 1)) + sorted[Math.ceil(index)] * (index % 1);
};
const formatTimeHHMMSS = (totalSeconds) => {
  const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60), s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};
const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const dLon = (lon2 - lon1) * (Math.PI / 180), lat1Rad = lat1 * (Math.PI / 180), lat2Rad = lat2 * (Math.PI / 180);
  return ((Math.atan2(Math.sin(dLon) * Math.cos(lat2Rad), Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon)) * 180) / Math.PI + 360) % 360;
};
const formatPace = (decimalMins) => {
  if (decimalMins == null || isNaN(decimalMins)) return "-:--";
  return `${Math.floor(decimalMins)}:${Math.round((decimalMins - Math.floor(decimalMins)) * 60).toString().padStart(2, '0')} /km`;
};

// FIXED #8: Highly optimized viewport offsets for mobile bounds centering
function FitBounds({ coords, isMobileFrame, mobileDrawerOpen, mobileTab }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.length > 0) {
      let topPad = 50, botPad = 50;
      if (isMobileFrame && mobileDrawerOpen) {
        topPad = 75; 
        botPad = mobileTab === 'charts' ? window.innerHeight * 0.38 : window.innerHeight * 0.52;
      }
      map.fitBounds(coords, { paddingTopLeft: [40, topPad], paddingBottomRight: [40, botPad], animate: true, duration: 0.5 });
    }
  }, [coords, map, isMobileFrame, mobileDrawerOpen, mobileTab]);
  return null;
}

function ZoomTracker({ onZoomChange }) {
  const map = useMapEvents({ zoomend() { onZoomChange(map.getZoom()); } });
  return null;
}

function RecenterButton({ coords, isDark, isMobileFrame, mobileDrawerOpen, mobileTab }) {
  const map = useMap();
  const bottomOffset = mobileDrawerOpen ? (mobileTab === 'charts' ? 'calc(40vh + 15px)' : 'calc(55vh + 15px)') : '20px';
  return (
    <button
      type="button"
      onClick={() => { if (coords && coords.length > 0) map.invalidateSize(); }}
      className={`absolute z-[1000] p-2 rounded-xl shadow-md border transition-all active:scale-95 flex items-center justify-center ${
        isMobileFrame ? 'right-3' : 'top-4 right-4'
      } ${isDark ? 'bg-slate-900/90 text-slate-200 border-slate-800' : 'bg-white/90 text-slate-700 border-slate-200'}`}
      style={isMobileFrame ? { bottom: bottomOffset, transition: 'bottom 0.3s ease-in-out' } : {}}
      title="Recenter Map"
    >
      <Crosshair className="w-4 h-4" />
    </button>
  );
}

export default function RouteMap({ segments, trackpoints, config, splits, activeHighlight, hoveredTrackpoint, setActiveHighlight, theme, isMobileFrame = false, mobileDrawerOpen = false, mobileTab = 'summary' }) {
  const [currentZoom, setCurrentZoom] = useState(13);
  const isDark = theme === 'dark';

  const allCoords = useMemo(() => (!segments || segments.length === 0) ? [] : segments.flatMap(seg => seg.coords), [segments]);
  const modeConfig = useMemo(() => THICKNESS_MODES[config?.thickness || 'medium'], [config?.thickness]);

  const enrichedTrackpoints = useMemo(() => {
    if (!trackpoints || !segments || segments.length === 0) return [];
    let lastKnown = { 'pace_min_per_km': null, 'heart_rate_bpm': null, 'cadence': null, 'altitude_m': null, 'distance_m': null };
    return trackpoints.map(tp => {
      const parentSeg = segments.find(seg => tp.time >= seg.start_time && tp.time <= seg.end_time);
      const enrichedTp = { ...tp, _motionState: parentSeg ? parentSeg.label.charAt(0).toUpperCase() + parentSeg.label.slice(1).toLowerCase() : "Running" };
      ['pace_min_per_km', 'heart_rate_bpm', 'cadence', 'altitude_m', 'distance_m'].forEach(key => {
        let val = tp[key];
        if (key === 'pace_min_per_km' && (val == null || isNaN(val))) val = parentSeg ? parentSeg.avg_pace_min_per_km : null;
        if (val != null && isFinite(val) && !isNaN(val)) lastKnown[key] = val;
        enrichedTp[`_${key}`] = lastKnown[key];
      });
      return enrichedTp;
    });
  }, [trackpoints, segments]);

  // FIXED #9: Swapped "Interval X" for the exact segment Start Time
  const renderSegmentTooltip = (seg) => {
    const stateLabel = seg.label.charAt(0).toUpperCase() + seg.label.slice(1).toLowerCase();
    const distKm = ((seg.distance_m || 0) / 1000).toFixed(2);
    const timeStr = seg.start_time ? seg.start_time.split(' ')[1] : '';
    const segPoints = enrichedTrackpoints.filter(t => t.time >= seg.start_time && t.time <= seg.end_time);
    let elevDeltaStr = "0.0 m";
    if (segPoints.length > 1) {
      const elevDiff = (segPoints[segPoints.length - 1]._altitude_m || 0) - (segPoints[0]._altitude_m || 0);
      elevDeltaStr = `${elevDiff >= 0 ? '+' : ''}${elevDiff.toFixed(1)} m`;
    }
    const motionEmoji = stateLabel === "Walking" ? "🚶" : stateLabel === "Stopped" ? "🛑" : "👟";

    return (
      <Tooltip sticky permanent={false} direction="top">
        <div className="bg-slate-950 text-white p-2 rounded-lg shadow-xl text-xs font-medium border border-slate-800 leading-normal min-w-[130px]">
          <div className="font-extrabold border-b border-slate-800 pb-1 mb-1 text-blue-400 flex items-center justify-between">
            <span>{motionEmoji} {stateLabel}</span>
            <span className="text-[9px] text-slate-500 font-normal">{timeStr}</span>
          </div>
          <div className="space-y-0.5 text-slate-400 text-[10px]">
            <div className="flex justify-between"><span>Dist:</span><span className="font-bold text-white">{distKm} km</span></div>
            <div className="flex justify-between"><span>Pace:</span><span className="font-bold text-white">{formatPace(seg.avg_pace_min_per_km)}</span></div>
            <div className="flex justify-between"><span>HR:</span><span className="font-bold text-white">{seg.avg_hr_bpm ? `${Math.round(seg.avg_hr_bpm)} bpm` : '-'}</span></div>
          </div>
        </div>
      </Tooltip>
    );
  };

  const evaluateTrackpointHighlight = useMemo(() => {
    return (tp, highlight) => {
      if (!highlight) return true;
      if (highlight.start && highlight.end) return tp.time >= highlight.start && tp.time <= highlight.end;
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
    if (config.overlayMetric !== 'None' || (activeHighlight?.type === 'metric') || enrichedTrackpoints.length === 0) return [];
    const segmentsList = []; let currentChunk = [], currentState = null, currentHighlightStatus = null;
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
      } else { currentChunk.push([tp.latitude, tp.longitude]); }
    }
    if (currentChunk.length > 1) segmentsList.push({ coords: currentChunk, state: currentState, highlighted: currentHighlightStatus });

    return segmentsList.map((chunk, idx) => {
      const weight = activeHighlight ? (chunk.highlighted ? getZoomWeight(baseWeights.standardActive, currentZoom) : getZoomWeight(baseWeights.standardDimmed, currentZoom)) : getZoomWeight(baseWeights.standard, currentZoom);
      const parentSegmentIndex = segments.findIndex(seg => chunk.coords[0] && chunk.coords[0][0] === seg.coords[0][0]);
      const matchedSegment = segments[parentSegmentIndex] || segments[0];
      return (
        <Polyline key={`base-chunk-${idx}`} positions={chunk.coords} className="custom-leaflet-track-vector" pathOptions={{ color: STATE_COLORS[chunk.state] || '#3b82f6', weight: weight, opacity: activeHighlight ? (chunk.highlighted ? 1.0 : 0.12) : 0.85, lineCap: 'round', strokeLinejoin: 'round' }}>
           {matchedSegment && renderSegmentTooltip(matchedSegment)}
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
    const lines = []; const baseWeights = modeConfig.weights;

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
           {matchedSegment && renderSegmentTooltip(matchedSegment)}
        </Polyline>
      );
    }
    return lines;
  }, [enrichedTrackpoints, config.overlayMetric, config.colorScale, config.motionTypes, activeHighlight, currentZoom, modeConfig, evaluateTrackpointHighlight, segments]);

  if (!segments || segments.length === 0 || !config) return null;

  return (
    <div className="absolute inset-0 rounded-xl overflow-hidden z-0 w-full h-full">
      {/* FIXED #1: Dynamic styling block pushes the Leaflet Zoom controls to the bottom edge of the visible map */}
      {isMobileFrame && (
        <style>{`
          .leaflet-bottom.leaflet-right {
            bottom: ${mobileDrawerOpen ? (mobileTab === 'charts' ? '40vh' : '55vh') : '20px'} !important;
            transition: bottom 0.3s ease-in-out;
            margin-right: 4px;
          }
        `}</style>
      )}

      <MapContainer style={{ height: '100%', width: '100%' }} zoom={13} scrollWheelZoom={true} zoomControl={false}>
        <TileLayer key={config.baseMap} url={BASE_MAPS[config.baseMap] || BASE_MAPS['Standard']} attribution='&copy; OpenStreetMap' />
        <FitBounds coords={allCoords} isMobileFrame={isMobileFrame} mobileDrawerOpen={mobileDrawerOpen} mobileTab={mobileTab} />
        <ZoomTracker onZoomChange={setCurrentZoom} />
        
        {/* Render Zoom Controls bottom right, Recenter button dynamically shifts */}
        <ZoomControl position={isMobileFrame ? "bottomright" : "bottomleft"} />
        <RecenterButton coords={allCoords} isDark={isDark} isMobileFrame={isMobileFrame} mobileDrawerOpen={mobileDrawerOpen} mobileTab={mobileTab} />
        
        {baseStandardPolylines}
        {overlayPolylines}
      </MapContainer>
    </div>
  );
}
