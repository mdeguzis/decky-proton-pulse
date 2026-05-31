interface BrandLogoWideProps {
  atomSize?: number;
}

export function BrandLogoWide({ atomSize = 40 }: BrandLogoWideProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <svg
        width={atomSize}
        height={atomSize}
        viewBox="0 0 36 36"
        fill="none"
        aria-hidden="true"
        style={{ display: 'block', flex: '0 0 auto' }}
      >
        <ellipse cx="18" cy="18" rx="15" ry="5.5" stroke="#66c0f4" strokeWidth="1.4"/>
        <ellipse cx="18" cy="18" rx="15" ry="5.5" stroke="#66c0f4" strokeWidth="1.4" transform="rotate(60 18 18)"/>
        <ellipse cx="18" cy="18" rx="15" ry="5.5" stroke="#66c0f4" strokeWidth="1.4" transform="rotate(-60 18 18)"/>
        <circle cx="18" cy="18" r="3" fill="#66c0f4"/>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
        <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '0.03em', color: '#ffffff' }}>
          Proton <span style={{ color: '#66c0f4' }}>Pulse</span>
        </span>
        <span style={{ fontSize: 10, color: '#67788c', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Open Compatibility Platform
        </span>
      </div>
    </div>
  );
}
