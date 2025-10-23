const API = window.location.origin;
const gallery = document.getElementById('gallery');
const statusEl = document.getElementById('status');
const tpl = document.getElementById('card-tpl');
const clearAllBtn = document.getElementById('clearAll');

function setStatus(msg, isError=false){
  statusEl.textContent = msg || '';
  statusEl.style.color = isError ? '#c0392b' : '#111';
}

/* ---- Live command channel to street (fixed: no double-send) ---- */
let adminBC = null;
try { adminBC = new BroadcastChannel('admin-legs'); } catch {}

function sendAdminCommand(cmd){
  // Prefer BroadcastChannel; if it succeeds, don't also write to localStorage.
  if (adminBC) {
    try {
      adminBC.postMessage(cmd);
      return; // prevent double-send
    } catch {
      // fall through to localStorage only if BC fails
    }
  }
  // Fallback only when BroadcastChannel isn't available or failed
  try {
    const key = 'adminCmdQueue';
    const now = Date.now();
    const entry = { ...cmd, _id: `cmd_${now}_${Math.random().toString(36).slice(2)}`, ts: now };
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    arr.push(entry);
    localStorage.setItem(key, JSON.stringify(arr));
  } catch {}
}

/* =========================================================
   Robust DELETE helper
   ========================================================= */
async function tryDelete(url, opts={}) {
  const res = await fetch(url + (url.includes('?')?'&':'?') + `_ts=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Accept': 'application/json' },
    ...opts
  });
  if (res.ok || res.status === 204) return true;
  return false;
}
async function deleteTrinketById(id) {
  const encId = encodeURIComponent(String(id));

  if (await tryDelete(`${API}/api/trinkets/${encId}`, { method: 'DELETE' })) return true;
  if (await tryDelete(`${API}/api/trinkets?id=${encId}`, { method: 'DELETE' })) return true;
  if (await tryDelete(`${API}/api/trinkets/${encId}/delete`, { method: 'POST' })) return true;
  if (await tryDelete(`${API}/api/trinkets/delete`, {
    method: 'POST',
    headers: { 'Accept':'application/json', 'Content-Type':'application/json' },
    body: JSON.stringify({ id })
  })) return true;
  if (await tryDelete(`${API}/api/trinkets/${encId}`, {
    method: 'PATCH',
    headers: { 'Accept':'application/json', 'Content-Type':'application/json' },
    body: JSON.stringify({ deleted: true })
  })) return true;

  return false;
}

/* =========================================================
   Live list model (auto-update without page refresh)
   ========================================================= */
const cardsById = new Map(); // id -> { el, data }

const getId    = t => t?.id ?? t?._id ?? t?.uuid ?? t?.guid ?? t?.pk ?? null;
const getName  = t => t?.name ?? t?.trinketName ?? 'Untitled';
const getStory = t => t?.story ?? t?.trinketText ?? '';
const getShot  = t => t?.image_path ?? t?.drawing ?? t?.image ?? t?.src ?? '';

function buildCardNode(item) {
  const id = getId(item);
  const node = tpl.content.cloneNode(true);
  const card = node.querySelector('.card');
  const img  = node.querySelector('.shot');
  const name = node.querySelector('.name');
  const story= node.querySelector('.story');
  const del  = node.querySelector('.deleteBtn');

  card.dataset.id = id;
  img.src = getShot(item);
  img.alt = `Trinket: ${getName(item)}`;
  name.textContent = getName(item);
  story.textContent = getStory(item);

  // Actions
  const actions = node.querySelector('.actions');

  // Replay (uses fixed sendAdminCommand to avoid duplicates)
  const replayBtn = document.createElement('button');
  replayBtn.textContent = 'Replay';
  replayBtn.addEventListener('click', () => {
    sendAdminCommand({
      type: 'replay_trinket',
      trinket: {
        id,
        name: getName(item) || '',
        src: getShot(item) || ''
      }
    });
    setStatus('Replay sent to street.');
    setTimeout(()=>setStatus(''), 1200);
  });
  actions.appendChild(replayBtn);

  // Delete
  del.addEventListener('click', async () => {
    if (!confirm('Delete this submission?')) return;
    del.disabled = true; replayBtn.disabled = true;
    setStatus('Deleting…');
    try {
      const ok = await deleteTrinketById(id);
      if (!ok) throw new Error('Delete endpoint not available.');
      // Remove from DOM + map immediately
      cardsById.get(String(id))?.el?.remove();
      cardsById.delete(String(id));
      // Optionally inform street to remove immediately (no duplicate risk)
      sendAdminCommand({ type: 'delete_trinket', id });
      setStatus('Deleted.');
      setTimeout(()=>setStatus(''), 1200);
    } catch (e) {
      console.error(e);
      setStatus('Failed to delete item. See console.', true);
      del.disabled = false; replayBtn.disabled = false;
    }
  });

  return card;
}

function prependCard(item){
  const id = String(getId(item));
  if (!id) return;
  const el = buildCardNode(item);
  gallery.insertBefore(el, gallery.firstChild);
  cardsById.set(id, { el, data: item });
}

/* =========================================================
   Initial load + incremental refresh
   ========================================================= */
async function fetchList() {
  const res = await fetch(`${API}/api/trinkets?_ts=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'Accept':'application/json' }
  });
  if (!res.ok) throw new Error(`GET /api/trinkets failed: ${res.status}`);
  const items = await res.json();
  return Array.isArray(items) ? items : [];
}

async function initialLoad(){
  try {
    setStatus('Loading…');
    const items = await fetchList();

    gallery.innerHTML = '';
    cardsById.clear();

    if (!items.length) {
      setStatus('No submissions yet.');
      return;
    }
    setStatus('');

    const sorted = items.slice().reverse(); // newest-first in UI
    for (const t of sorted) {
      const id = getId(t);
      const src = getShot(t);
      if (!id || !src) continue;
      prependCard(t);
    }
  } catch (e) {
    console.error(e);
    setStatus('Failed to load submissions.', true);
  }
}

/* Add only NEW items (no full refresh) */
async function refreshIncremental(){
  try {
    const items = await fetchList();
    const toAdd = [];
    for (const t of items) {
      const id = String(getId(t) ?? '');
      if (!id) continue;
      if (!cardsById.has(id)) toAdd.push(t);
    }
    if (!toAdd.length) return;

    for (const t of toAdd.reverse()) {
      const src = getShot(t);
      if (!src) continue;
      prependCard(t);
    }

    setStatus(`+${toAdd.length} new submission${toAdd.length===1?'':'s'}`);
    setTimeout(()=>setStatus(''), 1200);
  } catch (e) {
    console.error(e);
  }
}

/* Optional: reconcile removals made elsewhere */
async function reconcileRemovals(){
  try {
    const items = await fetchList();
    const liveIds = new Set(items.map(x => String(getId(x) ?? '')).filter(Boolean));
    for (const [id, rec] of cardsById.entries()) {
      if (!liveIds.has(id)) {
        rec.el.remove();
        cardsById.delete(id);
      }
    }
  } catch {}
}

/* =========================================================
   Auto-refresh loop (paused when tab hidden)
   ========================================================= */
let refreshTimer = null;
const REFRESH_MS = 5000;

function startAutoRefresh(){
  stopAutoRefresh();
  refreshTimer = setInterval(refreshIncremental, REFRESH_MS);
}
function stopAutoRefresh(){
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopAutoRefresh();
  else { refreshIncremental(); startAutoRefresh(); }
});

/* Also listen for a local “trinkets” broadcast from the drawing page (if any) */
try {
  const bc = new BroadcastChannel('trinkets');
  bc.onmessage = () => {
    refreshIncremental(); // instant refresh on local submit
  };
} catch {}

/* =========================================================
   Clear all (best effort)
   ========================================================= */
clearAllBtn?.addEventListener('click', async () => {
  if (!confirm('Delete ALL submissions? This cannot be undone.')) return;
  try {
    let ok = await tryDelete(`${API}/api/trinkets`, { method: 'DELETE' });
    if (!ok) {
      const ids = Array.from(cardsById.keys());
      for (const id of ids) {
        await deleteTrinketById(id);
      }
      ok = true;
    }
    gallery.innerHTML = '';
    cardsById.clear();

    setStatus('All submissions deleted.');
    setTimeout(() => setStatus(''), 1500);
  } catch (e) {
    console.error(e);
    setStatus('Failed to delete all submissions.', true);
  }
});

/* =========================================================
   Boot
   ========================================================= */
(async function boot(){
  await initialLoad();
  startAutoRefresh();
  setInterval(reconcileRemovals, 20000); // optional
})();
