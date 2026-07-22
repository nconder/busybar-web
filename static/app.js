/* BUSY Bar Mission Control — frontend logic */
"use strict";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(method, path, { params, body, raw } = {}) {
  let url = "/api" + path;
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") q.set(k, v);
    }
    const qs = q.toString();
    if (qs) url += "?" + qs;
  }
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (raw) {
      opts.body = body; // ArrayBuffer / Blob / string
      opts.headers["Content-Type"] = "application/octet-stream";
    } else {
      opts.body = JSON.stringify(body);
      opts.headers["Content-Type"] = "application/json";
    }
  }
  const t0 = performance.now();
  const resp = await fetch(url, opts);
  const ms = Math.round(performance.now() - t0);
  const ct = resp.headers.get("Content-Type") || "";
  let data;
  if (ct.includes("json")) data = await resp.json();
  else if (ct.includes("image") || ct.includes("octet-stream")) data = await resp.arrayBuffer();
  else data = await resp.text();
  return { status: resp.status, ok: resp.ok, data, ms, ct };
}

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function kv(el, pairs) {
  el.innerHTML = pairs
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${esc(String(v))}</span></div>`)
    .join("") || '<div class="muted">no data</div>';
}
function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtBytes(n) {
  if (n === undefined || n === null) return "–";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(i ? 1 : 0) + " " + u[i];
}
function fmtDuration(ms) {
  if (ms === undefined || ms === null) return "–";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + "h " : "") + m + "m " + ss + "s";
}

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------
$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  $$(".tab").forEach((t) => t.classList.toggle("active", t === btn));
  $$(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab));
  const loader = TAB_LOADERS[btn.dataset.tab];
  if (loader) loader();
});

// ---------------------------------------------------------------------------
// connectivity pill
// ---------------------------------------------------------------------------
async function ping() {
  const pill = $("#conn-pill");
  try {
    const r = await api("GET", "/version");
    if (r.ok && r.data.api_semver) {
      pill.textContent = "● cloud API " + r.data.api_semver;
      pill.className = "pill pill-ok";
      return true;
    }
    throw new Error();
  } catch {
    pill.textContent = "○ unreachable";
    pill.className = "pill pill-err";
    return false;
  }
}

// ---------------------------------------------------------------------------
// Raw framebuffer → canvas.
// Front display: RGB888, 72×16 (3456 bytes).
// Back display: packed 4-bit grayscale, 2 px/byte, 80 bytes/row (160 px wide).
// ---------------------------------------------------------------------------
async function renderScreen(canvasId, display) {
  const canvas = $(canvasId);
  try {
    const url = "/api/screen?display=" + display;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("http " + resp.status);
    const w = parseInt(resp.headers.get("X-Frame-Width") || "0", 10);
    const h = parseInt(resp.headers.get("X-Frame-Height") || "0", 10);
    const fmt = resp.headers.get("X-Frame-Format") || "unknown";
    const buf = new Uint8Array(await resp.arrayBuffer());

    let img;
    if (fmt === "rgb888" && w && h) {
      img = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        img[i * 4] = buf[i * 3];
        img[i * 4 + 1] = buf[i * 3 + 1];
        img[i * 4 + 2] = buf[i * 3 + 2];
        img[i * 4 + 3] = 255;
      }
      canvas.width = w; canvas.height = h;
    } else if (fmt === "gray4" && w && h) {
      img = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++) {
        for (let bx = 0; bx < 80; bx++) {
          const byte = buf[row * 80 + bx];
          const hi = (byte >> 4) & 0x0f;   // even pixel (x = 2*bx)
          const lo = byte & 0x0f;          // odd pixel
          const x0 = bx * 2, x1 = bx * 2 + 1;
          if (x0 < w) {
            const v = hi * 17, o = (row * w + x0) * 4;
            img[o] = img[o + 1] = img[o + 2] = v; img[o + 3] = 255;
          }
          if (x1 < w) {
            const v = lo * 17, o = (row * w + x1) * 4;
            img[o] = img[o + 1] = img[o + 2] = v; img[o + 3] = 255;
          }
        }
      }
      canvas.width = w; canvas.height = h;
    } else {
      throw new Error("unknown frame format (" + buf.length + " bytes)");
    }
    canvas.getContext("2d").putImageData(new ImageData(img, canvas.width, canvas.height), 0, 0);
  } catch (e) {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f85149"; ctx.font = "8px monospace";
    ctx.fillText("no signal", 2, 9);
  }
}

let screenTimer = null;
let screenLoopGeneration = 0;
function startScreenLoop() {
  stopScreenLoop();
  const generation = screenLoopGeneration;
  const tick = async () => {
    if ($("#live-screen-toggle").checked && $("#tab-dashboard").classList.contains("active")) {
      // Wait for both cloud/device calls before scheduling another pair.  The
      // old setInterval(2000) piled up overlapping requests whenever BUSY's
      // origin slowed down, which increased the chance of Cloudflare 504s.
      await Promise.allSettled([
        renderScreen("#screen-front", 0),
        renderScreen("#screen-back", 1),
      ]);
    }
    if (generation === screenLoopGeneration) screenTimer = setTimeout(tick, 5000);
  };
  tick();
}
function stopScreenLoop() {
  screenLoopGeneration++;
  if (screenTimer) clearTimeout(screenTimer);
  screenTimer = null;
}
$("#refresh-screens").addEventListener("click", () => {
  renderScreen("#screen-front", 0); renderScreen("#screen-back", 1);
});

// ---------------------------------------------------------------------------
// dashboard cards
// ---------------------------------------------------------------------------
async function loadPower() {
  const r = await api("GET", "/status/power");
  if (!r.ok) return kv($("#power-body"), [["error", JSON.stringify(r.data)]]);
  const d = r.data;
  kv($("#power-body"), [
    ["state", d.state], ["battery", d.battery_charge + " %"],
    ["voltage", d.battery_voltage + " mV"], ["current", d.battery_current + " mA"],
    ["usb", d.usb_voltage + " mV"],
  ]);
}
async function loadDevice() {
  const r = await api("GET", "/status/device");
  if (!r.ok) return kv($("#device-body"), [["error", JSON.stringify(r.data)]]);
  const d = r.data;
  kv($("#device-body"), [
    ["serial", d.serial_number], ["model", d.otp_model],
    ["wifi mac", d.wifi_mac], ["ble mac", d.ble_mac], ["usb mac", d.usb_mac],
    ["security", d.firmware_security], ["otp valid", d.otp_valid],
  ]);
}
async function loadSystem() {
  const r = await api("GET", "/status/system");
  if (!r.ok) return kv($("#system-body"), [["error", JSON.stringify(r.data)]]);
  const d = r.data;
  kv($("#system-body"), [
    ["api", d.api_semver], ["uptime", d.uptime],
    ["boot", d.boot_time ? new Date(d.boot_time * 1000).toLocaleString() : "–"],
    ["auto-update", d.auto_update_enabled],
  ]);
}
async function loadNetwork() {
  const [w, t] = await Promise.all([api("GET", "/wifi/status"), api("GET", "/transport")]);
  const d = w.ok ? w.data : {};
  kv($("#network-body"), [
    ["transport", t.ok ? t.data.type : "–"],
    ["wifi state", d.state], ["ssid", d.ssid], ["bssid", d.bssid],
    ["channel", d.channel], ["rssi", d.rssi !== undefined ? d.rssi + " dBm" : undefined],
    ["security", d.security],
    ["ip", d.ip_config ? d.ip_config.address : undefined],
    ["ip method", d.ip_config ? d.ip_config.ip_method : undefined],
  ]);
}
function describeSnapshot(s) {
  if (!s) return [["timer", "unknown"]];
  const rows = [["state", s.type]];
  if (s.type === "SIMPLE") {
    rows.push(["time left", fmtDuration(s.time_left_ms)], ["paused", s.is_paused]);
  } else if (s.type === "INFINITE") {
    rows.push(["paused", s.is_paused]);
  } else if (s.type === "INTERVAL") {
    rows.push(
      ["interval", s.current_interval + " / " + s.interval_settings.interval_work_cycles_count],
      ["phase left", fmtDuration(s.current_interval_time_left_ms)],
      ["phase total", fmtDuration(s.current_interval_time_total_ms)],
      ["paused", s.is_paused]);
  }
  if (s.busy_bar_settings) {
    rows.push(["theme", s.busy_bar_settings.theme],
              ["smart home", s.busy_bar_settings.trigger_smart_home]);
  }
  return rows;
}
async function loadBusy() {
  const r = await api("GET", "/busy/snapshot");
  const rows = r.ok ? describeSnapshot(r.data.snapshot) : [["error", JSON.stringify(r.data)]];
  kv($("#busy-body"), rows);
  kv($("#timer-snapshot"), r.ok
    ? rows.concat([["snapshot ts", r.data.snapshot_timestamp_ms ? new Date(r.data.snapshot_timestamp_ms).toLocaleString() : "–"]])
    : rows);
}
async function loadAccount() {
  const [i, s, b] = await Promise.all([
    api("GET", "/account/info"), api("GET", "/account/status"), api("GET", "/account/backend")]);
  const rows = [];
  if (i.ok) rows.push(["linked", i.data.linked], ["email", i.data.email], ["account id", i.data.id]);
  if (s.ok) rows.push(["mqtt", s.data.status]);
  if (b.ok) rows.push(["server", b.data.server_url], ["cert", b.data.client_cert_type],
                      ["ignore cert", b.data.ignore_server_cert]);
  kv($("#account-body"), rows.length ? rows : [["error", "unreachable"]]);
}

// ---------------------------------------------------------------------------
// display & audio
// ---------------------------------------------------------------------------
const DRAW_PRESETS = {
  hello: (app, disp) => ({
    application_name: app, priority: 50,
    elements: [{
      id: "0", timeout: 10, align: "center", x: 36, y: 10, type: "text",
      text: "Hello from Mission Control!", font: "normal", color: "#FFFFFFFF",
      width: 72, scroll_rate: 1000, scroll_start_delay: 800, scroll_repeat_delay: 2000,
      display: disp,
    }],
  }),
  countdown: (app, disp) => ({
    application_name: app, priority: 50, led_notification_color: "#00FF00FF",
    elements: [{
      id: "0", timeout: 30, align: "center", x: 36, y: 10, type: "countdown",
      timestamp: String(Math.floor(Date.now() / 1000) + 300),
      direction: "time_left", show_hours: "when_non_zero", color: "#00FFFFFF", display: disp,
    }],
  }),
  rects: (app, disp) => ({
    application_name: app, priority: 50,
    elements: [
      { id: "0", timeout: 8, type: "rectangle", x: 2, y: 2, width: 30, height: 12,
        radius: 3, fill: "gradient_h", fill_colors: ["#FF0000FF", "#0000FFFF"],
        border_width: 1, border_color: "#FFFFFFFF", display: disp },
      { id: "1", timeout: 8, type: "text", x: 40, y: 10, text: "RECT", font: "small",
        color: "#FFFF00FF", display: disp },
    ],
  }),
  stock: (app, disp) => ({
    application_name: app, priority: 50,
    elements: [
      { id: "0", timeout: 8, type: "image", stock_path: "shared/logo.png", x: 0, y: 0, display: disp },
      { id: "1", timeout: 8, type: "text", x: 40, y: 10, text: "stock", font: "tiny",
        color: "#FFFFFFFF", display: disp },
    ],
  }),
  alert: (app, disp) => ({
    application_name: app, priority: 95, led_notification_color: "#FF0000FF",
    elements: [{
      id: "0", timeout: 6, align: "center", x: 36, y: 10, type: "text",
      text: "!! ALERT !!", font: "bold", color: "#FF3300FF", display: disp,
    }],
  }),
};

$$("[data-draw]").forEach((btn) => btn.addEventListener("click", async () => {
  const app = $("#draw-app").value.trim() || "mission_control";
  const disp = $("#draw-display").value;
  const payload = DRAW_PRESETS[btn.dataset.draw](app, disp);
  payload.priority = parseInt($("#draw-priority").value) || 50;
  if (btn.dataset.draw !== "countdown" && btn.dataset.draw !== "alert") {
    delete payload.led_notification_color;
  } else {
    payload.led_notification_color = $("#draw-led").value.toUpperCase() + "FF";
  }
  $("#draw-json").value = JSON.stringify(payload, null, 2);
  const r = await api("POST", "/display/draw", { body: payload });
  toast(r.ok ? "draw sent ✔" : "draw failed: " + JSON.stringify(r.data), r.ok ? "ok" : "err");
}));

$("#draw-custom").addEventListener("click", async () => {
  try {
    const payload = JSON.parse($("#draw-json").value);
    const r = await api("POST", "/display/draw", { body: payload });
    toast(r.ok ? "custom draw sent ✔" : "failed: " + JSON.stringify(r.data), r.ok ? "ok" : "err");
  } catch (e) { toast("invalid JSON: " + e.message, "err"); }
});

$("#draw-clear").addEventListener("click", async () => {
  const r = await api("DELETE", "/display/draw", { params: { application_name: $("#draw-app").value.trim() } });
  toast(r.ok ? "cleared" : JSON.stringify(r.data), r.ok ? "ok" : "err");
});
$("#draw-clear-all").addEventListener("click", async () => {
  const r = await api("DELETE", "/display/draw");
  toast(r.ok ? "display cleared" : JSON.stringify(r.data), r.ok ? "ok" : "err");
});

// audio
$("#audio-play").addEventListener("click", async () => {
  const app = $("#audio-app").value.trim() || "mission_control";
  const path = $("#audio-path").value.trim();
  const stock = $("#audio-stock").value.trim();
  if (!path && !stock) return toast("set an asset path or stock path", "err");
  const body = { application_name: app };
  if (path) body.path = path; else body.stock_path = stock;
  const r = await api("POST", "/audio/play", { body });
  toast(r.ok ? "playing ▶" : JSON.stringify(r.data), r.ok ? "ok" : "err");
});
$("#audio-stop").addEventListener("click", async () => {
  const r = await api("DELETE", "/audio/play");
  toast(r.ok ? "stopped ■" : JSON.stringify(r.data), r.ok ? "ok" : "err");
});

async function loadVolume() {
  const r = await api("GET", "/audio/volume");
  if (r.ok) { $("#volume-slider").value = r.data.volume; $("#volume-val").textContent = r.data.volume; }
}
let volDebounce = null;
$("#volume-slider").addEventListener("input", () => {
  $("#volume-val").textContent = $("#volume-slider").value;
  clearTimeout(volDebounce);
  volDebounce = setTimeout(async () => {
    const r = await api("POST", "/audio/volume", {
      params: { volume: $("#volume-slider").value, silent: $("#volume-silent").checked ? 1 : 0 } });
    if (!r.ok) toast("volume: " + JSON.stringify(r.data), "err");
  }, 250);
});

async function loadBrightness() {
  const sel = $("#brightness");
  if (sel.options.length <= 1) {
    for (let i = 0; i <= 100; i += 5) {
      const o = document.createElement("option"); o.value = o.textContent = i; sel.appendChild(o);
    }
  }
  const r = await api("GET", "/display/brightness");
  if (r.ok) sel.value = r.data.value;
}
$("#brightness").addEventListener("change", async () => {
  const r = await api("POST", "/display/brightness", { params: { value: $("#brightness").value } });
  toast(r.ok ? "brightness → " + $("#brightness").value : JSON.stringify(r.data), r.ok ? "ok" : "err");
});

// remote input
$$(".btn.key").forEach((b) => b.addEventListener("click", async () => {
  const r = await api("POST", "/input", { params: { key: b.dataset.key } });
  toast(r.ok ? "key: " + b.dataset.key : JSON.stringify(r.data), r.ok ? "ok" : "err");
}));

// ---------------------------------------------------------------------------
// timer
// ---------------------------------------------------------------------------
$("#timer-type").addEventListener("change", () => {
  const t = $("#timer-type").value;
  $("#timer-simple-fields").classList.toggle("hidden", t !== "SIMPLE");
  $("#timer-interval-fields").classList.toggle("hidden", t !== "INTERVAL");
});

$("#timer-start").addEventListener("click", async () => {
  // capture pre-start state: the OK nudge (to foreground the timer screen) is
  // only safe on a genuine fresh start. When a session is already running, OK
  // acts as a session control in the device UI and can blank/reset the view.
  const pre = await api("GET", "/busy/snapshot");
  const wasRunning = pre.ok && pre.data.snapshot && pre.data.snapshot.type !== "NOT_STARTED";
  const t = $("#timer-type").value;
  let timer_settings;
  if (t === "SIMPLE") timer_settings = { type: "SIMPLE", total_time_ms: (+$("#timer-total-min").value) * 60000 };
  else if (t === "INTERVAL") timer_settings = {
    type: "INTERVAL",
    interval_work_ms: (+$("#timer-work-min").value) * 60000,
    interval_rest_ms: (+$("#timer-rest-min").value) * 60000,
    interval_work_cycles_count: +$("#timer-cycles").value,
    is_autostart_enabled: $("#timer-autostart").checked,
  };
  else timer_settings = { type: "INFINITE" };
  const r = await api("POST", "/busy/start", { body: {
    slot: $("#timer-slot").value,
    timer_settings,
    busy_bar_settings: {
      theme: $("#timer-theme").value || "busy",
      show_work_phase_only: $("#timer-work-only").checked,
      trigger_smart_home: $("#timer-smart").checked,
    },
  }});
  toast(r.ok ? "session started ▶" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  // The on-device CUSTOM/BUSY app only foregrounds its active timer screen on a
  // physical OK press. Nudge ONLY on a fresh start — when a session was already
  // running, OK acts as a session control (restart/blank), so we skip it.
  if (r.ok && !wasRunning) {
    setTimeout(() => api("POST", "/input", { params: { key: "ok" } }), 600);
  }
  loadBusy();
});
$("#timer-pause").addEventListener("click", async () => {
  const r = await api("POST", "/busy/pause");
  toast(r.ok ? "paused" : JSON.stringify(r.data), r.ok ? "ok" : "err"); loadBusy();
});
$("#timer-resume").addEventListener("click", async () => {
  const r = await api("POST", "/busy/resume");
  toast(r.ok ? "resumed" : JSON.stringify(r.data), r.ok ? "ok" : "err"); loadBusy();
});
$("#timer-stop").addEventListener("click", async () => {
  const r = await api("POST", "/busy/stop");
  toast(r.ok ? "stopped" : JSON.stringify(r.data), r.ok ? "ok" : "err"); loadBusy();
});

async function loadProfile(slot) {
  const r = await api("GET", "/busy/profiles/" + slot);
  $("#profile-" + slot + "-json").value = r.ok ? JSON.stringify(r.data, null, 2) : JSON.stringify(r.data);
}
async function saveProfile(slot) {
  try {
    const body = JSON.parse($("#profile-" + slot + "-json").value);
    body.profile_timestamp_ms = Date.now();
    const r = await api("PUT", "/busy/profiles/" + slot, { body });
    toast(r.ok ? slot + " profile saved" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  } catch (e) { toast("invalid JSON: " + e.message, "err"); }
}
$("#profile-busy-save").addEventListener("click", () => saveProfile("busy"));
$("#profile-custom-save").addEventListener("click", () => saveProfile("custom"));

// ---- custom mode quick controls -----------------------------------------
async function customStart() {
  const prof = await api("GET", "/busy/profiles/custom");
  if (!prof.ok) return toast("cannot read custom profile", "err");
  const ts = prof.data.timer_settings;
  let workOnly = $("#custom-work-only").checked;
  if (ts.type === "INFINITE" && workOnly) {
    workOnly = false;
    $("#custom-work-only").checked = false;
    toast("INFINITE + work-phase-only blanks the screen — forced off", "err");
  }
  const r = await api("POST", "/busy/start", { body: {
    slot: "custom",
    timer_settings: ts,
    busy_bar_settings: {
      theme: $("#custom-theme").value || "on_air",
      show_work_phase_only: workOnly,
      trigger_smart_home: $("#custom-smart").checked,
    },
  }});
  toast(r.ok ? "ZEN session started ▶" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  loadCustomState(); loadBusy();
}
async function loadCustomSettings() {
  const prof = await api("GET", "/busy/profiles/custom");
  if (!prof.ok) return;
  const s = prof.data.busy_bar_settings || {};
  $("#custom-theme").value = s.theme || "on_air";
  $("#custom-work-only").checked = !!s.show_work_phase_only;
  $("#custom-smart").checked = !!s.trigger_smart_home;
}
// live warning when combining INFINITE + work-phase-only
$("#custom-work-only").addEventListener("change", async () => {
  if (!$("#custom-work-only").checked) return;
  const prof = await api("GET", "/busy/profiles/custom");
  if (prof.ok && prof.data.timer_settings.type === "INFINITE") {
    toast("⚠ INFINITE + work-phase-only blanks the screen!", "err");
  }
});
async function customState2() {
  const r = await api("GET", "/busy/snapshot");
  return r.ok ? r.data.snapshot : null;
}
async function loadCustomState() {
  const s = await customState2();
  kv($("#custom-state"), describeSnapshot(s || {type: "unknown"}));
}
$("#custom-start").addEventListener("click", customStart);
$("#custom-pause").addEventListener("click", async () => {
  const r = await api("POST", "/busy/pause");
  toast(r.ok ? "paused" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  loadCustomState(); loadBusy();
});
$("#custom-resume").addEventListener("click", async () => {
  const r = await api("POST", "/busy/resume");
  toast(r.ok ? "resumed" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  loadCustomState(); loadBusy();
});
$("#custom-stop").addEventListener("click", async () => {
  const r = await api("POST", "/busy/stop");
  toast(r.ok ? "stopped" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  loadCustomState(); loadBusy();
});
$("#custom-open-app").addEventListener("click", async () => {
  const r = await api("POST", "/input", { params: { key: "custom" } });
  toast(r.ok ? "CUSTOM app opened on device" : JSON.stringify(r.data), r.ok ? "ok" : "err");
});

// ---------------------------------------------------------------------------
// storage & assets
// ---------------------------------------------------------------------------
let cwd = "/ext";
async function loadStorage(path) {
  cwd = path || cwd;
  const [list, usage] = await Promise.all([
    api("GET", "/storage/list", { params: { path: cwd } }),
    api("GET", "/storage/status"),
  ]);
  if (usage.ok) {
    const u = usage.data;
    kv($("#storage-usage"), [
      ["used", fmtBytes(u.used_bytes)], ["free", fmtBytes(u.free_bytes)],
      ["total", fmtBytes(u.total_bytes)],
      ["usage", u.total_bytes ? Math.round((u.used_bytes / u.total_bytes) * 100) + " %" : "–"],
    ]);
  }
  // breadcrumbs
  const parts = cwd.split("/").filter(Boolean);
  let acc = "";
  $("#storage-crumbs").innerHTML = parts.map((p, i) => {
    acc += "/" + p;
    const link = `<a data-path="${acc}">${esc(p)}</a>`;
    return i === 0 ? `<a data-path="/ext">ext</a>` : (i === 1 ? link : " / " + link);
  }).join("");
  const tbody = $("#storage-table tbody");
  tbody.innerHTML = "";
  if (!list.ok) {
    tbody.innerHTML = `<tr><td colspan="3" class="muted">${esc(JSON.stringify(list.data))}</td></tr>`;
    return;
  }
  const entries = (list.data.list || []).slice().sort((a, b) =>
    (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  if (cwd !== "/ext") {
    const tr = document.createElement("tr");
    const parent = cwd.slice(0, cwd.lastIndexOf("/")) || "/ext";
    tr.innerHTML = `<td class="name dir" data-path="${parent}">📁 ..</td><td></td><td></td>`;
    tbody.appendChild(tr);
  }
  for (const e of entries) {
    const full = cwd + "/" + e.name;
    const tr = document.createElement("tr");
    tr.innerHTML = e.type === "dir"
      ? `<td class="name dir" data-path="${full}">📁 ${esc(e.name)}</td><td>–</td>
         <td class="actions"><button class="btn" data-del="${full}">delete</button></td>`
      : `<td class="name" data-path="${full}" data-file="1">📄 ${esc(e.name)}</td><td>${fmtBytes(e.size)}</td>
         <td class="actions"><button class="btn" data-dl="${full}">download</button>
         <button class="btn" data-del="${full}">delete</button></td>`;
    tbody.appendChild(tr);
  }
}
$("#storage-table").addEventListener("click", async (e) => {
  const dir = e.target.closest(".name.dir");
  if (dir) return loadStorage(dir.dataset.path);
  const del = e.target.closest("[data-del]");
  if (del) {
    if (!confirm("Delete " + del.dataset.del + "?")) return;
    const r = await api("DELETE", "/storage/remove", { params: { path: del.dataset.del } });
    toast(r.ok ? "deleted" : JSON.stringify(r.data), r.ok ? "ok" : "err");
    return loadStorage();
  }
  const dl = e.target.closest("[data-dl]");
  if (dl) {
    const r = await api("GET", "/storage/read", { params: { path: dl.dataset.dl } });
    if (!r.ok) return toast("read failed", "err");
    const blob = new Blob([r.data]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = dl.dataset.dl.split("/").pop();
    a.click();
    URL.revokeObjectURL(a.href);
  }
});
$("#storage-crumbs").addEventListener("click", (e) => {
  const a = e.target.closest("a[data-path]");
  if (a) loadStorage(a.dataset.path);
});
$("#mkdir-btn").addEventListener("click", async () => {
  const name = $("#mkdir-name").value.trim();
  if (!name) return;
  const r = await api("POST", "/storage/mkdir", { params: { path: cwd + "/" + name } });
  toast(r.ok ? "folder created" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  $("#mkdir-name").value = "";
  loadStorage();
});

async function uploadFile(asAsset) {
  const f = $("#upload-file").files[0];
  if (!f) return toast("choose a file first", "err");
  const buf = await f.arrayBuffer();
  let r;
  if (asAsset) {
    r = await api("POST", "/assets/upload", {
      params: { application_name: $("#asset-app").value.trim() || "mission_control", file: f.name },
      body: buf, raw: true });
  } else {
    const dir = $("#upload-dir").value.trim() || "/ext/user_assets";
    r = await api("POST", "/storage/write", { params: { path: dir + "/" + f.name }, body: buf, raw: true });
  }
  toast(r.ok ? "uploaded " + f.name : JSON.stringify(r.data), r.ok ? "ok" : "err");
  if (!asAsset) loadStorage();
}
$("#upload-btn").addEventListener("click", () => uploadFile(false));
$("#asset-upload-btn").addEventListener("click", () => uploadFile(true));
$("#asset-delete-btn").addEventListener("click", async () => {
  const app = $("#asset-app").value.trim();
  if (!app || !confirm(`Delete ALL assets of "${app}"?`)) return;
  const r = await api("DELETE", "/assets/upload", { params: { application_name: app } });
  toast(r.ok ? "assets deleted" : JSON.stringify(r.data), r.ok ? "ok" : "err");
});
$("#rename-btn").addEventListener("click", async () => {
  const r = await api("POST", "/storage/rename", {
    params: { path: $("#rename-old").value.trim(), new_path: $("#rename-new").value.trim() } });
  toast(r.ok ? "renamed" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  loadStorage();
});

// ---------------------------------------------------------------------------
// connectivity
// ---------------------------------------------------------------------------
async function loadWifi() {
  const r = await api("GET", "/wifi/status");
  const d = r.ok ? r.data : {};
  kv($("#wifi-body"), r.ok ? [
    ["state", d.state], ["ssid", d.ssid], ["bssid", d.bssid], ["channel", d.channel],
    ["rssi", d.rssi !== undefined ? d.rssi + " dBm" : undefined], ["security", d.security],
    ["ip", d.ip_config?.address], ["method", d.ip_config?.ip_method], ["type", d.ip_config?.ip_type],
  ] : [["error", JSON.stringify(r.data)]]);
}
async function loadTransport() {
  const r = await api("GET", "/transport");
  kv($("#transport-body"), r.ok ? [["active transport", r.data.type]] : [["error", JSON.stringify(r.data)]]);
}
async function loadBle() {
  const r = await api("GET", "/ble/status");
  kv($("#ble-body"), r.ok
    ? [["status", r.data.status], ["remote", r.data.address]]
    : [["error", JSON.stringify(r.data)]]);
}
$("#ble-enable").addEventListener("click", async () => {
  const r = await api("POST", "/ble/enable"); toast(r.ok ? "BLE enabled" : JSON.stringify(r.data), r.ok ? "ok" : "err"); loadBle();
});
$("#ble-disable").addEventListener("click", async () => {
  const r = await api("POST", "/ble/disable"); toast(r.ok ? "BLE disabled" : JSON.stringify(r.data), r.ok ? "ok" : "err"); loadBle();
});
$("#ble-unpair").addEventListener("click", async () => {
  if (!confirm("Remove BLE pairing?")) return;
  const r = await api("DELETE", "/ble/pairing"); toast(r.ok ? "pairing removed" : JSON.stringify(r.data), r.ok ? "ok" : "err"); loadBle();
});
async function loadAccess() {
  const r = await api("GET", "/access");
  kv($("#access-body"), r.ok
    ? [["mode", r.data.mode], ["key valid", r.data.key_valid]]
    : [["error", JSON.stringify(r.data)]]);
  if (r.ok) $("#access-mode").value = r.data.mode;
}
$("#access-save").addEventListener("click", async () => {
  const params = { mode: $("#access-mode").value };
  if (params.mode === "key") params.key = $("#access-key").value.trim();
  const r = await api("POST", "/access", { params });
  toast(r.ok ? "access updated" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  loadAccess();
});
async function loadMqtt() {
  const r = await api("GET", "/account/backend");
  kv($("#mqtt-body"), r.ok ? [
    ["server url", r.data.server_url], ["client cert", r.data.client_cert_type],
    ["ignore server cert", r.data.ignore_server_cert],
  ] : [["error", JSON.stringify(r.data)]]);
}

// ---------------------------------------------------------------------------
// smart home
// ---------------------------------------------------------------------------
async function loadShPairing() {
  const r = await api("GET", "/smart_home/pairing");
  const d = r.ok ? r.data : {};
  kv($("#sh-pairing-body"), r.ok ? [
    ["fabrics", d.fabric_count],
    ["latest status", d.latest_pairing_status?.value],
    ["updated", d.latest_pairing_status?.timestamp
      ? new Date(d.latest_pairing_status.timestamp * 1000).toLocaleString() : undefined],
  ] : [["error", JSON.stringify(r.data)]]);
}
$("#sh-start-pairing").addEventListener("click", async () => {
  const r = await api("POST", "/smart_home/pairing");
  if (!r.ok) return toast("pairing failed: " + JSON.stringify(r.data), "err");
  const d = r.data;
  $("#sh-payload").classList.remove("hidden");
  kv($("#sh-payload-kv"), [
    ["manual code", d.manual_code],
    ["valid until", d.available_until ? new Date(+d.available_until).toLocaleString() : "–"],
    ["qr payload", d.qr_code],
  ]);
  const qrelt = $("#sh-qr");
  qrelt.innerHTML = "";
  try {
    const qr = qrcode(0, "M");
    qr.addData(d.qr_code); qr.make();
    qrelt.innerHTML = qr.createImgTag(5, 0);
  } catch (e) { qrelt.textContent = "QR render failed: " + e.message; }
  toast("commissioning window open", "ok");
});
$("#sh-erase").addEventListener("click", async () => {
  if (!confirm("Erase ALL smart home fabrics?")) return;
  const r = await api("DELETE", "/smart_home/pairing");
  toast(r.ok ? "fabrics erased" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  loadShPairing();
});
async function loadShSwitch() {
  const r = await api("GET", "/smart_home/switch");
  if (r.ok) {
    $("#sh-switch-toggle").checked = !!r.data.state;
    $("#sh-switch-label").textContent = r.data.state ? "ON" : "OFF";
  }
}
$("#sh-switch-toggle").addEventListener("change", async () => {
  const on = $("#sh-switch-toggle").checked;
  const r = await api("POST", "/smart_home/switch", { body: { state: on } });
  if (r.ok) { $("#sh-switch-label").textContent = on ? "ON" : "OFF"; toast("switch → " + (on ? "ON" : "OFF"), "ok"); }
  else { toast(JSON.stringify(r.data), "err"); loadShSwitch(); }
});
$("#sh-startup-save").addEventListener("click", async () => {
  const startup = $("#sh-startup").value;
  if (!startup) return toast("pick a startup behavior", "err");
  const r = await api("POST", "/smart_home/switch", { body: { startup } });
  toast(r.ok ? "startup → " + startup : JSON.stringify(r.data), r.ok ? "ok" : "err");
});

// ---------------------------------------------------------------------------
// system & time
// ---------------------------------------------------------------------------
async function loadName() {
  const r = await api("GET", "/name");
  if (r.ok) $("#device-name").value = r.data.name;
}
$("#name-save").addEventListener("click", async () => {
  const r = await api("POST", "/name", { body: { name: $("#device-name").value.trim() } });
  toast(r.ok ? "name saved" : JSON.stringify(r.data), r.ok ? "ok" : "err");
});
async function loadTime() {
  const [t, tz] = await Promise.all([api("GET", "/time"), api("GET", "/time/timezone")]);
  const rows = [];
  if (t.ok) rows.push(["device time", t.data.timestamp]);
  if (tz.ok) rows.push(["timezone", `${tz.data.name} (${tz.data.abbr})`], ["offset", tz.data.offset]);
  kv($("#time-body"), rows);
}
$("#time-sync").addEventListener("click", async () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const offMin = -now.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offMin) / 60))}:${pad(Math.abs(offMin) % 60)}`;
  const r = await api("POST", "/time/timestamp", { params: { timestamp: iso } });
  toast(r.ok ? "clock synced" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  loadTime();
});
let tzLoaded = false;
async function loadTzList() {
  if (tzLoaded) return;
  const r = await api("GET", "/time/tzlist");
  if (!r.ok) return;
  const sel = $("#tz-select");
  for (const t of r.data.list || []) {
    const o = document.createElement("option");
    o.value = t.name;
    o.textContent = `${t.name} (${t.offset} ${t.abbr})`;
    sel.appendChild(o);
  }
  const cur = await api("GET", "/time/timezone");
  if (cur.ok) sel.value = cur.data.name;
  tzLoaded = true;
}
$("#tz-save").addEventListener("click", async () => {
  const r = await api("POST", "/time/timezone", { params: { timezone: $("#tz-select").value } });
  toast(r.ok ? "timezone → " + $("#tz-select").value : JSON.stringify(r.data), r.ok ? "ok" : "err");
  loadTime();
});
async function loadFirmware() {
  const r = await api("GET", "/status/firmware");
  const d = r.ok ? r.data : {};
  kv($("#firmware-body"), r.ok ? [
    ["version", d.version], ["target", d.target], ["branch", d.branch],
    ["build", d.build_date], ["commit", d.commit_hash], ["nwp", d.nwp_version],
    ["matter", d.matter_version],
  ] : [["error", JSON.stringify(r.data)]]);
}
$("#logdump-btn").addEventListener("click", async () => {
  const name = $("#logdump-name").value.trim();
  const r = await api("POST", "/log_dump", { params: name ? { filename: name } : {} });
  kv($("#logdump-result"), r.ok
    ? [["result", r.data.result], ["path", r.data.path]]
    : [["error", JSON.stringify(r.data)]]);
  toast(r.ok ? "log dumped" : "dump failed", r.ok ? "ok" : "err");
});

// ---------------------------------------------------------------------------
// firmware updates
// ---------------------------------------------------------------------------
async function loadUpdate() {
  const r = await api("GET", "/update/status");
  if (!r.ok) return kv($("#update-body"), [["error", JSON.stringify(r.data)]]);
  const i = r.data.install || {}, c = r.data.check || {};
  kv($("#update-body"), [
    ["install allowed", i.is_allowed], ["event", i.event], ["action", i.action],
    ["status", i.status], ["detail", i.detail || undefined],
    ["download", i.download && i.download.total_bytes
      ? `${fmtBytes(i.download.received_bytes)} / ${fmtBytes(i.download.total_bytes)} @ ${fmtBytes(i.download.speed_bytes_per_sec)}/s`
      : undefined],
    ["available version", c.available_version || "none"],
    ["check status", c.status],
  ]);
  const wrap = $("#update-progress-wrap");
  if (i.download && i.download.total_bytes) {
    wrap.classList.remove("hidden");
    $("#update-progress").style.width =
      Math.round((i.download.received_bytes / i.download.total_bytes) * 100) + "%";
  } else wrap.classList.add("hidden");
}
$("#update-check").addEventListener("click", async () => {
  toast("checking for updates…");
  const r = await api("POST", "/update/check");
  toast(r.ok ? "check started" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  setTimeout(loadUpdate, 4000);
});
$("#update-install").addEventListener("click", async () => {
  if (!confirm("Install downloaded firmware update? Device will reboot.")) return;
  const r = await api("POST", "/update/install");
  toast(r.ok ? "install started" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  setTimeout(loadUpdate, 3000);
});
$("#update-abort").addEventListener("click", async () => {
  const r = await api("POST", "/update/abort_download");
  toast(r.ok ? "download aborted" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  loadUpdate();
});
$("#changelog-btn").addEventListener("click", async () => {
  const v = $("#changelog-version").value.trim();
  if (!v) return toast("enter a version", "err");
  const r = await api("GET", "/update/changelog", { params: { version: v } });
  $("#changelog-out").textContent = r.ok ? (r.data.changelog || "(empty)") : JSON.stringify(r.data);
});
async function loadAutoupdate() {
  const r = await api("GET", "/update/autoupdate");
  if (!r.ok) return;
  $("#au-enabled").checked = !!r.data.is_enabled;
  if (r.data.interval_start) $("#au-start").value = r.data.interval_start;
  if (r.data.interval_end) $("#au-end").value = r.data.interval_end;
}
$("#au-save").addEventListener("click", async () => {
  const r = await api("POST", "/update/autoupdate", { body: {
    is_enabled: $("#au-enabled").checked,
    interval_start: $("#au-start").value,
    interval_end: $("#au-end").value,
  }});
  toast(r.ok ? "auto-update saved" : JSON.stringify(r.data), r.ok ? "ok" : "err");
});
$("#fw-flash").addEventListener("click", async () => {
  const f = $("#fw-file").files[0];
  if (!f) return toast("choose a .tar firmware file", "err");
  if (!confirm(`Flash ${f.name} (${fmtBytes(f.size)}) to the device?`)) return;
  const buf = await f.arrayBuffer();
  toast("uploading firmware…");
  const r = await api("POST", "/update", { body: buf, raw: true });
  toast(r.ok ? "firmware accepted" : JSON.stringify(r.data), r.ok ? "ok" : "err");
  setTimeout(loadUpdate, 3000);
});

// ---------------------------------------------------------------------------
// playground
// ---------------------------------------------------------------------------
const ENDPOINTS = [
  "GET /version", "GET /status", "GET /status/device", "GET /status/firmware",
  "GET /status/system", "GET /status/power", "GET /transport",
  "GET /account/info", "GET /account/status", "GET /account/backend",
  "POST /assets/upload", "DELETE /assets/upload",
  "POST /display/draw", "DELETE /display/draw",
  "POST /audio/play", "DELETE /audio/play",
  "POST /ble/enable", "POST /ble/disable", "DELETE /ble/pairing", "GET /ble/status",
  "GET /busy/snapshot", "PUT /busy/snapshot",
  "GET /busy/profiles/busy", "PUT /busy/profiles/busy",
  "GET /busy/profiles/custom", "PUT /busy/profiles/custom",
  "POST /input", "GET /access", "POST /access",
  "GET /name", "POST /name",
  "GET /display/brightness", "POST /display/brightness",
  "GET /audio/volume", "POST /audio/volume",
  "GET /smart_home/pairing", "POST /smart_home/pairing", "DELETE /smart_home/pairing",
  "GET /smart_home/switch", "POST /smart_home/switch",
  "POST /storage/write", "GET /storage/read", "GET /storage/list",
  "DELETE /storage/remove", "POST /storage/mkdir", "POST /storage/rename", "GET /storage/status",
  "GET /screen", "GET /wifi/status",
  "GET /time", "POST /time/timestamp", "GET /time/timezone", "POST /time/timezone", "GET /time/tzlist",
  "POST /update", "POST /update/check", "GET /update/status", "GET /update/changelog",
  "POST /update/install", "POST /update/abort_download",
  "GET /update/autoupdate", "POST /update/autoupdate",
  "POST /log_dump",
];
$("#pg-endpoints").innerHTML = [...new Set(ENDPOINTS.map((e) => e.split(" ")[1]))]
  .map((p) => `<option value="${p}">`).join("");

$("#pg-send").addEventListener("click", async () => {
  let path = $("#pg-path").value.trim();
  if (!path) return;
  path = path.replace(/^https?:\/\/[^/]+/, "").replace(/^\/busybar/, "");
  let params;
  try { params = $("#pg-params").value.trim() ? JSON.parse($("#pg-params").value) : undefined; }
  catch { return toast("params must be JSON object", "err"); }
  let body;
  try { body = $("#pg-body").value.trim() ? JSON.parse($("#pg-body").value) : undefined; }
  catch { return toast("body must be valid JSON", "err"); }
  const r = await api($("#pg-method").value, path, { params, body });
  $("#pg-status").textContent = r.status;
  $("#pg-status").className = "pill " + (r.ok ? "pill-ok" : "pill-err");
  $("#pg-time").textContent = r.ms + " ms";
  $("#pg-response").textContent =
    typeof r.data === "string" ? r.data
    : r.data instanceof ArrayBuffer ? `[binary ${r.data.byteLength} bytes]`
    : JSON.stringify(r.data, null, 2);
});

// ---------------------------------------------------------------------------
// token dialog
// ---------------------------------------------------------------------------
$("#token-btn").addEventListener("click", async () => {
  const r = await api("GET", "/token/status");
  $("#token-status").textContent = r.ok
    ? `Configured: ${r.data.configured} (default: ${r.data.using_default}) ${r.data.hint || ""}` : "";
  $("#token-dialog").showModal();
});
$("#token-save").addEventListener("click", async () => {
  const tok = $("#token-input").value.trim();
  if (!tok) return;
  const r = await api("POST", "/token", { body: { token: tok } });
  toast(r.ok ? "token saved" : "failed", r.ok ? "ok" : "err");
  if (r.ok) { $("#token-dialog").close(); ping(); loadAll(); }
});
$("#token-close").addEventListener("click", () => $("#token-dialog").close());

// ---------------------------------------------------------------------------
// help: API reference table (built from ENDPOINTS)
// ---------------------------------------------------------------------------
const ENDPOINT_GROUPS = {
  "Account": ["info", "status", "backend"],
  "Assets / Display / Audio": ["assets", "display", "audio"],
  "BLE": ["ble"],
  "BUSY Timer": ["busy"],
  "Input": ["input"],
  "Settings": ["access", "name", "brightness", "volume"],
  "Smart Home": ["smart_home"],
  "Storage": ["storage"],
  "Streaming": ["screen", "status/ws"],
  "System": ["version", "transport", "log_dump"],
  "Time": ["time"],
  "Updater": ["update"],
  "Wi-Fi": ["wifi"],
};
function endpointGroup(path) {
  for (const [group, keys] of Object.entries(ENDPOINT_GROUPS)) {
    if (keys.some((k) => path.includes(k))) return group;
  }
  return "System";
}
function buildApiRef() {
  const host = $("#apiref-table");
  if (!host || host.dataset.built) return;
  const groups = {};
  for (const e of ENDPOINTS) {
    const [method, path] = e.split(" ");
    const g = endpointGroup(path);
    (groups[g] = groups[g] || []).push([method, path]);
  }
  const METHOD_COLOR = { GET: "#2ea043", POST: "#d29922", PUT: "#6cb6ff", DELETE: "#f85149" };
  host.innerHTML = Object.entries(groups).map(([g, rows]) => `
    <h3>${esc(g)}</h3>
    <table class="tbl">
      ${rows.map(([m, p]) => `<tr>
        <td style="width:70px"><span style="color:${METHOD_COLOR[m]};font-family:var(--mono);font-weight:600">${m}</span></td>
        <td style="font-family:var(--mono);font-size:12px">/busybar${esc(p)}</td>
      </tr>`).join("")}
    </table>`).join("");
  host.dataset.built = "1";
}

// ---------------------------------------------------------------------------
// refresh buttons + tab loaders + boot
// ---------------------------------------------------------------------------
const REFRESH = {
  power: loadPower, device: loadDevice, system: loadSystem, network: loadNetwork,
  busy: loadBusy, account: loadAccount, wifi: loadWifi, transport: loadTransport,
  ble: loadBle, access: loadAccess, mqtt: loadMqtt,
  "sh-pairing": loadShPairing, "sh-switch": loadShSwitch,
  time: loadTime, firmware: loadFirmware, update: loadUpdate, autoupdate: loadAutoupdate,
  storage: () => loadStorage("/ext"),
  "profile-busy": () => loadProfile("busy"),
  "profile-custom": () => loadProfile("custom"),
};
$$("[data-refresh]").forEach((b) =>
  b.addEventListener("click", () => REFRESH[b.dataset.refresh] && REFRESH[b.dataset.refresh]()));

const TAB_LOADERS = {
  dashboard: () => { loadPower(); loadDevice(); loadSystem(); loadNetwork(); loadBusy(); loadAccount(); },
  display: () => { loadVolume(); loadBrightness(); },
  timer: () => { loadBusy(); loadProfile("busy"); loadProfile("custom"); loadCustomState(); loadCustomSettings(); },
  storage: () => loadStorage("/ext"),
  connectivity: () => { loadWifi(); loadTransport(); loadBle(); loadAccess(); loadMqtt(); },
  smarthome: () => { loadShPairing(); loadShSwitch(); },
  system: () => { loadName(); loadTime(); loadTzList(); loadFirmware(); },
  update: () => { loadUpdate(); loadAutoupdate(); },
  help: () => buildApiRef(),
};

function loadAll() {
  ping();
  TAB_LOADERS.dashboard();
  startScreenLoop();
}

// back-to-top button (help page is long)
window.addEventListener("scroll", () => {
  $("#back-top").style.display = window.scrollY > 400 ? "flex" : "none";
});
$("#back-top").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

// periodic light refresh on dashboard
setInterval(() => {
  if ($("#tab-dashboard").classList.contains("active")) { loadPower(); loadBusy(); ping(); }
}, 15000);

loadAll();
