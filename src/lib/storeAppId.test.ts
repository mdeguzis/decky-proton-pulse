import { describe, it, expect } from 'vitest';
import { extractStoreAppId, findStoreUrlText, isOnStoreRoute, storeAppIdFromDocument } from './storeAppId';

describe('extractStoreAppId', () => {
  it('pulls the id off a plain store app URL', () => {
    expect(extractStoreAppId('https://store.steampowered.com/app/620/Portal_2/')).toBe('620');
  });

  it('handles the id with no trailing slug', () => {
    expect(extractStoreAppId('https://store.steampowered.com/app/620')).toBe('620');
    expect(extractStoreAppId('https://store.steampowered.com/app/620/')).toBe('620');
  });

  it('handles a query string or fragment', () => {
    expect(extractStoreAppId('https://store.steampowered.com/app/620?snr=1_4_4')).toBe('620');
    expect(extractStoreAppId('https://store.steampowered.com/app/620#reviews')).toBe('620');
  });

  it('ignores store pages that are not an app', () => {
    expect(extractStoreAppId('https://store.steampowered.com/')).toBe('');
    expect(extractStoreAppId('https://store.steampowered.com/search/?term=portal')).toBe('');
    expect(extractStoreAppId('https://store.steampowered.com/bundle/234/')).toBe('');
  });

  it('ignores anything that is not the Steam store', () => {
    expect(extractStoreAppId('https://steamcommunity.com/app/620')).toBe('');
    expect(extractStoreAppId('https://steamloopback.host/app/620')).toBe('');
  });

  it('matches on the parsed host, not a substring of the URL', () => {
    // Regression: the first version substring-searched the whole URL, so a
    // hostile host could carry the real store host in its PATH and be treated
    // as the store. This value decides which game the plugin opens.
    expect(extractStoreAppId('https://evil.example.com/store.steampowered.com/app/620/')).toBe('');
    expect(extractStoreAppId('https://evil.example.com/?x=store.steampowered.com/app/620/')).toBe('');
    expect(extractStoreAppId('https://store.steampowered.com.evil.example.com/app/620/')).toBe('');
    expect(extractStoreAppId('https://evil.example.com#store.steampowered.com/app/620/')).toBe('');
  });

  it('requires /app to be the start of the path', () => {
    expect(extractStoreAppId('https://store.steampowered.com/news/app/620/')).toBe('');
  });

  it('ignores non-http schemes', () => {
    expect(extractStoreAppId('javascript:alert(1)//store.steampowered.com/app/620/')).toBe('');
    expect(extractStoreAppId('file:///store.steampowered.com/app/620/')).toBe('');
  });

  it('rejects a non-numeric id rather than sanitizing it', () => {
    expect(extractStoreAppId('https://store.steampowered.com/app/6a20/')).toBe('');
  });

  it('returns empty for nothing', () => {
    expect(extractStoreAppId(null)).toBe('');
    expect(extractStoreAppId(undefined)).toBe('');
    expect(extractStoreAppId('')).toBe('');
  });
});

describe('isOnStoreRoute', () => {
  it('recognizes the store route as Steam actually reports it', () => {
    // Confirmed on-device: location.pathname reads '/routes/steamweb' with the
    // store open, so an anchored '/steamweb' check would never fire.
    expect(isOnStoreRoute('/routes/steamweb')).toBe(true);
    expect(isOnStoreRoute('/steamweb')).toBe(true);
    expect(isOnStoreRoute('/routes/steamweb/app/620')).toBe(true);
  });

  it('rejects other routes', () => {
    expect(isOnStoreRoute('/routes/library/home')).toBe(false);
    expect(isOnStoreRoute('/library/home')).toBe(false);
    expect(isOnStoreRoute('/library/app/620')).toBe(false);
    expect(isOnStoreRoute('/proton-pulse')).toBe(false);
    expect(isOnStoreRoute('')).toBe(false);
    expect(isOnStoreRoute(null)).toBe(false);
    expect(isOnStoreRoute(undefined)).toBe(false);
  });
});

// Stand-in for Big Picture's document. Shaped after what is actually there:
// a small tree of leaf elements, one of which holds the store URL as text.
// Verified on-device -- 139 elements, no webview, no iframe.
function fakeDoc(nodes: { text?: string; childCount?: number; }[], opts: { throws?: boolean } = {}): Document {
  return {
    querySelectorAll: () => {
      if (opts.throws) throw new Error('refused');
      return nodes.map((n) => ({
        children: { length: n.childCount ?? 0 },
        textContent: n.text ?? '',
      }));
    },
  } as unknown as Document;
}

const URL_NODE = { text: 'https://store.steampowered.com/app/620/Portal_2/' };

describe('findStoreUrlText', () => {
  it('finds the address text among the rest of the chrome', () => {
    const doc = fakeDoc([
      { text: 'Browse' }, { text: 'Wishlist' }, URL_NODE, { text: '19:14' },
    ]);
    expect(findStoreUrlText(doc)).toBe('https://store.steampowered.com/app/620/Portal_2/');
  });

  it('trims surrounding whitespace', () => {
    expect(findStoreUrlText(fakeDoc([{ text: '  https://store.steampowered.com/app/620/  ' }])))
      .toBe('https://store.steampowered.com/app/620/');
  });

  it('skips non-leaf ancestors that merely contain the text', () => {
    // Without the leaf check, an ancestor div wrapping the whole chrome would
    // match first and return the concatenated text of everything inside it.
    const doc = fakeDoc([
      { text: 'Browse https://store.steampowered.com/app/620/ 19:14', childCount: 3 },
      URL_NODE,
    ]);
    expect(findStoreUrlText(doc)).toBe('https://store.steampowered.com/app/620/Portal_2/');
  });

  it('ignores nodes outside the length bounds', () => {
    expect(findStoreUrlText(fakeDoc([{ text: 'store.steampowered.com'.slice(0, 8) }]))).toBe('');
    expect(findStoreUrlText(fakeDoc([{ text: 'x'.repeat(400) + 'store.steampowered.com' }]))).toBe('');
  });

  it('returns empty when the chrome shows no store URL', () => {
    expect(findStoreUrlText(fakeDoc([{ text: 'Browse' }, { text: 'Library' }]))).toBe('');
  });

  it('returns empty for a missing document or a refused query', () => {
    expect(findStoreUrlText(null)).toBe('');
    expect(findStoreUrlText(undefined)).toBe('');
    expect(findStoreUrlText(fakeDoc([], { throws: true }))).toBe('');
  });
});

describe('storeAppIdFromDocument', () => {
  it('reads the app id off the address text', () => {
    expect(storeAppIdFromDocument(fakeDoc([URL_NODE]))).toBe('620');
  });

  it('follows in-store navigation', () => {
    // The address element updates in place; confirmed on-device that it moved
    // from app/620 to app/440 within three seconds of a navigation.
    expect(storeAppIdFromDocument(fakeDoc([{ text: 'https://store.steampowered.com/app/440/Team_Fortress_2/' }]))).toBe('440');
  });

  it('returns empty on the store front page', () => {
    // Real observed value when leaving an app page.
    expect(storeAppIdFromDocument(fakeDoc([{ text: 'https://store.steampowered.com/' }]))).toBe('');
  });

  it('returns empty on store search and cart pages', () => {
    expect(storeAppIdFromDocument(fakeDoc([{ text: 'https://store.steampowered.com/search/?term=portal' }]))).toBe('');
  });

  it('applies the host allowlist to the scanned text', () => {
    expect(storeAppIdFromDocument(fakeDoc([{ text: 'https://evil.example.com/store.steampowered.com/app/620/' }]))).toBe('');
  });

  it('returns empty for a missing document', () => {
    expect(storeAppIdFromDocument(null)).toBe('');
    expect(storeAppIdFromDocument(undefined)).toBe('');
  });
});
