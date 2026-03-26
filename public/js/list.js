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
  const searchInput = document.getElementById('search-input');
  const bulkToolbar = document.getElementById('bulk-toolbar');
  const selectAllCheckbox = document.getElementById('select-all');
  const selectAllHead = document.getElementById('select-all-head');
  const selectionCount = document.getElementById('selection-count');
  const btnDownload = document.getElementById('btn-download');

  let allImages = []; // cache of currently loaded images
  let selectedIds = new Set();

  if (me.isAdmin) {
    showAllLabel.style.display = 'flex';
    showAllCheckbox.addEventListener('change', () => {
      colUser.style.display = showAllCheckbox.checked ? '' : 'none';
      loadImages();
    });
  }

  // ── Search ────────────────────────────────────────────────────────────────
  let searchTimeout = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const query = searchInput.value.trim();
      if (query) {
        filterImages(query);
      } else {
        renderImages(allImages);
      }
    }, 250);
  });

  function filterImages(query) {
    const q = query.toLowerCase();
    const filtered = allImages.filter((img) => {
      return (
        (img.slug && img.slug.toLowerCase().includes(q)) ||
        (img.original_name && img.original_name.toLowerCase().includes(q)) ||
        (img.username && img.username.toLowerCase().includes(q))
      );
    });
    renderImages(filtered);
  }

  // ── Selection management ──────────────────────────────────────────────────
  function updateSelectionUI() {
    const count = selectedIds.size;
    bulkToolbar.style.display = allImages.length > 0 ? 'flex' : 'none';
    selectionCount.textContent = count > 0 ? `${count} image${count !== 1 ? 's' : ''} selected` : '';
    btnDownload.disabled = count === 0;

    // Sync header and toolbar "select all" checkboxes
    const visibleCheckboxes = tbody.querySelectorAll('.img-checkbox');
    const allChecked = visibleCheckboxes.length > 0 && [...visibleCheckboxes].every(cb => cb.checked);
    const someChecked = [...visibleCheckboxes].some(cb => cb.checked);
    selectAllHead.checked = allChecked;
    selectAllHead.indeterminate = someChecked && !allChecked;
    selectAllCheckbox.checked = allChecked;
    selectAllCheckbox.indeterminate = someChecked && !allChecked;
  }

  function toggleSelectAll(checked) {
    const checkboxes = tbody.querySelectorAll('.img-checkbox');
    checkboxes.forEach((cb) => {
      cb.checked = checked;
      const id = Number(cb.dataset.id);
      if (checked) {
        selectedIds.add(id);
      } else {
        selectedIds.delete(id);
      }
    });
    updateSelectionUI();
  }

  selectAllCheckbox.addEventListener('change', () => toggleSelectAll(selectAllCheckbox.checked));
  selectAllHead.addEventListener('change', () => toggleSelectAll(selectAllHead.checked));

  // ── Download as ZIP ───────────────────────────────────────────────────────
  btnDownload.addEventListener('click', async () => {
    if (selectedIds.size === 0) return;
    btnDownload.disabled = true;
    const origText = btnDownload.textContent;
    btnDownload.textContent = '⏳ Downloading…';

    try {
      const response = await fetch('/api/images/download', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...App.csrfHeader(),
        },
        body: JSON.stringify({ ids: [...selectedIds] }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Download failed');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'images.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      App.showAlert(alertEl, `Downloaded ${selectedIds.size} image${selectedIds.size !== 1 ? 's' : ''} as ZIP.`, 'success');
    } catch (err) {
      App.showAlert(alertEl, 'Download failed: ' + err.message);
    } finally {
      btnDownload.textContent = origText;
      btnDownload.disabled = selectedIds.size === 0;
    }
  });

  // ── Load images ───────────────────────────────────────────────────────────
  async function loadImages() {
    tbody.innerHTML =
      '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted)">Loading\u2026</td></tr>';
    App.hideAlert(alertEl);
    selectedIds.clear();
    try {
      const url = me.isAdmin && showAllCheckbox.checked ? '/api/images?all=1' : '/api/images';
      allImages = await App.api(url);
      renderImages(allImages);
    } catch (err) {
      App.showAlert(alertEl, 'Failed to load images: ' + err.message);
      tbody.innerHTML = '';
      allImages = [];
      bulkToolbar.style.display = 'none';
    }
  }

  function renderImages(images) {
    if (!images.length) {
      const query = searchInput.value.trim();
      const message = query
        ? `No images matching \u201C${escHtml(query)}\u201D.`
        : 'No images yet. <a href="upload.html">Upload one!</a>';
      tbody.innerHTML = `<tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">${query ? '\uD83D\uDD0D' : '\uD83D\uDDBC\uFE0F'}</div>
          <p>${message}</p>
        </div>
      </td></tr>`;
      bulkToolbar.style.display = 'none';
      return;
    }

    tbody.innerHTML = images
      .map((img) => {
        const url = `/i/${img.slug}`;
        const showUser = me.isAdmin && showAllCheckbox.checked;
        const origin = window.location.origin;
        const checked = selectedIds.has(img.id) ? 'checked' : '';
        return `
        <tr>
          <td><input type="checkbox" class="img-checkbox" data-id="${img.id}" ${checked} /></td>
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

    // Attach event listeners
    tbody.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => App.copyText(btn.dataset.copy, btn));
    });
    tbody.querySelectorAll('.copy-btn[data-url]').forEach((btn) => {
      btn.addEventListener('click', () => App.copyText(btn.dataset.url, btn));
    });
    tbody.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => deleteImage(Number(btn.dataset.delete), btn));
    });
    tbody.querySelectorAll('.img-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.id);
        if (cb.checked) {
          selectedIds.add(id);
        } else {
          selectedIds.delete(id);
        }
        updateSelectionUI();
      });
    });

    updateSelectionUI();
  }

  async function deleteImage(id, btn) {
    if (!confirm('Delete this image? This cannot be undone.')) return;
    btn.disabled = true;
    try {
      await App.api(`/api/images/${id}`, { method: 'DELETE' });
      selectedIds.delete(id);
      await loadImages();
    } catch (err) {
      App.showAlert(alertEl, 'Delete failed: ' + err.message);
      btn.disabled = false;
    }
  }

  loadImages();
})();
