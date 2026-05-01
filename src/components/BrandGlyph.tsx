interface BrandGlyphProps {
  size?: number;
  variant?: 'default' | 'material';
}

export function BrandGlyph({ size = 20, variant = 'default' }: BrandGlyphProps) {
  if (variant === 'material') {
    // Simplified two-element icon: octagonal badge outline + pulse waveform.
    // Designed for small sizes (20-24px) as a material-style button icon.
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-label="Proton Pulse"
        role="img"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ display: 'block', flex: '0 0 auto' }}
      >
        <path d="M12 2l5.2 2.8 2.8 4.5V14.7l-2.8 4.5L12 22l-5.2-2.8L4 14.7V9.3l2.8-4.5z" />
        <polyline points="6.5,12 8.5,12 10,9.5 12,14.5 14,9.5 15.5,12 17.5,12" />
      </svg>
    );
  }

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
