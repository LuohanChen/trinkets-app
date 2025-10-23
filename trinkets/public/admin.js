const API = window.location.origin;
const gallery = document.getElementById('gallery');
const statusEl = document.getElementById('status');
const tpl = document.getElementById('card-tpl');
const clearAllBtn = document.getElementById('clearAll');

function setStatus(msg, isError=false){
  statusEl.textContent = msg || '';
  statusEl.style.color = isError ? '#c0392b' : '#111';
}

/* ---- Live command channel to street (kept) ---- */
let adminBC = null;
try { adminBC = new BroadcastChannel('admin-legs'); } catch {}
function sendAdminCommand(cmd){
  if (adminBC) {
    try { adminBC.postMessage(cmd); } catch {}
  }
  // localStorage fallback
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
   Robust DELETE helper (unchanged behavior)
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
   Live list model: in-page map of rendered cards
   ========================================================= */
const cardsById = new Map(); // id -> { el, data }

/* Normalize helpers (defensive) */
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

  // Replay button (kept)
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

  // Delete button
  del.addEventListener('click', async () => {
    if (!confirm('Delete this submission?')) return;
    del.disabled = true; replayBtn.disabled = true;
    setStatus('Deleting…');
    try {
      const ok = await deleteTrinketById(id);
      if (!ok) throw new Error('Delete endpoint not available.');
      // remove from DOM + map immediately
      cardsById.get(String(id))?.el?.remove();
      cardsById.delete(String(id));
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

    // newest first if backend returns newest-last
    const sorted = items.slice().reverse();
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

/* Fetch and only add NEW items (no full refresh) */
async function refreshIncremental(){
  try {
    const items = await fetchList();
    // The “new” set vs what we already have
    // Add in reverse order so that the oldest of the new batch is inserted first,
    // keeping visual order newest on top with each prepend.
    const toAdd = [];
    for (const t of items) {
      const id = String(getId(t) ?? '');
      if (!id) continue;
      if (!cardsById.has(id)) toAdd.push(t);
    }
    if (!toAdd.length) return;

    // If backend returns oldest->newest, we want to insert oldest-of-new first
    // If it returns newest->oldest, you can flip this order; this general approach is safe.
    for (const t of toAdd.reverse()) {
      const src = getShot(t);
      if (!src) continue;
      prependCard(t);
    }

    setStatus(`+${toAdd.length} new submission${toAdd.length===1?'':'s'}`);
    setTimeout(()=>setStatus(''), 1200);
  } catch (e) {
    console.error(e);
    // don't spam errors on background polling
  }
}

/* Optional: also reconcile removals made elsewhere (another admin tab) */
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
    // quick bounce refresh on a local submit event
    refreshIncremental();
  };
} catch {}

/* =========================================================
   Clear all (best effort)
   ========================================================= */
clearAllBtn?.addEventListener('click', async () => {
  if (!confirm('Delete ALL submissions? This cannot be undone.')) return;
  try {
    // Try collection DELETE first
    let ok = await tryDelete(`${API}/api/trinkets`, { method: 'DELETE' });

    // Fallback: delete each item currently visible
    if (!ok) {
      const ids = Array.from(cardsById.keys());
      for (const id of ids) {
        await deleteTrinketById(id);
      }
      ok = true;
    }

    // Clear UI + model
    gallery.innerHTML = '';
    cardsById.clear();

    if (!ok) throw new Error('Bulk delete endpoints not available.');
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
  // Optional: occasionally reconcile removals made in other tabs/sessions
  setInterval(reconcileRemovals, 20000);
})();
