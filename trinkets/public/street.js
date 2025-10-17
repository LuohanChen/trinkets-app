/* ===================== DOUBLE-BOOT GUARD ===================== */
if (window.__streetBooted) {
  console.warn('[street] script already initialized – skipping second init');
  throw new Error('street.js already booted');
}
window.__streetBooted = true;

/* ============================================================= */
/* Street: keep exactly TARGET_LEGS walkers on screen.
   - Base "empty" legs that NEVER auto-fade (bounce within scene).
   - On new trinket: replace an empty (or oldest) with a trinket walker.
   - TRINKET: enters from one edge, walks straight across, exits opposite edge, despawns off-screen.
   - Name popup shows 10s with pop-in, positioned via DOM rects.
   - Admin controls: spawn_leg, clear_legs, replay.
   - Prune active trinkets if admin deleted them.
   - Background containment.
   - Endpoint auto-discovery (or override with window.TRINKETS_API).
   - Unified size & baseline across resolutions.
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
const POLL_MS = 10000;
const TARGET_LEGS = 2;

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

//////////////////////
// Popup behaviour  //
//////////////////////

const BUBBLE_LIFETIME_MS = 10000;
const BUBBLE_SHIFT = { x: 14, y: 18 };

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

// --- super-stable key: prefer id; else hash of SRC ONLY (no created_at) ---
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

/////////////////////////////////////////
// Popup builder (follows the walker)  //
/////////////////////////////////////////

function makeNameBubble(text){
  if (!text || !String(text).trim()) return null;

  const outer = document.createElement('div');
  Object.assign(outer.style, {
    position:'absolute', left:'0px', top:'0px',
    transform:'translate(-9999px,-9999px)',
    pointerEvents:'none', zIndex:'999999'
  });

  const inner = document.createElement('div');
  inner.textContent = String(text).trim();
  Object.assign(inner.style, {
    background:'#ffffff', color:'#000000',
    padding:'6px 10px', borderRadius:'10px',
    fontFamily:'inherit', fontSize:'14px', lineHeight:'1.25',
    whiteSpace:'nowrap', boxShadow:'0 4px 12px rgba(0,0,0,0.25)',
    opacity:'0', transform:'scale(0.82)',
    transition:'opacity 260ms ease-out, transform 260ms cubic-bezier(.2,.9,.25,1.2)'
  });

  outer.appendChild(inner);
  outer._inner = inner;
  outer._popIn = () => { requestAnimationFrame(()=>{ inner.style.opacity='1'; inner.style.transform='scale(1)'; }); };
  outer._popOut = (ms=220) => new Promise(res=>{
    inner.style.transition = `opacity ${ms}ms ease-in, transform ${ms}ms ease-in`;
    inner.style.opacity='0'; inner.style.transform='scale(0.9)';
    setTimeout(res, ms+20);
  });

  return outer;
}

////////////////////////////
// Walker registry/maps   //
////////////////////////////

const walkers = new Map(); // id -> { el, type, sourceId, bornAt, refs:{}, motion:{} }
const emptyIds = new Set();
const trinketIds = new Set();

function genId(){ return `w_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
function getWalkerCount(){ return walkers.size; }
function getEmptyCount(){ return emptyIds.size; }

function oldestWalkerId(preferType=null){
  let bestId = null, bestAge = Infinity;
  for (const [id, rec] of walkers.entries()) {
    if (preferType && rec.type !== preferType) continue;
    if (rec.bornAt < bestAge) { bestAge = rec.bornAt; bestId = id; }
  }
  if (!bestId && preferType) {
    for (const [id, rec] of walkers.entries()) {
      if (rec.bornAt < bestAge) { bestAge = rec.bornAt; bestId = id; }
    }
  }
  return bestId;
}

async function removeWalker(id, fadeMs=300){
  const rec = walkers.get(id);
  if (!rec) return;
  if (rec.refs?.bubble && rec.refs.bubble.parentNode) rec.refs.bubble.remove();
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
  const { name, sourceId = null } = meta;
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

  // Popup for NEW trinkets only (10s)
  let bubble = null, bubbleKillTimer = null;
  if (type === "trinket") {
    const cleanName = (name || "").trim();
    if (cleanName) {
      bubble = makeNameBubble(cleanName);
      if (bubble) {
        layer.appendChild(bubble);
        bubble._popIn();
        bubbleKillTimer = setTimeout(async () => {
          await bubble._popOut(200);
          bubble.remove();
        }, BUBBLE_LIFETIME_MS);
      }
    }
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

  const rec = { el, type, sourceId, bornAt: performance.now(), refs: { leg, tr, bubble }, motion };
  walkers.set(wid, rec);
  if (type === "empty") emptyIds.add(wid); else trinketIds.add(wid);

  let last = performance.now();
  function step(t){
    const now = t || performance.now();
    const dt  = Math.min(0.05, (now - last)/1000);
    last = now;

    const { leg, tr, bubble } = rec.refs;

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

      if (bubble) {
        const anchorEl = tr || leg;
        const aRect = anchorEl.getBoundingClientRect();
        const lRect = layer.getBoundingClientRect();
        const anchorX = aRect.left + aRect.width / 2;
        const anchorY = aRect.top;
        const side = motion.vx < 0 ? -1 : 1;
        const bx = (anchorX - lRect.left) + side * BUBBLE_SHIFT.x;
        const by = (anchorY - lRect.top) - BUBBLE_SHIFT.y;
        bubble.style.transform = `translate(${Math.round(bx)}px, ${Math.round(by)}px)`;
      }

      if (motion.vx > 0 && motion.x > bgRect.width + DESPAWN_MARGIN) { cleanupTrinket(); return; }
      if (motion.vx < 0 && motion.x < -motion.size - DESPAWN_MARGIN) { cleanupTrinket(); return; }

    } else {
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

      if (bubble) {
        const anchorEl = tr || leg;
        const aRect = anchorEl.getBoundingClientRect();
        const lRect = layer.getBoundingClientRect();
        const anchorX = aRect.left + aRect.width / 2;
        const anchorY = aRect.top;
        const side = motion.vx < 0 ? -1 : 1;
        const bx = (anchorX - lRect.left) + side * BUBBLE_SHIFT.x;
        const by = (anchorY - lRect.top) - BUBBLE_SHIFT.y;
        bubble.style.transform = `translate(${Math.round(bx)}px, ${Math.round(by)}px)`;
      }
    }

    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  async function cleanupTrinket(){
    if (bubbleKillTimer) { clearTimeout(bubbleKillTimer); }
    if (rec.refs.bubble && rec.refs.bubble.parentNode) {
      try { await rec.refs.bubble._popOut(160); } catch {}
      rec.refs.bubble.remove();
    }
    await fadeOutEl(rec.el, 300);
    if (!walkers.has(wid)) return;
    walkers.delete(wid);
    emptyIds.delete(wid);
    trinketIds.delete(wid);
    el.remove();
    ensurePopulation();
  }

  return wid;
}

//////////////////////////////
// Population management    //
//////////////////////////////

function ensurePopulation() {
  while (getWalkerCount() < TARGET_LEGS) {
    spawnWalker(null, { name: "" });
  }
  while (getWalkerCount() > TARGET_LEGS) {
    const victim = oldestWalkerId('empty') || oldestWalkerId(null);
    if (!victim) break;
    removeWalker(victim, 200);
  }
}

/////////////////////////////////////////
// Replace a walker with a trinket one //
/////////////////////////////////////////

async function replaceWithTrinket(trinketSrc, name, sourceId) {
  let victim = null;
  if (getEmptyCount() > 0) {
    victim = oldestWalkerId('empty');
  }
  if (!victim) {
    victim = oldestWalkerId(null);
  }
  if (victim) {
    await removeWalker(victim, 150);
  }
  spawnWalker(trinketSrc, { name, sourceId });

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

// De-dupe sets
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
    const { id, name, src } = pendingQueue.shift();
    const normSrc = normalizeSrc(src);
    delay += staggerStep;
    setTimeout(() => replaceWithTrinket(normSrc, (name||"").trim(), id), delay);
  }
  processingQueue = false;
}

/////////////////
// Polling     //
/////////////////

async function syncTrinkets(){
  if (!LIST_URL) return;

  const raw = await fetchJSON(LIST_URL);
  const rows = normalizeListShape(raw);

  if (!Array.isArray(rows)) {
    DEBUG && console.warn("[street] LIST_URL returned non-list shape. Set window.TRINKETS_API to a JSON list endpoint.");
    return;
  }

  if (DEBUG) { console.groupCollapsed("[street] LIST poll:", LIST_URL); console.table(rows); console.groupEnd(); }

  // Enqueue any new items using stable key
  for (const row of rows) {
    const key = deriveKeyFromRow(row);
    if (!key) continue;

    // NEW: skip if already pending or displayed (extra belt & suspenders)
    if (displayedTrinketIds.has(key) || pendingTrinketIds.has(key) || seenTrinketIds.has(key)) {
      continue;
    }

    const src = getRowSrc(row);
    if (!src) continue;

    const name = (getRowName(row) || "").trim();
    enqueueTrinket(key, name, src);
  }

  // Build currentIds with same key logic
  const currentIds = new Set(rows.map(deriveKeyFromRow).filter(Boolean));

  // Prune active trinkets deleted in admin
  await pruneDeletedTrinkets(currentIds);

  // Update seen to match server
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
  ensurePopulation();
}

//////////////////////////////////////////////
// Admin command intake + localStorage fb   //
//////////////////////////////////////////////

function handleReplayTrinket(payload){
  if (!payload || !payload.trinket) return;
  const { id, name, src } = payload.trinket;
  enqueueTrinket(id, name, src, /*force*/ true);
}

try {
  const adminBC = new BroadcastChannel('admin-legs');
  adminBC.onmessage = async (ev) => {
    const msg = ev.data || {};
    if (DEBUG) console.log('[street] BC received:', msg);
    if (msg.type === 'spawn_leg') {
      if (getWalkerCount() < TARGET_LEGS) {
        spawnWalker(null, { name: "" });
      } else {
        DEBUG && console.log('[street] at capacity; ignoring spawn_leg');
      }
    } else if (msg.type === 'clear_legs') {
      const ids = Array.from(walkers.keys());
      for (const id of ids) await removeWalker(id, 150);
      ensurePopulation();
    } else if (msg.type === 'replay_trinket') {
      handleReplayTrinket(msg);
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
      if (getWalkerCount() < TARGET_LEGS) { spawnWalker(null, { name: "" }); }
    } else if (cmd.type === 'clear_legs') {
      (async () => {
        const ids = Array.from(walkers.keys());
        for (const id of ids) await removeWalker(id, 150);
        ensurePopulation();
      })();
    } else if (cmd.type === 'replay_trinket') {
      handleReplayTrinket(cmd);
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
  ensurePopulation();

  LIST_URL = await resolveListUrl();
  if (!LIST_URL) {
    console.error("[street] No working LIST_URL found. Set window.TRINKETS_API in street.html to the correct endpoint.");
  } else {
    DEBUG && console.log("[street] LIST_URL ready:", LIST_URL);
    await syncTrinkets();
    setInterval(syncTrinkets, POLL_MS);
  }

  processQueueSoon();
  DEBUG && console.log("[street] ready; target legs:", TARGET_LEGS, "polling every", POLL_MS, "ms");
})();
