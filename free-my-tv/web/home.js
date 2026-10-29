/*
 * The home screen for web-app TVs (LG webOS, Samsung Tizen), with the Android app's design and behavior (HomeView):
 *  - top: the "For You" title and the tabs (Explore, Movies, Shows); icon-only glass buttons at the right (Live TV,
 *    HDMI Inputs, Settings) and the crypto quotes at the end of the tab row;
 *  - three picks for this hour in the selected tab; the background is the first one's photo, blurred and almost white;
 *  - the glass shelf with the apps; ↓ opens the drawer (inputs, shortcuts, weather, prices); ↑ or Back closes it;
 *  - a night look from sunset to sunrise; a screensaver after a few idle minutes.
 * The remote's arrows, OK and Back move the focus; a pointer (LG's Magic Remote) focuses what it points at.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function sym(name, parent, size) {
    var s = el('span', 'sym', parent);
    s.style.webkitMaskImage = 'url(symbols/' + name + '.png)';
    s.style.maskImage = 'url(symbols/' + name + '.png)';
    if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
    return s;
  }

  function coin(i, parent) {
    var c = window.COINS && window.COINS[i];
    if (!c) return;
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    for (var k = 0; k < c.length; k++) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', c[k]);
      p.setAttribute('fill-rule', 'evenodd');
      svg.appendChild(p);
    }
    parent.appendChild(svg);
  }

  function hasClass(e, c) { return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; }
  function setClass(e, c, on) {
    if (!e) return;
    if (on && !hasClass(e, c)) e.className = (e.className + ' ' + c).replace(/^\s+/, '');
    else if (!on && hasClass(e, c)) e.className = (' ' + e.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }

  var stage = $('stage'), body = document.body;

  /** The 1920 × 1080 stage fills the window (on the TV it already is 1920 × 1080). */
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.webkitTransform = stage.style.transform = s === 1 ? '' : 'scale(' + s + ')';
  }

  // MARK: - Apps on the shelf

  /** Shelf apps in this order when installed, like the Android app: key, LG app id, name on the TV, brand gradient. */
  var SHELF = [
    ['livetv', /^com\.webos\.app\.livetv$/, /^tv$|live tv|tv aberta|tv ao vivo/i, ['#1E3C72', '#16222F']],
    ['netflix', /^netflix$/, /netflix/i, ['#0A0A0A', '#000000']],
    ['youtube', /youtube/, /^youtube$/i, ['#1C1C1E', '#09090A']],
    ['prime', /^amazon$/, /prime video|amazon/i, ['#2AA8FF', '#0A68D4']],
    ['disney', /disney/, /disney/i, ['#173584', '#08143F']],
    ['max', /hbo|wbd/, /^(hbo )?max$|hbo max/i, ['#5C30E8', '#221684']],
    ['appletv', /appletv|apple\.tv/, /apple tv/i, ['#1C1C1E', '#000000']],
    ['hulu', /^hulu/, /hulu/i, ['#1CE783', '#0B8F4E']],
    ['paramount', /paramount|cbs/, /paramount/i, ['#0064FF', '#002A86']],
    ['peacock', /peacock/, /peacock/i, ['#1C1C1E', '#000000']],
    ['nfl', /nfl/, /^nfl/i, ['#013369', '#00163D']],
    ['globoplay', /globoplay/, /globoplay/i, ['#FF8A1F', '#FF2D5A']],
    ['jellyfin', /jellyfin/i, /jellyfin/i, ['#AA5CC3', '#00A4DC']],
    ['spotify', /spotify/, /spotify/i, ['#1DB954', '#0F7A36']]
  ];
  // Apps shown at once, as on Android: 8 (today's smallest tiles, 178 wide); the shelf scrolls for the rest. The
  // built-in list keeps 8 too.
  var SHELF_VISIBLE = 8, FEW_APPS = 8;

  function shelfKey(app) {
    for (var i = 0; i < SHELF.length; i++) if (SHELF[i][1].test(app.id) || SHELF[i][2].test(app.title)) return SHELF[i];
    return null;
  }

  function darken(hex, f) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#161618';
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(r * f) + ',' + Math.round(g * f) + ',' + Math.round(b * f) + ')';
  }

  /** A name that fits the tile on one line (the font shrinks for long names). */
  function wordFit(title, width, max) {
    return Math.max(18, Math.min(max, Math.floor(width * 0.8 / (Math.max(4, title.length) * 0.56))));
  }

  // MARK: - Logos

  // The TV's icons are small squares with their own background (white behind Netflix, black behind Max). Like the
  // Android app does with the TV art, the logo is lifted off it once: the background goes transparent and the rest is
  // cropped to the logo, which then fills the tile on the brand's color.
  var lifted = {};   // icon url -> {src, bg: [r, g, b], ink: luminance histogram} or false (keep the icon as it is)
  var LIFT_SIZE = 120;

  // sRGB (0-255) to linear light, computed once: lift() needs it for every pixel, and old TVs are slow at Math.pow.
  var LINEAR = [];
  for (var li = 0; li < 256; li++) LINEAR[li] = li <= 10 ? li / 255 / 12.92 : Math.pow((li / 255 + 0.055) / 1.055, 2.4);

  /** Relative luminance (0-1) of an sRGB color (whole numbers, as read from the canvas). */
  function luminance(r, g, b) {
    return 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
  }

  function rgbOf(color) {
    var m = /^#?([0-9a-f]{6})$/i.exec(color || '');
    if (m) { var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color || '');
    return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  }

  function lift(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return false;
    var f = Math.min(1, LIFT_SIZE / Math.max(w, h));
    w = Math.max(1, Math.round(w * f));
    h = Math.max(1, Math.round(h * f));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var g = canvas.getContext('2d');
    var data;
    try {
      g.drawImage(img, 0, 0, w, h);
      data = g.getImageData(0, 0, w, h);
    } catch (e) {
      return false;   // a TV that doesn't let the page read its icons
    }
    var px = data.data;
    // The background: the most common color a little inside the edges (rounded icons have transparent corners).
    var votes = {}, best = null, bestN = 0, inset = Math.round(Math.min(w, h) * 0.08);
    for (var s = 0; s < 64; s++) {
      var t = s % 16 / 16, side = s >> 4;
      var x = side < 2 ? Math.round(inset + t * (w - 2 * inset)) : side === 2 ? inset : w - 1 - inset;
      var y = side < 2 ? (side === 0 ? inset : h - 1 - inset) : Math.round(inset + t * (h - 2 * inset));
      var i = (y * w + x) * 4;
      var key = px[i + 3] < 128 ? 'clear' : (px[i] >> 4) + ',' + (px[i + 1] >> 4) + ',' + (px[i + 2] >> 4);
      votes[key] = (votes[key] || 0) + 1;
      if (votes[key] > bestN) { bestN = votes[key]; best = key === 'clear' ? null : [px[i], px[i + 1], px[i + 2]]; }
    }
    var minX = w, minY = h, maxX = -1, maxY = -1, ink = [0, 0, 0, 0, 0, 0, 0, 0], inkSum = 0;
    for (var p = 0; p < w * h; p++) {
      var j = p * 4, a = px[j + 3] / 255;
      if (best) {
        // color to alpha: how far each channel is from the background, as a share of how far it could go, so the
        // anti-aliased edges come out as the logo's color, partly clear, without a fringe of the background
        var k = 0, c;
        for (c = 0; c < 3; c++) {
          var v = px[j + c], o = best[c];
          k = Math.max(k, v > o ? (v - o) / Math.max(1, 255 - o) : (o - v) / Math.max(1, o));
        }
        k = Math.max(0, Math.min(1, (k - 0.1) / 0.9));   // compression noise stays clear
        if (k > 0 && k < 1) {
          for (c = 0; c < 3; c++) px[j + c] = Math.max(0, Math.min(255, best[c] + (px[j + c] - best[c]) / k));
        }
        a *= k;
      }
      px[j + 3] = Math.round(a * 255);
      if (a > 0.3) {
        var px0 = p % w, py0 = (p / w) | 0;
        if (px0 < minX) minX = px0;
        if (px0 > maxX) maxX = px0;
        if (py0 < minY) minY = py0;
        if (py0 > maxY) maxY = py0;
        ink[Math.min(7, Math.floor(Math.sqrt(luminance(px[j], px[j + 1], px[j + 2])) * 8))] += a;
        inkSum += a;
      }
    }
    // Nothing left, or nothing taken away (a picture rather than a logo on a background): keep the icon.
    if (maxX < 0 || (maxX - minX > w * 0.96 && maxY - minY > h * 0.96)) {
      canvas.width = canvas.height = 0;
      return false;
    }
    var crop = document.createElement('canvas');
    crop.width = maxX - minX + 1;
    crop.height = maxY - minY + 1;
    g.putImageData(data, 0, 0);
    crop.getContext('2d').drawImage(canvas, minX, minY, crop.width, crop.height, 0, 0, crop.width, crop.height);
    canvas.width = canvas.height = 0;
    for (var b = 0; b < 8; b++) ink[b] /= inkSum;
    try {
      var dataUrl = crop.toDataURL('image/png');
      crop.width = crop.height = 0;
      return {src: dataUrl, bg: best, ink: ink};
    } catch (e2) {
      crop.width = crop.height = 0;
      return false;
    }
  }

  /**
   * Share of the logo that hardly shows on a tile of this luminance (YouTube's black type on a dark tile). Each bin
   * of the histogram holds the ink whose square-root luminance falls in it.
   */
  function unseen(ink, tileLum) {
    var share = 0;
    for (var b = 0; b < 8; b++) {
      var l = Math.pow((b + 0.5) / 8, 2);
      if ((Math.max(l, tileLum) + 0.05) / (Math.min(l, tileLum) + 0.05) < 1.8) share += ink[b];
    }
    return share;
  }

  function paint(box, top, bottom) {
    box.style.background = '-webkit-linear-gradient(top, ' + top + ', ' + bottom + ')';
    box.style.background = 'linear-gradient(' + top + ', ' + bottom + ')';
  }

  /** A color that is clearly a hue (Crunchyroll's orange), not black, white or a gray. */
  function colorful(rgb) {
    return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]) >= 96;
  }

  /** own: the tile has the TV's color for the app, not one of SHELF's. */
  function showLogo(img, box, top, bottom, logo, own) {
    img.className = 'logo';
    img.src = logo.src;
    var a = rgbOf(top), z = rgbOf(bottom);
    var tileLum = (luminance(a[0], a[1], a[2]) + luminance(z[0], z[1], z[2])) / 2;
    // The tile takes the icon's background when the logo only reads on it, and when that background is the brand's
    // color: LG's bgColor isn't always the icon's (Crunchyroll's is black, on an orange icon).
    if (logo.bg && ((own && colorful(logo.bg)) || unseen(logo.ink, tileLum) > 0.35)) {
      var bg = 'rgb(' + logo.bg.join(',') + ')';
      var hex = '#' + ((1 << 24) | (logo.bg[0] << 16) | (logo.bg[1] << 8) | logo.bg[2]).toString(16).slice(1);
      paint(box, bg, darken(hex, 0.93));
    }
  }

  /** An app's face: its logo on its brand color (or its name, when the icon can't be read). */
  function face(app, box, wordSize) {
    var k = shelfKey(app);
    var top = k ? k[3][0] : app.color ? darken(app.color, 0.92) : '#2A2A2E';
    var bottom = k ? k[3][1] : app.color ? darken(app.color, 0.62) : '#161618';
    paint(box, top, bottom);
    var word = el('div', 'word', box, app.title);
    if (wordSize) word.style.fontSize = wordSize + 'px';
    if (app.id === 'com.webos.app.livetv') {
      box.className += ' has-sym';
      var s = sym('live_tv', box);
      s.className += ' tile-sym';
      return;
    }
    if (app.icon) {
      var img = el('img', '', box), url = app.icon;
      word.style.visibility = 'hidden';
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); word.style.visibility = ''; };
      if (lifted[url]) { showLogo(img, box, top, bottom, lifted[url], !k); return; }
      if (lifted[url] !== false) {
        img.onload = function () {
          img.onload = null;
          if (lifted[url] === undefined) lifted[url] = lift(img);
          if (lifted[url]) showLogo(img, box, top, bottom, lifted[url], !k);
        };
      }
      img.src = url;
    }
  }

  var apps = [], shelf = [], others = [], inputs = [];

  /** shelf_apps in config.properties: the shelf in that order, by id or name (part of it). */
  var WANTED = (CONFIG.shelfApps || []).map(function (s) { return s.toLowerCase(); });

  function pickShelf() {
    if (WANTED.length && Prefs.shelfConfig() !== WANTED.join(',')) {
      Prefs.set('shelf', null);
      Prefs.set('shelfConfig', WANTED.join(','));
    }
    var chosen = Prefs.shelf(), out = [];
    if (chosen) {
      for (var i = 0; i < chosen.length; i++) {
        var cid = chosen[i];
        for (var j = 0; j < apps.length; j++) {
          if (apps[j].id === cid && out.indexOf(apps[j]) < 0) {
            out.push(apps[j]);
            break;
          }
        }
      }
    } else if (WANTED.length) {
      for (var w = 0; w < WANTED.length; w++) {
        for (var k = 0; k < apps.length; k++) {
          var id = apps[k].id.toLowerCase(), title = apps[k].title.toLowerCase();
          if ((id.indexOf(WANTED[w]) >= 0 || title.indexOf(WANTED[w]) >= 0) && out.indexOf(apps[k]) < 0) { out.push(apps[k]); break; }
        }
      }
      if (!out.length) out = apps.slice(0, FEW_APPS);
    } else {
      for (var s = 0; s < SHELF.length && out.length < FEW_APPS; s++) {
        for (var a = 0; a < apps.length; a++) {
          if ((SHELF[s][1].test(apps[a].id) || SHELF[s][2].test(apps[a].title)) && out.indexOf(apps[a]) < 0) { out.push(apps[a]); break; }
        }
      }
      if (!out.length) out = apps.slice(0, FEW_APPS);
    }
    // Guarantee TV Aberta is always the first icon on the shelf
    var liveIndex = -1;
    for (var l = 0; l < out.length; l++) {
      if (out[l].id === 'com.webos.app.livetv') {
        liveIndex = l;
        break;
      }
    }
    if (liveIndex > 0) {
      var liveApp = out.splice(liveIndex, 1)[0];
      out.unshift(liveApp);
    } else if (liveIndex < 0) {
      for (var la = 0; la < apps.length; la++) {
        if (apps[la].id === 'com.webos.app.livetv') {
          out.unshift(apps[la]);
          break;
        }
      }
    }
    shelf = out;
    others = apps.filter(function (x) { return shelf.indexOf(x) < 0; });
  }

  // MARK: - Focus

  var Z = {TOP: 'top', CARDS: 'cards', SHELF: 'shelf', DRAWER: 'drawer', APPS: 'apps', SETTINGS: 'settings', EDIT: 'edit', LANG: 'lang', POWERON: 'poweron', USB: 'usb'};
  var st = {zone: Z.SHELF, top: 0, tab: 0, card: 0, shelf: 0, drawer: 0, grid: 0, row: 0, edit: 0, lang: 0, poweron: 0, usb: 0};
  var cards = [];

  function sheetOpen() { return st.zone === Z.APPS || st.zone === Z.SETTINGS || st.zone === Z.EDIT || st.zone === Z.LANG || st.zone === Z.POWERON || st.zone === Z.USB; }

  var APP_INFO = {
    'com.webos.app.livetv': {
      title: 'TV Aberta',
      tagline: 'Sinal digital e canais abertos ao vivo na sua TV',
      badge: 'AO VIVO',
      hint: 'Pressione OK para sintonizar a TV',
      channelName: 'Sintonizador TV Aberta',
      subText: 'Sinal Digital HD · Pressione OK para tela cheia'
    },
    'youtube': {
      title: 'YouTube',
      tagline: 'Vídeos em alta, canais inscritos e recomendações personalizadas',
      badge: 'EM ALTA',
      hint: 'Pressione OK para abrir o YouTube',
      preview: 'wallpapers/preview_youtube.jpg',
      channelName: 'YouTube Brasil',
      subText: 'Destaques e vídeos mais assistidos'
    },
    'netflix': {
      title: 'Netflix',
      tagline: 'Filmes aclamados, séries globais e originais exclusivos',
      badge: 'TOP 10',
      hint: 'Pressione OK para abrir a Netflix',
      preview: 'wallpapers/preview_netflix.jpg',
      channelName: 'Netflix Brasil',
      subText: 'The Aeon\'s Edge · Lançamento em Alta'
    },
    'prime': {
      title: 'Prime Video',
      tagline: 'Filmes, séries e produções Amazon Originals',
      badge: 'STREAMING',
      hint: 'Pressione OK para abrir o Prime Video',
      preview: 'wallpapers/sunset.jpg',
      channelName: 'Prime Video Brasil',
      subText: 'Filmes e Séries Exclusivas'
    },
    'globoplay': {
      title: 'Globoplay',
      tagline: 'Novelas consagradas, séries originais e jornalismo ao vivo',
      badge: 'DESTAQUES',
      hint: 'Pressione OK para abrir o Globoplay',
      preview: 'wallpapers/preview_globoplay.jpg',
      channelName: 'Globoplay Originais',
      subText: 'Marés do Crime · Nova Série Original'
    },
    'max': {
      title: 'Max',
      tagline: 'HBO, Warner Bros, Max Originals e Universo DC',
      badge: 'STREAMING',
      hint: 'Pressione OK para abrir o Max',
      preview: 'wallpapers/aurora.jpg',
      channelName: 'Max Originals',
      subText: 'Filmes e séries HBO'
    },
    'disney': {
      title: 'Disney+',
      tagline: 'Disney, Pixar, Marvel, Star Wars e National Geographic',
      badge: 'STREAMING',
      hint: 'Pressione OK para abrir o Disney+',
      preview: 'wallpapers/aurora.jpg',
      channelName: 'Disney+ Destaques',
      subText: 'Universo Marvel & Star Wars'
    },
    'spotify': {
      title: 'Spotify',
      tagline: 'Músicas, playlists recomendadas e podcasts sem parar',
      badge: 'PLAYLISTS',
      hint: 'Pressione OK para abrir o Spotify',
      preview: 'wallpapers/preview_spotify.jpg',
      channelName: 'Spotify · Neon Rhythms',
      subText: 'Ultra HD Audio · Top 50 Brasil'
    },
    'jellyfin': {
      title: 'Jellyfin',
      tagline: 'Sua central de mídia local e streaming particular',
      badge: 'MÍDIA LOCAL',
      hint: 'Pressione OK para conectar',
      preview: 'wallpapers/photo_praia.jpg',
      channelName: 'Jellyfin Media Server',
      subText: 'Biblioteca de Filmes & Mídia Pessoal'
    },
    'browser': {
      title: 'Navegador Web',
      tagline: 'Navegue na web em tela cheia na sua TV',
      badge: 'NAVEGADOR',
      hint: 'Pressione OK para abrir',
      preview: 'wallpapers/aurora.jpg',
      channelName: 'Navegador webOS',
      subText: 'Pressione OK para navegar'
    }
  };

  function appMeta(app) {
    if (!app) return null;
    var id = (app.id || '').toLowerCase(), title = (app.title || '').toLowerCase();
    for (var k in APP_INFO) {
      if (id.indexOf(k) >= 0 || title.indexOf(k) >= 0) return APP_INFO[k];
    }
    return {
      title: app.title || 'Aplicativo',
      tagline: 'Aplicativo instalado na sua Smart TV',
      badge: 'APP',
      hint: 'Pressione OK para abrir',
      preview: 'wallpapers/aurora.jpg',
      channelName: app.title || 'Aplicativo',
      subText: 'Pressione OK para iniciar'
    };
  }

  var currentLiveVideoApp = null;
  var lastSpotAppId = null;

  function safeCssUrl(url) {
    return String(url || '').replace(/[\r\n"\\()]/g, '');
  }

  function stopLivePreview() {
    var vid = $('tv-live-preview');
    if (vid && currentLiveVideoApp) {
      currentLiveVideoApp = null;
      lastSpotAppId = null;
      try {
        vid.pause();
        while (vid.firstChild) vid.removeChild(vid.firstChild);
        vid.removeAttribute('src');
        vid.load();
      } catch (e) {}
    }
  }

  function updateSpotlight(force) {
    var spot = $('spotlight');
    if (!spot || !shelf.length) return;
    var app = shelf[st.shelf] || shelf[0];
    if (!force && lastSpotAppId === app.id) return;
    lastSpotAppId = app.id;
    var meta = appMeta(app);
    if (!meta) return;
    var badge = $('spot-badge'), t = $('spot-title'), desc = $('spot-desc'), hint = $('spot-hint');
    if (badge) badge.textContent = meta.badge;
    if (t) t.textContent = meta.title;
    if (desc) desc.textContent = meta.tagline;
    if (hint) {
      hint.textContent = '';
      el('span', 'hint-badge', hint, 'OK');
      hint.appendChild(document.createTextNode(' ' + meta.hint));
    }

    var previewBox = $('spot-preview-box');
    if (previewBox) {
      setClass(previewBox, 'preview-hidden', false);
    }

    var isLiveTV = (app.id === 'com.webos.app.livetv');
    var vid = $('tv-live-preview');
    var appImg = $('app-preview-img');
    var pulseDot = $('preview-pulse-dot');
    var badgeText = $('preview-badge-text');
    var pBadge = previewBox ? previewBox.querySelector('.preview-badge') : null;
    var chName = $('preview-channel-name');
    var subText = $('preview-sub-text');

    if (chName) chName.textContent = meta.channelName || meta.title;
    if (subText) subText.textContent = meta.subText || meta.hint;

    if (isLiveTV) {
      if (appImg) appImg.style.display = 'none';
      if (pulseDot) setClass(pulseDot, 'pulse-hidden', false);
      if (badgeText) badgeText.textContent = 'AO VIVO';
      if (pBadge) pBadge.style.background = 'rgba(220, 38, 38, 0.9)';

      if (vid && !document.hidden) {
        vid.style.display = 'block';
        if (currentLiveVideoApp !== app.id) {
          currentLiveVideoApp = app.id;
          while (vid.firstChild) vid.removeChild(vid.firstChild);
          var src = document.createElement('source');
          src.src = 'tv://';
          src.type = 'service/webos-broadcast';
          vid.appendChild(src);
          vid.muted = true;
          vid.load();
          var p = vid.play();
          if (p && p.catch) p.catch(function () {});
        }
      }
    } else {
      if (vid) {
        stopLivePreview();
        lastSpotAppId = app.id;
        vid.style.display = 'none';
      }

      if (pulseDot) setClass(pulseDot, 'pulse-hidden', true);
      if (badgeText) badgeText.textContent = meta.badge || 'STREAMING';
      if (pBadge) {
        if (meta.badge === 'MÚSICA' || meta.badge === 'PLAYLISTS') {
          pBadge.style.background = 'rgba(16, 185, 129, 0.9)';
        } else if (meta.badge === 'EM ALTA') {
          pBadge.style.background = 'rgba(239, 68, 68, 0.9)';
        } else {
          pBadge.style.background = 'rgba(0, 122, 255, 0.88)';
        }
      }

      if (appImg) {
        appImg.style.display = 'block';
        appImg.style.backgroundImage = 'url("' + safeCssUrl(meta.preview || 'wallpapers/aurora.jpg') + '")';
      }
    }
  }

  function updateFocus(fromHover) {
    var i, list;
    list = $('tabs').children;
    for (i = 0; i < list.length; i++) {
      setClass(list[i], 'on', i === st.tab);
      setClass(list[i], 'focus', st.zone === Z.TOP && st.top === i);
    }
    list = $('buttons').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.TOP && st.top === 3 + i);
    setClass($('quotes'), 'hide', st.zone === Z.TOP && st.top >= 3);
    list = $('cards').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.CARDS && st.card === i);
    list = $('tiles').children;
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.SHELF && st.shelf === i);
    revealShelf();
    if (shelf.length) updateSpotlight();
    list = document.querySelectorAll('#drawer .key');
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.DRAWER && st.drawer === i);
    list = document.querySelectorAll('#apps .cell');
    for (i = 0; i < list.length; i++) setClass(list[i], 'focus', st.zone === Z.APPS && st.grid === i);
    if (!fromHover) {
      var rows = Math.max(1, Math.ceil(others.length / 5)), r = Math.floor(st.grid / 5), first = Math.max(0, Math.min(rows - 3, r - 1));
      $('apps').lastChild.style.webkitTransform = $('apps').lastChild.style.transform = 'translateY(' + (-first * 239) + 'px)';
    }
    focusRows($('settings'), st.row, st.zone === Z.SETTINGS, fromHover);
    focusRows($('shelfedit'), st.edit, st.zone === Z.EDIT, fromHover);
    focusRows($('langpick'), st.lang, st.zone === Z.LANG, fromHover);
    if (langHint) langHint.textContent = (st.lang + 1) + ' / ' + languageChoices().length + '  ·  ' + tr('OK picks, Back cancels.');
    focusRows($('poweronpick'), st.poweron, st.zone === Z.POWERON, fromHover);
    if (poweronHint) poweronHint.textContent = (st.poweron + 1) + ' / ' + powerOnChoices().length + '  ·  ' + tr('OK picks, Back cancels.');
    focusRows($('usbpick'), st.usb, st.zone === Z.USB, fromHover);
    if (usbHint) usbHint.textContent = (st.usb + 1) + ' / ' + usbChoices.length + '  ·  ' + tr('OK picks, Back cancels.');
    setClass(body, 'drawer-open', st.zone === Z.DRAWER);
  }

  function focusRows(sheet, index, on, fromHover) {
    var rows = sheet.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) setClass(rows[i], 'focus', on && i === index);
    if (fromHover) return;
    var holder = sheet.querySelector('.rows');
    if (!holder) return;
    var visible = 7, first = Math.max(0, Math.min(rows.length - visible, index - 3));
    holder.style.webkitTransform = holder.style.transform = 'translateY(' + (-first * 78) + 'px)';
  }

  function nearest(nodes, x) {
    var best = 0, bestD = 1e9;
    for (var i = 0; i < nodes.length; i++) {
      var r = nodes[i].getBoundingClientRect(), d = Math.abs((r.left + r.right) / 2 - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function centerX(node) {
    if (!node) return 960;
    var r = node.getBoundingClientRect();
    return (r.left + r.right) / 2;
  }

  // MARK: - Top: title, tabs, buttons, quotes

  var TAB_KIND = [null, 'movie', 'tv'];

  function renderTop() {
    $('title').textContent = tr('For You');
    var tabs = $('tabs');
    tabs.innerHTML = '';
    var names = [tr('Explore'), tr('Movies'), tr('Shows')];
    for (var i = 0; i < 3; i++) {
      var t = el('button', 'tab', tabs, names[i]);
      hover(t, Z.TOP, i);
    }
    var buttons = $('buttons');
    buttons.innerHTML = '';
    var defs = [
      ['sparkles', 'Modo Porta-Retratos'],
      ['hdmi', tr('HDMI Inputs')],
      ['speaker', 'Áudio: ' + audioOutputName(currentAudioMode)],
      ['settings', tr('light|Settings')]
    ];
    for (var b = 0; b < 4; b++) {
      var r = el('button', 'round' + (b === 3 ? ' last' : ''), buttons);
      r.style.left = (1508 + 88 * b) + 'px';
      sym(defs[b][0], r);
      el('div', 'tip', r, defs[b][1]);
      hover(r, Z.TOP, 3 + b);
    }
  }

  function renderQuotes() {
    var q = $('quotes'), coins = Data.activeCoins();
    q.innerHTML = '';
    for (var i = 0; i < coins.length; i++) {
      var item = el('span', 'q', q);
      coin(coins[i], item);
      el('span', '', item, Data.compact(Data.prices[coins[i]]));
    }
  }

  // MARK: - Picks and background

  function renderCards() {
    cards = [];
    var holder = $('cards');
    if (holder) holder.innerHTML = '';
    setClass(body, 'no-picks', true);
    if (st.zone === Z.CARDS) st.zone = Z.SHELF;
    updateFocus();
  }

  var bgUrl = null, bgFront = 'bgA';

  /** The first pick's photo as the background: drawn tiny and stretched, it's already as soft as a heavy blur. */
  function backdrop(url) {
    if (url === bgUrl) return;
    bgUrl = url;
    var next = bgFront === 'bgA' ? 'bgB' : 'bgA';
    if (!url) {
      setClass($('bgA'), 'on', false);
      setClass($('bgB'), 'on', false);
      return;
    }
    var img = new Image();
    img.onload = function () {
      if (bgUrl !== url) return;
      var canvas = $(next), ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setClass(canvas, 'on', true);
      setClass($(bgFront), 'on', false);
      bgFront = next;
    };
    img.src = url;
  }

  // MARK: - Custom Wallpaper & Photo Slideshow

  var WALLPAPER_CATALOG = {
    personal: [],
    curated: [
      {url: 'wallpapers/aurora.jpg', title: 'Aurora Boreal Nórdica (OLED 4K)'},
      {url: 'wallpapers/sunset.jpg', title: 'Pôr do Sol Dourado (OLED 4K)'}
    ]
  };

  function getActiveWallpapers() {
    var mode = Prefs.wallpaperMode();
    if (mode === 'personal') {
      return WALLPAPER_CATALOG.personal.length ? WALLPAPER_CATALOG.personal : WALLPAPER_CATALOG.curated;
    }
    if (mode === 'curated') return WALLPAPER_CATALOG.curated;
    return WALLPAPER_CATALOG.curated.concat(WALLPAPER_CATALOG.personal);
  }

  function wallpaperModeLabel() {
    var m = Prefs.wallpaperMode();
    var count = WALLPAPER_CATALOG.personal.length;
    if (m === 'personal') return count ? ('Fotos USB (' + count + ')') : 'Fotos Pessoais (USB)';
    if (m === 'curated') return 'Wallpapers OLED 4K';
    return count ? ('Todas (' + count + ' + OLED)') : 'Todas (Fotos & OLED)';
  }

  function normalizeWallpaper(item) {
    if (!item) return null;
    if (typeof item === 'string') {
      var u = item.indexOf('/') >= 0 ? item : ('wallpapers/personal/' + item);
      var bname = item.slice(item.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '').replace(/_/g, ' ');
      return {url: u, title: formatSaverTitle(bname)};
    }
    return {url: item.url, title: formatSaverTitle(item.title)};
  }

  // Algoritmo Fisher-Yates com amostragem máxima (250 itens por baralho) para poupar RAM em álbuns de 5.000+ fotos
  var MAX_DECK_SIZE = 250;
  function shuffle(arr) {
    if (!arr || !arr.length) return [];
    var len = arr.length;
    if (len <= MAX_DECK_SIZE) {
      var a = arr.slice();
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
      var outSmall = [];
      for (var s = 0; s < a.length; s++) outSmall.push(normalizeWallpaper(a[s]));
      return outSmall;
    }
    var picked = {}, out = [];
    while (out.length < MAX_DECK_SIZE) {
      var idx = Math.floor(Math.random() * len);
      if (!picked[idx]) {
        picked[idx] = true;
        out.push(normalizeWallpaper(arr[idx]));
      }
    }
    return out;
  }

  function cycleWallpaperMode(d) {
    var modes = ['all', 'personal', 'curated'];
    var cur = Prefs.wallpaperMode();
    var idx = modes.indexOf(cur);
    var next = modes[(idx + (d || 1) + modes.length) % modes.length];
    Prefs.set('wallpaperMode', next);
    wallDeck = [];
    saverDeck = [];
    nextWallpaper();
    toast(wallpaperModeLabel());
    if (st.zone === Z.SETTINGS) renderSettings();
  }

  var wallDeck = [];
  var currentWallUrl = '';
  var wallFront = 'wallA';
  var wallTimer = null;

  var ambiScratch = document.createElement('canvas');
  ambiScratch.width = 16;
  ambiScratch.height = 9;
  var ambiScratchCtx = ambiScratch.getContext('2d');

  /** Desenha um fundo Ambilight ultra-suave em um canvas 64x36 (9KB RAM, 0% shader GPU). */
  function paintAmbilight(canvas, img, darkenAlpha) {
    if (!canvas || !img) return;
    var iw = img.naturalWidth || 1920, ih = img.naturalHeight || 1080;
    var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    try {
      ambiScratchCtx.drawImage(img, 0, 0, iw, ih, 0, 0, 16, 9);
      ctx.globalAlpha = 1;
      ctx.drawImage(ambiScratch, 0, 0, 16, 9, 0, 0, w, h);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(ambiScratch, 0, 0, 16, 9, -2, -2, w + 4, h + 4);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(ambiScratch, 0, 0, 16, 9, 2, 2, w - 4, h - 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(6, 8, 14, ' + (darkenAlpha !== undefined ? darkenAlpha : 0.32) + ')';
      ctx.fillRect(0, 0, w, h);
    } catch (e) {}
  }

  function setWallpaper(url) {
    if (!url) return;
    var next = (wallFront === 'wallA') ? 'wallB' : 'wallA';
    var nextEl = $(next), frontEl = $(wallFront);
    if (!nextEl || !frontEl) return;

    var img = new Image();
    img.onload = function () {
      img.onload = null;
      var iw = img.naturalWidth || 1920, ih = img.naturalHeight || 1080;
      var aspect = iw / ih;
      var ambi = nextEl.querySelector('.wall-ambilight');
      var fg = nextEl.querySelector('.wall-fg');
      if (fg) {
        if (aspect < 1.55 && ambi) {
          paintAmbilight(ambi, img, 0.28);
          ambi.style.display = 'block';
          fg.className = 'wall-fg contain';
        } else {
          if (ambi) ambi.style.display = 'none';
          fg.className = 'wall-fg full';
        }
        fg.style.backgroundImage = 'url("' + safeCssUrl(url) + '")';
      } else {
        nextEl.style.backgroundImage = 'url("' + safeCssUrl(url) + '")';
      }
      setClass(nextEl, 'on', true);
      setClass(frontEl, 'on', false);
      wallFront = next;
    };
    img.src = url;
  }

  function nextWallpaper() {
    if (document.hidden || saverOn) return;
    var list = getActiveWallpapers();
    if (!list || !list.length) return;
    if (!wallDeck.length) {
      wallDeck = shuffle(list);
      if (wallDeck.length > 1 && wallDeck[0].url === currentWallUrl) {
        var swapIdx = 1 + Math.floor(Math.random() * (wallDeck.length - 1));
        var tmp = wallDeck[0];
        wallDeck[0] = wallDeck[swapIdx];
        wallDeck[swapIdx] = tmp;
      }
    }
    var pick = wallDeck.shift();
    if (pick) {
      currentWallUrl = pick.url;
      setWallpaper(pick.url);
    }
  }

  function loadPersonalManifest(done, retried) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'wallpapers/personal_manifest.json?t=' + Date.now(), true);
      xhr.timeout = 4000;
      xhr.onload = function () {
        var loadedCount = 0;
        if (xhr.status === 200 || xhr.status === 0) {
          try {
            var data = JSON.parse(xhr.responseText);
            if (Array.isArray(data)) {
              var filtered = [];
              for (var i = 0; i < data.length; i++) {
                var item = data[i];
                var u = typeof item === 'string' ? item : (item && item.url ? item.url : '');
                if (u && u.indexOf('photo_praia.jpg') < 0 && u.indexOf('photo_montanha.jpg') < 0) {
                  filtered.push(item);
                }
              }
              if (filtered.length > 0) {
                WALLPAPER_CATALOG.personal = filtered;
                loadedCount = filtered.length;
                wallDeck = [];
                saverDeck = [];
                nextWallpaper();
                if (st.zone === Z.SETTINGS) renderSettings();
              }
            }
          } catch (e) {}
        }
        if (loadedCount === 0 && !retried) {
          TV.syncUsbPhotos(Prefs.usbPhotosDir(), false, function () {
            loadPersonalManifest(done, true);
          });
          return;
        }
        if (done) done(loadedCount);
      };
      xhr.onerror = xhr.ontimeout = function () {
        if (!retried) {
          TV.syncUsbPhotos(Prefs.usbPhotosDir(), false, function () {
            loadPersonalManifest(done, true);
          });
          return;
        }
        if (done) done(0);
      };
      xhr.send();
    } catch (e) {
      if (done) done(0);
    }
  }

  function startWallpaperTimer() {
    if (wallTimer) clearInterval(wallTimer);
    wallTimer = setInterval(nextWallpaper, 60000);
  }

  function stopWallpaperTimer() {
    if (wallTimer) {
      clearInterval(wallTimer);
      wallTimer = null;
    }
  }

  function initWallpaper() {
    var list = getActiveWallpapers();
    if (list && list.length) {
      nextWallpaper();
      startWallpaperTimer();
    }
    loadPersonalManifest();
  }

  // MARK: - Audio Output Quick Selector

  var AUDIO_OUTPUTS = [
    {id: 'external_optical', name: 'Saída Óptica'},
    {id: 'tv_speaker', name: 'Alto-falante da TV'},
    {id: 'external_arc', name: 'HDMI (ARC)'},
    {id: 'tv_external_speaker', name: 'TV + Saída Óptica'},
    {id: 'bt_soundbar', name: 'Bluetooth / Soundbar'},
    {id: 'headphone', name: 'Fones de Ouvido'}
  ];
  var currentAudioMode = 'external_optical';

  function initAudioOutput() {
    TV.getSoundOutput(function (mode) {
      if (mode) currentAudioMode = mode;
      updateAudioTip();
      if (st.zone === Z.SETTINGS) renderSettings();
    });
  }

  function audioOutputName(id) {
    for (var i = 0; i < AUDIO_OUTPUTS.length; i++) {
      if (AUDIO_OUTPUTS[i].id === id) return AUDIO_OUTPUTS[i].name;
    }
    return id || 'Automático';
  }

  function updateAudioTip() {
    var btn = $('buttons');
    if (!btn || btn.children.length < 3) return;
    var audioBtn = btn.children[btn.children.length >= 4 ? 2 : 1];
    var tip = audioBtn.querySelector('.tip');
    if (tip) tip.textContent = 'Áudio: ' + audioOutputName(currentAudioMode);
  }

  function cycleAudioOutput(d) {
    var idx = 0;
    for (var i = 0; i < AUDIO_OUTPUTS.length; i++) {
      if (AUDIO_OUTPUTS[i].id === currentAudioMode) { idx = i; break; }
    }
    var nextIdx = (idx + (d || 1) + AUDIO_OUTPUTS.length) % AUDIO_OUTPUTS.length;
    var target = AUDIO_OUTPUTS[nextIdx];
    TV.setSoundOutput(target.id, function (ok) {
      if (ok) {
        currentAudioMode = target.id;
        Prefs.set('soundOutput', target.id);
        updateAudioTip();
        toast('Saída de áudio: ' + target.name);
        if (st.zone === Z.SETTINGS) renderSettings();
      } else {
        toast('Falha ao alternar saída de áudio');
      }
    });
  }

  // MARK: - Weather Pill Badge

  function updateWeatherBadge() {
    var wb = $('weather-badge');
    if (!wb) return;
    if (!Prefs.weather() || !Data.weather) {
      wb.style.display = 'none';
      return;
    }
    wb.style.display = 'flex';
    var w = Data.weather;
    var iconEl = wb.querySelector('.wx-icon');
    if (iconEl) {
      iconEl.className = 'wx-icon sym';
      sym(Data.symbol(w.code, w.isDay), iconEl);
    }
    var tempEl = wb.querySelector('.wx-temp');
    if (tempEl) tempEl.textContent = Data.degrees(w.temp);
    var cityEl = wb.querySelector('.wx-city');
    if (cityEl) cityEl.textContent = Data.city || 'São Paulo';
  }

  function renderClock() {
    var d = new Date(), c = $('clock');
    c.firstChild.textContent = formatDate('format|h:mm', d.getTime());
    c.lastChild.textContent = formatDate('format|EEEE, MMMM d', d.getTime());
  }

  /** On the minute, so the clock never runs late (the 30-second refresh could, by up to 30 s). */
  function tickClock() {
    renderClock();
    setTimeout(tickClock, 60000 - Date.now() % 60000 + 50);
  }

  // MARK: - Shelf

  var shelfFirst = 0, tileStep = 0, tileLeft = 0;

  function renderShelf() {
    var n = Math.min(shelf.length, SHELF_VISIBLE), gap = 48, pad = 40;
    // 16:9 tiles, as on Android: never taller than 126, and the glass keeps its bottom edge.
    var tw = Math.min(126 * 16 / 9, (1760 - Math.max(0, n - 1) * gap) / Math.max(1, n)), th = tw * 9 / 16;
    var width = n * tw + Math.max(0, n - 1) * gap, left = (1920 - width) / 2;
    var platter = $('platter');
    platter.style.display = n ? '' : 'none';
    platter.style.left = (left - pad) + 'px';
    platter.style.width = (width + 2 * pad) + 'px';
    platter.style.top = (814 + 126 - th) + 'px';
    platter.style.height = (th + 2 * pad) + 'px';
    $('quotes').style.right = (1920 - left - width) + 'px';
    var tiles = $('tiles');
    tiles.innerHTML = '';
    tileStep = tw + gap;
    tileLeft = left;
    shelfFirst = Math.max(0, Math.min(shelfFirst, shelf.length - n));
    for (var i = 0; i < shelf.length; i++) {
      var t = el('div', 'tile', tiles);
      t.style.top = (854 + 126 - th) + 'px';
      t.style.width = tw + 'px';
      t.style.height = th + 'px';
      face(shelf[i], t, wordFit(shelf[i].title, tw, 30));
      hover(t, Z.SHELF, i);
    }
    // More apps than fit: a small arrow inside the glass's edge on each side that has more, where no tile reaches
    // even focused (inside the screen's safe area, as on Android).
    platter.innerHTML = '';
    for (var a = 0; a < 2; a++) {
      var arrow = sym('chevron_right', platter);
      arrow.className += a ? ' more' : ' more back';
      arrow.style.left = (a ? width + 2 * pad - 14 : 14) - 8.5 + 'px';
      arrow.style.top = (pad + th / 2 - 8.5) + 'px';
    }
    st.shelf = Math.min(st.shelf, Math.max(0, shelf.length - 1));
    placeTiles();
  }

  /** The row slides (a transform on #tiles, which old TVs animate), and the apps it takes past the glass fade out. */
  function placeTiles() {
    var row = $('tiles'), tiles = row.children, n = Math.min(shelf.length, SHELF_VISIBLE);
    for (var i = 0; i < shelf.length; i++) {
      var shown = i >= shelfFirst && i < shelfFirst + n;
      tiles[i].style.left = (tileLeft + i * tileStep) + 'px';
      tiles[i].style.opacity = shown ? '' : '0';
      tiles[i].style.pointerEvents = shown ? '' : 'none';
    }
    row.style.webkitTransform = row.style.transform = 'translateX(' + (-shelfFirst * tileStep) + 'px)';
    var arrows = $('platter').children;
    arrows[0].style.visibility = shelfFirst > 0 ? '' : 'hidden';
    arrows[1].style.visibility = shelfFirst + n < shelf.length ? '' : 'hidden';
  }

  /** Scrolls the shelf, one app at a time, so the focused app is shown. */
  function revealShelf() {
    var n = Math.min(shelf.length, SHELF_VISIBLE);
    var first = Math.max(0, Math.min(Math.max(shelfFirst, st.shelf - n + 1), Math.min(st.shelf, shelf.length - n)));
    if (first === shelfFirst || !shelf.length) return;
    shelfFirst = first;
    placeTiles();
  }

  // MARK: - Drawer

  var drawerItems = [], drawerInputs = 0;

  function renderDrawer() {
    var d = $('drawer');
    d.innerHTML = '';
    drawerItems = [];
    for (var i = 0; i < inputs.length; i++) {
      var x = inputs[i];
      drawerItems.push({label: x.label || tr('Live TV'), symbol: x.symbol, off: !x.connected, run: launcher(x.id, x.label)});
    }
    drawerInputs = drawerItems.length;
    drawerItems.push({label: tr('All Apps'), symbol: 'apps', run: openApps});
    drawerItems.push({label: tr('Home Settings'), symbol: 'settings', run: openSettings});
    drawerItems.push({label: tr('TV Settings'), symbol: 'tv_settings', run: tvSettings});
    var n = drawerItems.length, gap = 18, groupGap = 56, groups = drawerInputs > 0 && drawerInputs < n ? 2 : 1;
    var tw = Math.min(230, (1760 - Math.max(0, n - groups) * gap - (groups - 1) * groupGap) / Math.max(1, n));
    var xPos = 80;
    for (var k = 0; k < n; k++) {
      if (k === drawerInputs && k > 0) {
        xPos += groupGap - gap;
        el('div', 'row-title', d, tr('Shortcuts')).style.left = (xPos + 4) + 'px';
      }
      if (k === 0 && drawerInputs) el('div', 'row-title', d, tr('Inputs')).style.left = '84px';
      var item = drawerItems[k], key = el('div', 'key glass' + (item.off ? ' off' : ''), d);
      key.style.left = xPos + 'px';
      key.style.width = tw + 'px';
      sym(item.symbol, key);
      el('div', 'label', key, item.label);
      hover(key, Z.DRAWER, k);
      xPos += tw + gap;
    }
    renderPanels();
    updateFocus();
  }

  function renderPanels() {
    var d = $('drawer');
    var old = d.querySelectorAll('.panel');
    for (var o = 0; o < old.length; o++) d.removeChild(old[o]);
    var wx = Prefs.weather(), coins = Data.activeCoins(), qt = coins.length > 0;
    var split = 80 + 1760 * 0.585;
    if (wx) {
      var w = el('div', 'panel glass', d);
      w.id = 'weather';
      w.style.left = '80px';
      w.style.width = ((qt ? split - 16 : 1840) - 80) + 'px';
      renderWeather(w);
    }
    if (qt) {
      var q = el('div', 'panel glass', d);
      q.id = 'prices';
      var left = wx ? split + 16 : 80;
      q.style.left = left + 'px';
      q.style.width = (1840 - left) + 'px';
      renderPrices(q, coins);
    }
  }

  function renderWeather(card) {
    el('div', 'head', card, Data.city || tr('Weather'));
    var w = Data.weather;
    if (!w) {
      el('div', 'cond', card, tr('No weather data right now.')).style.top = '96px';
      return;
    }
    var now = el('div', 'now', card);
    sym(Data.symbol(w.code, w.isDay), now);
    el('span', 'temp', now, Data.degrees(w.temp));
    el('div', 'cond', card, Data.condition(w.code, w.isDay));
    el('div', 'range', card, trf('H:{max}', {max: Data.degrees(w.max)}) + '   ' + trf('L:{min}', {min: Data.degrees(w.min)}));
    el('div', 'split', card);
    var hours = el('div', 'hours', card), width = parseFloat(card.style.width) - 30 - 422, hw = width / 6;
    for (var i = 0; i < w.hours.length && i < 6; i++) {
      var h = el('div', 'hour', hours), x = w.hours[i];
      h.style.left = (hw * i) + 'px';
      h.style.width = hw + 'px';
      el('div', 't', h, Data.hour(x.at));
      sym(Data.symbol(x.code, x.day), h);
      el('div', 'd', h, Data.degrees(x.temp));
    }
    var sun = el('div', 'sun', card);
    if (w.sunrise) { var a = el('span', '', sun); sym('sunrise', a); a.appendChild(document.createTextNode(trf('Sunrise {time}', {time: Data.time(w.sunrise)}))); }
    if (w.sunset) { var b = el('span', '', sun); sym('sunset', b); b.appendChild(document.createTextNode(trf('Sunset {time}', {time: Data.time(w.sunset)}))); }
  }

  function renderPrices(card, coins) {
    el('div', 'head', card, tr('Crypto'));
    var stale = Data.staleness(Data.pricesAt, 5 * 60000);
    el('div', 'side', card, stale ? trf('quotes|{ago}', {ago: stale}) : tr('24h change'));
    for (var j = 0; j < coins.length; j++) {
      var i = coins[j], row = el('div', 'coin', card);
      row.style.top = (86 + 52 * j) + 'px';
      coin(i, row);
      el('span', 'n', row, Data.coinName(i));
      el('span', 'p', row, Data.money(Data.prices[i]));
      var ch = Data.changes[i];
      if (!isNaN(ch)) el('span', 'c ' + (ch >= 0 ? 'up' : 'down'), row, Data.change(ch));
    }
  }

  function openDrawer() {
    if (!drawerItems.length) return;
    var tiles = $('tiles').children;
    st.zone = Z.DRAWER;
    st.drawer = Math.min(drawerItems.length - 1, nearest(document.querySelectorAll('#drawer .key'), centerX(tiles[st.shelf])));
    updateFocus();
  }

  function closeDrawer() {
    var keys = document.querySelectorAll('#drawer .key');
    st.zone = Z.SHELF;
    if (shelf.length) st.shelf = nearest($('tiles').children, centerX(keys[st.drawer]));
    updateFocus();
  }

  // MARK: - All Apps

  function renderApps() {
    var sheet = $('apps');
    sheet.firstChild.textContent = tr('All Apps');
    var grid = sheet.lastChild;
    grid.innerHTML = '';
    for (var i = 0; i < others.length; i++) {
      var r = Math.floor(i / 5), c = i % 5, cell = el('div', 'cell', grid);
      cell.style.left = (130 + c * 340) + 'px';
      cell.style.top = (196 + r * 239) + 'px';
      face(others[i], el('div', 'face', cell), wordFit(others[i].title, 300, 34));
      el('div', 'label', cell, others[i].title);
      hover(cell, Z.APPS, i);
    }
  }

  function openApps() {
    renderApps();
    st.zone = Z.APPS;
    st.grid = 0;
    setClass($('apps'), 'open', true);
    updateFocus();
  }

  var lastZoneSwitchAt = 0;

  function closeSheets() {
    lastZoneSwitchAt = Date.now();
    editRows = null;
    setClass($('apps'), 'open', false);
    setClass($('settings'), 'open', false);
    setClass($('shelfedit'), 'open', false);
    setClass($('langpick'), 'open', false);
    setClass($('poweronpick'), 'open', false);
    setClass($('usbpick'), 'open', false);
    langHint = null;
    poweronHint = null;
    usbHint = null;
    st.zone = Z.SHELF;
    updateFocus();
  }

  // MARK: - Home Settings

  function settingRows() {
    var unit = Prefs.temperature(), theme = Prefs.theme();
    var auto = tr('Automatic'), picked = pickedLanguage();
    var rows = [
      {label: tr('Language'), value: picked === 'auto' ? auto : I18N.languageName(picked), opens: true, language: true,
        step: function (d) { if (d >= 0) openLanguages(); }},
      {label: tr('Power On App') || 'Ao ligar a TV', value: powerOnAppLabel(), opens: true, poweron: true,
        step: function (d) { if (d >= 0) openPowerOnPicker(); }},
      {label: 'Plano de Fundo', value: wallpaperModeLabel(), wallpaper: true,
        step: function (d) { cycleWallpaperMode(d); }},
      {label: 'Pasta de Fotos (USB)', value: usbSourceLabel(), opens: true, usb: true,
        step: function (d) { if (d >= 0) openUsbPicker(); }},
      {label: 'Modo Porta-Retratos', value: 'Iniciar Agora', opens: true,
        step: function (d) { if (d >= 0) { closeSheets(); showSaver(); } }},
      {label: 'Saída de Áudio', value: audioOutputName(currentAudioMode), audio: true,
        step: function (d) { cycleAudioOutput(d); }},
      {label: tr('Temperature'), value: unit === 'C' ? '°C' : unit === 'F' ? '°F' : tr('unit|Automatic'),
        step: function (d) { cycle('temperature', ['auto', 'C', 'F'], unit, d); renderPanels(); }},
      {label: tr('Theme'), value: theme === 'light' ? tr('Light') : theme === 'dark' ? tr('Dark') : auto,
        step: function (d) { cycle('theme', ['auto', 'light', 'dark'], theme, d); checkNight(); }},
      {label: tr('Weather widget') || 'Previsão do Tempo', toggle: Prefs.weather(),
        step: function () {
          Prefs.set('weather', !Prefs.weather());
          if (Prefs.weather()) { Data.refreshWeather(true); }
          updateWeatherBadge();
          renderPanels();
        }},
      {label: tr('Quotes widget'), toggle: Prefs.quotes(),
        step: function () { Prefs.set('quotes', !Prefs.quotes()); Data.settingsChanged(); }}
    ];
    var names = ['Bitcoin', 'Ethereum', 'Solana', tr('Dollar')];
    var count = Data.currency === 'BRL' ? 4 : 3;
    for (var i = 0; i < count; i++) {
      (function (i) {
        var coinOn = Boolean(Prefs.quotes() && (!Prefs.coin || Prefs.coin(i)));
        rows.push({label: names[i], toggle: coinOn, dim: !Prefs.quotes(),
          step: function () { if (Prefs.quotes()) { Prefs.setCoin(i, !(!Prefs.coin || Prefs.coin(i))); Data.settingsChanged(); } }});
      })(i);
    }
    rows.push({label: tr('Shelf'), value: '›', shelf: true, step: function (d) { if (d >= 0) openShelfEdit(); }});
    rows.push({label: tr('TV Settings'), value: '›', step: function (d) { if (d >= 0) tvSettings(); }});
    return rows;
  }

  function cycle(name, values, current, d) {
    var i = values.indexOf(current);
    Prefs.set(name, values[(i + (d || 1) + values.length) % values.length]);
  }

  var rowsNow = [];

  function renderSettings() {
    var box = $('settings').firstChild;
    box.innerHTML = '';
    var title = el('div', 'title', box);
    sym('settings', title);
    title.appendChild(document.createTextNode(tr('Home Settings')));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    rowsNow = settingRows();
    list.style.height = Math.min(rowsNow.length, 7) * 78 + 'px';
    for (var i = 0; i < rowsNow.length; i++) {
      var r = rowsNow[i], row = el('div', 'row' + (r.dim ? ' dim' : ''), holder, r.label);
      if (r.toggle !== undefined) setClass(el('div', 'toggle', row), 'on', r.toggle);
      else {
        var v = el('span', 'value', row);
        if (r.value === '›') v.textContent = '›';
        else if (r.opens) { v.appendChild(document.createTextNode(r.value)); el('span', 'chev', v, '›'); }
        else { el('span', 'chev', v, '‹'); v.appendChild(document.createTextNode(r.value)); el('span', 'chev', v, '›'); }
      }
      hover(row, Z.SETTINGS, i);
    }
    el('div', 'hint', box, tr('OK or the arrows change the value.'));
    updateFocus();
  }

  function openSettings(keepRow) {
    lastZoneSwitchAt = Date.now();
    setClass($('apps'), 'open', false);
    setClass($('shelfedit'), 'open', false);
    setClass($('langpick'), 'open', false);
    setClass($('poweronpick'), 'open', false);
    setClass($('usbpick'), 'open', false);
    langHint = null;
    poweronHint = null;
    usbHint = null;
    st.zone = Z.SETTINGS;
    if (!keepRow) st.row = 0;
    renderSettings();
    setClass($('settings'), 'open', true);
    updateFocus();
  }

  // MARK: - Language: a list of every catalogue in its own name, as on Android (moving through it doesn't switch the app)

  var langHint = null;

  function languageChoices() {
    return ['auto'].concat(I18N.languages());
  }

  /** The language in use: "auto", or the catalogue the setting resolved to ("pt-BR" in config.properties is "pt"). */
  function pickedLanguage() {
    return Prefs.language() === 'auto' ? 'auto' : I18N.lang;
  }

  function renderLanguages() {
    var box = $('langpick').firstChild, choices = languageChoices(), current = choices.indexOf(pickedLanguage());
    box.innerHTML = '';
    var title = el('div', 'title', box, '‹  ' + tr('Language'));
    title.style.cursor = 'pointer';
    title.onclick = function (e) { if (e && e.stopPropagation) e.stopPropagation(); closeLanguages(false); };
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(choices.length, 7) * 78 + 'px';
    for (var i = 0; i < choices.length; i++) {
      var row = el('div', 'row', holder, choices[i] === 'auto' ? tr('Automatic') : I18N.languageName(choices[i]));
      if (i === current) sym('check', el('span', 'value', row));
      hover(row, Z.LANG, i);
    }
    langHint = el('div', 'hint', box);
    updateFocus();
  }

  function openLanguages() {
    lastZoneSwitchAt = Date.now();
    setClass($('settings'), 'open', false);
    st.zone = Z.LANG;
    st.lang = Math.max(0, languageChoices().indexOf(pickedLanguage()));
    renderLanguages();
    setClass($('langpick'), 'open', true);
    updateFocus();
  }

  /** OK: the language under the focus; Back: none. Either way, back to Home Settings, on the Language row. */
  function closeLanguages(pick) {
    lastZoneSwitchAt = Date.now();
    setClass($('langpick'), 'open', false);
    langHint = null;
    var code = languageChoices()[st.lang];
    if (pick && code && code !== pickedLanguage()) {
      Prefs.set('language', code);
      I18N.set(Prefs.language());
      renderAll();
      Data.refresh();   // the picks' titles and genres come in the new language
    }
    openSettings(true);
    for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].language) st.row = i;
    updateFocus();
  }

  // MARK: - Power On App Picker

  var poweronHint = null;

  function powerOnChoices() {
    var list = [
      {id: 'com.webos.app.livetv', title: 'TV Aberta (Padrão)'},
      {id: 'io.freemytv', title: 'Free My TV (Launcher)'}
    ];
    var seen = {'com.webos.app.livetv': true, 'io.freemytv': true};
    for (var i = 0; i < shelf.length; i++) {
      var a = shelf[i];
      if (a && a.id && !seen[a.id]) {
        seen[a.id] = true;
        list.push({id: a.id, title: a.title || a.id});
      }
    }
    for (var j = 0; j < apps.length; j++) {
      var b = apps[j];
      if (b && b.id && !seen[b.id]) {
        seen[b.id] = true;
        list.push({id: b.id, title: b.title || b.id});
      }
    }
    return list;
  }

  function powerOnAppLabel() {
    var cur = Prefs.powerOnApp();
    var choices = powerOnChoices();
    for (var i = 0; i < choices.length; i++) {
      if (choices[i].id === cur) return choices[i].title;
    }
    return cur === 'com.webos.app.livetv' ? 'TV Aberta (Padrão)' : cur;
  }

  function renderPowerOn() {
    var box = $('poweronpick').firstChild, choices = powerOnChoices(), currentId = Prefs.powerOnApp();
    box.innerHTML = '';
    var title = el('div', 'title', box, '‹  ' + (tr('Power On App') || 'Ao ligar a TV'));
    title.style.cursor = 'pointer';
    title.onclick = function (e) { if (e && e.stopPropagation) e.stopPropagation(); closePowerOnPicker(false); };
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(choices.length, 7) * 78 + 'px';
    for (var i = 0; i < choices.length; i++) {
      var row = el('div', 'row', holder, choices[i].title);
      if (choices[i].id === currentId) sym('check', el('span', 'value', row));
      hover(row, Z.POWERON, i);
    }
    poweronHint = el('div', 'hint', box);
    updateFocus();
  }

  function openPowerOnPicker() {
    lastZoneSwitchAt = Date.now();
    setClass($('settings'), 'open', false);
    st.zone = Z.POWERON;
    var choices = powerOnChoices(), cur = Prefs.powerOnApp(), idx = 0;
    for (var i = 0; i < choices.length; i++) {
      if (choices[i].id === cur) { idx = i; break; }
    }
    st.poweron = idx;
    renderPowerOn();
    setClass($('poweronpick'), 'open', true);
    updateFocus();
  }

  function closePowerOnPicker(pick) {
    lastZoneSwitchAt = Date.now();
    setClass($('poweronpick'), 'open', false);
    poweronHint = null;
    var choices = powerOnChoices();
    var choice = choices[st.poweron];
    if (pick && choice && choice.id !== Prefs.powerOnApp()) {
      Prefs.set('powerOnApp', choice.id);
      TV.setPowerOnApp(choice.id);
    }
    openSettings(true);
    for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].poweron) st.row = i;
    updateFocus();
  }

  // MARK: - USB Photo Source Picker

  var usbHint = null;
  var usbChoices = [
    {id: 'rescan', title: 'Sincronizar / Re-escanear Pendrive USB'},
    {id: 'auto', title: 'Automático (Pasta fotos no Pendrive)'}
  ];

  function usbSourceLabel() {
    var cur = Prefs.usbPhotosDir();
    var count = WALLPAPER_CATALOG.personal.length;
    var suffix = count ? (' (' + count + ' fotos)') : '';
    if (!cur || cur === 'auto') return 'Automático' + suffix;
    var shortName = cur.replace(/^\/tmp\/usb\/[^/]+\/[^/]+/, 'USB').replace(/^\/media\/multimedia\/[^/]+/, 'USB');
    return shortName + suffix;
  }

  function renderUsbPicker() {
    var box = $('usbpick').firstChild, currentId = Prefs.usbPhotosDir() || 'auto';
    box.innerHTML = '';
    var title = el('div', 'title', box, '‹  Fonte das Fotos (USB)');
    title.style.cursor = 'pointer';
    title.onclick = function (e) { if (e && e.stopPropagation) e.stopPropagation(); closeUsbPicker(false); };
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    list.style.height = Math.min(usbChoices.length, 7) * 78 + 'px';
    for (var i = 0; i < usbChoices.length; i++) {
      var row = el('div', 'row', holder, usbChoices[i].title);
      if (usbChoices[i].id === currentId) sym('check', el('span', 'value', row));
      hover(row, Z.USB, i);
    }
    usbHint = el('div', 'hint', box);
    updateFocus();
  }

  function openUsbPicker() {
    lastZoneSwitchAt = Date.now();
    setClass($('settings'), 'open', false);
    st.zone = Z.USB;
    st.usb = 0;
    usbChoices = [
      {id: 'rescan', title: 'Sincronizar / Re-escanear Pendrive USB'},
      {id: 'auto', title: 'Automático (Detectar pasta fotos)'}
    ];
    renderUsbPicker();
    setClass($('usbpick'), 'open', true);
    updateFocus();

    TV.listUsbPhotoFolders(function (folders) {
      if (st.zone !== Z.USB) return;
      var list = [
        {id: 'rescan', title: 'Sincronizar / Re-escanear Pendrive USB'},
        {id: 'auto', title: 'Automático (Detectar pasta fotos)'}
      ];
      for (var i = 0; folders && i < folders.length; i++) {
        var f = folders[i];
        var label = f.replace(/^\/tmp\/usb\/[^/]+\/[^/]+/, 'Pendrive USB').replace(/^\/media\/multimedia\/[^/]+/, 'Pendrive USB');
        list.push({id: f, title: label + ' (' + f + ')'});
      }
      usbChoices = list;
      var cur = Prefs.usbPhotosDir() || 'auto';
      for (var j = 0; j < usbChoices.length; j++) {
        if (usbChoices[j].id === cur) { st.usb = j; break; }
      }
      renderUsbPicker();
    });
  }

  function closeUsbPicker(pick) {
    lastZoneSwitchAt = Date.now();
    setClass($('usbpick'), 'open', false);
    usbHint = null;
    var choice = usbChoices[st.usb];
    openSettings(true);
    for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].usb) st.row = i;
    updateFocus();

    if (pick && choice) {
      var forceRescan = (choice.id === 'rescan');
      var targetDir = forceRescan ? Prefs.usbPhotosDir() : choice.id;
      if (!forceRescan) {
        Prefs.set('usbPhotosDir', targetDir);
        Prefs.set('wallpaperMode', 'personal');
      }
      toast(forceRescan ? 'Re-escaneando pendrive USB...' : 'Sincronizando pasta do pendrive USB...');
      TV.syncUsbPhotos(targetDir, forceRescan, function () {
        loadPersonalManifest(function (count) {
          if (count > 0) {
            toast('Galeria USB pronta: ' + count + ' fotos pessoais carregadas!');
          } else {
            toast('Nenhuma foto (.jpg/.png) encontrada na pasta selecionada.');
          }
          if (st.zone === Z.SETTINGS) renderSettings();
        }, true);
      });
    }
  }

  // MARK: - Shelf editor: which apps, in what order

  var editRows = null;

  function openShelfEdit() {
    lastZoneSwitchAt = Date.now();
    setClass($('settings'), 'open', false);
    st.zone = Z.EDIT;
    st.edit = 0;
    var ids = shelf.map(function (a) { return a.id; });
    var unique = [], seen = {};
    for (var u = 0; u < apps.length; u++) {
      if (!seen[apps[u].id]) {
        seen[apps[u].id] = true;
        unique.push(apps[u]);
      }
    }
    editRows = unique.sort(function (a, b) {
      var ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1;
    });
    renderShelfEdit();
    setClass($('shelfedit'), 'open', true);
    updateFocus();
  }

  function renderShelfEdit() {
    var box = $('shelfedit').firstChild;
    box.innerHTML = '';
    var title = el('div', 'title', box);
    title.style.cursor = 'pointer';
    title.onclick = function (e) { if (e && e.stopPropagation) e.stopPropagation(); back(); };
    sym('apps', title);
    title.appendChild(document.createTextNode('‹  ' + tr('Shelf')));
    var list = el('div', 'list', box), holder = el('div', 'rows', list);
    var ids = shelf.map(function (a) { return a.id; });
    var rows = editRows || apps;
    list.style.height = Math.min(rows.length, 7) * 78 + 'px';
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i], at = ids.indexOf(a.id), row = el('div', 'row', holder, a.title);
      var place = el('span', 'value', row);
      if (at >= 0) {
        place.textContent = '#' + (at + 1);
        sym('check', place).style.marginLeft = '16px';
      } else {
        place.textContent = tr('shelf|Off');
        place.style.opacity = '0.5';
      }
      hover(row, Z.EDIT, i);
    }
    el('div', 'hint', box, tr('OK adds or removes an app. ← → change the order.'));
    updateFocus();
  }

  function editShelf(dx) {
    var rows = editRows || apps;
    var app = rows[st.edit];
    if (!app) return;
    var ids = [];
    for (var s = 0; s < shelf.length; s++) {
      if (ids.indexOf(shelf[s].id) < 0) ids.push(shelf[s].id);
    }
    var at = ids.indexOf(app.id);
    if (dx === 0) {
      if (at >= 0) {
        ids = ids.filter(function (id) { return id !== app.id; });
        toast(trf('Removed from the shelf: {app}', {app: app.title}));
      } else {
        if (ids.indexOf(app.id) < 0) ids.push(app.id);
        toast(trf('Added to the shelf: {app}', {app: app.title}));
      }
    } else {
      if (at < 0) return;
      var to = Math.max(0, Math.min(ids.length - 1, at + dx));
      if (to === at) return;
      ids.splice(at, 1);
      ids.splice(to, 0, app.id);
      var rAt = rows.indexOf(app);
      var rTo = rAt + (to - at);
      if (rTo >= 0 && rTo < rows.length) {
        rows.splice(rAt, 1);
        rows.splice(rTo, 0, app);
        st.edit = rTo;
      }
    }
    Prefs.set('shelf', ids);
    pickShelf();
    renderShelf();
    renderShelfEdit();
  }

  // MARK: - Opening things

  function launcher(id, name) {
    return function () {
      TV.launch(id, null, function (ok) {
        if (!ok) toast(trf("Couldn't open {app}.", {app: name || id}));
      });
    };
  }

  function tvSettings() {
    TV.settings(function (ok) {
      if (!ok) toast(tr("Couldn't open TV Settings"));
    });
  }

  function liveTV() {
    for (var i = 0; i < inputs.length; i++) if (inputs[i].key === 'live') return inputs[i];
    return null;
  }

  function activate() {
    if (Date.now() - lastZoneSwitchAt < 300) return;
    switch (st.zone) {
      case Z.TOP:
        if (st.top < 3) return;
        if (st.top === 3) { showSaver(); }
        else if (st.top === 4) { st.zone = Z.SHELF; openDrawer(); st.drawer = 1 < drawerInputs ? 1 : 0; updateFocus(); }
        else if (st.top === 5) { cycleAudioOutput(); }
        else openSettings();
        return;
      case Z.CARDS:
        var p = cards[st.card], app = p && Data.appFor(p.app);
        if (app) launcher(app.id, app.title)();
        return;
      case Z.SHELF:
        if (shelf[st.shelf]) launcher(shelf[st.shelf].id, shelf[st.shelf].title)();
        return;
      case Z.DRAWER:
        if (drawerItems[st.drawer]) drawerItems[st.drawer].run();
        return;
      case Z.APPS:
        if (others[st.grid]) launcher(others[st.grid].id, others[st.grid].title)();
        return;
      case Z.SETTINGS:
        if (rowsNow[st.row]) { rowsNow[st.row].step(1); if (st.zone === Z.SETTINGS) renderSettings(); }
        return;
      case Z.EDIT:
        editShelf(0);
        return;
      case Z.LANG:
        closeLanguages(true);
        return;
      case Z.POWERON:
        closePowerOnPicker(true);
        return;
      case Z.USB:
        closeUsbPicker(true);
        return;
    }
  }

  function selectTab(i) {
    if (i === st.tab) return;
    st.tab = i;
    renderCards();
  }

  function move(dx, dy) {
    var tiles = $('tiles').children, cardNodes = $('cards').children;
    switch (st.zone) {
      case Z.SHELF:
        if (dx) st.shelf = Math.max(0, Math.min(shelf.length - 1, st.shelf + dx));
        else if (dy > 0) { openDrawer(); return; }
        else if (dy < 0) {
          if (cards.length) { st.zone = Z.CARDS; st.card = nearest(cardNodes, centerX(tiles[st.shelf])); }
          else { st.zone = Z.TOP; st.top = 3; }
        }
        break;
      case Z.CARDS:
        if (dx) st.card = Math.max(0, Math.min(cards.length - 1, st.card + dx));
        else if (dy < 0) { st.zone = Z.TOP; st.top = st.tab; }
        else if (shelf.length) { st.zone = Z.SHELF; st.shelf = nearest(tiles, centerX(cardNodes[st.card])); }
        break;
      case Z.TOP:
        if (dx) {
          st.top = Math.max(3, Math.min(6, st.top + dx));
        } else if (dy > 0) {
          st.zone = Z.SHELF;
        }
        break;
      case Z.DRAWER:
        if (dx) st.drawer = Math.max(0, Math.min(drawerItems.length - 1, st.drawer + dx));
        else if (dy < 0) { closeDrawer(); return; }
        break;
      case Z.APPS:
        var g = st.grid + dx + dy * 5;
        if (g >= 0 && g < others.length && (dx === 0 || Math.floor(g / 5) === Math.floor(st.grid / 5))) st.grid = g;
        break;
      case Z.SETTINGS:
        if (dy) st.row = Math.max(0, Math.min(rowsNow.length - 1, st.row + dy));
        else if (dx && rowsNow[st.row]) {
          var r = rowsNow[st.row];
          if (dx > 0 && (r.opens || r.value === '›')) {
            r.step(1);
          } else if (!r.opens && r.value !== '›') {
            r.step(dx);
            if (st.zone === Z.SETTINGS) renderSettings();
          }
        }
        break;
      case Z.EDIT:
        var maxEdit = (editRows || apps).length - 1;
        if (dy) st.edit = Math.max(0, Math.min(maxEdit, st.edit + dy));
        else if (dx) editShelf(dx);
        break;
      case Z.LANG:
        if (dy) st.lang = Math.max(0, Math.min(languageChoices().length - 1, st.lang + dy));
        else if (dx < 0) closeLanguages(false);
        break;
      case Z.POWERON:
        if (dy) st.poweron = Math.max(0, Math.min(powerOnChoices().length - 1, st.poweron + dy));
        else if (dx < 0) closePowerOnPicker(false);
        break;
      case Z.USB:
        if (dy) st.usb = Math.max(0, Math.min(usbChoices.length - 1, st.usb + dy));
        else if (dx < 0) closeUsbPicker(false);
        break;
    }
    updateFocus();
  }

  function back() {
    if (Date.now() - lastZoneSwitchAt < 300) return;
    if (st.zone === Z.EDIT) {
      editRows = null;
      setClass($('shelfedit'), 'open', false);
      openSettings(true);
      for (var i = 0; i < rowsNow.length; i++) if (rowsNow[i].shelf) st.row = i;
      updateFocus();
      return;
    }
    if (st.zone === Z.LANG) { closeLanguages(false); return; }
    if (st.zone === Z.POWERON) { closePowerOnPicker(false); return; }
    if (st.zone === Z.USB) { closeUsbPicker(false); return; }
    if (sheetOpen()) { closeSheets(); return; }
    if (st.zone === Z.DRAWER) { closeDrawer(); return; }
    if (st.zone !== Z.SHELF && shelf.length) { st.zone = Z.SHELF; updateFocus(); return; }
    TV.back();
  }

  /** The pointer focuses what it's over (the Magic Remote, or a mouse when previewing). */
  function hover(node, zone, index) {
    node.onmouseover = function () {
      if (saverOn) return;
      var isSheetZone = (zone === Z.APPS || zone === Z.SETTINGS || zone === Z.EDIT || zone === Z.LANG || zone === Z.POWERON || zone === Z.USB);
      if (sheetOpen()) {
        if (st.zone !== zone) return;
      } else if (isSheetZone) {
        return;
      }
      if (zone === Z.DRAWER && st.zone !== Z.DRAWER) return;
      if (zone !== Z.DRAWER && st.zone === Z.DRAWER && zone !== Z.SHELF) return;
      if (zone === Z.SHELF && st.zone === Z.DRAWER) closeDrawer();
      var prevZone = st.zone;
      var sameIndex = (zone === Z.TOP && st.top === index) ||
                      (zone === Z.CARDS && st.card === index) ||
                      (zone === Z.SHELF && st.shelf === index) ||
                      (zone === Z.DRAWER && st.drawer === index) ||
                      (zone === Z.APPS && st.grid === index) ||
                      (zone === Z.SETTINGS && st.row === index) ||
                      (zone === Z.EDIT && st.edit === index) ||
                      (zone === Z.LANG && st.lang === index) ||
                      (zone === Z.POWERON && st.poweron === index) ||
                      (zone === Z.USB && st.usb === index);
      if (prevZone === zone && sameIndex) return;
      st.zone = zone;
      if (zone === Z.TOP) { st.top = index; if (index < 3) selectTab(index); }
      else if (zone === Z.CARDS) st.card = index;
      else if (zone === Z.SHELF) st.shelf = index;
      else if (zone === Z.DRAWER) st.drawer = index;
      else if (zone === Z.APPS) st.grid = index;
      else if (zone === Z.SETTINGS) st.row = index;
      else if (zone === Z.EDIT) st.edit = index;
      else if (zone === Z.LANG) st.lang = index;
      else if (zone === Z.POWERON) st.poweron = index;
      else if (zone === Z.USB) st.usb = index;
      updateFocus(true);
    };
    node.onclick = function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (sheetOpen() && st.zone !== zone) return;
      node.onmouseover();
      activate();
    };
  }

  // MARK: - Toast

  var toastTimer = 0;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    setClass(t, 'on', true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { setClass(t, 'on', false); }, 6000);
  }

  // MARK: - Night, clock, screensaver

  var lastNight = null;

  function checkNight() {
    var night = Data.isNight(Date.now());
    setClass(body, 'night', night);
    if (night === lastNight) return;
    lastNight = night;
    document.documentElement.style.background = night ? '#0B0B0D' : '';
    try { localStorage.setItem('fmtv.night', night ? 'true' : 'false'); } catch (e) {}   // for index.html, next start
  }

  var saverOn = false, idleAt = Date.now(), saverTimer = 0, SAVER_AFTER = 5 * 60000;
  var saverDeck = [];
  var lastSaverUrl = '';
  var saverHistory = [];
  var saverHistIdx = -1;
  var saverPaused = false;
  var saverHudHidden = false;
  var saverCtrlTimer = 0;
  var saverStepFn = null, saverPauseFn = null, saverHudFn = null;

  /** The screensaver's photos: picks with an app on the TV. */
  function saverPhotos() {
    return Data.showcase().filter(function (p) { return p.backdrop && Data.appFor(p.app); });
  }

  function nextSaverPhoto(list) {
    if (!list || !list.length) return null;
    if (!saverDeck.length) {
      saverDeck = shuffle(list);
      if (saverDeck.length > 1 && saverDeck[0].url === lastSaverUrl) {
        var swapIdx = 1 + Math.floor(Math.random() * (saverDeck.length - 1));
        var tmp = saverDeck[0];
        saverDeck[0] = saverDeck[swapIdx];
        saverDeck[swapIdx] = tmp;
      }
    }
    var pick = saverDeck.shift();
    if (pick) lastSaverUrl = pick.url;
    return pick;
  }

  function formatSaverTitle(raw) {
    if (!raw) return '';
    if (/^foto[\s_]pessoal/i.test(raw)) return 'Galeria Pessoal';
    return raw;
  }

  function showSaver() {
    var list = getActiveWallpapers();
    if (!list || !list.length) return;
    saverOn = true;
    saverPaused = false;
    saverHistory = [];
    saverHistIdx = -1;
    stopLivePreview();
    var s = $('saver');
    s.innerHTML = '';
    var a = createSaverPhoto(s), b = createSaverPhoto(s);
    var shade = el('div', 'shade' + (saverHudHidden ? ' hud-hidden' : ''), s);
    var clock = el('div', 'clock' + (saverHudHidden ? ' hud-hidden' : ''), s);
    el('div', 'time', clock);
    el('div', 'date', clock);
    el('div', 'title', clock);
    var ctrls = el('div', 'saver-controls', s, '◀ ▶ Navegar  ·  OK Pausar  ·  ▲▼ Relógio  ·  Voltar Sair');
    var front = a;
    var currentTitle = 'Galeria Pessoal';

    // Sempre inicia o repouso com um novo baralho aleatório
    saverDeck = shuffle(list);
    if (saverDeck.length > 1 && saverDeck[0].url === lastSaverUrl) {
      var swapIdx = 1 + Math.floor(Math.random() * (saverDeck.length - 1));
      var tmp = saverDeck[0];
      saverDeck[0] = saverDeck[swapIdx];
      saverDeck[swapIdx] = tmp;
    }

    function flashControls(customText) {
      if (!ctrls) return;
      ctrls.textContent = customText || (saverPaused
        ? '❚❚ Pausado  ·  OK Retomar  ·  ◀ ▶ Navegar  ·  Voltar Sair'
        : '◀ ▶ Navegar  ·  OK Pausar  ·  ▲▼ Relógio  ·  Voltar Sair');
      setClass(ctrls, 'on', true);
      clearTimeout(saverCtrlTimer);
      if (!saverPaused) {
        saverCtrlTimer = setTimeout(function () { setClass(ctrls, 'on', false); }, 5500);
      }
    }

    function updateClockSubtitle() {
      if (!clock || !clock.lastChild) return;
      var status = saverPaused ? '  ·  ❚❚ Pausado' : '';
      clock.lastChild.textContent = currentTitle + status;
    }

    function showPick(p) {
      if (!saverOn || !p || !p.url) return;
      var back = front === a ? b : a;
      var pre = new Image();
      pre.onload = function () {
        pre.onload = pre.onerror = null;
        if (!saverOn) return;
        var iw = pre.naturalWidth || 1920, ih = pre.naturalHeight || 1080;
        var aspect = iw / ih;
        if (aspect >= 1.62) {
          back.ambi.style.display = 'none';
          back.vignette.style.display = 'none';
          back.fg.className = 'fg full';
          back.fg.style.left = '0px';
          back.fg.style.top = '0px';
          back.fg.style.width = '1920px';
          back.fg.style.height = '1080px';
        } else {
          paintAmbilight(back.ambi, pre, 0.28);
          back.ambi.style.display = 'block';
          back.vignette.style.display = 'block';
          var maxW = 1780, maxH = 984;
          var fw = Math.round(maxH * aspect), fh = maxH;
          if (fw > maxW) {
            fw = maxW;
            fh = Math.round(maxW / aspect);
          }
          var fx = Math.round((1920 - fw) / 2);
          var fy = Math.round((1080 - fh) / 2);
          back.fg.className = 'fg framed';
          back.fg.style.left = fx + 'px';
          back.fg.style.top = fy + 'px';
          back.fg.style.width = fw + 'px';
          back.fg.style.height = fh + 'px';
        }
        back.fg.style.backgroundImage = 'url("' + safeCssUrl(p.url) + '")';
        currentTitle = formatSaverTitle(p.title);
        updateClockSubtitle();
        setClass(back.el, 'on', true);
        setClass(front.el, 'on', false);
        front = back;
      };
      pre.onerror = function () {
        pre.onload = pre.onerror = null;
        if (saverOn && !saverPaused) {
          clearTimeout(saverTimer);
          saverTimer = setTimeout(function () { step(1); }, 300);
        }
      };
      pre.src = p.url;
    }

    function scheduleNext() {
      clearTimeout(saverTimer);
      if (!saverPaused && saverOn) {
        saverTimer = setTimeout(function () { step(1); }, 12000);
      }
    }

    function step(dir) {
      if (!saverOn) return;
      var p = null;
      if (dir < 0) {
        if (saverHistIdx > 0) {
          saverHistIdx--;
          p = saverHistory[saverHistIdx];
        } else if (saverHistory.length) {
          p = saverHistory[0];
        }
      } else {
        if (saverHistIdx < saverHistory.length - 1) {
          saverHistIdx++;
          p = saverHistory[saverHistIdx];
        } else {
          p = nextSaverPhoto(list);
          if (p) {
            saverHistory.push(p);
            if (saverHistory.length > 40) saverHistory.shift();
            saverHistIdx = saverHistory.length - 1;
          }
        }
      }
      if (p) showPick(p);
      tickSaverClock(clock);
      scheduleNext();
    }

    saverStepFn = function (dir) {
      step(dir);
      flashControls();
    };
    saverPauseFn = function () {
      saverPaused = !saverPaused;
      updateClockSubtitle();
      scheduleNext();
      flashControls();
    };
    saverHudFn = function () {
      saverHudHidden = !saverHudHidden;
      setClass(clock, 'hud-hidden', saverHudHidden);
      setClass(shade, 'hud-hidden', saverHudHidden);
      flashControls(saverHudHidden ? 'Relógio oculto  ·  ▲▼ Exibir  ·  Voltar Sair' : null);
    };
    s.onclick = function (e) {
      if (e && e.stopPropagation) e.stopPropagation();
      if (saverPauseFn) saverPauseFn();
    };

    setClass(s, 'on', true);
    flashControls();
    step(1);
  }

  function createSaverPhoto(parent) {
    var p = el('div', 'photo', parent);
    var ambi = el('canvas', 'ambilight', p);
    ambi.width = 64;
    ambi.height = 36;
    var vignette = el('div', 'ambi-vignette', p);
    var fg = el('div', 'fg', p);
    return { el: p, ambi: ambi, vignette: vignette, fg: fg };
  }

  function tickSaverClock(clock) {
    if (!clock) return;
    var d = new Date();
    clock.firstChild.textContent = formatDate('format|h:mm', d.getTime());
    clock.children[1].textContent = formatDate('format|EEEE, MMMM d', d.getTime());
  }

  function hideSaver() {
    if (!saverOn) return;
    saverOn = false;
    saverPaused = false;
    saverStepFn = saverPauseFn = saverHudFn = null;
    clearTimeout(saverTimer);
    clearTimeout(saverCtrlTimer);
    var s = $('saver');
    setClass(s, 'on', false);
    setTimeout(function () {
      if (!saverOn && s) s.innerHTML = '';
    }, 1250);
    if (!document.hidden && shelf.length) updateSpotlight(true);
  }

  function poke() {
    idleAt = Date.now();
    if (saverOn) { hideSaver(); return true; }
    return false;
  }

  // MARK: - Keys

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    idleAt = Date.now();
    if (saverOn) {
      if (k === TV.keys.right) { if (saverStepFn) saverStepFn(1); }
      else if (k === TV.keys.left) { if (saverStepFn) saverStepFn(-1); }
      else if (k === TV.keys.ok || k === 415 || k === 19 || k === 32) { if (saverPauseFn) saverPauseFn(); }
      else if (k === TV.keys.up || k === TV.keys.down) { if (saverHudFn) saverHudFn(); }
      else { hideSaver(); }
      e.preventDefault();
      return;
    }
    if (k === TV.keys.left) move(-1, 0);
    else if (k === TV.keys.right) move(1, 0);
    else if (k === TV.keys.up) move(0, -1);
    else if (k === TV.keys.down) move(0, 1);
    else if (k === TV.keys.ok) activate();
    else if (k === TV.keys.back || k === 27 || k === 8) back();
    else return;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function () {
    idleAt = Date.now();
  });
  document.addEventListener('wheel', function (e) {
    idleAt = Date.now();
    if (saverOn) {
      if (e.deltaY > 0 && saverStepFn) saverStepFn(1);
      else if (e.deltaY < 0 && saverStepFn) saverStepFn(-1);
      return;
    }
    if (!sheetOpen()) return;
    if (e.deltaY > 0) move(0, 1);
    else if (e.deltaY < 0) move(0, -1);
  });

  // MARK: - Start

  function renderAll() {
    renderTop();
    renderQuotes();
    cards = [];
    renderCards();
    renderShelf();
    renderDrawer();
    renderClock();
    checkNight();
    if (st.zone === Z.SETTINGS) renderSettings();
    updateFocus();
  }

  /** hide_apps in config.properties: left out of the shelf, All Apps and the picks, by id or name (part of it). */
  var HIDE = (CONFIG.hideApps || []).map(function (s) { return s.toLowerCase(); });
  function hidden(app) {
    var id = (app.id || '').toLowerCase(), title = (app.title || '').toLowerCase();
    for (var i = 0; i < HIDE.length; i++) if (id.indexOf(HIDE[i]) >= 0 || title.indexOf(HIDE[i]) >= 0) return true;
    return false;
  }

  function loadApps(done) {
    TV.apps(function (list) {
      apps = list.filter(function (a) { return !hidden(a); });
      Data.setApps(apps);
      pickShelf();
      TV.inputs(function (list2) {
        inputs = list2;
        if (done) done();
      });
    });
  }

  /** Back to the home screen (the app was opened again): the shelf, everything closed, the first tab. */
  function reset() {
    hideSaver();
    closeSheets();
    st.zone = Z.SHELF;
    st.shelf = 0;
    if (st.tab !== 0) { st.tab = 0; renderCards(); }
    updateFocus();
  }

  Data.onChange(function () {
    renderQuotes();
    renderCards();
    renderPanels();
    checkNight();
  });

  function reopened() {
    // LG: with handlesRelaunch the app has to come to the front itself, or opening it again while it runs shows nothing.
    if (window.PalmSystem && window.PalmSystem.activate) window.PalmSystem.activate();
    reset();
    loadApps(function () { renderShelf(); renderDrawer(); Data.refresh(); });
  }

  window.addEventListener('resize', fit);
  document.addEventListener('webOSRelaunch', reopened);   // LG: opened again while running
  window.addEventListener('appcontrol', reopened);        // Samsung: the same
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      hideSaver();
      stopWallpaperTimer();
      stopLivePreview();
      return;
    }
    idleAt = Date.now();
    startWallpaperTimer();
    loadApps(function () { renderShelf(); renderDrawer(); updateSpotlight(true); updateFocus(); Data.refresh(); });
  });

  I18N.set(Prefs.language());
  checkNight();   // now, from the last forecast: not after the TV lists its apps, with the day look until then
  // LG's screensaver waits only when ours will show: not under a sheet (ours waits there), and not without photos.
  TV.holdScreenSaver(function () { return !sheetOpen() && getActiveWallpapers().length > 0; });
  fit();
  renderTop();
  tickClock();
  initWallpaper();
  initAudioOutput();
  updateWeatherBadge();
  var spotPreview = $('spot-preview-box');
  if (spotPreview) {
    spotPreview.onclick = function () {
      if (shelf[st.shelf]) launcher(shelf[st.shelf].id, shelf[st.shelf].title)();
    };
  }
  loadApps(function () {
    renderAll();
    updateWeatherBadge();
    Data.refresh();
  });
  setInterval(function () {
    if (document.hidden) return;
    checkNight();
    Data.refresh();
    if (!saverOn && !sheetOpen() && Date.now() - idleAt > SAVER_AFTER) showSaver();
    if (saverOn) tickSaverClock($('saver').querySelector('.clock'));
  }, 30000);

  // Clicar fora da caixa fecha a janela / painel ativo
  var allSheets = document.querySelectorAll('.sheet');
  for (var shIdx = 0; shIdx < allSheets.length; shIdx++) {
    (function (sheetEl) {
      sheetEl.addEventListener('click', function (e) {
        if (!hasClass(sheetEl, 'open')) return;
        var cur = e.target;
        while (cur && cur !== sheetEl) {
          if (hasClass(cur, 'box') || hasClass(cur, 'grid')) return;
          cur = cur.parentNode;
        }
        if (cur === sheetEl) back();
      });
    })(allSheets[shIdx]);
  }

  // For the browser preview and tests.
  window.FreeMyTV = {state: st, move: move, activate: activate, back: back, showSaver: showSaver, hideSaver: hideSaver, toast: toast};
})();
