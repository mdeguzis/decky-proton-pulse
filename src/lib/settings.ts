export const PREFIX = 'proton-pulse:';

type SettingsChangeListener = (key: string | null) => void;
const settingsChangeListeners = new Set<SettingsChangeListener>();

function emitSettingsChanged(key: string | null): void {
  settingsChangeListeners.forEach((listener) => {
    try {
      listener(key);
    } catch {
      // listeners should not break settings persistence
    }
  });
}

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
  emitSettingsChanged(key);
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
  emitSettingsChanged(null);
}

export function replacePrefixedSettingsSubsetRaw(
  entries: Record<string, string>,
  predicate: (key: string) => boolean,
): void {
  const keysToClear: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(PREFIX)) continue;
    const unprefixed = key.slice(PREFIX.length);
    if (predicate(unprefixed)) keysToClear.push(key);
  }
  keysToClear.forEach((key) => localStorage.removeItem(key));
  Object.entries(entries).forEach(([key, raw]) => {
    if (!predicate(key)) return;
    localStorage.setItem(PREFIX + key, raw);
  });
  emitSettingsChanged(null);
}

export function onSettingsChanged(listener: SettingsChangeListener): () => void {
  settingsChangeListeners.add(listener);
  return () => {
    settingsChangeListeners.delete(listener);
  };
}
