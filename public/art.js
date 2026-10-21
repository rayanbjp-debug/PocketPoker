'use strict';
// All the drawing for PocketPoker: cards, chips, cartoon avatars and the bot dealer. Everything is inline SVG/HTML.
const Art = (() => {
  const INK = '#0c0d10';

  // ---------- cards ----------
  const SUIT = {
    h: '<path d="M12 21.4C5.2 16.2 2.2 12.7 2.2 8.7 2.2 6 4.2 4 6.8 4c2 0 3.9 1.1 5.2 3.2C13.3 5.1 15.2 4 17.2 4c2.6 0 4.6 2 4.6 4.7 0 4-3 7.5-9.8 12.7z"/>',
    d: '<path d="M12 2.2l7.6 9.8-7.6 9.8L4.4 12z"/>',
    s: '<path d="M12 2C8.6 6.9 3 9.6 3 14.3c0 2.6 2 4.5 4.5 4.5 1.7 0 3-.7 4-2.1-.2 2.1-.9 3.8-2.2 5.3h5.4c-1.3-1.5-2-3.2-2.2-5.3 1 1.4 2.3 2.1 4 2.1 2.5 0 4.5-1.9 4.5-4.5C21 9.6 15.4 6.9 12 2z"/>',
    c: '<circle cx="12" cy="7.2" r="4.6"/><circle cx="6.6" cy="14.4" r="4.6"/><circle cx="17.4" cy="14.4" r="4.6"/><path d="M10.9 13h2.2c.2 3 .9 5.6 2.4 8.2H8.5c1.5-2.6 2.2-5.2 2.4-8.2z"/>',
  };
  const suitSvg = (s, cls) => `<svg class="suit ${cls || ''}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SUIT[s]}</svg>`;
  const rankText = (r) => (r === 'T' ? '10' : r);
  const SUIT_NAME = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
  const RANK_NAME = { T: '10', J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };

  function card(c, cls) {
    if (!c) return back(cls);
    const r = c[0], s = c[1];
    const red = s === 'h' || s === 'd' ? ' red' : '';
    return `<div class="card${red} ${cls || ''}" data-c="${c}" role="img" aria-label="${RANK_NAME[r] || r} of ${SUIT_NAME[s]}"><span class="r">${rankText(r)}</span>${suitSvg(s, 's1')}${suitSvg(s, 'big')}</div>`;
  }
  const back = (cls) => `<div class="card back ${cls || ''}" role="img" aria-label="Face-down card"></div>`;
  const slot = () => '<div class="card slot"></div>';

  // ---------- chips ----------
  const DEN = [
    { v: 1000, c: '#c8a24b', s: '#f3e2ad' },
    { v: 500, c: '#5b3a7a', s: '#d6c4e8' },
    { v: 100, c: '#1f242b', s: '#c8a24b' },
    { v: 25, c: '#2f7d55', s: '#d3ecdc' },
    { v: 5, c: '#8a2b36', s: '#f3d3d7' },
    { v: 1, c: '#e8e2d0', s: '#8a8472' },
  ];
  function chips(amount) {
    let a = Math.max(0, Math.floor(amount || 0));
    if (!a) return '';
    const cols = [];
    for (const d of DEN) {
      if (a >= d.v) { const n = Math.floor(a / d.v); a -= n * d.v; cols.push({ d, n }); }
    }
    const use = cols.slice(0, 3);
    const W = use.length * 17 + 3, H = 30;
    let g = '';
    use.forEach((col, ci) => {
      const x = 11 + ci * 17;
      const k = Math.min(5, col.n);
      for (let i = 0; i < k; i++) {
        const y = H - 8 - i * 3.6 - (ci % 2) * 2;
        g += `<ellipse cx="${x}" cy="${y + 2.4}" rx="8" ry="3.6" fill="#000" opacity=".45"/>`;
        g += `<ellipse cx="${x}" cy="${y + 1.6}" rx="8" ry="3.6" fill="${col.d.c}" stroke="${INK}" stroke-width="1"/>`;
        g += `<ellipse cx="${x}" cy="${y}" rx="8" ry="3.6" fill="${col.d.c}" stroke="${INK}" stroke-width="1"/>`;
        g += `<ellipse cx="${x}" cy="${y}" rx="5.2" ry="2.1" fill="none" stroke="${col.d.s}" stroke-width="1.1" stroke-dasharray="2.2 1.8"/>`;
      }
    });
    return `<svg class="chips" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${g}</svg>`;
  }

  // ---------- avatars: flat shapes, heavy outline, serious faces ----------
  const hash = (str) => { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const SKIN = ['#f1c9a5', '#e2b088', '#c88d62', '#a86d45', '#7e4c2e', '#5a3622'];
  const HAIR = ['#17120e', '#3a2416', '#6b4a2b', '#a06f35', '#b9b3a6', '#7a2d1f', '#2b2f3a'];
  const SHIRT = ['#7a2430', '#2f5d7c', '#3f7a5a', '#8a6a2a', '#5b4a7a', '#4a4f58', '#a05a2c'];
  const BG = ['#22333d', '#2d2634', '#2b3528', '#35291f', '#1f2d35', '#33252a'];
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('');
  };

  function avatar(seed) {
    const r = rng(hash(seed));
    const pick = (a) => a[Math.floor(r() * a.length)];
    const skin = pick(SKIN), hair = pick(HAIR), shirt = pick(SHIRT), bg = pick(BG);
    const style = Math.floor(r() * 6), acc = Math.floor(r() * 6), browTilt = 0.6 + r() * 1.4;
    const id = 'av' + hash(seed);
    const st = `stroke="${INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;
    let back = '', front = '';
    if (style === 2) back = `<path d="M17.5 31C15 14 25 8.5 32 8.5S49 14 46.5 31L47 46 39 46 39 31 25 31 25 46 17 46Z" fill="${hair}" ${st}/>`;
    if (style === 0 || style === 2 || style === 3) front += `<path d="M20 28C19 16 26 11.5 32 11.5S45 16 44 28C42 22 38 20 32 20S22 22 20 28Z" fill="${hair}" ${st}/>`;
    if (style === 3) front += `<circle cx="32" cy="9.5" r="5" fill="${hair}" ${st}/>`;
    if (style === 4) front += [[24, 15], [32, 12], [40, 15], [21, 22], [43, 22]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.2" fill="${hair}" ${st}/>`).join('');
    if (style === 5) front += `<path d="M19.6 24C20 14 26 10.5 32 10.5S44 14 44.4 24Z" fill="${shirt}" ${st}/><path d="M18 24.5H49" fill="none" ${st}/>`;
    let face = `<ellipse cx="25.8" cy="30" rx="1.7" ry="1.9" fill="${INK}"/><ellipse cx="38.2" cy="30" rx="1.7" ry="1.9" fill="${INK}"/>`;
    face += `<path d="M22 ${26.5 - browTilt * 0.4}L29.4 ${26.8 + browTilt * 0.5}M42 ${26.5 - browTilt * 0.4}L34.6 ${26.8 + browTilt * 0.5}" fill="none" ${st}/>`;
    face += `<path d="M32 31.5V35.2h2.2" fill="none" stroke="${shade(skin, 0.6)}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    face += `<path d="M28.2 39.4H35.8" fill="none" ${st}/>`;
    if (acc === 1) face += `<circle cx="25.8" cy="30" r="4.6" fill="none" ${st}/><circle cx="38.2" cy="30" r="4.6" fill="none" ${st}/><path d="M30.4 30H33.6" fill="none" ${st}/>`;
    if (acc === 2) face += `<path d="M20.5 33.5C21 45 27 46.5 32 46.5S43 45 43.5 33.5C42 38.5 38 38 32 38S22 38.5 20.5 33.5Z" fill="${hair}" ${st}/><path d="M28.2 40.6H35.8" fill="none" stroke="${skin}" stroke-width="2" stroke-linecap="round"/>`;
    if (acc === 3) face += `<path d="M26.5 37.2C29 35.4 31 36.4 32 37.4 33 36.4 35 35.4 37.5 37.2 35 39 33 38.2 32 37.6 31 38.2 29 39 26.5 37.2Z" fill="${hair}" ${st}/>`;
    return `<svg class="avatar" viewBox="0 0 64 64" aria-hidden="true"><defs><clipPath id="${id}"><circle cx="32" cy="32" r="31"/></clipPath></defs><g clip-path="url(#${id})"><rect width="64" height="64" fill="${bg}"/>${back}<path d="M6 66C6 52 18 47 32 47S58 52 58 66Z" fill="${shirt}" ${st}/><path d="M26 47L32 54 38 47" fill="none" ${st} opacity=".7"/><rect x="27" y="38" width="10" height="11" rx="3" fill="${shade(skin, 0.82)}" ${st}/><ellipse cx="32" cy="30" rx="12.3" ry="14" fill="${skin}" ${st}/>${front}${face}</g><circle cx="32" cy="32" r="31" fill="none" ${st}/></svg>`;
  }

  function dealerBot() {
    const st = `stroke="${INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;
    return `<svg class="dealer-bot" viewBox="0 0 72 76" aria-hidden="true">
      <path d="M36 4V13" fill="none" ${st}/><circle cx="36" cy="4.5" r="3" fill="#c8a24b" ${st}/>
      <path d="M8 76C8 60 20 55 36 55S64 60 64 76Z" fill="#2a2f37" ${st}/>
      <path d="M26 56L36 66 46 56 36 52Z" fill="#7a2430" ${st}/><circle cx="36" cy="58" r="2.6" fill="#a43343" ${st}/>
      <rect x="29" y="46" width="14" height="8" rx="2" fill="#3a404a" ${st}/>
      <rect x="12" y="13" width="48" height="35" rx="10" fill="#3b424d" ${st}/>
      <rect x="17" y="21" width="38" height="16" rx="6" fill="#0e1013" ${st}/>
      <rect x="22" y="26" width="8" height="5" rx="2" fill="#c8a24b"/><rect x="42" y="26" width="8" height="5" rx="2" fill="#c8a24b"/>
      <path d="M28 42H44" fill="none" ${st}/>
      <rect x="6" y="26" width="6" height="12" rx="2" fill="#2a2f37" ${st}/><rect x="60" y="26" width="6" height="12" rx="2" fill="#2a2f37" ${st}/>
    </svg>`;
  }

  const logo = (cls) => `<span class="logo ${cls || ''}"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">${SUIT.s}</svg>PocketPoker</span>`;

  return { card, back, slot, chips, avatar, dealerBot, logo, suitSvg, rankText };
})();
