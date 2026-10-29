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

// Build frontend (opsional, untuk production: node server.js saja)
const DIST_DIR = path.join(__dirname, '..', 'frontend', 'dist');

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
        // Nama unik: timestamp + angka acak + ekstensi asli (huruf kecil)
        const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 20 }, // maks 5MB/file, 20 file
    fileFilter: (_req, file, cb) => {
      if (IMAGE_MIME_TYPES.has(file.mimetype)) return cb(null, true);
      cb(new Error('Hanya file gambar (jpg/png/webp/gif/svg/avif) yang diizinkan'));
    },
  });
}

const uploadActivities = makeUploader(ACTIVITIES_UPLOAD_DIR);
const uploadMembers = makeUploader(MEMBERS_UPLOAD_DIR);

/** Hapus file hasil upload lokal (dipakai saat data terkait dihapus). */
async function removeUploadedFiles(urls = []) {
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) continue;
    const rel = url.slice('/uploads/'.length);
    const filePath = path.join(UPLOAD_ROOT, rel);
    // Proteksi path traversal
    if (!filePath.startsWith(UPLOAD_ROOT + path.sep)) continue;
    try {
      await fs.unlink(filePath);
    } catch {
      /* file mungkin sudah tidak ada — diabaikan */
    }
  }
}

// ---------------------------------------------------------------
// Data awal (seed) Aktivitas & Podcast — dipakai saat file JSON belum ada
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
    desc: 'Mulainya di 00:41 Ges.. (Maap editor newbie) Aan menemukan sesuatu yang aneh di Labuan Bajo! Bukan cuma soal Komodo dan pemandangan indah, tapi juga kejadian misterius yang bikin merinding. Apa yang sebenarnya terjadi? Dengerin episode ini untuk mengungkap misteri Labuan Bajo!',
    spotifyLink: 'https://open.spotify.com/episode/2tr9h5q7SnYcv0KAhZL5fv',
  },
  {
    id: 2,
    no: 2,
    title: 'Episode 2 - DJ Ayam dan Petualangan Reza di Bandung',
    duration: '45 Menit',
    desc: 'Patut kita saksikan kisah Reza Dwi Ardhito di Bandung di weekend mendatang, akankah Bandung menjadi daerah indah penuh kenangan atau justru menjadi momok menakutkan?',
    spotifyLink: 'https://open.spotify.com/episode/2p5pgLgo1X2DKhDVMCyhLg',
  },
  {
    id: 3,
    no: 3,
    title: 'Episode 3 - Ibnu Sang Englishman.',
    duration: '36 Menit',
    desc: 'Episode kali ini agak berbobot, tapi tetep aja isinya orang stress. Episode kali ini kita kedatangan tamu yang lidahnya udah kejepit kamus Oxford: Ibnu Sang Englishman.',
    spotifyLink: 'https://open.spotify.com/episode/5nO5zx9mCXjTZVraixSyUF',
  },
];

// ---------------------------------------------------------------
// Nodemailer — hanya aktif jika SMTP_USER & SMTP_PASS terisi
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
  if (!isMailConfigured()) {
    console.log(`[EMAIL NONAKTIF] Usulan baru dari ${request.nama} tersimpan di requests.json`);
    return { sent: false, reason: 'SMTP belum dikonfigurasi' };
  }
  const waktu = new Date(request.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const mailOptions = {
    from: `"Chikago Community Hub" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: `🎧 Usulan Topik Podcast Baru dari ${request.nama}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
        <div style="background: #4f46e5; color: #fff; padding: 16px 24px;">
          <h2 style="margin: 0;">Chikago Community Hub</h2>
          <p style="margin: 4px 0 0;">Notifikasi Usulan Topik Podcast</p>
        </div>
        <div style="padding: 24px;">
          <p><strong>Nama Pengusul:</strong> ${request.nama}</p>
          <p><strong>Kontak:</strong> ${request.kontak || '-'}</p>
          <p><strong>Waktu Kirim:</strong> ${waktu} WIB</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
          <p><strong>Detail Topik:</strong></p>
          <p style="background: #f9fafb; padding: 12px; border-radius: 8px; white-space: pre-wrap;">${request.cerita}</p>
        </div>
        <div style="background: #f9fafb; padding: 12px 24px; color: #6b7280; font-size: 12px;">
          Email otomatis dari Chikago Community Hub.
        </div>
      </div>
    `,
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

// Log sederhana setiap request
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} — ${req.method} ${req.originalUrl}`);
  next();
});

// ---------------------------------------------------------------
// Rute API
// ---------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'chikago-community-hub', time: new Date().toISOString() });
});

// Autentikasi admin sederhana
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true, message: 'Login berhasil' });
  }
  res.status(401).json({ success: false, message: 'Password salah' });
});

/* ================= MEMBERS ================= */

// GET /api/members — ambil semua anggota
app.get('/api/members', async (_req, res) => {
  try {
    const members = await readJson(MEMBERS_FILE);
    res.json(members);
  } catch (err) {
    res.status(500).json({ message: 'Gagal membaca data anggota', error: err.message });
  }
});

// POST /api/members — tambah anggota baru (Admin)
app.post('/api/members', async (req, res) => {
  try {
    const { nama, role, hobi, quotes, lagu, laguSpotify, foto, fotoZoom, fotoPosX, fotoPosY } =
      req.body || {};
    if (!nama || !nama.trim()) {
      return res.status(400).json({ message: 'Nama anggota wajib diisi' });
    }
    const members = await readJson(MEMBERS_FILE);
    const newMember = {
      id: nextId(members),
      nama: nama.trim(),
      role: (role || 'Anggota Aktif').trim(),
      hobi: (hobi || '').trim(),
      quotes: (quotes || '').trim(),
      // Link lagu Spotify (format baru): https://open.spotify.com/track/{id}
      laguSpotify: laguSpotify != null ? String(laguSpotify).trim() : '',
      // Legacy: data teks manual (judul/artis/album) tetap diterima untuk kompatibilitas lama
      lagu: {
        judul: (lagu && lagu.judul) || '',
        artis: (lagu && lagu.artis) || '',
        album: (lagu && lagu.album) || '',
      },
      foto: (foto || '').trim() || '/avatars/member-01.svg',
      // Pengaturan bingkai foto (adjuster zoom & posisi dari form admin)
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

// PUT /api/members/:id — edit biodata anggota (Admin)
app.put('/api/members/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const members = await readJson(MEMBERS_FILE);
    const index = members.findIndex((m) => m.id === id);
    if (index === -1) {
      return res.status(404).json({ message: 'Anggota tidak ditemukan' });
    }
    const current = members[index];
    const body = req.body || {};
    members[index] = {
      ...current,
      nama: body.nama != null ? String(body.nama).trim() : current.nama,
      role: body.role != null ? String(body.role).trim() : current.role,
      hobi: body.hobi != null ? String(body.hobi).trim() : current.hobi,
      quotes: body.quotes != null ? String(body.quotes).trim() : current.quotes,
      foto: body.foto != null ? String(body.foto).trim() : current.foto,
      // Pengaturan bingkai foto (adjuster zoom & posisi dari form admin)
      fotoZoom: body.fotoZoom != null ? Number(body.fotoZoom) || 1 : current.fotoZoom || 1,
      fotoPosX:
        body.fotoPosX != null && Number.isFinite(Number(body.fotoPosX))
          ? Number(body.fotoPosX)
          : current.fotoPosX != null
            ? Number(current.fotoPosX)
            : 50,
      fotoPosY:
        body.fotoPosY != null && Number.isFinite(Number(body.fotoPosY))
          ? Number(body.fotoPosY)
          : current.fotoPosY != null
            ? Number(current.fotoPosY)
            : 20,
      // Link lagu Spotify (format baru)
      laguSpotify:
        body.laguSpotify != null
          ? String(body.laguSpotify).trim()
          : current.laguSpotify || '',
      // Legacy: teks manual lama (dilindungi agar data lama tidak crash)
      lagu: {
        judul: body.lagu && body.lagu.judul != null ? String(body.lagu.judul).trim() : (current.lagu && current.lagu.judul) || '',
        artis: body.lagu && body.lagu.artis != null ? String(body.lagu.artis).trim() : (current.lagu && current.lagu.artis) || '',
        album: body.lagu && body.lagu.album != null ? String(body.lagu.album).trim() : (current.lagu && current.lagu.album) || '',
      },
    };
    await writeJson(MEMBERS_FILE, members);
    res.json(members[index]);
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengedit anggota', error: err.message });
  }
});

// DELETE /api/members/:id — hapus anggota (Admin)
app.delete('/api/members/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const members = await readJson(MEMBERS_FILE);
    const index = members.findIndex((m) => m.id === id);
    if (index === -1) {
      return res.status(404).json({ message: 'Anggota tidak ditemukan' });
    }
    const [removed] = members.splice(index, 1);
    await writeJson(MEMBERS_FILE, members);
    res.json({ message: `Anggota ${removed.nama} berhasil dihapus`, removed });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus anggota', error: err.message });
  }
});

/* ================= AKTIVITAS ================= */

// GET /api/activities — daftar aktivitas (galeri terpadu)
app.get('/api/activities', async (_req, res) => {
  try {
    const items = await readJson(ACTIVITIES_FILE, SEED_ACTIVITIES);
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: 'Gagal membaca data aktivitas', error: err.message });
  }
});

// POST /api/activities — tambah aktivitas baru (Admin)
app.post('/api/activities', async (req, res) => {
  try {
    const { title, category, desc, photos } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Nama aktivitas wajib diisi' });
    }
    const items = await readJson(ACTIVITIES_FILE, SEED_ACTIVITIES);
    const activity = {
      id: nextId(items),
      title: title.trim(),
      category: (category || '').trim() || 'Lainnya',
      desc: (desc || '').trim(),
      photos: (Array.isArray(photos) ? photos : [])
        .map((p) => String(p || '').trim())
        .filter(Boolean),
      createdAt: new Date().toISOString(),
    };
    items.push(activity);
    await writeJson(ACTIVITIES_FILE, items);
    res.status(201).json(activity);
  } catch (err) {
    res.status(500).json({ message: 'Gagal menambah aktivitas', error: err.message });
  }
});

// PUT /api/activities/:id — edit aktivitas (Admin)
app.put('/api/activities/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const items = await readJson(ACTIVITIES_FILE, SEED_ACTIVITIES);
    const index = items.findIndex((a) => a.id === id);
    if (index === -1) {
      return res.status(404).json({ message: 'Aktivitas tidak ditemukan' });
    }
    const current = items[index];
    const body = req.body || {};
    items[index] = {
      ...current,
      title: body.title != null ? String(body.title).trim() || current.title : current.title,
      category: body.category != null ? String(body.category).trim() || 'Lainnya' : current.category,
      desc: body.desc != null ? String(body.desc).trim() : current.desc,
      photos: (Array.isArray(body.photos) ? body.photos : current.photos)
        .map((p) => String(p || '').trim())
        .filter(Boolean),
    };
    await writeJson(ACTIVITIES_FILE, items);
    res.json(items[index]);
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengedit aktivitas', error: err.message });
  }
});

// DELETE /api/activities/:id — hapus aktivitas + file upload terkait (Admin)
app.delete('/api/activities/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const items = await readJson(ACTIVITIES_FILE, SEED_ACTIVITIES);
    const index = items.findIndex((a) => a.id === id);
    if (index === -1) {
      return res.status(404).json({ message: 'Aktivitas tidak ditemukan' });
    }
    const [removed] = items.splice(index, 1);
    await writeJson(ACTIVITIES_FILE, items);
    await removeUploadedFiles(removed.photos); // bersihkan foto hasil upload
    res.json({ message: `Aktivitas "${removed.title}" berhasil dihapus`, removed });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus aktivitas', error: err.message });
  }
});

/* ================= PODCAST ================= */

// GET /api/podcasts — daftar episode podcast (urut nomor episode)
app.get('/api/podcasts', async (_req, res) => {
  try {
    const items = await readJson(PODCASTS_FILE, SEED_PODCASTS);
    items.sort((a, b) => (a.no || 0) - (b.no || 0));
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: 'Gagal membaca data podcast', error: err.message });
  }
});

/** Normalisasi payload episode podcast. */
function normalizePodcastBody(body = {}, current = {}) {
  return {
    no: body.no != null && String(body.no).trim() !== '' ? Number(body.no) || current.no : current.no,
    title: body.title != null ? String(body.title).trim() || current.title : current.title,
    duration: body.duration != null ? String(body.duration).trim() : current.duration,
    desc: body.desc != null ? String(body.desc).trim() : current.desc,
    spotifyLink: body.spotifyLink != null ? String(body.spotifyLink).trim() : current.spotifyLink,
  };
}

// POST /api/podcasts — tambah episode baru (Admin)
app.post('/api/podcasts', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !String(body.title).trim()) {
      return res.status(400).json({ message: 'Judul episode wajib diisi' });
    }
    const items = await readJson(PODCASTS_FILE, SEED_PODCASTS);
    const episode = {
      id: nextId(items),
      ...normalizePodcastBody(body, { no: 0, title: '', duration: '', desc: '', spotifyLink: '' }),
    };
    if (!episode.no) {
      episode.no = items.reduce((max, e) => Math.max(max, Number(e.no) || 0), 0) + 1;
    }
    items.push(episode);
    await writeJson(PODCASTS_FILE, items);
    res.status(201).json(episode);
  } catch (err) {
    res.status(500).json({ message: 'Gagal menambah episode', error: err.message });
  }
});

// PUT /api/podcasts/:id — edit episode (Admin)
app.put('/api/podcasts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const items = await readJson(PODCASTS_FILE, SEED_PODCASTS);
    const index = items.findIndex((e) => e.id === id);
    if (index === -1) {
      return res.status(404).json({ message: 'Episode tidak ditemukan' });
    }
    items[index] = { ...items[index], ...normalizePodcastBody(req.body || {}, items[index]) };
    await writeJson(PODCASTS_FILE, items);
    res.json(items[index]);
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengedit episode', error: err.message });
  }
});

// DELETE /api/podcasts/:id — hapus episode (Admin)
app.delete('/api/podcasts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const items = await readJson(PODCASTS_FILE, SEED_PODCASTS);
    const index = items.findIndex((e) => e.id === id);
    if (index === -1) {
      return res.status(404).json({ message: 'Episode tidak ditemukan' });
    }
    const [removed] = items.splice(index, 1);
    await writeJson(PODCASTS_FILE, items);
    res.json({ message: `Episode ${removed.no} berhasil dihapus`, removed });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus episode', error: err.message });
  }
});

/* ================= UPLOAD FILE ================= */

// POST /api/upload/activities — upload multi foto aktivitas (field: photos[])
app.post('/api/upload/activities', uploadActivities.array('photos', 20), (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ message: 'Tidak ada file gambar yang diunggah' });
  }
  res.status(201).json({
    urls: files.map((f) => `/uploads/activities/${f.filename}`),
    files: files.map((f) => ({
      filename: f.filename,
      originalname: f.originalname,
      size: f.size,
      url: `/uploads/activities/${f.filename}`,
    })),
  });
});

// POST /api/upload/members — upload foto profil member (field: foto)
app.post('/api/upload/members', uploadMembers.single('foto'), (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: 'Tidak ada file foto yang diunggah' });
  }
  res.status(201).json({
    url: `/uploads/members/${file.filename}`,
    filename: file.filename,
    originalname: file.originalname,
    size: file.size,
  });
});

/* ================= REQUEST TOPIK ================= */

// POST /api/request-topik — kirim form usulan & trigger Nodemailer
app.post('/api/request-topik', async (req, res) => {
  try {
    const { nama, kontak, cerita } = req.body || {};
    if (!nama || !nama.trim()) {
      return res.status(400).json({ message: 'Nama pengusul wajib diisi' });
    }
    if (!cerita || !cerita.trim()) {
      return res.status(400).json({ message: 'Detail topik wajib diisi' });
    }
    const requests = await readJson(REQUESTS_FILE);
    const newRequest = {
      id: nextId(requests),
      nama: nama.trim(),
      kontak: (kontak || '').trim(),
      cerita: cerita.trim(),
      status: 'baru',
      createdAt: new Date().toISOString(),
    };
    requests.push(newRequest);
    await writeJson(REQUESTS_FILE, requests);

    // Kirim email notifikasi (tidak memblokir respons)
    sendRequestEmail(newRequest)
      .then((result) => console.log(`Email notifikasi: ${result.sent ? 'terkirim' : 'dilewati'}`))
      .catch((err) => console.error('Gagal mengirim email:', err.message));

    res.status(201).json({
      success: true,
      message: 'Terima kasih! Usulan topikmu sudah terkirim.',
      request: newRequest,
    });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengirim usulan topik', error: err.message });
  }
});

// GET /api/requests — ambil daftar usulan topik (Admin)
app.get('/api/requests', async (_req, res) => {
  try {
    const requests = await readJson(REQUESTS_FILE);
    requests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: 'Gagal membaca data usulan', error: err.message });
  }
});

// PUT /api/requests/:id — tandai usulan selesai / dibuka kembali (Admin)
app.put('/api/requests/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const requests = await readJson(REQUESTS_FILE);
    const index = requests.findIndex((r) => r.id === id);
    if (index === -1) {
      return res.status(404).json({ message: 'Usulan tidak ditemukan' });
    }
    const { status } = req.body || {};
    requests[index].status = status === 'selesai' ? 'selesai' : 'baru';
    await writeJson(REQUESTS_FILE, requests);
    res.json(requests[index]);
  } catch (err) {
    res.status(500).json({ message: 'Gagal memperbarui status usulan', error: err.message });
  }
});

// DELETE /api/requests/:id — hapus data usulan topik (Admin)
app.delete('/api/requests/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const requests = await readJson(REQUESTS_FILE);
    const index = requests.findIndex((r) => r.id === id);
    if (index === -1) {
      return res.status(404).json({ message: 'Usulan tidak ditemukan' });
    }
    const [removed] = requests.splice(index, 1);
    await writeJson(REQUESTS_FILE, requests);
    res.json({ message: 'Usulan berhasil dihapus', removed });
  } catch (err) {
    res.status(500).json({ message: 'Gagal menghapus usulan', error: err.message });
  }
});

// ---------------------------------------------------------------
// Error handler upload (multer) — kirim pesan jelas ke frontend
// ---------------------------------------------------------------
app.use('/api', (err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: `Upload gagal: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ message: err.message || 'Terjadi kesalahan saat upload' });
  }
  next();
});

// 404 untuk route API yang tidak dikenal
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'Endpoint tidak ditemukan' });
});

// ---------------------------------------------------------------
// Static: file upload hasil multer (/uploads/activities, /uploads/members)
// ---------------------------------------------------------------
app.use('/uploads', express.static(UPLOAD_ROOT, { maxAge: '7d', fallthrough: false }));

// ---------------------------------------------------------------
// Static: build frontend (production) + fallback SPA
// ---------------------------------------------------------------
app.use(express.static(DIST_DIR));
app.get('*', (req, res) => {
  // Jangan sentuh request API / upload yang tidak cocok route
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return res.status(404).json({ message: 'Endpoint tidak ditemukan' });
  }
  res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
    if (err) {
      res
        .status(404)
        .json({ message: 'Frontend belum dibuild. Jalankan `npm run build` di folder frontend.' });
    }
  });
});

function startServer() {
  app.listen(PORT, () => {
    console.log(`✅ Chikago API berjalan di http://localhost:${PORT}`);
    console.log(`📁 Folder upload: ${UPLOAD_ROOT}`);
    console.log(`📧 Notifikasi email: ${isMailConfigured() ? 'AKTIF' : 'nonaktif (isi .env untuk mengaktifkan)'}`);
  });
}
