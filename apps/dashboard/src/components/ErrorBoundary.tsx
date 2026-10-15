import { Component, type ErrorInfo, type ReactNode } from 'react';

/* The last line of defence: a bug that throws while rendering shows a calm page with
   a way out instead of a blank screen. Nothing about the error is sent anywhere. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="signin">
        <div className="card signin-card" role="alert">
          <h1>Something went wrong</h1>
          <p className="muted">This page hit a problem it couldn’t recover from. Reloading usually fixes it; your data is safe.</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
            <a className="btn btn-ghost" href="/">Go to the start</a>
          </div>
        </div>
      </div>
    );
  }
}
