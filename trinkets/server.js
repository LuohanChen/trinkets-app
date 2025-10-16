// server.js — FREE setup using ephemeral storage at /tmp (no paid disk)

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5050;

/* ========= Storage (FREE) =========
   We use /tmp (writable on Render free). This is ephemeral:
   - files are lost on deploys
   - may be lost on container restarts
   For persistent storage without paying Render, use an external bucket (R2/Supabase) — see notes below.
*/
const DATA_DIR   = process.env.DATA_DIR || '/tmp/trinkets';
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE    = path.join(DATA_DIR, 'db.json');

// Ensure dirs exist (and are writable)
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cors());

// -------- Tiny JSON “DB” (also in /tmp) --------
async function loadDB() {
  try {
    const txt = await fsp.readFile(DB_FILE, 'utf8');
    return JSON.parse(txt);
  } catch {
    const init = { seq: 1, items: [] };
    await saveDB(init);
    return init;
  }
}
async function saveDB(db) {
  await fsp.writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// -------- Helpers --------
function dataUrlToBuffer(dataUrl) {
  const m = /^data:(.+?);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return Buffer.from(m[2], 'base64');
}
async function writePng(buffer) {
  const ts = Date.now();
  const name = `trinket_${ts}_${Math.random().toString(36).slice(2)}.png`;
  const abs = path.join(UPLOAD_DIR, name);
  await fsp.writeFile(abs, buffer);
  return `/uploads/${name}`; // we serve this path below
}

// -------- API --------
app.get(['/api/trinkets', '/trinkets', '/trinkets.json'], async (_req, res) => {
  const db = await loadDB();
  res.json(db.items);
});

app.post('/api/trinkets', async (req, res) => {
  try {
    const { trinketName, name, trinketText, text, drawing, image } = req.body || {};
    const finalName = (trinketName || name || '').toString();
    const finalText = (trinketText || text || '').toString();
    const dataUrl   = drawing || image || '';

    if (!dataUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'drawing must be a data:image/*;base64 URL' });
    }
    const buf = dataUrlToBuffer(dataUrl);
    if (!buf) return res.status(400).json({ error: 'invalid data URL' });

    const image_path = await writePng(buf);

    const db = await loadDB();
    const id = db.seq++;
    const item = { id, name: finalName, story: finalText, image_path, created_at: new Date().toISOString() };
    db.items.push(item);
    await saveDB(db);

    res.status(201).json(item);
  } catch (e) {
    console.error('[POST /api/trinkets] failed:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.delete('/api/trinkets/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const db = await loadDB();
    const idx = db.items.findIndex(x => Number(x.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'not_found' });

    const img = db.items[idx]?.image_path;
    if (img && img.startsWith('/uploads/')) {
      const abs = path.join(UPLOAD_DIR, path.basename(img));
      try { await fsp.unlink(abs); } catch {}
    }

    db.items.splice(idx, 1);
    await saveDB(db);
    res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /api/trinkets/:id] failed:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.delete('/api/trinkets', async (_req, res) => {
  try {
    const db = await loadDB();
    for (const it of db.items) {
      const img = it?.image_path;
      if (img && img.startsWith('/uploads/')) {
        const abs = path.join(UPLOAD_DIR, path.basename(img));
        try { await fsp.unlink(abs); } catch {}
      }
    }
    db.items = [];
    await saveDB(db);
    res.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /api/trinkets] failed:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// Serve uploaded images
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

// Serve front-end
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (/\.(html?)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html'))); // optional SPA fallback

app.listen(PORT, () => {
  console.log(`Trinkets server on :${PORT}`);
  console.log(`Ephemeral data dir: ${DATA_DIR}`);
});
