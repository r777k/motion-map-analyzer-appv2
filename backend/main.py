import sys
import asyncio

# CRITICAL WINDOWS PROACTOR EVENT LOOP CONFIGURATION FOR PLAYWRIGHT DISPATCHES
if sys.platform.startswith('win'):
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import os
import io
import json
import math
import random
import httpx
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, HTTPException, Response, Security, Depends, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr
from playwright.async_api import async_playwright
from jose import jwt
from geopy.geocoders import Nominatim

# Import custom Neon thread pooling engine and blind hashing primitive
from database import get_db_cursor, blind_hash_string

# Import core engine parsing functions
from engine import (
    parse_tcx_to_rows, parse_fit_to_rows, prepare_run_df, add_deltas,
    add_smoothed_speed,add_smoothed_speed_strava,
    summarize_motion_segments, prepare_for_csv, infer_activity_timezone_name,
    compute_performance_stats, collapse_run_streams_for_map, build_lookup,
    enrich_segments, build_segments_payload, compute_metric_stats,
    compute_run_stats, utc_to_local_string
)

app = FastAPI(title="Motion Map Analyzer", version="2.0")

# ----------------------------------------------------------------------------------
# CONFIGURATION & CORS MIDDLEWARE INTERFACES
# ----------------------------------------------------------------------------------
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:5173", "http://127.0.0.1:5173"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "re_placeholder_key")
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "a_super_secret_hobby_key_change_me_in_production_123456")
ALGORITHM = "HS256"

security = HTTPBearer()

# ----------------------------------------------------------------------------------
# DATA MODELS & SCHEMAS
# ----------------------------------------------------------------------------------
class EmailAuthRequest(BaseModel):
    email: EmailStr

class VerifyOTPRequest(BaseModel):
    email: EmailStr
    code: str

class SaveActivityRequest(BaseModel):
    summary: dict
    segments: list
    trackpoints: list
    performance: dict = {}
    metrics: dict = {}

class SnapshotRequest(BaseModel):
    summary: dict
    segments: list
    trackpoints: list
    performance: dict
    config: dict

# ----------------------------------------------------------------------------------
# STRUCTURAL SECURITY DEPENDENCIES (SCOPED HIGH TO PREVENT SCOPE NAMEERRORS)
# ----------------------------------------------------------------------------------
async def get_current_user_id(credentials: HTTPAuthorizationCredentials = Security(security)) -> str:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid session credentials")
        return str(user_id)
    except Exception:
        raise HTTPException(status_code=401, detail="Session expired or invalid")

def extract_optional_user_id(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    try:
        token = auth_header.split(" ")[1]
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        return str(payload.get("user_id"))
    except Exception:
        return None

# ----------------------------------------------------------------------------------
# BACKGROUND SECURE TOKEN AUTO-REFRESH ENGINE
# ----------------------------------------------------------------------------------
async def get_valid_strava_token(user_id: str) -> str:
    with get_db_cursor() as cur:
        cur.execute(
            "SELECT access_token, refresh_token, expires_at FROM user_strava_tokens WHERE user_id = %s;",
            (user_id,)
        )
        token_row = cur.fetchone()
        
    if not token_row:
        raise HTTPException(status_code=400, detail="No linked Strava profile associated with this account session.")
        
    access_token, refresh_token, expires_at = token_row
    
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
        
    if datetime.now(timezone.utc) < (expires_at - timedelta(minutes=5)):
        return access_token
        
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://www.strava.com/oauth/token",
            data={
                "client_id": STRAVA_CLIENT_ID,
                "client_secret": STRAVA_CLIENT_SECRET,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token
            }
        )
        
    if res.status_code != 200:
        raise HTTPException(status_code=400, detail="Credentials lease renewal rejected by Strava's security gateway.")
        
    refresh_data = res.json()
    new_access_token = refresh_data["access_token"]
    new_refresh_token = refresh_data.get("refresh_token", refresh_token)
    new_expiry_time = datetime.now(timezone.utc) + timedelta(seconds=refresh_data["expires_in"])
    
    with get_db_cursor() as cur:
        cur.execute(
            """
            UPDATE user_strava_tokens 
            SET access_token = %s, refresh_token = %s, expires_at = %s 
            WHERE user_id = %s;
            """,
            (new_access_token, new_refresh_token, new_expiry_time, user_id)
        )
        
    return new_access_token

# ----------------------------------------------------------------------------------
# JSON & DICTIONARY STRUCTURAL KEY ORDER RECONSTRUCTION ENGINE
# ----------------------------------------------------------------------------------
def reorder_dict_keys(source_dict: dict, ordered_keys: list) -> dict:
    if not isinstance(source_dict, dict):
        return source_dict
    reconstructed = {}
    for k in ordered_keys:
        if k in source_dict:
            reconstructed[k] = source_dict[k]
    for k, v in source_dict.items():
        if k not in reconstructed:
            reconstructed[k] = v
    return reconstructed

def normalize_activity_payload(payload: dict) -> dict:
    if not payload:
        return payload

    if "summary" in payload and isinstance(payload["summary"], dict):
        summary_sequence = [
            "start_time", "end_time", "total_distance_m", "elapsed_time_s",
            "moving_time_s", "moving_distance_m", "avg_speed_m_s", "avg_pace_min_per_km",
            "max_speed_m_s", "max_pace_min_per_km", "avg_hr_bpm", "max_hr_bpm",
            "avg_cadence_spm", "max_cadence_spm", "ascent_m", "descent_m",
            "motion_totals", "segment_count", "trackpoint_count", "timezone_name",
            "original_start_time", "location_city"
        ]
        payload["summary"] = reorder_dict_keys(payload["summary"], summary_sequence)

    if "performance" in payload and isinstance(payload["performance"], dict):
        perf = payload["performance"]
        rolling_key = next((k for k in perf if "rolling" in k or "best" in k), "best_rolling")
        if rolling_key in perf and isinstance(perf[rolling_key], list):
            rolling_fields = ["window_m", "pace_min_per_km", "start_time", "end_time"]
            perf[rolling_key] = [reorder_dict_keys(item, rolling_fields) for item in perf[rolling_key]]
            
        if "km_splits" in perf and isinstance(perf["km_splits"], list):
            splits_fields = ["index", "distance_m", "duration_s", "avg_pace_min_per_km", "avg_hr_bpm", "avg_cadence_spm", "start_time", "end_time"]
            perf["km_splits"] = [reorder_dict_keys(item, splits_fields) for item in perf["km_splits"]]
            
        for zone_key in ["hr_bands", "cadence_bands"]:
            if zone_key in perf and isinstance(perf[zone_key], list):
                band_fields = ["band", "min_val", "max_val", "time_s", "distance_m", "avg_pace_min_per_km", "ef"]
                perf[zone_key] = [reorder_dict_keys(item, band_fields) for item in perf[zone_key]]

        perf_root_sequence = [rolling_key, "km_splits", "hr_bands", "cadence_bands", "ef_run"]
        payload["performance"] = reorder_dict_keys(perf, perf_root_sequence)

    return payload

# ----------------------------------------------------------------------------------
# UTILITY HELPER ROUTINES
# ----------------------------------------------------------------------------------
def clean_nans(obj):
    if isinstance(obj, dict):
        return {k: clean_nans(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_nans(v) for v in obj]
    elif isinstance(obj, float) and math.isnan(obj):
        return None
    return obj

def reverse_geocode_city(lat, lon):
    try:
        geolocator = Nominatim(user_agent="motion_map_app_v2")
        location = geolocator.reverse((lat, lon), exactly_one=True, language="en")
        if location:
            address = location.raw.get('address', {})
            city = address.get('city') or address.get('town') or address.get('village') or address.get('county')
            country = address.get('country')
            parts = [p for p in (city, country) if p]
            return ", ".join(parts) if parts else "Local Route"
    except Exception:
        pass
    return "Local Route"

STRAVA_CLIENT_ID = os.getenv("STRAVA_CLIENT_ID")
STRAVA_CLIENT_SECRET = os.getenv("STRAVA_CLIENT_SECRET")

# ----------------------------------------------------------------------------------
# STRAVA OAUTH SYSTEM ENDPOINTS
# ----------------------------------------------------------------------------------
@app.post("/api/auth/strava/exchange")
async def exchange_strava_code(payload: dict, request: Request):
    code = payload.get("code")
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code from Strava.")
        
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://www.strava.com/oauth/token",
            data={
                "client_id": STRAVA_CLIENT_ID,
                "client_secret": STRAVA_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code"
            }
        )
        
    if response.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to exchange token with Strava.")
        
    token_data = response.json()
    athlete_data = token_data.get("athlete", {})
    strava_athlete_id = str(athlete_data.get("id"))
    
    if not strava_athlete_id:
        raise HTTPException(status_code=400, detail="Failed to retrieve identity signatures from Strava.")

    current_user_id = extract_optional_user_id(request)
    
    access_token = None
    if not current_user_id:
        import hashlib
        blind_strava_hash = hashlib.sha256(f"strava_{strava_athlete_id}".encode('utf-8')).hexdigest()
        
        with get_db_cursor() as cur:
            cur.execute("SELECT id FROM users WHERE hashed_email = %s;", (blind_strava_hash,))
            user_record = cur.fetchone()
            if user_record:
                current_user_id = str(user_record[0])
            else:
                cur.execute("INSERT INTO users (hashed_email) VALUES (%s) RETURNING id;", (blind_strava_hash,))
                current_user_id = str(cur.fetchone()[0])
                
        access_token = jwt.encode(
            {"user_id": current_user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7)}, 
            JWT_SECRET_KEY, 
            algorithm=ALGORITHM
        )

    expiry_time = datetime.now(timezone.utc) + timedelta(seconds=token_data["expires_in"])
    with get_db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO user_strava_tokens (user_id, strava_athlete_id, access_token, refresh_token, expires_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (strava_athlete_id) DO UPDATE 
            SET access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at;
            """,
            (current_user_id, strava_athlete_id, token_data["access_token"], token_data["refresh_token"], expiry_time)
        )

    return {
        "status": "connected", 
        "access_token": access_token, 
        "token_type": "bearer" if access_token else None,
        "athlete": athlete_data
    }

@app.get("/api/strava/latest-activities")
async def get_latest_strava_activities(current_user_id: str = Depends(get_current_user_id)):
    strava_token = await get_valid_strava_token(current_user_id)
    
    url = "https://www.strava.com/api/v3/athlete/activities"
    headers = {"Authorization": f"Bearer {strava_token}"}
    params = {"per_page": 5}
    
    async with httpx.AsyncClient() as client:
        res = await client.get(url, headers=headers, params=params)
        
    if res.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to grab recent activity list from Strava API.")
        
    activities = res.json()
    return {
        "activities": [
            {
                "id": str(act.get("id")),
                "name": act.get("name"),
                "type": act.get("type"),
                "distance_km": round(act.get("distance", 0) / 1000.0, 2),
                "duration_s": act.get("moving_time"),
                "start_date": act.get("start_date_local")
            }
            for act in activities if act.get("type") in ["Run", "Walk"]
        ]
    }

# ----------------------------------------------------------------------------------
# STRAVA TELEMETRY STREAM INGEST ENGINE (TRUE HIGH-FIDELITY CALCULATOR TUNNEL)
# ----------------------------------------------------------------------------------
@app.get("/api/strava/analyze-activity/{activity_id}")
async def analyze_strava_activity(activity_id: str, request: Request, current_user_id: str = Depends(get_current_user_id)):
    strava_token = await get_valid_strava_token(current_user_id)
    headers = {"Authorization": f"Bearer {strava_token}"}
    
    activity_url = f"https://www.strava.com/api/v3/activities/{activity_id}"
    async with httpx.AsyncClient() as client:
        act_res = await client.get(activity_url, headers=headers)
        if act_res.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to retrieve activity meta-details from Strava.")
        activity_info = act_res.json()
        
        streams_url = f"https://www.strava.com/api/v3/activities/{activity_id}/streams"
        params = {
            "keys": "latlng,distance,altitude,time,velocity_smooth,heartrate,cadence",
            "key_by_type": "true"
        }
        res = await client.get(streams_url, params=params, headers=headers)
        
    if res.status_code != 200:
        raise HTTPException(status_code=400, detail="Failed to retrieve tracking telemetry streams from Strava.")
        
    strava_streams = res.json()
    
    activity_type = activity_info.get("type", "Run")
    is_running_activity = activity_type == "Run"

    start_date_str = activity_info.get("start_date")
    if start_date_str:
        base_start_time = datetime.fromisoformat(start_date_str.replace('Z', '+00:00'))
    else:
        base_start_time = datetime.now(timezone.utc)

    time_data = strava_streams.get("time", {}).get("data", [])
    latlng_data = strava_streams.get("latlng", {}).get("data", [])
    dist_data = strava_streams.get("distance", {}).get("data", [])
    alt_data = strava_streams.get("altitude", {}).get("data", [])
    hr_data = strava_streams.get("heartrate", {}).get("data", [])
    cad_data = strava_streams.get("cadence", {}).get("data", [])
    velocity_data = strava_streams.get("velocity_smooth", {}).get("data", [])
    
    transformed_rows = []
    for i in range(len(time_data)):
        point_timestamp = base_start_time + timedelta(seconds=time_data[i])
        
        raw_cadence = cad_data[i] if i < len(cad_data) else None
        if raw_cadence is not None and is_running_activity:
            raw_cadence = raw_cadence * 2

        point = {
            "time": point_timestamp.strftime("%Y-%m-%d %H:%M:%S"),
            "latitude": latlng_data[i][0] if i < len(latlng_data) else None,
            "longitude": latlng_data[i][1] if i < len(latlng_data) else None,
            "altitude_m": alt_data[i] if i < len(alt_data) else None,
            "heart_rate_bpm": hr_data[i] if i < len(hr_data) else None,
            "cadence": raw_cadence,
        }
        transformed_rows.append(point)
        
    raw_run_df = pd.DataFrame(transformed_rows)
    if raw_run_df.empty:
        raise HTTPException(status_code=400, detail="No valid tracking data found from Strava streams.")

    run_df = prepare_run_df(raw_run_df)
    if run_df["latitude"].isna().all() or run_df["longitude"].isna().all():
        raise HTTPException(status_code=400, detail="No GPS data found inside this activity track.")
        
    # ------------------------------------------------------------------------------
    # THE RE-INJECTION TUNNEL: SAFELY MERGE LIVE STREAMS AS DATETIME OBJECTS
    # ------------------------------------------------------------------------------
    streams_map = pd.DataFrame({
        "time": [(base_start_time + timedelta(seconds=t)).strftime("%Y-%m-%d %H:%M:%S") for t in time_data]
    })
    if len(dist_data) > 0:
        streams_map["distance_m"] = pd.to_numeric(dist_data, errors="coerce")

    streams_map = streams_map.groupby("time", as_index=False).mean()
    streams_map["time"] = pd.to_datetime(streams_map["time"])

    run_df = run_df.drop(columns=["distance_m", "speed_m_s", "speed_smooth_m_s"], errors="ignore")
    run_df = pd.merge(run_df, streams_map, on="time", how="left")
    # ------------------------------------------------------------------------------

    run_df = add_deltas(run_df)
    
    # CRITICAL: Route to the dedicated Strava velocity engine to preserve TCX isolation
    run_df = add_smoothed_speed_strava(run_df, window_s=SMOOTHWINDOW)

    # ------------------------------------------------------------------------------
    # RE-INJECTION TUNNEL PASSTHROUGH (HYBRID DENSITY PACE VARIATION TUNING)
    # ------------------------------------------------------------------------------
    if len(velocity_data) > 0:
        vel_map = pd.DataFrame({
            "time": [(base_start_time + timedelta(seconds=t)).strftime("%Y-%m-%d %H:%M:%S") for t in time_data],
            "true_speed": pd.to_numeric(velocity_data, errors="coerce")
        }).groupby("time", as_index=False).mean()
        vel_map["time"] = pd.to_datetime(vel_map["time"])
        
        run_df = pd.merge(run_df, vel_map, on="time", how="left")
        run_df["true_speed"] = run_df["true_speed"].fillna(run_df["speed_m_s"])
        
        # Blend Pass: Combine our high-res coordinate speed with Strava's velocity_smooth baseline
        run_df["speed_smooth_m_s"] = (run_df["speed_smooth_m_s"] * 0.65) + (run_df["true_speed"] * 0.35)
        run_df["speed_m_s"] = run_df["speed_smooth_m_s"]
        
        with np.errstate(divide="ignore", invalid="ignore"):
            run_df["pace_min_per_km"] = 1000.0 / (60.0 * run_df["speed_smooth_m_s"])
        run_df["pace_min_per_km"] = run_df["pace_min_per_km"].replace([float('inf'), float('-inf')], None)
        
        run_df = run_df.drop(columns=["true_speed"])
    # ------------------------------------------------------------------------------

    first_row_time = run_df["time"].min()
    orig_start_str = first_row_time.strftime("%Y-%m-%d %H:%M:%S") if pd.notna(first_row_time) else "Unknown"

    temp_plot_df = run_df.dropna(subset=["latitude", "longitude"])
    tz_name = infer_activity_timezone_name(temp_plot_df)

    motion_segments_df = summarize_motion_segments(run_df)
    motion_segments_csv = prepare_for_csv(motion_segments_df, time_cols=["start_time", "end_time"], tz_name=tz_name)

    perfstats = compute_performance_stats(run_df, tz_name=tz_name)
    
    # Execute the backend map compression pass
    run_df_collapsed = collapse_run_streams_for_map(run_df, tz_name=tz_name)
    
    # FIXED: The previous manual merge block has been removed to prevent column naming collisions 
    # and restore high-resolution pace charts for Strava data.
    run_df_collapsed["time"] = run_df_collapsed["time"].astype(str)

    lookup = build_lookup(run_df_collapsed)

    seg_df_enriched = enrich_segments(motion_segments_csv, lookup)
    segments, plot_df = build_segments_payload(run_df_collapsed, seg_df_enriched)
    
    if not segments:
        raise HTTPException(status_code=400, detail="No processing segments could be generated.")

    metricstats = compute_metric_stats(seg_df_enriched)
    runstats = compute_run_stats(run_df, seg_df_enriched, tz_name)
    runstats["original_start_time"] = orig_start_str

    base_cols = ["time", "latitude", "longitude"]
    # FIXED: Restored explicit "distance_m" metrics passthrough to unlock high-res map split tracing rules
    optional_cols = ["heart_rate_bpm", "cadence", "altitude_m", "pace_min_per_km", "motion_state", "distance_m"]
    
    tp_df = plot_df.copy()
    cols_to_extract = [col for col in base_cols if col in tp_df.columns]
    for col in optional_cols:
        if col in tp_df.columns: cols_to_extract.append(col)

    if pd.api.types.is_datetime64_any_dtype(tp_df["time"]):
        tp_df["time"] = tp_df["time"].dt.strftime("%Y-%m-%d %H:%M:%S")

    track_points = tp_df[cols_to_extract].to_dict(orient="records")
    runstats["location_city"] = reverse_geocode_city(temp_plot_df.iloc[0]["latitude"], temp_plot_df.iloc[0]["longitude"]) if not temp_plot_df.empty else "Local Route"

    existing_id = None
    if current_user_id:
        try:
            with get_db_cursor() as cur:
                cur.execute("SELECT id FROM activities WHERE user_id = %s AND original_start_time = %s;", (current_user_id, orig_start_str))
                match_row = cur.fetchone()
                if match_row: existing_id = str(match_row[0])
        except Exception: 
            pass

    raw_payload = {
        "status": "success",
        "data": {
            "id": existing_id,
            "summary": runstats,
            "performance": perfstats,
            "metrics": metricstats,
            "segments": segments,
            "trackpoints": track_points
        }
    }
    raw_payload["data"] = normalize_activity_payload(raw_payload["data"])
    return JSONResponse(content=clean_nans(raw_payload))

# ----------------------------------------------------------------------------------
# PASSWORDLESS AUTHENTICATION ROUTERS
# ----------------------------------------------------------------------------------
@app.post("/api/auth/send-otp")
async def send_otp(payload: EmailAuthRequest):
    clear_email = payload.email.strip().lower()
    hashed_email = blind_hash_string(clear_email)
    
    otp_code = str(random.randint(100000, 999999))
    hashed_code = blind_hash_string(otp_code)
    expiry_timestamp = datetime.now(timezone.utc) + timedelta(minutes=10)
    
    try:
        with get_db_cursor() as cur:
            cur.execute(
                "INSERT INTO auth_codes (hashed_email, hashed_code, expires_at) VALUES (%s, %s, %s);",
                (hashed_email, hashed_code, expiry_timestamp)
            )
            
        async with httpx.AsyncClient() as client:
            resend_payload = {
                "from": "MotionMap <onboarding@resend.dev>",
                "to": [clear_email],
                "subject": "Your MotionMap Verification Code",
                "html": f"""
                    <div style='font-family:sans-serif; padding:24px; max-width:450px; border:1px solid #e2e8f0; border-radius:12px;'>
                        <h2 style='color:#2563eb; margin-top:0;'>👟 MotionMap Security</h2>
                        <p style='color:#475569; font-size:14px;'>Use the token code below to access your workout logs:</p>
                        <div style='background:#f1f5f9; padding:16px; text-align:center; border-radius:8px; font-size:32px; font-weight:900; letter-spacing:4px; color:#1e293b; margin:20px 0;'>
                            {otp_code}
                        </div>
                        <p style='color:#94a3b8; font-size:11px; margin-bottom:0;'>This security window expires automatically in 10 minutes.</p>
                    </div>
                """
            }
            response = await client.post("https://api.resend.com/emails", json=resend_payload, headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"})
            if response.status_code >= 400:
                raise HTTPException(status_code=502, detail="Mailing service provider rejected dispatch rules.")
        return {"status": "success", "detail": "Verification token transmitted successfully."}
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/auth/verify-otp")
async def verify_otp(payload: VerifyOTPRequest):
    hashed_email = blind_hash_string(payload.email)
    hashed_code = blind_hash_string(payload.code)
    now = datetime.now(timezone.utc)
    
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM auth_codes WHERE hashed_email = %s AND hashed_code = %s AND expires_at > %s ORDER BY created_at DESC LIMIT 1;", (hashed_email, hashed_code, now))
        code_record = cur.fetchone()
        if not code_record:
            raise HTTPException(status_code=401, detail="Invalid or expired verification token code.")
            
        cur.execute("DELETE FROM auth_codes WHERE hashed_email = %s;", (hashed_email,))
        cur.execute("SELECT id FROM users WHERE hashed_email = %s;", (hashed_email,))
        user_record = cur.fetchone()
        
        if user_record:
            user_id = user_record[0]
        else:
            cur.execute("INSERT INTO users (hashed_email) VALUES (%s) RETURNING id;", (hashed_email,))
            user_id = cur.fetchone()[0]
            
    access_jwt = jwt.encode({"user_id": str(user_id), "exp": datetime.now(timezone.utc) + timedelta(days=7)}, JWT_SECRET_KEY, algorithm=ALGORITHM)
    return {"access_token": access_jwt, "token_type": "bearer"}
# ----------------------------------------------------------------------------------
# STATELESS WORKSPACE PARSING ROUTINE (UPGRADED CRISP NON-ARTIFICIAL SMOOTHING)
# ----------------------------------------------------------------------------------
@app.post("/api/analyze")
async def analyze_run(request: Request, file: UploadFile = File(...), apply_privacy: bool = Form(True)):
    try:
        contents = await file.read()
        file_obj = io.BytesIO(contents)
        filename = file.filename.lower()
        
        if filename.endswith(".fit"):
            rows = list(parse_fit_to_rows(file_obj))
        elif filename.endswith(".tcx"):
            rows = list(parse_tcx_to_rows(file_obj))
        else:
            raise HTTPException(status_code=400, detail="Must be a .tcx or .fit file")

        raw_run_df = pd.DataFrame(rows)
        if raw_run_df.empty:
            raise HTTPException(status_code=400, detail="No valid tracking data found.")

        run_df = prepare_run_df(raw_run_df)
        if run_df["latitude"].isna().all() or run_df["longitude"].isna().all():
            raise HTTPException(status_code=400, detail="No GPS data found (Indoor run?)")
            
        run_df = add_deltas(run_df)
        # CRATE OPTIMIZATION PASS: Tighten the rolling window from 5.0 to 3.0 seconds to eliminate 
        # artificial rounding effects and restore the spiky, high-fidelity organic performance textures!
        run_df = add_smoothed_speed(run_df, window_s=3.0)

        first_row_time = run_df["time"].min()
        orig_start_str = first_row_time.strftime("%Y-%m-%d %H:%M:%S") if pd.notna(first_row_time) else "Unknown"

        if apply_privacy and "distance_m" in run_df.columns:
            max_dist = run_df["distance_m"].max()
            if max_dist > 1500:
                run_df = run_df.loc[(run_df["distance_m"] >= 500) & (run_df["distance_m"] <= (max_dist - 500))].copy()
                run_df = add_deltas(run_df)

        temp_plot_df = run_df.dropna(subset=["latitude", "longitude"])
        tz_name = infer_activity_timezone_name(temp_plot_df)

        motion_segments_df = summarize_motion_segments(run_df)
        motion_segments_csv = prepare_for_csv(motion_segments_df, time_cols=["start_time", "end_time"], tz_name=tz_name)

        perfstats = compute_performance_stats(run_df, tz_name=tz_name)
        run_df_collapsed = collapse_run_streams_for_map(run_df, tz_name=tz_name)
        lookup = build_lookup(run_df_collapsed)

        seg_df_enriched = enrich_segments(motion_segments_csv, lookup)
        segments, plot_df = build_segments_payload(run_df_collapsed, seg_df_enriched)
        
        if not segments:
            raise HTTPException(status_code=400, detail="No segments could be generated.")

        metricstats = compute_metric_stats(seg_df_enriched)
        runstats = compute_run_stats(run_df, seg_df_enriched, tz_name)
        runstats["original_start_time"] = orig_start_str

        base_cols = ["time", "latitude", "longitude"]
        # FIXED: Restored explicit "distance_m" metrics pass to trackpoint outputs here as well
        optional_cols = ["heart_rate_bpm", "cadence", "altitude_m", "pace_min_per_km", "motion_state", "distance_m"]
        
        tp_df = plot_df.copy()
        cols_to_extract = [col for col in base_cols if col in tp_df.columns]
        for col in optional_cols:
            if col in tp_df.columns: cols_to_extract.append(col)

        if pd.api.types.is_datetime64_any_dtype(tp_df["time"]):
            tp_df["time"] = tp_df["time"].dt.strftime("%Y-%m-%d %H:%M:%S")

        track_points = tp_df[cols_to_extract].to_dict(orient="records")
        runstats["location_city"] = reverse_geocode_city(temp_plot_df.iloc[0]["latitude"], temp_plot_df.iloc[0]["longitude"]) if not temp_plot_df.empty else ""

        current_user_id = extract_optional_user_id(request)
        existing_id = None
        if current_user_id:
            try:
                with get_db_cursor() as cur:
                    cur.execute("SELECT id FROM activities WHERE user_id = %s AND original_start_time = %s;", (current_user_id, orig_start_str))
                    match_row = cur.fetchone()
                    if match_row: existing_id = str(match_row[0])
            except Exception: pass

        raw_payload = {
            "status": "success",
            "data": {
                "id": existing_id,
                "summary": runstats,
                "performance": perfstats,
                "metrics": metricstats,
                "segments": segments,
                "trackpoints": track_points
            }
        }
        raw_payload["data"] = normalize_activity_payload(raw_payload["data"])
        return JSONResponse(content=clean_nans(raw_payload))
    except HTTPException as he: raise he
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

# ----------------------------------------------------------------------------------
# RUN DATA HISTORY MANAGEMENT ENDPOINTS
# ----------------------------------------------------------------------------------
@app.post("/api/activities")
async def save_activity(payload: SaveActivityRequest, current_user_id: str = Depends(get_current_user_id)):
    sum_data = payload.summary
    start_time = sum_data.get("start_time")
    orig_start_time = sum_data.get("original_start_time") or start_time
    city = sum_data.get("location_city", "Local Route")
    
    if not start_time:
        raise HTTPException(status_code=400, detail="Activity payload is missing a valid timestamp.")

    try:
        with get_db_cursor() as cur:
            cur.execute("SELECT id FROM activities WHERE user_id = %s AND original_start_time = %s;", (current_user_id, orig_start_time))
            existing_row = cur.fetchone()
            if existing_row:
                return {"status": "success", "detail": "Activity already saved.", "activity_id": str(existing_row[0])}

            raw_dist = sum_data.get("moving_distance_m", 0)
            distance_km = round(float(raw_dist) / 1000.0, 2) if raw_dist else round(float(sum_data.get("distance_km", 0)), 2)
            duration_s = int(sum_data.get("moving_time_s", sum_data.get("duration_s", 0)))
            
            avg_pace = sum_data.get("avg_pace_str") or sum_data.get("avg_pace") or sum_data.get("avg_pace_min_per_km") or "-:--"
            if avg_pace and not ":" in str(avg_pace):
                try:
                    dec_mins = float(avg_pace)
                    m = math.floor(dec_mins)
                    s = round((dec_mins - m) * 60)
                    if s == 60: m += 1; s = 0
                    avg_pace = f"{m}:{s:02d}"
                except Exception: avg_pace = "-:--"

            full_workspace_payload = payload.model_dump()
            cur.execute(
                """
                INSERT INTO activities (user_id, start_time, original_start_time, location_city, distance_km, duration_s, avg_pace_str, data_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id;
                """,
                (current_user_id, start_time, orig_start_time, city, distance_km, duration_s, str(avg_pace), json.dumps(full_workspace_payload))
            )
            new_id = cur.fetchone()[0]
        return {"status": "success", "activity_id": str(new_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/activities")
async def get_activity_history(current_user_id: str = Depends(get_current_user_id)):
    try:
        with get_db_cursor() as cur:
            cur.execute("SELECT id, start_time, location_city, distance_km, duration_s, avg_pace_str FROM activities WHERE user_id = %s ORDER BY start_time DESC;", (current_user_id,))
            rows = cur.fetchall()
        return {
            "status": "success", 
            "history": [{"id": str(r[0]), "start_time": r[1].strftime("%Y-%m-%d %H:%M:%S") if isinstance(r[1], datetime) else str(r[1]), "location_city": r[2], "distance_km": float(r[3]), "duration_s": r[4], "avg_pace_str": r[5]} for r in rows]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/activities/{activity_id}")
async def get_single_activity(activity_id: str, current_user_id: str = Depends(get_current_user_id)):
    try:
        with get_db_cursor() as cur:
            cur.execute("SELECT data_json FROM activities WHERE id = %s AND user_id = %s;", (activity_id, current_user_id))
            record = cur.fetchone()
            
        if not record:
            raise HTTPException(status_code=404, detail="Requested run log not found.")
            
        normalized_payload = normalize_activity_payload(record[0])
        return {"status": "success", "data": normalized_payload}
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/activities/{activity_id}")
async def delete_activity(activity_id: str, current_user_id: str = Depends(get_current_user_id)):
    try:
        with get_db_cursor() as cur:
            cur.execute("DELETE FROM activities WHERE id = %s AND user_id = %s RETURNING id;", (activity_id, current_user_id))
            if not cur.fetchone(): raise HTTPException(status_code=404, detail="Log target not found.")
        return {"status": "success", "detail": "Activity removed permanently."}
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))

# ----------------------------------------------------------------------------------
# SNAPSHOT SHARE ASSET GENERATOR
# ----------------------------------------------------------------------------------
@app.post("/api/export-snapshot")
async def export_snapshot(payload: SnapshotRequest):
    template_path = os.path.abspath("templates/card.html")
    if not os.path.exists(template_path): raise HTTPException(status_code=404, detail="Template not found.")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1650, "height": 950})
        page = await context.new_page()
        await page.goto(f"file://{template_path}")
        await page.evaluate("data => window.renderWorkoutCard(data)", payload.model_dump())
        await page.wait_for_function("window.isRenderCompleteFlag === true", timeout=7000)
        image_buffer = await page.screenshot(type="png", full_page=False)
        await browser.close()
        return Response(content=image_buffer, media_type="image/png")