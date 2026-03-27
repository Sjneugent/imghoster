/* 2fa.js – two-factor authentication management */
'use strict';

(async () => {
  const me = await App.requireAuth();
  if (!me) return;
  App.initNavbar(me);

  const alertEl = document.getElementById('alert');
  const statusEl = document.getElementById('totp-status');
  const setupEl = document.getElementById('totp-setup');
  const disableEl = document.getElementById('totp-disable');

  async function checkStatus() {
    try {
      const { enabled } = await App.api('/api/auth/totp/status');
      if (enabled) {
        statusEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:.75rem">
            <span style="font-size:1.5rem">&#x2705;</span>
            <div>
              <strong>2FA is enabled</strong>
              <p style="margin:.25rem 0 0;color:var(--text-muted);font-size:.9rem">Your account is protected with two-factor authentication.</p>
            </div>
          </div>`;
        setupEl.style.display = 'none';
        disableEl.style.display = 'block';
      } else {
        statusEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:.75rem">
            <span style="font-size:1.5rem">&#x1F6E1;&#xFE0F;</span>
            <div>
              <strong>2FA is not enabled</strong>
              <p style="margin:.25rem 0 0;color:var(--text-muted);font-size:.9rem">Add an extra layer of security to your account.</p>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-start-setup" style="margin-top:1rem">Set Up 2FA</button>`;
        disableEl.style.display = 'none';
        setupEl.style.display = 'none';

        document.getElementById('btn-start-setup').addEventListener('click', startSetup);
      }
    } catch (err) {
      App.showAlert(alertEl, 'Failed to check 2FA status: ' + err.message);
    }
  }

  async function startSetup() {
    try {
      const data = await App.api('/api/auth/totp/setup', { method: 'POST' });
      document.getElementById('qr-container').innerHTML = `<img src="${data.qrDataUrl}" alt="TOTP QR Code" style="max-width:200px" />`;
      document.getElementById('totp-secret').textContent = data.secret;
      setupEl.style.display = 'block';
    } catch (err) {
      App.showAlert(alertEl, err.message);
    }
  }

  document.getElementById('btn-verify').addEventListener('click', async () => {
    const code = document.getElementById('verify-code').value.trim();
    if (!code || code.length !== 6) {
      return App.showAlert(alertEl, 'Please enter a 6-digit code.');
    }
    try {
      await App.api('/api/auth/totp/enable', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      App.showAlert(alertEl, '2FA enabled successfully!', 'success');
      await checkStatus();
    } catch (err) {
      App.showAlert(alertEl, err.message);
    }
  });

  document.getElementById('btn-disable').addEventListener('click', async () => {
    const password = document.getElementById('disable-password').value;
    if (!password) return App.showAlert(alertEl, 'Password is required.');
    try {
      await App.api('/api/auth/totp/disable', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      App.showAlert(alertEl, '2FA disabled.', 'success');
      document.getElementById('disable-password').value = '';
      await checkStatus();
    } catch (err) {
      App.showAlert(alertEl, err.message);
    }
  });

  checkStatus();
})();
