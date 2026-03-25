/* list.js – my images page logic */
'use strict';

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

(async () => {
  const me = await App.requireAuth();
  if (!me) return;
  App.initNavbar(me);

  const tbody = document.getElementById('images-tbody');
  const alertEl = document.getElementById('alert');
  const showAllLabel = document.getElementById('show-all-label');
  const showAllCheckbox = document.getElementById('show-all');
  const colUser = document.getElementById('col-user');

  if (me.isAdmin) {
    showAllLabel.style.display = 'flex';
    showAllCheckbox.addEventListener('change', () => {
      colUser.style.display = showAllCheckbox.checked ? '' : 'none';
      loadImages();
    });
  }

  async function loadImages() {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)">Loading\u2026</td></tr>';
    App.hideAlert(alertEl);
    try {
      const url = me.isAdmin && showAllCheckbox.checked ? '/api/images?all=1' : '/api/images';
      const images = await App.api(url);
      renderImages(images);
    } catch (err) {
      App.showAlert(alertEl, 'Failed to load images: ' + err.message);
      tbody.innerHTML = '';
    }
  }

  function renderImages(images) {
    if (!images.length) {
      tbody.innerHTML = `<tr><td colspan="7">
        <div class="empty-state">
          <div class="empty-icon">\uD83D\uDDBC\uFE0F</div>
          <p>No images yet. <a href="upload.html">Upload one!</a></p>
        </div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = images
      .map((img) => {
        const url = `/i/${img.slug}`;
        const showUser = me.isAdmin && showAllCheckbox.checked;
        const origin = window.location.origin;
        return `
        <tr>
          <td><img class="img-thumb" src="${url}" alt="${escHtml(img.slug)}" loading="lazy" /></td>
          <td>
            <div style="font-weight:600;font-size:.9rem">${escHtml(img.slug)}</div>
            <div class="url-box" style="margin-top:.35rem;font-size:.78rem">
              <span style="flex:1">/i/${escHtml(img.slug)}</span>
              <button class="copy-btn" data-url="${escHtml(origin + url)}" title="Copy URL">\uD83D\uDCCB</button>
            </div>
          </td>
          <td ${showUser ? '' : 'style="display:none"'}>${escHtml(img.username || '')}</td>
          <td>${App.formatBytes(img.size)}</td>
          <td>${img.view_count ?? 0}</td>
          <td style="font-size:.82rem">${App.formatDate(img.created_at)}</td>
          <td>
            <div style="display:flex;gap:.35rem;flex-wrap:wrap">
              <a class="btn btn-ghost btn-sm" href="${url}" target="_blank" rel="noopener noreferrer">\u2197\uFE0F Open</a>
              <button class="btn btn-danger btn-sm" data-delete="${img.id}">\uD83D\uDDD1 Delete</button>
            </div>
          </td>
        </tr>`;
      })
      .join('');

    // Attach event listeners (no inline handlers)
    tbody.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => App.copyText(btn.dataset.copy, btn));
    });
    tbody.querySelectorAll('.copy-btn[data-url]').forEach((btn) => {
      btn.addEventListener('click', () => App.copyText(btn.dataset.url, btn));
    });
    tbody.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => deleteImage(Number(btn.dataset.delete), btn));
    });
  }

  async function deleteImage(id, btn) {
    if (!confirm('Delete this image? This cannot be undone.')) return;
    btn.disabled = true;
    try {
      await App.api(`/api/images/${id}`, { method: 'DELETE' });
      await loadImages();
    } catch (err) {
      App.showAlert(alertEl, 'Delete failed: ' + err.message);
      btn.disabled = false;
    }
  }

  loadImages();
})();
