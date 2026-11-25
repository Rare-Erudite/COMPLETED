import React from 'react';

/**
 * Last line of defence against a blank white screen.
 *
 * A React render error used to unmount the whole tree and leave `#root` empty:
 * the user saw a white page with no explanation and no way to recover. This
 * boundary keeps a visible, actionable message on screen instead, and offers a
 * reload that bypasses a stale cached bundle.
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the real error in the console for diagnosis; the user gets a plain
    // explanation rather than a stack trace.
    console.error('[RARE] Render error:', error, info?.componentStack);
  }

  private reloadFresh = () => {
    // A hard reload with the cache bypassed is the only reliable way out of a
    // stale-bundle state, which is the most common cause of this screen.
    try {
      window.location.reload();
    } catch {
      window.location.href = '/';
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#03040A',
          color: '#E2E8F0',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: '520px', width: '100%' }}>
          <div style={{ fontSize: '13px', letterSpacing: '0.08em', color: '#64748B', marginBottom: '10px' }}>
            RARE-INTELLIGENCE
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 10px' }}>
            The app could not finish loading
          </h1>
          <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#94A3B8', margin: '0 0 18px' }}>
            Something failed while starting the interface. This is usually a stale
            cached version after an update. Reloading normally fixes it.
          </p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={this.reloadFresh}
              style={{
                padding: '10px 18px',
                borderRadius: '10px',
                border: 'none',
                background: '#4F46E5',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload the app
            </button>
            <a
              href="/"
              style={{
                padding: '10px 18px',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#CBD5E1',
                fontSize: '13px',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Go to home
            </a>
          </div>
          <details style={{ marginTop: '20px', fontSize: '12px', color: '#64748B' }}>
            <summary style={{ cursor: 'pointer' }}>Technical detail</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '8px' }}>
              {this.state.error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
