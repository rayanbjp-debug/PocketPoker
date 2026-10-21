'use strict';
(() => {
  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const fmtH = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
  const randToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  const setHTML = (el, sig, build) => { if (!el || el.__sig === sig) return false; el.__sig = sig; el.innerHTML = build(); return true; };
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  const RANKS = [
    ['Royal Flush', 'A K Q J 10, all one suit', 'As Ks Qs Js Ts'],
    ['Straight Flush', 'Five in a row, one suit', '9h 8h 7h 6h 5h'],
    ['Four of a Kind', 'Four cards of one rank', '8c 8d 8h 8s Kd'],
    ['Full House', 'Three of a kind plus a pair', 'Ks Kh Kd 4c 4s'],
    ['Flush', 'Five cards of one suit', 'Ad Jd 8d 6d 2d'],
    ['Straight', 'Five in a row, any suits', 'Tc 9d 8s 7h 6c'],
    ['Three of a Kind', 'Three cards of one rank', 'Qs Qh Qd 9c 3s'],
    ['Two Pair', 'Two different pairs', 'Js Jd 4c 4h As'],
    ['One Pair', 'Two cards of one rank', 'Ts Td Ac 7h 3s'],
    ['High Card', 'None of the above, so the highest card plays', 'As Jd 8c 5h 2s'],
  ];
  const TIPS = {
    fold: 'Give up this hand. Chips you already bet stay in the pot.',
    check: 'Pass without betting. Only possible when nobody has bet.',
    call: 'Match the current bet to stay in the hand.',
    raise: 'Increase the bet. Everyone else must match it or fold.',
    allin: 'Bet every chip you have.',
    slider: 'Choose your total bet for this round.',
  };

  // ---------- state ----------
  let token = LS.get('pp_token');
  if (!token || token.length < 8) { token = randToken(); LS.set('pp_token', token); }
  let ws = null, S = null, offset = 0, cur = '', retry = 0;
  let tipsOn = LS.get('pp_tips') !== 'off';
  let guideOpen = LS.get('pp_guide') !== 'closed';
  let sideTab = 'chat', sideOpen = false, unread = 0, lastChatTs = 0;
  let raiseTo = 0, turnKey = '';
  const seen = new Set();
  const isNew = (k) => { if (seen.has(k)) return false; seen.add(k); if (seen.size > 600) seen.clear(); return true; };
  const app = $('#app');

  document.body.classList.toggle('tips-on', tipsOn);

  // ---------- connection ----------
  const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      $('#conn').hidden = true;
      const code = LS.get('pp_code');
      if (code) send({ t: 'resume', code, token });
      else if (cur !== 'home') showHome();
    };
    ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => {
      $('#conn').hidden = false;
      setTimeout(connect, Math.min(4000, 400 * ++retry));
    };
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ws && ws.readyState > 1) connect(); });

  function onMsg(m) {
    switch (m.t) {
      case 'state': S = m.s; offset = S.now - Date.now(); render(); break;
      case 'joined': LS.set('pp_code', m.code); break;
      case 'gone': case 'left': LS.del('pp_code'); S = null; showHome(); break;
      case 'kicked': LS.del('pp_code'); S = null; toast('The host removed you from the party.', true); showHome(); break;
      case 'error': toast(m.msg, true); { const e = $('#home-err'); if (e) e.textContent = m.msg; } break;
      default: break;
    }
  }

  function toast(text, bad) {
    const el = document.createElement('div');
    el.className = 'toast' + (bad ? ' bad' : '');
    el.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // ---------- home ----------
  function showHome() {
    cur = 'home';
    const fan = ['As', 'Ks', 'Qs', 'Js', 'Ts'].map((c, i) => `<div style="transform:rotate(${(i - 2) * 7}deg) translateY(${Math.abs(i - 2) * 3}px)">${Art.card(c)}</div>`).join('');
    const params = new URLSearchParams(location.search);
    const code = (params.get('code') || '').toUpperCase().slice(0, 4);
    app.innerHTML = `<main class="home"><div class="home-in">
      <div class="fan" aria-hidden="true">${fan}</div>
      <h1>${Art.logo()}</h1>
      <p class="tagline">Texas Hold'em with fake chips for 3 to 10 friends. Whoever wins the most hands wins the game.</p>
      <div class="home-card">
        <label class="field"><span>Your name</span><input id="name" class="input" maxlength="14" autocomplete="nickname" placeholder="What should we call you?" value="${esc(LS.get('pp_name') || '')}"></label>
        <button id="create" class="btn primary">Create a party</button>
        <div class="or">or join a friend's party</div>
        <div class="join-row"><input id="code" class="input code-in" maxlength="4" placeholder="CODE" autocapitalize="characters" autocomplete="off" value="${esc(code)}"><button id="join" class="btn">Join</button></div>
        <div id="home-err" class="err" role="alert"></div>
      </div>
      <div class="rules"><span>New to poker? A hand guide stays at the top of the table while you play.</span><span>No real money. Chips are just for fun.</span></div>
    </div></main>`;
    const name = () => { const v = $('#name').value.trim(); if (!v) { $('#home-err').textContent = 'Enter a name first.'; $('#name').focus(); return null; } LS.set('pp_name', v); return v; };
    $('#create').onclick = () => { const n = name(); if (n) send({ t: 'create', name: n, token }); };
    const join = () => { const n = name(); if (!n) return; const c = $('#code').value.trim().toUpperCase(); if (c.length !== 4) { $('#home-err').textContent = 'Party codes have 4 letters.'; return; } send({ t: 'join', code: c, name: n, token }); };
    $('#join').onclick = join;
    $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { if ($('#code').value.trim()) join(); else $('#create').click(); } });
    if (code) $('#name').focus();
  }

  // ---------- routing ----------
  function render() {
    if (!S) { showHome(); return; }
    if (S.phase === 'lobby') renderLobby();
    else renderGame();
  }
  const byId = () => Object.fromEntries(S.players.map((p) => [p.id, p]));
  const isHost = () => S.hostId === S.me;

  // ---------- lobby ----------
  const FIELDS = [
    ['startingChips', 'Starting chips', 100, 1000000, 100],
    ['rebuyAmount', 'Rebuy chips', 10, 1000000, 100],
    ['rebuyLimit', 'Rebuys per player', 0, 20, 1],
    ['turnSeconds', 'Turn timer (seconds)', 5, 120, 5],
    ['blindIncreasePct', 'Blind increase (%)', 10, 200, 5],
    ['blindInterval', 'Raise blinds every (hands)', 1, 50, 1],
  ];

  function renderLobby() {
    if (cur !== 'lobby') {
      cur = 'lobby';
      document.title = 'PocketPoker';
      const fields = FIELDS.map(([k, l, lo, hi, st]) => `<label class="field"><span>${l}</span><input class="input" id="s_${k}" type="number" min="${lo}" max="${hi}" step="${st}" inputmode="numeric"></label>`).join('');
      app.innerHTML = `<main class="lobby"><div class="lobby-in">
        <div class="lobby-top">${Art.logo()}
          <div class="codebox"><div><div class="l">Party code</div><div class="c" id="lcode"></div></div><button id="copy" class="btn small">Copy invite link</button></div>
          <button id="leave" class="btn ghost small">Leave party</button></div>
        <div class="cols">
          <section class="panel"><h2>Players <span id="pcount"></span></h2><div class="plist" id="plist"></div></section>
          <section class="panel"><h2>Game settings <span id="shint"></span></h2>
            <div class="sgrid">${fields}
              <div class="wide"><span style="display:block;font-size:13px;color:var(--muted);margin-bottom:4px">Game ends after</span>
                <div class="seg" id="mode"><button data-m="hands" aria-pressed="true">A number of hands</button><button data-m="time" aria-pressed="false">A time limit</button></div></div>
              <label class="field wide"><span id="lenlbl">Hands</span><input class="input" id="s_len" type="number" inputmode="numeric"></label>
              <div class="wide hint" id="bhint"></div></div>
            <div class="start-row"><button id="start" class="btn primary">Start game</button><div class="grow" id="shint2"></div></div>
          </section></div></div></main>`;
      $('#copy').onclick = copyInvite;
      $('#leave').onclick = leave;
      $('#start').onclick = () => send({ t: 'start' });
      const push = () => {
        if (!isHost()) return;
        const s = {};
        for (const [k] of FIELDS) s[k] = Number($('#s_' + k).value);
        s.lengthMode = $('#mode').dataset.mode || S.settings.lengthMode;
        s[s.lengthMode === 'time' ? 'lengthMinutes' : 'lengthHands'] = Number($('#s_len').value);
        send({ t: 'settings', settings: s });
      };
      for (const [k] of FIELDS) {
        $('#s_' + k).addEventListener('change', () => {
          if (k === 'startingChips' && Number($('#s_rebuyAmount').value) === S.settings.startingChips) $('#s_rebuyAmount').value = $('#s_startingChips').value;
          push();
        });
      }
      $('#s_len').addEventListener('change', push);
      $('#mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || !isHost()) return; $('#mode').dataset.mode = b.dataset.m; paintMode(b.dataset.m); push(); });
      $('#plist').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-a]'); if (!b) return;
        if (b.dataset.a === 'kick') send({ t: 'kick', id: b.dataset.id });
        else send({ t: 'mute', id: b.dataset.id, muted: b.dataset.muted !== '1' });
      });
    }
    updateLobby();
  }

  function paintMode(m) {
    $$('#mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
    $('#lenlbl').textContent = m === 'time' ? 'Minutes' : 'Hands';
    $('#s_len').min = 1; $('#s_len').max = m === 'time' ? 600 : 1000; $('#s_len').step = m === 'time' ? 5 : 5;
  }

  function updateLobby() {
    const host = isHost(), P = S.players, s = S.settings;
    $('#lcode').textContent = S.code;
    $('#pcount').textContent = `${P.length} of 10`;
    for (const [k] of FIELDS) { const el = $('#s_' + k); if (document.activeElement !== el) el.value = s[k]; el.disabled = !host; }
    const m = s.lengthMode;
    $('#mode').dataset.mode = m;
    paintMode(m);
    const len = $('#s_len'); if (document.activeElement !== len) len.value = m === 'time' ? s.lengthMinutes : s.lengthHands;
    len.disabled = !host;
    $$('#mode button').forEach((b) => { b.disabled = !host; });
    $('#shint').textContent = host ? 'You are the host' : 'Only the host can change these';
    const bb = S.lobbyBlinds;
    $('#bhint').textContent = `Blinds start at ${bb / 2}/${bb} and rise ${s.blindIncreasePct}% every ${s.blindInterval} hand${s.blindInterval === 1 ? '' : 's'}. Each player gets ${s.turnSeconds} seconds per turn.`;
    const ready = P.filter((p) => p.connected).length;
    const st = $('#start');
    st.hidden = !host;
    st.disabled = ready < S.minPlayers;
    $('#shint2').textContent = host ? (ready < S.minPlayers ? `Waiting for ${S.minPlayers - ready} more player${S.minPlayers - ready === 1 ? '' : 's'}. Share the code or invite link.` : 'Everyone ready? Seats are drawn at random.') : 'Waiting for the host to start the game.';
    const sig = JSON.stringify([P.map((p) => [p.id, p.name, p.connected, p.muted]), S.hostId, S.me]);
    setHTML($('#plist'), sig, () => [...P].sort((a, b) => a.seq - b.seq).map((p) => `
      <div class="prow">${Art.avatar(p.avatar)}
        <div style="min-width:0"><div class="nm">${esc(p.name)}${p.id === S.hostId ? '<span class="tag host">host</span>' : ''}${p.id === S.me ? '<span class="tag me">you</span>' : ''}${p.muted ? '<span class="tag">muted</span>' : ''}</div>
        <div class="sub"><span class="dot ${p.connected ? '' : 'off'}"></span>${p.connected ? 'Ready' : 'Offline'}</div></div>
        <div class="acts">${host && p.id !== S.me ? `<button class="btn small" data-a="mute" data-id="${p.id}" data-muted="${p.muted ? 1 : 0}">${p.muted ? 'Unmute' : 'Mute'}</button><button class="btn small danger" data-a="kick" data-id="${p.id}">Remove</button>` : ''}</div>
      </div>`).join(''));
  }

  function copyInvite() {
    const url = `${location.origin}/?code=${S.code}`;
    const done = () => toast('Invite link copied.');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, () => toast(url));
    else { const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch { toast(url); } t.remove(); }
  }
  function leave() {
    if (!confirm('Leave this party? You will give up your seat and chips.')) return;
    send({ t: 'leave' });
    LS.del('pp_code');
    S = null;
    showHome();
  }

  // ---------- game shell ----------
  function buildGame() {
    cur = 'game';
    const guide = RANKS.map((r, i) => `<div class="gt"><div class="gn"><i>${i + 1}</i>${r[0]}</div><div class="gc">${r[2].split(' ').map((c) => Art.card(c)).join('')}</div><div class="gd">${r[1]}</div></div>`).join('');
    app.innerHTML = `<div class="game">
      <header class="topbar">
        ${Art.logo()}
        <div class="info"><button class="pill" id="p-code" title="Copy invite link"></button><span class="pill" id="p-blinds"></span><span class="pill" id="p-len"></span></div>
        <div class="acts"><button class="btn small ghost" id="b-tips"></button><button class="btn small only-small" id="b-chat">Chat<span id="b-unread"></span></button><button class="btn small ghost" id="b-leave">Leave</button></div>
      </header>
      <section class="guide ${guideOpen ? 'open' : ''}" id="guide">
        <div class="guide-head"><span><b>Hand guide</b> from strongest to weakest</span><button class="btn small ghost" id="b-guide"></button></div>
        <div class="gtiles" id="gtiles">${guide}</div>
      </section>
      <div class="main">
        <section class="stage">
          <div class="table-wrap" id="wrap">
            <div class="table"><div class="tcenter">
              <div class="dealer">${Art.dealerBot()}<div class="dealer-line" id="dline"></div></div>
              <div class="pot" id="pot"></div><div class="board" id="board"></div><div class="banner" id="banner"></div>
            </div></div>
            <div id="seats"></div><div id="bets"></div>
          </div>
          <div class="me-area" id="me"><div class="mycards" id="mycards"></div><div class="actions" id="actions"></div></div>
        </section>
        <aside class="side" id="side">
          <div class="tabs" role="tablist"><button role="tab" data-tab="chat">Chat<span id="t-unread"></span></button><button role="tab" data-tab="log">Dealer log</button><button role="tab" data-tab="players">Players</button></div>
          <div class="pane" id="pane"></div>
          <form class="chat-form" id="chatf"><input class="input" id="chat-in" maxlength="200" autocomplete="off" placeholder="Say something"><button class="btn" type="submit">Send</button></form>
        </aside>
      </div>
      <div id="modal"></div></div>`;
    $('#b-leave').onclick = leave;
    $('#p-code').onclick = copyInvite;
    $('#b-tips').onclick = () => { tipsOn = !tipsOn; LS.set('pp_tips', tipsOn ? 'on' : 'off'); document.body.classList.toggle('tips-on', tipsOn); paintTop(); };
    $('#b-guide').onclick = () => { guideOpen = !guideOpen; LS.set('pp_guide', guideOpen ? 'open' : 'closed'); paintGuide(); };
    $('#b-chat').onclick = () => { sideOpen = !sideOpen; $('#side').classList.toggle('open', sideOpen); if (sideOpen) { sideTab = 'chat'; unread = 0; } updateSide(true); };
    $('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (!b) return; sideTab = b.dataset.tab; if (sideTab === 'chat') unread = 0; updateSide(true); });
    $('#chatf').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#chat-in').value.trim(); if (v) send({ t: 'chat', text: v }); $('#chat-in').value = ''; });
    $('#pane').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      if (b.dataset.a === 'kick') { if (confirm('Remove this player from the party?')) send({ t: 'kick', id: b.dataset.id }); }
      else send({ t: 'mute', id: b.dataset.id, muted: b.dataset.muted !== '1' });
    });
    $('#actions').addEventListener('click', onActionClick);
    $('#actions').addEventListener('input', onRaiseInput);
    $('#modal').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-m]'); if (!b) return;
      const m = b.dataset.m;
      if (m === 'end') send({ t: 'pause', choice: 'end' });
      else if (m === 'wait') send({ t: 'pause', choice: 'wait' });
      else if (m === 'newgame') send({ t: 'newgame' });
    });
    paintGuide(); paintTop();
    sideTab = 'chat';
  }

  function paintGuide() {
    $('#guide').classList.toggle('open', guideOpen);
    $('#gtiles').hidden = !guideOpen;
    $('#b-guide').textContent = guideOpen ? 'Hide' : 'Show';
  }
  function paintTop() { $('#b-tips').textContent = `Tips: ${tipsOn ? 'on' : 'off'}`; }

  function renderGame() {
    if (cur !== 'game') buildGame();
    updateTop(); updateTable(); updateMe(); updateSide(false); updateModal();
  }

  function updateTop() {
    const g = S.game, s = S.settings;
    $('#p-code').innerHTML = `Party <b>${esc(S.code)}</b>`;
    if (g) {
      const up = g.raiseIn <= 1 ? 'next hand' : `in ${g.raiseIn} hands`;
      $('#p-blinds').innerHTML = `Blinds <b>${fmt(g.sb)}/${fmt(g.bb)}</b> · rise ${up}`;
      $('#p-len').innerHTML = s.lengthMode === 'hands' ? `Hand <b>${g.handNo}</b> of ${s.lengthHands}` : `Time left <b id="tleft">${mmss(g.endAt - (Date.now() + offset))}</b>${g.timeUp ? ' · last hand' : ''}`;
    }
  }

  // ---------- table ----------
  function seatXY(i, n, narrow) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: 50 + (narrow ? 37 : 43) * Math.cos(a), y: 50 + 38 * Math.sin(a) };
  }

  function updateTable() {
    const P = byId(), g = S.game, h = S.hand;
    const ring = S.ring.filter((id) => P[id]);
    const n = ring.length;
    const wrap = $('#wrap');
    const narrow = wrap.clientWidth < 720;
    const myIdx = Math.max(0, ring.indexOf(S.me));
    const res = h && h.phase === 'over' ? h.result : null;
    const hl = new Set();
    if (res && res.showdown) for (const id of Object.keys(res.payouts)) if (res.hands[id]) res.hands[id].cards.forEach((c) => hl.add(c));
    const seatOf = {};
    if (h) for (const s of h.seats) seatOf[s.id] = s;
    const myTurn = h && h.toAct;

    // seats and bets
    let seatsHtml = '', betsHtml = '';
    ring.forEach((id, k) => {
      const i = (k - myIdx + n) % n;
      const { x, y } = seatXY(i, n, narrow);
      const p = P[id], hs = seatOf[id];
      const inHand = h && h.phase !== 'over' && hs && !hs.folded;
      const out = p.chips === 0 && !(hs && !hs.folded && h && h.phase !== 'over');
      const won = res && res.payouts[id] > 0;
      const reveal = res && res.reveals[id];
      const cls = ['seat', id === S.me ? 'me' : '', myTurn === id ? 'turn' : '', hs && hs.folded ? 'folded' : '', out ? 'out' : '', p.away ? 'away' : '', won ? 'winner' : ''].join(' ');
      let sub = '', subCls = '';
      if (won) { sub = `+${fmt(res.payouts[id])}${res.hands[id] ? ' · ' + res.hands[id].name : ''}`; subCls = 'win'; }
      else if (reveal && res.hands[id]) { sub = res.hands[id].name; subCls = 'hand'; }
      else if (!p.connected) sub = 'Offline';
      else if (p.away) sub = 'Sitting out';
      else if (hs && hs.folded && h.phase !== 'over') sub = 'Folded';
      else if (hs && hs.allIn && h.phase !== 'over') sub = 'All-in';
      else if (out) sub = p.rebuysUsed < S.settings.rebuyLimit ? 'Out of chips' : 'Out';
      const badges = (g && g.dealerId === id ? '<span class="bdg d">D</span>' : '') + (h && h.sbId === id ? '<span class="bdg">SB</span>' : '') + (h && h.bbId === id ? '<span class="bdg">BB</span>' : '');
      let cards = '';
      if (id !== S.me) {
        if (reveal) cards = reveal.map((c) => Art.card(c, (hl.size ? (hl.has(c) ? 'hl' : 'dim') : '') + (isNew(`${h.no}:r:${id}:${c}`) ? ' flip' : ''))).join('');
        else if (inHand) cards = (isNew(`${h.no}:s:${id}`) ? Art.back('deal') + Art.back('deal') : Art.back() + Art.back());
      }
      seatsHtml += `<div class="${cls}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" data-id="${id}">
        ${badges ? `<div class="badges">${badges}</div>` : ''}${cards ? `<div class="seat-cards">${cards}</div>` : ''}
        <div class="ring">${Art.avatar(p.avatar)}</div>
        <div class="plate"><div class="nm">${esc(p.name)}</div><div class="st">${fmt(p.chips)}</div><div class="sub ${subCls}">${esc(sub) || '&nbsp;'}</div></div></div>`;
      if (hs && hs.bet > 0 && h.phase !== 'over') {
        const bx = x + (50 - x) * 0.4, by = y + (50 - y) * 0.4;
        betsHtml += `<div class="bet" style="left:${bx.toFixed(2)}%;top:${by.toFixed(2)}%">${Art.chips(hs.bet)}<span>${fmt(hs.bet)}</span></div>`;
      }
    });
    const sSig = seatsHtml + `|${narrow}|${S.me}`;
    const changed = setHTML($('#seats'), sSig, () => seatsHtml);
    setHTML($('#bets'), betsHtml, () => betsHtml);
    void changed;

    // centre: dealer line, pot, board, banner
    const street = h ? h.street[0].toUpperCase() + h.street.slice(1) : '';
    let dl = 'Shuffling up…';
    if (g && g.paused) dl = 'Waiting for more players…';
    else if (h && h.phase === 'betting' && P[h.toAct]) dl = `${street}. <b>${esc(P[h.toAct].name)}</b> to act.`;
    else if (h && h.phase === 'dealing') dl = h.street === 'river' ? 'Showdown…' : 'Dealing…';
    else if (h && h.phase === 'over') dl = (res && res.showdown ? 'Showdown. ' : 'Hand over. ') + '<span id="nexth"></span>';
    setHTML($('#dline'), dl, () => dl);

    const pot = h ? h.pot : 0;
    setHTML($('#pot'), `pot${pot}`, () => (pot > 0 ? `${Art.chips(pot)}<span><span class="lbl">Pot </span>${fmt(pot)}</span>` : ''));
    const board = h ? h.community : [];
    let bHtml = '';
    for (let i = 0; i < 5; i++) {
      const c = board[i];
      bHtml += c ? Art.card(c, (hl.size ? (hl.has(c) ? 'hl' : 'dim') : '') + (isNew(`${h.no}:b:${c}`) ? ' flip' : '')) : Art.slot();
    }
    setHTML($('#board'), `b${board.join('')}${[...hl].join('')}`, () => bHtml);

    let banner = '';
    if (res) {
      const winners = Object.entries(res.payouts).sort((a, b) => b[1] - a[1]);
      const nm = (id) => esc(P[id] ? P[id].name : (seatOf[id] ? seatOf[id].name : '?'));
      if (winners.length) {
        const [wid, amt] = winners[0];
        const main = res.mainWinners;
        if (main.length > 1) banner = `<b>${main.map(nm).join(' and ')} split the pot</b><span>${res.hands[main[0]] ? esc(res.hands[main[0]].name) : ''}</span>`;
        else banner = `<b>${nm(wid)} wins ${fmt(amt)}</b><span>${res.hands[wid] ? esc(res.hands[wid].name) : 'Everyone else folded'}</span>`;
        if (winners.length > 1 && main.length === 1) banner += `<span>${winners.filter(([id]) => id !== wid).map(([id, a]) => `${nm(id)} +${fmt(a)}`).join(', ')}</span>`;
      }
    }
    setHTML($('#banner'), banner, () => banner);
  }

  // ---------- my cards and actions ----------
  function updateMe() {
    const P = byId(), me = P[S.me], h = S.hand, g = S.game;
    const hole = h && h.hole && h.hole.length ? h.hole : [];
    const myS = h && h.seats.find((s) => s.id === S.me);
    const folded = myS && myS.folded && h.phase !== 'over';
    const cardsHtml = () => hole.map((c) => Art.card(c, (folded ? 'dim ' : '') + (isNew(`${h.no}:m:${c}`) ? 'deal' : ''))).join('');
    setHTML($('#mycards'), `${hole.join('')}${folded}${h ? h.no : 0}`, cardsHtml);

    const my = h && h.my;
    const key = h ? `${h.no}:${h.street}:${h.currentBet}:${h.toAct}` : '';
    if (my && key !== turnKey) { turnKey = key; raiseTo = my.minRaiseTo; }
    if (!my) turnKey = '';
    let sig, html;
    const left = me ? S.settings.rebuyLimit - me.rebuysUsed : 0;
    const bust = me && me.seated && me.chips === 0 && S.phase === 'playing' && !(myS && !myS.folded && h && h.phase !== 'over');
    if (S.phase === 'results') { sig = 'results'; html = '<div class="note">The game is over. Check the results.</div>'; }
    else if (my) {
      const toCall = my.toCall;
      const callBtn = my.canCheck
        ? `<button class="btn felt grow" data-act="check" data-tip="${TIPS.check}">Check<small>Pass without betting</small></button>`
        : `<button class="btn felt grow" data-act="call" data-tip="${TIPS.call}">${toCall >= my.chips ? `Call ${fmt(toCall)} (all-in)` : `Call ${fmt(toCall)}`}<small>Match the bet</small></button>`;
      let raise = '', allin = '';
      if (my.canRaise) {
        const verb = my.isBet ? 'Bet' : 'Raise to';
        if (my.minRaiseTo < my.maxRaiseTo) {
          raiseTo = clamp(raiseTo, my.minRaiseTo, my.maxRaiseTo);
          raise = `<div class="raise" data-tip="${TIPS.slider}">
            <div class="rq"><button data-q="min">Min</button><button data-q="half">½ pot</button><button data-q="pot">Pot</button><button data-q="max">Max</button></div>
            <div class="rs"><input type="range" id="rr" min="${my.minRaiseTo}" max="${my.maxRaiseTo}" step="1" value="${raiseTo}" aria-label="Raise amount"><input class="input" type="number" id="rn" min="${my.minRaiseTo}" max="${my.maxRaiseTo}" value="${raiseTo}" aria-label="Raise to"></div>
            <div class="go"><button class="btn primary" data-act="raise" data-tip="${TIPS.raise}"><span id="rlbl">${verb} ${fmt(raiseTo)}</span></button></div></div>`;
        }
        allin = `<button class="btn allin" data-act="allin" data-tip="${TIPS.allin}">All-in ${fmt(my.maxRaiseTo)}<small>Bet everything</small></button>`;
      }
      sig = `turn|${key}|${my.chips}|${tipsOn}`;
      html = `<div class="tbar"><i></i></div><div class="abar"><button class="btn fold" data-act="fold" data-tip="${TIPS.fold}">Fold<small>Give up the hand</small></button>${callBtn}${raise}${allin}</div>`;
    } else {
      let note = '';
      const name = h && h.toAct && P[h.toAct] ? esc(P[h.toAct].name) : '';
      if (!me) note = '';
      else if (me.pending) note = 'You joined mid-game. You will be dealt in at the next hand.';
      else if (bust && me.wantRebuy) note = 'Rebuy queued. You are back after this hand.';
      else if (bust && left > 0) note = `<span><b>You are out of chips.</b> Rebuy for ${fmt(S.settings.rebuyAmount)}? ${left} left.</span><button class="btn primary small" id="rebuy">Rebuy</button>`;
      else if (bust) note = '<span><b>You are out of chips</b> and have no rebuys left. You can keep watching.</span>';
      else if (me.away) note = 'You were sitting out. You will be dealt in again at the next hand.';
      else if (g && g.paused) note = isHost() ? 'Waiting for more players. A hand needs at least 3 players with chips.' : 'Waiting for more players to continue.';
      else if (h && h.phase !== 'over' && !myS) note = 'Sitting this hand out. You are dealt in at the next one.';
      else if (folded) note = 'You folded. Waiting for the hand to finish.';
      else if (myS && myS.allIn && h.phase !== 'over') note = 'You are all-in. Good luck.';
      else if (h && h.phase === 'betting' && name) note = `Waiting for <b>${name}</b>…`;
      else if (h && h.phase === 'over') note = 'Next hand coming up.';
      else note = 'Waiting for the next hand…';
      sig = `note|${note}`;
      html = `<div class="note">${note}</div>`;
    }
    setHTML($('#actions'), sig, () => html);
    const rb = $('#rebuy'); if (rb) rb.onclick = () => send({ t: 'rebuy' });
    document.title = my ? 'Your turn · PocketPoker' : 'PocketPoker';
  }

  function onActionClick(e) {
    const q = e.target.closest('button[data-q]');
    const h = S.hand, my = h && h.my;
    if (q && my) {
      const callTo = h.currentBet;
      const potAfter = h.pot + my.toCall;
      let v = my.minRaiseTo;
      if (q.dataset.q === 'half') v = callTo + Math.round(potAfter / 2);
      else if (q.dataset.q === 'pot') v = callTo + potAfter;
      else if (q.dataset.q === 'max') v = my.maxRaiseTo;
      raiseTo = clamp(Math.round(v), my.minRaiseTo, my.maxRaiseTo);
      syncRaise();
      return;
    }
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'raise') send({ t: 'action', action: 'raise', amount: raiseTo });
    else send({ t: 'action', action: act });
  }
  function onRaiseInput(e) {
    const my = S.hand && S.hand.my; if (!my) return;
    if (e.target.id === 'rr' || e.target.id === 'rn') {
      const v = Number(e.target.value);
      if (Number.isFinite(v)) raiseTo = clamp(Math.round(v), my.minRaiseTo, my.maxRaiseTo);
      syncRaise(e.target.id);
    }
  }
  function syncRaise(skip) {
    const my = S.hand && S.hand.my;
    const rr = $('#rr'), rn = $('#rn'), lbl = $('#rlbl');
    if (rr && skip !== 'rr') rr.value = raiseTo;
    if (rn && skip !== 'rn') rn.value = raiseTo;
    if (lbl && my) lbl.textContent = `${my.isBet ? 'Bet' : 'Raise to'} ${fmt(raiseTo)}`;
  }

  // ---------- side panel ----------
  function updateSide(force) {
    const P = byId();
    $$('.tabs button[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === sideTab)));
    const newest = S.chat.length ? S.chat[S.chat.length - 1].ts : 0;
    const visible = sideTab === 'chat' && (window.innerWidth > 960 || sideOpen);
    if (newest > lastChatTs) {
      if (lastChatTs && !visible) unread += S.chat.filter((m) => m.ts > lastChatTs && m.id !== S.me).length;
      lastChatTs = newest;
    }
    if (visible) unread = 0;
    const badge = unread > 0 ? `<span class="badge">${unread}</span>` : '';
    $('#t-unread').innerHTML = badge;
    $('#b-unread').innerHTML = unread > 0 && window.innerWidth <= 960 ? ` (${unread})` : '';
    const pane = $('#pane');
    const nearBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 60;
    let sig, html;
    if (sideTab === 'chat') {
      sig = 'c' + JSON.stringify(S.chat.map((m) => [m.ts, m.id]));
      html = () => (S.chat.length ? S.chat.map((m) => `<p class="msg ${m.id === S.me ? 'me' : ''}"><b>${esc(m.name)}</b> ${esc(m.text)}</p>`).join('') : '<p class="empty">No messages yet. Say hello.</p>');
    } else if (sideTab === 'log') {
      sig = 'l' + S.log.length + (S.log.length ? S.log[S.log.length - 1].ts : 0);
      html = () => S.log.map((l) => `<p class="log-l">${esc(l.text)}</p>`).join('') || '<p class="empty">Nothing yet.</p>';
    } else {
      const host = isHost();
      sig = 'p' + JSON.stringify([S.players.map((p) => [p.id, p.chips, p.handsWon, p.connected, p.away, p.pending, p.muted, p.rebuysUsed]), S.hostId, S.tally]);
      html = () => `<p class="empty" style="margin:0 0 8px">Score is hands won. Split pots count half.</p>` + [...S.players].sort((a, b) => b.handsWon - a.handsWon || b.chips - a.chips).map((p) => {
        const st = !p.connected ? 'Offline' : p.pending ? 'Joins next hand' : p.away ? 'Sitting out' : p.seated && p.chips === 0 ? 'Out of chips' : 'Playing';
        const wins = S.tally[p.id] ? ` · ${S.tally[p.id]} game win${S.tally[p.id] > 1 ? 's' : ''}` : '';
        return `<div class="sp-row">${Art.avatar(p.avatar)}<div style="min-width:0"><div class="nm">${esc(p.name)}${p.id === S.hostId ? '<span class="tag host">host</span>' : ''}${p.id === S.me ? '<span class="tag me">you</span>' : ''}${p.muted ? '<span class="tag">muted</span>' : ''}</div><div class="sub">${st} · ${fmt(p.chips)} chips${wins}</div></div><div class="sc"><b>${fmtH(p.handsWon)}</b>hands</div>${host && p.id !== S.me ? `<div class="sp-acts"><button class="btn small" data-a="mute" data-id="${p.id}" data-muted="${p.muted ? 1 : 0}">${p.muted ? 'Unmute' : 'Mute'}</button><button class="btn small danger" data-a="kick" data-id="${p.id}">Remove</button></div>` : ''}</div>`;
      }).join('');
    }
    const redone = setHTML(pane, sig, html);
    if (redone && (nearBottom || force) && sideTab !== 'players') pane.scrollTop = pane.scrollHeight;
    if (force && sideTab === 'players') pane.scrollTop = 0;
    void P;
  }

  // ---------- modals ----------
  function updateModal() {
    const m = $('#modal'), g = S.game, P = byId();
    let html = '', sig = '';
    if (S.phase === 'results' && g && g.final) {
      const f = g.final;
      const names = f.winners.map((id) => (P[id] ? esc(P[id].name) : (f.standings.find((x) => x.id === id) || {}).name || '?'));
      const top = f.standings.length ? f.standings[0].handsWon : 0;
      const rows = f.standings.map((r, i) => `<div class="rank-row ${f.winners.includes(r.id) ? 'w' : ''}"><span class="pos">${i + 1}</span>${P[r.id] ? Art.avatar(P[r.id].avatar) : '<span></span>'}<div><div>${esc(r.name)}${f.winners.includes(r.id) ? ' <span class="crown">winner</span>' : ''}</div><div class="sub">${fmt(r.chips)} chips left</div></div><span class="sc">${fmtH(r.handsWon)} hands</span></div>`).join('');
      const tally = Object.entries(S.tally).filter(([id]) => P[id]).sort((a, b) => b[1] - a[1]).map(([id, w]) => `${esc(P[id].name)} ${w}`).join(' · ');
      sig = 'res' + JSON.stringify([f, S.tally, S.hostId]);
      html = `<div class="modal-back"><div class="modal wide"><h2>${names.length ? `${names.join(' and ')} ${names.length > 1 ? 'share the win' : 'wins the game'}` : 'Game over'}</h2>
        <p>${names.length ? `${fmtH(top)} hands won.` : 'Nobody won a hand.'}${tally ? ` Games won in this party: ${tally}.` : ''}</p>
        <div class="rank-list">${rows}</div>
        <div class="row">${isHost() ? '<button class="btn primary" data-m="newgame">New game</button>' : '<span class="empty">Waiting for the host to start a new game.</span>'}</div></div></div>`;
    } else if (g && g.paused && isHost() && !g.pauseAck) {
      sig = 'pause';
      html = `<div class="modal-back"><div class="modal"><h2>Insufficient players</h2><p>A hand needs at least ${S.minPlayers} players with chips. Wait for someone to join or rebuy, or end the game now and see the results.</p>
        <div class="row"><button class="btn" data-m="wait">Wait for players</button><button class="btn primary" data-m="end">End game</button></div></div></div>`;
    }
    setHTML(m, sig, () => html);
  }

  // ---------- timers ----------
  function frame() {
    if (S && cur === 'game') {
      const now = Date.now() + offset, h = S.hand;
      if (h && h.toAct && h.deadline) {
        const p = clamp((h.deadline - now) / h.turnMs, 0, 1);
        $$('.seat.turn .ring').forEach((el) => el.style.setProperty('--p', p));
        const tb = $('.tbar i'); if (tb) tb.style.setProperty('--p', p);
      }
      const t = $('#tleft'); if (t && S.game && S.game.endAt) t.textContent = mmss(S.game.endAt - now);
      const nh = $('#nexth'); if (nh && S.game && S.game.nextHandAt) nh.textContent = `Next hand in ${Math.max(0, Math.ceil((S.game.nextHandAt - now) / 1000))}s.`;
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => { if (S && cur === 'game') { const w = $('#seats'); if (w) w.__sig = null; updateTable(); } });

  showHome();
  connect();
  requestAnimationFrame(frame);
})();
