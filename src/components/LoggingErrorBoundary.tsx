import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logFrontendEvent } from '../lib/logger';

interface Props {
  name: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Wraps a component tree and logs render errors to the plugin backend
 * so they show up in `make get-logs`. Without this, React render crashes
 * only appear in Decky's generic error boundary with no detail in our logs.
 */
export class LoggingErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidMount(): void {
    void logFrontendEvent('DEBUG', `LoggingErrorBoundary mounted: ${this.props.name}`, {});
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const msg = error?.message || String(error);
    const stack = info?.componentStack?.slice(0, 500) || '';
    void logFrontendEvent('ERROR', `[${this.props.name}] React render crash: ${msg}`, {
      stack,
      errorName: error?.name,
    });
  }

  render() {
    if (this.state.error) {
      // re-throw so Decky's outer boundary still shows the retry UI
      throw this.state.error;
    }
    return this.props.children;
  }
}
