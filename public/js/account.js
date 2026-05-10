/* account.js – account settings page logic */
'use strict';

(async () => {
  const me = await App.requireAuth();
  if (!me) return;
  App.initNavbar(me);

  const alertEl = document.getElementById('alert');
  const alertName = document.getElementById('alert-name');
  const alertPw = document.getElementById('alert-pw');
  const formName = document.getElementById('form-name');
  const formPw = document.getElementById('form-pw');
  const realNameInput = document.getElementById('real-name');

  // Pre-fill display name from server
  try {
    const user = await App.api('/api/auth/me');
    if (user.realName) realNameInput.value = user.realName;
  } catch (_) { /* non-fatal */ }

  // ── Update display name ───────────────────────────────────────────────────
  formName.addEventListener('submit', async (e) => {
    e.preventDefault();
    App.hideAlert(alertName);
    const realName = realNameInput.value.trim();
    if (realName && (realName.length < 2 || realName.length > 120)) {
      return App.showAlert(alertName, 'Display name must be between 2 and 120 characters.', 'error');
    }
    try {
      await App.api('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ realName }),
      });
      App.showAlert(alertName, 'Display name updated.', 'success');
    } catch (err) {
      App.showAlert(alertName, err.message || 'Failed to update display name.', 'error');
    }
  });

  // ── Change password ───────────────────────────────────────────────────────
  formPw.addEventListener('submit', async (e) => {
    e.preventDefault();
    App.hideAlert(alertPw);
    const currentPassword = document.getElementById('current-pw').value;
    const newPassword = document.getElementById('new-pw').value;
    const confirmPassword = document.getElementById('confirm-pw').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return App.showAlert(alertPw, 'All password fields are required.', 'error');
    }
    if (newPassword.length < 8) {
      return App.showAlert(alertPw, 'New password must be at least 8 characters.', 'error');
    }
    if (newPassword !== confirmPassword) {
      return App.showAlert(alertPw, 'New passwords do not match.', 'error');
    }
    try {
      await App.api('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      formPw.reset();
      App.showAlert(alertPw, 'Password changed successfully.', 'success');
    } catch (err) {
      App.showAlert(alertPw, err.message || 'Failed to change password.', 'error');
    }
  });
})();
