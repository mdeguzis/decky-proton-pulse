// Reused across ConfigEditorModal, ConfigureTab, ManageTab, and ReportDetailModal.
// The plain <img src={STEAM_HEADER_URL}> pattern that used to live in each
// component rendered a purple broken-image glyph for non-Steam shortcuts because
// the Steam CDN URL returns a placeholder (not a 404) for shortcut IDs. This
// shared component falls back to the local Steam grid artwork and then to null,
// so shortcut games render either the user-set artwork or no image at all.

import { useState, useRef, useEffect } from 'react';
import { getGridArtworkDataUrl, NON_STEAM_ID_THRESHOLD } from '../lib/steamApps';

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

// Non-Steam shortcuts have appid > NON_STEAM_ID_THRESHOLD. The Steam CDN
// returns a purple placeholder image (not a 404) for those ids so the
// <img>'s onError never fires and the placeholder sits there forever
// (#112). Skip Steam CDN entirely for shortcuts and read from the local
// Steam grid artwork on disk instead.
function isNonSteamShortcut(id: number): boolean {
  return id >= NON_STEAM_ID_THRESHOLD;
}

interface GameBannerProps {
  appId: number;
  style?: React.CSSProperties;
}

export function GameBanner({ appId, style }: GameBannerProps) {
  const shortcut = isNonSteamShortcut(appId);
  const [src, setSrc] = useState(shortcut ? '' : STEAM_HEADER_URL(appId));
  const triedGrid = useRef(false);

  // For shortcuts, kick off the grid-artwork lookup on mount instead of
  // waiting for the Steam CDN to fail (which never happens for them).
  useEffect(() => {
    if (!shortcut || triedGrid.current) return;
    triedGrid.current = true;
    void getGridArtworkDataUrl(appId).then((dataUrl) => {
      setSrc(dataUrl || '');
    });
  }, [shortcut, appId]);

  const handleError = () => {
    if (triedGrid.current) {
      setSrc('');
      return;
    }
    triedGrid.current = true;
    void getGridArtworkDataUrl(appId).then((dataUrl) => {
      setSrc(dataUrl || '');
    });
  };

  if (!src) return null;
  return <img src={src} style={style} onError={handleError} />;
}
