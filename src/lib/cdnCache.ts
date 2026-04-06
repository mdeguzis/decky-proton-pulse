// src/lib/cdnCache.ts
//
// Frontend cache-aware fetch layer. Checks the Python backend disk cache
// first (populated by startup prefetch), falls back to network via
// fetchNoCors, and writes successful network responses back to the cache.
//
// The active game (the one the user is currently viewing) always gets
// priority -- its requests bypass the "is it fresh?" check and go
// straight to network if the cache misses.

import { callable, fetchNoCors } from "@decky/api";
import { logFrontendEvent } from "./logger";

// Callable bridge to the Python backend cache (see main.py get_cached_cdn / put_cached_cdn)
const getCachedCdn = callable<
  [app_id: string, filename: string],
  { data: unknown; fresh: boolean }
>("get_cached_cdn");

const putCachedCdn = callable<
  [app_id: string, filename: string, data: unknown],
  boolean
>("put_cached_cdn");

/**
 * Fetch a CDN JSON file with backend cache awareness.
 *
 * 1. Ask the backend if it has a fresh cached copy.
 * 2. If yes, return it immediately (no network).
 * 3. If no, fetch from the CDN, write the result to the backend cache,
 *    and return it.
 */
export async function cachedFetchJson<T>(
  url: string,
  appId: string,
  filename: string,
): Promise<{ data: T | null; fromCache: boolean }> {
  // Try backend cache first
  try {
    const cached = await getCachedCdn(appId, filename);
    if (cached.fresh && cached.data !== null) {
      await logFrontendEvent("DEBUG", "CDN cache hit", { appId, filename });
      return { data: cached.data as T, fromCache: true };
    }
    await logFrontendEvent("DEBUG", "CDN cache miss", {
      appId,
      filename,
      fresh: cached.fresh,
    });
  } catch (error) {
    await logFrontendEvent("DEBUG", "CDN cache backend unavailable, falling back to network", {
      appId,
      filename,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Network fetch
  try {
    await logFrontendEvent("DEBUG", "CDN network fetch", { appId, filename, url });
    const resp = await fetchNoCors(url);
    if (resp.status !== 200) {
      await logFrontendEvent("DEBUG", "CDN network fetch non-200", {
        appId,
        filename,
        url,
        status: resp.status,
      });
      return { data: null, fromCache: false };
    }
    const data = (await resp.json()) as T;

    // Write back to cache (fire-and-forget -- don't block the UI on cache writes)
    putCachedCdn(appId, filename, data).catch(() => {});
    await logFrontendEvent("DEBUG", "CDN network fetch OK, wrote to cache", {
      appId,
      filename,
    });

    return { data, fromCache: false };
  } catch (error) {
    await logFrontendEvent("ERROR", "CDN network fetch failed", {
      appId,
      filename,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return { data: null, fromCache: false };
  }
}
