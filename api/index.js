import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const SESSION_COOKIE = 'chat_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;

function database() {
  if (!process.env.DATABASE_URL) throw new Error('Database is not configured.');
  return neon(process.env.DATABASE_URL);
}

function sessionSecret() {
  if (!process.env.SESSION_SECRET) throw new Error('Session security is not configured.');
  return process.env.SESSION_SECRET;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => {
        const index = value.indexOf('=');
        return index === -1
          ? [value, '']
          : [value.slice(0, index), decodeURIComponent(value.slice(index + 1))];
      })
  );
}

function signSession(userId) {
  const payload = Buffer.from(
    JSON.stringify({ userId, expiresAt: Date.now() + SESSION_SECONDS * 1000 })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function readSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = crypto
    .createHmac('sha256', sessionSecret())
    .update(payload)
    .digest('base64url');

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.userId || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function setSessionCookie(req, res, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
  );
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10000) throw new Error('Request is too large.');
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid request.');
  }
}

async function getUsers() {
  const sql = database();
  return sql`
    SELECT
      id,
      username,
      normalized_username AS "normalizedUsername",
      salt,
      password_hash AS "passwordHash",
      created_at AS "createdAt"
    FROM chat_users
    ORDER BY created_at ASC
  `;
}

async function getMessages() {
  const sql = database();
  return sql`
    SELECT
      id,
      sender_id AS "senderId",
      text,
      created_at AS "createdAt"
    FROM chat_messages
    ORDER BY created_at ASC
    LIMIT 200
  `;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return {
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString('hex')
  };
}

function verifyPassword(password, user) {
  const attempted = Buffer.from(hashPassword(password, user.salt).hash, 'hex');
  const saved = Buffer.from(user.passwordHash, 'hex');
  return attempted.length === saved.length && crypto.timingSafeEqual(attempted, saved);
}

async function currentUser(req) {
  const session = readSession(req);
  const users = await getUsers();
  if (!session) return { user: null, users };
  return { user: users.find(item => item.id === session.userId) || null, users };
}

async function signup(req, res) {
  const body = await readBody(req);
  const username = String(body.username || '').trim();
  const normalizedUsername = normalizeUsername(username);
  const password = String(body.password || '');

  if (!validateUsername(username)) {
    return send(res, 400, { error: 'Use 3–20 letters, numbers, or underscores.' });
  }

  if (password.length < 6 || password.length > 72) {
    return send(res, 400, { error: 'Password must be 6–72 characters.' });
  }

  const users = await getUsers();
  if (users.length >= 2) return send(res, 409, { error: 'Both accounts already exist.' });
  if (users.some(user => user.normalizedUsername === normalizedUsername)) {
    return send(res, 409, { error: 'That username is already taken.' });
  }

  const passwordData = hashPassword(password);
  const id = crypto.randomUUID();
  const sql = database();

  try {
    await sql`
      INSERT INTO chat_users (id, username, normalized_username, salt, password_hash)
      VALUES (${id}, ${username}, ${normalizedUsername}, ${passwordData.salt}, ${passwordData.hash})
    `;
  } catch (error) {
    if (error?.code === '23505') return send(res, 409, { error: 'That username is already taken.' });
    throw error;
  }

  setSessionCookie(req, res, signSession(id), SESSION_SECONDS);
  return send(res, 201, { user: { id, username } });
}

async function login(req, res) {
  const body = await readBody(req);
  const normalizedUsername = normalizeUsername(body.username);
  const password = String(body.password || '');
  const users = await getUsers();
  const user = users.find(item => item.normalizedUsername === normalizedUsername);

  if (!user || !verifyPassword(password, user)) {
    return send(res, 401, { error: 'Incorrect username or password.' });
  }

  setSessionCookie(req, res, signSession(user.id), SESSION_SECONDS);
  return send(res, 200, { user: { id: user.id, username: user.username } });
}

function logout(req, res) {
  setSessionCookie(req, res, '', 0);
  return send(res, 200, { ok: true });
}

async function session(req, res) {
  const { user, users } = await currentUser(req);

  if (!user) {
    return send(res, 200, {
      authenticated: false,
      signupAvailable: users.length < 2
    });
  }

  const partner = users.find(item => item.id !== user.id) || null;
  return send(res, 200, {
    authenticated: true,
    ready: Boolean(partner),
    user: { id: user.id, username: user.username },
    partner: partner ? { id: partner.id, username: partner.username } : null
  });
}

async function messages(req, res) {
  const { user, users } = await currentUser(req);
  if (!user) return send(res, 401, { error: 'Please sign in again.' });
  if (users.length < 2) return send(res, 409, { error: 'Waiting for the second account.' });

  if (req.method === 'GET') {
    return send(res, 200, { messages: await getMessages() });
  }

  const body = await readBody(req);
  const text = String(body.text || '').trim();
  if (!text) return send(res, 400, { error: 'Message cannot be empty.' });
  if (text.length > 500) return send(res, 400, { error: 'Message is too long.' });

  const id = crypto.randomUUID();
  const sql = database();
  const rows = await sql`
    INSERT INTO chat_messages (id, sender_id, text)
    VALUES (${id}, ${user.id}, ${text})
    RETURNING id, sender_id AS "senderId", text, created_at AS "createdAt"
  `;

  return send(res, 201, { message: rows[0] });
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/api/signup' && req.method === 'POST') return await signup(req, res);
    if (path === '/api/login' && req.method === 'POST') return await login(req, res);
    if (path === '/api/logout' && req.method === 'POST') return logout(req, res);
    if (path === '/api/session' && req.method === 'GET') return await session(req, res);
    if (path === '/api/messages' && ['GET', 'POST'].includes(req.method)) {
      return await messages(req, res);
    }
    if (path === '/api/health' && req.method === 'GET') {
      const sql = database();
      await sql`SELECT 1`;
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: 'Not found.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Server error.';
    const missingConfig = message.includes('not configured');
    return send(res, missingConfig ? 503 : 500, { error: message });
  }
}
