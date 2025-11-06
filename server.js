const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const mysql = require('mysql2/promise');
const Database = require('better-sqlite3');
const UAParser = require('ua-parser-js');
const isbot = require('isbot');
const fetch = require('node-fetch');

require('dotenv').config();

const app = express();
app.use(express.json());

// Static directories
const staticDir = path.join(__dirname, 'static');
if (!fs.existsSync(staticDir)) fs.mkdirSync(staticDir);
app.use('/static', express.static(staticDir));

// Uploads dir
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
app.use('/uploads', express.static(uploadsDir));

// Basic Content Security Policy to allow required resources and quiet devtools warning
app.use((req, res, next) => {
  // Allow self, Unpkg (Leaflet), and OSM tiles; allow inline scripts/styles for simple pages
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: https://*.tile.openstreetmap.org",
    "connect-src 'self' https://unpkg.com https://*.tile.openstreetmap.org",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  next();
});

// Database setup - supports both MySQL and SQLite
let dbType = process.env.DB_TYPE || 'mysql';
let mysqlPool = null;
let sqliteDb = null;

// Initialize SQLite (for local testing)
function initSQLite() {
  const dbPath = path.join(__dirname, 'receipt.db');
  const db = new Database(dbPath);
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT,
      image_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_slug TEXT NOT NULL,
      occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      type TEXT NOT NULL,
      ip TEXT,
      ip_asn TEXT,
      country TEXT,
      region TEXT,
      city TEXT,
      ua TEXT,
      device_family TEXT,
      os_family TEXT,
      browser_family TEXT,
      referer TEXT,
      is_bot INTEGER NOT NULL DEFAULT 0,
      latitude REAL,
      longitude REAL,
      accuracy_m REAL,
      accuracy_source TEXT,
      accuracy_radius_m REAL,
      payload TEXT,
      FOREIGN KEY (link_slug) REFERENCES links(slug) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_events_link_slug ON events(link_slug);
    CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events(occurred_at);
  `);
  
  console.log('✅ SQLite database initialized at', dbPath);
  return db;
}

// Initialize MySQL
async function initMySQL() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT ? Number(process.env.MYSQL_PORT) : 3306,
    user: process.env.MYSQL_USER || 'receipt_user',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'receipt_db',
    connectionLimit: 10,
    timezone: 'Z',
    waitForConnections: true,
    connectTimeout: 10000
  });
  
  try {
    await pool.execute('SELECT 1');
    console.log('✅ MySQL connected');
    return pool;
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    return null;
  }
}

// Auto-detect database type
async function initDatabase() {
  if (process.env.DB_TYPE === 'sqlite') {
    dbType = 'sqlite';
    sqliteDb = initSQLite();
    return;
  }
  
  // Try MySQL first
  mysqlPool = await initMySQL();
  if (mysqlPool) {
    dbType = 'mysql';
    return;
  }
  
  // Fallback to SQLite if MySQL unavailable
  console.log('⚠️  Falling back to SQLite for local testing');
  dbType = 'sqlite';
  sqliteDb = initSQLite();
}

initDatabase();

// Database helper functions (abstraction for MySQL and SQLite)
async function dbQuery(sql, params = []) {
  if (dbType === 'sqlite' && sqliteDb) {
    const stmt = sqliteDb.prepare(sql);
    return stmt.all(params);
  } else if (dbType === 'mysql' && mysqlPool) {
    const [rows] = await mysqlPool.execute(sql, params);
    return rows;
  }
  throw new Error('Database not initialized');
}

async function dbExecute(sql, params = []) {
  if (dbType === 'sqlite' && sqliteDb) {
    const stmt = sqliteDb.prepare(sql);
    return stmt.run(params);
  } else if (dbType === 'mysql' && mysqlPool) {
    return await mysqlPool.execute(sql, params);
  }
  throw new Error('Database not initialized');
}

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, crypto.randomBytes(8).toString('hex') + ext);
  }
});
const upload = multer({ storage });

function clientIP(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) || req.socket.remoteAddress || '';
}

async function geoFromIP(ip) {
  try {
    if (!ip || ip === '::1' || ip.startsWith('::ffff:127.')) return null;
    const token = process.env.IPINFO_TOKEN;
    const base = `https://ipinfo.io/${encodeURIComponent(ip)}`;
    const url = token ? `${base}?token=${token}` : base;
    const r = await fetch(url, { timeout: 3000 });
    if (!r.ok) return null;
    const j = await r.json();
    const [lat, lon] = (j.loc || '').split(',').map(Number);
    return {
      ip: j.ip || ip,
      city: j.city || null,
      region: j.region || null,
      country: j.country || null,
      asn: j.org || null,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      // Approximate accuracy radius for IP-based location (varies widely)
      accuracyRadiusM: 25000
    };
  } catch {
    return null;
  }
}

async function logEvent(link_slug, type, req, extra = {}) {
  try {
    const ip = clientIP(req);
    const ref = req.headers['referer'] || null;
    const uaStr = req.headers['user-agent'] || '';
    const parser = new UAParser(uaStr);
    const uap = parser.getResult();
    const bot = isbot(uaStr);
    const ipg = await geoFromIP(ip);

    const latitude = (extra.latitude != null) ? extra.latitude : (ipg?.lat ?? null);
    const longitude = (extra.longitude != null) ? extra.longitude : (ipg?.lon ?? null);
    const accuracy_m = (extra.accuracy != null) ? extra.accuracy : null;
    const accuracy_source = (extra.latitude != null) ? 'browser' : (ipg ? 'ip' : null);
    const accuracy_radius_m = (extra.accuracy != null) ? extra.accuracy : (ipg?.accuracyRadiusM ?? null);

    const payload = Object.keys(extra).length ? JSON.stringify(extra) : null;

    const sql = `INSERT INTO events
      (link_slug, type, ip, ip_asn, country, region, city, ua, device_family, os_family, browser_family,
       referer, is_bot, latitude, longitude, accuracy_m, accuracy_source, accuracy_radius_m, payload)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const params = [
      link_slug, type, ip || null, ipg?.asn || null,
      ipg?.country || null, ipg?.region || null, ipg?.city || null,
      uaStr || null,
      uap.device?.model || uap.device?.type || null,
      uap.os?.name || null,
      uap.browser?.name || null,
      ref, bot ? 1 : 0,
      latitude, longitude, accuracy_m, accuracy_source, accuracy_radius_m, payload
    ];
    await dbExecute(sql, params);
  } catch (err) {
    console.error('Failed to log event:', err.message);
    // Don't throw - just log the error so the server doesn't crash
  }
}

// Create new tracking link
app.post('/api/links', async (req, res) => {
  try {
    const slug = crypto.randomBytes(6).toString('base64url');
    const title = (req.body && req.body.title) || null;
    await dbExecute('INSERT INTO links (slug, title) VALUES (?,?)', [slug, title]);
    res.json({ slug, url: `${req.protocol}://${req.get('host')}/${slug}` });
  } catch (err) {
    console.error('Failed to create link:', err.message);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// Upload image and attach to link
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const slug = req.body.slug;
    if (!slug || !req.file) return res.status(400).json({ error: 'slug and image required' });
    const p = `/uploads/${req.file.filename}`;
    await dbExecute('UPDATE links SET image_path=? WHERE slug=?', [p, slug]);
    res.json({ ok: true, image: p });
  } catch (err) {
    console.error('Failed to upload image:', err.message);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// Viewer page: show image and ask for location consent
app.get('/:slug', async (req, res) => {
  try {
    const slug = req.params.slug;
    const rows = await dbQuery('SELECT slug, title, image_path FROM links WHERE slug=?', [slug]);
    if (!rows.length) return res.status(404).send('Not found');

    // Log initial view (captures IP, UA, referrer, IP-based location)
    await logEvent(slug, 'view', req);

  const imgSrc = rows[0].image_path ? rows[0].image_path : '/static/placeholder.svg';
  const title = rows[0].title || 'Receipt Viewer';
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
body { font-family: system-ui, Arial; margin: 1rem; }
.card { max-width: 760px; margin: 0 auto; padding: 1rem; border:1px solid #ddd; border-radius:8px; }
.actions { display:flex; gap:.75rem; margin-top:.75rem; }
.muted { color:#666; font-size:.9rem; }
img.receipt { max-width:100%; border:1px solid #eee; border-radius:6px; }
.map { height: 280px; margin-top: 1rem; display:none; }
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
</head>
<body>
<div class="card">
  <h1>${title}</h1>
  <p class="muted">For security, we ask permission to collect your location. You may decline.</p>
  <img class="receipt" src="${imgSrc}" alt="Receipt" />
  <div class="actions">
    <button id="shareBtn">Share Location</button>
    <button id="declineBtn">Decline</button>
  </div>
  <p id="status" class="muted"></p>
  <div id="map" class="map"></div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const slug = ${JSON.stringify(slug)};
const statusEl = document.getElementById('status');
const mapEl = document.getElementById('map');
let map, marker;

function post(path, body) {
  return fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ slug, ...body }) });
}

async function sendDevice() {
  try {
    await post('/api/collect/device', {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      vendor: navigator.vendor || null
    });
  } catch {}
}

function showMap(lat, lon) {
  if (!map) {
    map = L.map('map').setView([lat, lon], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    marker = L.marker([lat, lon]).addTo(map);
    mapEl.style.display = 'block';
  } else {
    marker.setLatLng([lat, lon]);
    map.setView([lat, lon], 15);
  }
}

async function shareLocation() {
  statusEl.textContent = 'Requesting location permission...';
  if (!('geolocation' in navigator)) {
    statusEl.textContent = 'Geolocation not supported.';
    await sendDevice();
    return;
  }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude, accuracy } = pos.coords;
    await post('/api/collect/location', {
      latitude, longitude, accuracy, accuracySource: 'gps_or_wifi'
    });
    statusEl.textContent = 'Location shared.';
    showMap(latitude, longitude);
  }, async (err) => {
    statusEl.textContent = 'Location denied or unavailable.';
    await sendDevice();
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

document.getElementById('shareBtn').addEventListener('click', shareLocation);
document.getElementById('declineBtn').addEventListener('click', async () => {
  statusEl.textContent = 'You declined. Only basic visit info will be recorded.';
  await sendDevice();
});

sendDevice().catch(()=>{});
</script>
</body>
</html>`);
  } catch (err) {
    console.error('Failed to load viewer:', err.message);
    res.status(500).send('Database error: ' + err.message);
  }
});

// Collectors
app.post('/api/collect/device', async (req, res) => {
  await logEvent(req.body.slug, 'device', req, { deviceMeta: req.body });
  res.sendStatus(204);
});

app.post('/api/collect/location', async (req, res) => {
  const lat = typeof req.body.latitude === 'number' ? req.body.latitude : null;
  const lon = typeof req.body.longitude === 'number' ? req.body.longitude : null;
  const acc = typeof req.body.accuracy === 'number' ? req.body.accuracy : null;
  const src = req.body.accuracySource || 'browser';
  await logEvent(req.body.slug, 'location', req, {
    latitude: lat, longitude: lon, accuracy: acc, accuracySource: src, accuracyRadiusM: acc
  });
  res.sendStatus(204);
});

// Admin UI
app.get('/admin', (req, res) => {
  res.type('html').send(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Admin</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
body { font-family: system-ui, Arial; margin: 1rem; }
.container { max-width: 960px; margin: 0 auto; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { border-bottom: 1px solid #eee; padding: .5rem; text-align: left; }
.map { height: 320px; }
.hidden { display:none; }
</style>
</head>
<body>
<div class="container">
  <h1>Admin</h1>
  <div class="grid">
    <div class="card">
      <h3>Create Link</h3>
      <input id="title" placeholder="Optional title" />
      <button id="newLink">Generate Link</button>
      <p id="linkOut"></p>
      <form id="uploadForm" class="hidden">
        <h4>Upload Image</h4>
        <input type="file" id="image" accept="image/png,image/jpeg" />
        <button type="submit">Upload</button>
        <p id="imgStatus"></p>
      </form>
    </div>
    <div class="card">
      <h3>Events</h3>
      <input id="slugIn" placeholder="slug" />
      <button id="loadEvents">Load</button>
      <div id="counts"></div>
      <div id="map" class="map"></div>
      <table>
        <thead><tr>
          <th>Time</th><th>IP</th><th>Provider</th><th>Country</th><th>Device</th><th>Type</th><th>Bot</th><th>Ref</th><th>Lat</th><th>Lon</th><th>Acc(m)</th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
let currentSlug = null;
let map, markers = [];

document.getElementById('newLink').onclick = async () => {
  const r = await fetch('/api/links', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ title: document.getElementById('title').value || null }) });
  const j = await r.json();
  currentSlug = j.slug;
  document.getElementById('linkOut').innerHTML = 'Slug: <b>' + j.slug + '</b><br>Share this URL: <a href="' + j.url + '" target="_blank">' + j.url + '</a>';
  const f = document.getElementById('uploadForm');
  f.classList.remove('hidden');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('slug', currentSlug);
    const file = document.getElementById('image').files[0];
    if (!file) return;
    fd.append('image', file);
    const up = await fetch('/api/upload', { method: 'POST', body: fd });
    const uj = await up.json();
    document.getElementById('imgStatus').textContent = uj.ok ? 'Uploaded.' : (uj.error || 'Failed');
  };
};

document.getElementById('loadEvents').onclick = async () => {
  const slug = document.getElementById('slugIn').value.trim();
  if (!slug) return;
  currentSlug = slug;
  const r = await fetch('/api/events?slug=' + encodeURIComponent(slug));
  const j = await r.json();
  const tbody = document.getElementById('rows');
  tbody.innerHTML = '';
  j.rows.forEach(ev => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + new Date(ev.occurred_at).toLocaleString() + '</td>' +
      '<td>' + (ev.ip || '') + '</td>' +
      '<td>' + (ev.ip_asn || '') + '</td>' +
      '<td>' + (ev.country || '') + '</td>' +
      '<td>' + [ev.device_family, ev.os_family, ev.browser_family].filter(Boolean).join(' / ') + '</td>' +
      '<td>' + ev.type + '</td>' +
      '<td>' + (ev.is_bot ? 'yes' : 'no') + '</td>' +
      '<td>' + (ev.referer || '') + '</td>' +
      '<td>' + (ev.latitude ?? '') + '</td>' +
      '<td>' + (ev.longitude ?? '') + '</td>' +
      '<td>' + (ev.accuracy_m ?? '') + '</td>';
    tbody.appendChild(tr);
  });
  document.getElementById('counts').textContent = 'Total events: ' + j.rows.length;

  const mapEl = document.getElementById('map');
  if (!map) {
    map = L.map('map').setView([0,0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  }
  markers.forEach(m => m.remove());
  markers = [];
  const withLoc = j.rows.filter(r => r.latitude && r.longitude);
  if (withLoc.length) {
    const bounds = [];
    withLoc.forEach(rw => {
      const m = L.marker([rw.latitude, rw.longitude]).addTo(map).bindPopup(new Date(rw.occurred_at).toLocaleString());
      markers.push(m);
      bounds.push([rw.latitude, rw.longitude]);
    });
    map.fitBounds(bounds, { padding: [20,20] });
  }
};
</script>
</body>
</html>`);
});

// Events API
app.get('/api/events', async (req, res) => {
  try {
    const slug = req.query.slug;
    if (!slug) return res.status(400).json({ error: 'slug required' });
    const rows = await dbQuery(
      `SELECT occurred_at, type, ip, ip_asn, country, region, city, ua,
              device_family, os_family, browser_family, referer, is_bot,
              latitude, longitude, accuracy_m
       FROM events WHERE link_slug=? ORDER BY occurred_at DESC LIMIT 1000`, [slug]
    );
    res.json({ rows });
  } catch (err) {
    console.error('Failed to load events:', err.message);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Listening on :' + port));


