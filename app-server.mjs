import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash as cryptoCreateHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const storeDir = process.env.VERCEL ? join('/tmp', 'meetspace-data') : join(root, 'data');
const storeFile = join(storeDir, 'meetspace.json');
mkdirSync(storeDir, { recursive: true });
let db = existsSync(storeFile) ? JSON.parse(readFileSync(storeFile, 'utf8')) : { users: [], meetings: [] };
db.users ||= []; db.meetings ||= [];
const save = () => writeFileSync(storeFile, JSON.stringify({ users: db.users, meetings: db.meetings }, null, 2));
const sessions = new Map();
const rooms = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, value, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(value)); };
function readBody(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
function cookie(req, name) { return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1); }
function currentUser(req) { const uid = sessions.get(cookie(req, 'meetspace_session')); return db.users.find(u => u.id === uid); }
function safeUser(u) { return { id: u.id, name: u.name, email: u.email, createdAt: u.createdAt || null, avatar: u.avatar || null }; }
function requireUser(req, res) { const user = currentUser(req); if (!user) json(res, 401, { error: 'Please sign in to continue.' }); return user; }
function makeSession(res, user) { const token = randomBytes(32).toString('hex'); sessions.set(token, user.id); setCookie(res, 'meetspace_session', token, 2592000); }
function slug() { return randomBytes(4).toString('hex').toUpperCase(); }
function cleanMeeting(m) { return { id: m.id, code: m.code, title: m.title, host: m.host, hostId: m.hostId, createdAt: m.createdAt, scheduledAt: m.scheduledAt || null, participants: m.participants || [] }; }
function setCookie(res, name, value, maxAge = 600) { res.appendHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
function baseUrl(req) { return process.env.BASE_URL || `http://${req.headers.host}`; }
function providerConfig(provider) {
  if (provider === 'microsoft') return { id: process.env.MICROSOFT_CLIENT_ID, secret: process.env.MICROSOFT_CLIENT_SECRET, issuerBase: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID || 'common'}/v2.0`, scopes: 'openid profile email' };
  if (provider === 'apple') return { id: process.env.APPLE_CLIENT_ID, secret: process.env.APPLE_CLIENT_SECRET, issuerBase: 'https://appleid.apple.com', scopes: 'openid email' };
}
function providerError(res, key) { return res.writeHead(302, { Location: `/?auth_error=${key}` }).end(); }
async function oidcStart(req, res, provider) {
  const cfg = providerConfig(provider); if (!cfg?.id || !cfg.secret) return providerError(res, `${provider}_not_configured`);
  const metadataRes = await fetch(`${cfg.issuerBase}/.well-known/openid-configuration`); if (!metadataRes.ok) return providerError(res, `${provider}_failed`); const metadata = await metadataRes.json();
  const state = randomBytes(24).toString('hex'), nonce = randomBytes(24).toString('hex'); setCookie(res, `meetspace_${provider}_state`, state); setCookie(res, `meetspace_${provider}_nonce`, nonce);
  const callback = new URL(`/auth/${provider}/callback`, baseUrl(req)); const auth = new URL(metadata.authorization_endpoint);
  auth.search = new URLSearchParams({ client_id: cfg.id, redirect_uri: callback.href, response_type: 'code', response_mode: 'query', scope: cfg.scopes, state, nonce, ...(provider === 'microsoft' ? { prompt: 'select_account' } : {}) }).toString();
  return res.writeHead(302, { Location: auth.href }).end();
}
async function verifyOidcToken(token, cfg, nonce) {
  const parts = token.split('.'); if (parts.length !== 3) throw new Error('Invalid identity token'); const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (!['RS256', 'ES256'].includes(header.alg) || !header.kid || claims.nonce !== nonce || !(Number(claims.exp) > Date.now() / 1000) || !claims.sub || !claims.iss || !claims.aud) throw new Error('Invalid identity token claims');
  if (claims.aud !== cfg.id && !(Array.isArray(claims.aud) && claims.aud.includes(cfg.id))) throw new Error('Invalid token audience');
  const discovery = await (await fetch(`${cfg.issuerBase}/.well-known/openid-configuration`)).json(); const expectedIssuer = discovery.issuer.includes('{tenantid}') && claims.tid ? discovery.issuer.replace('{tenantid}', claims.tid) : discovery.issuer; if (claims.iss !== expectedIssuer) throw new Error('Invalid token issuer');
  const jwks = await (await fetch(discovery.jwks_uri)).json(); const jwk = jwks.keys?.find(k => k.kid === header.kid); if (!jwk) throw new Error('Signing key not found');
  const key = createPublicKey({ key: jwk, format: 'jwk' }); const input = Buffer.from(`${parts[0]}.${parts[1]}`); const signature = Buffer.from(parts[2], 'base64url');
  const valid = header.alg === 'ES256' ? cryptoVerify('sha256', input, { key, dsaEncoding: 'ieee-p1363' }, signature) : cryptoVerify('RSA-SHA256', input, key, signature); if (!valid) throw new Error('Invalid token signature'); return claims;
}
function saveProviderUser(claims, provider) {
  const subKey = `${provider}Sub`, email = String(claims.email || claims.preferred_username || '').toLowerCase(), emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  if (!email || !claims.sub) throw new Error('The provider did not return an email address.');
  let user = db.users.find(u => u[subKey] === claims.sub);
  if (!user) { user = db.users.find(u => u.email === email); if (user && !emailVerified) throw new Error('This email already has an account. Sign in with that account first.'); }
  if (!user) { user = { id: randomBytes(12).toString('hex'), name: claims.name || claims.given_name || email.split('@')[0], email, createdAt: new Date().toISOString() }; db.users.push(user); }
  user[subKey] = claims.sub; user.email = email; if (claims.name || claims.given_name) user.name = claims.name || `${claims.given_name} ${claims.family_name || ''}`.trim(); save(); return user;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && url.pathname === '/api/auth/signup') {
      const { name, email, password } = await readBody(req);
      if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || (password || '').length < 8) return json(res, 400, { error: 'Enter your name, a valid email, and a password with at least 8 characters.' });
      if (db.users.some(u => u.email === email.toLowerCase())) return json(res, 409, { error: 'An account with this email already exists.' });
      const salt = randomBytes(16).toString('hex'); const user = { id: randomBytes(12).toString('hex'), name: name.trim(), email: email.toLowerCase(), salt, hash: scryptSync(password, salt, 64).toString('hex'), createdAt: new Date().toISOString() };
      db.users.push(user); makeSession(res, user); return json(res, 201, { user: safeUser(user) });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const { email, password } = await readBody(req); const user = db.users.find(u => u.email === (email || '').toLowerCase());
      if (!user || !user.hash || !timingSafeEqual(Buffer.from(user.hash, 'hex'), scryptSync(password || '', user.salt, 64))) return json(res, 401, { error: 'Email or password is incorrect.' });
      makeSession(res, user); return json(res, 200, { user: safeUser(user) });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') { const token = cookie(req, 'meetspace_session'); sessions.delete(token); res.setHeader('Set-Cookie', 'meetspace_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
    const oidcStartMatch = url.pathname.match(/^\/auth\/(microsoft|apple)$/);
    if (req.method === 'GET' && oidcStartMatch) return await oidcStart(req, res, oidcStartMatch[1]);
    const oidcCallbackMatch = url.pathname.match(/^\/auth\/(microsoft|apple)\/callback$/);
    if (req.method === 'GET' && oidcCallbackMatch) {
      const provider = oidcCallbackMatch[1], cfg = providerConfig(provider), stateCookie = decodeURIComponent(cookie(req, `meetspace_${provider}_state`) || ''), nonce = decodeURIComponent(cookie(req, `meetspace_${provider}_nonce`) || '');
      setCookie(res, `meetspace_${provider}_state`, '', 0); setCookie(res, `meetspace_${provider}_nonce`, '', 0);
      if (!cfg?.id || !cfg.secret) return providerError(res, `${provider}_not_configured`);
      if (url.searchParams.has('error') || !url.searchParams.get('code') || !stateCookie || stateCookie !== url.searchParams.get('state')) return providerError(res, `${provider}_cancelled`);
      const discovery = await (await fetch(`${cfg.issuerBase}/.well-known/openid-configuration`)).json(); const callback = new URL(`/auth/${provider}/callback`, baseUrl(req));
      const tokenRes = await fetch(discovery.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: cfg.id, client_secret: cfg.secret, redirect_uri: callback.href, grant_type: 'authorization_code' }) });
      const tokens = await tokenRes.json(); if (!tokenRes.ok || !tokens.id_token) return providerError(res, `${provider}_failed`);
      const claims = await verifyOidcToken(tokens.id_token, cfg, nonce); const user = saveProviderUser(claims, provider); makeSession(res, user); return res.writeHead(302, { Location: '/' }).end();
    }
    if (req.method === 'GET' && url.pathname === '/auth/google') {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.writeHead(302, { Location: '/?auth_error=google_not_configured' }).end();
      const state = randomBytes(24).toString('hex'), nonce = randomBytes(24).toString('hex');
      setCookie(res, 'meetspace_oauth_state', state); setCookie(res, 'meetspace_oauth_nonce', nonce);
      const callback = new URL('/auth/google/callback', baseUrl(req));
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: callback.href, response_type: 'code', scope: 'openid email profile', state, nonce, prompt: 'select_account' }).toString();
      return res.writeHead(302, { Location: auth.href }).end();
    }
    if (req.method === 'GET' && url.pathname === '/auth/google/callback') {
      const stateCookie = decodeURIComponent(cookie(req, 'meetspace_oauth_state') || ''), nonceCookie = decodeURIComponent(cookie(req, 'meetspace_oauth_nonce') || '');
      setCookie(res, 'meetspace_oauth_state', '', 0); setCookie(res, 'meetspace_oauth_nonce', '', 0);
      if (url.searchParams.get('error') || !url.searchParams.get('code') || !stateCookie || stateCookie !== url.searchParams.get('state')) return res.writeHead(302, { Location: '/?auth_error=google_cancelled' }).end();
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.writeHead(302, { Location: '/?auth_error=google_not_configured' }).end();
      const callback = new URL('/auth/google/callback', baseUrl(req));
      const tokensRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: callback.href, grant_type: 'authorization_code' }) });
      const tokens = await tokensRes.json(); if (!tokensRes.ok || !tokens.id_token) return res.writeHead(302, { Location: '/?auth_error=google_failed' }).end();
      const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`); const claims = await verifyRes.json();
      if (!verifyRes.ok || claims.aud !== process.env.GOOGLE_CLIENT_ID || claims.nonce !== nonceCookie || !(claims.email_verified === true || claims.email_verified === 'true') || !claims.sub || !claims.email) return res.writeHead(302, { Location: '/?auth_error=google_failed' }).end();
      try { const user = saveProviderUser({ ...claims, email_verified: claims.email_verified }, 'google'); makeSession(res, user); return res.writeHead(302, { Location: '/' }).end(); }
      catch { return providerError(res, 'google_failed'); }
    }
    if (req.method === 'GET' && url.pathname === '/api/me') { const user = currentUser(req); return user ? json(res, 200, { user: safeUser(user) }) : json(res, 401, { error: 'Not signed in.' }); }
    if (req.method === 'PATCH' && url.pathname === '/api/me') { const user = requireUser(req, res); if (!user) return; const body = await readBody(req), name = String(body.name || '').trim().replace(/\s+/g, ' '); if (name.length < 2 || name.length > 60) return json(res, 400, { error: 'Name must be between 2 and 60 characters.' }); if (body.avatar !== undefined && body.avatar !== null) { const avatar = String(body.avatar); if (!/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar) || Buffer.byteLength(avatar, 'utf8') > 950000) return json(res, 400, { error: 'Choose a smaller JPG, PNG or WebP photo.' }); user.avatar = avatar; } else if (body.avatar === null) delete user.avatar; user.name = name; for (const meeting of db.meetings) { if (meeting.hostId === user.id) meeting.host = name; for (const participant of meeting.participants || []) if (participant.userId === user.id) participant.name = name; } save(); return json(res, 200, { user: safeUser(user) }); }
    if (req.method === 'GET' && url.pathname === '/api/meetings') { const user = requireUser(req, res); if (!user) return; return json(res, 200, { meetings: db.meetings.filter(m => m.hostId === user.id || (m.participants || []).some(p => p.userId === user.id)).map(cleanMeeting) }); }
    if (req.method === 'POST' && url.pathname === '/api/meetings') {
      const user = requireUser(req, res); if (!user) return; const body = await readBody(req); let code; do { code = slug(); } while (db.meetings.some(m => m.code === code));
      const meeting = { id: randomBytes(12).toString('hex'), code, title: String(body.title || 'Instant meeting').slice(0, 100), host: user.name, hostId: user.id, createdAt: new Date().toISOString(), scheduledAt: body.scheduledAt || null, participants: [], chat: [] }; db.meetings.unshift(meeting); save(); return json(res, 201, { meeting: cleanMeeting(meeting) });
    }
    const joinMatch = url.pathname.match(/^\/api\/meetings\/([A-Z0-9]+)\/join$/i);
    if (req.method === 'POST' && joinMatch) { const user = requireUser(req, res); if (!user) return; const meeting = db.meetings.find(m => m.code === joinMatch[1].toUpperCase()); if (!meeting) return json(res, 404, { error: 'Meeting not found. Check the code and try again.' }); if (!meeting.participants.some(p => p.userId === user.id)) meeting.participants.push({ userId: user.id, name: user.name, joinedAt: new Date().toISOString() }); save(); return json(res, 200, { meeting: cleanMeeting(meeting), user: safeUser(user) }); }
    const getMatch = url.pathname.match(/^\/api\/meetings\/([A-Z0-9]+)$/i);
    if (req.method === 'GET' && getMatch) { const user = requireUser(req, res); if (!user) return; const meeting = db.meetings.find(m => m.code === getMatch[1].toUpperCase()); return meeting ? json(res, 200, { meeting: cleanMeeting(meeting) }) : json(res, 404, { error: 'Meeting not found.' }); }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
    let path = decodeURIComponent(url.pathname); if (path === '/') path = '/index.html'; if (!['/index.html', '/client.js'].includes(path)) return json(res, 404, { error: 'Not found.' }); const file = join(root, path.replace(/^\/+/, '')); if (!existsSync(file)) return json(res, 404, { error: 'Not found.' }); res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(res);
  } catch (e) { console.error(e); if (!res.headersSent) json(res, 500, { error: 'Something went wrong. Please try again.' }); }
});

// Minimal RFC6455 server for WebRTC signaling. Media stays peer-to-peer in browsers.
function wsFrame(data) { const b = Buffer.from(JSON.stringify(data)); if (b.length < 126) return Buffer.concat([Buffer.from([0x81, b.length]), b]); if (b.length < 65536) { const h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(b.length, 2); return Buffer.concat([h, b]); } const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(b.length), 2); return Buffer.concat([h, b]); }
function send(client, data) { if (!client.dead) client.socket.write(wsFrame(data)); }
function broadcast(room, data, except) { for (const c of room.clients) if (c !== except) send(c, data); }
function people(room, except) { return [...room.clients].filter(c => c !== except && !c.dead).map(c => ({ id: c.user.id, name: c.user.name })); }
function roomState(client) { send(client, { type: 'participants', participants: people(client.room, client) }); send(client, { type: 'chat-history', items: (client.room.meeting.chat || []).slice(-100) }); }
function lobbyState(room) { const waiting = [...room.waiting].filter(c => !c.dead).map(c => ({ id: c.user.id, name: c.user.name })); for (const c of room.clients) if (c.host) send(c, { type: 'lobby-update', waiting }); }
function detach(client) { const { room, user } = client; if (client.dead) return; client.dead = true; const wasActive = room.clients.delete(client); room.waiting.delete(client); if (wasActive) broadcast(room, { type: 'peer-left', id: user.id }); lobbyState(room); if (!room.clients.size && !room.waiting.size) rooms.delete(room.meeting.code); }
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost'); if (url.pathname !== '/signal' || !req.headers['sec-websocket-key']) return socket.destroy();
  const token = cookie(req, 'meetspace_session'), uid = sessions.get(token), user = db.users.find(u => u.id === uid), code = (url.searchParams.get('room') || '').toUpperCase();
  const meeting = db.meetings.find(m => m.code === code); if (!user || !meeting) return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
  const accept = cryptoCreateHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64'); socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let room = rooms.get(code); if (!room) { room = { clients: new Set(), waiting: new Set(), meeting }; rooms.set(code, room); }
  const client = { socket, user, room, host: user.id === meeting.hostId, dead: false, buffer: Buffer.alloc(0) };
  if (client.host) { room.clients.add(client); send(client, { type: 'room-status', role: 'host' }); roomState(client); lobbyState(room); }
  else { room.waiting.add(client); send(client, { type: 'waiting', message: 'Waiting for the host to let you in.' }); lobbyState(room); }
  const leave = () => detach(client); socket.on('close', leave); socket.on('error', leave);
  socket.on('data', chunk => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      let len = client.buffer[1] & 127, offset = 2;
      if (len === 126) { if (client.buffer.length < 4) return; len = client.buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (client.buffer.length < 10) return; len = Number(client.buffer.readBigUInt64BE(2)); offset = 10; }
      const masked = (client.buffer[1] & 128) !== 0; if (masked) offset += 4; if (len > 1_000_000) return socket.destroy(); if (client.buffer.length < offset + len) return;
      let payload = Buffer.from(client.buffer.subarray(offset, offset + len));
      if (masked) { const mask = client.buffer.subarray(offset - 4, offset); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; }
      const opcode = client.buffer[0] & 15; client.buffer = client.buffer.subarray(offset + len);
      if (opcode === 8) { socket.end(); leave(); return; } if (opcode !== 1) continue;
      try {
        const msg = JSON.parse(payload.toString());
        if (msg.type === 'signal' && client.room.clients.has(client) && typeof msg.to === 'string') { const recipient = [...room.clients].find(c => c.user.id === msg.to); if (recipient) send(recipient, { type: 'signal', from: user.id, name: user.name, data: msg.data }); }
        else if (msg.type === 'chat' && room.clients.has(client)) { const text = String(msg.text || '').trim().slice(0, 1000); if (!text) continue; const item = { id: randomBytes(8).toString('hex'), userId: user.id, name: user.name, text, at: new Date().toISOString() }; meeting.chat ||= []; meeting.chat.push(item); meeting.chat = meeting.chat.slice(-500); save(); broadcast(room, { type: 'chat-message', item }); }
        else if (msg.type === 'host-action' && client.host) {
          const target = [...room.waiting, ...room.clients].find(c => c.user.id === msg.target && c !== client); if (!target) continue;
          if (msg.action === 'admit' && room.waiting.has(target)) { room.waiting.delete(target); room.clients.add(target); send(target, { type: 'admitted' }); roomState(target); broadcast(room, { type: 'peer-joined', id: target.user.id, name: target.user.name }, target); lobbyState(room); }
          else if (msg.action === 'deny' && room.waiting.has(target)) { send(target, { type: 'denied' }); room.waiting.delete(target); target.socket.end(); lobbyState(room); }
          else if (msg.action === 'remove' && room.clients.has(target)) { send(target, { type: 'removed' }); room.clients.delete(target); target.socket.end(); broadcast(room, { type: 'peer-left', id: target.user.id }); }
          else if (msg.action === 'mute' && room.clients.has(target)) send(target, { type: msg.muted ? 'host-mute' : 'host-unmute', by: user.name });
        }
      } catch { }
    }
  });
});
const port = Number(process.env.PORT || 3000); const host = process.env.HOST || (process.env.VERCEL ? '0.0.0.0' : '127.0.0.1'); server.listen(port, host, () => console.log(`Meetspace is running at http://localhost:${port}`));
