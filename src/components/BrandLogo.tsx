interface BrandLogoProps {
  size?: number;
}

export function BrandLogo({ size = 24 }: BrandLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-label="Proton Pulse logo"
      role="img"
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      <defs>
        <linearGradient id="proton-pulse-ring" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1db5ff" />
          <stop offset="55%" stopColor="#4df0c8" />
          <stop offset="100%" stopColor="#c8f05a" />
        </linearGradient>
        <radialGradient id="proton-pulse-core" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#f5ffb8" />
          <stop offset="45%" stopColor="#9effd7" />
          <stop offset="100%" stopColor="#1a2a3a" />
        </radialGradient>
      </defs>

      <rect x="2" y="2" width="60" height="60" rx="16" fill="#101826" />

      <g
        fill="none"
        stroke="url(#proton-pulse-ring)"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="32,8 46,14 54,28 50,44 32,56 14,44 10,28 18,14" strokeWidth="2.6" opacity="0.95" />
        <polygon points="32,14 43,19 49,29 46,41 32,50 18,41 15,29 21,19" strokeWidth="2.3" opacity="0.92" />
        <polygon points="32,20 40,24 45,31 42,39 32,46 22,39 19,31 24,24" strokeWidth="2.1" opacity="0.88" />
      </g>

      <circle cx="32" cy="32" r="8.5" fill="url(#proton-pulse-core)" />
      <circle cx="32" cy="32" r="3.5" fill="#f8ffe0" />

      <path
        d="M32 32 L32 17 C37 18.5 41 22.5 42.5 27.5 C44 32.5 42 38.5 37.5 42"
        fill="none"
        stroke="#dfffb5"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
