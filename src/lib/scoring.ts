// src/lib/scoring.ts
//
// Scores ProtonDB community reports so the frontend can rank them by relevance.
// A report's score is based on: rating (platinum > borked), how recent it is,
// whether it used a custom Proton build, and how closely the reporter's GPU
// matches the current system. Higher score = more relevant to *this* user.
//
// The weights below control the balance between these factors. Tweak them
// if the ranking feels off for certain edge cases.

import type { CdnReport, ScoredReport, SystemInfo, TieredReports, GpuTier } from '../types';
import type { ProtonRating } from '../types';

// ─── Weights, edit these to tune ranking ──────────────────────────────────────
export const WEIGHTS = {
  BASE_MAX: 60,            // max points from the rating alone (platinum=60, borked=0)
  RECENCY_RECENT: 15,      // bonus for reports < 90 days old
  RECENCY_MID: 5,          // bonus for 90-365 days
  RECENCY_OLD: -5,         // penalty for > 1 year old
  CUSTOM_PROTON: 10,       // bonus if report used GE/CachyOS/TKG etc
  GPU_MATCH: 1.0,          // multiplier when GPU vendor matches yours
  GPU_MISMATCH: 0.5,       // multiplier for different vendor (halves the score)
  GPU_UNKNOWN: 0.75,       // multiplier when report doesnt say what GPU
  GPU_DRIVER_EXACT: 1.3,   // same vendor + same driver major version
  GPU_DRIVER_CLOSE: 1.1,   // same vendor + driver within 2 major versions
  OS_EXACT: 1.08,          // same distro string / exact OS family
  OS_FAMILY_MATCH: 1.04,   // same general distro family
  KERNEL_EXACT: 1.12,      // same major.minor.patch kernel line
  KERNEL_PATCH_CLOSE: 1.08,// same major.minor, nearby patch level
  KERNEL_MINOR_CLOSE: 1.04,// same major, nearby minor line
  BORKED_DECAY_DAYS: 365,  // borked reports older than this get treated as bronze
  NOTES_MAX: 10,           // cap on the sentiment modifier from user notes
  PROTON_MATCH: 8,         // bonus for same Proton major version as user's build
  PROTON_CLOSE: 4,         // bonus for adjacent Proton major version
} as const;

const RATING_SCORES: Record<string, number> = {
  platinum: 1.0,
  gold: 0.8,
  silver: 0.6,
  bronze: 0.4,
  borked: 0.0,
};

export function scoreToMatchTier(score: number): ProtonRating {
  if (score >= 80) return 'platinum';
  if (score >= 60) return 'gold';
  if (score >= 40) return 'silver';
  if (score >= 20) return 'bronze';
  return 'borked';
}

const CUSTOM_PROTON_MARKERS = ['ge', 'cachyos', 'tkg', 'protonplus', 'experimental'];

const NEGATIVE_KEYWORDS = [
  'crash', 'broken', 'freeze', 'black screen', 'hang', 'softlock',
  'corrupted', "doesn't work", 'unplayable', "won't launch",
];

const POSITIVE_KEYWORDS = [
  'perfect', 'flawless', 'works great', 'no issues', 'out of the box',
  'excellent', 'runs perfectly', 'zero issues', 'works flawlessly',
];

// words that negate the following negative keyword
// "no crash", "never crashes", "doesn't hang" should NOT score negative
const NEGATION_WORDS = new Set([
  'no', 'not', "doesn't", "don't", "didn't", 'never', 'without', 'none',
]);

// conjunctions that break negation scope: "no freeze *but* crash" -> crash isnt negated
const SCOPE_BREAKERS = new Set(['but', 'however', 'although', 'though', 'yet', 'except']);

function isNegatedAt(text: string, keywordStart: number): boolean {
  // examine up to 30 chars before the keyword for a negation word
  const before = text.slice(Math.max(0, keywordStart - 30), keywordStart).trim();
  const words = before.split(/\s+/);
  // only check the 2 words immediately before, and stop at scope breakers
  const nearby = words.slice(-2);
  return nearby.some(w => NEGATION_WORDS.has(w) && !SCOPE_BREAKERS.has(w));
}

export function parseNotesSentiment(notes: string): number {
  if (!notes) return 0;
  const lower = notes.toLowerCase();
  let score = 0;
  for (const kw of NEGATIVE_KEYWORDS) {
    let idx = lower.indexOf(kw);
    while (idx !== -1) {
      if (!isNegatedAt(lower, idx)) score -= 3;
      idx = lower.indexOf(kw, idx + 1);
    }
  }
  for (const kw of POSITIVE_KEYWORDS) {
    if (lower.includes(kw)) score += 2;
  }
  return Math.max(-WEIGHTS.NOTES_MAX, Math.min(WEIGHTS.NOTES_MAX, score));
}

function detectReportGpuTier(report: CdnReport): GpuTier {
  const gpu = (report.gpu ?? '').toLowerCase();
  if (!gpu) return 'unknown';
  if (/nvidia|geforce|rtx|gtx|quadro/.test(gpu)) return 'nvidia';
  if (/amd|radeon|rx \d|vega/.test(gpu)) return 'amd';
  if (/intel|arc|iris|uhd/.test(gpu)) return 'intel';
  return 'unknown';
}

function isCustomProton(version: string): boolean {
  const lower = version.toLowerCase();
  return CUSTOM_PROTON_MARKERS.some(m => lower.includes(m));
}

type DriverVersion = {
  major: number;
  minor: number;
  patch: number;
  isMesa: boolean;
};

function parseDriverVersion(driverStr: string): DriverVersion | null {
  const mesaMatch = driverStr.match(/Mesa\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (mesaMatch) {
    return {
      major: parseInt(mesaMatch[1], 10),
      minor: parseInt(mesaMatch[2], 10),
      patch: parseInt(mesaMatch[3] ?? '0', 10),
      isMesa: true,
    };
  }

  const match = driverStr.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3] ?? '0', 10),
    isMesa: false,
  };
}

type KernelVersion = {
  major: number;
  minor: number;
  patch: number;
};

function parseKernelVersion(kernelStr: string): KernelVersion | null {
  const match = kernelStr.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3] ?? '0', 10),
  };
}

function normalizeOsString(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function detectOsIdentity(value: string | null | undefined): string | null {
  const normalized = normalizeOsString(value);
  if (!normalized) return null;
  if (/steamos/.test(normalized)) return 'steamos';
  if (/holoiso/.test(normalized)) return 'holoiso';
  if (/chimeraos/.test(normalized)) return 'chimeraos';
  if (/bazzite/.test(normalized)) return 'bazzite';
  if (/nobara/.test(normalized)) return 'nobara';
  if (/fedora/.test(normalized)) return 'fedora';
  if (/cachyos/.test(normalized)) return 'cachyos';
  if (/endeavouros/.test(normalized)) return 'endeavouros';
  if (/manjaro/.test(normalized)) return 'manjaro';
  if (/garuda/.test(normalized)) return 'garuda';
  if (/\barch\b/.test(normalized)) return 'arch';
  if (/pop!_os|pop os/.test(normalized)) return 'popos';
  if (/linux mint/.test(normalized)) return 'mint';
  if (/elementary/.test(normalized)) return 'elementary';
  if (/ubuntu/.test(normalized)) return 'ubuntu';
  if (/debian/.test(normalized)) return 'debian';
  if (/nixos/.test(normalized)) return 'nixos';
  return normalized;
}

function getOsLineage(value: string | null | undefined): string[] {
  const identity = detectOsIdentity(value);
  if (!identity) return [];

  const lineage: Record<string, string[]> = {
    steamos: ['steamos', 'arch'],
    holoiso: ['holoiso', 'steamos', 'arch'],
    chimeraos: ['chimeraos', 'arch'],
    bazzite: ['bazzite', 'fedora'],
    nobara: ['nobara', 'fedora'],
    fedora: ['fedora'],
    cachyos: ['cachyos', 'arch'],
    endeavouros: ['endeavouros', 'arch'],
    manjaro: ['manjaro', 'arch'],
    garuda: ['garuda', 'arch'],
    arch: ['arch'],
    popos: ['popos', 'ubuntu', 'debian'],
    mint: ['mint', 'ubuntu', 'debian'],
    elementary: ['elementary', 'ubuntu', 'debian'],
    ubuntu: ['ubuntu', 'debian'],
    debian: ['debian'],
    nixos: ['nixos'],
  };

  return lineage[identity] ?? [identity];
}

function gpuDriverMultiplier(report: CdnReport, sysInfo: SystemInfo): number {
  const reportTier = detectReportGpuTier(report);
  const sysVendor = sysInfo.gpu_vendor;

  if (!sysVendor || reportTier === 'unknown') return WEIGHTS.GPU_UNKNOWN;
  if (reportTier !== sysVendor) return WEIGHTS.GPU_MISMATCH;

  // same GPU vendor, compare driver major versions to boost close matches
  const reportVersion = parseDriverVersion(report.gpuDriver ?? '');
  const systemVersion = parseDriverVersion(sysInfo.driver_version ?? '');

  if (!reportVersion || !systemVersion) return WEIGHTS.GPU_MATCH;
  if (!reportVersion.isMesa && !systemVersion.isMesa) {
    if (reportVersion.major === systemVersion.major) return WEIGHTS.GPU_DRIVER_EXACT;
    if (Math.abs(reportVersion.major - systemVersion.major) <= 2) return WEIGHTS.GPU_DRIVER_CLOSE;
    return WEIGHTS.GPU_MATCH;
  }
  if (
    reportVersion.major === systemVersion.major
    && reportVersion.minor === systemVersion.minor
    && reportVersion.patch === systemVersion.patch
  ) {
    return WEIGHTS.GPU_DRIVER_EXACT;
  }
  if (
    reportVersion.major === systemVersion.major
    && reportVersion.minor === systemVersion.minor
  ) {
    return 1.2;
  }
  if (
    reportVersion.major === systemVersion.major
    && Math.abs(reportVersion.minor - systemVersion.minor) <= 1
  ) {
    return WEIGHTS.GPU_DRIVER_CLOSE;
  }
  if (Math.abs(reportVersion.major - systemVersion.major) <= 2) return WEIGHTS.GPU_DRIVER_CLOSE;
  return WEIGHTS.GPU_MATCH;
}

function kernelVersionMultiplier(report: CdnReport, sysInfo: SystemInfo): number {
  const reportKernel = parseKernelVersion(report.kernel ?? '');
  const systemKernel = parseKernelVersion(sysInfo.kernel ?? '');

  if (!reportKernel || !systemKernel) return 1;
  if (
    reportKernel.major === systemKernel.major
    && reportKernel.minor === systemKernel.minor
    && reportKernel.patch === systemKernel.patch
  ) {
    return WEIGHTS.KERNEL_EXACT;
  }
  if (
    reportKernel.major === systemKernel.major
    && reportKernel.minor === systemKernel.minor
    && Math.abs(reportKernel.patch - systemKernel.patch) <= 2
  ) {
    return WEIGHTS.KERNEL_PATCH_CLOSE;
  }
  if (
    reportKernel.major === systemKernel.major
    && Math.abs(reportKernel.minor - systemKernel.minor) <= 1
  ) {
    return WEIGHTS.KERNEL_MINOR_CLOSE;
  }
  return 1;
}

function osMultiplier(report: CdnReport, sysInfo: SystemInfo): number {
  const reportOs = normalizeOsString(report.os);
  const systemOs = normalizeOsString(sysInfo.distro);

  if (!reportOs || !systemOs) return 1;
  if (reportOs === systemOs) return WEIGHTS.OS_EXACT;

  const reportIdentity = detectOsIdentity(reportOs);
  const systemIdentity = detectOsIdentity(systemOs);
  if (reportIdentity && systemIdentity && reportIdentity === systemIdentity) {
    return WEIGHTS.OS_EXACT;
  }

  const reportLineage = new Set(getOsLineage(reportOs));
  const systemLineage = getOsLineage(systemOs);
  if (systemLineage.some((entry) => reportLineage.has(entry))) {
    return WEIGHTS.OS_FAMILY_MATCH;
  }
  return 1;
}

function parseRamGb(value: string | null | undefined): number | null {
  const match = (value ?? '').match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function getHardwareMatchPercent(
  report: CdnReport,
  sysInfo: SystemInfo | null,
  gameMinRamGb?: number | null,
  _gameMinCpu?: string | null,
  _gameMinGpu?: string | null,
): number {
  if (!sysInfo) return 0;

  let score = 0;

  const reportTier = detectReportGpuTier(report);
  if (reportTier === 'unknown' || !sysInfo.gpu_vendor) {
    score += 18;
  } else if (reportTier === sysInfo.gpu_vendor) {
    score += 35;
  } else if (
    (reportTier === 'amd' && sysInfo.gpu_vendor === 'other')
    || (reportTier === 'intel' && sysInfo.gpu_vendor === 'other')
  ) {
    score += 14;
  }

  const reportDriver = parseDriverVersion(report.gpuDriver ?? '');
  const systemDriver = parseDriverVersion(sysInfo.driver_version ?? '');
  if (reportDriver && systemDriver) {
    if (
      reportDriver.major === systemDriver.major
      && reportDriver.minor === systemDriver.minor
      && reportDriver.patch === systemDriver.patch
    ) score += 15;
    else if (reportDriver.major === systemDriver.major && reportDriver.minor === systemDriver.minor) score += 13;
    else if (reportDriver.major === systemDriver.major && Math.abs(reportDriver.minor - systemDriver.minor) <= 1) score += 10;
    else if (Math.abs(reportDriver.major - systemDriver.major) <= 2) score += 6;
  } else if (reportTier !== 'unknown' && sysInfo.gpu_vendor && reportTier === sysInfo.gpu_vendor) {
    score += 8;
  }

  const reportIdentity = detectOsIdentity(report.os);
  const systemIdentity = detectOsIdentity(sysInfo.distro);
  if (reportIdentity && systemIdentity) {
    const reportOs = normalizeOsString(report.os);
    const systemOs = normalizeOsString(sysInfo.distro);
    if (reportOs === systemOs || reportIdentity === systemIdentity) score += 20;
    else {
      const reportLineage = new Set(getOsLineage(report.os));
      if (getOsLineage(sysInfo.distro).some((entry) => reportLineage.has(entry))) score += 14;
    }
  }

  const reportKernel = parseKernelVersion(report.kernel ?? '');
  const systemKernel = parseKernelVersion(sysInfo.kernel ?? '');
  if (reportKernel && systemKernel) {
    if (
      reportKernel.major === systemKernel.major
      && reportKernel.minor === systemKernel.minor
      && reportKernel.patch === systemKernel.patch
    ) {
      score += 20;
    } else if (
      reportKernel.major === systemKernel.major
      && reportKernel.minor === systemKernel.minor
      && Math.abs(reportKernel.patch - systemKernel.patch) <= 2
    ) {
      score += 16;
    } else if (
      reportKernel.major === systemKernel.major
      && Math.abs(reportKernel.minor - systemKernel.minor) <= 2
    ) {
      score += 13;
    } else if (reportKernel.major === systemKernel.major) {
      score += 10;
    } else if (Math.abs(reportKernel.major - systemKernel.major) === 1) {
      score += 5;
    }
  }

  const reportRamGb = parseRamGb(report.ram);
  const systemRamGb = sysInfo.ram_gb;
  if (reportRamGb !== null && systemRamGb !== null) {
    const ramMatch = ramFieldMatch(report.ram, systemRamGb, gameMinRamGb);
    score += Math.round((ramMatch / 100) * 10);
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Per-field match breakdown for the hardware comparison modal ─────────────

export interface FieldMatchInfo {
  percent: number;   // 0-100, how close this field matches
  color: string;     // hex color for the badge
}

export interface HardwareMatchBreakdown {
  gpu: FieldMatchInfo;
  gpuDriver: FieldMatchInfo;
  cpu: FieldMatchInfo;
  os: FieldMatchInfo;
  kernel: FieldMatchInfo;
  ram: FieldMatchInfo;
  protonVersion: FieldMatchInfo;
}

// extract GPU tokens for tiered matching:
// "AMD Radeon RX 6700 XT" -> ["amd", "radeon", "rx", "6700", "xt"]
// vendor synonyms so "Advanced Micro Devices" gets mapped to "amd" etc
const GPU_SYNONYMS: Record<string, string> = {
  'advanced': '',       // drop filler words from "Advanced Micro Devices"
  'micro': '',
  'devices': '',
  'devices,': '',
  'inc.': '',
  'inc': '',
  'corporation': '',
  'ati': 'amd',         // ATI was acquired by AMD
  'navi': 'radeon',     // navi is AMD's GPU arch
};

// noise that shows up in GPU strings from ProtonDB/lspci but isn't model-relevant
const GPU_NOISE = new Set([
  'llvm', 'drm', 'rev', 'compatibility', 'profile', 'git',
  'devel', 'mesa', 'ae', 'display', 'controller', 'video',
]);

// version-like patterns (X.Y.Z, X.Y, or kernel-style X.Y.Z-foo) aren't GPU model info
const VERSION_PATTERN = /^\d+\.\d+(\.\d+)?/;

// ─── VRAM estimation ────────────────────────────────────────────────────────

/** Static GPU model → VRAM (GB) lookup. Patterns are matched against the
 *  lowercased GPU string. Order matters — first match wins. */
const VRAM_TABLE: [RegExp, number][] = [
  // NVIDIA RTX 50xx
  [/rtx\s*5090/, 32], [/rtx\s*5080/, 16], [/rtx\s*5070\s*ti/, 16], [/rtx\s*5070/, 12], [/rtx\s*5060\s*ti/, 16], [/rtx\s*5060/, 8],
  // NVIDIA RTX 40xx
  [/rtx\s*4090/, 24], [/rtx\s*4080\s*super/, 16], [/rtx\s*4080/, 16], [/rtx\s*4070\s*ti\s*super/, 16], [/rtx\s*4070\s*ti/, 12], [/rtx\s*4070\s*super/, 12], [/rtx\s*4070/, 12], [/rtx\s*4060\s*ti/, 8], [/rtx\s*4060/, 8],
  // NVIDIA RTX 30xx
  [/rtx\s*3090\s*ti/, 24], [/rtx\s*3090/, 24], [/rtx\s*3080\s*ti/, 12], [/rtx\s*3080/, 10], [/rtx\s*3070\s*ti/, 8], [/rtx\s*3070/, 8], [/rtx\s*3060\s*ti/, 8], [/rtx\s*3060/, 12], [/rtx\s*3050/, 8],
  // NVIDIA RTX 20xx
  [/rtx\s*2080\s*ti/, 11], [/rtx\s*2080\s*super/, 8], [/rtx\s*2080/, 8], [/rtx\s*2070\s*super/, 8], [/rtx\s*2070/, 8], [/rtx\s*2060\s*super/, 8], [/rtx\s*2060/, 6],
  // NVIDIA GTX 16xx
  [/gtx\s*1660\s*ti/, 6], [/gtx\s*1660\s*super/, 6], [/gtx\s*1660/, 6], [/gtx\s*1650\s*super/, 4], [/gtx\s*1650/, 4],
  // NVIDIA GTX 10xx
  [/gtx\s*1080\s*ti/, 11], [/gtx\s*1080/, 8], [/gtx\s*1070\s*ti/, 8], [/gtx\s*1070/, 8], [/gtx\s*1060/, 6], [/gtx\s*1050\s*ti/, 4], [/gtx\s*1050/, 2],
  // NVIDIA GTX 9xx/7xx
  [/gtx\s*980\s*ti/, 6], [/gtx\s*980/, 4], [/gtx\s*970/, 4], [/gtx\s*960/, 2], [/gtx\s*780\s*ti/, 3], [/gtx\s*780/, 3], [/gtx\s*770/, 2], [/gtx\s*760/, 2],
  // AMD RX 7xxx
  [/rx\s*7900\s*xtx/, 24], [/rx\s*7900\s*xt/, 20], [/rx\s*7900\s*gre/, 16], [/rx\s*7800\s*xt/, 16], [/rx\s*7700\s*xt/, 12], [/rx\s*7600\s*xt/, 16], [/rx\s*7600/, 8],
  // AMD RX 6xxx
  [/rx\s*6950\s*xt/, 16], [/rx\s*6900\s*xt/, 16], [/rx\s*6800\s*xt/, 16], [/rx\s*6800/, 16], [/rx\s*6750\s*xt/, 12], [/rx\s*6700\s*xt/, 12], [/rx\s*6700/, 10], [/rx\s*6650\s*xt/, 8], [/rx\s*6600\s*xt/, 8], [/rx\s*6600/, 8], [/rx\s*6500\s*xt/, 4],
  // AMD RX 5xxx
  [/rx\s*5700\s*xt/, 8], [/rx\s*5700/, 8], [/rx\s*5600\s*xt/, 6], [/rx\s*5500\s*xt/, 8],
  // AMD RX 580/570/etc
  [/rx\s*590/, 8], [/rx\s*580/, 8], [/rx\s*570/, 4], [/rx\s*560/, 4], [/rx\s*480/, 8], [/rx\s*470/, 4],
  // AMD older
  [/r9\s*390x?/, 8], [/r9\s*290x?/, 4], [/r9\s*280x?/, 3],
  // Intel Arc
  [/arc\s*a770/, 16], [/arc\s*a750/, 8], [/arc\s*a580/, 8], [/arc\s*a380/, 6],
  // Steam Deck
  [/custom gpu 0405/, 1], [/vangogh|aerith|sephiroth/, 1],
];

/** Estimate VRAM in GB from a GPU model string. Returns null if unknown. */
export function estimateVramGb(gpu: string): number | null {
  if (!gpu) return null;
  const lower = gpu.toLowerCase();
  for (const [pattern, vram] of VRAM_TABLE) {
    if (pattern.test(lower)) return vram;
  }
  return null;
}

/** Parse VRAM from a game requirements GPU string like "GTX 780 (3 GB)". */
export function parseVramFromRequirements(gpuReq: string): number | null {
  if (!gpuReq) return null;
  const m = gpuReq.match(/\(\s*(\d+)\s*GB\s*\)/i);
  return m ? parseInt(m[1], 10) : null;
}

function normalizeGpuTokens(gpu: string): string[] {
  return gpu.toLowerCase()
    .replace(/[(),\[\]\/]/g, ' ')  // strip brackets, parens, commas, slashes
    .split(/\s+/)
    .filter(Boolean)
    .map(t => GPU_SYNONYMS[t] !== undefined ? GPU_SYNONYMS[t] : t)
    .filter(Boolean)
    .filter(t => !GPU_NOISE.has(t))
    .filter(t => !VERSION_PATTERN.test(t));  // drop embedded version strings
}

type MatchField = 'gpu' | 'gpuDriver' | 'cpu' | 'os' | 'kernel' | 'ram' | 'protonVersion' | 'default';

const FIELD_COLOR_THRESHOLDS: Record<MatchField, { green: number; amber: number }> = {
  gpu:            { green: 60, amber: 35 },
  gpuDriver:      { green: 60, amber: 35 },
  cpu:            { green: 60, amber: 35 },
  os:             { green: 80, amber: 50 },
  kernel:         { green: 80, amber: 50 },
  ram:            { green: 80, amber: 50 },
  protonVersion:  { green: 60, amber: 35 },
  default:        { green: 80, amber: 50 },
};

export function matchColor(pct: number, field?: MatchField): string {
  const t = FIELD_COLOR_THRESHOLDS[field ?? 'default'];
  if (pct >= t.green) return '#4caf50';  // green
  if (pct >= t.amber) return '#f59e0b';  // amber
  return '#ef4444';                       // red
}

// Extract a GPU generation bucket from model tokens for a given vendor.
// Returns a comparable integer (higher = newer) or null if undetermined.
//
// NVIDIA: first digit of the 4-digit model number (10xx=1, 20xx=2, 30xx=3, ...)
// AMD:    first digit of the RX model number (5xxx=5, 6xxx=6, 7xxx=7, 8xxx=8)
//         older 3-digit RX (480, 580) map to generation 0
// Intel:  Arc A-series=1, Arc B-series=2
function extractGpuGeneration(vendorGroup: string, modelTokens: string[]): number | null {
  if (vendorGroup === 'intel') {
    // Arc A770, B580 -> a/b letter prefix on 3-digit number
    const arcToken = modelTokens.find(t => /^[ab]\d{3}$/.test(t));
    if (arcToken) return arcToken.startsWith('a') ? 1 : 2;
    return null;
  }

  // Find the first 3-4 digit pure number token (model number)
  const numToken = modelTokens.find(t => /^\d{3,4}$/.test(t));
  if (!numToken) return null;
  const num = parseInt(numToken, 10);

  if (vendorGroup === 'nvidia') {
    // 4-digit: 1000-series=1, 2000=2, 3000=3, 4000=4, 5000=5
    if (num >= 1000) return Math.floor(num / 1000);
    return 0;  // older 3-digit cards (980, 780, etc.)
  }

  if (vendorGroup === 'amd') {
    // 4-digit RX: 5000s=5, 6000s=6, 7000s=7, 8000s=8
    if (num >= 5000) return Math.floor(num / 1000);
    return 0;  // older 3-digit RX cards (480, 580, etc.)
  }

  return null;
}

function gpuFieldMatch(reportGpu: string, systemGpu: string, gameMinGpu?: string | null): number {
  if (!reportGpu || !systemGpu) return 0;

  const rTokens = normalizeGpuTokens(reportGpu);
  const sTokens = normalizeGpuTokens(systemGpu);
  if (rTokens.length === 0 || sTokens.length === 0) return 0;

  // tier 1: vendor family (amd, nvidia, intel)
  const vendorKeywords = ['amd', 'nvidia', 'intel', 'radeon', 'geforce', 'arc'];
  const rVendor = rTokens.find(t => vendorKeywords.includes(t));
  const sVendor = sTokens.find(t => vendorKeywords.includes(t));

  // normalize vendor aliases to a common name
  const vendorGroup = (v: string | undefined): string => {
    if (!v) return '';
    if (v === 'amd' || v === 'radeon') return 'amd';
    if (v === 'nvidia' || v === 'geforce') return 'nvidia';
    if (v === 'intel' || v === 'arc') return 'intel';
    return v;
  };

  const rVG = vendorGroup(rVendor);
  const sVG = vendorGroup(sVendor);

  if (rVG !== sVG) return 10;

  // same vendor, check how many tokens overlap
  // strip vendor tokens so we're comparing model parts
  const stripVendor = (tokens: string[]) =>
    tokens.filter(t => !vendorKeywords.includes(t) && !/^[,()\[\]]$/.test(t));

  const rModel = stripVendor(rTokens);
  const sModel = stripVendor(sTokens);

  // count matching tokens
  const rSet = new Set(rModel);
  let matches = 0;
  for (const t of sModel) {
    if (rSet.has(t)) matches++;
  }

  const maxTokens = Math.max(rModel.length, sModel.length, 1);
  const tokenRatio = matches / maxTokens;

  // 40 base for vendor match, up to 60 more based on model overlap
  let score = Math.round(40 + tokenRatio * 60);

  // Apply generation penalty for cross-generation matches.
  // Same-gen GPUs have similar driver support, features, and perf tiers.
  // Reports from a different generation are less representative of likely behavior.
  if (rVG) {
    const rGen = extractGpuGeneration(rVG, rModel);
    const sGen = extractGpuGeneration(sVG, sModel);
    if (rGen !== null && sGen !== null && rGen !== sGen) {
      const genDiff = Math.abs(rGen - sGen);
      // 1 gen apart: -5, 2 gens: -12, 3+ gens: -20
      const penalty = genDiff === 1 ? 5 : genDiff === 2 ? 12 : 20;
      score = Math.max(0, score - penalty);
    }
  }

  // game-aware boost: if both report and system GPU share a vendor with the
  // game's minimum requirement, boost confidence
  let gameAwareBoosted = false;
  if (gameMinGpu && rVG) {
    const gTokens = normalizeGpuTokens(gameMinGpu);
    const gVendor = gTokens.find(t => vendorKeywords.includes(t));
    const gVG = vendorGroup(gVendor);
    if (gVG && rVG === gVG && sVG === gVG) {
      score = Math.max(score, 80);
      gameAwareBoosted = true;
    }
  }

  // VRAM consideration: boost when both meet game min, penalize large gaps otherwise
  const rVram = estimateVramGb(reportGpu);
  const sVram = estimateVramGb(systemGpu);
  if (rVram !== null && sVram !== null) {
    const gameMinVram = gameMinGpu ? parseVramFromRequirements(gameMinGpu) : null;
    if (gameMinVram && rVram >= gameMinVram && sVram >= gameMinVram) {
      score = Math.max(score, 85);
    } else if (!gameAwareBoosted && Math.abs(rVram - sVram) >= 8) {
      score = Math.max(0, score - 5);
    }
  }

  return score;
}

function driverFieldMatch(reportDriver: string, systemDriver: string): number {
  const report = parseDriverVersion(reportDriver);
  const system = parseDriverVersion(systemDriver);

  if (!report || !system) return 0;
  if (!report.isMesa && !system.isMesa) {
    if (report.major === system.major) return 100;
    const majorDiff = Math.abs(report.major - system.major);
    if (majorDiff <= 2) return 75;
    if (majorDiff <= 5) return 50;
    return 20;
  }
  if (
    report.major === system.major
    && report.minor === system.minor
    && report.patch === system.patch
  ) return 100;
  if (report.major === system.major && report.minor === system.minor) return 90;
  if (report.major === system.major && Math.abs(report.minor - system.minor) <= 1) return 75;
  const diff = Math.abs(report.major - system.major);
  if (diff <= 2) return 75;
  if (diff <= 5) return 50;
  return 20;
}

function osFieldMatch(reportOs: string, systemOs: string): number {
  const rNorm = normalizeOsString(reportOs);
  const sNorm = normalizeOsString(systemOs);

  if (!rNorm || !sNorm) return 0;
  if (rNorm === sNorm) return 100;

  const reportLineage = new Set(getOsLineage(reportOs));
  if (getOsLineage(systemOs).some((entry) => reportLineage.has(entry))) return 70;
  return 10;
}

function parseValveBuild(kernelStr: string): number | null {
  // "5.13.0-valve36-1-neptune" -> 36
  const m = kernelStr.match(/valve(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Extracts the major Proton version number from a proton version string.
// Handles the common formats found in ProtonDB reports and system info:
//   "GE-Proton9-7"              -> 9
//   "Proton 9.0-4"              -> 9
//   "proton-7.0-6"              -> 7
//   "cachyos-10.0-202603012"    -> 10
//   "Proton Experimental"       -> null  (no version number)
//   "SteamLinuxRuntime"         -> null
export function parseProtonMajorVersion(version: string): number | null {
  if (!version) return null;
  const lower = version.toLowerCase();

  // GE-Proton9-7 style
  let m = lower.match(/ge-proton(\d+)/);
  if (m) return parseInt(m[1], 10);

  // "Proton 9.0" or "proton-9.0" style
  m = lower.match(/\bproton[\s-](\d+)/);
  if (m) return parseInt(m[1], 10);

  // Custom builds like "cachyos-10.0-...", "tkg-9.0", "protonplus-9.0"
  m = lower.match(/[a-z]+-(\d+)\.\d+/);
  if (m) return parseInt(m[1], 10);

  // Plain ProtonDB-style version strings like "9.0-4"
  m = lower.match(/^(\d+)\.\d+(?:-\d+)?$/);
  if (m) return parseInt(m[1], 10);

  return null;
}

function parseProtonDescriptor(version: string): { major: number; custom: boolean } | null {
  const major = parseProtonMajorVersion(version);
  if (major === null) return null;
  return {
    major,
    custom: isCustomProton(version),
  };
}

function protonVersionFieldMatch(reportVersion: string, systemVersion: string): number {
  const report = parseProtonDescriptor(reportVersion);
  const system = parseProtonDescriptor(systemVersion);

  if (!report || !system) return 0;
  if (report.major === system.major) {
    if (report.custom === system.custom) return 100;
    return report.custom ? 82 : 90;
  }
  const diff = Math.abs(report.major - system.major);
  if (diff === 1) return report.custom === system.custom ? 70 : 62;
  if (diff === 2) return report.custom === system.custom ? 45 : 38;
  return 20;
}

function kernelFieldMatch(reportKernel: string, systemKernel: string): number {
  const rk = parseKernelVersion(reportKernel);
  const sk = parseKernelVersion(systemKernel);

  if (!rk || !sk) return 0;

  // Valve/SteamOS kernels share compat patches regardless of upstream major,
  // so the valve build number matters more than raw kernel version
  const rValve = parseValveBuild(reportKernel);
  const sValve = parseValveBuild(systemKernel);
  if (rValve !== null && sValve !== null) {
    const buildDiff = Math.abs(rValve - sValve);
    if (rk.major === sk.major && rk.minor === sk.minor) {
      return buildDiff <= 5 ? 95 : 85;
    }
    // different upstream major but both valve kernels
    if (buildDiff <= 10) return 75;
    if (buildDiff <= 20) return 60;
    return 50;
  }

  if (rk.major === sk.major && rk.minor === sk.minor && rk.patch === sk.patch) return 100;
  if (rk.major === sk.major && rk.minor === sk.minor && Math.abs(rk.patch - sk.patch) <= 2) return 90;
  if (rk.major === sk.major && Math.abs(rk.minor - sk.minor) <= 2) return 75;
  if (rk.major === sk.major) return 60;
  if (Math.abs(rk.major - sk.major) === 1) return 35;
  return 15;
}

// CPU synonyms for token normalization
const CPU_SYNONYMS: Record<string, string> = {
  'apu': '',        // drop "APU" filler
  'with': '',       // drop "with" from "Ryzen 7 5700G with Radeon Graphics"
  'graphics': '',
  'processor': '',
  'gen': '',
  'tm': '',         // trademark symbol text form
  '(r)': '',
  'cpu': '',
};

function cpuFieldMatch(reportCpu: string, systemCpu: string, gameMinCpu?: string | null): number {
  if (!reportCpu || !systemCpu) return 0;

  // tokenize and clean both strings
  const tokenize = (s: string) => s.toLowerCase()
    .replace(/[(),\[\]\/®™@]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(t => CPU_SYNONYMS[t] !== undefined ? CPU_SYNONYMS[t] : t)
    .filter(Boolean);

  const rTokens = tokenize(reportCpu);
  const sTokens = tokenize(systemCpu);
  if (rTokens.length === 0 || sTokens.length === 0) return 0;

  // check brand match (amd vs intel)
  const brands = ['amd', 'intel'];
  const rBrand = rTokens.find(t => brands.includes(t));
  const sBrand = sTokens.find(t => brands.includes(t));
  if (rBrand && sBrand && rBrand !== sBrand) return 10;

  // token overlap ratio
  const rSet = new Set(rTokens);
  let matches = 0;
  for (const t of sTokens) {
    if (rSet.has(t)) matches++;
  }
  const maxTokens = Math.max(rTokens.length, sTokens.length, 1);
  const ratio = matches / maxTokens;

  // 30 base for brand match, up to 70 more from token overlap
  let score = Math.round(30 + ratio * 70);

  // game-aware boost: if both report and system CPU share a brand with the
  // game's minimum requirement, boost confidence (both "meet" the game's need)
  if (gameMinCpu) {
    const gTokens = tokenize(gameMinCpu);
    const gBrand = gTokens.find(t => brands.includes(t));
    if (gBrand && rBrand === gBrand && sBrand === gBrand) {
      score = Math.max(score, 80);
    }
  }

  return score;
}

function ramFieldMatch(reportRam: string, systemRamGb: number | null, gameMinRamGb?: number | null): number {
  const rGb = parseRamGb(reportRam);
  if (rGb === null || systemRamGb === null) return 0;

  // If we know the game's minimum RAM, meeting it matters more than matching
  // exact capacity. Over the requirement is effectively "good enough".
  if (gameMinRamGb && rGb >= gameMinRamGb) {
    if (systemRamGb >= gameMinRamGb) return 100;

    const shortfall = gameMinRamGb - systemRamGb;
    if (shortfall <= 2) return 85;
    if (shortfall <= 4) return 70;
    if (shortfall <= 8) return 50;
    return 25;
  }

  const diff = Math.abs(rGb - systemRamGb);
  if (diff <= 2) return 100;
  if (diff <= 4) return 75;
  if (diff <= 8) return 50;
  return 20;
}

export function getHardwareMatchBreakdown(
  report: CdnReport,
  sysInfo: SystemInfo | null,
  gameMinRamGb?: number | null,
  gameMinCpu?: string | null,
  gameMinGpu?: string | null,
): HardwareMatchBreakdown {
  if (!sysInfo) {
    const empty: FieldMatchInfo = { percent: 0, color: matchColor(0) };
    return { gpu: empty, gpuDriver: empty, cpu: empty, os: empty, kernel: empty, ram: empty, protonVersion: empty };
  }

  const gpu = gpuFieldMatch(report.gpu ?? '', sysInfo.gpu ?? '', gameMinGpu);
  const gpuDriver = driverFieldMatch(report.gpuDriver ?? '', sysInfo.driver_version ?? '');
  const cpu = cpuFieldMatch(report.cpu ?? '', sysInfo.cpu ?? '', gameMinCpu);
  const os = osFieldMatch(report.os ?? '', sysInfo.distro ?? '');
  const kernel = kernelFieldMatch(report.kernel ?? '', sysInfo.kernel ?? '');
  const ram = ramFieldMatch(report.ram ?? '', sysInfo.ram_gb, gameMinRamGb);
  const proton = protonVersionFieldMatch(report.protonVersion ?? '', sysInfo.proton_custom ?? '');

  return {
    gpu: { percent: gpu, color: matchColor(gpu, 'gpu') },
    gpuDriver: { percent: gpuDriver, color: matchColor(gpuDriver, 'gpuDriver') },
    cpu: { percent: cpu, color: matchColor(cpu, 'cpu') },
    os: { percent: os, color: matchColor(os, 'os') },
    kernel: { percent: kernel, color: matchColor(kernel, 'kernel') },
    ram: { percent: ram, color: matchColor(ram, 'ram') },
    protonVersion: { percent: proton, color: matchColor(proton, 'protonVersion') },
  };
}

export function scoreReport(report: CdnReport, sysInfo: SystemInfo): ScoredReport {
  const gpuTier = detectReportGpuTier(report);
  const gpuMult = gpuDriverMultiplier(report, sysInfo);
  const distroMult = osMultiplier(report, sysInfo);
  const kernelMult = kernelVersionMultiplier(report, sysInfo);

  const recencyDays = Math.round((Date.now() / 1000 - report.timestamp) / 86400);

  // old borked reports get bumped to bronze. Games that were broken a year
  // ago have probably been fixed by now, so don't let ancient reports
  // tank a game's score forever
  const effectiveRating =
    report.rating === 'borked' && recencyDays > WEIGHTS.BORKED_DECAY_DAYS
      ? 'bronze'
      : report.rating;

  const ratingScore = (RATING_SCORES[effectiveRating] ?? 0) * WEIGHTS.BASE_MAX;
  const recencyBonus =
    recencyDays < 90  ? WEIGHTS.RECENCY_RECENT :
    recencyDays < 365 ? WEIGHTS.RECENCY_MID :
                        WEIGHTS.RECENCY_OLD;
  const customBonus = isCustomProton(report.protonVersion) ? WEIGHTS.CUSTOM_PROTON : 0;
  const notesModifier = parseNotesSentiment(report.notes);

  // Proton version proximity bonus: reports run with a similar Proton version
  // to what the user has are more likely to reflect the user's experience
  const reportProtonMajor = parseProtonMajorVersion(report.protonVersion);
  const systemProtonMajor = parseProtonMajorVersion(sysInfo.proton_custom ?? '');
  let protonBonus = 0;
  if (reportProtonMajor !== null && systemProtonMajor !== null) {
    const diff = Math.abs(reportProtonMajor - systemProtonMajor);
    if (diff === 0) protonBonus = WEIGHTS.PROTON_MATCH;
    else if (diff === 1) protonBonus = WEIGHTS.PROTON_CLOSE;
  }

  // GPU multiplier scales everything except the notes sentiment modifier,
  // so a mismatched GPU report still gets credit for good/bad user feedback
  const raw = (ratingScore + recencyBonus + customBonus + protonBonus) * gpuMult * distroMult * kernelMult + notesModifier;

  return {
    ...report,
    score: Math.max(0, Math.round(raw)),
    gpuTier,
    recencyDays,
    notesModifier,
    upvotes: 0,
    downvotes: 0,
  };
}

/** Map a final confidence score to a display-tier rating. */
export function scoreToRating(score: number): string {
  if (score >= 70) return 'platinum';
  if (score >= 55) return 'gold';
  if (score >= 40) return 'silver';
  if (score >= 20) return 'bronze';
  return 'borked';
}

export function bucketByGpuTier(reports: ScoredReport[]): TieredReports {
  const buckets: TieredReports = { nvidia: [], amd: [], other: [] };
  for (const r of reports) {
    if (r.gpuTier === 'nvidia') buckets.nvidia.push(r);
    else if (r.gpuTier === 'amd') buckets.amd.push(r);
    else buckets.other.push(r);
  }
  const byScore = (a: ScoredReport, b: ScoredReport) => b.score - a.score;
  buckets.nvidia.sort(byScore);
  buckets.amd.sort(byScore);
  buckets.other.sort(byScore);
  return buckets;
}
