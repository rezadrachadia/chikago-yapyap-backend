/**
 * Chikago Community Hub — Backend
 * Express REST API + penyimpanan file JSON (fs/promises) + Nodemailer
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');

// ---------------------------------------------------------------
// Sederhana: baca file .env manual (tanpa dependensi dotenv)
// ---------------------------------------------------------------
(async () => {
  try {
    const raw = await fs.readFile(path.join(__dirname, '.env'), 'utf-8');
    raw.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    });
  } catch {
    /* file .env opsional */
  }
  startServer();
})();

// ---------------------------------------------------------------
// Konfigurasi
// ---------------------------------------------------------------
const PORT = process.env.PORT || 5000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'chikago123';
const DATA_DIR = path.join(__dirname, 'data');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const PODCASTS_FILE = path.join(DATA_DIR, 'podcasts.json');

// Folder upload gambar (diserve statis di /uploads/...)
const UPLOAD_ROOT = path.join(__dirname, 'public', 'uploads');
const ACTIVITIES_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'activities');
const MEMBERS_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'members');

// ---------------------------------------------------------------
// Helper file JSON
// ---------------------------------------------------------------
async function readJson(filePath, fallback = []) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeJson(filePath, fallback);
      return fallback;
    }
    throw err;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

// ---------------------------------------------------------------
// Multer — uploader file gambar (aktivitas & foto member)
// ---------------------------------------------------------------
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
]);

/** Buat uploader dengan folder tujuan sendiri (dibuat otomatis jika belum ada). */
function makeUploader(destDir) {
  require('fs').mkdirSync(destDir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destDir),
      filename: (_req, file, cb) => {
        const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 20 },
    fileFilter: (_req, file, cb) => {
      if (IMAGE_MIME_TYPES.has(file.mimetype)) return cb(null, true);
      cb(new Error('Hanya file gambar (jpg/png/webp/gif/svg/avif) yang diizinkan'));
    },
  });
}

const uploadActivities = makeUploader(ACTIVITIES_UPLOAD_DIR);
const uploadMembers = makeUploader(MEMBERS_UPLOAD_DIR);

async function removeUploadedFiles(urls = []) {
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) continue;
    const rel = url.slice('/uploads/'.length);
    const filePath = path.join(UPLOAD_ROOT, rel);
    if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) continue;
    try {
      await fs.unlink(filePath);
    } catch {
      /* diabaikan */
    }
  }
}

// ---------------------------------------------------------------
// Data awal (seed) Aktivitas & Podcast
// ---------------------------------------------------------------
const SEED_ACTIVITIES = [
  {
    id: 1,
    title: 'Chikago Futsal',
    category: 'Futsal',
    desc: 'Biasalah foto-foto kite futsal aje isinye, kali nanti bisa futsal di brazil',
    photos: Array.from(
      { length: 8 },
      (_, i) => `/activities/futsal/futsal-${String(i + 1).padStart(2, '0')}.svg`
    ),
  },
  {
    id: 2,
    title: 'Chikago Minsoc Vol.1',
    category: 'Mini-Soccer',
    desc: 'Karena kita ga nyewa FG, jadinya foto minsoc vol.1 kita begini guys',
    photos: Array.from(
      { length: 8 },
      (_, i) => `/activities/minisoccer/soccer-${String(i + 1).padStart(2, '0')}.svg`
    ),
  },
];

const SEED_PODCASTS = [
  {
    id: 1,
    no: 1,
    title: 'Episode 1 - Top 5 Sungai yang Banyak Ibu-Ibu mandi',
    duration: '1 Jam 10 Menit',
    desc: 'Mulainya di 00:41 Ges.. (Maap editor newbie) Aan menemukan sesuatu yang aneh di Labuan Bajo!',
    spotifyLink: 'https://open.spotify.com/episode/2tr9h5q7SnYcv0KAhZL5fv',
  },
  {
    id: 2,
    no: 2,
    title: 'Episode 2 - DJ Ayam dan Petualangan Reza di Bandung',
    duration: '45 Menit',
    desc: 'Patut kita saksikan kisah Reza Dwi Ardhito di Bandung di weekend mendatang.',
    spotifyLink: 'https://open.spotify.com/episode/2p5pgLgo1X2DKhDVMCyhLg',
  },
  {
    id: 3,
    no: 3,
    title: 'Episode 3 - Ibnu Sang Englishman.',
    duration: '36 Menit',
    desc: 'Episode kali ini agak berbobot, tapi tetep aja isinya orang stress.',
    spotifyLink: 'https://open.spotify.com/episode/5nO5zx9mCXjTZVraixSyUF',
  },
];

// ---------------------------------------------------------------
// Nodemailer
// ---------------------------------------------------------------
function isMailConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS && process.env.ADMIN_EMAIL);
}

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendRequestEmail(request) {
  if (!isMailConfigured()) return { sent: false };
  const waktu = new Date(request.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const mailOptions = {
    from: `"Chikago Community Hub" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: `🎧 Usulan Topik Podcast Baru dari ${request.nama}`,
    html: `<p><strong>Nama:</strong> ${request.nama}</p><p><strong>Cerita:</strong> ${request.cerita}</p>`,
  };
  await getTransporter().sendMail(mailOptions);
  return { sent: true };
}

// ---------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} — ${req.method} ${req.originalUrl}`);
  next();
});

// ---------------------------------------------------------------
// Rute API Utama
// ---------------------------------------------------------------
app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'Chikago API Backend is running smoothly!' });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'chikago-community-hub', time: new Date().toISOString() });
});

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true, message: 'Login berhasil' });
  }
  res.status(401).json({ success: false, message: 'Password salah' });
});

/* ================= MEMBERS ================= */
app.get('/api/members', async (_req, res) => {
  try {
    const members = await readJson(MEMBERS_FILE);
    res.json(members);
  } catch (err) {
    res.status(500).json({ message: 'Gagal membaca data anggota', error: err.message });
  }
});

app.post('/api/members', async (req, res) => {
  try {
    const { nama, role, hobi, quotes, lagu, laguSpotify, foto, fotoZoom, fotoPosX, fotoPosY } = req.body || {};
    if (!nama || !nama.trim()) return res.status(400).json({ message: 'Nama anggota wajib diisi' });
    const members = await readJson(MEMBERS_FILE);
    const newMember = {
      id: nextId(members),
      nama: nama.trim(),
      role: (role || 'Anggota Aktif').trim(),
      hobi: (hobi || '').trim(),
      quotes: (quotes || '').trim(),
      laguSpotify: laguSpotify != null ? String(laguSpotify).trim() : '',
      lagu: { judul: (lagu && lagu.judul) || '', artis: (lagu && lagu.artis) || '', album: (lagu && lagu.album) || '' },
      foto: (foto || '').trim() || '/avatars/member-01.svg',
      fotoZoom: Number(fotoZoom) || 1,
      fotoPosX: Number.isFinite(Number(fotoPosX)) ? Number(fotoPosX) : 50,
      fotoPosY: Number.isFinite(Number(fotoPosY)) ? Number(fotoPosY) : 20,
    };
    members.push(newMember);
    await writeJson(MEMBERS_FILE, members);
    res.status(201).json(newMember);
  } catch (err) {
    res.status(500).json({ message: 'Gagal menambah anggota', error: err.message });
  }
});

app.put('/api/members/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const members = await readJson(MEMBERS_FILE);
    const index = members.findIndex((m) => m.id === id);
    if (index === -1) return res.status(404).json({ message: 'Anggota tidak ditemukan' });
    const current = members[index];
    const body = req.body || {};
    members[index] = {
      ...current,
      nama: body.nama != null ? String(body.nama).trim() : current.nama,
      role: body.role != null ? String(body.role).trim() : current.role,
      hobi: body.hobi != null ? String(body.hobi).trim() : current.hobi,
      quotes: body.quotes != null ? String(body.quotes).trim() : current.quotes,
      foto: body.foto != null ? String(body.foto).trim() : current.foto,
      fotoZoom: body.fotoZoom != null ? Number(body.fotoZoom) || 1 : current.fotoZoom || 1,
      fotoPosX: body.fotoPosX != null ? Number(body.fotoPosX) : current.fotoPosX,
      fotoPosY: body.fotoPosY != null ? Number(body.fotoPosY) : current.fotoPosY,
      laguSpotify: body.laguSpotify != null ? String(body.laguSpotify).trim() : current.laguSpotify,
    };
    await writeJson(MEMBERS_FILE, members);
    res.json(members[index]);
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengedit anggota', error: err.message });
  }
});

app.delete('/api/members/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const members = await readJson(MEMBERS_FILE);
    const index = members.findIndex((m) => m.id === id);
    if (index === -1) return res.status(404).json({ message: 'Anggota tidak ditemukan' });
    const [removed] = members.splice(index, 1);
    await writeJson(MEMBERS_FILE, members);
    res.json({ message: 'Anggota berhasil dihapus', removed });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus anggota', error: err.message });
  }
});

/* ================= AKTIVITAS ================= */
app.get('/api/activities', async (_req, res) => {
  try {
    const items = await readJson(ACTIVITIES_FILE, SEED_ACTIVITIES);
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: 'Gagal membaca aktivitas', error: err.message });
  }
});

app.post('/api/activities', async (req, res) => {
  try {
    const { title, category, desc, photos } = req.body || {};
    if (!title) return res.status(400).json({ message: 'Judul wajib diisi' });
    const items = await readJson(ACTIVITIES_FILE, SEED_ACTIVITIES);
    const activity = { id: nextId(items), title, category: category || 'Lainnya', desc, photos: photos || [], createdAt: new Date().toISOString() };
    items.push(activity);
    await writeJson(ACTIVITIES_FILE, items);
    res.status(201).json(activity);
  } catch (err) {
    res.status(500).json({ message: 'Gagal menambah aktivitas', error: err.message });
  }
});

app.delete('/api/activities/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const items = await readJson(ACTIVITIES_FILE, SEED_ACTIVITIES);
    const index = items.findIndex((a) => a.id === id);
    if (index === -1) return res.status(404).json({ message: 'Tidak ditemukan' });
    const [removed] = items.splice(index, 1);
    await writeJson(ACTIVITIES_FILE, items);
    await removeUploadedFiles(removed.photos);
    res.json({ message: 'Berhasil dihapus', removed });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus', error: err.message });
  }
});

/* ================= PODCAST ================= */
app.get('/api/podcasts', async (_req, res) => {
  try {
    const items = await readJson(PODCASTS_FILE, SEED_PODCASTS);
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: 'Gagal membaca podcast', error: err.message });
  }
});

/* ================= UPLOAD & REQUEST ================= */
app.post('/api/upload/activities', uploadActivities.array('photos', 20), (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ message: 'Tidak ada file' });
  res.status(201).json({ urls: files.map((f) => `/uploads/activities/${f.filename}`) });
});

app.post('/api/upload/members', uploadMembers.single('foto'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ message: 'Tidak ada file' });
  res.status(201).json({ url: `/uploads/members/${file.filename}` });
});

app.post('/api/request-topik', async (req, res) => {
  try {
    const { nama, kontak, cerita } = req.body || {};
    if (!nama || !cerita) return res.status(400).json({ message: 'Data tidak lengkap' });
    const requests = await readJson(REQUESTS_FILE);
    const newReq = { id: nextId(requests), nama, kontak, cerita, status: 'baru', createdAt: new Date().toISOString() };
    requests.push(newReq);
    await writeJson(REQUESTS_FILE, requests);
    res.status(201).json({ success: true, message: 'Usulan terkirim' });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengirim usulan', error: err.message });
  }
});

// ---------------------------------------------------------------
// Static: Folder upload file
// ---------------------------------------------------------------
app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '7d', fallthrough: false }));

// Handler 404 untuk API yang tidak terdaftar
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'Endpoint API tidak ditemukan' });
});

function startServer() {
  app.listen(PORT, () => {
    console.log(`✅ Chikago API berjalan di http://localhost:${PORT}`);
  });
}
