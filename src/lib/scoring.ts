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
} as const;

const RATING_SCORES: Record<string, number> = {
  platinum: 1.0,
  gold: 0.8,
  silver: 0.6,
  bronze: 0.4,
  borked: 0.0,
};

const CUSTOM_PROTON_MARKERS = ['ge', 'cachyos', 'tkg', 'protonplus', 'experimental'];

const NEGATIVE_KEYWORDS = [
  'crash', 'broken', 'freeze', 'black screen', 'hang', 'softlock',
  'corrupted', "doesn't work", 'unplayable', "won't launch",
];

const POSITIVE_KEYWORDS = [
  'perfect', 'flawless', 'works great', 'no issues', 'out of the box',
  'excellent', 'runs perfectly', 'zero issues', 'works flawlessly',
];

export function parseNotesSentiment(notes: string): number {
  if (!notes) return 0;
  const lower = notes.toLowerCase();
  let score = 0;
  for (const kw of NEGATIVE_KEYWORDS) {
    if (lower.includes(kw)) score -= 3;
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

function parseDriverMajor(driverStr: string): number | null {
  // Mesa drivers often have an OpenGL version prefix like "4.6 (Compatibility Profile)"
  // before the actual Mesa version. Check for Mesa specifically first
  const mesaMatch = driverStr.match(/Mesa\s+(\d+)\.\d+/i);
  if (mesaMatch) return parseInt(mesaMatch[1], 10);

  // NVIDIA/other: "NVIDIA 545.29.06" -> 545, "NVIDIA 410.93" -> 410
  const match = driverStr.match(/(\d+)\.\d+/);
  return match ? parseInt(match[1], 10) : null;
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

function detectOsFamily(value: string | null | undefined): string | null {
  const normalized = normalizeOsString(value);
  if (!normalized) return null;
  if (/steamos|holoiso/.test(normalized)) return 'steamos';
  if (/bazzite|nobara|fedora/.test(normalized)) return 'fedora';
  if (/arch|cachyos|chimeraos|endeavouros|manjaro|garuda/.test(normalized)) return 'arch';
  if (/ubuntu|pop!_os|pop os|linux mint|elementary/.test(normalized)) return 'ubuntu';
  if (/debian/.test(normalized)) return 'debian';
  if (/nixos/.test(normalized)) return 'nixos';
  return normalized;
}

function gpuDriverMultiplier(report: CdnReport, sysInfo: SystemInfo): number {
  const reportTier = detectReportGpuTier(report);
  const sysVendor = sysInfo.gpu_vendor;

  if (!sysVendor || reportTier === 'unknown') return WEIGHTS.GPU_UNKNOWN;
  if (reportTier !== sysVendor) return WEIGHTS.GPU_MISMATCH;

  // same GPU vendor, compare driver major versions to boost close matches
  const reportMajor = parseDriverMajor(report.gpuDriver ?? '');
  const sysMajor    = parseDriverMajor(sysInfo.driver_version ?? '');

  if (reportMajor === null || sysMajor === null) return WEIGHTS.GPU_MATCH;
  if (reportMajor === sysMajor) return WEIGHTS.GPU_DRIVER_EXACT;
  if (Math.abs(reportMajor - sysMajor) <= 2) return WEIGHTS.GPU_DRIVER_CLOSE;
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

  const reportFamily = detectOsFamily(reportOs);
  const systemFamily = detectOsFamily(systemOs);
  if (reportFamily && systemFamily && reportFamily === systemFamily) {
    return WEIGHTS.OS_FAMILY_MATCH;
  }
  return 1;
}

function parseRamGb(value: string | null | undefined): number | null {
  const match = (value ?? '').match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function getHardwareMatchPercent(report: CdnReport, sysInfo: SystemInfo | null): number {
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

  const reportDriverMajor = parseDriverMajor(report.gpuDriver ?? '');
  const systemDriverMajor = parseDriverMajor(sysInfo.driver_version ?? '');
  if (reportDriverMajor !== null && systemDriverMajor !== null) {
    if (reportDriverMajor === systemDriverMajor) score += 15;
    else if (Math.abs(reportDriverMajor - systemDriverMajor) <= 2) score += 10;
    else if (Math.abs(reportDriverMajor - systemDriverMajor) <= 5) score += 6;
  } else if (reportTier !== 'unknown' && sysInfo.gpu_vendor && reportTier === sysInfo.gpu_vendor) {
    score += 8;
  }

  const reportFamily = detectOsFamily(report.os);
  const systemFamily = detectOsFamily(sysInfo.distro);
  if (reportFamily && systemFamily) {
    const reportOs = normalizeOsString(report.os);
    const systemOs = normalizeOsString(sysInfo.distro);
    if (reportOs === systemOs) score += 20;
    else if (reportFamily === systemFamily) score += 14;
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
      && Math.abs(reportKernel.minor - systemKernel.minor) <= 1
    ) {
      score += 12;
    } else if (reportKernel.major === systemKernel.major) {
      score += 6;
    }
  }

  const reportRamGb = parseRamGb(report.ram);
  const systemRamGb = sysInfo.ram_gb;
  if (reportRamGb !== null && systemRamGb !== null) {
    const delta = Math.abs(reportRamGb - systemRamGb);
    if (delta <= 2) score += 10;
    else if (delta <= 4) score += 7;
    else if (delta <= 8) score += 4;
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

export function matchColor(pct: number): string {
  if (pct >= 80) return '#4caf50';  // green
  if (pct >= 50) return '#f59e0b';  // amber
  return '#ef4444';                  // red
}

function gpuFieldMatch(reportGpu: string, systemGpu: string): number {
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

  if (vendorGroup(rVendor) !== vendorGroup(sVendor)) return 10;

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
  return Math.round(40 + tokenRatio * 60);
}

function driverFieldMatch(reportDriver: string, systemDriver: string): number {
  const rMajor = parseDriverMajor(reportDriver);
  const sMajor = parseDriverMajor(systemDriver);

  if (rMajor === null || sMajor === null) return 0;
  if (rMajor === sMajor) return 100;
  const diff = Math.abs(rMajor - sMajor);
  if (diff <= 2) return 75;
  if (diff <= 5) return 50;
  return 20;
}

function osFieldMatch(reportOs: string, systemOs: string): number {
  const rNorm = normalizeOsString(reportOs);
  const sNorm = normalizeOsString(systemOs);

  if (!rNorm || !sNorm) return 0;
  if (rNorm === sNorm) return 100;

  const rFamily = detectOsFamily(reportOs);
  const sFamily = detectOsFamily(systemOs);
  if (rFamily && sFamily && rFamily === sFamily) return 70;
  return 10;
}

function parseValveBuild(kernelStr: string): number | null {
  // "5.13.0-valve36-1-neptune" -> 36
  const m = kernelStr.match(/valve(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
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
  if (rk.major === sk.major && rk.minor === sk.minor && Math.abs(rk.patch - sk.patch) <= 2) return 85;
  if (rk.major === sk.major && Math.abs(rk.minor - sk.minor) <= 1) return 65;
  if (rk.major === sk.major) return 40;
  return 10;
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

function cpuFieldMatch(reportCpu: string, systemCpu: string): number {
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
  return Math.round(30 + ratio * 70);
}

function ramFieldMatch(reportRam: string, systemRamGb: number | null, gameMinRamGb?: number | null): number {
  const rGb = parseRamGb(reportRam);
  if (rGb === null || systemRamGb === null) return 0;

  // if we know the game's minimum RAM and both systems exceed it,
  // the raw GB difference matters less for compatibility
  if (gameMinRamGb && rGb >= gameMinRamGb && systemRamGb >= gameMinRamGb) {
    // both have enough RAM for the game, scale based on how far above minimum
    const diff = Math.abs(rGb - systemRamGb);
    if (diff <= 2) return 100;
    if (diff <= 8) return 85;   // both sufficient, minor difference
    return 70;                   // both sufficient but big delta
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
): HardwareMatchBreakdown {
  if (!sysInfo) {
    const empty: FieldMatchInfo = { percent: 0, color: matchColor(0) };
    return { gpu: empty, gpuDriver: empty, cpu: empty, os: empty, kernel: empty, ram: empty };
  }

  const gpu = gpuFieldMatch(report.gpu ?? '', sysInfo.gpu ?? '');
  const gpuDriver = driverFieldMatch(report.gpuDriver ?? '', sysInfo.driver_version ?? '');
  const cpu = cpuFieldMatch(report.cpu ?? '', sysInfo.cpu ?? '');
  const os = osFieldMatch(report.os ?? '', sysInfo.distro ?? '');
  const kernel = kernelFieldMatch(report.kernel ?? '', sysInfo.kernel ?? '');
  const ram = ramFieldMatch(report.ram ?? '', sysInfo.ram_gb, gameMinRamGb);

  return {
    gpu: { percent: gpu, color: matchColor(gpu) },
    gpuDriver: { percent: gpuDriver, color: matchColor(gpuDriver) },
    cpu: { percent: cpu, color: matchColor(cpu) },
    os: { percent: os, color: matchColor(os) },
    kernel: { percent: kernel, color: matchColor(kernel) },
    ram: { percent: ram, color: matchColor(ram) },
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

  // GPU multiplier scales everything except the notes sentiment modifier,
  // so a mismatched GPU report still gets credit for good/bad user feedback
  const raw = (ratingScore + recencyBonus + customBonus) * gpuMult * distroMult * kernelMult + notesModifier;

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
