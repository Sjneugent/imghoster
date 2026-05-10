/* token.ts – API token management page */

(async () => {
  const me = await App.requireAuth();
  if (!me) return;
  App.initNavbar(me);

  const alertEl = document.getElementById('alert') as HTMLElement;
  const form = document.getElementById('token-form') as HTMLFormElement;
  const createBtn = document.getElementById('token-create-btn') as HTMLButtonElement;
  const labelInput = document.getElementById('token-label') as HTMLInputElement;
  const durationInput = document.getElementById('token-duration') as HTMLSelectElement;
  const tbody = document.getElementById('tokens-tbody') as HTMLElement;

  const newTokenCard = document.getElementById('new-token-card') as HTMLElement;
  const newTokenValue = document.getElementById('new-token-value') as HTMLElement;
  const copyNewToken = document.getElementById('copy-new-token') as HTMLButtonElement;
  const useAsActiveBtn = document.getElementById('use-as-active') as HTMLButtonElement;
  const activeTokenNote = document.getElementById('active-token-note') as HTMLElement;

  let latestToken = '';

  function renderActiveState(): void {
    activeTokenNote.textContent = App.getApiToken()
      ? 'An active API token is currently stored in this browser.'
      : 'No active API token is currently stored in this browser.';
  }

  function statusLabel(token: ApiToken): string {
    if (token.revokedAt) return 'Revoked';
    const exp = token.expiresAt ? Date.parse(token.expiresAt) : 0;
    if (exp && exp <= Date.now()) return 'Expired';
    return 'Active';
  }

  function escapeHtml(value: unknown): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function loadTokens(): Promise<void> {
    App.hideAlert(alertEl);
    try {
      const tokens = await App.api<ApiToken[]>('/api/auth/tokens');
      if (!Array.isArray(tokens) || !tokens.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)">No tokens yet.</td></tr>';
        return;
      }

      tbody.innerHTML = tokens.map((t) => `
        <tr>
          <td>${t.id}</td>
          <td>${t.label ? escapeHtml(t.label) : '<span style="color:var(--text-muted)">-</span>'}</td>
          <td style="font-size:.82rem">${App.formatDate(t.expiresAt)}</td>
          <td style="font-size:.82rem">${App.formatDate(t.lastUsedAt)}</td>
          <td>${statusLabel(t)}</td>
          <td>
            ${statusLabel(t) === 'Active' ? `<button class="btn btn-danger btn-sm" data-revoke="${t.id}">Revoke</button>` : ''}
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.revoke);
          if (!id || !confirm('Revoke this token?')) return;
          btn.disabled = true;
          try {
            await App.api(`/api/auth/tokens/${id}`, { method: 'DELETE' });
            App.showAlert(alertEl, 'Token revoked.', 'success');
            await loadTokens();
          } catch (err: any) {
            App.showAlert(alertEl, err.message);
            btn.disabled = false;
          }
        });
      });
    } catch (err: any) {
      App.showAlert(alertEl, 'Failed to load tokens: ' + err.message);
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)">Failed to load tokens.</td></tr>';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    App.hideAlert(alertEl);

    const label = labelInput.value.trim();
    const durationMinutes = Number(durationInput.value);
    if (!durationMinutes || durationMinutes < 5) {
      App.showAlert(alertEl, 'Please choose a valid expiration duration.');
      return;
    }

    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
      const created = await App.api<{ token: string }>('/api/auth/tokens', {
        method: 'POST',
        body: JSON.stringify({ label, durationMinutes }),
      });

      latestToken = created.token ?? '';
      newTokenValue.textContent = latestToken;
      newTokenCard.style.display = latestToken ? 'block' : 'none';
      App.setApiToken(latestToken);
      renderActiveState();

      form.reset();
      durationInput.value = '60';
      App.showAlert(alertEl, 'Token created and set as active in this browser.', 'success');
      await loadTokens();
    } catch (err: any) {
      App.showAlert(alertEl, 'Failed to create token: ' + err.message);
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = 'Create token';
    }
  });

  copyNewToken.addEventListener('click', () => {
    if (!latestToken) return;
    App.copyText(latestToken, copyNewToken);
  });

  useAsActiveBtn.addEventListener('click', () => {
    if (!latestToken) return;
    App.setApiToken(latestToken);
    renderActiveState();
    App.showAlert(alertEl, 'Active API token updated for this browser.', 'success');
  });

  renderActiveState();
  await loadTokens();
})();
