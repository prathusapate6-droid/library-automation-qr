const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');
const http = require('http');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'library_super_secret_key_change_me';

const db = new Database(path.join(__dirname, 'library.db'));
db.pragma('journal_mode = WAL');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      class_name TEXT NOT NULL,
      college TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      available INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      book_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (book_id) REFERENCES books(id)
    );

    CREATE TABLE IF NOT EXISTS issued_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      book_id INTEGER NOT NULL,
      issue_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      return_date TEXT,
      FOREIGN KEY (request_id) REFERENCES requests(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (book_id) REFERENCES books(id)
    );
  `);

  const adminEmail = 'admin@library.local';
  const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`
      INSERT INTO users (name, class_name, college, email, password_hash, role)
      VALUES (?, ?, ?, ?, ?, 'admin')
    `).run('Librarian Admin', 'N/A', 'Library', adminEmail, hash);
    console.log('Default admin created: admin@library.local / admin123');
  }
}

initDb();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
}

app.post('/api/auth/register', (req, res) => {
  const { name, className, college, email, password } = req.body;

  if (!name || !className || !college || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`
    INSERT INTO users (name, class_name, college, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?, 'student')
  `).run(name.trim(), className.trim(), college.trim(), email.trim().toLowerCase(), passwordHash);

  const user = db.prepare('SELECT id, name, class_name, college, email, role FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = signToken(user);

  return res.json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const payload = {
    id: user.id,
    name: user.name,
    class_name: user.class_name,
    college: user.college,
    email: user.email,
    role: user.role,
  };

  const token = signToken(payload);
  return res.json({ token, user: payload });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, class_name, college, email, role, created_at FROM users WHERE id = ?').get(req.user.id);
  return res.json({ user });
});

app.get('/api/books', auth, (req, res) => {
  const books = db.prepare(`
    SELECT id, code, name, description, available, created_at
    FROM books
    ORDER BY id DESC
  `).all();
  return res.json({ books });
});

app.post('/api/admin/books', auth, adminOnly, (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Book name is required' });
  }

  const insert = db.prepare('INSERT INTO books (code, name, description, available) VALUES (?, ?, ?, 1)');
  const tempCode = `TMP_${Date.now()}`;
  const info = insert.run(tempCode, name.trim(), (description || '').trim());
  const id = info.lastInsertRowid;
  const code = `LIB_BOOK_${String(id).padStart(4, '0')}`;

  db.prepare('UPDATE books SET code = ? WHERE id = ?').run(code, id);

  const book = db.prepare('SELECT id, code, name, description, available, created_at FROM books WHERE id = ?').get(id);
  io.to('admins').emit('book:created', book);

  return res.status(201).json({ book });
});

app.post('/api/requests', auth, (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Only students can create request' });
  }

  const { bookCode } = req.body;
  if (!bookCode) {
    return res.status(400).json({ error: 'bookCode is required' });
  }

  const book = db.prepare('SELECT * FROM books WHERE code = ?').get(bookCode.trim());
  if (!book) {
    return res.status(404).json({ error: 'Book not found for scanned QR' });
  }

  if (!book.available) {
    return res.status(400).json({ error: 'Book currently not available' });
  }

  const duplicatePending = db.prepare(`
    SELECT id FROM requests
    WHERE user_id = ? AND book_id = ? AND status = 'pending'
  `).get(req.user.id, book.id);

  if (duplicatePending) {
    return res.status(409).json({ error: 'Request already pending for this book' });
  }

  const info = db.prepare(`
    INSERT INTO requests (user_id, book_id, status)
    VALUES (?, ?, 'pending')
  `).run(req.user.id, book.id);

  const requestRow = db.prepare(`
    SELECT r.id, r.status, r.created_at, r.updated_at,
           b.id as book_id, b.code as book_code, b.name as book_name,
           u.id as user_id, u.name as user_name, u.class_name, u.college, u.email
    FROM requests r
    JOIN books b ON b.id = r.book_id
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
  `).get(info.lastInsertRowid);

  io.to('admins').emit('request:new', requestRow);

  return res.status(201).json({ request: requestRow });
});

app.get('/api/requests/my', auth, (req, res) => {
  const requests = db.prepare(`
    SELECT r.id, r.status, r.created_at, r.updated_at,
           b.code as book_code, b.name as book_name, b.description
    FROM requests r
    JOIN books b ON b.id = r.book_id
    WHERE r.user_id = ?
    ORDER BY r.id DESC
  `).all(req.user.id);

  return res.json({ requests });
});

app.get('/api/issued/my', auth, (req, res) => {
  const issued = db.prepare(`
    SELECT i.id, i.issue_date, i.return_date,
           b.code as book_code, b.name as book_name, b.description
    FROM issued_books i
    JOIN books b ON b.id = i.book_id
    WHERE i.user_id = ?
    ORDER BY i.id DESC
  `).all(req.user.id);

  return res.json({ issued });
});

app.get('/api/admin/requests', auth, adminOnly, (req, res) => {
  const { status } = req.query;

  let query = `
    SELECT r.id, r.status, r.created_at, r.updated_at,
           b.id as book_id, b.code as book_code, b.name as book_name,
           u.id as user_id, u.name as user_name, u.class_name, u.college, u.email
    FROM requests r
    JOIN books b ON b.id = r.book_id
    JOIN users u ON u.id = r.user_id
  `;

  const params = [];

  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    query += ' WHERE r.status = ? ';
    params.push(status);
  }

  query += ' ORDER BY r.id DESC';

  const rows = db.prepare(query).all(...params);
  return res.json({ requests: rows });
});

app.patch('/api/admin/requests/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const existing = db.prepare(`
    SELECT r.*, b.available, b.id as book_id, u.id as user_id
    FROM requests r
    JOIN books b ON b.id = r.book_id
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
  `).get(id);

  if (!existing) {
    return res.status(404).json({ error: 'Request not found' });
  }

  if (existing.status !== 'pending') {
    return res.status(409).json({ error: 'Request already processed' });
  }

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);

    if (status === 'approved') {
      if (!existing.available) {
        throw new Error('Book not available anymore');
      }

      db.prepare('UPDATE books SET available = 0 WHERE id = ?').run(existing.book_id);
      db.prepare(`
        INSERT INTO issued_books (request_id, user_id, book_id, issue_date)
        VALUES (?, ?, ?, ?)
      `).run(id, existing.user_id, existing.book_id, now);
    }
  });

  try {
    tx();
  } catch (error) {
    return res.status(409).json({ error: error.message });
  }

  const updated = db.prepare(`
    SELECT r.id, r.status, r.created_at, r.updated_at,
           b.id as book_id, b.code as book_code, b.name as book_name,
           u.id as user_id, u.name as user_name, u.class_name, u.college, u.email
    FROM requests r
    JOIN books b ON b.id = r.book_id
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
  `).get(id);

  io.to('admins').emit('request:updated', updated);
  io.to(`user:${updated.user_id}`).emit('request:updated', updated);

  return res.json({ request: updated });
});

app.get('/api/admin/issued', auth, adminOnly, (req, res) => {
  const issued = db.prepare(`
    SELECT i.id, i.issue_date, i.return_date,
           b.code as book_code, b.name as book_name, b.id as book_id,
           u.name as user_name, u.class_name, u.college, u.email
    FROM issued_books i
    JOIN books b ON b.id = i.book_id
    JOIN users u ON u.id = i.user_id
    ORDER BY i.id DESC
  `).all();

  return res.json({ issued });
});

app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  const totalBooks = db.prepare('SELECT COUNT(*) as count FROM books').get().count;
  const issuedBooks = db.prepare('SELECT COUNT(*) as count FROM issued_books WHERE return_date IS NULL').get().count;
  const totalStudents = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count;
  const pendingRequests = db.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'").get().count;
  const availableBooks = db.prepare('SELECT COUNT(*) as count FROM books WHERE available = 1').get().count;
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const issuedToday = db.prepare('SELECT COUNT(*) as count FROM issued_books WHERE issue_date >= ?').get(todayStart.toISOString()).count;

  return res.json({
    stats: { totalBooks, issuedBooks, totalStudents, pendingRequests, availableBooks, issuedToday }
  });
});

app.patch('/api/admin/return/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const issued = db.prepare('SELECT * FROM issued_books WHERE id = ?').get(id);

  if (!issued) {
    return res.status(404).json({ error: 'Issued record not found' });
  }

  if (issued.return_date) {
    return res.status(409).json({ error: 'Book already returned' });
  }

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('UPDATE issued_books SET return_date = ? WHERE id = ?').run(now, id);
    db.prepare('UPDATE books SET available = 1 WHERE id = ?').run(issued.book_id);
  });

  tx();
  io.to('admins').emit('book:returned', { id, book_id: issued.book_id });

  return res.json({ success: true, return_date: now });
});

app.get('/api/admin/students', auth, adminOnly, (req, res) => {
  const students = db.prepare("SELECT id, name, class_name, college, email, created_at FROM users WHERE role = 'student' ORDER BY id DESC").all();
  return res.json({ students });
});



app.get('/api/admin/qr', auth, adminOnly, async (req, res) => {
  const text = String(req.query.text || '').trim();

  if (!text) {
    return res.status(400).json({ error: 'text is required' });
  }

  try {
    const dataUrl = await QRCode.toDataURL(text, {
      width: 280,
      margin: 1,
      color: {
        dark: '#0f2d52',
        light: '#FFFFFF',
      },
    });
    return res.json({ text, dataUrl });
  } catch (error) {
    return res.status(500).json({ error: 'Could not generate QR' });
  }
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Unauthorized'));
    }
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user;
    return next();
  } catch (error) {
    return next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  if (socket.user.role === 'admin') {
    socket.join('admins');
  }
  socket.join(`user:${socket.user.id}`);
});

app.get('/health', (_, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
