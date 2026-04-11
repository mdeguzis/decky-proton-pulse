export const PREFIX = 'proton-pulse:';

export function getSetting<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function setSetting<T>(key: string, value: T): void {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

export function getAllPrefixedSettingsRaw(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    entries[key.slice(PREFIX.length)] = raw;
  }
  return entries;
}

export function replaceAllPrefixedSettingsRaw(entries: Record<string, string>): void {
  const keysToClear: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && key.startsWith(PREFIX)) keysToClear.push(key);
  }
  keysToClear.forEach((key) => localStorage.removeItem(key));
  Object.entries(entries).forEach(([key, raw]) => {
    localStorage.setItem(PREFIX + key, raw);
  });
}
