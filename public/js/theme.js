(function () {
  'use strict';

  var THEME_COOKIE = 'imghoster_theme';
  var DARK = 'dark';
  var LIGHT = 'light';

  function readCookie(name) {
    var escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function writeCookie(name, value, maxAgeSeconds) {
    document.cookie =
      name + '=' + encodeURIComponent(value) +
      '; Max-Age=' + String(maxAgeSeconds) +
      '; Path=/' +
      '; SameSite=Lax';
  }

  function getSavedTheme() {
    var fromCookie = readCookie(THEME_COOKIE);
    return fromCookie === DARK || fromCookie === LIGHT ? fromCookie : '';
  }

  function resolveInitialTheme() {
    var saved = getSavedTheme();
    if (saved) return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? DARK
      : LIGHT;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === DARK ? DARK : LIGHT);
  }

  function setTheme(theme) {
    var normalized = theme === DARK ? DARK : LIGHT;
    applyTheme(normalized);
    writeCookie(THEME_COOKIE, normalized, 60 * 60 * 24 * 365);
  }

  function buildToggle() {
    if (document.getElementById('theme-toggle')) return;

    var host = document.createElement('label');
    host.className = 'theme-toggle';
    host.setAttribute('id', 'theme-toggle');
    host.setAttribute('title', 'Toggle dark mode');

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('aria-label', 'Dark mode');

    var track = document.createElement('span');
    track.className = 'theme-toggle-track';

    var text = document.createElement('span');
    text.className = 'theme-toggle-text';

    host.appendChild(input);
    host.appendChild(track);
    host.appendChild(text);

    var navbar = document.querySelector('.navbar');
    if (navbar) {
      host.classList.add('theme-toggle-inline');
      var logoutBtn = document.getElementById('btn-logout');
      if (logoutBtn && logoutBtn.parentNode === navbar) {
        navbar.insertBefore(host, logoutBtn);
      } else {
        navbar.appendChild(host);
      }
    } else {
      host.classList.add('theme-toggle-floating');
      document.body.appendChild(host);
    }

    var isDark = document.documentElement.getAttribute('data-theme') === DARK;
    input.checked = isDark;
    text.textContent = isDark ? 'Dark' : 'Light';

    input.addEventListener('change', function () {
      var next = input.checked ? DARK : LIGHT;
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
