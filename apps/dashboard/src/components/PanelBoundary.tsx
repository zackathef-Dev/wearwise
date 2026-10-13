import { Component, type ReactNode } from 'react';

/* Contains a crash to one panel (a chart, the live view): data from a participant's
   device is checked, but if something still slips through, the rest of the page
   keeps working. */
export class PanelBoundary extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card" role="alert">
        <p className="muted">{this.props.label} couldn’t be shown. Reload the page to try again.</p>
      </div>
    );
  }
}
