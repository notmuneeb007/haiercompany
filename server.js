/* ==========================================================================
   HAIRE — Contact form server
   Serves the static site, user auth (signup/login/logout),
   forwards booking form submissions to Brevo, saves to MongoDB.
   ========================================================================== */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { MongoClient, ObjectId } = require('mongodb');

dns.setServers(['8.8.8.8', '1.1.1.1']);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true
}));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'zurfaelac-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

let db;
let client;

async function connectDb() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'zurfaelac';

  if (!uri || uri.includes('USERNAME:PASSWORD')) {
    console.warn('MongoDB URI missing in .env — skipping database connection.');
    return;
  }

  const newClient = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await newClient.connect();
  client = newClient;
  db = client.db(dbName);
  console.log('MongoDB connected — database: ' + dbName);
}

function requireAuth(req, res, next) {
  if (req.session && (req.session.user || req.session.isAdmin)) return next();
  return res.redirect('/login.html');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin.html');
}

function requireAdminApi(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ success: false, message: 'Admin access required.' });
}

function requireAuthApi(req, res, next) {
  if (req.session && (req.session.user || req.session.isAdmin)) return next();
  return res.status(401).json({ success: false, message: 'Please login to book a service.' });
}

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', requireAdmin, function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailHtml(data) {
  const rows = [
    ['Full Name', data.name],
    ['Phone Number', data.phone],
    ['Email', data.email],
    ['Service Type', data.serviceType],
    ['Preferred Date', data.date],
    ['Preferred Time', data.time],
    ['Address', data.address],
    ['Message', data.message || '—']
  ];

  const items = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:bold;color:#0b5cd8;width:180px;vertical-align:top">${label}</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(value)}</td></tr>`
    )
    .join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e3e8ef;border-radius:10px;overflow:hidden">
      <div style="background:#0b5cd8;color:#fff;padding:18px 24px">
        <h2 style="margin:0;font-size:20px">New Service Booking Request</h2>
      </div>
      <table style="width:100%;border-collapse:collapse;color:#333">
        ${items}
      </table>
      <p style="padding:16px 24px;margin:0;color:#888;font-size:12px">Sent from the Zurfael AC website contact form.</p>
    </div>`;
}

async function sendEmail(subject, htmlContent, toEmail) {
  const recipient = toEmail || process.env.CONTACT_RECIPIENT_EMAIL;

  const payload = {
    sender: {
      name: process.env.BREVO_SENDER_NAME || 'Zurfael AC',
      email: process.env.BREVO_SENDER_EMAIL
    },
    to: [
      {
        name: recipient,
        email: recipient
      }
    ],
    subject: subject,
    htmlContent: htmlContent
  };

  const response = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(`Brevo API ${response.status}: ${responseBody}`);
  }

  console.log('Brevo accepted email:', subject);
  return JSON.parse(responseBody);
}

async function sendBrevoEmail(data) {
  return sendEmail(
    `New Booking: ${data.serviceType || 'Service request'} from ${data.name}`,
    buildEmailHtml(data)
  );
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/* ---------- Auth routes ---------- */

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function buildCodeEmailHtml(name, code, minutes) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e3e8ef;border-radius:10px;overflow:hidden">
      <div style="background:#0b5cd8;color:#fff;padding:18px 24px">
        <h2 style="margin:0;font-size:20px">Your Security Code</h2>
      </div>
      <div style="padding:24px;color:#333">
        <p style="margin:0 0 8px">Hi ${escapeHtml(name)},</p>
        <p style="margin:0 0 16px">Use this code to complete your Zurfael AC account signup:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#0b5cd8;background:#f1f5fb;border-radius:10px;padding:16px;text-align:center">${code}</div>
        <p style="margin:16px 0 0;color:#888;font-size:13px">This code is valid for ${minutes} minutes. If you did not request this, ignore this email.</p>
      </div>
    </div>`;
}

app.post('/api/register', async function (req, res) {
  const { name, email, password } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, message: 'Name is required.' });
  }
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
  }
  if (!db) {
    return res.status(503).json({ success: false, message: 'Database not available.' });
  }

  const emailKey = String(email).trim().toLowerCase();

  const existing = await db.collection('users').findOne({ email: emailKey });
  if (existing) {
    return res.status(409).json({ success: false, message: 'This email is already registered. Please login.' });
  }

  const hash = await bcrypt.hash(String(password), 10);
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.collection('pending_users').updateOne(
    { email: emailKey },
    {
      $set: {
        name: String(name).trim(),
        email: emailKey,
        password: hash,
        passwordPlain: String(password),
        code: code,
        expiresAt: expiresAt,
        createdAt: new Date()
      }
    },
    { upsert: true }
  );

  try {
    await sendEmail(
      'Your Zurfael AC verification code',
      buildCodeEmailHtml(String(name).trim(), code, 10),
      emailKey
    );
  } catch (err) {
    console.error('Verification email failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not send the security code. Please try again.' });
  }

  res.json({ success: true, message: 'A security code has been sent to your email.' });
});

app.post('/api/verify', async function (req, res) {
  const { email, code } = req.body || {};

  if (!email || !code) {
    return res.status(400).json({ success: false, message: 'Email and code are required.' });
  }
  if (!db) {
    return res.status(503).json({ success: false, message: 'Database not available.' });
  }

  const emailKey = String(email).trim().toLowerCase();
  const pending = await db.collection('pending_users').findOne({ email: emailKey });

  if (!pending) {
    return res.status(404).json({ success: false, message: 'No signup found for this email. Please register again.' });
  }
  if (new Date(pending.expiresAt) < new Date()) {
    return res.status(400).json({ success: false, message: 'This code has expired. Please request a new one.' });
  }
  if (String(pending.code) !== String(code).trim()) {
    return res.status(401).json({ success: false, message: 'Incorrect code. Please check and try again.' });
  }

  await db.collection('users').insertOne({
    name: pending.name,
    email: pending.email,
    password: pending.password,
    passwordPlain: pending.passwordPlain || '',
    verified: true,
    createdAt: new Date()
  });
  await db.collection('pending_users').deleteOne({ email: emailKey });

  req.session.user = { name: pending.name, email: pending.email };
  res.json({ success: true, message: 'Account verified successfully.' });
});

app.post('/api/resend-code', async function (req, res) {
  const { email } = req.body || {};

  if (!email || !db) {
    return res.status(400).json({ success: false, message: 'Email is required.' });
  }

  const emailKey = String(email).trim().toLowerCase();
  const pending = await db.collection('pending_users').findOne({ email: emailKey });

  if (!pending) {
    return res.status(404).json({ success: false, message: 'No signup found for this email. Please register again.' });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.collection('pending_users').updateOne({ email: emailKey }, { $set: { code: code, expiresAt: expiresAt } });

  try {
    await sendEmail('Your Zurfael AC verification code', buildCodeEmailHtml(pending.name, code, 10), emailKey);
  } catch (err) {
    console.error('Verification email failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not send the security code. Please try again.' });
  }

  res.json({ success: true, message: 'A new security code has been sent.' });
});

app.post('/api/login', async function (req, res) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }
  if (!db) {
    return res.status(503).json({ success: false, message: 'Database not available.' });
  }

  const user = await db.collection('users').findOne({ email: String(email).trim().toLowerCase() });
  if (!user || !(await bcrypt.compare(String(password), user.password))) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  req.session.user = { name: user.name, email: user.email };
  res.json({ success: true, message: 'Logged in successfully.' });
});

app.post('/api/logout', function (req, res) {
  req.session.destroy(function () {
    res.json({ success: true });
  });
});

/* ---------- Admin routes ---------- */

app.post('/api/admin/login', function (req, res) {
  const { email, password } = req.body || {};
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPass = process.env.ADMIN_PASS || '';

  if (!email || !password || String(email).trim().toLowerCase() !== adminEmail || String(password) !== adminPass) {
    return res.status(401).json({ success: false, message: 'Invalid admin email or password.' });
  }

  req.session.isAdmin = true;
  req.session.user = { name: 'Admin', email: adminEmail };
  res.json({ success: true });
});

app.post('/api/admin/logout', function (req, res) {
  req.session.isAdmin = false;
  req.session.destroy(function () {
    res.json({ success: true });
  });
});

app.get('/api/admin/me', function (req, res) {
  if (req.session && req.session.isAdmin) return res.json({ admin: true });
  res.status(401).json({ admin: false });
});

app.get('/api/admin/bookings', requireAdminApi, async function (req, res) {
  if (!db) return res.status(503).json({ success: false, message: 'Database not available.' });
  const bookings = await db.collection('bookings').find().sort({ submittedAt: -1 }).limit(200).toArray();
  res.json(bookings);
});

app.delete('/api/admin/bookings/:id', requireAdminApi, async function (req, res) {
  if (!db) return res.status(503).json({ success: false, message: 'Database not available.' });
  try {
    const result = await db.collection('bookings').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: result.deletedCount > 0 });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Invalid booking id.' });
  }
});

app.put('/api/admin/bookings/:id', requireAdminApi, async function (req, res) {
  if (!db) return res.status(503).json({ success: false, message: 'Database not available.' });
  const fields = ['name', 'email', 'phone', 'serviceType', 'date', 'time', 'address', 'message'];
  const $set = {};
  for (const f of fields) {
    if (req.body && req.body[f] !== undefined) $set[f] = String(req.body[f]).trim();
  }
  if (!Object.keys($set).length) return res.status(400).json({ success: false, message: 'Nothing to update.' });
  try {
    const result = await db.collection('bookings').updateOne({ _id: new ObjectId(req.params.id) }, { $set });
    res.json({ success: result.matchedCount > 0 });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Invalid booking id.' });
  }
});

app.get('/api/admin/users', requireAdminApi, async function (req, res) {
  if (!db) return res.status(503).json({ success: false, message: 'Database not available.' });
  const users = await db.collection('users').find({}, { projection: { name: 1, email: 1, passwordPlain: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(200).toArray();
  res.json(users);
});

app.delete('/api/admin/users/:id', requireAdminApi, async function (req, res) {
  if (!db) return res.status(503).json({ success: false, message: 'Database not available.' });
  try {
    const result = await db.collection('users').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: result.deletedCount > 0 });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Invalid user id.' });
  }
});

app.put('/api/admin/users/:id', requireAdminApi, async function (req, res) {
  if (!db) return res.status(503).json({ success: false, message: 'Database not available.' });
  try {
    const id = new ObjectId(req.params.id);
    const $set = {};
    if (req.body && req.body.name !== undefined) $set.name = String(req.body.name).trim();
    if (req.body && req.body.email !== undefined) {
      const emailKey = String(req.body.email).trim().toLowerCase();
      const dup = await db.collection('users').findOne({ email: emailKey, _id: { $ne: id } });
      if (dup) return res.status(409).json({ success: false, message: 'This email is already used by another user.' });
      $set.email = emailKey;
    }
    if (req.body && req.body.password && String(req.body.password).length >= 6) {
      $set.password = await bcrypt.hash(String(req.body.password), 10);
      $set.passwordPlain = String(req.body.password);
    }
    if (!Object.keys($set).length) return res.status(400).json({ success: false, message: 'Nothing to update.' });
    const result = await db.collection('users').updateOne({ _id: id }, { $set });
    res.json({ success: result.matchedCount > 0 });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Invalid user id.' });
  }
});

app.get('/api/me', function (req, res) {
  if (req.session && req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ user: null });
  }
});

app.post('/api/contact', requireAuthApi, async function (req, res) {
  const data = req.body || {};

  const required = ['name', 'phone', 'email', 'serviceType', 'date', 'time', 'address'];
  const missing = required.filter(function (field) {
    return !String(data[field] || '').trim();
  });

  if (missing.length) {
    return res.status(400).json({ success: false, message: 'Missing fields: ' + missing.join(', ') });
  }

  const booking = {
    name: data.name,
    phone: data.phone,
    email: data.email,
    serviceType: data.serviceType,
    date: data.date,
    time: data.time,
    address: data.address,
    message: data.message || '',
    submittedAt: new Date()
  };

  if (db) {
    try {
      const result = await db.collection('bookings').insertOne(booking);
      console.log('Booking saved to MongoDB with _id:', result.insertedId);
    } catch (err) {
      console.error('MongoDB save failed:', err.message);
    }
  }

  try {
    await sendBrevoEmail(data);
    res.json({ success: true, message: 'Booking request sent successfully.' });
  } catch (err) {
    console.error('Brevo send failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to send. Please try again or call us.' });
  }
});

connectDb()
  .catch(function (err) {
    console.error('MongoDB connection failed:', err.message);
  })
  .finally(function () {
    app.listen(PORT, function () {
      console.log('Zurfael AC server running at http://localhost:' + PORT);
    });
  });
