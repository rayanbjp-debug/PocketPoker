'use strict';
// HTTP (static files) + WebSocket (game) server for PocketPoker.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Party } = require('./party');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(PUBLIC, url));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const parties = new Map();

function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!parties.has(c)) return c;
  }
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function makeParty() {
  const party = new Party(newCode());
  party.notify = (p, msg) => {
    const ws = p.conn;
    send(ws, msg);
    if (msg.t === 'kicked' || msg.t === 'left') {
      if (ws) { ws.ctx.party = null; ws.ctx.pid = null; }
      p.conn = null; // stop sending state to someone who is no longer at the table
      p.connected = false;
      p.disconnectedAt = Date.now();
    }
  };
  let queued = false;
  party.onChange = () => {
    if (queued) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      for (const p of party.players.values()) if (p.conn) send(p.conn, { t: 'state', s: party.view(p.id) });
    });
  };
  parties.set(party.code, party);
  return party;
}

function attach(ws, party, p) {
  if (p.conn && p.conn !== ws) {
    p.conn.ctx.party = null;
    p.conn.ctx.pid = null;
    try { p.conn.close(); } catch { /* already closed */ }
  }
  p.conn = ws;
  ws.ctx.party = party;
  ws.ctx.pid = p.id;
}

function handle(ws, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.t !== 'string') return;
  const ctx = ws.ctx;
  const fail = (msg) => send(ws, { t: 'error', msg });

  if (m.t === 'create' || m.t === 'join' || m.t === 'resume') {
    const token = typeof m.token === 'string' ? m.token.slice(0, 80) : '';
    if (token.length < 8) return fail('Bad session. Reload the page.');
    if (m.t === 'create') {
      if (ctx.party) return;
      const party = makeParty();
      const r = party.addPlayer(m.name, token);
      if (r.error) { parties.delete(party.code); return fail(r.error); }
      attach(ws, party, r.player);
      send(ws, { t: 'joined', code: party.code });
      party.emit();
      return;
    }
    const party = parties.get(String(m.code || '').toUpperCase().trim());
    if (!party) return send(ws, { t: m.t === 'resume' ? 'gone' : 'error', msg: 'No party with that code.' });
    let p = party.byToken.get(token);
    if (p) {
      attach(ws, party, p);
      party.reconnect(p);
      send(ws, { t: 'joined', code: party.code });
      return;
    }
    if (m.t === 'resume') return send(ws, { t: 'gone' });
    const r = party.addPlayer(m.name, token);
    if (r.error) return fail(r.error);
    attach(ws, party, r.player);
    send(ws, { t: 'joined', code: party.code });
    party.emit();
    return;
  }

  const party = ctx.party;
  if (!party) return;
  const pid = ctx.pid;
  let err = null;
  switch (m.t) {
    case 'settings': err = party.setSettings(pid, m.settings); break;
    case 'start': err = party.start(pid); break;
    case 'newgame': err = party.newGame(pid); break;
    case 'action': err = party.act(pid, m.action, m.amount); if (!err) { /* state broadcast by engine */ } break;
    case 'chat': err = party.chatSend(pid, m.text); break;
    case 'kick': err = party.kick(pid, m.id); break;
    case 'mute': err = party.mute(pid, m.id, m.muted); break;
    case 'rebuy': err = party.rebuy(pid); break;
    case 'pause': err = party.pauseChoice(pid, m.choice); break;
    case 'leave': {
      const p = party.players.get(pid);
      ctx.party = null; ctx.pid = null;
      if (p) { p.conn = null; party.removePlayer(pid); }
      send(ws, { t: 'left' });
      break;
    }
    default: break;
  }
  if (err) fail(err);
}

wss.on('connection', (ws) => {
  ws.ctx = { party: null, pid: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => { try { handle(ws, raw.toString()); } catch (e) { console.error('handler error', e); } });
  ws.on('close', () => {
    const { party, pid } = ws.ctx;
    if (!party) return;
    const p = party.players.get(pid);
    if (p && p.conn === ws) party.disconnect(p);
  });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 20000);

setInterval(() => {
  const now = Date.now();
  for (const [code, party] of parties) {
    try { party.tick(); } catch (e) { console.error('tick error', e); }
    if (party.isEmpty() || (!party.hasConnected() && now - party.lastActive > 2 * 3600e3)) parties.delete(code);
  }
}, 500);

server.listen(PORT, () => console.log(`PocketPoker running on http://localhost:${PORT}`));

module.exports = { server, parties };
