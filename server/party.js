'use strict';
// PocketPoker party + game engine. Pure logic: no sockets in here, so it can be tested with a fake clock.
const crypto = require('crypto');
const { newDeck, shuffle, bestHand } = require('./cards');
const { buildPots, distribute } = require('./pots');

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;

const DEFAULTS = Object.freeze({
  startingChips: 1000,
  blindIncreasePct: 50,
  blindInterval: 5, // hands between blind increases
  turnSeconds: 30,
  lengthMode: 'hands', // 'hands' | 'time'
  lengthHands: 30,
  lengthMinutes: 30,
  rebuyAmount: 1000,
  rebuyLimit: 1,
});

function clampInt(v, lo, hi, d) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v)) return d;
  return Math.min(hi, Math.max(lo, v));
}

function cleanSettings(i, base) {
  i = i || {};
  return {
    startingChips: clampInt(i.startingChips, 100, 1000000, base.startingChips),
    blindIncreasePct: clampInt(i.blindIncreasePct, 10, 200, base.blindIncreasePct),
    blindInterval: clampInt(i.blindInterval, 1, 50, base.blindInterval),
    turnSeconds: clampInt(i.turnSeconds, 5, 120, base.turnSeconds),
    lengthMode: i.lengthMode === 'time' ? 'time' : 'hands',
    lengthHands: clampInt(i.lengthHands, 1, 1000, base.lengthHands),
    lengthMinutes: clampInt(i.lengthMinutes, 1, 600, base.lengthMinutes),
    rebuyAmount: clampInt(i.rebuyAmount, 10, 1000000, base.rebuyAmount),
    rebuyLimit: clampInt(i.rebuyLimit, 0, 20, base.rebuyLimit),
  };
}

// Standard structure: big blind = 1% of the starting stack, small blind = half of it.
function startingBB(chips) {
  let bb = Math.max(2, Math.round(chips * 0.01));
  if (bb % 2) bb += 1;
  return bb;
}

function nextBB(bb, pct) {
  let n = Math.round(bb * (1 + pct / 100));
  if (n >= 1000) n = Math.round(n / 100) * 100;
  else if (n >= 100) n = Math.round(n / 10) * 10;
  if (n % 2) n += 1;
  if (n <= bb) n = bb + 2;
  return n;
}

function cleanName(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
}

const rid = () => crypto.randomBytes(4).toString('hex');
const STREETS = ['preflop', 'flop', 'turn', 'river'];

class Party {
  constructor(code, opts = {}) {
    this.code = code;
    this.now = opts.now || Date.now;
    this.t = Object.assign(
      { breakMs: 7000, startMs: 1500, streetMs: 900, runoutMs: 1500, autoActMs: 900, awayMs: 5 * 60e3, expireMs: 15 * 60e3, idleMs: 60e3 },
      opts.timing || {}
    );
    this.shuffle = opts.shuffle || shuffle; // injectable for tests
    this.onChange = () => {};
    this.notify = () => {}; // (player, message) hook for the transport layer
    this.players = new Map();
    this.byToken = new Map();
    this.banned = new Set();
    this.ring = []; // player ids in clockwise seat order
    this.hostId = null;
    this.phase = 'lobby'; // lobby | playing | results
    this.settings = { ...DEFAULTS };
    this.tally = {}; // player id -> games won this session
    this.chat = [];
    this.log = [];
    this.g = null;
    this.seq = 0;
    this.stats = { in: 0, out: 0 }; // chip bookkeeping, used by tests
    this.lastActive = this.now();
  }

  // ---------- plumbing ----------
  emit() { this.lastActive = this.now(); this.onChange(); }
  say(text) {
    this.log.push({ ts: this.now(), text });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }
  nameOf(id) {
    const p = this.players.get(id);
    if (p) return p.name;
    const h = this.g && this.g.hand;
    return h && h.byId[id] ? h.byId[id].name : '?';
  }

  // ---------- membership ----------
  addPlayer(name, token) {
    name = cleanName(name);
    if (!name) return { error: 'Enter a name first.' };
    if (!token || typeof token !== 'string') return { error: 'Missing token.' };
    if (this.banned.has(token)) return { error: 'The host removed you from this party.' };
    if (this.players.size >= MAX_PLAYERS) return { error: `The table is full (${MAX_PLAYERS} players max).` };
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) return { error: 'That name is taken in this party. Pick another.' };
    }
    const p = {
      id: rid(), token, name, seq: ++this.seq, joinedAt: this.now(), avatar: crypto.randomInt(1e9),
      conn: null, connected: true, disconnectedAt: null,
      chips: 0, handsWon: 0, rebuysUsed: 0,
      seated: false, away: false, pending: false, wantRebuy: false, muted: false, leaving: false,
    };
    this.players.set(p.id, p);
    this.byToken.set(token, p);
    if (!this.hostId) this.hostId = p.id;
    if (this.phase === 'playing') {
      p.pending = true;
      this.say(`${p.name} joined and will be dealt in next hand.`);
    } else {
      this.say(`${p.name} joined the party.`);
    }
    this.emit();
    return { player: p };
  }

  reconnect(p) {
    p.connected = true;
    p.disconnectedAt = null;
    if (p.away) {
      p.away = false;
      this.say(`${p.name} is back and will be dealt in next hand.`);
    }
    this.emit();
  }

  disconnect(p) {
    if (!p.connected) return;
    p.connected = false;
    p.conn = null;
    p.disconnectedAt = this.now();
    this.emit();
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    const h = this.g && this.g.hand;
    const e = h && h.byId[id];
    if (e && h.phase !== 'over') {
      p.leaving = true;
      if (!e.folded && !e.allIn) this._forceFold(id);
      this.emit();
      return; // purged when the hand ends
    }
    this._purge(p);
    this.emit();
  }

  _purge(p) {
    const g = this.g;
    if (g && g.dealerId === p.id) {
      const i = this.ring.indexOf(p.id);
      g.dealerId = this.ring.length > 1 ? this.ring[(i - 1 + this.ring.length) % this.ring.length] : null;
    }
    this.ring = this.ring.filter((x) => x !== p.id);
    this.players.delete(p.id);
    this.byToken.delete(p.token);
    this.stats.out += p.chips;
    delete this.tally[p.id];
    this.notify(p, { t: 'left' });
    if (this.hostId === p.id) this._transferHost();
    this.say(`${p.name} left the table.`);
  }

  _purgeLeaving() {
    for (const p of [...this.players.values()]) if (p.leaving) this._purge(p);
  }

  _transferHost() {
    const all = [...this.players.values()].filter((p) => !p.leaving).sort((a, b) => a.seq - b.seq);
    const next = all.find((p) => p.connected && !p.away) || all[0];
    this.hostId = next ? next.id : null;
    if (next) this.say(`${next.name} is now the host.`);
  }

  isEmpty() { return this.players.size === 0; }
  hasConnected() { for (const p of this.players.values()) if (p.connected) return true; return false; }

  // ---------- lobby ----------
  setSettings(pid, input) {
    if (pid !== this.hostId) return 'Only the host can change settings.';
    if (this.phase !== 'lobby') return 'Settings are locked during a game.';
    this.settings = cleanSettings(input, this.settings);
    this.emit();
    return null;
  }

  start(pid) {
    if (pid !== this.hostId) return 'Only the host can start the game.';
    if (this.phase !== 'lobby') return 'The game already started.';
    for (const p of [...this.players.values()]) if (!p.connected) this._purge(p);
    const list = [...this.players.values()];
    if (list.length < MIN_PLAYERS) return `You need at least ${MIN_PLAYERS} players.`;
    const s = this.settings;
    this.ring = this.shuffle(list.map((p) => p.id)); // random seating
    for (const p of list) {
      p.seated = true; p.pending = false; p.away = false; p.wantRebuy = false;
      p.handsWon = 0; p.rebuysUsed = 0; p.leaving = false;
      p.chips = 0;
      this._inject(p, s.startingChips);
    }
    const bb = startingBB(s.startingChips);
    const now = this.now();
    this.g = {
      handsDealt: 0, handNo: 0, startedAt: now,
      endAt: s.lengthMode === 'time' ? now + s.lengthMinutes * 60e3 : null,
      bb, sb: bb / 2, dealerId: null, paused: false, pauseAck: false, timeUp: false,
      hand: null, nextHandAt: now + this.t.startMs, final: null,
    };
    this.phase = 'playing';
    this.say(`Game started with ${list.length} players. Blinds ${bb / 2}/${bb}.`);
    this.emit();
    return null;
  }

  newGame(pid) {
    if (pid !== this.hostId) return 'Only the host can start a new game.';
    if (this.phase !== 'results') return 'The game is not finished yet.';
    for (const p of [...this.players.values()]) if (!p.connected) this._purge(p);
    for (const p of this.players.values()) {
      this.stats.out += p.chips;
      Object.assign(p, { chips: 0, handsWon: 0, rebuysUsed: 0, seated: false, away: false, pending: false, wantRebuy: false, leaving: false });
    }
    this.ring = [];
    this.g = null;
    this.phase = 'lobby';
    this.say('Back in the lobby. The host can change settings and start a new game.');
    this.emit();
    return null;
  }

  // ---------- host powers and chat ----------
  kick(pid, targetId) {
    if (pid !== this.hostId) return 'Only the host can remove players.';
    if (targetId === pid) return 'You cannot remove yourself.';
    const t = this.players.get(targetId);
    if (!t) return null;
    this.banned.add(t.token);
    this.notify(t, { t: 'kicked' });
    this.say(`${t.name} was removed by the host.`);
    this.removePlayer(targetId);
    return null;
  }

  mute(pid, targetId, muted) {
    if (pid !== this.hostId) return 'Only the host can mute players.';
    const t = this.players.get(targetId);
    if (!t || t.id === pid) return null;
    t.muted = !!muted;
    this.say(`${t.name} was ${t.muted ? 'muted' : 'unmuted'} by the host.`);
    this.emit();
    return null;
  }

  chatSend(pid, text) {
    const p = this.players.get(pid);
    if (!p) return null;
    if (p.muted) return 'The host muted you.';
    text = String(text == null ? '' : text).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return null;
    this.chat.push({ id: pid, name: p.name, text, ts: this.now() });
    if (this.chat.length > 100) this.chat.splice(0, this.chat.length - 100);
    this.emit();
    return null;
  }

  // ---------- chips, rebuys ----------
  _inject(p, amt) { p.chips += amt; this.stats.in += amt; }

  rebuy(pid) {
    const p = this.players.get(pid);
    const s = this.settings;
    if (this.phase !== 'playing' || !p || !p.seated) return 'You cannot rebuy right now.';
    if (p.chips > 0) return 'You still have chips.';
    if (p.rebuysUsed >= s.rebuyLimit) return 'No rebuys left.';
    if (p.wantRebuy) return null;
    const h = this.g.hand;
    if (h && h.phase !== 'over') {
      p.wantRebuy = true; // spectate until the hand is over, like real poker
      this.say(`${p.name} will rebuy after this hand.`);
    } else {
      this._doRebuy(p);
    }
    this.emit();
    return null;
  }

  _doRebuy(p) {
    p.wantRebuy = false;
    p.rebuysUsed++;
    this._inject(p, this.settings.rebuyAmount);
    this.say(`${p.name} rebuys for ${this.settings.rebuyAmount}.`);
  }

  _applyRebuys() {
    for (const p of this.players.values()) {
      if (p.wantRebuy && p.seated && p.chips === 0 && p.rebuysUsed < this.settings.rebuyLimit) this._doRebuy(p);
      else p.wantRebuy = false;
    }
  }

  pauseChoice(pid, choice) {
    const g = this.g;
    if (pid !== this.hostId) return 'Only the host can decide.';
    if (this.phase !== 'playing' || !g || !g.paused) return null;
    if (choice === 'end') this.endGame('host');
    else { g.pauseAck = true; this.emit(); }
    return null;
  }

  // ---------- clock ----------
  tick() {
    const now = this.now();
    let changed = false;
    for (const p of [...this.players.values()]) {
      if (p.connected) continue;
      const el = now - p.disconnectedAt;
      if (this.phase !== 'playing' || p.pending) {
        if (el >= this.t.idleMs) { this._purge(p); changed = true; }
        continue;
      }
      if (el >= this.t.expireMs) { this.removePlayer(p.id); changed = true; continue; }
      if (el >= this.t.awayMs && p.seated && !p.away) {
        p.away = true;
        this.say(`${p.name} has been offline for a while and is sitting out.`);
        this._forceFold(p.id);
        if (p.id === this.hostId) this._transferHost();
        changed = true;
      }
    }
    if (this.phase === 'playing') {
      const g = this.g;
      if (g.endAt && now >= g.endAt && !g.timeUp) { g.timeUp = true; changed = true; }
      const h = g.hand;
      if (h && h.phase !== 'over') this._tickHand(now);
      else if (g.paused) this._nextHand();
      else if (g.nextHandAt != null && now >= g.nextHandAt) this._nextHand();
    }
    if (changed) this.emit();
  }

  // ---------- between hands ----------
  _shouldEnd() {
    const g = this.g, s = this.settings;
    if (s.lengthMode === 'hands') return g.handsDealt >= s.lengthHands;
    return g.endAt != null && this.now() >= g.endAt;
  }

  _nextHand() {
    const g = this.g;
    this._purgeLeaving();
    this._applyRebuys();
    if (this._shouldEnd()) return this.endGame('length');

    const ring = this.ring;
    const elig = (id) => { const p = this.players.get(id); return p && p.seated && !p.away && p.chips > 0; };
    const existing = ring.filter(elig);
    const joiners = [...this.players.values()].filter((p) => p.pending && p.connected).sort((a, b) => a.seq - b.seq);

    if (existing.length + joiners.length < MIN_PLAYERS) {
      if (!g.paused) {
        g.paused = true; g.pauseAck = false; g.nextHandAt = null;
        this.say('Not enough players to continue. Waiting for more.');
        this.emit();
      }
      return;
    }
    if (g.paused) { g.paused = false; g.pauseAck = false; }

    // The button moves one seat clockwise to the next player who can play.
    let dealerId = null;
    if (existing.length) {
      if (!g.dealerId || !ring.includes(g.dealerId)) dealerId = existing[crypto.randomInt(existing.length)];
      else {
        const start = ring.indexOf(g.dealerId);
        for (let i = 1; i <= ring.length; i++) {
          const id = ring[(start + i) % ring.length];
          if (elig(id)) { dealerId = id; break; }
        }
      }
    }
    // Late joiners sit immediately left of the dealer; everyone after them is pushed one seat clockwise.
    if (dealerId) {
      const di = ring.indexOf(dealerId);
      for (const j of joiners.slice().reverse()) ring.splice(di + 1, 0, j.id);
    } else {
      ring.push(...joiners.map((j) => j.id));
      dealerId = ring[crypto.randomInt(ring.length)];
    }
    for (const j of joiners) {
      j.pending = false; j.seated = true; j.away = false; j.rebuysUsed = 0;
      this._inject(j, this.settings.rebuyAmount);
      this.say(`${j.name} takes a seat with ${this.settings.rebuyAmount} chips.`);
    }
    g.dealerId = dealerId;

    const di = ring.indexOf(dealerId);
    const order = [];
    for (let i = 1; i <= ring.length; i++) {
      const id = ring[(di + i) % ring.length];
      if (elig(id)) order.push(id);
    }
    this._startHand(order);
  }

  endGame(reason) {
    const g = this.g;
    if (this.phase !== 'playing') return;
    const list = [...this.players.values()].filter((p) => p.seated || p.handsWon > 0);
    list.sort((a, b) => b.handsWon - a.handsWon || b.chips - a.chips);
    const max = list.length ? list[0].handsWon : 0;
    const winners = max > 0 ? list.filter((p) => p.handsWon === max).map((p) => p.id) : [];
    for (const id of winners) this.tally[id] = (this.tally[id] || 0) + 1;
    g.final = {
      reason,
      winners,
      standings: list.map((p) => ({ id: p.id, name: p.name, handsWon: p.handsWon, chips: p.chips })),
    };
    g.paused = false;
    g.nextHandAt = null;
    this.phase = 'results';
    this.say(winners.length ? `Game over. ${winners.map((id) => this.nameOf(id)).join(' and ')} won with ${max} hands.` : 'Game over.');
    this.emit();
  }

  // ---------- a hand ----------
  _startHand(order) {
    const g = this.g, s = this.settings, now = this.now();
    g.handsDealt++;
    g.handNo = g.handsDealt;
    if (g.handsDealt > 1 && (g.handsDealt - 1) % s.blindInterval === 0) {
      g.bb = nextBB(g.bb, s.blindIncreasePct);
      g.sb = g.bb / 2;
      g.level = (g.level || 0) + 1;
      this.say(`Blinds go up to ${g.sb}/${g.bb}.`);
    }
    const h = {
      no: g.handNo, phase: 'betting', street: 'preflop', community: [], deck: this.shuffle(newDeck()),
      p: [], byId: {}, order: order.slice(), dealerId: g.dealerId,
      currentBet: 0, minRaise: g.bb, toAct: -1, deadline: null, actorSince: null, stepAt: null, result: null,
    };
    for (const id of order) {
      const p = this.players.get(id);
      const e = { id, name: p.name, hole: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, noRaise: false };
      h.p.push(e);
      h.byId[id] = e;
    }
    g.hand = h;
    g.nextHandAt = null;
    // blinds: small blind is the first seat left of the dealer, big blind the next
    this._pay(h.p[0], this.players.get(h.p[0].id), Math.min(g.sb, this.players.get(h.p[0].id).chips));
    this._pay(h.p[1], this.players.get(h.p[1].id), Math.min(g.bb, this.players.get(h.p[1].id).chips));
    h.currentBet = Math.max(...h.p.map((e) => e.bet));
    for (let r = 0; r < 2; r++) for (const e of h.p) e.hole.push(h.deck.pop());
    this.say(`Hand ${h.no}: ${this.nameOf(h.dealerId)} deals. ${h.p[0].name} posts ${h.p[0].bet}, ${h.p[1].name} posts ${h.p[1].bet}.`);
    if (this._roundNeedsAction()) {
      h.phase = 'betting';
      this._setActor(this._nextActorIdx(1));
    } else {
      h.phase = 'dealing';
      h.stepAt = now + this.t.runoutMs;
    }
    this.emit();
  }

  _pay(e, p, amt) {
    p.chips -= amt;
    e.bet += amt;
    e.total += amt;
    if (p.chips === 0) e.allIn = true;
  }

  _setActor(i) {
    const h = this.g.hand, now = this.now();
    h.toAct = i;
    h.actorSince = now;
    h.deadline = now + this.settings.turnSeconds * 1000;
  }

  _nextActorIdx(from) {
    const h = this.g.hand, n = h.p.length;
    for (let i = 1; i <= n; i++) {
      const j = (((from + i) % n) + n) % n;
      const e = h.p[j];
      if (!e.folded && !e.allIn && (!e.acted || e.bet < h.currentBet)) return j;
    }
    return -1;
  }

  _roundNeedsAction() {
    const h = this.g.hand;
    const live = h.p.filter((e) => !e.folded);
    if (live.length <= 1) return false;
    const can = live.filter((e) => !e.allIn);
    if (can.length === 0) return false;
    if (can.length === 1) return can[0].bet < h.currentBet;
    return can.some((e) => !e.acted || e.bet < h.currentBet);
  }

  act(pid, action, amount) {
    const g = this.g, h = g && g.hand;
    if (this.phase !== 'playing' || !h || h.phase !== 'betting') return 'It is not your turn.';
    const e = h.p[h.toAct];
    if (!e || e.id !== pid) return 'It is not your turn.';
    return this._apply(e, action, amount);
  }

  _apply(e, action, amount) {
    const g = this.g, h = g.hand, p = this.players.get(e.id);
    const toCall = h.currentBet - e.bet;
    switch (action) {
      case 'fold':
        e.folded = true;
        this.say(`${e.name} folds.`);
        break;
      case 'check':
        if (toCall > 0) return 'You cannot check. There is a bet to call.';
        e.acted = true;
        this.say(`${e.name} checks.`);
        break;
      case 'call': {
        if (toCall <= 0) return 'There is nothing to call.';
        this._pay(e, p, Math.min(toCall, p.chips));
        e.acted = true;
        this.say(`${e.name} calls ${e.bet}${e.allIn ? ' and is all-in' : ''}.`);
        break;
      }
      case 'raise':
      case 'allin': {
        const maxTo = e.bet + p.chips;
        let to = action === 'allin' ? maxTo : Math.floor(Number(amount));
        if (!Number.isFinite(to)) return 'Enter a valid amount.';
        if (to > maxTo) return 'You do not have that many chips.';
        if (to <= h.currentBet) {
          if (action === 'allin' || to === maxTo) { // short all-in that only calls
            this._pay(e, p, p.chips);
            e.acted = true;
            this.say(`${e.name} calls ${e.bet} and is all-in.`);
            break;
          }
          return 'A raise must be higher than the current bet.';
        }
        if (e.noRaise) return 'Betting was not reopened. You can only call or fold.';
        const minTo = h.currentBet + h.minRaise;
        if (to < minTo && to < maxTo) return `The minimum raise is to ${minTo}.`;
        this._pay(e, p, to - e.bet);
        const size = to - h.currentBet;
        const wasBet = h.currentBet === 0;
        h.currentBet = to;
        if (size >= h.minRaise) {
          h.minRaise = size;
          for (const o of h.p) if (o !== e && !o.folded && !o.allIn) { o.acted = false; o.noRaise = false; }
        } else {
          for (const o of h.p) if (o !== e && !o.folded && !o.allIn && o.acted) { o.acted = false; o.noRaise = true; }
        }
        e.acted = true;
        this.say(`${e.name} ${wasBet ? 'bets' : 'raises to'} ${to}${e.allIn ? ' and is all-in' : ''}.`);
        break;
      }
      default:
        return 'Unknown action.';
    }
    this._afterAction();
    return null;
  }

  _afterAction() {
    const h = this.g.hand;
    const live = h.p.filter((e) => !e.folded);
    if (live.length === 1) return this._winByFold(live[0]);
    if (!this._roundNeedsAction()) return this._endRound();
    const nxt = this._nextActorIdx(h.toAct);
    if (nxt < 0) return this._endRound();
    this._setActor(nxt);
    this.emit();
  }

  _forceFold(id) {
    const h = this.g && this.g.hand;
    if (!h || h.phase === 'over') return;
    const e = h.byId[id];
    if (!e || e.folded || e.allIn) return;
    if (h.phase === 'betting' && h.p[h.toAct] === e) { this._apply(e, 'fold'); return; }
    e.folded = true;
    this.say(`${e.name} folds.`);
    const live = h.p.filter((x) => !x.folded);
    if (live.length === 1) return this._winByFold(live[0]);
    if (h.phase === 'betting' && !this._roundNeedsAction()) this._endRound();
    else this.emit();
  }

  _tickHand(now) {
    const h = this.g.hand;
    if (h.phase === 'dealing') {
      if (now >= h.stepAt) {
        if (h.street === 'river') this._showdown();
        else this._dealStreet();
      }
      return;
    }
    if (h.phase !== 'betting') return;
    const e = h.p[h.toAct];
    if (!e) return;
    const p = this.players.get(e.id);
    const gone = !p || !p.connected || p.away || p.leaving;
    if (gone) {
      if (now - h.actorSince >= this.t.autoActMs) this._autoAct(e, p, true);
    } else if (now >= h.deadline) {
      this._autoAct(e, p, false);
    }
  }

  // Out of time or offline: check if that is free, otherwise fold.
  _autoAct(e, p, gone) {
    const h = this.g.hand;
    if (h.currentBet - e.bet <= 0) {
      this._apply(e, 'check');
    } else {
      if (gone && p && !p.connected && !p.leaving) {
        p.away = true; // folded to a bet while offline: becomes a spectator
        this.say(`${e.name} is offline and sits out.`);
      } else if (!gone) {
        this.say(`${e.name} ran out of time.`);
      }
      this._apply(e, 'fold');
    }
  }

  _endRound() {
    const g = this.g, h = g.hand, now = this.now();
    for (const e of h.p) { e.bet = 0; e.acted = false; e.noRaise = false; }
    h.currentBet = 0;
    h.minRaise = g.bb;
    h.toAct = -1;
    h.deadline = null;
    const can = h.p.filter((e) => !e.folded && !e.allIn);
    h.phase = 'dealing';
    h.stepAt = now + (can.length <= 1 ? this.t.runoutMs : this.t.streetMs);
    this.emit();
  }

  _dealStreet() {
    const g = this.g, h = g.hand, now = this.now();
    const i = STREETS.indexOf(h.street);
    h.deck.pop(); // burn card
    const n = h.street === 'preflop' ? 3 : 1;
    for (let k = 0; k < n; k++) h.community.push(h.deck.pop());
    h.street = STREETS[i + 1];
    this.say(`${h.street[0].toUpperCase() + h.street.slice(1)}: ${h.community.join(' ')}`);
    if (this._roundNeedsAction()) {
      h.phase = 'betting';
      this._setActor(this._nextActorIdx(-1));
    } else {
      h.phase = 'dealing';
      h.stepAt = now + this.t.runoutMs;
    }
    this.emit();
  }

  _winByFold(w) {
    const h = this.g.hand;
    const total = h.p.reduce((s, e) => s + e.total, 0);
    this.players.get(w.id).chips += total;
    this.players.get(w.id).handsWon += 1;
    h.result = {
      showdown: false,
      payouts: { [w.id]: total },
      mainWinners: [w.id],
      pots: [{ amount: total, winners: [w.id] }],
      hands: {},
      reveals: {},
    };
    this.say(`${w.name} wins ${total}. Everyone else folded.`);
    this._finishHand();
  }

  _showdown() {
    const h = this.g.hand;
    const live = h.p.filter((e) => !e.folded);
    const scores = {}, hands = {}, reveals = {};
    for (const e of live) {
      const bh = bestHand(e.hole.concat(h.community));
      scores[e.id] = bh.score;
      hands[e.id] = { name: bh.name, cards: bh.cards };
      reveals[e.id] = e.hole.slice();
    }
    const pots = buildPots(h.p.map((e) => ({ id: e.id, total: e.total, folded: e.folded })));
    const { payouts, results } = distribute(pots, scores, h.order);
    for (const [id, amt] of Object.entries(payouts)) this.players.get(id).chips += amt;
    // A hand counts for whoever wins the main pot: +1 alone, +0.5 each when it is split.
    const main = results[0] ? results[0].winners : [];
    for (const id of main) this.players.get(id).handsWon += main.length === 1 ? 1 : 0.5;
    h.result = {
      showdown: true, payouts, mainWinners: main,
      pots: results.map((r) => ({ amount: r.amount, winners: r.winners })),
      hands, reveals,
    };
    for (const id of Object.keys(payouts)) this.say(`${this.nameOf(id)} wins ${payouts[id]}${hands[id] ? ` with ${hands[id].name}` : ''}.`);
    this._finishHand();
  }

  _finishHand() {
    const g = this.g, h = g.hand;
    h.phase = 'over';
    h.toAct = -1;
    h.deadline = null;
    this._applyRebuys();
    g.nextHandAt = this.now() + this.t.breakMs;
    this.emit();
  }

  // ---------- what each player is allowed to see ----------
  view(viewerId) {
    const g = this.g, h = g && g.hand, s = this.settings;
    const me = this.players.get(viewerId);
    const out = {
      now: this.now(), code: this.code, phase: this.phase, hostId: this.hostId, me: viewerId,
      settings: s, ring: this.ring.slice(), tally: this.tally,
      chat: this.chat.slice(-60), log: this.log.slice(-80), minPlayers: MIN_PLAYERS,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, chips: p.chips, connected: p.connected, away: p.away, pending: p.pending,
        seated: p.seated, muted: p.muted, handsWon: p.handsWon, rebuysUsed: p.rebuysUsed, avatar: p.avatar,
        seq: p.seq, wantRebuy: p.wantRebuy, leaving: p.leaving,
      })),
    };
    if (this.phase === 'lobby') out.lobbyBlinds = startingBB(s.startingChips);
    if (!g) return out;
    const interval = s.blindInterval;
    out.game = {
      handNo: g.handNo, handsDealt: g.handsDealt, dealerId: g.dealerId, sb: g.sb, bb: g.bb,
      raiseIn: 0,
      endAt: g.endAt, timeUp: g.timeUp, paused: g.paused, pauseAck: g.pauseAck,
      nextHandAt: g.nextHandAt, final: g.final,
    };
    // hands until the blinds rise: the next increase lands on hand (floor((n-1)/I)+1)*I+1
    out.game.raiseIn = (Math.floor((Math.max(g.handsDealt, 1) - 1) / interval) + 1) * interval + 1 - Math.max(g.handsDealt, 1);
    if (!h) return out;
    const total = h.p.reduce((a, e) => a + e.total, 0);
    const actor = h.phase === 'betting' && h.p[h.toAct] ? h.p[h.toAct].id : null;
    out.hand = {
      no: h.no, phase: h.phase, street: h.street, community: h.community.slice(), pot: total,
      dealerId: h.dealerId, sbId: h.order[0], bbId: h.order[1],
      seats: h.p.map((e) => ({ id: e.id, name: e.name, bet: e.bet, total: e.total, folded: e.folded, allIn: e.allIn })),
      toAct: actor, deadline: h.deadline, turnMs: s.turnSeconds * 1000,
      currentBet: h.currentBet, minRaise: h.minRaise,
      result: h.result,
    };
    const mine = h.byId[viewerId];
    if (mine) {
      out.hand.hole = mine.hole.slice();
      if (actor === viewerId && me) {
        const toCall = Math.max(0, h.currentBet - mine.bet);
        const maxTo = mine.bet + me.chips;
        out.hand.my = {
          toCall: Math.min(toCall, me.chips), canCheck: toCall === 0,
          canRaise: !mine.noRaise && maxTo > h.currentBet,
          minRaiseTo: Math.min(h.currentBet + h.minRaise, maxTo), maxRaiseTo: maxTo,
          isBet: h.currentBet === 0, chips: me.chips, bet: mine.bet,
        };
      }
    }
    return out;
  }
}

module.exports = { Party, DEFAULTS, MIN_PLAYERS, MAX_PLAYERS, startingBB, nextBB, cleanSettings };
