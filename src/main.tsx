import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppErrorBoundary } from './AppErrorBoundary';
import './index.css';

const rootElement = document.getElementById('root');

/**
 * Boot guard.
 *
 * If the bundle itself fails to execute (a stale cached index.html pointing at
 * a hash this deployment no longer serves, a blocked script, a syntax error in
 * an old cached chunk), React never mounts and `#root` stays empty — a blank
 * white page with no explanation. This renders a visible message instead, and
 * a reload that re-fetches the current index.html.
 */
function renderBootFailure(message: string) {
  if (!rootElement) return;
  rootElement.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.setAttribute('style', [
    'min-height:100vh', 'display:flex', 'align-items:center', 'justify-content:center',
    'background:#03040A', 'color:#E2E8F0', 'padding:24px',
    'font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
  ].join(';'));
  const safe = message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  wrap.innerHTML = `
    <div style="max-width:520px;width:100%">
      <div style="font-size:13px;letter-spacing:.08em;color:#64748B;margin-bottom:10px">RARE-INTELLIGENCE</div>
      <h1 style="font-size:20px;font-weight:700;margin:0 0 10px">The app could not start</h1>
      <p style="font-size:14px;line-height:1.6;color:#94A3B8;margin:0 0 18px">
        A newer version of RARE is available, or the page was loaded from an outdated cache.
        Reloading will fetch the current version.
      </p>
      <button id="rare-boot-reload" style="padding:10px 18px;border-radius:10px;border:none;background:#4F46E5;color:#fff;font-size:13px;font-weight:600;cursor:pointer">
        Reload the app
      </button>
      <details style="margin-top:20px;font-size:12px;color:#64748B">
        <summary style="cursor:pointer">Technical detail</summary>
        <pre style="white-space:pre-wrap;word-break:break-word;margin-top:8px">${safe}</pre>
      </details>
    </div>`;
  rootElement.appendChild(wrap);
  document.getElementById('rare-boot-reload')?.addEventListener('click', () => window.location.reload());
}

if (!rootElement) {
  // Nothing to mount into — surface it rather than failing silently.
  document.body.innerHTML =
    '<div style="padding:24px;font-family:system-ui;color:#E2E8F0;background:#03040A;min-height:100vh">' +
    'RARE could not start: the page is missing its root element. Please reload.</div>';
} else {
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </React.StrictMode>
    );
  } catch (error) {
    renderBootFailure(error instanceof Error ? error.message : String(error));
  }
}
