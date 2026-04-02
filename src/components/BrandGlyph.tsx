interface BrandGlyphProps {
  size?: number;
}

export function BrandGlyph({ size = 20 }: BrandGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-label="Proton Pulse glyph"
      role="img"
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="32,10 46,16 54,28 50,44 32,54 14,44 10,28 18,16" strokeWidth="3" />
        <polygon points="32,18 41,22 46,31 43,40 32,46 21,40 18,31 23,22" strokeWidth="2.5" opacity="0.9" />
        <circle cx="32" cy="32" r="7" strokeWidth="2.5" />
        <path d="M32 32 L32 18 C37 19.5 41 23.5 42.5 28.5 C44 33.5 42 39 37.5 42.5" strokeWidth="2.5" />
      </g>
    </svg>
  );
}
