// src/components/tabs/AboutTab.tsx

import { Focusable, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { BrandLogo } from '../BrandLogo';

const LINKS: Array<{ label: string; url: string }> = [
  { label: 'GitHub', url: 'https://github.com/mdeguzis/decky-proton-pulse' },
  { label: 'ProtonDB', url: 'https://www.protondb.com' },
];

export function AboutTab() {
  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
  };

  return (
    <Focusable onGamepadDirection={handleRootDirection} style={{ padding: 8, fontSize: 12, color: '#ccc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <BrandLogo size={42} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Proton Pulse</div>
          <div style={{ color: '#888' }}>v0.1.0</div>
        </div>
      </div>
      <div style={{ marginBottom: 16, lineHeight: 1.5 }}>
        Ranks ProtonDB community reports by system compatibility and applies the best-matching
        Proton launch options to your Steam games — all from the Decky sidebar.
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {LINKS.map(({ label, url }) => (
          <a
            key={label}
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#4c9eff', textDecoration: 'none' }}
          >
            {label} ↗
          </a>
        ))}
      </div>
    </Focusable>
  );
}
