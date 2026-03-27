/* login.js – login page logic */
'use strict';

// Redirect if already logged in
fetch('/api/auth/me', { credentials: 'same-origin' })
  .then(r => {
    if (!r.ok) return;
    const hasToken = !!localStorage.getItem('imghoster_api_token');
    window.location.href = hasToken ? '/upload.html' : '/token.html';
  })
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
    const payload = { username, password, rememberMe };

    // If TOTP field exists and has a value, include it
    const totpInput = document.getElementById('totp-code');
    if (totpInput && totpInput.value.trim()) {
      payload.totpCode = totpInput.value.trim();
    }

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    // Server asks for TOTP code (206 Partial Content)
    if (res.status === 206 && data.requiresTotp) {
      let totpGroup = document.getElementById('totp-group');
      if (!totpGroup) {
        totpGroup = document.createElement('div');
        totpGroup.id = 'totp-group';
        totpGroup.className = 'form-group';
        totpGroup.innerHTML = `
          <label class="form-label" for="totp-code">2FA Code</label>
          <input class="form-control" type="text" id="totp-code" maxlength="6"
                 pattern="[0-9]{6}" placeholder="Enter 6-digit code"
                 autocomplete="one-time-code" />`;
        submitBtn.parentElement.insertBefore(totpGroup, submitBtn);
      }
      document.getElementById('totp-code').focus();
      alertEl.className = 'alert alert-error show';
      alertEl.textContent = 'Please enter your 2FA code.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
      return;
    }

    if (!res.ok) {
      alertEl.className = 'alert alert-error show';
      alertEl.textContent = data.error || 'Login failed.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';
      return;
    }

    window.location.href = '/token.html';
  } catch (_) {
    alertEl.className = 'alert alert-error show';
    alertEl.textContent = 'Network error. Please try again.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';
  }
});
