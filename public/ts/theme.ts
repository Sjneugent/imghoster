/* theme.ts – theme toggle, loaded on every page before other scripts */

(() => {
  const THEME_COOKIE = 'imghoster_theme';
  const DARK = 'dark';
  const LIGHT = 'light';

  function readCookie(name: string): string {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
    document.cookie =
      name + '=' + encodeURIComponent(value) +
      '; Max-Age=' + String(maxAgeSeconds) +
      '; Path=/' +
      '; SameSite=Lax';
  }

  function getSavedTheme(): string {
    const fromCookie = readCookie(THEME_COOKIE);
    return fromCookie === DARK || fromCookie === LIGHT ? fromCookie : '';
  }

  function resolveInitialTheme(): string {
    const saved = getSavedTheme();
    if (saved) return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
  }

  function applyTheme(theme: string): void {
    document.documentElement.setAttribute('data-theme', theme === DARK ? DARK : LIGHT);
  }

  function setTheme(theme: string): void {
    const normalized = theme === DARK ? DARK : LIGHT;
    applyTheme(normalized);
    writeCookie(THEME_COOKIE, normalized, 60 * 60 * 24 * 365);
  }

  function buildToggle(): void {
    if (document.getElementById('theme-toggle')) return;

    const host = document.createElement('label');
    host.className = 'theme-toggle';
    host.id = 'theme-toggle';
    host.title = 'Toggle dark mode';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', 'Dark mode');

    const track = document.createElement('span');
    track.className = 'theme-toggle-track';

    const text = document.createElement('span');
    text.className = 'theme-toggle-text';

    host.appendChild(input);
    host.appendChild(track);
    host.appendChild(text);

    const navbar = document.querySelector('.navbar');
    if (navbar) {
      host.classList.add('theme-toggle-inline');
      const logoutBtn = document.getElementById('btn-logout');
      if (logoutBtn && logoutBtn.parentNode === navbar) {
        navbar.insertBefore(host, logoutBtn);
      } else {
        navbar.appendChild(host);
      }
    } else {
      host.classList.add('theme-toggle-floating');
      document.body.appendChild(host);
    }

    const isDark = document.documentElement.getAttribute('data-theme') === DARK;
    input.checked = isDark;
    text.textContent = isDark ? 'Dark' : 'Light';

    input.addEventListener('change', () => {
      const next = input.checked ? DARK : LIGHT;
      setTheme(next);
      text.textContent = next === DARK ? 'Dark' : 'Light';
    });
  }

  applyTheme(resolveInitialTheme());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildToggle);
  } else {
    buildToggle();
  }
})();
