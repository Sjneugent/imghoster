/* register.js - account creation page */
'use strict';

const form = document.getElementById('register-form');
const alertEl = document.getElementById('alert');
const registerBtn = document.getElementById('register-btn');
const captchaImage = document.getElementById('captcha-image');
const refreshCaptchaBtn = document.getElementById('refresh-captcha');

function showAlert(message, type = 'error') {
  alertEl.className = `alert alert-${type} show`;
  alertEl.textContent = message;
}

function clearAlert() {
  alertEl.className = 'alert';
  alertEl.textContent = '';
}

async function loadCaptcha() {
  try {
    const res = await fetch('/api/auth/captcha', { credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok || !data.svg) throw new Error(data.error || 'Failed to load captcha.');
    captchaImage.innerHTML = data.svg;
  } catch (_) {
    showAlert('Could not load captcha. Refresh the page and try again.');
  }
}

refreshCaptchaBtn.addEventListener('click', () => {
  clearAlert();
  loadCaptcha();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert();

  const email = document.getElementById('email').value.trim();
  const username = document.getElementById('username').value.trim();
  const realName = document.getElementById('realName').value.trim();
  const password = document.getElementById('password').value;
  const captcha = document.getElementById('captcha').value.trim();

  if (!email || !username || !realName || !password || !captcha) {
    showAlert('Please complete all fields.');
    return;
  }

  registerBtn.disabled = true;
  registerBtn.innerHTML = '<span class="spinner"></span> Creating account...';

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, username, realName, password, captcha }),
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert(data.error || 'Registration failed.');
      registerBtn.disabled = false;
      registerBtn.textContent = 'Create account';
      document.getElementById('captcha').value = '';
      await loadCaptcha();
      return;
    }

    showAlert('Account created successfully. Redirecting to login...', 'success');
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 900);
  } catch (_) {
    showAlert('Network error. Please try again.');
    registerBtn.disabled = false;
    registerBtn.textContent = 'Create account';
  }
});

loadCaptcha();
