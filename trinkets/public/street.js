/* ===================== DOUBLE-BOOT GUARD ===================== */
if (window.__streetBooted) {
  console.warn('[street] script already initialized – skipping second init');
  throw new Error('street.js already booted');
}
window.__streetBooted = true;

/* ============================================================= */
/* Street (unlimited, no defaults, no name bubbles)
   - Start with ZERO walkers (no base legs).
   - Every new trinket spawns a NEW walker (no cap, no replacement).
   - TRINKET: enters from one edge, walks straight across, despawns off-screen.
   - Admin controls supported:
       • spawn_leg -> adds an "empty" leg (manual only)
       • clear_legs -> removes all walkers
       • replay_trinket -> spawns a trinket walker once (de-duped)
       • delete_trinket -> remove matching walker(s) immediately
   - Prune active trinkets if admin deleted them from the feed.
   - Background containment + unified sizing across resolutions.
   - Endpoint auto-discovery (or override with window.TRINKETS_API).
   - Robust de-dupe via stable key (id or hash of src ONLY). */
/* ============================================================= */

//////////////////////////
// Endpoint resolution  //
//////////////////////////

const OVERRIDE_LIST_URL =
  (typeof window !== "undefined" && window.TRINKETS_API) ? window.TRINKETS_API : null;

const API_CANDIDATES = [
  "/api/trinkets",
  "/trinkets",
  "/trinkets?format=json",
  "/trinkets.json",
  "/api/items",
  "/items",
  "/api/submissions",
  "/submissions"
];

let LIST_URL = null;
const DEBUG = true;
const POLL_MS = 10000; // how often to poll the feed

////////////////////
// API utilities  //
////////////////////

function normalizeListShape(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const keys = ["items", "data", "rows", "results", "submissions", "trinkets", "list"];
    for (const k of keys) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return null;
}

async function probeJson(url, timeoutMs = 2500) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { headers: { "Accept":"application/json" }, cache: "no-store", signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return { ok:false, status:res.status };
    const txt = await res.text();
    let data = null;
    try { data = JSON.parse(txt); } catch {}
    const list = normalizeListShape(data);
    return { ok:Array.isArray(list), status:res.status, list };
  } catch {
    return { ok:false, status:0 };
  }
}

async function resolveListUrl() {
  if (OVERRIDE_LIST_URL) {
    const test = await probeJson(OVERRIDE_LIST_URL);
    if (test.ok) { DEBUG && console.log("[street] Using override LIST_URL:", OVERRIDE_LIST_URL); return OVERRIDE_LIST_URL; }
    DEBUG && console.warn("[street] Override LIST_URL failed:", OVERRIDE_LIST_URL, "status:", test.status);
  }
  for (const candidate of API_CANDIDATES) {
    const test = await probeJson(candidate);
    if (test.ok) { DEBUG && console.log("[street] Resolved LIST_URL:", candidate); return candidate; }
    else { DEBUG && console.warn("[street] Probe failed", candidate, "status:", test.status); }
  }
  return null;
}

async function fetchJSON(u){
  try{
    const r = await fetch(u, { headers:{ "Accept":"application/json","Cache-Control":"no-cache" }, cache:"no-store" });
    if (!r.ok) throw new Error(`${u} -> ${r.status}`);
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { return null; }
  }catch(e){
    DEBUG && console.warn("[street] fetch fail", u, e);
    return null;
  }
}

/////////////////////////////
// Variants & attach points
/////////////////////////////

const LEG_VARIANTS = [
  "assets/leg1_default.gif",
  "assets/leg1_bag.gif",
  "assets/leg1_sling.gif",
];

const ATTACH_POINTS = {
  default: { x:  0,    y: 0.30 }, // middle of legs
  bag:     { x: -0.15, y: 0.18 }, // middle-left (bag)
  sling:   { x: -0.05, y: 0.20 }, // middle-top (sling)
};

const GLOBAL_TRINKET_SCALE = 0.5;
const TRINKET_SCALES = { default: 0.3, bag: 0.4, sling: 0.3 };

/////////////////////////////
// Despawn margin & ground //
/////////////////////////////

const DESPAWN_MARGIN = 80;
const GROUND_LIFT = 150;

/////////////////////////////
// DOM & background bounds //
/////////////////////////////

let bgFrame = document.getElementById("bgFrame");
if (!bgFrame) { bgFrame = document.createElement("div"); bgFrame.id = "bgFrame"; document.body.appendChild(bgFrame); }
let layer = document.getElementById("walkerLayer");
if (!layer) { layer = document.createElement("div"); layer.id = "walkerLayer"; bgFrame.appendChild(layer); }

let bgRect = { left:0, top:0, width:0, height:0 };
let CURRENT_LEGGY_SIZE = 320;

function computeLeggySize() {
  const h = bgRect.height || document.documentElement.clientHeight || 800;
  const s = clamp(h * 1.40, 260, 560);
  return Math.round(s);
}
function applyLeggySize() {
  CURRENT_LEGGY_SIZE = computeLeggySize();
  document.documentElement.style.setProperty('--leggy-size', `${CURRENT_LEGGY_SIZE}px`);
}
function groundY(size) {
  const margin = 12;
  return Math.max(0, bgRect.height - size - margin - GROUND_LIFT);
}

function parseBgUrl() {
  const str = getComputedStyle(document.body).backgroundImage;
  if (!str || str === "none") return null;
  const m = str.match(/url\(["']?(.*?)["']?\)/i);
  return m ? m[1] : null;
}
function computeContainRect(imgW, imgH, boxW, boxH) {
  const s = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * s, h = imgH * s;
  return { left:(boxW-w)/2, top:(boxH-h)/2, width:w, height:h };
}
function applyBgRect() {
  Object.assign(bgFrame.style, {
    position:"fixed", overflow:"hidden", pointerEvents:"none",
    left:`${bgRect.left}px`, top:`${bgRect.top}px`,
    width:`${bgRect.width}px`, height:`${bgRect.height}px`,
  });
}
async function measureBackground() {
  const url = parseBgUrl();
  const boxW = document.documentElement.clientWidth;
  const boxH = document.documentElement.clientHeight;
  if (!url) {
    bgRect = { left:0, top:0, width:boxW, height:boxH };
    applyBgRect(); applyLeggySize(); return;
  }
  await new Promise((res)=>{
    const img = new Image();
    img.onload  = ()=>{ bgRect = computeContainRect(img.naturalWidth||1, img.naturalHeight||1, boxW, boxH); applyBgRect(); applyLeggySize(); res(); };
    img.onerror = ()=>{ bgRect = { left:0, top:0, width:boxW, height:boxH }; applyBgRect(); applyLeggySize(); res(); };
    img.src = url;
  });
}
addEventListener("resize", () => {
  clearTimeout(window._bgR);
  window._bgR = setTimeout(measureBackground, 120);
});

////////////
// Utils  //
////////////

const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const pick  = (arr)=>arr[(Math.random()*arr.length)|0];
const randBetween = (a,b)=>Math.random()*(b-a)+a;

function normalizeSrc(t){
  if (!t) return "";
  if (/^(data:|https?:|\/)/i.test(t)) return t;
  return t.startsWith("uploads/") ? `/${t}` : t;
}
const getRowId   = r => r?.id ?? r?._id ?? r?.uuid ?? r?.guid ?? r?.pk ?? null;
const getRowSrc  = r => r?.image_path ?? r?.image ?? r?.src ?? r?.drawing ?? "";
const getRowName = r => r?.trinketName ?? r?.name ?? r?.displayName ?? r?.title ?? r?.label ?? r?.filename ?? "";

function hashStr(s){
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}
function deriveKeyFromRow(row){
  const id = getRowId(row);
  if (id != null) return String(id);
  const src = getRowSrc(row) || "";
  if (src) return "s_" + hashStr(src);
  const name = getRowName(row) || "";
  return name ? "n_" + hashStr(name) : null;
}

/////////////////////
// Fade helpers    //
/////////////////////

function raf(){ return new Promise(r => requestAnimationFrame(r)); }
async function fadeInEl(el, ms=480){
  el.style.transition = 'none';
  el.style.opacity = '0';
  await raf(); await raf();
  el.style.transition = `opacity ${ms}ms ease-out`;
  el.style.opacity = '1';
}
async function fadeOutEl(el, ms=400){
  el.style.transition = `opacity ${ms}ms ease-in`;
  el.style.opacity = '0';
  return new Promise(r => setTimeout(r, ms));
}

////////////////////////////
// Walker registry/maps   //
////////////////////////////

const walkers = new Map(); // id -> { el, type, sourceId, bornAt, refs:{}, motion:{} }
const emptyIds = new Set();   // kept for admin manual spawns
const trinketIds = new Set(); // kept for debugging/metrics

function genId(){ return `w_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }

async function removeWalker(id, fadeMs=300){
  const rec = walkers.get(id);
  if (!rec) return;
  await fadeOutEl(rec.el, fadeMs);
  rec.el.remove();
  walkers.delete(id);
  emptyIds.delete(id);
  trinketIds.delete(id);
}

/////////////////////////////////////////
// Spawn walker (trinketSrc can be null)
/////////////////////////////////////////

function spawnWalker(trinketSrc, meta = {}) {
  const { sourceId = null } = meta;
  const wid = genId();

  const el = document.createElement("div");
  el.className = "walker";
  el.dataset.walkerId = wid;
  layer.appendChild(el);

  const legSrc = pick(LEG_VARIANTS);
  const vKey   = /sling/i.test(legSrc) ? "sling" : /bag/i.test(legSrc) ? "bag" : "default";

  const leg = document.createElement("img");
  leg.className = "gif";
  leg.alt = "legs";
  leg.src = `${legSrc}?cb=${Date.now()}_${Math.random().toString(36).slice(2)}`;
  el.appendChild(leg);

  let type = "empty";
  let tr = null;
  if (trinketSrc) {
    type = "trinket";
    tr = document.createElement("img");
    tr.className = "trinket";
    tr.alt = "trinket";
    tr.src = normalizeSrc(trinketSrc);
    const scale = (TRINKET_SCALES[vKey] ?? 1) * GLOBAL_TRINKET_SCALE;
    tr.style.setProperty("--scale", scale);
    el.appendChild(tr);
  }

  const size = CURRENT_LEGGY_SIZE;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;

  const ap     = ATTACH_POINTS[vKey] || ATTACH_POINTS.default;
  const baseTX = size * ap.x;
  const baseTY = size * ap.y;

  const motion = {};

  if (type === "trinket") {
    const fromLeft = Math.random() < 0.5;
    const y = groundY(size);
    let x = fromLeft ? (-size - DESPAWN_MARGIN) : (bgRect.width + DESPAWN_MARGIN);
    const dir = fromLeft ? 1 : -1;
    const speed = randBetween(22, 42);
    let vx = dir * speed;
    let vy = (Math.random()*2 - 1) * 2;

    Object.assign(motion, { type, x, y, vx, vy, dir, fixed:true, size, baseTX, baseTY });

    el.style.transform = `translate(${x}px, ${y}px)`;
    leg.style.transform = `translateX(-50%) scaleX(${vx < 0 ? -1 : 1})`;
    if (tr) {
      const tx = (vx < 0 ? -baseTX : baseTX);
      tr.style.setProperty("--tx", `${tx}px`);
      tr.style.setProperty("--ty", `${baseTY}px`);
    }
  } else {
    // "empty" (manual admin) – bounce within frame
    let x = Math.random() * Math.max(0, bgRect.width - size);
    let y = groundY(size) + randBetween(-4, 4);
    let dir = Math.random() < 0.5 ? 1 : -1;
    let speed = randBetween(14, 32);
    let vx = dir * speed;
    let vy = (Math.random()*2 - 1) * 4;

    let nextSpeedChange = performance.now() + randBetween(2000, 6000);
    Object.assign(motion, { type, x, y, vx, vy, dir, speed, nextSpeedChange, size, baseTX, baseTY });
  }

  fadeInEl(el, 480);

  const rec = { el, type, sourceId, bornAt: performance.now(), refs: { leg, tr }, motion };
  walkers.set(wid, rec);
  if (type === "empty") emptyIds.add(wid); else trinketIds.add(wid);

  let last = performance.now();
  function step(t){
    const now = t || performance.now();
    const dt  = Math.min(0.05, (now - last)/1000);
    last = now;

    const { leg, tr } = rec.refs;

    if (rec.type === "trinket") {
      motion.x += motion.vx * dt;
      motion.y = groundY(motion.size);

      motion.vy += (Math.random()*2 - 1) * 1.4 * dt;
      motion.vy *= 0.985;

      leg.style.transform = `translateX(-50%) scaleX(${motion.vx < 0 ? -1 : 1})`;
      if (tr) {
        const tx = (motion.vx < 0 ? -motion.baseTX : motion.baseTX);
        const ty = motion.baseTY;
        tr.style.setProperty("--tx", `${tx}px`);
        tr.style.setProperty("--ty", `${ty}px`);
      }

      el.style.transform = `translate(${motion.x}px, ${motion.y}px)`;

      // offscreen cleanup
      if (motion.vx > 0 && motion.x > bgRect.width + DESPAWN_MARGIN) { cleanupTrinket(); return; }
      if (motion.vx < 0 && motion.x < -motion.size - DESPAWN_MARGIN) { cleanupTrinket(); return; }

    } else {
      // empty walker (manual admin only) — bounce inside frame
      if (now >= motion.nextSpeedChange) {
        if (Math.random() < 0.20) motion.dir *= -1;
        motion.speed = randBetween(14, 32);
        motion.nextSpeedChange = now + randBetween(2000, 6000);
      }
      const targetVx = motion.dir * motion.speed;
      motion.vx += (targetVx - motion.vx) * Math.min(1, 0.8 * dt * 10);

      motion.x += motion.vx * dt;
      motion.y += motion.vy * dt;

      motion.vy += (Math.random()*2 - 1) * 2 * dt;
      motion.vy *= 0.98;

      leg.style.transform = `translateX(-50%) scaleX(${motion.vx < 0 ? -1 : 1})`;
      if (tr) {
        const tx = (motion.vx < 0 ? -motion.baseTX : motion.baseTX);
        const ty = motion.baseTY;
        tr.style.setProperty("--tx", `${tx}px`);
        tr.style.setProperty("--ty", `${ty}px`);
      }

      if (motion.x <= 0) { motion.x = 0; motion.dir = 1; motion.vx = Math.abs(motion.vx); }
      if (motion.x >= bgRect.width - motion.size) { motion.x = bgRect.width - motion.size; motion.dir = -1; motion.vx = -Math.abs(motion.vx); }
      const gy = groundY(motion.size);
      if (motion.y < gy) { motion.y = gy; if (motion.vy < 0) motion.vy = Math.abs(motion.vy); }
      if (motion.y > gy) { motion.y = gy; if (motion.vy > 0) motion.vy = -Math.abs(motion.vy); }

      el.style.transform = `translate(${motion.x}px, ${motion.y}px)`;
    }

    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  async function cleanupTrinket(){
    await fadeOutEl(rec.el, 300);
    if (!walkers.has(wid)) return;
    walkers.delete(wid);
    emptyIds.delete(wid);
    trinketIds.delete(wid);
    el.remove();
  }

  return wid;
}

//////////////////////////////
// Trinket spawn (no replace)
//////////////////////////////

function spawnTrinket(trinketSrc, sourceId) {
  // No replacement: just add another walker to the scene
  spawnWalker(trinketSrc, { sourceId });
  if (sourceId != null) {
    const key = String(sourceId);
    pendingTrinketIds.delete(key);
    displayedTrinketIds.add(key);
  }
}

/////////////////////////////////////
// Queue (polling/admin -> screen) //
/////////////////////////////////////

let seenTrinketIds = new Set();
const pendingQueue = [];
let processingQueue = false;

const pendingTrinketIds = new Set();   // queued but not spawned
const displayedTrinketIds = new Set(); // already spawned

function enqueueTrinket(id, name, src, force = false){
  const key = (id != null) ? String(id) : null;
  if (!force && key) {
    if (pendingTrinketIds.has(key) || displayedTrinketIds.has(key)) {
      if (DEBUG) console.log('[street] skip duplicate enqueue', key);
      return;
    }
  }
  pendingQueue.push({ id: key, name: name || "", src: src || "", force: !!force });
  if (key) pendingTrinketIds.add(key);
  processQueueSoon();
}

function processQueueSoon(){
  if (processingQueue) return;
  processingQueue = true;
  setTimeout(processPendingQueue, 60);
}

function processPendingQueue(){
  let delay = 0;
  const staggerStep = 200 + Math.random() * 150;
  while (pendingQueue.length) {
    const { id, src } = pendingQueue.shift();
    const normSrc = normalizeSrc(src);
    delay += staggerStep;
    // ✅ Correct: pass the id as sourceId (second arg)
    setTimeout(() => spawnTrinket(normSrc, id), delay);
  }
  processingQueue = false;
}

////////////////////////////
// Replay de-dupe guard   //
////////////////////////////

// De-dupe rapid-fire "replay" events (e.g., BC + localStorage arriving together)
const recentReplays = new Map(); // key -> lastTs

function shouldAcceptReplay(key, windowMs = 1200) {
  const now = Date.now();
  const last = recentReplays.get(key) || 0;
  if (now - last < windowMs) return false; // too soon → duplicate
  recentReplays.set(key, now);
  // prune old entries
  if (recentReplays.size > 500) {
    for (const [k, ts] of recentReplays) {
      if (now - ts > windowMs * 10) recentReplays.delete(k);
    }
  }
  return true;
}

/////////////////
// Polling     //
/////////////////

async function syncTrinkets(){
  if (!LIST_URL) return;

  const url = LIST_URL + (LIST_URL.includes('?') ? '&' : '?') + `_ts=${Date.now()}`;
  const raw = await fetchJSON(url);
  const rows = normalizeListShape(raw);

  if (!Array.isArray(rows)) {
    DEBUG && console.warn("[street] LIST_URL returned non-list shape. Set window.TRINKETS_API to a JSON list endpoint.");
    return;
  }

  if (DEBUG) { console.groupCollapsed("[street] LIST poll:", url); console.table(rows); console.groupEnd(); }

  for (const row of rows) {
    const key = deriveKeyFromRow(row);
    if (!key) continue;
    if (displayedTrinketIds.has(key) || pendingTrinketIds.has(key) || seenTrinketIds.has(key)) continue;

    const src  = getRowSrc(row);
    if (!src) continue;

    enqueueTrinket(key, getRowName(row) || "", src);
  }

  // prune if the admin/feed removed a trinket that is currently on-screen
  const currentIds = new Set(rows.map(deriveKeyFromRow).filter(Boolean));
  await pruneDeletedTrinkets(currentIds);
  seenTrinketIds = new Set(currentIds);
}

async function pruneDeletedTrinkets(currentIds){
  const toRemove = [];
  for (const [wid, rec] of walkers.entries()) {
    if (rec.type === 'trinket' && rec.sourceId) {
      if (!currentIds.has(String(rec.sourceId))) {
        toRemove.push(wid);
      }
    }
  }
  if (toRemove.length && DEBUG) console.log('[street] pruning deleted trinkets:', toRemove);

  for (const wid of toRemove) {
    await removeWalker(wid, 200);
  }
}

//////////////////////////////////////////////
// Admin command intake + localStorage fb   //
//////////////////////////////////////////////

function handleReplayTrinket(payload){
  if (!payload || !payload.trinket) return;
  const { id, src } = payload.trinket;
  const key = (id != null) ? String(id) : (src ? "s_" + hashStr(src) : null);
  if (!key) return;

  // prevent double-spawn if two messages arrive within ~1.2s
  if (!shouldAcceptReplay(key, 1200)) {
    if (DEBUG) console.log('[street] ignored duplicate replay for', key);
    return;
  }
  // force enqueue so a previously shown item can be replayed
  enqueueTrinket(key, "", src, /*force*/ true);
}

try {
  const adminBC = new BroadcastChannel('admin-legs');
  adminBC.onmessage = async (ev) => {
    const msg = ev.data || {};
    if (DEBUG) console.log('[street] BC received:', msg);
    if (msg.type === 'spawn_leg') {
      // No cap — if you use this, it will add an "empty" walker (manual only)
      spawnWalker(null, {});
    } else if (msg.type === 'clear_legs') {
      const ids = Array.from(walkers.keys());
      for (const id of ids) await removeWalker(id, 150);
    } else if (msg.type === 'replay_trinket') {
      handleReplayTrinket(msg);
    } else if (msg.type === 'delete_trinket') {
      // immediate removal on explicit admin delete command
      const delId = String(msg.id ?? '');
      if (delId) {
        const toRemove = [];
        for (const [wid, rec] of walkers.entries()) {
          if (rec.type === 'trinket' && String(rec.sourceId) === delId) {
            toRemove.push(wid);
          }
        }
        (async () => {
          for (const wid of toRemove) await removeWalker(wid, 160);
        })();
        displayedTrinketIds.delete(delId);
        pendingTrinketIds.delete(delId);
      }
    }
  };
  DEBUG && console.log("[street] admin BroadcastChannel ready");
} catch {
  DEBUG && console.warn("[street] BroadcastChannel not supported");
}

// localStorage fallback for admin commands
let processedCmdIds = new Set();

function pullLocalQueue() {
  try {
    const raw = localStorage.getItem('adminCmdQueue');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function processLocalQueue() {
  const cmds = pullLocalQueue();
  for (const cmd of cmds) {
    if (!cmd || !cmd._id || processedCmdIds.has(cmd._id)) continue;
    processedCmdIds.add(cmd._id);
    if (DEBUG) console.log('[street] localQueue received:', cmd);

    if (cmd.type === 'spawn_leg') {
      spawnWalker(null, {});
    } else if (cmd.type === 'clear_legs') {
      (async () => {
        const ids = Array.from(walkers.keys());
        for (const id of ids) await removeWalker(id, 150);
      })();
    } else if (cmd.type === 'replay_trinket') {
      handleReplayTrinket(cmd);
    } else if (cmd.type === 'delete_trinket') {
      const delId = String(cmd.id ?? '');
      if (delId) {
        const toRemove = [];
        for (const [wid, rec] of walkers.entries()) {
          if (rec.type === 'trinket' && String(rec.sourceId) === delId) {
            toRemove.push(wid);
          }
        }
        (async () => {
          for (const wid of toRemove) await removeWalker(wid, 160);
        })();
        displayedTrinketIds.delete(delId);
        pendingTrinketIds.delete(delId);
      }
    }
  }
  if (processedCmdIds.size > 2000) {
    processedCmdIds = new Set(Array.from(processedCmdIds).slice(-1000));
  }
}
window.addEventListener('storage', (e) => {
  if (e.key === 'adminCmdQueue') processLocalQueue();
});
setInterval(processLocalQueue, 1000);

//////////
// Boot //
//////////

(async function start(){
  await measureBackground();

  LIST_URL = await resolveListUrl();
  if (!LIST_URL) {
    console.error("[street] No working LIST_URL found. Set window.TRINKETS_API in street.html to the correct endpoint.");
  } else {
    DEBUG && console.log("[street] LIST_URL ready:", LIST_URL);
    await syncTrinkets();
    setInterval(syncTrinkets, POLL_MS);
  }

  processQueueSoon();
  DEBUG && console.log("[street] ready; unlimited walkers, no defaults, no name bubbles; polling every", POLL_MS, "ms");
})();
