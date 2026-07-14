// Reused across ConfigEditorModal, ConfigureTab, ManageTab, and ReportDetailModal.
// The plain <img src={STEAM_HEADER_URL}> pattern that used to live in each
// component rendered a purple broken-image glyph for non-Steam shortcuts because
// the Steam CDN URL returns a placeholder (not a 404) for shortcut IDs. This
// shared component falls back to the local Steam grid artwork and then to null,
// so shortcut games render either the user-set artwork or no image at all.

import { useState, useRef } from 'react';
import { getGridArtworkDataUrl } from '../lib/steamApps';

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

interface GameBannerProps {
  appId: number;
  style?: React.CSSProperties;
}

export function GameBanner({ appId, style }: GameBannerProps) {
  const [src, setSrc] = useState(STEAM_HEADER_URL(appId));
  const triedGrid = useRef(false);

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
