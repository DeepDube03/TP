// Set this to the origin of the deployed DOCDON Node.js backend when the
// frontend is hosted separately (for example, on GitHub Pages).
// Leave empty when the frontend and backend are served by `node server.js`.
window.DOCDON_CONFIG = Object.freeze({
  apiBaseUrl: 'https://docdon.onrender.com'
});

// Canonical URL builder for every frontend request to the DOCDON backend.
// Local Node development stays same-origin; hosted frontends use apiBaseUrl.
window.apiUrl = function apiUrl(path) {
  const value = String(path || '');
  if (/^https?:\/\//i.test(value)) return value;
  const normalized = value.startsWith('/') ? value : '/' + value;
  const hostname = String(window.location.hostname || '').toLowerCase();
  const localHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  const base = localHost ? '' : String(window.DOCDON_CONFIG?.apiBaseUrl || '').trim().replace(/\/+$/, '');
  return base ? base + normalized : normalized;
};
