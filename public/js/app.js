/* app.js – shared utilities loaded on every authenticated page */
'use strict';

const App = (() => {
  let _csrfToken = null;
  const API_TOKEN_STORAGE_KEY = 'imghoster_api_token';

  function getApiToken() {
    try {
      return localStorage.getItem(API_TOKEN_STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function setApiToken(token) {
    try {
      const next = String(token || '').trim();
      if (!next) {
        localStorage.removeItem(API_TOKEN_STORAGE_KEY);
      } else {
        localStorage.setItem(API_TOKEN_STORAGE_KEY, next);
      }
    } catch (_) {
      // ignore storage errors
    }
  }

  function apiAuthHeader() {
    const token = getApiToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /* ── API helper ──────────────────────────────────────────────────────────── */
  async function api(path, options = {}) {
    const headers = {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...apiAuthHeader(),
      ...(options.headers || {}),
    };
    // Attach CSRF token for state-mutating requests
    const method = (options.method || 'GET').toUpperCase();
    if (_csrfToken && method !== 'GET' && method !== 'HEAD') {
      headers['X-CSRF-Token'] = _csrfToken;
    }
    const res = await fetch(path, {
      headers,
      credentials: 'same-origin',
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || 'Request failed'), { status: res.status });
    return body;
  }

  /* ── Alert helpers ───────────────────────────────────────────────────────── */
  function showAlert(el, message, type = 'error') {
    el.className = `alert alert-${type} show`;
    el.textContent = message;
  }
  function hideAlert(el) { el.className = 'alert'; el.textContent = ''; }

  /* ── Copy to clipboard ───────────────────────────────────────────────────── */
  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => (btn.textContent = orig), 1500);
    } catch (_) { /* ignore */ }
  }

  /* ── Format bytes ────────────────────────────────────────────────────────── */
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  /* ── Format date ──────────────────────────────────────────────────────────── */
  function formatDate(str) {
    if (!str) return '—';
    return new Date(str + (str.endsWith('Z') ? '' : 'Z')).toLocaleString();
  }

  /* ── Auth guard ──────────────────────────────────────────────────────────── */
  async function requireAuth(adminOnly = false) {
    try {
      const me = await api('/api/auth/me');
      // Store CSRF token for use in subsequent mutating requests
      if (me.csrfToken) _csrfToken = me.csrfToken;
      if (adminOnly && !me.isAdmin) {
        window.location.href = '/upload.html';
        return null;
      }
      return me;
    } catch (e) {
      if (e.status === 401) window.location.href = '/login.html';
      return null;
    }
  }

  /* ── Logout ──────────────────────────────────────────────────────────────── */
  async function logout() {
    const headers = _csrfToken ? { 'X-CSRF-Token': _csrfToken } : {};
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers });
    _csrfToken = null;
    window.location.href = '/login.html';
  }

  /* ── Navbar bootstrap ────────────────────────────────────────────────────── */
  function initNavbar(me) {
    const userInfo = document.getElementById('nav-user');
    if (userInfo) userInfo.textContent = me.username + (me.isAdmin ? ' (admin)' : '');

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // Highlight active sidebar link
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.sidebar nav a').forEach((a) => {
      if (a.getAttribute('href') === currentPage) a.classList.add('active');
    });

    // Show/hide admin-only nav items
    if (!me.isAdmin) {
      document.querySelectorAll('[data-admin-only]').forEach((el) => el.remove());
    }
  }

  /* ── CSRF header helper (for fetch calls that can't use App.api) ─────────── */
  function csrfHeader() {
    return _csrfToken ? { 'X-CSRF-Token': _csrfToken } : {};
  }

  return {
    api,
    showAlert,
    hideAlert,
    copyText,
    formatBytes,
    formatDate,
    requireAuth,
    logout,
    initNavbar,
    csrfHeader,
    getApiToken,
    setApiToken,
    apiAuthHeader,
  };
})();
