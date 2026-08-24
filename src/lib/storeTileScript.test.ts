// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  STEAM_COMPAT_SELECTOR,
  TILE_BADGE_ATTR,
  TILE_HOST_ATTR,
  TILE_TIER_COLORS,
  appIdFromArtworkUrl,
  buildApplyBadgesScript,
  TILE_STYLE_ID,
  buildBadgeStyleScript,
  buildClearBadgesScript,
  buildFocusedAppScript,
  buildTileScanScript,
  parseApplyReport,
  parseFocusedApp,
  parseScanResult,
} from './storeTileScript';

describe('appIdFromArtworkUrl', () => {
  it('reads the classic CDN capsule path', () => {
    expect(appIdFromArtworkUrl(
      'https://cdn.akamai.steamstatic.com/steam/apps/620/capsule_616x353.jpg',
    )).toBe('620');
  });

  it('reads the newer store_item_assets path', () => {
    // Measured on the real store front page: the featured capsules use this
    // shape, and an /steam/apps/ only matcher misses them.
    expect(appIdFromArtworkUrl(
      'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4026250/8af004afc1.jpg',
    )).toBe('4026250');
  });

  it('reads a url wrapped in a CSS url() value', () => {
    expect(appIdFromArtworkUrl(
      'url("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/440/x.jpg")',
    )).toBe('440');
  });

  it('ignores artwork that carries no app id', () => {
    expect(appIdFromArtworkUrl('https://store.steampowered.com/public/logo.png')).toBe('');
    expect(appIdFromArtworkUrl('https://example.com/apps/notanumber/x.jpg')).toBe('');
  });

  it('returns empty for nothing', () => {
    expect(appIdFromArtworkUrl(null)).toBe('');
    expect(appIdFromArtworkUrl(undefined)).toBe('');
    expect(appIdFromArtworkUrl('')).toBe('');
  });
});

describe('parseScanResult', () => {
  it('accepts a JSON array of numeric ids', () => {
    expect(parseScanResult('["620","440"]')).toEqual(['620', '440']);
  });

  it('drops anything that is not a bare numeric id', () => {
    // The page could be showing anything; only digits become an app id we act on.
    expect(parseScanResult('["620","../../etc",42,null,"7a"]')).toEqual(['620']);
  });

  it('returns empty for malformed or missing results', () => {
    expect(parseScanResult('not json')).toEqual([]);
    expect(parseScanResult('{"a":1}')).toEqual([]);
    expect(parseScanResult(undefined)).toEqual([]);
    expect(parseScanResult(null)).toEqual([]);
    expect(parseScanResult(42)).toEqual([]);
  });
});

describe('buildTileScanScript', () => {
  it('scans both images and CSS background artwork', () => {
    // Regression: the first version looked only at <img> and so badged none of
    // the featured capsules, which paint through background-image.
    const script = buildTileScanScript();
    expect(script).toContain("querySelectorAll('img')");
    expect(script).toContain('backgroundImage');
  });

  it('skips hosts already marked', () => {
    expect(buildTileScanScript()).toContain(JSON.stringify(TILE_HOST_ATTR).slice(1, -1));
  });

  it('carries the lookahead margin so tiles load before they scroll in', () => {
    expect(buildTileScanScript(1234)).toContain('"margin":1234');
  });

  it('parses as valid JavaScript', () => {
    expect(() => new Function(buildTileScanScript())).not.toThrow();
  });
});

describe('buildApplyBadgesScript', () => {
  it('carries the tier map through as JSON', () => {
    const script = buildApplyBadgesScript({ '620': 'gold' });
    expect(script).toContain('"620":"gold"');
  });

  it('builds badges as elements, never as markup', () => {
    const script = buildApplyBadgesScript({ '620': 'gold' });
    expect(script).not.toContain('innerHTML');
    expect(script).toContain('createElement');
  });

  it('keeps the badge click-through so it cannot swallow a tile tap', () => {
    // The whole capsule is a link to the game. A badge that ate the tap would
    // make the store feel broken.
    expect(buildApplyBadgesScript({ '620': 'gold' })).toContain('pointer-events:none');
  });

  it('cannot be broken out of by a hostile tier value', () => {
    const hostile = '"}); alert(1); ({"x":"';
    const script = buildApplyBadgesScript({ '620': hostile });
    const payload = JSON.parse(script.split('var c = ')[1].split(';\n')[0]);
    expect(payload.tiers['620']).toBe(hostile);
    expect(() => new Function(script)).not.toThrow();
  });

  it('cannot be broken out of by a hostile app id key', () => {
    const script = buildApplyBadgesScript({ '620"}); alert(1); ({"a': 'gold' });
    expect(() => new Function(script)).not.toThrow();
  });

  it('ships every tier colour it might be asked to paint', () => {
    const script = buildApplyBadgesScript({ '620': 'gold' });
    for (const tier of Object.keys(TILE_TIER_COLORS)) {
      expect(script).toContain(`"${tier}"`);
    }
  });

  it('parses as valid JavaScript with an empty map', () => {
    expect(() => new Function(buildApplyBadgesScript({}))).not.toThrow();
  });

  it('prefers sitting beside Steam own Deck compatibility icon', () => {
    // Ours is a compatibility rating, so it belongs in the same top-right
    // cluster rather than stuck on the artwork. The selector is semantic
    // (ds_steam_deck_compat), unlike most store classes which are build hashes.
    const script = buildApplyBadgesScript({ '620': 'gold' });
    expect(script).toContain(STEAM_COMPAT_SELECTOR);
    expect(script).toContain('insertBefore');
  });

  it('keeps a fallback for capsules with no compatibility icon', () => {
    const script = buildApplyBadgesScript({ '620': 'gold' });
    expect(script).toContain('position:absolute');
    expect(script).toContain('bottom:6px');
  });


  it('positions the badge absolutely off the pill geometry, not by DOM flow', () => {
    // Regression from on-device measurement: Steam positions its compat pill
    // absolutely in the capsule's top-right, so a static badge inserted as its
    // DOM sibling flowed to the capsule's BOTTOM instead. Pill was at [968,95]
    // while our badge landed at [691,373] in a capsule at [691,91,325,306].
    const script = buildApplyBadgesScript({ '620': 'gold' });
    expect(script).toContain('function placeBesidePill');
    expect(script).toContain('getBoundingClientRect');
    expect(script).not.toContain("'position:static'");
  });

  it('reports painted, relocated and every skip reason', () => {
    const script = buildApplyBadgesScript({ '620': 'gold' });
    for (const k of ['noTier', 'noHost', 'tooSmall', 'pillUnmeasured', 'already', 'unrated']) {
      expect(script).toContain(k);
    }
  });
});

// Executing the script, not just parsing it. The parse-only checks above
// missed a ReferenceError: placeBesidePill closed over `shared`, which is
// declared inside paint(), so every paint threw and the badge count silently
// came back 0 on device.
describe('buildApplyBadgesScript executed against a real DOM', () => {
  function capsule(appId: string, opts: { withPill?: boolean } = {}): HTMLElement {
    document.body.innerHTML = '';
    const a = document.createElement('a');
    a.className = 'store_main_capsule';
    a.setAttribute('href', `/app/${appId}/`);
    const img = document.createElement('img');
    img.setAttribute('src', `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/capsule.jpg`);
    a.appendChild(img);
    if (opts.withPill) {
      const pill = document.createElement('div');
      pill.className = 'ds_steam_deck_compat verified';
      a.appendChild(pill);
    }
    document.body.appendChild(a);
    // jsdom reports zero boxes; stub the geometry the script measures.
    const rect = (o: Record<string, number>) => (() => ({ x: o.left, y: o.top, toJSON: () => o, ...o }) as DOMRect);
    a.getBoundingClientRect = rect({ left: 0, top: 0, right: 325, bottom: 306, width: 325, height: 306 });
    img.getBoundingClientRect = rect({ left: 0, top: 0, right: 325, bottom: 150, width: 325, height: 150 });
    const pill = a.querySelector<HTMLElement>('.ds_steam_deck_compat');
    if (pill) pill.getBoundingClientRect = rect({ left: 277, top: 4, right: 321, bottom: 28, width: 44, height: 24 });
    return a;
  }

  it('actually paints a badge without throwing', () => {
    capsule('620', { withPill: false });
    // The builders emit a bare IIFE statement, so a plain Function body
    // evaluates it but returns nothing. Prepend `return` to capture it, the
    // same way Runtime.evaluate reports the completion value.
    const result = new Function(`return ${buildApplyBadgesScript({ '620': 'gold' })}`)();
    expect(document.querySelectorAll(`[${TILE_BADGE_ATTR}]`).length).toBe(1);
    expect(parseApplyReport(result)!.painted).toBe(1);
  });

  it('anchors beside the pill using absolute geometry', () => {
    capsule('620', { withPill: true });
    new Function(buildApplyBadgesScript({ '620': 'gold' }))();
    const badge = document.querySelector<HTMLElement>(`[${TILE_BADGE_ATTR}]`)!;
    expect(badge.style.position).toBe('absolute');
    expect(badge.style.top).toBe('4px');
    // Idle slot: exactly where Valve's (currently invisible) pill sits, so the
    // badge does not float next to nothing. 325 - 321 = 4.
    expect(badge.style.right).toBe('4px');
    // Focused slot, applied by the stylesheet: clear of the pill's left edge.
    // 325 - 277 + 5 = 53.
    expect(badge.style.getPropertyValue('--pp-r1')).toBe('53px');
    expect(badge.nextElementSibling!.className).toContain('ds_steam_deck_compat');
  });

  it('falls back to the artwork corner when there is no pill', () => {
    capsule('620', { withPill: false });
    new Function(buildApplyBadgesScript({ '620': 'gold' }))();
    const badge = document.querySelector<HTMLElement>(`[${TILE_BADGE_ATTR}]`)!;
    expect(badge.style.position).toBe('absolute');
    expect(badge.style.bottom).toBe('6px');
    expect(document.querySelector(`[${TILE_HOST_ATTR}]`)!.getAttribute(TILE_HOST_ATTR)).toBe('fallback');
  });

  it('counts an unratable tier instead of failing silently', () => {
    // ProtonDB answers 'pending' for a game with too few reports. It is
    // truthy, so it reached the page as a tier, matched no colour, and paint()
    // bailed with no counter -- 11 tiles showed nothing and the report could
    // only say 'unexplained'.
    capsule('620', { withPill: true });
    const out = parseApplyReport(
      new Function(`return ${buildApplyBadgesScript({ '620': 'pending' })}`)(),
    )!;
    expect(out.painted).toBe(0);
    // Counts attempts, not tiles: a capsule is reachable both as the <img>'s
    // parent and as the capsule <a>, so an unrated one is declined twice.
    expect(out.skipped.unrated).toBeGreaterThan(0);
    expect(document.querySelectorAll(`[${TILE_BADGE_ATTR}]`).length).toBe(0);
  });

  it('paints nothing for an app with no tier', () => {
    capsule('620', { withPill: true });
    new Function(buildApplyBadgesScript({ '999': 'gold' }))();
    expect(document.querySelectorAll(`[${TILE_BADGE_ATTR}]`).length).toBe(0);
  });

  it('is idempotent across repeated passes', () => {
    capsule('620', { withPill: true });
    const script = buildApplyBadgesScript({ '620': 'gold' });
    for (let i = 0; i < 4; i++) new Function(script)();
    expect(document.querySelectorAll(`[${TILE_BADGE_ATTR}]`).length).toBe(1);
  });


  it('accounts for already-badged tiles instead of reporting a failure', () => {
    // A settled page paints nothing new. Without an `already` counter that
    // looked like total failure and logged a WARNING every 1.5s.
    capsule('620', { withPill: true });
    const script = buildApplyBadgesScript({ '620': 'gold' });
    expect(parseApplyReport(new Function(`return ${script}`)())!.painted).toBe(1);
    const second = parseApplyReport(new Function(`return ${script}`)())!;
    expect(second.painted).toBe(0);
    expect(second.skipped.already).toBeGreaterThan(0);
  });


});

describe('buildBadgeStyleScript', () => {
  it('shifts the badge only while the capsule has focus or hover', () => {
    const script = buildBadgeStyleScript();
    expect(script).toContain(':focus-within');
    expect(script).toContain(':hover');
    expect(script).toContain('--pp-r1');
    // Inline styles hold the idle slot, so the focused rule has to outrank them.
    expect(script).toContain('!important');
  });

  it('is idempotent -- one stylesheet however often it runs', () => {
    document.body.innerHTML = '';
    document.getElementById(TILE_STYLE_ID)?.remove();
    const script = buildBadgeStyleScript();
    expect(new Function(`return ${script}`)()).toBe('added');
    expect(new Function(`return ${script}`)()).toBe('present');
    expect(document.querySelectorAll(`#${TILE_STYLE_ID}`).length).toBe(1);
  });

  it('hides idle badges in focus-only mode', () => {
    const script = buildBadgeStyleScript(false);
    expect(script).toContain('opacity:0');
    expect(script).toContain('opacity:1');
  });

  it('leaves idle badges visible in always mode', () => {
    expect(buildBadgeStyleScript(true)).not.toContain('opacity:0');
  });

  it('replaces the stylesheet when the mode changes', () => {
    // Without this the toggle would appear to do nothing until the user left
    // and re-entered the store.
    document.body.innerHTML = '';
    document.getElementById(TILE_STYLE_ID)?.remove();
    expect(new Function(`return ${buildBadgeStyleScript(true)}`)()).toBe('added');
    expect(new Function(`return ${buildBadgeStyleScript(false)}`)()).toBe('added');
    expect(document.querySelectorAll(`#${TILE_STYLE_ID}`).length).toBe(1);
    expect(document.getElementById(TILE_STYLE_ID)!.getAttribute('data-mode')).toBe('focus');
  });
});

describe('buildClearBadgesScript', () => {
  it('removes badges and unmarks hosts so a later scan can repaint', () => {
    const script = buildClearBadgesScript();
    expect(script).toContain(TILE_BADGE_ATTR);
    expect(script).toContain(TILE_HOST_ATTR);
    expect(script).toContain('removeAttribute');
  });

  it('parses as valid JavaScript', () => {
    expect(() => new Function(buildClearBadgesScript())).not.toThrow();
  });
});

describe('buildFocusedAppScript', () => {
  it('reads the highlighted tile from real DOM focus', () => {
    // The store tracks gamepad focus with document.activeElement -- confirmed
    // on the front page, where it was the <a class="store_main_capsule"> whose
    // href held the app id. Matching on a "focused" class would be hopeless:
    // the page carries 193 elements with some variant of Focusable.
    const script = buildFocusedAppScript();
    expect(script).toContain('document.activeElement');
    expect(script).not.toContain('Focusable');
  });

  it('tries href, then image, then CSS artwork', () => {
    const script = buildFocusedAppScript();
    expect(script).toContain("getAttribute('href')");
    expect(script).toContain("querySelector('img')");
    expect(script).toContain('backgroundImage');
  });

  it('parses as valid JavaScript', () => {
    expect(() => new Function(buildFocusedAppScript())).not.toThrow();
  });
});

describe('parseFocusedApp', () => {
  it('accepts a bare app id', () => {
    expect(parseFocusedApp('620')).toBe('620');
  });

  it('rejects anything else, including an empty focus result', () => {
    expect(parseFocusedApp('')).toBe('');
    expect(parseFocusedApp('620a')).toBe('');
    expect(parseFocusedApp('../../etc')).toBe('');
    expect(parseFocusedApp(620)).toBe('');
    expect(parseFocusedApp(null)).toBe('');
    expect(parseFocusedApp(undefined)).toBe('');
  });
});

describe('parseApplyReport', () => {
  it('parses a well formed report', () => {
    const r = parseApplyReport(JSON.stringify({
      painted: 3, moved: 1,
      skipped: { noTier: 2, noHost: 0, tooSmall: 1, pillUnmeasured: 0, already: 5, unrated: 4 },
    }))!;
    expect(r.painted).toBe(3);
    expect(r.moved).toBe(1);
    expect(r.skipped.unrated).toBe(4);
    expect(r.skipped.already).toBe(5);
  });

  it('returns null when the payload threw', () => {
    // Runtime.evaluate signals an exception by returning no completion value.
    // Collapsing that into a zero count is what hid a ReferenceError in the
    // injected script until badges silently stopped appearing on device.
    expect(parseApplyReport(undefined)).toBeNull();
    expect(parseApplyReport('')).toBeNull();
    expect(parseApplyReport('not json')).toBeNull();
    expect(parseApplyReport('null')).toBeNull();
  });

  it('defaults missing counters rather than yielding NaN', () => {
    const r = parseApplyReport('{"painted":2}')!;
    expect(r.painted).toBe(2);
    expect(r.moved).toBe(0);
    expect(r.skipped.noTier).toBe(0);
  });
});

