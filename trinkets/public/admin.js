const API = window.location.origin;
const gallery = document.getElementById('gallery');
const statusEl = document.getElementById('status');
const tpl = document.getElementById('card-tpl');
const clearAllBtn = document.getElementById('clearAll');

function setStatus(msg, isError=false){
  statusEl.textContent = msg || '';
  statusEl.style.color = isError ? '#c0392b' : '#111';
}

/* ---- Live command channel to street ---- */
let adminBC = null;
try { adminBC = new BroadcastChannel('admin-legs'); } catch {}
function sendAdminCommand(cmd){
  // BroadcastChannel (if available)
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

async function load() {
  try {
    setStatus('Loading…');
    const res = await fetch(`${API}/api/trinkets`);
    if (!res.ok) throw new Error(`GET /api/trinkets failed: ${res.status}`);
    const items = await res.json();

    gallery.innerHTML = '';
    if (!items.length) {
      setStatus('No submissions yet.');
      return;
    }
    setStatus('');

    for (const t of items) {
      // t fields from server: id, name, story, image_path, created_at
      const node = tpl.content.cloneNode(true);
      const img  = node.querySelector('.shot');
      const name = node.querySelector('.name');
      const story= node.querySelector('.story');
      const del  = node.querySelector('.deleteBtn');

      img.src = t.image_path || '';
      img.alt = `Trinket: ${t.name || 'Untitled'}`;
      name.textContent = t.name || 'Untitled';
      story.textContent = t.story || '';

      // Add a "Replay" button next to Delete
      const actions = node.querySelector('.actions');
      const replayBtn = document.createElement('button');
      replayBtn.textContent = 'Replay';
      replayBtn.addEventListener('click', () => {
        // Send a replay command with the essentials the street needs
        sendAdminCommand({
          type: 'replay_trinket',
          trinket: {
            id: t.id,
            name: t.name || '',
            src: t.image_path || t.drawing || ''
          }
        });
        setStatus('Replay sent to street.');
        setTimeout(()=>setStatus(''), 1200);
      });
      actions.appendChild(replayBtn);

      del.addEventListener('click', async () => {
        if (!confirm('Delete this submission?')) return;
        try {
          const res = await fetch(`${API}/api/trinkets/${t.id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
          await load();
          setStatus('Deleted.');
          setTimeout(() => setStatus(''), 1200);
        } catch (e) {
          console.error(e);
          setStatus('Failed to delete item.', true);
        }
      });

      gallery.appendChild(node);
    }
  } catch (e) {
    console.error(e);
    setStatus('Failed to load submissions.', true);
  }
}

clearAllBtn?.addEventListener('click', async () => {
  if (!confirm('Delete ALL submissions? This cannot be undone.')) return;
  try {
    const res = await fetch(`${API}/api/trinkets`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ALL failed: ${res.status}`);
    await load();
    setStatus('All submissions deleted.');
    setTimeout(() => setStatus(''), 1500);
  } catch (e) {
    console.error(e);
    setStatus('Failed to delete all submissions.', true);
  }
});

load();
