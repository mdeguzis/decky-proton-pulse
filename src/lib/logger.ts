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
    // Logging should never block the main user flow.
  }
}
