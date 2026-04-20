const LINK_PAGE_BASE_URL = 'https://www.proton-pulse.com/plugin-link.html';
const LINK_PAGE_VERSION = '20260420d';

export function buildPluginLinkProfileUrl(code?: string | null): string {
  const trimmedCode = code?.trim().toUpperCase();
  const url = new URL(LINK_PAGE_BASE_URL);
  url.searchParams.set('ppv', LINK_PAGE_VERSION);
  if (!trimmedCode) return url.toString();

  url.searchParams.set('pluginLinkCode', trimmedCode);
  return url.toString();
}
