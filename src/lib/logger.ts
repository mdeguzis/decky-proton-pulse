// Thin wrapper around the Python backend's log_frontend_event callable.
// Keeps the frontend from having to deal with callable() plumbing directly.
import { callable } from '@decky/api';

const logFrontendEventCallable = callable<
  [level: string, message: string, context?: Record<string, unknown>],
  boolean
>('log_frontend_event');

export async function logFrontendEvent(
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR',
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    await logFrontendEventCallable(level, message, context);
  } catch {
    // don't let logging break the UI
  }
}
