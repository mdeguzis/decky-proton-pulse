// src/lib/storeTileScript.ts
// Minimalist Proton Pulse tier badges on Steam store artwork (#123).
//
// Same visual language as the library grid badge, but it cannot be built the
// same way. Library tiles live in Big Picture's document, which the plugin can
// touch directly. Store tiles live in the store's own CEF target -- a separate
// browsing context with its own document -- so the badges have to be injected
// as script over the debugger connection.
//
// The split is deliberate: this file only BUILDS strings, and the page only
// PAINTS. All tier lookups happen plugin-side, where the cache and the rate
// limiter already live, and arrive here as a plain id -> tier map. The store
// page never makes a request on our behalf and never learns anything about our
// backends.
//
// SECURITY: these strings are evaluated inside a page we do not control. Every
// value crosses in through a single JSON.stringify bound to a local, never
// concatenated into an expression, and badges are built with createElement so
// nothing can become markup.
//
// Two things learned by measuring the real page, both of which produced a
// silently empty result first time round:
//   - 15 of the featured capsules paint via CSS background-image, not <img>.
//     Scanning only images badged nothing the user could actually see.
//   - the store viewport is ~453 CSS px tall while the page is thousands, so
//     most tiles start below the fold and arrive as the user scrolls. Scanning
//     once is not enough; the plugin re-scans on a timer.

/** Marks a badge element so we can find and remove our own. */
export const TILE_BADGE_ATTR = 'data-pp-tier-badge';

/** Marks a host we have already badged, so rescans stay cheap and idempotent. */
export const TILE_HOST_ATTR = 'data-pp-tier-host';

/**
 * Steam's own Deck compatibility pill on a store capsule.
 *
 * Semantic, not build-hashed -- observed as `ds_steam_deck_compat verified`
 * and `ds_steam_deck_compat unsupported`, 44x24, in the capsule's top-right.
 * Badges are inserted next to it so ours reads as one more compatibility
 * indicator rather than a sticker on the artwork.
 */
export const STEAM_COMPAT_SELECTOR = '.ds_steam_deck_compat';

/** id of the one stylesheet we inject into the store page. */
export const TILE_STYLE_ID = 'proton-pulse-tile-style';

/**
 * Stylesheet driving the focus shuffle.
 *
 * Valve fades its own compatibility pill in only while a capsule is focused or
 * hovered, so a badge parked permanently to the left of it looks stranded next
 * to nothing. Instead ours occupies that same corner slot when the capsule is
 * idle and slides left to make room the moment the pill appears.
 *
 * Done in CSS rather than by polling because the capsule <a> is what actually
 * takes DOM focus (the same fact the footer hint relies on), so :focus-within
 * tracks the gamepad for free and at the compositor's frame rate rather than
 * at our scan interval. The two positions are measured per badge and stored on
 * it as custom properties, so nothing here assumes a fixed pill width.
 *
 * !important because the resting position is an inline style, which would
 * otherwise win.
 */
export function buildBadgeStyleScript(alwaysVisible = true): string {
  const id = JSON.stringify(TILE_STYLE_ID);
  const attr = `[${TILE_BADGE_ATTR}]`;
  const mode = alwaysVisible ? 'always' : 'focus';
  // In focus-only mode the badge behaves exactly like Valve's own pill: absent
  // until the capsule is focused or hovered. Opacity rather than display so it
  // fades with the same easing and never reflows the capsule.
  const rest = alwaysVisible ? '' : `${attr}{opacity:0;}`;
  const active = alwaysVisible
    ? `a:focus-within ${attr},a:hover ${attr}{right:var(--pp-r1)!important;}`
    : `a:focus-within ${attr},a:hover ${attr}{right:var(--pp-r1)!important;opacity:1;}`;
  return `(function () {
  var el = document.getElementById(${id});
  if (el && el.getAttribute('data-mode') === ${JSON.stringify(mode)}) return 'present';
  if (el) el.remove();
  var st = document.createElement('style');
  st.id = ${id};
  st.setAttribute('data-mode', ${JSON.stringify(mode)});
  st.textContent = [
    '${attr}{transition:right .12s ease,opacity .12s ease;}',
    ${JSON.stringify(rest)},
    ${JSON.stringify(active)}
  ].join('');
  (document.head || document.documentElement).appendChild(st);
  return 'added';
})();`;
}

/** Tier -> pill colours. Mirrors RATING_COLORS + the library badge text colours. */
export const TILE_TIER_COLORS: Record<string, { bg: string; fg: string }> = {
  platinum: { bg: '#e5e4e2', fg: '#1a1a2e' },
  gold:     { bg: '#ffd700', fg: '#1a1a00' },
  silver:   { bg: '#c0c0c0', fg: '#1a1a1a' },
  bronze:   { bg: '#cd7f32', fg: '#ffffff' },
  borked:   { bg: '#ff4444', fg: '#ffffff' },
};

/**
 * App id from a Steam CDN artwork URL, or ''.
 *
 * Covers both shapes the store serves:
 *   .../steam/apps/<id>/capsule_616x353.jpg      (classic CDN)
 *   .../store_item_assets/steam/apps/<id>/<hash> (newer item assets)
 */
export function appIdFromArtworkUrl(url: string | null | undefined): string {
  if (!url) return '';
  const m = url.match(/\/(?:steam\/)?apps\/(\d+)\//);
  return m?.[1] ?? '';
}

/**
 * Script that reports the app ids of un-badged artwork currently in the page.
 *
 * Returns a JSON array string. Reports ids only -- resolving them to tiers is
 * the plugin's job.
 *
 * `margin` extends the viewport test so tiles just below the fold are fetched
 * before the user scrolls to them, which is what stops badges popping in late.
 */
export function buildTileScanScript(margin = 900): string {
  const cfg = JSON.stringify({ host: TILE_HOST_ATTR, margin });
  return `(function () {
  var c = ${cfg};
  var out = [], seen = {};
  function consider(el, url) {
    if (!url || url.indexOf('/apps/') === -1) return;
    var m = url.match(/\\/(?:steam\\/)?apps\\/(\\d+)\\//);
    if (!m) return;
    if (el.getAttribute(c.host)) return;
    var r = el.getBoundingClientRect();
    // Skip decoration: tiny icons, and anything far outside the viewport.
    if (r.width < 80 || r.height < 40) return;
    if (r.bottom < -c.margin || r.top > window.innerHeight + c.margin) return;
    if (seen[m[1]]) return;
    seen[m[1]] = 1;
    out.push(m[1]);
  }
  var imgs = document.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) {
    var p = imgs[i].parentElement;
    if (p) consider(p, imgs[i].getAttribute('src') || '');
  }
  // The big featured capsules paint through CSS instead of an <img>.
  var els = document.querySelectorAll('div,a');
  for (var j = 0; j < els.length; j++) {
    var bg = '';
    try { bg = window.getComputedStyle(els[j]).backgroundImage || ''; } catch (e) { continue; }
    if (bg.indexOf('/apps/') === -1) continue;
    consider(els[j], bg);
  }
  return JSON.stringify(out);
})();`;
}

/**
 * Script that paints badges for a resolved id -> tier map.
 *
 * Apps absent from the map are left alone rather than marked, so a later scan
 * retries them once their tier arrives.
 */
export function buildApplyBadgesScript(tiers: Record<string, string>): string {
  const cfg = JSON.stringify({
    tiers,
    colors: TILE_TIER_COLORS,
    attr: TILE_BADGE_ATTR,
    host: TILE_HOST_ATTR,
    compatSel: STEAM_COMPAT_SELECTOR,
  });
  return `(function () {
  var c = ${cfg};
  function icon(doc) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('width', '13'); svg.setAttribute('height', '13');
    svg.setAttribute('viewBox', '0 0 36 36'); svg.setAttribute('fill', 'none');
    [0, 60, -60].forEach(function (deg) {
      var e = doc.createElementNS(ns, 'ellipse');
      e.setAttribute('cx', '18'); e.setAttribute('cy', '18');
      e.setAttribute('rx', '15'); e.setAttribute('ry', '5.5');
      e.setAttribute('stroke', 'currentColor'); e.setAttribute('stroke-width', '2.4');
      if (deg) e.setAttribute('transform', 'rotate(' + deg + ' 18 18)');
      svg.appendChild(e);
    });
    var n = doc.createElementNS(ns, 'circle');
    n.setAttribute('cx', '18'); n.setAttribute('cy', '18'); n.setAttribute('r', '2.8');
    n.setAttribute('fill', 'currentColor');
    svg.appendChild(n);
    return svg;
  }
  // Steam's own Deck compatibility pill on a capsule, if it has one. The class
  // is semantic rather than build-hashed (unlike most of the store's), so it is
  // safe to match on and survives client updates.
  function compatPill(el) {
    try {
      var here = el.querySelector && el.querySelector(c.compatSel);
      if (here) return here;
      var link = el.closest && el.closest('a');
      if (link) return link.querySelector(c.compatSel);
    } catch (e) { /* detached */ }
    return null;
  }
  // Sit the badge immediately left of Steam's compatibility pill.
  //
  // Being a DOM sibling is NOT enough and this is the trap: Steam positions
  // that pill absolutely in the capsule's top-right, so a statically
  // positioned badge inserted next to it flows to the BOTTOM of the capsule
  // instead -- measured as pill at [968,95] with our badge at [691,373] inside
  // a capsule at [691,91,325,306]. So we position absolutely too, anchored off
  // the pill's own measured box, which keeps us correct whatever corner a
  // future Steam build moves it to.
  //
  // Returns false when the pill has no usable box yet, so the caller can leave
  // the badge in its fallback spot and retry on a later pass.
  function placeBesidePill(host, b, pill, shared) {
    var hr, pr;
    try {
      hr = host.getBoundingClientRect();
      pr = pill.getBoundingClientRect();
    } catch (e) { return false; }
    if (!pr.width || !pr.height) { skip.pillUnmeasured++; return false; }
    try {
      if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative';
    } catch (e) { /* detached */ }
    var top = Math.round(pr.top - hr.top);
    // Two slots, both measured off the pill rather than assumed:
    //   r0  idle -- sit exactly where the (currently invisible) pill sits, so
    //       the badge reads as the capsule's corner indicator on its own
    //   r1  focused -- clear of the pill's left edge, so both are readable
    var r0 = Math.round(hr.right - pr.right);
    var r1 = Math.round(hr.right - pr.left) + 5;
    b.style.cssText = shared.concat([
      'position:absolute',
      'top:' + top + 'px',
      'right:' + r0 + 'px',
      'z-index:60',
      'box-shadow:0 1px 5px rgba(0,0,0,0.7)'
    ]).join(';');
    b.style.setProperty('--pp-r1', r1 + 'px');
    return true;
  }

  function paint(el, tier) {
    var col = c.colors[tier];
    // 'pending' -- ProtonDB's answer for a game with too few reports to rate.
    // Deliberately unbadged: a badge is a rating, and there isn't one. This
    // used to return false with no counter, so 11 rated-looking tiles painted
    // nothing and the report could only call it 'unexplained'.
    if (!col) { skip.unrated++; return false; }
    if (el.getAttribute(c.host)) return false;
    el.setAttribute(c.host, '1');

    var b = document.createElement('div');
    b.setAttribute(c.attr, '1');
    b.setAttribute('title', 'Proton Pulse: ' + tier);
    var shared = [
      'display:inline-flex', 'align-items:center', 'justify-content:center',
      'width:24px', 'height:24px', 'border-radius:5px',
      // Never intercept a tap: the whole capsule is a link to the game.
      'pointer-events:none',
      'background:' + col.bg, 'color:' + col.fg
    ];
    b.appendChild(icon(document));

    // Preferred home: alongside Steam's Deck compatibility icon in the
    // capsule's top-right cluster. Ours is a compatibility rating too, so it
    // belongs with the others rather than floating in a corner of the artwork.
    var pill = compatPill(el);
    if (pill && pill.parentElement && placeBesidePill(el, b, pill, shared)) {
      pill.parentElement.insertBefore(b, pill);
      el.setAttribute(c.host, 'compat');
      return true;
    }

    // Fallback for capsules with no compatibility icon: bottom-left of the
    // artwork, the same corner the library grid badge uses.
    try {
      if (window.getComputedStyle(el).position === 'static') el.style.position = 'relative';
    } catch (e) { /* detached */ }
    b.style.cssText = shared.concat([
      'position:absolute', 'left:6px', 'bottom:6px', 'z-index:60',
      'box-shadow:0 1px 5px rgba(0,0,0,0.7)'
    ]).join(';');
    el.appendChild(b);
    // 'fallback', not '1': Steam renders the Deck compatibility icons AFTER
    // our first paint on some capsules, so this host is revisited on a later
    // pass and the badge moves up into the cluster once the pill exists.
    el.setAttribute(c.host, 'fallback');
    return true;
  }

  // Move an already-placed fallback badge into the compatibility cluster now
  // that Steam has rendered it.
  function relocate(el) {
    if (el.getAttribute(c.host) !== 'fallback') return false;
    var pill = compatPill(el);
    if (!pill || !pill.parentElement) return false;
    var b = el.querySelector('[' + c.attr + ']');
    if (!b) { el.setAttribute(c.host, 'compat'); return false; }
    // Rebuild the style list from the badge's own colours: relocate() runs on
    // a later pass and no longer has the tier in hand.
    var shared = [
      'display:inline-flex', 'align-items:center', 'justify-content:center',
      'width:24px', 'height:24px', 'border-radius:5px', 'pointer-events:none',
      'background:' + b.style.backgroundColor, 'color:' + b.style.color
    ];
    if (!placeBesidePill(el, b, pill, shared)) return false;
    pill.parentElement.insertBefore(b, pill);
    el.setAttribute(c.host, 'compat');
    return true;
  }
  function urlOf(el) {
    var img = el.tagName === 'IMG' ? el : null;
    if (img) return img.getAttribute('src') || '';
    var inner = el.querySelector && el.querySelector('img');
    if (inner) return inner.getAttribute('src') || '';
    try { return window.getComputedStyle(el).backgroundImage || ''; } catch (e) { return ''; }
  }
  var painted = 0, moved = 0;
  // Why a visible tile ended up with no badge. Silence here was the problem:
  // the count alone could not distinguish "no reports for this game" from
  // "we could not find anywhere to put it".
  var skip = { noTier: 0, noHost: 0, tooSmall: 0, pillUnmeasured: 0, already: 0, unrated: 0 };
  // Upgrade any fallback placements from an earlier pass first.
  var pending = document.querySelectorAll('[' + c.host + '="fallback"]');
  for (var f = 0; f < pending.length; f++) { if (relocate(pending[f])) moved++; }

  var candidates = document.querySelectorAll('img,div,a');
  for (var i = 0; i < candidates.length; i++) {
    var el = candidates[i];
    var host = el.tagName === 'IMG' ? el.parentElement : el;
    if (!host) { skip.noHost++; continue; }
    if (host.getAttribute(c.host)) {
      // Already handled on an earlier pass. Counted so a settled page does not
      // look like a total failure to paint.
      var seen = (urlOf(el) || '').match(/\\/(?:steam\\/)?apps\\/(\\d+)\\//);
      if (seen && c.tiers[seen[1]]) skip.already++;
      continue;
    }
    var m = (urlOf(el) || '').match(/\\/(?:steam\\/)?apps\\/(\\d+)\\//);
    if (!m) continue;
    var tier = c.tiers[m[1]];
    if (!tier) { skip.noTier++; continue; }
    var r = host.getBoundingClientRect();
    if (r.width < 80 || r.height < 40) { skip.tooSmall++; continue; }
    if (paint(host, tier)) painted++;
  }
  return JSON.stringify({ painted: painted, moved: moved, skipped: skip });
})();`;
}

/** Script that removes every badge we painted and unmarks the hosts. */
export function buildClearBadgesScript(): string {
  const cfg = JSON.stringify({ attr: TILE_BADGE_ATTR, host: TILE_HOST_ATTR });
  return `(function () {
  var c = ${cfg};
  var n = 0;
  document.querySelectorAll('[' + c.attr + ']').forEach(function (e) { e.remove(); n++; });
  document.querySelectorAll('[' + c.host + ']').forEach(function (e) { e.removeAttribute(c.host); });
  return String(n);
})();`;
}

/** Parse the scan script's result into a clean list of app ids. */
export function parseScanResult(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === 'string' && /^\d+$/.test(v));
}

/**
 * Script reporting the app id of the store tile the gamepad is sitting on, or ''.
 *
 * The store page tracks gamepad focus with real DOM focus, so
 * `document.activeElement` is the tile -- confirmed on the store front page,
 * where it came back as the `<a class="store_main_capsule">` whose href held
 * `/app/4026250`. That is why this walks up from activeElement rather than
 * hunting for a "focused" class: the store has 193 elements carrying some
 * variation of `Focusable`, and almost none of them are the selected tile.
 *
 * Three sources per ancestor, because a capsule is not always a link: the href
 * first (cheapest and most precise), then a child image, then CSS artwork.
 */
export function buildFocusedAppScript(): string {
  return `(function () {
  var el = document.activeElement;
  if (!el || el === document.body) return '';
  for (var d = 0; d < 12 && el; d++) {
    if (el.tagName === 'A') {
      var h = (el.getAttribute('href') || '').match(/\\/app\\/(\\d+)/);
      if (h) return h[1];
    }
    var img = el.querySelector && el.querySelector('img');
    if (img) {
      var m = (img.getAttribute('src') || '').match(/\\/(?:steam\\/)?apps\\/(\\d+)\\//);
      if (m) return m[1];
    }
    try {
      var bg = (window.getComputedStyle(el).backgroundImage || '')
        .match(/\\/(?:steam\\/)?apps\\/(\\d+)\\//);
      if (bg) return bg[1];
    } catch (e) { /* detached */ }
    el = el.parentElement;
  }
  return '';
})();`;
}

/** Validate the focused-app script's result into a bare app id, or ''. */
export function parseFocusedApp(raw: unknown): string {
  return typeof raw === 'string' && /^\d+$/.test(raw) ? raw : '';
}

export interface ApplyReport {
  painted: number;
  moved: number;
  skipped: {
    noTier: number;
    noHost: number;
    tooSmall: number;
    pillUnmeasured: number;
    /** Rated tiles already carrying a badge from an earlier pass. */
    already: number;
    /** Games ProtonDB reports as 'pending' -- too few reports to rate. */
    unrated: number;
  };
}

/**
 * Parse the apply script's report, or null when it produced nothing.
 *
 * null specifically means the payload threw: Runtime.evaluate reports an
 * exception by returning no completion value, which is indistinguishable from
 * success unless the caller checks. That ambiguity already hid one bug (a
 * ReferenceError inside the payload) behind a plausible-looking zero.
 */
export function parseApplyReport(raw: unknown): ApplyReport | null {
  if (typeof raw !== 'string' || !raw) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const sk = parsed.skipped ?? {};
  return {
    painted: n(parsed.painted),
    moved: n(parsed.moved),
    skipped: {
      noTier: n(sk.noTier),
      noHost: n(sk.noHost),
      tooSmall: n(sk.tooSmall),
      pillUnmeasured: n(sk.pillUnmeasured),
      already: n(sk.already),
      unrated: n(sk.unrated),
    },
  };
}
