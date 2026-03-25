/* login.js – login page logic */
'use strict';

// Redirect if already logged in
fetch('/api/auth/me', { credentials: 'same-origin' })
  .then(r => { if (r.ok) window.location.href = '/upload.html'; })
  .catch(() => {});

const form = document.getElementById('login-form');
const alertEl = document.getElementById('alert');
const submitBtn = document.getElementById('submit-btn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertEl.className = 'alert';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('rememberMe').checked;

  if (!username || !password) {
    alertEl.className = 'alert alert-error show';
    alertEl.textContent = 'Please enter your username and password.';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Signing in\u2026';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password, rememberMe }),
    });
    const data = await res.json();

    if (!res.ok) {
      alertEl.className = 'alert alert-error show';
      alertEl.textContent = data.error || 'Login failed.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
      return;
    }

    window.location.href = '/upload.html';
  } catch (_) {
    alertEl.className = 'alert alert-error show';
    alertEl.textContent = 'Network error. Please try again.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';
  }
});
