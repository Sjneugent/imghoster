/* albums.ts – album management page */

(async () => {
  function escHtml(s: unknown): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const me = await App.requireAuth();
  if (!me) return;
  App.initNavbar(me);

  const alertEl = document.getElementById('alert') as HTMLElement;
  const albumsList = document.getElementById('albums-list') as HTMLElement;
  const albumDetail = document.getElementById('album-detail') as HTMLElement;
  const newAlbumForm = document.getElementById('new-album-form') as HTMLElement;
  const btnNew = document.getElementById('btn-new-album') as HTMLButtonElement;
  const btnCreate = document.getElementById('btn-create-album') as HTMLButtonElement;
  const btnCancel = document.getElementById('btn-cancel-album') as HTMLButtonElement;
  const btnBack = document.getElementById('btn-back-albums') as HTMLButtonElement;
  const nameInput = document.getElementById('album-name') as HTMLInputElement;
  const descInput = document.getElementById('album-desc') as HTMLInputElement;

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
    } catch (err: any) {
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

  async function loadAlbums(): Promise<void> {
    try {
      const albums = await App.api<Album[]>('/api/albums');
      if (!albums.length) {
        albumsList.innerHTML = '<div class="empty-state"><p>No albums yet. Create one!</p></div>';
        return;
      }
      albumsList.innerHTML = albums.map((a) => `
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

      albumsList.querySelectorAll<HTMLElement>('[data-album-id]').forEach((el) => {
        el.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('[data-delete-album]')) return;
          viewAlbum(Number(el.dataset.albumId));
        });
      });

      albumsList.querySelectorAll<HTMLButtonElement>('[data-delete-album]').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Delete this album? Images will not be deleted.')) return;
          try {
            await App.api(`/api/albums/${btn.dataset.deleteAlbum}`, { method: 'DELETE' });
            await loadAlbums();
          } catch (err: any) {
            App.showAlert(alertEl, err.message);
          }
        });
      });
    } catch (err: any) {
      App.showAlert(alertEl, 'Failed to load albums: ' + err.message);
    }
  }

  async function viewAlbum(id: number): Promise<void> {
    try {
      const album = await App.api<Album>(`/api/albums/${id}`);
      (document.getElementById('album-detail-name') as HTMLElement).textContent = album.name;
      (document.getElementById('album-detail-desc') as HTMLElement).textContent = album.description ?? '';

      const imagesEl = document.getElementById('album-images') as HTMLElement;
      if (!album.images?.length) {
        imagesEl.innerHTML = '<p style="color:var(--text-muted)">No images in this album yet. Add images from the My Images page.</p>';
      } else {
        imagesEl.innerHTML = album.images.map((img) => `
          <div class="card" style="padding:.5rem;text-align:center">
            <a href="/i/${escHtml(img.slug)}" target="_blank">
              <img src="/i/${escHtml(img.slug)}/thumb" alt="${escHtml(img.slug)}" style="max-width:100%;border-radius:4px"
                   data-fallback="/i/${encodeURIComponent(img.slug)}" />
            </a>
            <div style="font-size:.78rem;margin-top:.3rem">${escHtml(img.slug)}</div>
            <button class="btn btn-danger btn-sm" style="margin-top:.3rem" data-remove-img="${img.id}" data-album="${id}">Remove</button>
          </div>
        `).join('');

        imagesEl.querySelectorAll<HTMLImageElement>('img[data-fallback]').forEach((imgEl) => {
          imgEl.onerror = () => {
            imgEl.onerror = null;
            imgEl.src = imgEl.dataset.fallback ?? '';
          };
        });

        imagesEl.querySelectorAll<HTMLButtonElement>('[data-remove-img]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            try {
              await App.api(`/api/albums/${btn.dataset.album}/images/${btn.dataset.removeImg}`, { method: 'DELETE' });
              await viewAlbum(id);
            } catch (err: any) {
              App.showAlert(alertEl, err.message);
            }
          });
        });
      }

      albumsList.style.display = 'none';
      btnNew.style.display = 'none';
      newAlbumForm.style.display = 'none';
      albumDetail.style.display = 'block';
    } catch (err: any) {
      App.showAlert(alertEl, 'Failed to load album: ' + err.message);
    }
  }

  loadAlbums();
})();
