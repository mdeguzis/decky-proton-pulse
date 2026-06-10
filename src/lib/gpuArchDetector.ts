/**
 * GPU architecture detection from a model name string.
 * Returns a short architecture label (e.g. "RDNA2", "Ada", "Polaris")
 * or an empty string when the model is unrecognised.
 *
 * Mirrors js/lib/gpu-arch-detector.js in proton-pulse-web.
 * Keep both files in sync when adding new architectures.
 */
export function detectGpuArch(gpu: string | null | undefined): string {
  if (!gpu) return '';
  const s = gpu.toLowerCase();

  // ---- AMD ----------------------------------------------------------------

  if (/\brx\s*9\d{3}\b/.test(s)) return 'RDNA4';
  if (/\brx\s*7\d{3}\b/.test(s)) return 'RDNA3';
  if (/\brx\s*6\d{3}\b/.test(s) || /vangogh|van gogh/.test(s)) return 'RDNA2';
  if (/\brx\s*5\d{3}\b/.test(s)) return 'RDNA';
  if (/vega\s*\d+|radeon\s+vii/.test(s)) return 'Vega';
  if (/\brx\s*[45][0-9]{2}\b/.test(s)) return 'Polaris';
  if (/r9\s*(fury|nano)|r9\s*3[89]0|r9\s*28[05]|r9\s*380/.test(s)) return 'GCN3';
  if (/r[79]\s*2[678]\d/.test(s)) return 'GCN2';
  if (/hd\s*7[0-9]{3}/.test(s)) return 'GCN1';

  // ---- NVIDIA -------------------------------------------------------------

  if (/rtx\s*5\d{3}/.test(s)) return 'Blackwell';
  if (/rtx\s*4\d{3}/.test(s)) return 'Ada';
  if (/rtx\s*3\d{3}/.test(s) || /\ba\d{3,4}\b/.test(s)) return 'Ampere';
  if (/rtx\s*2\d{3}/.test(s) || /gtx\s*16[56]\d/.test(s)) return 'Turing';
  if (/gtx\s*10[567]\d/.test(s)) return 'Pascal';
  if (/gtx\s*9[0-9]{2}/.test(s) || /gtx\s*750/.test(s)) return 'Maxwell';
  if (/gtx\s*[67]\d{2}/.test(s)) return 'Kepler';

  // ---- Intel --------------------------------------------------------------

  if (/arc\s*b\d{3}/.test(s)) return 'Battlemage';
  if (/arc\s*a\d{3}/.test(s) || /\balchemist\b/.test(s)) return 'Alchemist';
  if (/iris\s*xe|uhd\s*7[0-9]{2}/.test(s)) return 'Xe';
  if (/hd\s*[56]\d{2}|uhd\s*6[0-9]{2}/.test(s)) return 'Gen9';

  return '';
}
