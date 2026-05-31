interface BrandLogoProps {
  size?: number;
}

export function BrandLogo({ size = 24 }: BrandLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      aria-label="Proton Pulse logo"
      role="img"
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      <ellipse cx="18" cy="18" rx="15" ry="5.5" stroke="#66c0f4" strokeWidth="1.4"/>
      <ellipse cx="18" cy="18" rx="15" ry="5.5" stroke="#66c0f4" strokeWidth="1.4" transform="rotate(60 18 18)"/>
      <ellipse cx="18" cy="18" rx="15" ry="5.5" stroke="#66c0f4" strokeWidth="1.4" transform="rotate(-60 18 18)"/>
      <circle cx="18" cy="18" r="3" fill="#66c0f4"/>
    </svg>
  );
}
