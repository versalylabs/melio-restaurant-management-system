import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export default class RootErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('RMS client error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#faf9f7', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ width: '100%', maxWidth: 560, background: '#fff', border: '1px solid #fed7aa', borderRadius: 18, padding: 28, boxShadow: '0 8px 30px rgba(15,23,42,.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: '#fff7ed', color: '#ea580c', display: 'grid', placeItems: 'center', fontWeight: 800 }}>!</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 20, color: '#111827' }}>Something went wrong</h1>
              <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>The application encountered an unexpected error.</p>
            </div>
          </div>
          <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: '#fff7ed', color: '#9a3412', fontSize: 13, overflowWrap: 'anywhere' }}>
            {this.state.message}
          </div>
          <button onClick={() => window.location.reload()} style={{ marginTop: 18, border: 0, borderRadius: 12, background: '#f97316', color: '#fff', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>
            Reload application
          </button>
        </div>
      </div>
    );
  }
}
