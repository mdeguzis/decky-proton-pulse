import { logFrontendEvent } from './logger';

interface SteamAppDetailsResult {
  details: any | null;
  timedOut?: boolean;
}

export async function getSteamAppDetails(appId: number, timeoutMs = 1000): Promise<SteamAppDetailsResult> {
  const steamApps = (globalThis as any).SteamClient?.Apps;
  if (!steamApps?.RegisterForAppDetails) {
    await logFrontendEvent('DEBUG', 'Steam app details lookup unavailable', { appId });
    return { details: null };
  }

  return await new Promise<SteamAppDetailsResult>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let unregister = () => {};

    const finish = (result: SteamAppDetailsResult) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      try {
        unregister();
      } catch {
        // ignore unregister failures
      }
      resolve(result);
    };

    try {
      const registration = steamApps.RegisterForAppDetails(appId, (details: any) => {
        finish({ details });
      });
      unregister = registration?.unregister ?? (() => {});
      timeoutId = setTimeout(() => {
        finish({ details: null, timedOut: true });
      }, timeoutMs);
    } catch (error) {
      void logFrontendEvent('ERROR', 'Steam app details lookup failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      finish({ details: null });
    }
  });
}

export function getLaunchOptionsFromDetails(details: any): string {
  if (!details || typeof details !== 'object') return '';
  return typeof details.strLaunchOptions === 'string' ? details.strLaunchOptions : '';
}
