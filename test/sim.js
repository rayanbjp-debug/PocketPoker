'use strict';
// Engine tests with a fake clock: scripted scenarios first, then randomized full games with invariants.
const assert = require('assert');
const { Party } = require('../server/party');

let T = 0;
const FAST = { breakMs: 1000, startMs: 100, streetMs: 100, runoutMs: 100, autoActMs: 100, awayMs: 60e3, expireMs: 180e3, idleMs: 30e3 };
let n = 0;
const ok = (name) => { n++; console.log('  ok  ' + name); };

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mk(names, settings = {}, shuffle) {
  T = 0;
  const p = new Party('TEST', { now: () => T, timing: FAST, shuffle });
  const ids = {};
  names.forEach((nm, i) => { const r = p.addPlayer(nm, 'token-' + nm + '-xxxxxxxx'); assert.ok(r.player, r.error); ids[nm] = r.player.id; });
  p.setSettings(p.hostId, Object.assign({ startingChips: 1000, lengthHands: 100, rebuyLimit: 2, rebuyAmount: 500 }, settings));
  return { p, ids };
}
function adv(p, ms = 150, times = 1) { for (let i = 0; i < times; i++) { T += ms; p.tick(); } }
function until(p, cond, max = 400) { for (let i = 0; i < max && !cond(); i++) adv(p); assert.ok(cond(), 'condition not reached'); }
const sumChips = (p) => [...p.players.values()].reduce((s, x) => s + x.chips, 0);

// ---------- scripted: all-in with side pots ----------
console.log('Scripted hands');
{
  const deck = [];
  // pop order: B1 C1 A1 B2 C2 A2, burn, flop x3, burn, turn, burn, river
  const popOrder = ['Kh', 'Ts2', '', '', '', '', '', '', '', '', '', '', '']; // placeholder, replaced below
  void popOrder;
  const seq = ['Kh', '7c', 'As', 'Kd', '2d', 'Ah', '4s', '2c', '5d', '9h', '6s', 'Js', '8s', '3c'];
  // B=Kh,Kd  C=7c,2d  A=As,Ah | burn 4s | flop 2c 5d 9h | burn 6s | turn Js | burn 8s | river 3c
  for (let i = seq.length - 1; i >= 0; i--) deck.push(seq[i]);
  const full = deck.slice();
  const shuf = (arr) => (arr.length === 52 || arr.length > 40 ? full.slice() : arr.slice());
  const { p, ids } = mk(['A', 'B', 'C'], { startingChips: 1000 }, shuf);
  // give A a short stack of 100 and B, C 300
  p.start(ids.A);
  p.players.get(ids.A).chips = 100; p.players.get(ids.B).chips = 300; p.players.get(ids.C).chips = 300;
  p.stats.in = 700;
  p.g.dealerId = ids.C; // so the next dealer is A, SB is B, BB is C, A acts first
  until(p, () => p.g.hand && p.g.hand.phase === 'betting');
  const h = p.g.hand;
  assert.deepStrictEqual(h.order, [ids.B, ids.C, ids.A]);
  assert.strictEqual(h.p[0].bet, 5); assert.strictEqual(h.p[1].bet, 10);
  assert.strictEqual(h.p[h.toAct].id, ids.A, 'button acts first preflop in 3-handed play');
  assert.strictEqual(p.act(ids.B, 'fold'), 'It is not your turn.');
  assert.strictEqual(p.act(ids.A, 'check'), 'You cannot check. There is a bet to call.');
  assert.strictEqual(p.act(ids.A, 'raise', 15), 'The minimum raise is to 20.');
  assert.strictEqual(p.act(ids.A, 'allin'), null); ok('short stack shoves');
  assert.strictEqual(p.act(ids.B, 'raise', 99999), 'You do not have that many chips.');
  assert.strictEqual(p.act(ids.B, 'allin'), null);
  assert.strictEqual(p.act(ids.C, 'call'), null);
  until(p, () => p.g.hand.phase === 'over');
  const r = p.g.hand.result;
  assert.strictEqual(r.showdown, true);
  assert.strictEqual(r.payouts[ids.A], 300); assert.strictEqual(r.payouts[ids.B], 400);
  assert.strictEqual(p.players.get(ids.A).chips, 300);
  assert.strictEqual(p.players.get(ids.B).chips, 400);
  assert.strictEqual(p.players.get(ids.C).chips, 0);
  assert.strictEqual(p.players.get(ids.A).handsWon, 1);
  assert.strictEqual(p.players.get(ids.B).handsWon, 0); ok('side pots pay out; hand credited to main-pot winner');

  // only two players can play: game pauses and the host is asked
  until(p, () => p.g.paused);
  assert.strictEqual(p.pauseChoice(ids.B, 'wait'), 'Only the host can decide.');
  assert.strictEqual(p.pauseChoice(ids.A, 'wait'), null);
  assert.strictEqual(p.g.pauseAck, true); ok('pause with "Insufficient players" until someone returns');

  // bankrupt player rebuys (limit 2) and the game resumes
  assert.strictEqual(p.rebuy(ids.A), 'You still have chips.');
  assert.strictEqual(p.rebuy(ids.C), null);
  assert.strictEqual(p.players.get(ids.C).chips, 500);
  assert.strictEqual(p.players.get(ids.C).rebuysUsed, 1);
  until(p, () => p.g.hand && p.g.hand.phase !== 'over' && !p.g.paused);
  assert.strictEqual(p.g.paused, false); ok('rebuy resumes the game');

  // late joiner sits immediately left of the dealer and is treated as a rebuyer (0 rebuys used)
  const jr = p.addPlayer('D', 'token-D-xxxxxxxx');
  const D = jr.player.id;
  assert.strictEqual(jr.player.pending, true);
  until(p, () => p.g.hand.phase === 'over', 600);
  until(p, () => p.players.get(D).seated, 600);
  const ring = p.ring, di = ring.indexOf(p.g.dealerId);
  assert.strictEqual(ring[(di + 1) % ring.length], D);
  assert.strictEqual(p.players.get(D).rebuysUsed, 0);
  assert.ok(p.players.get(D).chips <= 500 && p.players.get(D).chips >= 0); ok('late joiner seated left of the dealer with 0 rebuys used');
}

// ---------- disconnects ----------
console.log('Disconnects');
{
  const { p, ids } = mk(['A', 'B', 'C', 'D']);
  p.start(ids.A);
  until(p, () => p.g.hand && p.g.hand.phase === 'betting');
  const actorId = () => p.g.hand.p[p.g.hand.toAct].id;
  // Take the actor offline: facing the blind they must fold and become a spectator right away
  const first = actorId();
  p.disconnect(p.players.get(first));
  until(p, () => p.g.hand.byId[first].folded);
  assert.strictEqual(p.players.get(first).away, true); ok('offline player facing a bet folds and becomes a spectator');
  p.reconnect(p.players.get(first));
  assert.strictEqual(p.players.get(first).away, false); ok('reconnecting within 15 minutes brings them back');
  // Offline long enough: sits out, then removed
  const victim = ids.D === p.hostId ? ids.C : ids.D;
  const vchips = p.players.get(victim).chips;
  p.disconnect(p.players.get(victim));
  adv(p, 61e3);
  assert.strictEqual(p.players.get(victim).away, true); ok('offline over 5 minutes means sitting out');
  adv(p, 130e3);
  adv(p, 1000, 4);
  until(p, () => !p.players.has(victim), 800);
  ok('offline over 15 minutes means removed (rejoining makes them a new player)');
  void vchips;
}

// ---------- randomized full games ----------
console.log('Randomized games');
function playGame(seed) {
  const rnd = mulberry(seed);
  const shuf = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const count = 3 + Math.floor(rnd() * 8);
  const names = Array.from({ length: count }, (_, i) => 'P' + i);
  const { p, ids } = mk(names, { startingChips: 200 + Math.floor(rnd() * 800), lengthHands: 25, blindInterval: 3, rebuyLimit: 2, rebuyAmount: 300, turnSeconds: 5 }, shuf);
  p.start(p.hostId);
  let guard = 0, joinCount = 0, handsSeen = new Set(), lastDealer = null;
  while (p.phase === 'playing' && guard++ < 30000) {
    const g = p.g, h = g.hand;
    // invariants
    const inPots = h && h.phase !== 'over' ? h.p.reduce((s, e) => s + e.total, 0) : 0;
    assert.strictEqual(sumChips(p) + inPots, p.stats.in - p.stats.out, `chips conserved (seed ${seed})`);
    for (const x of p.players.values()) { assert.ok(x.chips >= 0 && Number.isInteger(x.chips), 'chips are non-negative integers'); }
    if (h && !handsSeen.has(h.no)) {
      handsSeen.add(h.no);
      assert.strictEqual(h.order[0] === h.dealerId, false, 'dealer is not the small blind with 3+ players');
      assert.ok(h.order.length >= 3);
      assert.ok(g.bb >= 2 && g.sb * 2 === g.bb);
      lastDealer = h.dealerId;
    }
    if (h && h.phase === 'betting') {
      const e = h.p[h.toAct];
      assert.ok(e && !e.folded && !e.allIn, 'actor can act');
      const r = rnd();
      if (r < 0.05) { /* stall: let the turn timer fire */ }
      else {
        const v = p.view(e.id).hand.my;
        let act, amt;
        if (r < 0.18) act = 'fold';
        else if (r < 0.62) act = v.canCheck ? 'check' : 'call';
        else if (r < 0.92 && v.canRaise) { act = 'raise'; amt = v.minRaiseTo + Math.floor(rnd() * (v.maxRaiseTo - v.minRaiseTo + 1)); }
        else if (v.canRaise) act = 'allin';
        else act = v.canCheck ? 'check' : 'call';
        const err = p.act(e.id, act, amt);
        assert.strictEqual(err, null, `legal action rejected: ${act} ${amt} -> ${err}`);
      }
    }
    // random table events
    const ev = rnd();
    const list = [...p.players.values()];
    if (ev < 0.01) { const x = list[Math.floor(rnd() * list.length)]; if (x.connected && x.id !== p.hostId) p.disconnect(x); }
    else if (ev < 0.03) { const x = list.find((q) => !q.connected); if (x) p.reconnect(x); }
    else if (ev < 0.04 && p.players.size < 10 && joinCount < 3) { joinCount++; p.addPlayer('J' + joinCount + '_' + seed, 'token-J' + joinCount + seed + '-xxxxxxxx'); }
    else if (ev < 0.06) { const x = list.find((q) => q.seated && q.chips === 0); if (x) p.rebuy(x.id); }
    else if (ev < 0.065) { const x = list[Math.floor(rnd() * list.length)]; if (x && x.id !== p.hostId) p.kick(p.hostId, x.id); }
    else if (ev < 0.07) { const x = list.find((q) => q.id !== p.hostId); if (x) p.mute(p.hostId, x.id, rnd() < 0.5); }
    if (p.g.paused && p.phase === 'playing') {
      // keep things moving: bring everyone online and let bust players rebuy; else end the game
      for (const q of p.players.values()) { if (!q.connected) p.reconnect(q); if (q.seated && q.chips === 0) p.rebuy(q.id); }
      if (guard % 40 === 0) p.pauseChoice(p.hostId, 'end');
    }
    adv(p, 200 + Math.floor(rnd() * 800));
  }
  assert.strictEqual(p.phase, 'results', `game ended (seed ${seed}, guard ${guard})`);
  const f = p.g.final;
  assert.ok(f.standings.length > 0);
  for (let i = 1; i < f.standings.length; i++) assert.ok(f.standings[i - 1].handsWon >= f.standings[i].handsWon);
  assert.ok(handsSeen.size >= 1);
  // new game goes back to the lobby and can start again
  p.newGame(p.hostId);
  assert.strictEqual(p.phase, 'lobby');
  return { hands: handsSeen.size, players: count };
}
let totalHands = 0;
for (let seed = 1; seed <= 60; seed++) totalHands += playGame(seed).hands;
ok(`60 randomized games (${totalHands} hands): chips conserved, only legal actions, games end, rematch works`);

console.log(`\n${n} engine checks passed`);
