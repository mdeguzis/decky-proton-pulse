// src/lib/logger.ts
//
// Two-channel logging: writes to the Python backend log file AND keeps a
// frontend ring buffer so the Logs tab can show entries instantly without
// waiting on the callable round-trip. The ring buffer also means logs are
// visible even when the Python backend hasn't started yet or debug mode
// is off in the backend.

import { callable } from '@decky/api';

const logFrontendEventCallable = callable<
  [level: string, message: string, context?: Record<string, unknown>],
  boolean
>('log_frontend_event');

// --- frontend log ring buffer ---

export interface LogEntry {
  timestamp: number;
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  context?: Record<string, unknown>;
}

const MAX_LOG_ENTRIES = 500;
const logBuffer: LogEntry[] = [];
let logWriteIdx = 0;
let totalLogged = 0;

// subscribers get notified when new entries arrive
type LogListener = () => void;
const listeners = new Set<LogListener>();

export function subscribeToLogs(fn: LogListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// debounce notifications so rapid-fire logs (prefetch bursts) dont
// thrash React with per-entry re-renders
let notifyScheduled = false;
function notifyListeners() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  // batch within the current animation frame
  (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(() => {
    notifyScheduled = false;
    for (const fn of listeners) {
      try { fn(); } catch { /* dont let a bad listener break logging */ }
    }
  });
}

function recordLogEntry(entry: LogEntry) {
  if (logBuffer.length < MAX_LOG_ENTRIES) {
    logBuffer.push(entry);
  } else {
    logBuffer[logWriteIdx] = entry;
  }
  logWriteIdx = (logWriteIdx + 1) % MAX_LOG_ENTRIES;
  totalLogged++;
  notifyListeners();
}

// get all log entries in chronological order
export function getLogEntries(): LogEntry[] {
  if (logBuffer.length < MAX_LOG_ENTRIES) return [...logBuffer];
  // ring buffer is full, stitch from writeIdx onwards
  return [
    ...logBuffer.slice(logWriteIdx),
    ...logBuffer.slice(0, logWriteIdx),
  ];
}

// format entries as a readable text block for the Logs tab
export function getLogText(): string {
  const entries = getLogEntries();
  if (!entries.length) return '';
  return entries.map(e => {
    const ts = new Date(e.timestamp).toLocaleTimeString('en-US', { hour12: false });
    const ctx = e.context ? ' ' + JSON.stringify(e.context) : '';
    return `[${ts}] ${e.level} ${e.message}${ctx}`;
  }).join('\n');
}

export function getLogCount(): number {
  return totalLogged;
}

// --- backend callable wrapper with timeout ---
// wraps a callable so it logs start/end and throws a clear error on timeout
// instead of hanging forever when the Python backend is dead

const DEFAULT_CALLABLE_TIMEOUT_MS = 10_000; // 10s

export function callWithTimeout<T>(
  fn: () => Promise<T>,
  name: string,
  timeoutMs = DEFAULT_CALLABLE_TIMEOUT_MS,
): Promise<T> {
  const t0 = Date.now();
  recordLogEntry({ timestamp: t0, level: 'INFO', message: `BACKEND >> ${name} called` });

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const msg = `BACKEND TIMEOUT: ${name} did not respond after ${timeoutMs}ms - Python backend may not be running`;
      recordLogEntry({ timestamp: Date.now(), level: 'ERROR', message: msg });
      reject(new Error(msg));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timer);
        const dur = Date.now() - t0;
        recordLogEntry({
          timestamp: Date.now(),
          level: 'INFO',
          message: `BACKEND << ${name} responded (${dur}ms)`,
        });
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        const dur = Date.now() - t0;
        const errMsg = err instanceof Error ? err.message : String(err);
        recordLogEntry({
          timestamp: Date.now(),
          level: 'ERROR',
          message: `BACKEND !! ${name} failed after ${dur}ms: ${errMsg}`,
        });
        reject(err);
      });
  });
}

// --- main logging function ---

export async function logFrontendEvent(
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR',
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  // always write to frontend buffer (instant, no filtering)
  recordLogEntry({ timestamp: Date.now(), level, message, context });

  // also send to Python backend (best-effort, swallow errors)
  try {
    await logFrontendEventCallable(level, message, context);
  } catch {
    // dont let backend logging break the UI
  }
}
