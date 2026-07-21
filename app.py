"""
BUSY Bar Mission Control — Flask proxy + UI for the full BUSY Bar HTTP API.

Implements a local proxy for every endpoint in the BUSY Bar OpenAPI spec
(https://api.busy.app/busybar/docs) so the browser UI can talk to the cloud
API without CORS issues and without exposing the API token to the page source.

Run:  python app.py   →  http://127.0.0.1:8931
"""
import base64
import os
import time
import uuid
from functools import wraps

import requests
from flask import Flask, jsonify, request, Response, send_from_directory

BASE = "https://api.busy.app/busybar"
DEFAULT_TOKEN = "REDACTED_EXPOSED_TOKEN"

app = Flask(__name__, static_folder="static", static_url_path="/static")

# ---------------------------------------------------------------------------
# token management
# ---------------------------------------------------------------------------

def get_token():
    tok = request.headers.get("X-Busy-Token") or app.config.get("BUSY_TOKEN")
    return tok or DEFAULT_TOKEN

@app.post("/api/token")
def set_token():
    body = request.get_json(silent=True) or {}
    tok = (body.get("token") or "").strip()
    if not tok:
        return jsonify({"result": "ERROR", "error": "empty token"}), 400
    app.config["BUSY_TOKEN"] = tok
    return jsonify({"result": "OK"})

@app.get("/api/token/status")
def token_status():
    tok = get_token()
    return jsonify({
        "configured": bool(tok),
        "using_default": tok == DEFAULT_TOKEN,
        "hint": (tok[:6] + "…" + tok[-4:]) if tok else None,
    })

# ---------------------------------------------------------------------------
# upstream helpers
# ---------------------------------------------------------------------------

def upstream(method, path, params=None, json_body=None, data=None,
             headers=None, timeout=30):
    h = {"Authorization": f"Bearer {get_token()}"}
    if headers:
        h.update(headers)
    url = f"{BASE}{path}"
    return requests.request(method, url, params=params, json=json_body,
                            data=data, headers=h, timeout=timeout)

def passthrough(r):
    """Return upstream response to the browser, preserving content type."""
    ct = r.headers.get("Content-Type", "application/json")
    return Response(r.content, status=r.status_code, content_type=ct)

def api(fn):
    """Wrap a proxy view: catch network errors, return upstream verbatim."""
    @wraps(fn)
    def wrapper(*a, **kw):
        try:
            return fn(*a, **kw)
        except requests.RequestException as e:
            return jsonify({"result": "ERROR", "error": f"upstream: {e}"}), 502
    return wrapper

def j(method, path, **kw):
    return passthrough(upstream(method, path, **kw))

# ---------------------------------------------------------------------------
# Account
# ---------------------------------------------------------------------------

@app.get("/api/account/info")
@api
def account_info(): return j("GET", "/account/info")

@app.get("/api/account/status")
@api
def account_status(): return j("GET", "/account/status")

@app.get("/api/account/backend")
@api
def account_backend(): return j("GET", "/account/backend")

# ---------------------------------------------------------------------------
# Assets / display / audio
# ---------------------------------------------------------------------------

@app.post("/api/assets/upload")
@api
def assets_upload():
    return j("POST", "/assets/upload",
             params={"application_name": request.args.get("application_name"),
                     "file": request.args.get("file")},
             data=request.get_data(),
             headers={"Content-Type": "application/octet-stream"}, timeout=60)

@app.delete("/api/assets/upload")
@api
def assets_delete():
    return j("DELETE", "/assets/upload",
             params={"application_name": request.args.get("application_name")})

@app.post("/api/display/draw")
@api
def display_draw():
    return j("POST", "/display/draw", json_body=request.get_json(force=True))

@app.delete("/api/display/draw")
@api
def display_clear():
    return j("DELETE", "/display/draw",
             params={"application_name": request.args.get("application_name")})

@app.post("/api/audio/play")
@api
def audio_play():
    return j("POST", "/audio/play", json_body=request.get_json(force=True))

@app.delete("/api/audio/play")
@api
def audio_stop():
    return j("DELETE", "/audio/play")

# ---------------------------------------------------------------------------
# BLE
# ---------------------------------------------------------------------------

@app.post("/api/ble/enable")
@api
def ble_enable(): return j("POST", "/ble/enable")

@app.post("/api/ble/disable")
@api
def ble_disable(): return j("POST", "/ble/disable")

@app.delete("/api/ble/pairing")
@api
def ble_unpair(): return j("DELETE", "/ble/pairing")

@app.get("/api/ble/status")
@api
def ble_status(): return j("GET", "/ble/status")

# ---------------------------------------------------------------------------
# BUSY timer
# ---------------------------------------------------------------------------

@app.get("/api/busy/snapshot")
@api
def busy_snapshot_get(): return j("GET", "/busy/snapshot")

@app.put("/api/busy/snapshot")
@api
def busy_snapshot_put():
    return j("PUT", "/busy/snapshot", json_body=request.get_json(force=True))

@app.get("/api/busy/profiles/<slot>")
@api
def busy_profile_get(slot): return j("GET", f"/busy/profiles/{slot}")

@app.put("/api/busy/profiles/<slot>")
@api
def busy_profile_put(slot):
    return j("PUT", f"/busy/profiles/{slot}", json_body=request.get_json(force=True))

# Composite convenience: start a timer in one call (updates profile + snapshot)
@app.post("/api/busy/start")
@api
def busy_start():
    body = request.get_json(force=True)
    slot = body.get("slot", "busy")
    timer_settings = body.get("timer_settings")
    bar_settings = body.get("busy_bar_settings",
                            {"theme": "busy", "show_work_phase_only": False,
                             "trigger_smart_home": True})
    now_ms = int(time.time() * 1000)

    prof = upstream("GET", f"/busy/profiles/{slot}").json()
    prof["timer_settings"] = timer_settings
    prof["busy_bar_settings"] = bar_settings
    prof["profile_timestamp_ms"] = now_ms
    r = upstream("PUT", f"/busy/profiles/{slot}", json_body=prof)
    if r.status_code != 200:
        return passthrough(r)

    t = timer_settings.get("type")
    if t == "SIMPLE":
        snap = {"type": "SIMPLE", "card_id": prof["id"],
                "time_left_ms": timer_settings["total_time_ms"],
                "is_paused": False}
    elif t == "INTERVAL":
        snap = {"type": "INTERVAL", "card_id": prof["id"],
                "current_interval": 1,
                "current_interval_time_total_ms": timer_settings["interval_work_ms"],
                "current_interval_time_left_ms": timer_settings["interval_work_ms"],
                "is_paused": False,
                "interval_settings": timer_settings}
    else:  # INFINITE
        snap = {"type": "INFINITE", "card_id": prof["id"], "is_paused": False}
    snap["busy_bar_settings"] = bar_settings
    return j("PUT", "/busy/snapshot",
             json_body={"snapshot": snap, "snapshot_timestamp_ms": now_ms})

@app.post("/api/busy/pause")
@api
def busy_pause():
    return _busy_pause_toggle(True)

@app.post("/api/busy/resume")
@api
def busy_resume():
    return _busy_pause_toggle(False)

def _busy_pause_toggle(paused):
    """Toggle is_paused WITHOUT corrupting the snapshot.

    The firmware's custom ("ZEN"/INFINITE) card is aggressive about claiming
    any running session: reading a snapshot, mutating is_paused, and PUT-ing
    it back can bounce the type to INFINITE (or kill it). So instead of a
    read-modify-write, we PUT only the minimal fields — the firmware merges
    them into the current snapshot server-side."""
    cur = upstream("GET", "/busy/snapshot").json()
    snap = cur.get("snapshot", {})
    if snap.get("type") == "NOT_STARTED":
        return jsonify({"result": "ERROR", "error": "timer not started"}), 400
    # minimal patch: keep type + card identity, change only is_paused
    patch_snap = {"type": snap.get("type"), "is_paused": paused}
    if snap.get("card_id"):
        patch_snap["card_id"] = snap["card_id"]
    # carry over the fields the type requires, straight from the live snapshot
    for k in ("time_left_ms", "current_interval",
              "current_interval_time_total_ms", "current_interval_time_left_ms",
              "interval_settings", "busy_bar_settings"):
        if k in snap:
            patch_snap[k] = snap[k]
    return j("PUT", "/busy/snapshot",
             json_body={"snapshot": patch_snap,
                        "snapshot_timestamp_ms": int(time.time() * 1000)})

@app.post("/api/busy/stop")
@api
def busy_stop():
    cur = upstream("GET", "/busy/snapshot").json()
    settings = cur.get("snapshot", {}).get(
        "busy_bar_settings",
        {"theme": "busy", "show_work_phase_only": False, "trigger_smart_home": True})
    return j("PUT", "/busy/snapshot",
             json_body={"snapshot": {"type": "NOT_STARTED",
                                     "busy_bar_settings": settings},
                        "snapshot_timestamp_ms": int(time.time() * 1000)})

# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

@app.post("/api/input")
@api
def send_input():
    return j("POST", "/input", params={"key": request.args.get("key")})

# ---------------------------------------------------------------------------
# Settings: access / name / brightness / volume
# ---------------------------------------------------------------------------

@app.get("/api/access")
@api
def access_get(): return j("GET", "/access")

@app.post("/api/access")
@api
def access_set():
    params = {"mode": request.args.get("mode")}
    if request.args.get("key"):
        params["key"] = request.args.get("key")
    return j("POST", "/access", params=params)

@app.get("/api/name")
@api
def name_get(): return j("GET", "/name")

@app.post("/api/name")
@api
def name_set():
    return j("POST", "/name", json_body=request.get_json(force=True))

@app.get("/api/display/brightness")
@api
def brightness_get(): return j("GET", "/display/brightness")

@app.post("/api/display/brightness")
@api
def brightness_set():
    return j("POST", "/display/brightness",
             params={"value": request.args.get("value")})

@app.get("/api/audio/volume")
@api
def volume_get(): return j("GET", "/audio/volume")

@app.post("/api/audio/volume")
@api
def volume_set():
    params = {"volume": request.args.get("volume")}
    if request.args.get("silent") is not None:
        params["silent"] = request.args.get("silent")
    return j("POST", "/audio/volume", params=params)

# ---------------------------------------------------------------------------
# Smart home (Matter)
# ---------------------------------------------------------------------------

@app.get("/api/smart_home/pairing")
@api
def sh_pairing_get(): return j("GET", "/smart_home/pairing")

@app.post("/api/smart_home/pairing")
@api
def sh_pairing_start(): return j("POST", "/smart_home/pairing")

@app.delete("/api/smart_home/pairing")
@api
def sh_pairing_erase(): return j("DELETE", "/smart_home/pairing")

@app.get("/api/smart_home/switch")
@api
def sh_switch_get(): return j("GET", "/smart_home/switch")

@app.post("/api/smart_home/switch")
@api
def sh_switch_set():
    return j("POST", "/smart_home/switch", json_body=request.get_json(force=True))

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

@app.post("/api/storage/write")
@api
def storage_write():
    return j("POST", "/storage/write",
             params={"path": request.args.get("path")},
             data=request.get_data(),
             headers={"Content-Type": "application/octet-stream"}, timeout=60)

@app.get("/api/storage/read")
@api
def storage_read():
    return j("GET", "/storage/read", params={"path": request.args.get("path")},
             timeout=60)

@app.get("/api/storage/list")
@api
def storage_list():
    return j("GET", "/storage/list", params={"path": request.args.get("path", "/ext")})

@app.delete("/api/storage/remove")
@api
def storage_remove():
    return j("DELETE", "/storage/remove", params={"path": request.args.get("path")})

@app.post("/api/storage/mkdir")
@api
def storage_mkdir():
    return j("POST", "/storage/mkdir", params={"path": request.args.get("path")})

@app.post("/api/storage/rename")
@api
def storage_rename():
    return j("POST", "/storage/rename",
             params={"path": request.args.get("path"),
                     "new_path": request.args.get("new_path")})

@app.get("/api/storage/status")
@api
def storage_status(): return j("GET", "/storage/status")

# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------

@app.get("/api/screen")
@api
def screen():
    """Upstream returns a base64-encoded raw RGB888 framebuffer (Content-Type
    image/bmp is misleading). Decode it and hand the browser raw pixels plus
    dimensions in headers; the UI paints them onto a canvas."""
    disp = int(request.args.get("display", 0))
    r = upstream("GET", "/screen", params={"display": disp})
    if r.status_code != 200:
        return passthrough(r)
    try:
        raw = base64.b64decode(r.content.strip())
    except Exception:
        raw = r.content
    # dimensions: front 72x16 RGB888 = 3456 bytes;
    # back 160x100 packed 4-bit grayscale (2 px/byte) = 8000... actual 6400 bytes
    if disp == 0:
        w, h = 72, 16
        fmt = "rgb888"
        if len(raw) != w * h * 3:
            fmt = "unknown"
    else:
        w, h = 160, len(raw) // 80  # 80 bytes/row, 2 px per byte
        fmt = "gray4"
    return Response(raw, status=200, content_type="application/octet-stream",
                    headers={"Cache-Control": "no-store",
                             "X-Frame-Width": str(w),
                             "X-Frame-Height": str(h),
                             "X-Frame-Format": fmt})

# ---------------------------------------------------------------------------
# System
# ---------------------------------------------------------------------------

@app.get("/api/version")
@api
def version(): return j("GET", "/version")

@app.get("/api/transport")
@api
def transport(): return j("GET", "/transport")

@app.get("/api/status")
@api
def status_all(): return j("GET", "/status")

@app.get("/api/status/device")
@api
def status_device(): return j("GET", "/status/device")

@app.get("/api/status/firmware")
@api
def status_firmware(): return j("GET", "/status/firmware")

@app.get("/api/status/system")
@api
def status_system(): return j("GET", "/status/system")

@app.get("/api/status/power")
@api
def status_power(): return j("GET", "/status/power")

@app.post("/api/log_dump")
@api
def log_dump():
    params = {}
    if request.args.get("filename"):
        params["filename"] = request.args.get("filename")
    return j("POST", "/log_dump", params=params, timeout=60)

# ---------------------------------------------------------------------------
# Time
# ---------------------------------------------------------------------------

@app.get("/api/time")
@api
def time_get(): return j("GET", "/time")

@app.post("/api/time/timestamp")
@api
def time_set():
    return j("POST", "/time/timestamp",
             params={"timestamp": request.args.get("timestamp")})

@app.get("/api/time/timezone")
@api
def tz_get(): return j("GET", "/time/timezone")

@app.post("/api/time/timezone")
@api
def tz_set():
    return j("POST", "/time/timezone",
             params={"timezone": request.args.get("timezone")})

@app.get("/api/time/tzlist")
@api
def tz_list(): return j("GET", "/time/tzlist")

# ---------------------------------------------------------------------------
# Wi-Fi
# ---------------------------------------------------------------------------

@app.get("/api/wifi/status")
@api
def wifi_status(): return j("GET", "/wifi/status")

# ---------------------------------------------------------------------------
# Updater
# ---------------------------------------------------------------------------

@app.post("/api/update")
@api
def update_flash():
    return j("POST", "/update", data=request.get_data(),
             headers={"Content-Type": "application/octet-stream"}, timeout=300)

@app.post("/api/update/check")
@api
def update_check(): return j("POST", "/update/check", timeout=120)

@app.get("/api/update/status")
@api
def update_status(): return j("GET", "/update/status")

@app.get("/api/update/changelog")
@api
def update_changelog():
    return j("GET", "/update/changelog",
             params={"version": request.args.get("version", "")})

@app.post("/api/update/install")
@api
def update_install(): return j("POST", "/update/install", timeout=120)

@app.post("/api/update/abort_download")
@api
def update_abort(): return j("POST", "/update/abort_download")

@app.get("/api/update/autoupdate")
@api
def autoupdate_get(): return j("GET", "/update/autoupdate")

@app.post("/api/update/autoupdate")
@api
def autoupdate_set():
    return j("POST", "/update/autoupdate", json_body=request.get_json(force=True))

# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    return send_from_directory("static", "index.html")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8931))
    app.run(host="127.0.0.1", port=port, debug=False)
