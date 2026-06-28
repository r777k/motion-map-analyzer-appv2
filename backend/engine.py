#!/usr/bin/env python3
import argparse
import csv
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import fitparse

import numpy as np
import pandas as pd

from functools import lru_cache
from geopy.geocoders import Photon

from zoneinfo import ZoneInfo
from timezonefinder import TimezoneFinder

import time
from contextlib import contextmanager

NS = {
    "tcx": "http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2",
    "ax": "http://www.garmin.com/xmlschemas/ActivityExtension/v2",
}

# =====================================================================
# TUNED CONSTANTS BLOCK (Lines 30-35)
# =====================================================================
TIME_FMT = "%Y-%m-%d %H:%M:%S"
MOVING_SPEED_THRESH = 0.8
STOP_SPEED_THRESH = 0.8
WALK_CADENCE_MAX = 140
WALK_SPEED_MAX = 2
DISPLAY_DECIMALS = 2
SMOOTHWINDOW = 2.5           # Tightened window to capture crisp sensor texturing
MIN_SEGMENT_TIME_S = 2.0     # Lowered from 5.0 to protect short walk intervals
MIN_SEGMENT_DIST_M = 2.0     # Lowered from 5.0 to protect short walk intervals
CADENCE_MULTIPLE = 2

ENRICH_SEGMENTS_TOLERANCE= "30s"#"15s"
TF = TimezoneFinder()
DEFAULT_TIMEZONE = "UTC"

#python consolidated_tcx_to_motion_map.6.1.py Morning_Run.20260518.0623.tcx Morning_Run.20260518.0623.csv
def parse_args():
    p = argparse.ArgumentParser(
        description="Convert Strava TCX to CSV, derive run/walk/stop segments using getrunstats.15.py logic, and generate motion map HTML."
    )
    p.add_argument("tcx_file", help="Input Strava/Garmin TCX file")
    p.add_argument(
        "-o",
        "--map-out",
        help="Output HTML motion map path (default: <prefix>_motion_map.html)",
    )
    p.add_argument(
        "--prefix",
        help="Optional prefix for intermediate files (default: tcx stem in same folder)",
    )
    p.add_argument(
        "--benchmark",
        action="store_true",
        help="Print execution time for pipeline stages and element counts.",
    )
    return p.parse_args()


def get_child_text(elem, path, default=None):
    if elem is None:
        return default
    child = elem.find(path, NS)
    return child.text if child is not None and child.text is not None else default


def parse_tcx_to_rows(tcx_path: Path):
    tree = ET.parse(tcx_path)
    root = tree.getroot()
    activities = root.find("tcx:Activities", NS)
    if activities is None:
        return
    for activity in activities.findall("tcx:Activity", NS):
        sport = activity.get("Sport")
        activity_id_elem = activity.find("tcx:Id", NS)
        activity_id = activity_id_elem.text if activity_id_elem is not None else None
        for lap in activity.findall("tcx:Lap", NS):
            lap_start_time = lap.get("StartTime")
            lap_total_time = get_child_text(lap, "tcx:TotalTimeSeconds")
            lap_distance = get_child_text(lap, "tcx:DistanceMeters")
            track = lap.find("tcx:Track", NS)
            if track is None:
                continue
            for tp in track.findall("tcx:Trackpoint", NS):
                time = get_child_text(tp, "tcx:Time")
                lat = get_child_text(tp, "tcx:Position/tcx:LatitudeDegrees")
                lon = get_child_text(tp, "tcx:Position/tcx:LongitudeDegrees")
                altitude = get_child_text(tp, "tcx:AltitudeMeters")
                distance = get_child_text(tp, "tcx:DistanceMeters")
                hr = get_child_text(tp, "tcx:HeartRateBpm/tcx:Value")
                cadence = get_child_text(tp, "tcx:Cadence")
                tpx = tp.find("tcx:Extensions/ax:TPX", NS)
                if tpx is None:
                    tpx = tp.find(".//{http://www.garmin.com/xmlschemas/ActivityExtension/v2}TPX")
                speed = None
                run_cadence = None
                watts = None
                if tpx is not None:
                    speed = get_child_text(tpx, "ax:Speed")
                    run_cadence = get_child_text(tpx, "ax:RunCadence")
                    watts = get_child_text(tpx, "ax:Watts")
                    if cadence is None and run_cadence is not None:
                        cadence = run_cadence
                yield {
                    "activity_id": activity_id,
                    "sport": sport,
                    "lap_start_time": lap_start_time,
                    "lap_total_time_s": lap_total_time,
                    "lap_distance_m": lap_distance,
                    "time": time,
                    "latitude": lat,
                    "longitude": lon,
                    "altitude_m": altitude,
                    "distance_m": distance,
                    "heart_rate_bpm": hr,
                    "cadence": cadence,
                    "speed_m_s": speed,
                    "run_cadence": run_cadence,
                    "watts": watts,
                }

def parse_fit_to_rows(fit_file_or_path):
    """Parses binary .fit files into the same dictionary structure as TCX."""
    fitfile = fitparse.FitFile(fit_file_or_path)
    
    for record in fitfile.get_messages("record"):
        data = {}
        for record_data in record:
            data[record_data.name] = record_data.value
            
        # FIT coordinates are stored as semicircles. Convert to standard degrees.
        lat = data.get("position_lat")
        lon = data.get("position_long")
        if lat is not None:
            lat = lat * (180.0 / (2**31))
        if lon is not None:
            lon = lon * (180.0 / (2**31))
            
        timestamp = data.get("timestamp")
        
        yield {
            "activity_id": None,
            "sport": "Run",
            "lap_start_time": None,
            "lap_total_time_s": None,
            "lap_distance_m": None,
            "time": str(timestamp) if timestamp else None,
            "latitude": lat,
            "longitude": lon,
            "altitude_m": data.get("altitude"),
            "distance_m": data.get("distance"),
            "heart_rate_bpm": data.get("heart_rate"),
            "cadence": data.get("cadence"),
            "speed_m_s": data.get("speed"),
            "run_cadence": data.get("cadence"),
            "watts": data.get("power"),
        }

def write_csv(rows, out_path: Path):
    rows = list(rows)
    if not rows:
        raise ValueError("No trackpoints found in TCX")
    fieldnames = [
        "activity_id", "sport", "lap_start_time", "lap_total_time_s", "lap_distance_m",
        "time", "latitude", "longitude", "altitude_m", "distance_m", "heart_rate_bpm",
        "cadence", "speed_m_s", "run_cadence", "watts"
    ]
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

def format_local_time(ts, tz_name=DEFAULT_TIMEZONE):
    if ts is None or pd.isna(ts):
        return "na"
    ts = pd.to_datetime(ts, utc=True, errors="coerce")
    if pd.isna(ts):
        return "na"
    try:
        return ts.tz_convert(ZoneInfo(tz_name)).strftime(TIME_FMT)
    except Exception:
        return ts.tz_convert(ZoneInfo(DEFAULT_TIMEZONE)).strftime(TIME_FMT)

def prepare_for_csv(df: pd.DataFrame, time_cols=None, round_decimals=DISPLAY_DECIMALS, tz_name=DEFAULT_TIMEZONE):
    if df.empty:
        return df
    out = df.copy()
    if time_cols:
        for col in time_cols:
            if col in out.columns:
                out[col] = out[col].apply(lambda x: format_local_time(x, tz_name=tz_name))
    for col in out.select_dtypes(include=["float", "float32", "float64"]).columns:
        out[col] = out[col].round(round_decimals)
    return out

def collapse_streams(df: pd.DataFrame) -> pd.DataFrame:
    """
    Collapse multi-stream TCX CSV (GPS, HR, speed rows) into one row per timestamp.
    Uses vectorized groupby aggregation for massive performance gains over manual loops.
    """
    if df.empty:
        return df

    df = df.copy()
    df["time"] = pd.to_datetime(df["time"], errors="coerce")
    df = df.dropna(subset=["time"]).sort_values("time")

    agg_rules = {}
    
    # Coordinates: take the first valid (non-null) entry per second
    for col in ["latitude", "longitude", "altitude_m"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
            agg_rules[col] = "first"
            
    # Metrics: take the mean of all entries in that second
    for col in ["heart_rate_bpm", "cadence", "speed_m_s", "run_cadence"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
            agg_rules[col] = "mean"

    if not agg_rules:
        return df.drop_duplicates(subset=["time"]).reset_index(drop=True)

    # Perform the aggregation in C-space
    collapsed = df.groupby("time", as_index=False).agg(agg_rules)
    
    return collapsed.sort_values("time").reset_index(drop=True)


def rebuild_distance_from_coords(df: pd.DataFrame) -> pd.DataFrame:
    """
    Always rebuild distance_m from latitude/longitude when they are present.
    Falls back to existing distance_m if coords are missing or unusable.
    """
    df = df.copy()
    if {"latitude", "longitude"} <= set(df.columns):
        lat_deg = pd.to_numeric(df["latitude"], errors="coerce")
        lon_deg = pd.to_numeric(df["longitude"], errors="coerce")
        if lat_deg.notna().sum() > 1 and lon_deg.notna().sum() > 1:
            lat = np.radians(lat_deg)
            lon = np.radians(lon_deg)
            dlat = lat.diff()
            dlon = lon.diff()
            R = 6371000.0
            a = np.sin(dlat / 2) ** 2 + np.cos(lat).shift(1) * np.cos(lat) * np.sin(dlon / 2) ** 2
            c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))
            dist_delta = R * c
            dist_delta.iloc[0] = 0.0
            df["distance_m"] = dist_delta.cumsum().ffill()
            return df

    # Fallback: keep any existing distance_m (or later speed-based fallback)
    if "distance_m" not in df.columns:
        df["distance_m"] = np.nan
    return df


def prepare_run_df(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if "time" not in df.columns:
        raise ValueError("'time' column missing")

    df = collapse_streams(df)

    if "cadence" not in df.columns and "run_cadence" in df.columns:
        df["cadence"] = df["run_cadence"]
    elif "cadence" in df.columns and "run_cadence" in df.columns:
        df["cadence"] = df["cadence"].fillna(df["run_cadence"])

    if "cadence" in df.columns:
        df["cadence"] = pd.to_numeric(df["cadence"], errors="coerce")

        run_cadence_missing = (
            "run_cadence" in df.columns and df["run_cadence"].notna().sum() == 0
        )
        cadence_median = df["cadence"].median(skipna=True)

        if run_cadence_missing and pd.notna(cadence_median) and 60 <= cadence_median < 110:
            df["cadence"] = df["cadence"] * CADENCE_MULTIPLE

    df = rebuild_distance_from_coords(df)

    if df["distance_m"].isna().all() and "speed_m_s" in df.columns:
        time_delta = df["time"].diff().dt.total_seconds().fillna(0.0)
        dist_delta = pd.to_numeric(df["speed_m_s"], errors="coerce").fillna(0.0) * time_delta
        df["distance_m"] = dist_delta.cumsum()

    return df

def add_deltas(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # Time delta
    df["time_delta_s"] = df["time"].diff().dt.total_seconds().fillna(0.0)

    # Distance delta
    if "distance_m" in df.columns:
        df["distance_delta_m"] = df["distance_m"].diff().fillna(0.0)
    else:
        df["distance_delta_m"] = np.nan

    # Fill missing speed from distance if needed
    if "speed_m_s" not in df.columns or df["speed_m_s"].isna().all():
        with np.errstate(divide="ignore", invalid="ignore"):
            df["speed_m_s"] = df["distance_delta_m"] / df["time_delta_s"].replace(0, np.nan)
    return df


def add_smoothed_speed(df: pd.DataFrame, window_s: float = SMOOTHWINDOW) -> pd.DataFrame:
    """
    Applies a tight moving-average filter across tracking coordinate sequences.
    Dialed down to preserve crisp micro-variations for high-fidelity runner analysis.
    """
    df = df.copy()
    if "distance_m" not in df.columns:
        return df

    df_ts = df[["time", "distance_m"]].dropna(subset=["time", "distance_m"]).copy()
    df_ts["time"] = pd.to_datetime(df_ts["time"], errors="coerce")
    df_ts["distance_m"] = pd.to_numeric(df_ts["distance_m"], errors="coerce")
    df_ts = df_ts.dropna(subset=["time", "distance_m"]).set_index("time").sort_index()

    if df_ts.empty:
        if "speed_m_s" in df.columns:
            df["speed_smooth_m_s"] = pd.to_numeric(df["speed_m_s"], errors="coerce").fillna(0.0)
        else:
            df["speed_smooth_m_s"] = 0.0
        return df

    # Rolling calculation bound to the tuned window configurations
    dist_roll = df_ts["distance_m"].rolling(f"{int(window_s)}s", min_periods=2).apply(
        lambda x: x.iloc[-1] - x.iloc[0],
        raw=False,
    )

    df["time"] = pd.to_datetime(df["time"], errors="coerce")
    df = df.merge(dist_roll.rename("dist_rolling"), left_on="time", right_index=True, how="left")

    if "dist_rolling" not in df.columns:
        df["dist_rolling"] = np.nan

    df["speed_smooth_m_s"] = df["dist_rolling"] / window_s

    if "speed_m_s" in df.columns:
        df["speed_smooth_m_s"] = df["speed_smooth_m_s"].fillna(
            pd.to_numeric(df["speed_m_s"], errors="coerce")
        )
    else:
        df["speed_smooth_m_s"] = df["speed_smooth_m_s"].fillna(0.0)

    return df

class SegmentStatsCalculator:
    """Pre-computes numpy arrays and cumulative sums to make segment slice math O(1)."""
    def __init__(self, work: pd.DataFrame):
        self.time = work["time"]
        
        # Cumulative sums for O(1) interval math
        td = pd.to_numeric(work.get("time_delta_s", pd.Series(np.zeros(len(work)))), errors="coerce").fillna(0.0).values
        dd = pd.to_numeric(work.get("distance_delta_m", pd.Series(np.zeros(len(work)))), errors="coerce").fillna(0.0).values
        self.cum_time = np.cumsum(td)
        self.cum_dist = np.cumsum(dd)
        
        def get_vals(col):
            if col in work.columns:
                return pd.to_numeric(work[col], errors="coerce").values
            return np.full(len(work), np.nan)
        
        self.hr = get_vals("heart_rate_bpm")
        self.cad = get_vals("cadence")
        self.speed_raw = get_vals("speed_m_s")
        self.speed_smooth = get_vals("speed_smooth_m_s")
        
        def get_str_labels(col):
            if col in work.columns:
                return work[col].values
            return np.full(len(work), None, dtype=object)

        self.raw_labels = get_str_labels("raw_motion_label")
        self.smoothed_labels = get_str_labels("motion_label")

    def get_stats(self, start_idx: int, end_idx: int) -> dict:
        start_idx = int(start_idx)
        end_idx = int(end_idx)
        n_points = end_idx - start_idx + 1
        
        if n_points > 1:
            duration_s = float(self.cum_time[end_idx] - self.cum_time[start_idx])
            distance_m = float(self.cum_dist[end_idx] - self.cum_dist[start_idx])
        else:
            duration_s = 0.0
            distance_m = 0.0

        sl = slice(start_idx, end_idx + 1)

        def safe_nanmean(arr):
            chunk = arr[sl]
            valid = chunk[~np.isnan(chunk)]
            return float(np.mean(valid)) if len(valid) > 0 else np.nan

        avg_hr = safe_nanmean(self.hr)
        avg_cad = safe_nanmean(self.cad)
        avg_speed_raw = safe_nanmean(self.speed_raw)
        avg_speed_smooth = safe_nanmean(self.speed_smooth)

        avg_speed = distance_m / duration_s if duration_s > 0 else np.nan
        avg_pace = ((duration_s / 60.0) / (distance_m / 1000.0)) if (duration_s > 0 and distance_m > 0) else np.nan

        # Mode and First calculations avoiding expensive Pandas logic
        valid_raw = [x for x in self.raw_labels[sl] if isinstance(x, str)]
        valid_smooth = [x for x in self.smoothed_labels[sl] if isinstance(x, str)]
        
        raw_label_first = valid_raw[0] if valid_raw else None
        smoothed_label_first = valid_smooth[0] if valid_smooth else None
        
        def mode_str(arr):
            if not arr: return None
            vals, counts = np.unique(arr, return_counts=True)
            return vals[np.argmax(counts)]

        raw_label_mode = mode_str(valid_raw)
        smoothed_label_mode = mode_str(valid_smooth)

        if duration_s <= 0 or np.isnan(avg_speed):
            final_label = "stopped"
        elif avg_speed < STOP_SPEED_THRESH:
            final_label = "stopped"
        elif avg_speed <= WALK_SPEED_MAX and (np.isnan(avg_cad) or avg_cad < WALK_CADENCE_MAX):
            final_label = "walking"
        else:
            final_label = "running"

        return {
            "label": final_label,
            "final_label": final_label,
            "raw_label_first": raw_label_first,
            "raw_label_mode": raw_label_mode,
            "smoothed_label_first": smoothed_label_first,
            "smoothed_label_mode": smoothed_label_mode,
            "start_time": self.time.iloc[start_idx],
            "end_time": self.time.iloc[end_idx],
            "duration_s": duration_s,
            "distance_m": distance_m,
            "avg_speed_m_s": avg_speed,
            "avg_speed_raw_m_s": avg_speed_raw,
            "avg_speed_smooth_m_s": avg_speed_smooth,
            "avg_pace_min_per_km": avg_pace,
            "avg_hr_bpm": avg_hr,
            "avg_cadence_spm": avg_cad,
            "n_points": n_points,
            "start_idx": start_idx,
            "end_idx": end_idx,
        }


def _merge_tiny_segments(calc: SegmentStatsCalculator, initial_segs: pd.DataFrame) -> list:
    if initial_segs.empty:
        return []

    stats_list = [calc.get_stats(int(r.start_idx), int(r.end_idx)) for r in initial_segs.itertuples(index=False)]

    def is_tiny(st):
        return (st["duration_s"] < MIN_SEGMENT_TIME_S and st["distance_m"] < MIN_SEGMENT_DIST_M) or (st["distance_m"] == 0.0)

    while True:
        tiny_idx = -1
        for i, st in enumerate(stats_list):
            if is_tiny(st):
                tiny_idx = i
                break
        
        if tiny_idx == -1:
            break
        
        if len(stats_list) == 1:
            break
            
        i = tiny_idx
        
        # Merge forward
        if i == 0:
            merged_start = stats_list[0]["start_idx"]
            merged_end = stats_list[1]["end_idx"]
            stats_list[0:2] = [calc.get_stats(merged_start, merged_end)]
            continue
            
        # Merge backward
        if i == len(stats_list) - 1:
            merged_start = stats_list[i-1]["start_idx"]
            merged_end = stats_list[i]["end_idx"]
            stats_list[i-1:i+1] = [calc.get_stats(merged_start, merged_end)]
            continue
        
        # Middle segment: check neighbors
        prev_stats = stats_list[i-1]
        this_stats = stats_list[i]
        next_stats = stats_list[i+1]
        
        prev_same = prev_stats["smoothed_label_mode"] == next_stats["smoothed_label_mode"]
        
        if prev_same:
            merged_start = prev_stats["start_idx"]
            merged_end = next_stats["end_idx"]
            stats_list[i-1:i+2] = [calc.get_stats(merged_start, merged_end)]
        else:
            prev_str = float(prev_stats["duration_s"]) + float(prev_stats["distance_m"]) / 10.0
            next_str = float(next_stats["duration_s"]) + float(next_stats["distance_m"]) / 10.0
            
            if prev_str >= next_str:
                merged_start = prev_stats["start_idx"]
                merged_end = this_stats["end_idx"]
                stats_list[i-1:i+1] = [calc.get_stats(merged_start, merged_end)]
            else:
                merged_start = this_stats["start_idx"]
                merged_end = next_stats["end_idx"]
                stats_list[i:i+2] = [calc.get_stats(merged_start, merged_end)]

    return stats_list


def classify_motion_row(speed_m_s, cadence_spm):
    if pd.isna(speed_m_s):
        return "stopped"
    if speed_m_s < STOP_SPEED_THRESH:
        return "stopped"
    if speed_m_s <= WALK_SPEED_MAX and (pd.isna(cadence_spm) or cadence_spm < WALK_CADENCE_MAX):
        return "walking"
    return "running"


def _majority_label_series(labels: pd.Series, window: int = 5) -> pd.Series:
    labels = pd.Series(labels).astype("object")
    if labels.empty or window <= 1:
        return labels

    order = ["stopped", "walking", "running"]
    rank = {k: i for i, k in enumerate(order)}

    out = []
    half = window // 2
    vals = labels.tolist()
    n = len(vals)

    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        chunk = [v for v in vals[lo:hi] if pd.notna(v)]
        if not chunk:
            out.append(np.nan)
            continue
        counts = pd.Series(chunk).value_counts()
        max_count = counts.max()
        tied = [lab for lab, cnt in counts.items() if cnt == max_count]
        tied.sort(key=lambda x: rank.get(x, 999))
        out.append(tied[-1])

    return pd.Series(out, index=labels.index)


def _initial_motion_segments(work: pd.DataFrame) -> pd.DataFrame:
    change = work["motion_label"].ne(work["motion_label"].shift()).cumsum()
    records = []
    for _, seg in work.groupby(change):
        if seg.empty:
            continue
        records.append(
            {
                "label": seg["motion_label"].iloc[0],
                "start_idx": int(seg.index[0]),
                "end_idx": int(seg.index[-1]),
            }
        )
    return pd.DataFrame(records)

# =====================================================================
# FULL UPDATED FUNCTION: summarize_motion_segments
# =====================================================================
def summarize_motion_segments(df: pd.DataFrame, smoothing_window: int = 3) -> pd.DataFrame:
    """
    Summarize raw time series points into distinct intervals.
    Default window size reduced to 3 rows to avoid drowning out micro walk breaks.
    """
    work = df.copy().sort_values("time").reset_index(drop=True)

    speed_smooth = pd.to_numeric(work.get("speed_smooth_m_s"), errors="coerce")
    speed_raw = pd.to_numeric(work.get("speed_m_s"), errors="coerce")
    cadence = pd.to_numeric(
        work.get("cadence", pd.Series(index=work.index, dtype=float)),
        errors="coerce"
    )

    speed_for_label = speed_smooth.fillna(speed_raw)

    work["raw_motion_label"] = [
        classify_motion_row(s, c) for s, c in zip(speed_for_label, cadence)
    ]

    if smoothing_window and smoothing_window > 1:
        work["motion_label"] = _majority_label_series(work["raw_motion_label"], window=smoothing_window)
    else:
        work["motion_label"] = work["raw_motion_label"]

    initial = _initial_motion_segments(work)
    
    calc = SegmentStatsCalculator(work)
    final_records = _merge_tiny_segments(calc, initial)

    out = pd.DataFrame(final_records)

    preferred_order = [
        "label", "final_label", "raw_label_first", "raw_label_mode",
        "smoothed_label_first", "smoothed_label_mode", "start_time",
        "end_time", "duration_s", "distance_m", "avg_speed_m_s",
        "avg_speed_raw_m_s", "avg_speed_smooth_m_s", "avg_pace_min_per_km",
        "avg_hr_bpm", "avg_cadence_spm", "n_points", "start_idx", "end_idx",
    ]

    cols = [c for c in preferred_order if c in out.columns] + [c for c in out.columns if c not in preferred_order]
    return out[cols]


def utc_to_local_string(series: pd.Series, tz_name=DEFAULT_TIMEZONE) -> pd.Series:
    ts = pd.to_datetime(series, utc=True, errors="coerce")
    try:
        return ts.dt.tz_convert(ZoneInfo(tz_name)).dt.strftime(TIME_FMT)
    except Exception:
        return ts.dt.tz_convert(ZoneInfo(DEFAULT_TIMEZONE)).dt.strftime(TIME_FMT)

def normalize_local_string(series: pd.Series) -> pd.Series:
    ts = pd.to_datetime(series, errors="coerce")
    return ts.dt.strftime(TIME_FMT)


def first_valid(series: pd.Series):
    s = series.dropna()
    return s.iloc[0] if not s.empty else None


# =====================================================================
# FULL UPDATED FUNCTION: collapse_run_streams_for_map
# =====================================================================
def collapse_run_streams_for_map(df: pd.DataFrame, tz_name=DEFAULT_TIMEZONE) -> pd.DataFrame:
    """
    Prepare the final collapsed run data for map output using vectorized aggregation.
    Explicitly whitelists and re-calculates high-fidelity pace vectors for chart delivery.
    """
    df = df.copy()
    df["time"] = utc_to_local_string(df["time"], tz_name=tz_name)
    
    numeric_cols = [
        "latitude", "longitude", "altitude_m", "distance_m",
        "heart_rate_bpm", "cadence", "speed_m_s", "run_cadence", "watts",
        "speed_smooth_m_s"  # Whitelisted high-res smoothing speed
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    agg_rules = {}
    
    # Metadata and coordinates: take first valid
    first_cols = [
        "activity_id", "sport", "lap_start_time", "lap_total_time_s", 
        "lap_distance_m", "latitude", "longitude", "altitude_m", "distance_m"
    ]
    for col in first_cols:
        if col in df.columns:
            agg_rules[col] = "first"
            
    # Metrics: take the mean per second slice
    mean_cols = ["heart_rate_bpm", "cadence", "speed_m_s", "run_cadence", "watts", "speed_smooth_m_s"]
    for col in mean_cols:
        if col in df.columns:
            agg_rules[col] = "mean"

    if not agg_rules:
        out = df.drop_duplicates(subset=["time"]).reset_index(drop=True)
    else:
        out = df.groupby("time", as_index=False).agg(agg_rules)
        out = out.sort_values("time").reset_index(drop=True)

    # Reconcile cadence
    if "cadence" in out.columns and "run_cadence" in out.columns:
        out["cadence"] = out["cadence"].fillna(out["run_cadence"])
    elif "cadence" not in out.columns and "run_cadence" in out.columns:
        out["cadence"] = out["run_cadence"]
        
    # CRITICAL FIX: Dynamically generate pace vectors for every single map trackpoint row
    if "speed_smooth_m_s" in out.columns:
        out["pace_min_per_km"] = pace_from_speed(out["speed_smooth_m_s"])
    elif "speed_m_s" in out.columns:
        out["pace_min_per_km"] = pace_from_speed(out["speed_m_s"])
        
    return out

def build_lookup(run_df_collapsed: pd.DataFrame) -> pd.DataFrame:
    needed = {"time", "latitude", "longitude"}
    missing = needed - set(run_df_collapsed.columns)
    if missing:
        raise ValueError(f"Missing columns for coordinate lookup: {sorted(missing)}")

    lookup = run_df_collapsed.copy()
    lookup["time_dt"] = pd.to_datetime(lookup["time"], errors="coerce")
    lookup["latitude"] = pd.to_numeric(lookup["latitude"], errors="coerce")
    lookup["longitude"] = pd.to_numeric(lookup["longitude"], errors="coerce")

    lookup = lookup.dropna(subset=["time_dt", "latitude", "longitude"])
    lookup = lookup.sort_values("time_dt").reset_index(drop=True)

    return lookup[["time_dt", "latitude", "longitude"]]

def enrich_segments(seg_df: pd.DataFrame, lookup: pd.DataFrame, tolerance=ENRICH_SEGMENTS_TOLERANCE) -> pd.DataFrame:
    seg_df = seg_df.copy()

    seg_df["start_time"] = normalize_local_string(seg_df["start_time"])
    seg_df["end_time"] = normalize_local_string(seg_df["end_time"])

    for col in ["avg_pace_min_per_km", "avg_hr_bpm", "avg_cadence_spm", "distance_m", "duration_s"]:
        if col in seg_df.columns:
            seg_df[col] = pd.to_numeric(seg_df[col], errors="coerce")

    seg_df["start_time_dt"] = pd.to_datetime(seg_df["start_time"], errors="coerce")
    seg_df["end_time_dt"] = pd.to_datetime(seg_df["end_time"], errors="coerce")

    start_match = pd.merge_asof(
        seg_df[["start_time_dt"]].sort_values("start_time_dt"),
        lookup.sort_values("time_dt"),
        left_on="start_time_dt",
        right_on="time_dt",
        direction="nearest",
        tolerance=pd.Timedelta(tolerance),
    )

    end_match = pd.merge_asof(
        seg_df[["end_time_dt"]].sort_values("end_time_dt"),
        lookup.sort_values("time_dt"),
        left_on="end_time_dt",
        right_on="time_dt",
        direction="nearest",
        tolerance=pd.Timedelta(tolerance),
    )

    start_match.index = seg_df.sort_values("start_time_dt").index
    end_match.index = seg_df.sort_values("end_time_dt").index

    seg_df.loc[start_match.index, "start_latitude"] = start_match["latitude"].values
    seg_df.loc[start_match.index, "start_longitude"] = start_match["longitude"].values
    seg_df.loc[end_match.index, "end_latitude"] = end_match["latitude"].values
    seg_df.loc[end_match.index, "end_longitude"] = end_match["longitude"].values

    return seg_df


def build_segments_payload(run_df_collapsed: pd.DataFrame, seg_df: pd.DataFrame):
    style_map = {
        "running": {"dashArray": None},
        "walking": {"dashArray": "10 8"},
        "stopped": {"dashArray": "2 10"},
    }

    plot_df = run_df_collapsed.dropna(subset=["latitude", "longitude"]).copy()
    plot_df["time_dt"] = pd.to_datetime(plot_df["time"], errors="coerce")
    plot_df["latitude"] = pd.to_numeric(plot_df["latitude"], errors="coerce")
    plot_df["longitude"] = pd.to_numeric(plot_df["longitude"], errors="coerce")
    plot_df = plot_df.dropna(subset=["time_dt", "latitude", "longitude"]).sort_values("time_dt").reset_index(drop=True)

    payload = []

    for _, row in seg_df.iterrows():
        label = str(row.get("label", "unknown")).strip().lower()
        st = row["start_time"]
        et = row["end_time"]

        st_dt = pd.to_datetime(st, errors="coerce")
        et_dt = pd.to_datetime(et, errors="coerce")

        seg_pts = plot_df[
            (plot_df["time_dt"] >= st_dt) & (plot_df["time_dt"] <= et_dt)
        ][["latitude", "longitude", "time", "time_dt"]].copy()

        # Fallback: if no points in range, take nearest start/end points
        if seg_pts.empty and pd.notna(st_dt) and pd.notna(et_dt) and not plot_df.empty:
            start_idx = (plot_df["time_dt"] - st_dt).abs().idxmin()
            end_idx = (plot_df["time_dt"] - et_dt).abs().idxmin()

            lo = min(start_idx, end_idx)
            hi = max(start_idx, end_idx)

            seg_pts = plot_df.loc[lo:hi, ["latitude", "longitude", "time", "time_dt"]].copy()

            # If still only one point, duplicate it so Leaflet can draw something
            if seg_pts.empty:
                nearest_idx = (plot_df["time_dt"] - st_dt).abs().idxmin()
                seg_pts = plot_df.loc[[nearest_idx], ["latitude", "longitude", "time", "time_dt"]].copy()

        if seg_pts.empty:
            continue

        coords = seg_pts[["latitude", "longitude"]].values.tolist()
        if len(coords) == 1:
            coords = coords + coords

        payload.append({
            "label": label,
            "start_time": st,
            "end_time": et,
            "distance_m": None if pd.isna(row.get("distance_m")) else float(row.get("distance_m")),
            "duration_s": None if pd.isna(row.get("duration_s")) else float(row.get("duration_s")),
            "avg_pace_min_per_km": None if pd.isna(row.get("avg_pace_min_per_km")) else float(row.get("avg_pace_min_per_km")),
            "avg_hr_bpm": None if pd.isna(row.get("avg_hr_bpm")) else float(row.get("avg_hr_bpm")),
            "avg_cadence_spm": None if pd.isna(row.get("avg_cadence_spm")) else float(row.get("avg_cadence_spm")),
            "coords": coords,
            "dashArray": style_map.get(label, {"dashArray": "4 6"})["dashArray"],
        })

    return payload, plot_df


def weighted_percentile(values, weights, q):
    if len(values) == 0:
        return None
    order = np.argsort(values)
    v = np.asarray(values)[order]
    w = np.asarray(weights)[order]
    cum_w = np.cumsum(w)
    total_w = cum_w[-1]
    if total_w <= 0:
        return None
    target = q * total_w
    idx = np.searchsorted(cum_w, target, side="left")
    idx = min(idx, len(v) - 1)
    return float(v[idx])


def compute_weighted_histogram(values, weights, vmin, vmax, bins=8):
    if len(values) == 0:
        return [1.0], [0.0, 1.0]
    hist_weights, hist_edges = np.histogram(values, bins=bins, range=(vmin, vmax), weights=weights)
    return hist_weights.tolist(), hist_edges.tolist()


def compute_metric_stats(seg_df: pd.DataFrame):
    required_base_cols = {"label", "distance_m"}
    missing_base = required_base_cols - set(seg_df.columns)
    if missing_base:
        raise ValueError(
            f"compute_metric_stats: missing required columns: {sorted(missing_base)}"
        )

    stats = {}
    metric_specs = {
        "pace": {
            "col": "avg_pace_min_per_km",
            "exclude_labels": {"stopped"},
            "q_low": 0.05,
            "q_high": 0.95,
            "bins": 8,
        },
        "hr": {
            "col": "avg_hr_bpm",
            "exclude_labels": set(),
            "q_low": 0.05,
            "q_high": 0.95,
            "bins": 8,
        },
        "cadence": {
            "col": "avg_cadence_spm",
            "exclude_labels": {"stopped"},
            "q_low": 0.05,
            "q_high": 0.95,
            "bins": 8,
        },
    }

    metric_cols = {spec["col"] for spec in metric_specs.values()}
    missing_metric_cols = metric_cols - set(seg_df.columns)
    if missing_metric_cols:
        raise ValueError(
            f"compute_metric_stats: missing metric columns: {sorted(missing_metric_cols)}"
        )

    for metric, spec in metric_specs.items():
        col = spec["col"]
        work = seg_df.copy()

        if spec["exclude_labels"]:
            work = work[~work["label"].isin(spec["exclude_labels"])]

        work[col] = pd.to_numeric(work[col], errors="coerce")
        work["distance_m"] = pd.to_numeric(work["distance_m"], errors="coerce")
        work = work.dropna(subset=[col, "distance_m"])
        work = work[work["distance_m"] > 0]

        if work.empty:
            stats[metric] = {
                "min": 0.0,
                "mid": 0.5,
                "max": 1.0,
                "hist_edges": [0.0, 1.0],
                "hist_weights": [1.0],
                "underflow_weight": 0.0,
                "overflow_weight": 0.0,
                "total_weight": 1.0,
                "weight_unit": "m",
            }
            continue

        values = work[col].to_numpy(dtype=float)
        weights = work["distance_m"].to_numpy(dtype=float)

        q_low = weighted_percentile(values, weights, spec["q_low"])
        q_high = weighted_percentile(values, weights, spec["q_high"])

        trimmed_mask = (values >= q_low) & (values <= q_high)
        trimmed_values = values[trimmed_mask]
        trimmed_weights = weights[trimmed_mask]

        if len(trimmed_values) == 0:
            trimmed_values = values
            trimmed_weights = weights

        vmin = float(np.min(trimmed_values))
        vmax = float(np.max(trimmed_values))
        vmid = weighted_percentile(trimmed_values, trimmed_weights, 0.5)

        if vmax <= vmin:
            vmax = vmin + 1e-9

        hist_weights, hist_edges = compute_weighted_histogram(
            trimmed_values,
            trimmed_weights,
            vmin,
            vmax,
            bins=spec["bins"],
        )

        underflow_weight = float(np.sum(weights[values < vmin]))
        overflow_weight = float(np.sum(weights[values > vmax]))

        stats[metric] = {
            "min": vmin,
            "mid": float(vmid),
            "max": vmax,
            "hist_edges": [float(x) for x in hist_edges],
            "hist_weights": [float(x) for x in hist_weights],
            "underflow_weight": underflow_weight,
            "overflow_weight": overflow_weight,
            "total_weight": float(np.sum(weights)),
            "trimmed_weight": float(np.sum(trimmed_weights)),
            "weight_unit": "m",
        }

    return stats

def format_hms(seconds):
    if seconds is None or pd.isna(seconds):
        return "n/a"
    seconds = int(round(float(seconds)))
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:02d}"

def format_pace(min_per_km):
    if min_per_km is None or pd.isna(min_per_km) or np.isinf(min_per_km):
        return "n/a"
    total_sec = int(round(float(min_per_km) * 60.0))
    mm = total_sec // 60
    ss = total_sec % 60
    return f"{mm}:{ss:02d} min/km"

def format_speed(speed_m_s):
    if speed_m_s is None or pd.isna(speed_m_s):
        return "n/a"
    return f"{float(speed_m_s):.2f} m/s"

def format_km(distance_m):
    if distance_m is None or pd.isna(distance_m):
        return "n/a"
    return f"{float(distance_m) / 1000.0:.2f} km"

def format_meters(m):
    if m is None or pd.isna(m):
        return "n/a"
    return f"{float(m):.1f} m"

def basic_time_distance(df: pd.DataFrame):
    if df.empty:
        return {
            "total_distance_m": np.nan,
            "elapsed_time_s": np.nan,
            "moving_time_s": np.nan,
            "moving_distance_m": np.nan,
        }

    total_distance_m = (
        float(df["distance_m"].max() - df["distance_m"].min())
        if "distance_m" in df.columns and df["distance_m"].notna().any()
        else np.nan
    )
    elapsed_time_s = float((df["time"].iloc[-1] - df["time"].iloc[0]).total_seconds())

    speed_for_motion = df.get("speed_smooth_m_s", df.get("speed_m_s"))
    if speed_for_motion is None:
        moving_time_s = np.nan
        moving_distance_m = np.nan
    else:
        moving_mask = pd.to_numeric(speed_for_motion, errors="coerce") >= MOVING_SPEED_THRESH
        moving_time_s = float(df.loc[moving_mask, "time_delta_s"].sum()) if "time_delta_s" in df.columns else np.nan
        moving_distance_m = float(df.loc[moving_mask, "distance_delta_m"].sum()) if "distance_delta_m" in df.columns else np.nan

    return {
        "total_distance_m": total_distance_m,
        "elapsed_time_s": elapsed_time_s,
        "moving_time_s": moving_time_s,
        "moving_distance_m": moving_distance_m,
    }

def compute_ascent_descent(df: pd.DataFrame):
    if "altitude_m" not in df.columns:
        return np.nan, np.nan
    alt = pd.to_numeric(df["altitude_m"], errors="coerce")
    delta = alt.diff().fillna(0.0)
    ascent = float(delta.clip(lower=0).sum())
    descent = float((-delta.clip(upper=0)).sum())
    return ascent, descent

def summarize_motion_totals(seg_df: pd.DataFrame):
    out = {}
    if seg_df.empty:
        return out

    work = seg_df.copy()
    for col in ["duration_s", "distance_m"]:
        if col in work.columns:
            work[col] = pd.to_numeric(work[col], errors="coerce")

    grouped = work.groupby("label", dropna=False)
    for label, g in grouped:
        key = str(label).strip().lower()
        out[key] = {
            "segments": int(len(g)),
            "duration_s": float(g["duration_s"].sum()) if "duration_s" in g.columns else np.nan,
            "distance_m": float(g["distance_m"].sum()) if "distance_m" in g.columns else np.nan,
        }
    return out

@lru_cache(maxsize=128)
def lookup_timezone_name(lat: float, lon: float) -> str:
    try:
        tz_name = TF.timezone_at(lat=float(lat), lng=float(lon))
        if tz_name:
            return tz_name
    except Exception:
        pass
    return DEFAULT_TIMEZONE

def infer_activity_timezone_name(plot_df: pd.DataFrame) -> str:
    try:
        if plot_df.empty or not {"latitude", "longitude"}.issubset(plot_df.columns):
            return DEFAULT_TIMEZONE
        lat = pd.to_numeric(plot_df["latitude"], errors="coerce")
        lon = pd.to_numeric(plot_df["longitude"], errors="coerce")
        valid = pd.DataFrame({"lat": lat, "lon": lon}).dropna()
        if valid.empty:
            return DEFAULT_TIMEZONE
        center_lat = float((valid["lat"].min() + valid["lat"].max()) / 2.0)
        center_lon = float((valid["lon"].min() + valid["lon"].max()) / 2.0)
        return lookup_timezone_name(center_lat, center_lon)
    except Exception:
        return DEFAULT_TIMEZONE

@lru_cache(maxsize=128)
def reverse_geocode_city(lat: float, lon: float) -> str:
    """
    Reverse geocodes lat/lon to a city/town name.
    Uses Photon (Komoot) which is much more reliable on cloud servers than Nominatim.
    """
    if pd.isna(lat) or pd.isna(lon):
        return "Unknown location"
        
    try:
        # Photon is highly cloud-friendly
        geolocator = Photon(user_agent="motion_map_analyzer_v2")
        location = geolocator.reverse((lat, lon), exactly_one=True, timeout=10)
        
        if not location:
            return "Unknown location"
            
        # Photon stores the address data inside a 'properties' dictionary
        address = location.raw.get("properties", {})
        
        city = (
            address.get("city") or 
            address.get("town") or 
            address.get("county") or 
            address.get("district") or 
            address.get("state")
        )
        
        return city if city else "Unknown location"
        
    except Exception as e:
        print(f"Geocoding Error: {e}")
        return "Unknown location"


def build_run_summary_title(runstats: dict, plot_df: pd.DataFrame) -> str:
    start_text = runstats.get("start_time")
    title_date = "Unknown date"
    try:
        dt = pd.to_datetime(start_text, errors="coerce")
        if pd.notna(dt):
            title_date = dt.strftime("%d-%b-%Y")
    except Exception:
        pass

    location_text = "Unknown location"
    try:
        if not plot_df.empty and {"latitude", "longitude"}.issubset(plot_df.columns):
            lat = pd.to_numeric(plot_df["latitude"], errors="coerce").dropna()
            lon = pd.to_numeric(plot_df["longitude"], errors="coerce").dropna()
            if not lat.empty and not lon.empty:
                center_lat = float((lat.min() + lat.max()) / 2.0)
                center_lon = float((lon.min() + lon.max()) / 2.0)
                location_text = reverse_geocode_city(center_lat, center_lon)
    except Exception:
        pass

    return f"Run Summary — {title_date} — {location_text}"

def compute_run_stats(df: pd.DataFrame, segdf: pd.DataFrame, tz_name=DEFAULT_TIMEZONE):
    ti = basic_time_distance(df)

    moving_speed = np.nan
    moving_pace = np.nan
    if (
        pd.notna(ti["moving_time_s"])
        and pd.notna(ti["moving_distance_m"])
        and ti["moving_time_s"] > 0
        and ti["moving_distance_m"] > 0
    ):
        moving_speed = ti["moving_distance_m"] / ti["moving_time_s"]
        moving_pace = ti["moving_time_s"] / 60.0 / (ti["moving_distance_m"] / 1000.0)

    max_speed = np.nan
    max_pace = np.nan
    if "speed_m_s" in df.columns:
        speed = pd.to_numeric(df["speed_m_s"], errors="coerce")
        speed = speed[speed > 0]
        if not speed.empty:
            max_speed = float(speed.max())
            max_pace = 1000.0 / max_speed / 60.0

    avg_hr = np.nan
    max_hr = np.nan
    if "heart_rate_bpm" in df.columns:
        hr = pd.to_numeric(df["heart_rate_bpm"], errors="coerce")
        if hr.notna().any():
            avg_hr = float(hr.mean())
            max_hr = float(hr.max())

    avg_cad = np.nan
    max_cad = np.nan
    if "cadence" in df.columns:
        cad = pd.to_numeric(df["cadence"], errors="coerce")
        if cad.notna().any():
            avg_cad = float(cad.mean())
            max_cad = float(cad.max())

    ascent, descent = compute_ascent_descent(df)
    motion_totals = summarize_motion_totals(segdf)

    start_time = df["time"].iloc[0] if not df.empty else None
    end_time = df["time"].iloc[-1] if not df.empty else None

    return {
        "start_time": format_local_time(start_time, tz_name=tz_name) if start_time is not None else "na",
        "end_time": format_local_time(end_time, tz_name=tz_name) if end_time is not None else "na",
        "total_distance_m": ti["total_distance_m"],
        "elapsed_time_s": ti["elapsed_time_s"],
        "moving_time_s": ti["moving_time_s"],
        "moving_distance_m": ti["moving_distance_m"],
        "avg_speed_m_s": moving_speed,
        "avg_pace_min_per_km": moving_pace,
        "max_speed_m_s": max_speed,
        "max_pace_min_per_km": max_pace,
        "avg_hr_bpm": avg_hr,
        "max_hr_bpm": max_hr,
        "avg_cadence_spm": avg_cad,
        "max_cadence_spm": max_cad,
        "ascent_m": ascent,
        "descent_m": descent,
        "motion_totals": motion_totals,
        "segment_count": int(len(segdf)),
        "trackpoint_count": int(len(df)),
        "timezone_name": tz_name,
    }

def pace_from_speed(speed_m_s: pd.Series) -> pd.Series:
    """
    Pace (min/km) from speed (m/s), matching getrunstats.15.py logic.
    """
    speed = pd.to_numeric(speed_m_s, errors="coerce")
    with np.errstate(divide="ignore", invalid="ignore"):
        pace_min_per_km = 1000.0 / (60.0 * speed)
    pace_min_per_km.replace([np.inf, -np.inf], np.nan, inplace=True)
    return pace_min_per_km


def best_rolling_pace(df: pd.DataFrame, window_m: float) -> dict | None:
    if "distance_m" not in df.columns:
        return None

    work = df.copy()
    work["distance_m"] = pd.to_numeric(work["distance_m"], errors="coerce")
    work = work.dropna(subset=["distance_m"]).sort_values("distance_m").reset_index(drop=True)
    if work.empty:
        return None

    distances = work["distance_m"].to_numpy()
    n = len(distances)
    if n < 2:
        return None

    times = pd.to_datetime(work["time"], errors="coerce").to_numpy()
    # Use Local Time string if available to match the frontend Map data
    time_strs = work["time_str"].to_numpy() if "time_str" in work.columns else times
    
    best_pace = None
    best_start_time = None
    best_end_time = None
    end_idx = 0

    for start_idx in range(n):
        start_dist = distances[start_idx]
        target = start_dist + window_m

        while end_idx < n and distances[end_idx] < target:
            end_idx += 1
        if end_idx >= n:
            break

        time_window = (times[end_idx] - times[start_idx]) / np.timedelta64(1, "s")
        if time_window <= 0:
            continue

        pace_min_per_km = (time_window / 60.0) / (window_m / 1000.0)
        if best_pace is None or pace_min_per_km < best_pace:
            best_pace = pace_min_per_km
            best_start_time = str(time_strs[start_idx])
            best_end_time = str(time_strs[end_idx])

    if best_pace is None:
        return None

    return {
        "window_m": float(window_m),
        "pace_min_per_km": float(best_pace),
        "start_time": best_start_time,
        "end_time": best_end_time,
    }


def distance_splits(df: pd.DataFrame, split_m: float) -> pd.DataFrame:
    if "distance_m" not in df.columns:
        return pd.DataFrame()

    work = df.copy()
    work["distance_m"] = pd.to_numeric(work["distance_m"], errors="coerce")
    work["time"] = pd.to_datetime(work["time"], errors="coerce")
    work = work.dropna(subset=["distance_m", "time"]).sort_values("distance_m").reset_index(drop=True)
    if work.empty:
        return pd.DataFrame()

    max_dist = work["distance_m"].max()
    if not np.isfinite(max_dist) or max_dist <= 0:
        return pd.DataFrame()

    split_edges = np.arange(0.0, max_dist + split_m, split_m)
    records: list[dict] = []

    for i in range(len(split_edges) - 1):
        start = split_edges[i]
        end = split_edges[i + 1]
        mask = (work["distance_m"] >= start) & (work["distance_m"] < end)
        seg = work.loc[mask]
        if seg.empty:
            continue

        seg_time_s = (seg["time"].iloc[-1] - seg["time"].iloc[0]).total_seconds()
        seg_dist_m = seg["distance_m"].iloc[-1] - seg["distance_m"].iloc[0]
        if seg_dist_m <= 0 or seg_time_s <= 0:
            continue

        avg_speed = seg_dist_m / seg_time_s
        avg_pace = (seg_time_s / 60.0) / (seg_dist_m / 1000.0)

        # --- NEW: Safely calculate Avg HR and Cadence for this specific split ---
        avg_hr = None
        if "heart_rate_bpm" in seg.columns:
            hr_mean = seg["heart_rate_bpm"].mean()
            if pd.notna(hr_mean):
                avg_hr = float(hr_mean)

        avg_cadence = None
        if "cadence" in seg.columns:
            cad_mean = seg["cadence"].mean()
            if pd.notna(cad_mean):
                avg_cadence = float(cad_mean)
        # ------------------------------------------------------------------------

        # Fallback for TIME_FMT if not globally defined, though your script likely has it
        st_str = seg["time_str"].iloc[0] if "time_str" in seg.columns else seg["time"].iloc[0].strftime("%Y-%m-%d %H:%M:%S")
        et_str = seg["time_str"].iloc[-1] if "time_str" in seg.columns else seg["time"].iloc[-1].strftime("%Y-%m-%d %H:%M:%S")

        records.append(
            {
                "index": i + 1,
                "start_distance_m": float(start),
                "end_distance_m": float(end),
                "distance_m": float(seg_dist_m),
                "duration_s": float(seg_time_s),
                "avg_speed_m_s": float(avg_speed),
                "avg_pace_min_per_km": float(avg_pace),
                "avg_hr_bpm": avg_hr,           # <-- Injected directly into the JSON record
                "avg_cadence_spm": avg_cadence, # <-- Injected directly into the JSON record
                "start_time": st_str,
                "end_time": et_str,
            }
        )

    return pd.DataFrame.from_records(records)


def compute_performance_stats(df: pd.DataFrame, tz_name=DEFAULT_TIMEZONE) -> dict:
    if df.empty:
        return {
            "best_rolling": [],
            "km_splits": [],
            "hr_bands": [],
            "cadence_bands": [],
            "ef_run": None,
        }

    work = df.copy()
    work["time"] = pd.to_datetime(work["time"], errors="coerce")
    work = work.dropna(subset=["time"]).sort_values("time").reset_index(drop=True)

    # Convert timestamps to Local Time strings so they perfectly match the HTML Map data
    work["time_str"] = utc_to_local_string(work["time"], tz_name=tz_name)

    for col in [
        "distance_m", "time_delta_s", "distance_delta_m", 
        "speed_m_s", "speed_smooth_m_s", "heart_rate_bpm", "cadence",
    ]:
        if col in work.columns:
            work[col] = pd.to_numeric(work[col], errors="coerce")

    if "speed_m_s" in work.columns:
        work["pace_min_per_km"] = pace_from_speed(work["speed_m_s"])
    else:
        work["pace_min_per_km"] = np.nan

    best_list: list[dict] = []
    for window in (400.0, 1000.0, 5000.0):
        br = best_rolling_pace(work, window)
        if br is not None:
            best_list.append(br)

    splits_df = distance_splits(work, 1000.0)
    if splits_df.empty:
        km_splits: list[dict] = []
    else:
        km_splits = [
            {
                # using .get() to safely handle whether your distance_splits 
                # returns 'index' or 'split_index'
                "index": int(row.get("split_index", row.get("index", 1))),
                "distance_m": float(row["distance_m"]),
                "duration_s": float(row["duration_s"]),
                "avg_pace_min_per_km": float(row["avg_pace_min_per_km"]),
                
                # Safely extract the new sensor data
                "avg_hr_bpm": float(row["avg_hr_bpm"]) if "avg_hr_bpm" in row and pd.notna(row["avg_hr_bpm"]) else None,
                "avg_cadence_spm": float(row["avg_cadence_spm"]) if "avg_cadence_spm" in row and pd.notna(row["avg_cadence_spm"]) else None,
                
                "start_time": str(row["start_time"]),
                "end_time": str(row["end_time"]),
            }
            for _, row in splits_df.iterrows()
        ]

    hr_bands_stats = compute_hr_band_stats(work)
    cad_bands_stats = compute_cadence_band_stats(work)

    ef_run = efficiency_index(work, moving=True)
    ef_run_val = None if np.isnan(ef_run) else float(ef_run)

    return {
        "best_rolling": best_list,
        "km_splits": km_splits,
        "hr_bands": hr_bands_stats,
        "cadence_bands": cad_bands_stats,
        "ef_run": ef_run_val,
    }


def _compute_band_stats(
    df: pd.DataFrame,
    value_col: str,
    bands: list[tuple[str, float, float]],
) -> list[dict]:
    required = {"time_delta_s", "distance_delta_m", value_col}
    if not required.issubset(df.columns):
        return []

    speed_for_motion = df.get("speed_smooth_m_s", df.get("speed_m_s"))
    if speed_for_motion is None:
        return []

    work = df.copy()
    work["time_delta_s"] = pd.to_numeric(work["time_delta_s"], errors="coerce")
    work["distance_delta_m"] = pd.to_numeric(work["distance_delta_m"], errors="coerce")
    work[value_col] = pd.to_numeric(work[value_col], errors="coerce")
    speed_for_motion = pd.to_numeric(speed_for_motion, errors="coerce")

    moving_mask = speed_for_motion >= MOVING_SPEED_THRESH
    work = work.loc[moving_mask].copy()
    if work.empty:
        return []

    out: list[dict] = []
    for label, low, high in bands:
        mask = work[value_col].between(low, high, inclusive="left")
        seg = work.loc[mask]
        if seg.empty:
            continue

        time_s = float(seg["time_delta_s"].sum())
        dist_m = float(seg["distance_delta_m"].sum())

        if dist_m > 0 and time_s > 0:
            avg_pace = (time_s / 60.0) / (dist_m / 1000.0)
        else:
            avg_pace = np.nan

        ef_val = efficiency_index(seg, moving=False)

        out.append(
            {
                "band": label,
                "min_val": float(low) if low != -np.inf else -9999.0,
                "max_val": float(high) if high != np.inf else 9999.0,
                "time_s": time_s,
                "distance_m": dist_m,
                "avg_pace_min_per_km": None if np.isnan(avg_pace) else float(avg_pace),
                "ef": None if np.isnan(ef_val) else float(ef_val),
            }
        )

    return out


def efficiency_index(df: pd.DataFrame, moving: bool = True) -> float:
    """
    Simple EF‑style index (speed / HR) from getrunstats.15.py efficiency_index().[file:295]
    Expressed as (avg_speed * 100) / avg_hr for readability.
    """
    if "heart_rate_bpm" not in df.columns or "speed_m_s" not in df.columns:
        return np.nan

    speed_for_motion = df.get("speed_smooth_m_s", df["speed_m_s"])
    speed_for_motion = pd.to_numeric(speed_for_motion, errors="coerce")

    if moving:
        mask = speed_for_motion >= MOVING_SPEED_THRESH
    else:
        mask = speed_for_motion.notna()

    subset = df.loc[mask].copy()
    if subset.empty:
        return np.nan

    avg_speed = pd.to_numeric(subset["speed_m_s"], errors="coerce").mean()
    avg_hr = pd.to_numeric(subset["heart_rate_bpm"], errors="coerce").mean()

    if avg_hr <= 0 or np.isnan(avg_hr):
        return np.nan

    return float((avg_speed * 100.0) / avg_hr)

def compute_hr_band_stats(df: pd.DataFrame) -> list[dict]:
    """
    Time in heart rate bands with dist, avg pace, EF.
    Updated to start at 0 and use explicit composite labels.
    """
    if "heart_rate_bpm" not in df.columns:
        return []

    # Standard 5-Zone Model with composite labels and 0.0 baseline
    bands = [
        ("HR Zone 1 (< 135)", 0.0, 135.0),
        ("HR Zone 2 (135 - 150)", 135.0, 150.0),
        ("HR Zone 3 (150 - 165)", 150.0, 165.0),
        ("HR Zone 4 (165 - 180)", 165.0, 180.0),
        ("HR Zone 5 (180+)", 180.0, np.inf),
    ]
    return _compute_band_stats(df, "heart_rate_bpm", bands)

def compute_cadence_band_stats(df: pd.DataFrame) -> list[dict]:
    """
    Time in cadence bands with dist, avg pace, EF.
    Updated to match the granular 10-SPM bins from the original script.
    """
    if "cadence" not in df.columns:
        return []

    # Standard high-fidelity running cadence bands
    bands = [
        ("<150", -np.inf, 150.0),
        ("150 - 160", 150.0, 160.0),
        ("160 - 170", 160.0, 170.0),
        ("170 - 180", 170.0, 180.0),
        ("180 - 190", 180.0, 190.0),
        (">190", 190.0, np.inf),
    ]
    return _compute_band_stats(df, "cadence", bands)


@contextmanager
def measure_time(step_name: str, timings: dict, enabled: bool):
    """Context manager to optionally record execution time of code blocks."""
    if not enabled:
        yield
        return
    t0 = time.perf_counter()
    yield
    t1 = time.perf_counter()
    timings[step_name] = t1 - t0

def main():
    args = parse_args()
    tcx_path = Path(args.tcx_file)
    prefix = Path(args.prefix) if args.prefix else tcx_path.with_suffix("")
    csv_out = Path(f"{prefix}.csv")
    seg_out = Path(f"{prefix}.segments.runwalkstop.csv")
    map_out = Path(args.map_out) if args.map_out else Path(f"{prefix}.motionmap.html")

    is_bench = args.benchmark
    timings = {}
    total_start = time.perf_counter()

    with measure_time("1. Parse TCX to Dictionary", timings, is_bench):
        rows = list(parse_tcx_to_rows(tcx_path))
    
    with measure_time("2. Write Initial CSV to Disk", timings, is_bench):
        write_csv(rows, csv_out)

    with measure_time("3. Read CSV to DataFrame", timings, is_bench):
        raw_run_df = pd.read_csv(csv_out)
        
    if raw_run_df.empty:
        raise ValueError("Run dataframe is empty after parsing")

    with measure_time("4. Prepare & Smooth Data", timings, is_bench):
        run_df = prepare_run_df(raw_run_df)
        run_df = add_deltas(run_df)
        run_df = add_smoothed_speed(run_df, window_s=SMOOTHWINDOW)
        
        # EXTRACT TIMEZONE EARLY
        temp_plot_df = raw_run_df.copy()
        if "latitude" in temp_plot_df.columns:
            temp_plot_df["latitude"] = pd.to_numeric(temp_plot_df["latitude"], errors="coerce")
        if "longitude" in temp_plot_df.columns:
            temp_plot_df["longitude"] = pd.to_numeric(temp_plot_df["longitude"], errors="coerce")
        temp_plot_df = temp_plot_df.dropna(subset=["latitude", "longitude"]) if {"latitude", "longitude"}.issubset(temp_plot_df.columns) else pd.DataFrame()
        tz_name = infer_activity_timezone_name(temp_plot_df)

    with measure_time("5. Identify Motion Segments", timings, is_bench):
        motion_segments_df = summarize_motion_segments(run_df)

    with measure_time("6. Write Segments CSV to Disk", timings, is_bench):
        motion_segments_csv = prepare_for_csv(
            motion_segments_df,
            time_cols=["start_time", "end_time"],
            round_decimals=DISPLAY_DECIMALS,
            tz_name=tz_name,
        )
        motion_segments_csv.to_csv(seg_out, index=False)

    with measure_time("7. Compute Stats & Build HTML Payload", timings, is_bench):
        perfstats = compute_performance_stats(run_df, tz_name=tz_name)
        
        # FIX: Pass the fully prepared run_df with corrected cadence instead of raw_run_df
        run_df_collapsed = collapse_run_streams_for_map(run_df, tz_name=tz_name)
        lookup = build_lookup(run_df_collapsed)

        seg_df = motion_segments_csv.copy()
        if seg_df.empty:
            raise ValueError("No motion segments were produced")

        seg_df_enriched = enrich_segments(seg_df, lookup)
        segments, plot_df = build_segments_payload(run_df_collapsed, seg_df_enriched)
        if not segments:
            raise ValueError("No segment geometry available for map output")

        metricstats = compute_metric_stats(seg_df_enriched)
        runstats = compute_run_stats(run_df, seg_df_enriched, tz_name)

    with measure_time("8. Generate & Write HTML to Disk", timings, is_bench):
        write_html(map_out, segments, plot_df, metricstats, runstats, perfstats)

    total_time = time.perf_counter() - total_start

    print(csv_out)
    print(seg_out)
    print(map_out)

    if is_bench:
        print("\n" + "="*50)
        print("⏱️  PERFORMANCE BENCHMARK")
        print("="*50)
        print(f"Total Trackpoints: {len(raw_run_df):,}")
        print(f"Motion Segments:   {len(motion_segments_df):,}")
        print("-" * 50)
        for step, elapsed in timings.items():
            print(f"{step:<40} {elapsed:.4f}s")
        print("-" * 50)
        print(f"{'TOTAL EXECUTION TIME':<40} {total_time:.4f}s")
        print("="*50 + "\n")

if __name__ == "__main__":
    main()
