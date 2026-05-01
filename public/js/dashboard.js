/* dashboard.js – admin dashboard page logic */
'use strict';

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

(async () => {
  const me = await App.requireAuth(true); // admin only
  if (!me) return;
  App.initNavbar(me);

  const alertEl = document.getElementById('alert');
  const tbody = document.getElementById('users-tbody');
  const pwModal = document.getElementById('pw-modal');
  let resetTargetId = null;

  async function loadUsers() {
    App.hideAlert(alertEl);
    try {
      const users = await App.api('/api/admin/users');
      renderUsers(users);
    } catch (err) {
      App.showAlert(alertEl, 'Failed to load users: ' + err.message);
    }
  }

  function renderUsers(users) {
    tbody.innerHTML = users
      .map(
        (u) => `
      <tr>
        <td>${u.id}</td>
        <td>${escHtml(u.username)}${u.id === me.id ? ' <em style="color:var(--text-muted);font-size:.8rem">(you)</em>' : ''}</td>
        <td>${u.is_admin ? '\u2B50 Admin' : 'User'}</td>
        <td style="font-size:.82rem">${App.formatDate(u.created_at)}</td>
        <td>
          <div style="display:flex;gap:.35rem;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-reset-id="${u.id}" data-reset-name="${escHtml(u.username)}">\uD83D\uDD11 Reset pw</button>
            ${u.id !== me.id ? `<button class="btn btn-danger btn-sm" data-delete-id="${u.id}">\uD83D\uDDD1 Delete</button>` : ''}
          </div>
        </td>
      </tr>`
      )
      .join('');

    tbody.querySelectorAll('[data-reset-id]').forEach((btn) => {
      btn.addEventListener('click', () => openPwModal(Number(btn.dataset.resetId), btn.dataset.resetName));
    });
    tbody.querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', () => deleteUser(Number(btn.dataset.deleteId), btn));
    });
  }

  // Create user
  document.getElementById('create-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    App.hideAlert(alertEl);
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value;
    const isAdmin = document.getElementById('new-is-admin').checked;

    if (!username || !password) {
      App.showAlert(alertEl, 'Username and password are required.');
      return;
    }
    if (password.length < 8) {
      App.showAlert(alertEl, 'Password must be at least 8 characters.');
      return;
    }
    try {
      const created = await App.api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, isAdmin }),
      });
      e.target.reset();
      const role = created.isAdmin ? 'admin' : 'regular user';
      App.showAlert(alertEl, `User "${username}" created as ${role}.`, 'success');
      loadUsers();
    } catch (err) {
      App.showAlert(alertEl, err.message);
    }
  });

  // Delete user
  async function deleteUser(id, btn) {
    if (!confirm('Delete this user and ALL their images? This cannot be undone.')) return;
    btn.disabled = true;
    try {
      await App.api(`/api/admin/users/${id}`, { method: 'DELETE' });
      App.showAlert(alertEl, 'User deleted.', 'success');
      loadUsers();
    } catch (err) {
      App.showAlert(alertEl, err.message);
      btn.disabled = false;
    }
  }

  // Password reset modal
  function openPwModal(id, username) {
    resetTargetId = id;
    document.getElementById('pw-modal-user').textContent = `Resetting password for: ${username}`;
    document.getElementById('new-pw').value = '';
    pwModal.style.display = 'flex';
  }

  document.getElementById('pw-modal-cancel').addEventListener('click', () => {
    pwModal.style.display = 'none';
  });

  document.getElementById('pw-modal-save').addEventListener('click', async () => {
    const pw = document.getElementById('new-pw').value;
    if (pw.length < 8) {
      alert('Password must be at least 8 characters.');
      return;
    }
    try {
      await App.api(`/api/admin/users/${resetTargetId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password: pw }),
      });
      pwModal.style.display = 'none';
      App.showAlert(alertEl, 'Password updated.', 'success');
    } catch (err) {
      pwModal.style.display = 'none';
      App.showAlert(alertEl, err.message);
    }
  });

  loadUsers();
})();
