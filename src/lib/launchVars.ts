// src/lib/launchVars.ts

export interface LaunchVarDef {
  key: string;
  type: 'bool' | 'enum';
  category: 'nvidia' | 'amd' | 'intel' | 'wrappers' | 'performance' | 'compatibility' | 'debug';
  description: string;
  defaultValue?: string;
  options?: string[];
}

export const LAUNCH_VAR_CATALOG: LaunchVarDef[] = [
  // NVIDIA
  { key: 'PROTON_DLSS4_UPGRADE', type: 'bool', category: 'nvidia', description: 'Enable DLSS4 upgrade' },
  { key: 'PROTON_DLSS_INDICATOR', type: 'bool', category: 'nvidia', description: 'Show DLSS indicator overlay' },
  { key: 'NVPRESENT_ENABLE_SMOOTH_MOTION', type: 'bool', category: 'nvidia', description: 'NVIDIA smooth motion' },
  // AMD
  { key: 'PROTON_FSR4_UPGRADE', type: 'bool', category: 'amd', description: 'FSR4 upgrade' },
  { key: 'PROTON_FSR4_RDNA3_UPGRADE', type: 'bool', category: 'amd', description: 'FSR4 RDNA3-specific upgrade' },
  { key: 'PROTON_FSR4_INDICATOR', type: 'bool', category: 'amd', description: 'Show FSR4 indicator' },
  // Intel
  { key: 'PROTON_XESS_UPGRADE', type: 'bool', category: 'intel', description: 'XeSS upgrade' },
  { key: 'PROTON_XESS_INDICATOR', type: 'bool', category: 'intel', description: 'Show XeSS indicator' },
  // Wrappers
  { key: '__LSFG', type: 'bool', category: 'wrappers', description: 'Lossless Scaling Frame Gen' },
  { key: '__FGMOD', type: 'bool', category: 'wrappers', description: 'FG Mod' },
  // Performance
  { key: 'DXVK_ASYNC', type: 'bool', category: 'performance', description: 'DXVK async compilation' },
  { key: 'PROTON_USE_NTSYNC', type: 'bool', category: 'performance', description: 'NTSync' },
  { key: 'RADV_PERFTEST', type: 'enum', category: 'performance', description: 'RADV perf test mode', options: ['aco', 'gpl'] },
  // Compatibility
  { key: 'PROTON_USE_WINED3D', type: 'bool', category: 'compatibility', description: 'Force WineD3D instead of Vulkan' },
  { key: 'PROTON_HIDE_NVIDIA_GPU', type: 'bool', category: 'compatibility', description: 'Hide NVIDIA GPU' },
  { key: 'PROTON_ENABLE_NVAPI', type: 'bool', category: 'compatibility', description: 'Enable NVAPI' },
  { key: 'ENABLE_HDR_WSI', type: 'bool', category: 'compatibility', description: 'HDR WSI extension' },
  { key: 'PROTON_ENABLE_HDR', type: 'bool', category: 'compatibility', description: 'Proton HDR' },
  { key: 'PROTON_VKD3D_HEAP', type: 'bool', category: 'compatibility', description: 'VKD3D heap workaround' },
  { key: 'SteamDeck', type: 'bool', category: 'compatibility', description: 'Spoof Steam Deck identity', defaultValue: '0' },
  // Debug
  { key: 'PROTON_LOG', type: 'bool', category: 'debug', description: 'Enable Proton logging' },
  { key: 'MANGOHUD', type: 'bool', category: 'debug', description: 'Enable MangoHud overlay' },
  { key: 'MANGOHUD_CONFIG', type: 'enum', category: 'debug', description: 'MangoHud config preset', options: ['no_display', 'fps_only=1', 'full'] },
];

export function buildLaunchOptions(
  protonVersion: string | null,
  enabledVars: Record<string, string>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(enabledVars)) {
    parts.push(`${key}=${value}`);
  }
  if (protonVersion) {
    parts.push(`PROTON_VERSION="${protonVersion}"`);
  }
  parts.push('%command%');
  return parts.join(' ');
}

export function parseLaunchOptions(
  launchOptions: string,
): { protonVersion: string | null; vars: Record<string, string> } {
  const vars: Record<string, string> = {};
  let protonVersion: string | null = null;

  // Match PROTON_VERSION="..." (quoted)
  const pvMatch = launchOptions.match(/PROTON_VERSION="([^"]+)"/);
  if (pvMatch) {
    protonVersion = pvMatch[1];
  }

  // Remove %command% and PROTON_VERSION="..." from the string, then parse remaining KEY=VALUE pairs
  const cleaned = launchOptions
    .replace(/PROTON_VERSION="[^"]*"/, '')
    .replace(/%command%/g, '')
    .trim();

  if (cleaned) {
    // Split on spaces, but respect quoted values
    const tokens = cleaned.split(/\s+/);
    for (const token of tokens) {
      const eqIndex = token.indexOf('=');
      if (eqIndex > 0) {
        const key = token.slice(0, eqIndex);
        const value = token.slice(eqIndex + 1).replace(/^"|"$/g, '');
        vars[key] = value;
      }
    }
  }

  return { protonVersion, vars };
}
