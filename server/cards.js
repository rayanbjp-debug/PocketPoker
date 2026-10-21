'use strict';
// Deck, shuffling and Texas Hold'em hand evaluation.
// A card is a 2-char string: rank (23456789TJQKA) + suit (s h d c).
const crypto = require('crypto');

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const NAMES = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
const plural = (r) => (r === 6 ? 'Sixes' : NAMES[r] + 's');

function newDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  return d;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const val = (c) => RANKS.indexOf(c[0]) + 2;

// Score of exactly five cards: [category, ...tiebreakers], compared lexicographically.
// 0 high card, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush, 6 full house, 7 quads, 8 straight flush
function eval5(cards) {
  const vals = cards.map(val).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([v, n]) => [n, +v])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let straightHigh = 0;
  if (new Set(vals).size === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5; // wheel
  }
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...vals];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, groups[0][1], groups[1][1], groups[2][1]];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, groups[0][1], groups[1][1], groups[2][1]];
  if (groups[0][0] === 2) return [1, groups[0][1], groups[1][1], groups[2][1], groups[3][1]];
  return [0, ...vals];
}

function cmp(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

function describe(s) {
  const n = (r) => NAMES[r];
  switch (s[0]) {
    case 8: return s[1] === 14 ? 'Royal Flush' : `Straight Flush, ${n(s[1])} high`;
    case 7: return `Four of a Kind, ${plural(s[1])}`;
    case 6: return `Full House, ${plural(s[1])} over ${plural(s[2])}`;
    case 5: return `Flush, ${n(s[1])} high`;
    case 4: return `Straight, ${n(s[1])} high`;
    case 3: return `Three of a Kind, ${plural(s[1])}`;
    case 2: return `Two Pair, ${plural(s[1])} and ${plural(s[2])}`;
    case 1: return `Pair of ${plural(s[1])}`;
    default: return `High Card, ${n(s[1])}`;
  }
}

// Best five-card hand out of 5 to 7 cards.
function bestHand(cards) {
  let best = null;
  const n = cards.length;
  const pick = [];
  (function rec(start) {
    if (pick.length === 5) {
      const five = pick.map((i) => cards[i]);
      const score = eval5(five);
      if (!best || cmp(score, best.score) > 0) best = { score, cards: five };
      return;
    }
    for (let i = start; i < n; i++) {
      pick.push(i);
      rec(i + 1);
      pick.pop();
    }
  })(0);
  best.name = describe(best.score);
  return best;
}

module.exports = { RANKS, SUITS, newDeck, shuffle, eval5, bestHand, cmp, describe };
