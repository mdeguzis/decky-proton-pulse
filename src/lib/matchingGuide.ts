import { WEIGHTS } from './scoring';

export interface RuleTier {
  label: string;
  note: string;
}

export interface RuleSection {
  field: string;
  description: string;
  tiers: RuleTier[];
}

export const MATCHING_GUIDE_LEGEND_PREFIX = 'Per-field match colours:';
export const MATCHING_GUIDE_LEGEND_GREEN = '* green >= 80%';
export const MATCHING_GUIDE_LEGEND_AMBER = '* amber >= 50%';
export const MATCHING_GUIDE_LEGEND_RED = '* red < 50%';

// Builds the rule sections at call time so WEIGHTS values are always current.
export function buildMatchingRules(): RuleSection[] {
  return [
    {
      field: 'Overall Relevance Score',
      description:
        `The relevance score is a composite number used to rank reports. It is NOT the same as the `
        + `per-field match % shown in the table - those are independent field comparisons. `
        + `The score starts from the report's Proton rating, then adds bonuses and applies multipliers.`,
      tiers: [
        { label: 'Rating base', note: `Platinum=${WEIGHTS.BASE_MAX}, Gold=${Math.round(0.8 * WEIGHTS.BASE_MAX)}, Silver=${Math.round(0.6 * WEIGHTS.BASE_MAX)}, Bronze=${Math.round(0.4 * WEIGHTS.BASE_MAX)}, Borked=0 pts` },
        { label: 'Recency bonus', note: `< 90 days: +${WEIGHTS.RECENCY_RECENT} pts, 90-365 days: +${WEIGHTS.RECENCY_MID} pts, > 1 year: ${WEIGHTS.RECENCY_OLD} pts` },
        { label: 'Custom Proton', note: `+${WEIGHTS.CUSTOM_PROTON} pts if report used a custom build (GE, CachyOS, TKG, etc.)` },
        { label: 'Proton version', note: `+${WEIGHTS.PROTON_MATCH} pts same major, +${WEIGHTS.PROTON_CLOSE} pts adjacent major` },
        { label: 'Notes sentiment', note: `+/-0-${WEIGHTS.NOTES_MAX} pts from positive/negative keywords in the report notes` },
        { label: 'GPU mult', note: `x${WEIGHTS.GPU_DRIVER_EXACT} exact driver, x${WEIGHTS.GPU_DRIVER_CLOSE} close driver, x${WEIGHTS.GPU_MATCH} vendor match, x${WEIGHTS.GPU_UNKNOWN} unknown, x${WEIGHTS.GPU_MISMATCH} vendor mismatch` },
        { label: 'OS mult', note: `x${WEIGHTS.OS_EXACT} exact distro, x${WEIGHTS.OS_FAMILY_MATCH} same family, x1.0 different family` },
        { label: 'Kernel mult', note: `x${WEIGHTS.KERNEL_EXACT} exact, x${WEIGHTS.KERNEL_PATCH_CLOSE} nearby patch, x${WEIGHTS.KERNEL_MINOR_CLOSE} nearby minor, x1.0 otherwise` },
        { label: 'Borked decay', note: `Borked reports older than ${WEIGHTS.BORKED_DECAY_DAYS} days are treated as Bronze (they may have been fixed)` },
      ],
    },
    {
      field: 'GPU Model',
      description:
        'Vendor mismatch (NVIDIA vs AMD) immediately gives 10%. '
        + 'Same vendor: 40 pts base + up to 60 pts from model token overlap. '
        + 'Cross-generation penalty applied after: -5 pts (1 gen apart), -12 pts (2 gens), -20 pts (3+ gens). '
        + 'Noise tokens (LLVM, DRM, kernel version) are stripped before comparison. '
        + 'VRAM is estimated from a built-in lookup table (~80 GPU models). '
        + 'When game minimum requirements include a VRAM figure and both GPUs meet it, score is boosted to 85%. '
        + 'An 8+ GB VRAM gap between report and system GPUs applies a -5 penalty (only when no game-aware boost is active). '
        + 'When game requirements are available and all three GPUs (report, system, game min) share the same vendor, score is boosted to at least 80%.',
      tiers: [
        { label: '>= 85% - green', note: 'Both GPUs meet game minimum VRAM requirement' },
        { label: '>= 80% - green', note: 'Same vendor as game requirement + report + system' },
        { label: '>= 60% - green', note: 'Same vendor + strong model overlap + same generation' },
        { label: '35-59% - amber', note: 'Same vendor, partial overlap or adjacent generation' },
        { label: '10% - red', note: 'Different vendor' },
        { label: '0%', note: 'GPU string missing' },
      ],
    },
    {
      field: 'GPU Driver',
      description:
        'Compares major driver version numbers. Mesa strings with an OpenGL prefix '
        + '("4.6 (Compatibility Profile) Mesa 22.2.0") correctly extract the Mesa major (22), '
        + 'not the OpenGL version. '
        + 'Color thresholds: green >= 60%, amber >= 35%.',
      tiers: [
        { label: '100% - green', note: 'Same major driver version' },
        { label: '75% - green', note: 'Within 2 major versions' },
        { label: '50% - amber', note: 'Within 5 major versions' },
        { label: '20% - red', note: 'More than 5 major versions apart' },
        { label: '0%', note: 'Driver string missing or unparseable' },
      ],
    },
    {
      field: 'CPU',
      description:
        'Compares CPU brand (AMD vs Intel) and model name tokens. '
        + 'Noise words ("with", "Processor", "APU", "Graphics", trademark symbols) are stripped. '
        + 'Brand mismatch immediately gives 10%. '
        + 'When game requirements are available and all three CPUs (report, system, game min) share the same brand, score is boosted to at least 80%.',
      tiers: [
        { label: '>= 80% - green', note: 'Same brand as game requirement + report + system, or high model token overlap' },
        { label: '35-59% - amber', note: 'Same brand, 30 pts base + up to 70 pts from token overlap' },
        { label: '10% - red', note: 'Different brand (AMD vs Intel)' },
        { label: '0%', note: 'CPU string missing' },
      ],
    },
    {
      field: 'OS / Distro',
      description:
        'Detects distro family from the OS string. '
        + 'Known families: SteamOS/HoloISO, Fedora/Bazzite/Nobara, Arch/CachyOS/Manjaro/Garuda, '
        + 'Ubuntu/Pop!_OS/Mint/Elementary, Debian, NixOS. '
        + 'Color thresholds: green >= 80%, amber >= 50%.',
      tiers: [
        { label: '100% - green', note: 'Exact distro string match' },
        { label: '70% - amber', note: 'Same distro family (e.g. both Arch-based)' },
        { label: '10% - red', note: 'Different family' },
        { label: '0%', note: 'OS string missing' },
      ],
    },
    {
      field: 'Kernel',
      description:
        'Compares major.minor.patch kernel versions. '
        + 'Valve/neptune kernels (e.g. "5.13.0-valve36") use the Valve build number for comparison - '
        + "both systems share Valve's downstream patches regardless of upstream version. "
        + 'Color thresholds: green >= 80%, amber >= 50%.',
      tiers: [
        { label: '100% - green', note: 'Exact major.minor.patch' },
        { label: '95% - green', note: 'Both Valve kernels, same major.minor, build diff <= 5' },
        { label: '85% - green', note: 'Same major.minor, patch diff <= 2 (or Valve same major)' },
        { label: '75% - amber', note: 'Both Valve kernels, different upstream major, build diff <= 10' },
        { label: '65% - amber', note: 'Same major, minor differs by 1' },
        { label: '40% - red', note: 'Same major, distant minor' },
        { label: '10% - red', note: 'Different major kernel version' },
        { label: '0%', note: 'Kernel string missing' },
      ],
    },
    {
      field: 'RAM',
      description:
        'Compares reported RAM in GB. '
        + 'When game minimum requirements are fetched from the Steam Store API and both systems '
        + 'exceed that minimum, the raw GB delta matters less - both rigs have enough for the game. '
        + 'Color thresholds: green >= 80%, amber >= 50%.',
      tiers: [
        { label: '100% - green', note: 'Within 2 GB' },
        { label: '85% - green', note: 'Both exceed game minimum, moderate delta (<= 8 GB apart)' },
        { label: '75% - amber', note: 'Within 4 GB' },
        { label: '70% - amber', note: 'Both exceed game minimum, large delta (> 8 GB apart)' },
        { label: '50% - amber', note: 'Within 8 GB' },
        { label: '20% - red', note: 'More than 8 GB apart' },
        { label: '0%', note: 'RAM string or system RAM missing' },
      ],
    },
    {
      field: 'Proton Version',
      description:
        `Compares the major Proton version in the report vs your current build. `
        + `Formats parsed: GE-Proton9-7, Proton 9.0-4, cachyos-10.0-..., proton-7.0-6. `
        + `"Proton Experimental" and SteamLinuxRuntime have no parseable version -> 0%. `
        + `Same major also adds +${WEIGHTS.PROTON_MATCH} pts to the relevance score; adjacent major adds +${WEIGHTS.PROTON_CLOSE} pts. `
        + 'Color thresholds: green >= 60%, amber >= 35%.',
      tiers: [
        { label: '100% - green', note: 'Same major version (e.g. both Proton 9.x)' },
        { label: '70% - amber', note: 'Adjacent major version (e.g. 8 vs 9)' },
        { label: '45% - red', note: '2 major versions apart' },
        { label: '20% - red', note: '3 or more major versions apart' },
        { label: '0%', note: 'Version unparseable or not set' },
      ],
    },
  ];
}
