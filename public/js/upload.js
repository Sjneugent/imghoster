/* upload.js – upload page logic */
'use strict';

(async () => {
  const me = await App.requireAuth();
  if (!me) return;
  App.initNavbar(me);

  const form = document.getElementById('upload-form');
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const dropZoneLabel = dropZone.querySelector('.dz-label');
  const dzPreview = document.getElementById('dz-preview');
  const uploadBtn = document.getElementById('upload-btn');
  const alertEl = document.getElementById('alert');
  const slugInput = document.getElementById('slug');
  const resultEl = document.getElementById('result');
  const resultUrl = document.getElementById('result-url');
  const viewLink = document.getElementById('view-link');
  const copyBtn = document.getElementById('copy-btn');
  let previewUrls = [];

  function clearPreviewUrls() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderPreviewGrid(files) {
    clearPreviewUrls();
    if (!files.length) {
      dzPreview.style.display = 'none';
      dzPreview.innerHTML = '';
      return;
    }

    const cards = files.map((file) => {
      const objectUrl = URL.createObjectURL(file);
      previewUrls.push(objectUrl);
      const safeName = escapeHtml(file.name || 'unnamed');
      const sizeLabel = App.formatBytes(file.size || 0);
      return `
        <figure class="dz-thumb-card">
          <img class="dz-thumb-image" src="${objectUrl}" alt="${safeName}" />
          <figcaption class="dz-thumb-meta">
            <span class="dz-thumb-name" title="${safeName}">${safeName}</span>
            <span class="dz-thumb-size">${sizeLabel}</span>
          </figcaption>
        </figure>
      `;
    });

    dzPreview.innerHTML = cards.join('');
    dzPreview.style.display = 'grid';
  }

  function setSelectedFiles(files) {
    const dt = new DataTransfer();
    files.slice(0, 5).forEach((f) => dt.items.add(f));
    fileInput.files = dt.files;
  }

  function onFilesSelected(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) return;

    if (files.length > 5) {
      App.showAlert(alertEl, 'You can upload up to 5 images at once. Using the first 5 files.');
      setSelectedFiles(files);
    }

    const selected = Array.from(fileInput.files || []);
    if (!selected.length) return;

    renderPreviewGrid(selected);
    if (dropZoneLabel) {
      dropZoneLabel.textContent = selected.length > 1
        ? `${selected.length} files selected. Ready to upload.`
        : '1 file selected. Ready to upload.';
    }

    if (selected.length > 1) {
      slugInput.value = '';
      slugInput.disabled = true;
    } else {
      slugInput.disabled = false;
    }

    uploadBtn.disabled = false;
    App.hideAlert(alertEl);
  }

  fileInput.addEventListener('change', () => onFilesSelected(fileInput.files));

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files || []).filter(Boolean);
    if (files.length) {
      setSelectedFiles(files);
      onFilesSelected(fileInput.files);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    App.hideAlert(alertEl);

    const selectedFiles = Array.from(fileInput.files || []);
    if (selectedFiles.length === 0) {
      App.showAlert(alertEl, 'Please select at least one image file.');
      return;
    }
    if (selectedFiles.length > 5) {
      App.showAlert(alertEl, 'You can upload up to 5 images at once.');
      return;
    }

    const fd = new FormData();
    selectedFiles.forEach((f) => fd.append('image', f));
    const slug = document.getElementById('slug').value.trim();
    const comment = document.getElementById('comment').value.trim();
    const tags = document.getElementById('tags').value.trim();
    if (slug) fd.append('slug', slug);
    if (comment) fd.append('comment', comment);
    if (tags) fd.append('tags', tags);
    fd.append('compress', document.getElementById('compress-image').checked ? 'true' : 'false');

    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '<span class="spinner"></span> Uploading\u2026';

    try {
      const res = await fetch('/api/images/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: App.csrfHeader(),
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');

      const uploaded = Array.isArray(data.uploaded) ? data.uploaded : [data];
      if (!uploaded.length || !uploaded[0].url) {
        throw new Error('Upload completed but response was invalid.');
      }

      const lines = uploaded.map((item) => {
        let suffix = '';
        if (item.compression && item.compression.requested) {
          const finalKb = Math.max(1, Math.round(item.compression.finalSize / 1024));
          if (item.compression.applied) {
            const beforeKb = Math.max(1, Math.round(item.compression.originalSize / 1024));
            suffix = ` (compressed ${beforeKb}KB -> ${finalKb}KB)`;
          } else {
            suffix = ` (compression skipped, ${finalKb}KB)`;
          }
        }
        return `${item.url}${suffix}`;
      });

      resultUrl.textContent = lines.join('\n');
      resultUrl.style.whiteSpace = 'pre-wrap';
      viewLink.href = uploaded[0].url;
      viewLink.textContent = uploaded.length > 1 ? 'Open first image ↗' : 'Open image ↗';
      resultEl.style.display = 'block';
      form.style.display = 'none';
    } catch (err) {
      App.showAlert(alertEl, err.message);
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = '\u2b06\ufe0f Upload';
    }
  });

  copyBtn.addEventListener('click', () => App.copyText(resultUrl.textContent, copyBtn));

  document.getElementById('upload-another').addEventListener('click', () => {
    form.reset();
    form.style.display = 'block';
    resultEl.style.display = 'none';
    clearPreviewUrls();
    dzPreview.style.display = 'none';
    dzPreview.innerHTML = '';
    if (dropZoneLabel) {
      dropZoneLabel.innerHTML = 'Drag & drop an image here, or <strong>click to browse</strong>';
    }
    slugInput.disabled = false;
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '\u2b06\ufe0f Upload';
  });
})();
