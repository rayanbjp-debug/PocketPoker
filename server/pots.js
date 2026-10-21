'use strict';
const { cmp } = require('./cards');

// entries: [{ id, total, folded }] where total = chips put in this hand.
// Returns pots in order (main pot first): [{ amount, eligible: [ids] }]
function buildPots(entries) {
  const levels = [...new Set(entries.filter((e) => e.total > 0).map((e) => e.total))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const lvl of levels) {
    let amount = 0;
    const eligible = [];
    for (const e of entries) {
      amount += Math.max(0, Math.min(e.total, lvl) - prev);
      if (!e.folded && e.total >= lvl) eligible.push(e.id);
    }
    prev = lvl;
    if (amount <= 0) continue;
    const last = pots[pots.length - 1];
    if (eligible.length === 0) {
      if (last) last.amount += amount; // dead money joins the previous pot
      continue;
    }
    if (last && last.eligible.length === eligible.length && last.eligible.every((id, i) => id === eligible[i])) {
      last.amount += amount; // same contenders: one pot
    } else {
      pots.push({ amount, eligible });
    }
  }
  return pots;
}

// scores: { id: score[] } for every contender. order: ids clockwise starting left of the dealer
// (used for who receives odd chips). Returns payouts and a per-pot breakdown.
function distribute(pots, scores, order) {
  const payouts = {};
  const results = [];
  for (const pot of pots) {
    let winners = [];
    let best = null;
    for (const id of pot.eligible) {
      const c = best ? cmp(scores[id], best) : 1;
      if (c > 0) { best = scores[id]; winners = [id]; }
      else if (c === 0) winners.push(id);
    }
    winners.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const share = Math.floor(pot.amount / winners.length);
    let rem = pot.amount - share * winners.length;
    for (const id of winners) {
      const extra = rem > 0 ? 1 : 0;
      rem -= extra;
      payouts[id] = (payouts[id] || 0) + share + extra;
    }
    results.push({ amount: pot.amount, winners, share, eligible: pot.eligible });
  }
  return { payouts, results };
}

module.exports = { buildPots, distribute };
