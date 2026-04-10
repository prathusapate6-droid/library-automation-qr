const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { Server } = require('socket.io');
const http = require('http');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'library_super_secret_key_change_me';

// PostgreSQL connection pool — uses DATABASE_URL env var set in Render dashboard
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      college TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS books (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      cover_url TEXT,
      available INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      book_id INTEGER NOT NULL REFERENCES books(id),
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS issued_books (
      id SERIAL PRIMARY KEY,
      request_id INTEGER NOT NULL REFERENCES requests(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      book_id INTEGER NOT NULL REFERENCES books(id),
      issue_date TIMESTAMPTZ DEFAULT NOW(),
      return_date TIMESTAMPTZ
    );
  `);

  const adminEmail = 'admin@library.local';
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
  if (existing.rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query(
      `INSERT INTO users (name, class_name, college, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'admin')`,
      ['Librarian Admin', 'N/A', 'Library', adminEmail, hash]
    );
    console.log('Default admin created: admin@library.local / admin123');
  }

  // Add cover_url column to existing tables (safe migration)
  await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_url TEXT`);

  console.log('Database initialized ✅');
}

initDb().catch(err => {
  console.error('DB init error:', err.message);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Explicit root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  return next();
}

/* ── AUTH ── */

app.post('/api/auth/register', async (req, res) => {
  const { name, className, college, email, password } = req.body;
  if (!name || !className || !college || !email || !password)
    return res.status(400).json({ error: 'All fields are required' });

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  if (existing.rows.length > 0)
    return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = await pool.query(
    `INSERT INTO users (name, class_name, college, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, 'student') RETURNING id`,
    [name.trim(), className.trim(), college.trim(), email.trim().toLowerCase(), passwordHash]
  );
  const user = (await pool.query(
    'SELECT id, name, class_name, college, email, role FROM users WHERE id = $1',
    [info.rows[0].id]
  )).rows[0];

  return res.json({ token: signToken(user), user });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  if (!bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid credentials' });

  const payload = { id: user.id, name: user.name, class_name: user.class_name, college: user.college, email: user.email, role: user.role };
  return res.json({ token: signToken(payload), user: payload });
});

app.get('/api/me', auth, async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, class_name, college, email, role, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  return res.json({ user: result.rows[0] });
});

/* ── BOOKS ── */

app.get('/api/books', auth, async (req, res) => {
  const result = await pool.query('SELECT id, code, name, description, cover_url, available, created_at FROM books ORDER BY id DESC');
  return res.json({ books: result.rows });
});

app.post('/api/admin/books', auth, adminOnly, async (req, res) => {
  const { name, description, coverUrl } = req.body;
  if (!name) return res.status(400).json({ error: 'Book name is required' });

  const tempCode = `TMP_${Date.now()}`;
  const info = await pool.query(
    'INSERT INTO books (code, name, description, cover_url, available) VALUES ($1, $2, $3, $4, 1) RETURNING id',
    [tempCode, name.trim(), (description || '').trim(), (coverUrl || '').trim() || null]
  );
  const id = info.rows[0].id;
  const code = `LIB_BOOK_${String(id).padStart(4, '0')}`;
  await pool.query('UPDATE books SET code = $1 WHERE id = $2', [code, id]);

  const book = (await pool.query(
    'SELECT id, code, name, description, cover_url, available, created_at FROM books WHERE id = $1', [id]
  )).rows[0];

  io.to('admins').emit('book:created', book);
  return res.status(201).json({ book });
});

/* ── REQUESTS ── */

app.post('/api/requests', auth, async (req, res) => {
  if (req.user.role !== 'student')
    return res.status(403).json({ error: 'Only students can create request' });

  const { bookCode } = req.body;
  if (!bookCode) return res.status(400).json({ error: 'bookCode is required' });

  const bookResult = await pool.query('SELECT * FROM books WHERE code = $1', [bookCode.trim()]);
  const book = bookResult.rows[0];
  if (!book) return res.status(404).json({ error: 'Book not found for scanned QR' });
  if (!book.available) return res.status(400).json({ error: 'Book currently not available' });

  const dup = await pool.query(
    `SELECT id FROM requests WHERE user_id = $1 AND book_id = $2 AND status = 'pending'`,
    [req.user.id, book.id]
  );
  if (dup.rows.length > 0) return res.status(409).json({ error: 'Request already pending for this book' });

  const info = await pool.query(
    `INSERT INTO requests (user_id, book_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
    [req.user.id, book.id]
  );
  const requestRow = (await pool.query(`
    SELECT r.id, r.status, r.created_at, r.updated_at,
           b.id as book_id, b.code as book_code, b.name as book_name,
           u.id as user_id, u.name as user_name, u.class_name, u.college, u.email
    FROM requests r
    JOIN books b ON b.id = r.book_id
    JOIN users u ON u.id = r.user_id
    WHERE r.id = $1
  `, [info.rows[0].id])).rows[0];

  io.to('admins').emit('request:new', requestRow);
  return res.status(201).json({ request: requestRow });
});

app.get('/api/requests/my', auth, async (req, res) => {
  const result = await pool.query(`
    SELECT r.id, r.status, r.created_at, r.updated_at,
           b.code as book_code, b.name as book_name, b.description
    FROM requests r JOIN books b ON b.id = r.book_id
    WHERE r.user_id = $1 ORDER BY r.id DESC
  `, [req.user.id]);
  return res.json({ requests: result.rows });
});

app.get('/api/issued/my', auth, async (req, res) => {
  const result = await pool.query(`
    SELECT i.id, i.issue_date, i.return_date,
           b.code as book_code, b.name as book_name, b.description
    FROM issued_books i JOIN books b ON b.id = i.book_id
    WHERE i.user_id = $1 ORDER BY i.id DESC
  `, [req.user.id]);
  return res.json({ issued: result.rows });
});

/* ── ADMIN REQUESTS ── */

app.get('/api/admin/requests', auth, adminOnly, async (req, res) => {
  const { status } = req.query;
  let query = `
    SELECT r.id, r.status, r.created_at, r.updated_at,
           b.id as book_id, b.code as book_code, b.name as book_name,
           u.id as user_id, u.name as user_name, u.class_name, u.college, u.email
    FROM requests r JOIN books b ON b.id = r.book_id JOIN users u ON u.id = r.user_id
  `;
  const params = [];
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    query += ' WHERE r.status = $1';
    params.push(status);
  }
  query += ' ORDER BY r.id DESC';
  const result = await pool.query(query, params);
  return res.json({ requests: result.rows });
});

app.patch('/api/admin/requests/:id', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });

  const existingResult = await pool.query(`
    SELECT r.*, b.available, b.id as book_id, u.id as user_id
    FROM requests r JOIN books b ON b.id = r.book_id JOIN users u ON u.id = r.user_id
    WHERE r.id = $1
  `, [id]);
  const existing = existingResult.rows[0];
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  if (existing.status !== 'pending') return res.status(409).json({ error: 'Request already processed' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date().toISOString();
    await client.query('UPDATE requests SET status = $1, updated_at = $2 WHERE id = $3', [status, now, id]);
    if (status === 'approved') {
      if (!existing.available) throw new Error('Book not available anymore');
      await client.query('UPDATE books SET available = 0 WHERE id = $1', [existing.book_id]);
      await client.query(
        'INSERT INTO issued_books (request_id, user_id, book_id, issue_date) VALUES ($1, $2, $3, $4)',
        [id, existing.user_id, existing.book_id, now]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(409).json({ error: err.message });
  } finally {
    client.release();
  }

  const updated = (await pool.query(`
    SELECT r.id, r.status, r.created_at, r.updated_at,
           b.id as book_id, b.code as book_code, b.name as book_name,
           u.id as user_id, u.name as user_name, u.class_name, u.college, u.email
    FROM requests r JOIN books b ON b.id = r.book_id JOIN users u ON u.id = r.user_id
    WHERE r.id = $1
  `, [id])).rows[0];

  io.to('admins').emit('request:updated', updated);
  io.to(`user:${updated.user_id}`).emit('request:updated', updated);
  return res.json({ request: updated });
});

/* ── ISSUED BOOKS ── */

app.get('/api/admin/issued', auth, adminOnly, async (req, res) => {
  const result = await pool.query(`
    SELECT i.id, i.issue_date, i.return_date,
           b.code as book_code, b.name as book_name, b.id as book_id,
           u.name as user_name, u.class_name, u.college, u.email
    FROM issued_books i JOIN books b ON b.id = i.book_id JOIN users u ON u.id = i.user_id
    ORDER BY i.id DESC
  `);
  return res.json({ issued: result.rows });
});

app.patch('/api/admin/return/:id', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const issued = (await pool.query('SELECT * FROM issued_books WHERE id = $1', [id])).rows[0];
  if (!issued) return res.status(404).json({ error: 'Issued record not found' });
  if (issued.return_date) return res.status(409).json({ error: 'Book already returned' });

  const now = new Date().toISOString();
  await pool.query('UPDATE issued_books SET return_date = $1 WHERE id = $2', [now, id]);
  await pool.query('UPDATE books SET available = 1 WHERE id = $1', [issued.book_id]);
  io.to('admins').emit('book:returned', { id, book_id: issued.book_id });
  return res.json({ success: true, return_date: now });
});

/* ── STATS ── */

app.get('/api/admin/stats', auth, adminOnly, async (req, res) => {
  const [totalBooks, issuedBooks, totalStudents, pendingRequests, availableBooks, issuedToday] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM books'),
    pool.query("SELECT COUNT(*) as count FROM issued_books WHERE return_date IS NULL"),
    pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'student'"),
    pool.query("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'"),
    pool.query('SELECT COUNT(*) as count FROM books WHERE available = 1'),
    pool.query("SELECT COUNT(*) as count FROM issued_books WHERE issue_date >= NOW() - INTERVAL '1 day'"),
  ]);
  return res.json({
    stats: {
      totalBooks: parseInt(totalBooks.rows[0].count),
      issuedBooks: parseInt(issuedBooks.rows[0].count),
      totalStudents: parseInt(totalStudents.rows[0].count),
      pendingRequests: parseInt(pendingRequests.rows[0].count),
      availableBooks: parseInt(availableBooks.rows[0].count),
      issuedToday: parseInt(issuedToday.rows[0].count),
    }
  });
});

/* ── STUDENTS ── */

app.get('/api/admin/students', auth, adminOnly, async (req, res) => {
  const result = await pool.query(
    "SELECT id, name, class_name, college, email, created_at FROM users WHERE role = 'student' ORDER BY id DESC"
  );
  return res.json({ students: result.rows });
});

/* ── QR CODE ── */

app.get('/api/admin/qr', auth, adminOnly, async (req, res) => {
  const text = String(req.query.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    const dataUrl = await QRCode.toDataURL(text, {
      width: 280, margin: 1,
      color: { dark: '#0f2d52', light: '#FFFFFF' },
    });
    return res.json({ text, dataUrl });
  } catch {
    return res.status(500).json({ error: 'Could not generate QR' });
  }
});

/* ── SOCKET.IO ── */

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    socket.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  if (socket.user.role === 'admin') socket.join('admins');
  socket.join(`user:${socket.user.id}`);
});

/* ── HEALTH ── */

app.get('/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
