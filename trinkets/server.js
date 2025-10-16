// server.js
// Express server for Trinkets: serves static site + JSON API + persistent uploads on Render.

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const cors = require('cors');

const app = express();

// ---------- Config ----------
const PORT = process.env.PORT || 5050;

// On Render, containers are ephemeral. We'll mount a persistent disk at /data via render.yaml.
const DATA_DIR    = process.env.DATA_DIR    || '/data';
const UPLOAD_DIR  = process.env.UPLOAD_DIR  || path.join(DATA_DIR, 'uploads');
const DB_FILE     = process.env.DB_FILE     || path.join(DATA_DIR, 'db.json');

// Ensure folders exist
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Allow big JSON posts (drawings)
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// If you will host front-end elsewhere, restrict CORS; same-origin is fine as-is.
app.use(cors());

// ---------- Tiny JSON "DB" ----------
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

// ---------- Helpers ----------
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
  return `/uploads/${name}`; // URL path we serve below
}

// ---------- API ----------
// We expose both /api/trinkets and /trinkets(.json) (your street.js can use either)

app.get(['/api/trinkets', '/trinkets', '/trinkets.json'], async (_req, res) => {
  const db = await loadDB();
  res.json(db.items); // plain array
});

app.post('/api/trinkets', async (req, res) => {
  try {
    const body = req.body || {};
    const name = (body.trinketName || body.name || '').toString();
    const story = (body.trinketText || body.text || '').toString();
    const drawing = body.drawing || body.image || '';

    if (!drawing.startsWith('data:image/')) {
      return res.status(400).json({ error: 'drawing must be a data:image/*;base64 URL' });
    }
    const buf = dataUrlToBuffer(drawing);
    if (!buf) return res.status(400).json({ error: 'Invalid data URL' });

    const image_path = await writePng(buf);

    const db = await loadDB();
    const id = db.seq++;
    const item = { id, name, story, image_path, created_at: new Date().toISOString() };
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

// ---------- Static files ----------
// Serve the uploaded images at /uploads/*
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

// Serve your front-end from /public
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  setHeaders: (res, filePath) => {
    if (/\.(html?)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// If you want SPA fallback, uncomment:
// app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, () => {
  console.log(`Trinkets server listening on :${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
