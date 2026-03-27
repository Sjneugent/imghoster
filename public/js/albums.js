/* albums.js – album management page */
'use strict';

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

(async () => {
  const me = await App.requireAuth();
  if (!me) return;
  App.initNavbar(me);

  const alertEl = document.getElementById('alert');
  const albumsList = document.getElementById('albums-list');
  const albumDetail = document.getElementById('album-detail');
  const newAlbumForm = document.getElementById('new-album-form');
  const btnNew = document.getElementById('btn-new-album');
  const btnCreate = document.getElementById('btn-create-album');
  const btnCancel = document.getElementById('btn-cancel-album');
  const btnBack = document.getElementById('btn-back-albums');
  const nameInput = document.getElementById('album-name');
  const descInput = document.getElementById('album-desc');

  btnNew.addEventListener('click', () => {
    newAlbumForm.style.display = 'block';
    nameInput.focus();
  });

  btnCancel.addEventListener('click', () => {
    newAlbumForm.style.display = 'none';
    nameInput.value = '';
    descInput.value = '';
  });

  btnCreate.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return App.showAlert(alertEl, 'Album name is required.');
    btnCreate.disabled = true;
    try {
      await App.api('/api/albums', {
        method: 'POST',
        body: JSON.stringify({ name, description: descInput.value.trim() }),
      });
      newAlbumForm.style.display = 'none';
      nameInput.value = '';
      descInput.value = '';
      await loadAlbums();
    } catch (err) {
      App.showAlert(alertEl, err.message);
    } finally {
      btnCreate.disabled = false;
    }
  });

  btnBack.addEventListener('click', () => {
    albumDetail.style.display = 'none';
    albumsList.style.display = 'block';
    btnNew.style.display = '';
  });

  async function loadAlbums() {
    try {
      const albums = await App.api('/api/albums');
      if (!albums.length) {
        albumsList.innerHTML = '<div class="empty-state"><p>No albums yet. Create one!</p></div>';
        return;
      }
      albumsList.innerHTML = albums.map(a => `
        <div class="card" style="margin-bottom:.75rem;cursor:pointer" data-album-id="${a.id}">
          <div style="display:flex;align-items:center;gap:1rem">
            <div style="flex:1">
              <strong>${escHtml(a.name)}</strong>
              ${a.description ? `<div style="font-size:.85rem;color:var(--text-muted)">${escHtml(a.description)}</div>` : ''}
            </div>
            <button class="btn btn-danger btn-sm" data-delete-album="${a.id}" title="Delete album">Delete</button>
          </div>
        </div>
      `).join('');

      albumsList.querySelectorAll('[data-album-id]').forEach(el => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('[data-delete-album]')) return;
          viewAlbum(Number(el.dataset.albumId));
        });
      });

      albumsList.querySelectorAll('[data-delete-album]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this album? Images will not be deleted.')) return;
          try {
            await App.api(`/api/albums/${btn.dataset.deleteAlbum}`, { method: 'DELETE' });
            await loadAlbums();
          } catch (err) {
            App.showAlert(alertEl, err.message);
          }
        });
      });
    } catch (err) {
      App.showAlert(alertEl, 'Failed to load albums: ' + err.message);
    }
  }

  async function viewAlbum(id) {
    try {
      const album = await App.api(`/api/albums/${id}`);
      document.getElementById('album-detail-name').textContent = album.name;
      document.getElementById('album-detail-desc').textContent = album.description || '';

      const imagesEl = document.getElementById('album-images');
      if (!album.images || !album.images.length) {
        imagesEl.innerHTML = '<p style="color:var(--text-muted)">No images in this album yet. Add images from the My Images page.</p>';
      } else {
        imagesEl.innerHTML = album.images.map(img => `
          <div class="card" style="padding:.5rem;text-align:center">
            <a href="/i/${escHtml(img.slug)}" target="_blank">
              <img src="/i/${escHtml(img.slug)}/thumb" alt="${escHtml(img.slug)}" style="max-width:100%;border-radius:4px"
                   onerror="this.src='/i/${escHtml(img.slug)}'" />
            </a>
            <div style="font-size:.78rem;margin-top:.3rem">${escHtml(img.slug)}</div>
            <button class="btn btn-danger btn-sm" style="margin-top:.3rem" data-remove-img="${img.id}" data-album="${id}">Remove</button>
          </div>
        `).join('');

        imagesEl.querySelectorAll('[data-remove-img]').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              await App.api(`/api/albums/${btn.dataset.album}/images/${btn.dataset.removeImg}`, { method: 'DELETE' });
              await viewAlbum(id);
            } catch (err) {
              App.showAlert(alertEl, err.message);
            }
          });
        });
      }

      albumsList.style.display = 'none';
      btnNew.style.display = 'none';
      newAlbumForm.style.display = 'none';
      albumDetail.style.display = 'block';
    } catch (err) {
      App.showAlert(alertEl, 'Failed to load album: ' + err.message);
    }
  }

  loadAlbums();
})();
