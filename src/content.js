/**
 * YT Comment Timestamps - content script (isolated world)
 *
 * 1. Collects comments for the current video (YouTube's own InnerTube endpoint,
 *    with a DOM-scraping fallback).
 * 2. Extracts timestamps like 1:23 / 01:23 / 1:02:03 from the comment text.
 * 3. Groups nearby timestamps into clusters and puts a small tick on the
 *    progress bar for each.
 * 4. Pops the comment up SoundCloud-style when playback reaches it; other
 *    comments in the same cluster float alongside as avatars you can hover.
 */
(() => {
  'use strict';

  const DEFAULTS = {
    enabled: true,
    autoPopup: true,
    popupDuration: 5,
    popupCenter: false,
    markerColor: '#ffffff',
    markerAvatars: false,
    avatarSize: 15,
    maxComments: 400,
    maxMarkers: 120,
    minLikes: 0,
    debug: false
  };

  let settings = { ...DEFAULTS };

  const state = {
    videoId: null,
    video: null,
    player: null,
    markerLayer: null,
    bubbleLayer: null,
    hoverCard: null,
    hoverCardOver: false,
    hoverHideTimer: null,
    clusters: [],
    lastTime: 0,
    loading: false,
    status: 'idle',
    barEl: null
  };

  const liveBubbles = new Set();

  const log = (...a) => { if (settings.debug) console.log('[YTCT]', ...a); };

  /* ------------------------------------------------------------------ utils */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout = 20000, step = 250) {
    const started = Date.now();
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() - started > timeout) return null;
      await sleep(step);
    }
  }

  function getSettings() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(DEFAULTS, (res) => resolve({ ...DEFAULTS, ...(res || {}) }));
      } catch (e) {
        resolve({ ...DEFAULTS });
      }
    });
  }

  function videoIdFromUrl() {
    try {
      const u = new URL(location.href);
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/);
      if (m) return m[1];
    } catch (e) { /* ignore */ }
    return null;
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* --------------------------------------------------- timestamp extraction */

  // 1:23 | 01:23 | 1:02:03 - not preceded/followed by other digits or ':'
  const TS_RE = /(?<![\d:])(\d{1,3}):([0-5]\d)(?::([0-5]\d))?(?![\d:])/g;

  function extractTimestamps(text) {
    const out = [];
    if (!text) return out;
    TS_RE.lastIndex = 0;
    let m;
    while ((m = TS_RE.exec(text)) !== null) {
      let secs;
      if (m[3] !== undefined) {
        secs = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
      } else {
        secs = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      }
      if (Number.isFinite(secs)) out.push({ seconds: secs, label: m[0] });
      if (out.length > 60) break; // chapter dumps: enough is enough
    }
    return out;
  }

  /* --------------------------------------------------- comment fetching (API) */

  function askPageConfig() {
    return new Promise((resolve) => {
      let done = false;
      const onCfg = (ev) => {
        if (done) return;
        done = true;
        window.removeEventListener('ytct:config', onCfg);
        try { resolve(JSON.parse(ev.detail || '{}')); } catch (e) { resolve({}); }
      };
      window.addEventListener('ytct:config', onCfg);
      window.dispatchEvent(new CustomEvent('ytct:request-config'));
      setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener('ytct:config', onCfg);
        resolve({});
      }, 1500);
    });
  }

  function pickThumb(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    if (Array.isArray(t.thumbnails) && t.thumbnails.length) {
      return t.thumbnails[0].url || '';
    }
    return '';
  }

  // Walk any JSON blob and pull out every comment-ish object we recognise.
  function harvest(node, acc, depth = 0) {
    if (!node || depth > 14) return;
    if (Array.isArray(node)) {
      for (const it of node) harvest(it, acc, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;

    // Modern format: entity payloads inside frameworkUpdates
    const cep = node.commentEntityPayload;
    if (cep && cep.properties && cep.properties.content) {
      acc.comments.push({
        text: cep.properties.content.content || '',
        author: (cep.author && (cep.author.displayName || cep.author.channelId)) || '',
        avatar: (cep.author && (cep.author.avatarThumbnailUrl || pickThumb(cep.author.avatarThumbnail))) || '',
        likes: parseLikes(cep.toolbar && cep.toolbar.likeCountNotliked)
      });
    }

    // Legacy format
    const cr = node.commentRenderer;
    if (cr && cr.contentText) {
      acc.comments.push({
        text: runsToText(cr.contentText),
        author: (cr.authorText && (cr.authorText.simpleText || runsToText(cr.authorText))) || '',
        avatar: pickThumb(cr.authorThumbnail),
        likes: parseLikes(cr.voteCount && (cr.voteCount.simpleText || runsToText(cr.voteCount)))
      });
    }

    // Continuation tokens
    const cir = node.continuationItemRenderer;
    if (cir) {
      const tok =
        (cir.continuationEndpoint &&
          cir.continuationEndpoint.continuationCommand &&
          cir.continuationEndpoint.continuationCommand.token) ||
        (cir.button &&
          cir.button.buttonRenderer &&
          cir.button.buttonRenderer.command &&
          cir.button.buttonRenderer.command.continuationCommand &&
          cir.button.buttonRenderer.command.continuationCommand.token) ||
        null;
      if (tok) acc.tokens.push(tok);
    }

    // The "comments" item section on the watch page
    if (node.itemSectionRenderer && node.itemSectionRenderer.sectionIdentifier === 'comment-item-section') {
      const inner = { comments: [], tokens: [] };
      harvest(node.itemSectionRenderer.contents, inner, depth + 1);
      if (inner.tokens.length) acc.commentSectionToken = inner.tokens[0];
      acc.comments.push(...inner.comments);
    }

    for (const k of Object.keys(node)) {
      if (k === 'itemSectionRenderer') continue;
      harvest(node[k], acc, depth + 1);
    }
  }

  function runsToText(o) {
    if (!o) return '';
    if (typeof o === 'string') return o;
    if (o.simpleText) return o.simpleText;
    if (Array.isArray(o.runs)) return o.runs.map((r) => r.text || '').join('');
    return '';
  }

  function parseLikes(v) {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'number') return v;
    const s = String(v).trim().replace(/,/g, '').replace(/\s/g, '');
    const m = s.match(/^([\d.]+)([KMB])?$/i);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    const suf = (m[2] || '').toUpperCase();
    if (suf === 'K') n *= 1e3;
    else if (suf === 'M') n *= 1e6;
    else if (suf === 'B') n *= 1e9;
    return Math.round(n) || 0;
  }

  async function innertube(body, apiKey) {
    const url = `https://www.youtube.com/youtubei/v1/next?prettyPrint=false${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`InnerTube HTTP ${res.status}`);
    return res.json();
  }

  async function fetchCommentsViaApi(videoId) {
    const cfg = await askPageConfig();
    const context = cfg.context && cfg.context.client && cfg.context.client.clientName
      ? cfg.context
      : { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' } };

    const first = await innertube({ context, videoId }, cfg.apiKey);
    const acc0 = { comments: [], tokens: [], commentSectionToken: null };
    harvest(first, acc0);

    let token = acc0.commentSectionToken || acc0.tokens[acc0.tokens.length - 1] || null;
    if (!token) throw new Error('no comment continuation token');

    const comments = [];
    let pages = 0;
    while (token && comments.length < settings.maxComments && pages < 12) {
      pages += 1;
      let data;
      try {
        data = await innertube({ context, continuation: token }, cfg.apiKey);
      } catch (e) {
        break;
      }
      const acc = { comments: [], tokens: [], commentSectionToken: null };
      harvest(data, acc);
      if (!acc.comments.length && !acc.tokens.length) break;
      comments.push(...acc.comments);
      token = acc.tokens.length ? acc.tokens[acc.tokens.length - 1] : null;
      if (comments.length && !acc.comments.length) break;
    }
    log('api comments:', comments.length, 'pages:', pages);
    return comments;
  }

  /* -------------------------------------------------- comment fetching (DOM) */

  function fetchCommentsFromDom() {
    const nodes = document.querySelectorAll(
      'ytd-comment-thread-renderer #content-text, ytd-comment-view-model #content-text'
    );
    const out = [];
    nodes.forEach((n) => {
      const host = n.closest('ytd-comment-thread-renderer, ytd-comment-view-model');
      const authorEl = host && host.querySelector('#author-text');
      const img = host && host.querySelector('#author-thumbnail img');
      out.push({
        text: n.innerText || n.textContent || '',
        author: authorEl ? (authorEl.innerText || '').trim() : '',
        avatar: img ? img.src : '',
        likes: 0
      });
    });
    log('dom comments:', out.length);
    return out;
  }

  /* ------------------------------------------------------------- marker build */

  function buildEntries(comments, duration) {
    const byTime = new Map();
    for (const c of comments) {
      if (!c || !c.text) continue;
      if ((c.likes || 0) < settings.minLikes) continue;
      const stamps = extractTimestamps(c.text);
      if (!stamps.length) continue;
      const isChapterList = stamps.length > 4;
      for (const s of stamps) {
        if (s.seconds < 0) continue;
        if (duration && s.seconds > duration - 0.5) continue;
        // one entry per (author, second) so the same comment isn't duplicated
        const key = `${Math.round(s.seconds)}|${c.author}`;
        if (byTime.has(key)) continue;
        byTime.set(key, {
          t: s.seconds,
          text: c.text.trim(),
          author: c.author || '',
          avatar: c.avatar || '',
          likes: c.likes || 0,
          chapterish: isChapterList
        });
      }
    }
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  }

  // Group timestamps that land at (roughly) the same moment.
  function clusterEntries(entries, duration) {
    const gap = Math.min(8, Math.max(1.5, (duration || 600) / 600));
    const clusters = [];
    for (const e of entries) {
      const last = clusters[clusters.length - 1];
      if (last && e.t - last.t <= gap) {
        last.items.push(e);
      } else {
        clusters.push({ t: e.t, items: [e] });
      }
    }
    for (const c of clusters) {
      // most-liked comment leads; the rest become floating avatars
      c.items.sort((a, b) => b.likes - a.likes);
      c.chapterish = c.items.every((i) => i.chapterish);
      if (c.items.length > 8) c.items.length = 8; // keep the avatar strip sane
    }
    return clusters;
  }

  function capClusters(clusters) {
    if (clusters.length <= settings.maxMarkers) return clusters;
    const score = (c) => c.items.reduce((n, i) => n + i.likes, 0) + c.items.length;
    return clusters
      .slice()
      .sort((a, b) => score(b) - score(a))
      .slice(0, settings.maxMarkers)
      .sort((a, b) => a.t - b.t);
  }

  /* ------------------------------------------------------------------- render */

  function ensureLayers() {
    const bar = document.querySelector('.ytp-progress-bar-container') ||
      document.querySelector('.ytp-progress-bar');
    const player = document.querySelector('#movie_player') ||
      document.querySelector('.html5-video-player');
    if (!bar || !player) return false;

    if (!state.markerLayer || !state.markerLayer.isConnected) {
      const layer = document.createElement('div');
      layer.className = 'ytct-marker-layer';
      bar.appendChild(layer);
      state.markerLayer = layer;
    }
    if (state.barEl !== bar) {
      bar.addEventListener('mouseenter', onBarEnter);
      bar.addEventListener('mousemove', onBarMove);
      bar.addEventListener('mouseleave', onBarLeave);
      state.barEl = bar;
    }
    if (!state.bubbleLayer || !state.bubbleLayer.isConnected) {
      const bl = document.createElement('div');
      bl.className = 'ytct-bubble-layer';
      player.appendChild(bl);
      state.bubbleLayer = bl;
    }
    state.player = player;
    return true;
  }

  function clearUi() {
    if (state.markerLayer) state.markerLayer.innerHTML = '';
    if (state.bubbleLayer) state.bubbleLayer.innerHTML = '';
    liveBubbles.clear();
    hideHoverCard(true);
  }

  function renderMarkers(duration) {
    if (!ensureLayers()) return;
    state.markerLayer.innerHTML = '';
    state.markerLayer.style.setProperty('--ytct-color', settings.markerColor);
    const avSize = Math.min(40, Math.max(4, Number(settings.avatarSize) || 15));
    state.markerLayer.style.setProperty('--ytct-avatar-size', `${avSize}px`);
    if (!duration) return;

    const barWidth = (state.barEl && state.barEl.getBoundingClientRect().width) || 0;
    let lastAvatarX = -Infinity;

    for (const c of state.clusters) {
      const pct = (c.t / duration) * 100;

      const el = document.createElement('div');
      el.className = 'ytct-marker' +
        (c.items.length > 1 ? ' ytct-marker--multi' : '') +
        (c.chapterish ? ' ytct-marker--chapter' : '');
      // clamped so a marker at 0:00 or at the very end isn't half cut off
      el.style.left = `clamp(1px, ${pct}%, calc(100% - 1px))`;
      state.markerLayer.appendChild(el);
      c.el = el;

      if (settings.markerAvatars) {
        const px = barWidth ? (c.t / duration) * barWidth : 0;
        // don't stack avatars on top of each other in dense stretches
        if (!barWidth || px - lastAvatarX >= avSize + 2) {
          lastAvatarX = px;
          const av = avatarNode(c.items[0], false);
          av.classList.add('ytct-marker-avatar');
          if (c.items.length > 1) av.classList.add('ytct-marker-avatar--multi');
          const edge = Math.round(avSize / 2);
          av.style.left = `clamp(${edge}px, ${pct}%, calc(100% - ${edge}px))`;
          state.markerLayer.appendChild(av);
        }
      }
    }
    log('rendered clusters:', state.clusters.length);
  }

  /* --------------------------------------------------------------- card build */

  function avatarNode(item, small) {
    const wrap = document.createElement('div');
    wrap.className = small ? 'ytct-avatar ytct-avatar--sm' : 'ytct-avatar';
    const initial = (item.author || '?').replace(/^@/, '').charAt(0).toUpperCase() || '?';
    wrap.textContent = initial;
    if (item.avatar) {
      const img = document.createElement('img');
      img.src = item.avatar;
      img.alt = '';
      img.addEventListener('load', () => { wrap.textContent = ''; wrap.appendChild(img); });
      img.addEventListener('error', () => { /* keep the initial */ });
    }
    return wrap;
  }

  function commentRow(item) {
    const row = document.createElement('div');
    row.className = 'ytct-item';

    const body = document.createElement('div');
    body.className = 'ytct-body';

    const head = document.createElement('div');
    head.className = 'ytct-head';
    const who = document.createElement('span');
    who.className = 'ytct-author';
    who.textContent = item.author || 'someone';
    const when = document.createElement('span');
    when.className = 'ytct-time';
    when.textContent = fmt(item.t);
    head.appendChild(who);
    head.appendChild(when);

    const text = document.createElement('div');
    text.className = 'ytct-text';
    text.textContent = item.text.length > 240 ? `${item.text.slice(0, 240)}…` : item.text;

    body.appendChild(head);
    body.appendChild(text);
    row.appendChild(avatarNode(item));
    row.appendChild(body);
    return row;
  }

  const HOVER_MAX_ITEMS = 6;

  /** Scrubbing card: every comment at this spot, stacked - no tabs. */
  function buildStackCard(cluster, className) {
    const card = document.createElement('div');
    card.className = `ytct-card ytct-stack ${className || ''}`.trim();

    const shown = cluster.items.slice(0, HOVER_MAX_ITEMS);
    shown.forEach((it) => card.appendChild(commentRow(it)));

    if (cluster.items.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'ytct-more';
      more.textContent = `+${cluster.items.length - shown.length} more at this spot`;
      card.appendChild(more);
    }

    card.addEventListener('click', () => {
      if (state.video) state.video.currentTime = cluster.t;
    });
    return card;
  }

  /**
   * A card = one comment on show + (optionally) the other comments of the
   * cluster as small avatars floating above it.
   */
  function buildCard(cluster, className) {
    const card = document.createElement('div');
    card.className = `ytct-card ${className || ''}`.trim();

    const others = document.createElement('div');
    others.className = 'ytct-others';

    const main = document.createElement('div');
    main.className = 'ytct-main';

    const body = document.createElement('div');
    body.className = 'ytct-body';

    const head = document.createElement('div');
    head.className = 'ytct-head';
    const who = document.createElement('span');
    who.className = 'ytct-author';
    const when = document.createElement('span');
    when.className = 'ytct-time';
    head.appendChild(who);
    head.appendChild(when);

    const text = document.createElement('div');
    text.className = 'ytct-text';

    body.appendChild(head);
    body.appendChild(text);

    let avatarHolder = document.createElement('div');
    avatarHolder.className = 'ytct-main-avatar';
    main.appendChild(avatarHolder);
    main.appendChild(body);

    const show = (idx) => {
      const it = cluster.items[idx];
      if (!it) return;
      who.textContent = it.author || 'someone';
      when.textContent = fmt(it.t);
      text.textContent = it.text.length > 340 ? `${it.text.slice(0, 340)}…` : it.text;
      avatarHolder.innerHTML = '';
      avatarHolder.appendChild(avatarNode(it));
      [...others.children].forEach((n, i) => n.classList.toggle('ytct-avatar--active', i === idx));
    };

    if (cluster.items.length > 1) {
      cluster.items.forEach((it, i) => {
        const a = avatarNode(it, true);
        a.title = `${it.author || 'someone'} - ${fmt(it.t)}`;
        a.addEventListener('mouseenter', () => show(i));
        a.addEventListener('click', (ev) => { ev.stopPropagation(); show(i); });
        others.appendChild(a);
      });
      card.appendChild(others);
    }
    card.appendChild(main);
    show(0);

    card.addEventListener('click', () => {
      if (state.video) state.video.currentTime = cluster.t;
    });

    return card;
  }

  /* ------------------------------------------------------------ auto popups */

  function showBubble(cluster) {
    if (!ensureLayers()) return;
    const id = `c${Math.round(cluster.t)}`;
    if (state.bubbleLayer.querySelector(`[data-ytct-id="${id}"]`)) return;

    // one at a time: a new comment takes the place of whatever is still up,
    // rather than stacking on top of it when comments come back to back
    for (const old of [...liveBubbles]) dismiss(old, true);

    const card = buildCard(cluster, 'ytct-bubble');
    card.dataset.ytctId = id;

    if (settings.popupCenter) {
      // centred by the stylesheet (auto margins) so the wiggle keyframes,
      // which own `transform`, don't fight a translateX(-50%)
      card.classList.add('ytct-bubble--center');
    } else {
      const pct = state.video && state.video.duration ? (cluster.t / state.video.duration) * 100 : 50;
      card.style.left = `${Math.min(84, Math.max(2, pct))}%`;
    }
    card.style.bottom = '0px';

    const rec = { el: card, remaining: Math.max(1, Number(settings.popupDuration) || 5) * 1000, hovered: false };
    card.addEventListener('mouseenter', () => { rec.hovered = true; });
    card.addEventListener('mouseleave', () => { rec.hovered = false; });

    state.bubbleLayer.appendChild(card);
    liveBubbles.add(rec);
    requestAnimationFrame(() => card.classList.add('ytct-card--in'));
  }

  function dismiss(rec, fast) {
    liveBubbles.delete(rec);
    rec.el.classList.remove('ytct-card--in');
    if (fast) rec.el.classList.add('ytct-card--out');
    setTimeout(() => rec.el.remove(), fast ? 170 : 300);
  }

  setInterval(() => {
    if (!liveBubbles.size) return;
    // frozen while the video is paused: pause on a comment and read it
    const paused = !state.video || state.video.paused;
    if (paused) {
      for (const rec of liveBubbles) rec.frozen = true;
      return;
    }
    for (const rec of [...liveBubbles]) {
      if (rec.hovered) continue;
      rec.remaining -= 250;
      if (rec.remaining <= 0) dismiss(rec);
    }
  }, 250);

  // pressing play clears whatever was left on screen by the pause
  function onPlay() {
    for (const rec of [...liveBubbles]) {
      if (rec.frozen) dismiss(rec);
    }
  }

  /* -------------------------------------------------------- timeline hovering */

  function clusterNearPixel(clientX, rect) {
    if (!state.video || !state.video.duration || !state.clusters.length) return null;
    const dur = state.video.duration;
    let best = null;
    let bestDist = Infinity;
    for (const c of state.clusters) {
      const x = rect.left + (c.t / dur) * rect.width;
      const d = Math.abs(x - clientX);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return bestDist <= 9 ? best : null;
  }

  // while the timeline is being scrubbed, the auto-popups get out of the way
  function setScrubbing(on) {
    if (!state.bubbleLayer) return;
    state.bubbleLayer.classList.toggle('ytct-scrubbing', !!on);
  }

  function onBarEnter() {
    if (!settings.enabled) return;
    if (ensureLayers()) setScrubbing(true);
  }

  function onBarMove(ev) {
    if (!settings.enabled || !state.clusters.length) return;
    const rect = state.barEl.getBoundingClientRect();
    const cluster = clusterNearPixel(ev.clientX, rect);
    if (!cluster) { scheduleHoverHide(); return; }
    showHoverCard(cluster, rect);
  }

  function onBarLeave() {
    scheduleHoverHide();
  }

  function scheduleHoverHide() {
    clearTimeout(state.hoverHideTimer);
    state.hoverHideTimer = setTimeout(() => {
      if (state.hoverCardOver) return;
      hideHoverCard();
      // only bring the playing popup back once the pointer has left the bar
      const overBar = state.barEl && state.barEl.matches(':hover');
      if (!overBar) setScrubbing(false);
    }, 160);
  }

  function hideHoverCard(now) {
    if (!state.hoverCard) return;
    const el = state.hoverCard;
    state.hoverCard = null;
    state.hoverCardCluster = null;
    el.classList.remove('ytct-card--in');
    if (now) el.remove();
    else setTimeout(() => el.remove(), 250);
  }

  function showHoverCard(cluster, barRect) {
    if (!ensureLayers()) return;
    clearTimeout(state.hoverHideTimer);
    if (state.hoverCard && state.hoverCardCluster === cluster) return;
    hideHoverCard(true);

    const card = buildStackCard(cluster, 'ytct-hovercard');
    card.addEventListener('mouseenter', () => { state.hoverCardOver = true; });
    card.addEventListener('mouseleave', () => { state.hoverCardOver = false; scheduleHoverHide(); });

    state.bubbleLayer.appendChild(card);
    state.hoverCard = card;
    state.hoverCardCluster = cluster;

    // Anchor to YouTube's own preview tooltip, both axes. YouTube pulls the
    // preview inwards near the start and the end of the bar, so anchoring to
    // the marker instead would leave the card adrift at the first/last marker.
    const layerRect = state.bubbleLayer.getBoundingClientRect();
    const playerRect = state.player.getBoundingClientRect();
    const tip = document.querySelector('.ytp-tooltip:not([style*="display: none"])') ||
      document.querySelector('.ytp-tooltip');
    const tr = tip ? tip.getBoundingClientRect() : null;
    const haveTip = !!(tr && tr.width > 0 && tr.height > 0);

    // the "Pull up for precise seeking" hint sits OUTSIDE the tooltip box, so
    // clear the topmost edge of anything tooltip-ish, not just the thumbnail
    let tipTop = haveTip ? tr.top : Infinity;
    document.querySelectorAll('.ytp-tooltip, .ytp-tooltip-edu, .ytp-tooltip-title').forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top < tipTop) tipTop = r.top;
    });

    card.style.bottom = `${Math.max(6, Number.isFinite(tipTop) ? Math.round(layerRect.top - tipTop + 14) : 40)}px`;

    const dur = state.video && state.video.duration ? state.video.duration : 0;
    const markerX = dur ? barRect.left + (cluster.t / dur) * barRect.width : barRect.left;
    // centre of the preview if we have one, otherwise centre of the marker
    let cx = (haveTip ? tr.left + tr.width / 2 : markerX) - playerRect.left;
    const half = card.offsetWidth / 2;
    cx = Math.min(playerRect.width - half - 12, Math.max(half + 12, cx));
    card.style.left = `${Math.round(cx)}px`; // the card carries translateX(-50%)

    requestAnimationFrame(() => card.classList.add('ytct-card--in'));
  }

  /* ----------------------------------------------------------- playback hook */

  function onTimeUpdate() {
    const v = state.video;
    if (!v || !settings.enabled || !settings.autoPopup) { if (v) state.lastTime = v.currentTime; return; }
    const now = v.currentTime;
    const delta = now - state.lastTime;
    if (delta > 0 && delta < 2) {
      for (const c of state.clusters) {
        if (c.t > state.lastTime && c.t <= now) showBubble(c);
      }
    }
    state.lastTime = now;
  }

  function attachVideo(v) {
    if (state.video === v) return;
    if (state.video) {
      state.video.removeEventListener('timeupdate', onTimeUpdate);
      state.video.removeEventListener('play', onPlay);
    }
    state.video = v;
    state.lastTime = v ? v.currentTime : 0;
    if (v) {
      v.addEventListener('timeupdate', onTimeUpdate);
      v.addEventListener('play', onPlay);
    }
  }

  /* ------------------------------------------------------------------- main */

  async function run(videoId, { force = false } = {}) {
    if (state.loading) return;
    if (!force && state.videoId === videoId && state.clusters.length) return;

    state.loading = true;
    state.videoId = videoId;
    state.clusters = [];
    state.status = 'loading';
    clearUi();

    try {
      const video = await waitFor(
        () => document.querySelector('#movie_player video') || document.querySelector('video.html5-main-video'),
        20000
      );
      if (!video) throw new Error('no video element');
      attachVideo(video);

      await waitFor(() => video.duration && Number.isFinite(video.duration), 20000);

      let comments = [];
      try {
        comments = await fetchCommentsViaApi(videoId);
      } catch (e) {
        log('api failed, falling back to DOM:', e.message);
      }
      if (!comments.length) comments = fetchCommentsFromDom();

      const entries = buildEntries(comments, video.duration);
      state.clusters = capClusters(clusterEntries(entries, video.duration));
      state.status = `${entries.length} timestamp(s) in ${state.clusters.length} spot(s), from ${comments.length} comment(s)`;
      renderMarkers(video.duration);
      state.lastTime = video.currentTime;
    } catch (e) {
      state.status = `error: ${e.message}`;
      log('run failed', e);
    } finally {
      state.loading = false;
    }
  }

  function stop() {
    clearUi();
    state.clusters = [];
  }

  async function boot({ force = false } = {}) {
    settings = await getSettings();
    const id = videoIdFromUrl();
    if (!id) { stop(); state.videoId = null; return; }
    if (!settings.enabled) { stop(); return; }
    await run(id, { force });
  }

  /* ------------------------------------------------------------- navigation */

  let lastHref = location.href;
  document.addEventListener('yt-navigate-finish', () => setTimeout(() => boot(), 400));
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(() => boot(), 600);
    }
  }, 800);

  // Re-attach the marker layer if YouTube rebuilds the player chrome.
  setInterval(() => {
    if (!state.clusters.length) return;
    if (!state.markerLayer || !state.markerLayer.isConnected || !state.markerLayer.children.length) {
      if (state.video && state.video.duration) renderMarkers(state.video.duration);
    }
  }, 3000);

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      getSettings().then((s) => {
        const wasEnabled = settings.enabled;
        settings = s;
        if (!s.enabled) { stop(); return; }
        if (!wasEnabled) { boot({ force: true }); return; }
        if (state.video && state.video.duration && state.clusters.length) renderMarkers(state.video.duration);
      });
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return;
      if (msg.type === 'ytct:rescan') { boot({ force: true }).then(() => sendResponse({ ok: true })); return true; }
      if (msg.type === 'ytct:status') {
        sendResponse({ ok: true, status: state.status, markers: state.clusters.length, videoId: state.videoId });
        return true;
      }
      return undefined;
    });
  } catch (e) { /* ignore */ }

  boot();
})();
