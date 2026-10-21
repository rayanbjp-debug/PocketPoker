'use strict';
const assert = require('assert');
const { bestHand, cmp } = require('../server/cards');
const { buildPots, distribute } = require('../server/pots');
const { startingBB, nextBB } = require('../server/party');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const H = (s) => bestHand(s.split(' '));

console.log('Hand ranking');
t('royal flush', () => assert.strictEqual(H('As Ks Qs Js Ts 2d 3c').name, 'Royal Flush'));
t('straight flush', () => assert.strictEqual(H('9h 8h 7h 6h 5h Ad Kc').name, 'Straight Flush, Nine high'));
t('wheel straight flush is five high', () => assert.strictEqual(H('Ah 2h 3h 4h 5h Kd Kc').name, 'Straight Flush, Five high'));
t('four of a kind', () => assert.strictEqual(H('8c 8d 8h 8s Kd 2c 3c').name, 'Four of a Kind, Eights'));
t('full house picks best trips + pair', () => assert.strictEqual(H('Ks Kh Kd 4c 4s 4d 2c').name, 'Full House, Kings over Fours'));
t('flush', () => assert.strictEqual(H('Ad Jd 8d 6d 2d Kc Kh').name, 'Flush, Ace high'));
t('straight', () => assert.strictEqual(H('Tc 9d 8s 7h 6c 2d 2c').name, 'Straight, Ten high'));
t('wheel', () => assert.strictEqual(H('Ac 2d 3s 4h 5c Kd 9c').name, 'Straight, Five high'));
t('three of a kind', () => assert.strictEqual(H('Qs Qh Qd 9c 3s 7d 2c').name, 'Three of a Kind, Queens'));
t('two pair uses best two of three', () => assert.strictEqual(H('Js Jd 4c 4h As Kd Kc').name, 'Two Pair, Kings and Jacks'));
t('pair', () => assert.strictEqual(H('Ts Td Ac 7h 3s 5d 9c').name, 'Pair of Tens'));
t('sixes plural', () => assert.strictEqual(H('6s 6d Ac 7h 3s 9d Kc').name, 'Pair of Sixes'));
t('high card', () => assert.strictEqual(H('As Jd 8c 5h 2s 9d 3c').name, 'High Card, Ace'));
t('kicker decides', () => assert.ok(cmp(H('Ah Ad Kc 7h 3s 5d 9c').score, H('As Ac Qc 7h 3d 5s 9d').score) > 0));
t('same hand ties', () => assert.strictEqual(cmp(H('Ah Ad Kc 7h 3s 5d 9c').score, H('As Ac Kd 7s 3c 5h 9h').score), 0));
t('board plays', () => assert.strictEqual(cmp(H('2c 3d As Ks Qs Js Ts').score, H('4c 5d As Ks Qs Js Ts').score), 0));
t('flush beats straight, full house beats flush', () => {
  assert.ok(cmp(H('Ad Jd 8d 6d 2d Kc Kh').score, H('Tc 9d 8s 7h 6c 2d 2c').score) > 0);
  assert.ok(cmp(H('Ks Kh Kd 4c 4s 4d 2c').score, H('Ad Jd 8d 6d 2d Kc Kh').score) > 0);
});

console.log('Pots');
const ids = ['a', 'b', 'c', 'd'];
t('single pot', () => {
  const p = buildPots([{ id: 'a', total: 100 }, { id: 'b', total: 100 }, { id: 'c', total: 100, folded: true }]);
  assert.deepStrictEqual(p, [{ amount: 300, eligible: ['a', 'b'] }]);
});
t('side pots for three all-ins', () => {
  const p = buildPots([{ id: 'a', total: 50 }, { id: 'b', total: 150 }, { id: 'c', total: 300 }]);
  assert.deepStrictEqual(p, [
    { amount: 150, eligible: ['a', 'b', 'c'] },
    { amount: 200, eligible: ['b', 'c'] },
    { amount: 150, eligible: ['c'] },
  ]);
});
t('folded chips stay in the pot', () => {
  const p = buildPots([{ id: 'a', total: 40, folded: true }, { id: 'b', total: 100 }, { id: 'c', total: 100 }, { id: 'd', total: 60 }]);
  assert.strictEqual(p.reduce((s, x) => s + x.amount, 0), 300);
  assert.deepStrictEqual(p[0].eligible, ['b', 'c', 'd']);
});
t('short stack wins main pot, big stack wins side pot', () => {
  const pots = buildPots([{ id: 'a', total: 50 }, { id: 'b', total: 150 }, { id: 'c', total: 150 }]);
  const scores = { a: [8, 14], b: [1, 5, 4, 3, 2], c: [1, 6, 4, 3, 2] };
  const { payouts } = distribute(pots, scores, ids);
  assert.deepStrictEqual(payouts, { a: 150, c: 200 });
});
t('split pot gives the odd chip to the first seat left of the dealer', () => {
  const pots = buildPots([{ id: 'a', total: 51 }, { id: 'b', total: 51 }, { id: 'c', total: 51, folded: true }]);
  const scores = { a: [1, 9], b: [1, 9] };
  const { payouts } = distribute(pots, scores, ['c', 'b', 'a']);
  assert.strictEqual(payouts.b + payouts.a, 153);
  assert.strictEqual(payouts.b, 77); // b sits closer to the dealer's left, so gets the odd chip
  assert.strictEqual(payouts.a, 76);
  assert.ok(!payouts.c);
});
t('chips are conserved across random pots', () => {
  for (let k = 0; k < 500; k++) {
    const es = ids.map((id) => ({ id, total: 1 + Math.floor(Math.random() * 200), folded: Math.random() < 0.3 }));
    if (es.every((e) => e.folded)) es[0].folded = false;
    const scores = {};
    for (const e of es) if (!e.folded) scores[e.id] = [Math.floor(Math.random() * 3), Math.floor(Math.random() * 3)];
    const pots = buildPots(es);
    const { payouts } = distribute(pots, scores, ids);
    const paid = Object.values(payouts).reduce((s, x) => s + x, 0);
    assert.strictEqual(paid, es.reduce((s, e) => s + e.total, 0));
  }
});

console.log('Blinds');
t('starting blinds are 1% / 0.5%', () => { assert.strictEqual(startingBB(1000), 10); assert.strictEqual(startingBB(10000), 100); assert.strictEqual(startingBB(100), 2); });
t('blinds always grow and stay even', () => {
  let bb = startingBB(1000);
  for (let i = 0; i < 40; i++) { const n2 = nextBB(bb, 50); assert.ok(n2 > bb && n2 % 2 === 0); bb = n2; }
  assert.strictEqual(nextBB(2, 10), 4);
});

console.log(`\n${n} unit tests passed`);
