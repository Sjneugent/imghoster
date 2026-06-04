/* upload.ts – upload page logic */

import { validateFileBeforeUpload } from './hash-utils.js';

// App is provided at runtime by app.js loaded as a plain script before this module.
declare const App: AppModule;

(async () => {
  const me = await App.requireAuth();
  if (!me) return;
  App.initNavbar(me);

  const form = document.getElementById('upload-form') as HTMLFormElement;
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone') as HTMLElement;
  const dropZoneLabel = dropZone.querySelector<HTMLElement>('.dz-label');
  const dzPreview = document.getElementById('dz-preview') as HTMLElement;
  const uploadBtn = document.getElementById('upload-btn') as HTMLButtonElement;
  const alertEl = document.getElementById('alert') as HTMLElement;
  const slugInput = document.getElementById('slug') as HTMLInputElement;
  const resultEl = document.getElementById('result') as HTMLElement;
  const resultUrl = document.getElementById('result-url') as HTMLElement;
  const viewLink = document.getElementById('view-link') as HTMLAnchorElement;
  const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
  let previewUrls: string[] = [];

  function clearPreviewUrls(): void {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    previewUrls = [];
  }

  function escapeHtml(value: unknown): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showDuplicateAlertWithLink(message: string, slug: string): void {
    const safeMessage = escapeHtml(message || 'Image already uploaded. Please upload a unique image.');
    const safeSlugText = escapeHtml(slug || 'existing image');
    const safeHref = `/i/${encodeURIComponent(slug ?? '')}`;
    alertEl.className = 'alert alert-error show';
    alertEl.innerHTML = `${safeMessage} <a href="${safeHref}" target="_blank" rel="noopener">${safeSlugText}</a>`;
  }

  function renderPreviewGrid(files: File[]): void {
    clearPreviewUrls();
    dzPreview.innerHTML = '';
    if (!files.length) {
      dzPreview.style.display = 'none';
      return;
    }

    for (const file of files) {
      const objectUrl = URL.createObjectURL(file);
      previewUrls.push(objectUrl);

      const figure = document.createElement('figure');
      figure.className = 'dz-thumb-card';

      const img = document.createElement('img');
      img.className = 'dz-thumb-image';
      // URL.createObjectURL always returns a blob: URL; validate before DOM assignment
      if (!objectUrl.startsWith('blob:')) break;
      img.src = objectUrl;
      img.alt = file.name ?? '';

      const caption = document.createElement('figcaption');
      caption.className = 'dz-thumb-meta';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'dz-thumb-name';
      nameSpan.title = file.name ?? '';
      nameSpan.textContent = file.name ?? '';

      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'dz-thumb-size';
      sizeSpan.textContent = App.formatBytes(file.size ?? 0);

      caption.appendChild(nameSpan);
      caption.appendChild(sizeSpan);
      figure.appendChild(img);
      figure.appendChild(caption);
      dzPreview.appendChild(figure);
    }

    dzPreview.style.display = 'grid';
  }

  function setSelectedFiles(files: File[]): void {
    const dt = new DataTransfer();
    files.slice(0, 5).forEach((f) => dt.items.add(f));
    fileInput.files = dt.files;
  }

  function onFilesSelected(fileList: FileList | null): void {
    const files = Array.from(fileList ?? []).filter(Boolean);
    if (files.length === 0) return;

    if (files.length > 5) {
      App.showAlert(alertEl, 'You can upload up to 5 images at once. Using the first 5 files.');
      setSelectedFiles(files);
    }

    const selected = Array.from(fileInput.files ?? []);
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
  dropZone.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer?.files ?? []).filter(Boolean);
    if (files.length) {
      setSelectedFiles(files);
      onFilesSelected(fileInput.files);
    }
  });

  // ── Clipboard paste support ──────────────────────────────────────────────
  document.addEventListener('paste', (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length) {
      e.preventDefault();
      setSelectedFiles(imageFiles);
      onFilesSelected(fileInput.files);
    }
  });

  // ── Expiration custom date toggle ──────────────────────────────────────────
  const expiresSelect = document.getElementById('expires-at') as HTMLSelectElement;
  const expiresCustom = document.getElementById('expires-at-custom') as HTMLInputElement;
  expiresSelect.addEventListener('change', () => {
    expiresCustom.style.display = expiresSelect.value === 'custom' ? 'block' : 'none';
  });

  function computeExpiresAt(): string | null {
    const val = expiresSelect.value;
    if (!val) return null;
    if (val === 'custom') return expiresCustom.value ? new Date(expiresCustom.value).toISOString() : null;
    const now = Date.now();
    const map: Record<string, number> = { '1h': 3600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    return map[val] ? new Date(now + map[val]).toISOString() : null;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    App.hideAlert(alertEl);

    const selectedFiles = Array.from(fileInput.files ?? []);
    if (selectedFiles.length === 0) {
      App.showAlert(alertEl, 'Please select at least one image file.');
      return;
    }
    if (selectedFiles.length > 5) {
      App.showAlert(alertEl, 'You can upload up to 5 images at once.');
      return;
    }

    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '<span class="spinner"></span> Checking for duplicates\u2026';

    try {
      // Check for duplicates (only for single file uploads)
      let fileHash: string | null = null;
      if (selectedFiles.length === 1) {
        const validation = await validateFileBeforeUpload(selectedFiles[0]);
        if (!validation.success) {
          throw new Error(validation.message ?? 'Failed to validate file');
        }
        fileHash = validation.fileHash;
        if (validation.isDuplicate) {
          const msg = validation.message ?? 'Image already uploaded. Please upload a unique image.';
          if (validation.existing) {
            showDuplicateAlertWithLink(msg, validation.existing.slug);
          } else {
            App.showAlert(alertEl, msg);
          }
          uploadBtn.disabled = false;
          uploadBtn.innerHTML = 'Upload';
          return;
        }
      }

      uploadBtn.innerHTML = '<span class="spinner"></span> Uploading\u2026';

      const fd = new FormData();
      selectedFiles.forEach((f) => fd.append('image', f));
      const slug = (document.getElementById('slug') as HTMLInputElement).value.trim();
      const comment = (document.getElementById('comment') as HTMLInputElement).value.trim();
      const tags = (document.getElementById('tags') as HTMLInputElement).value.trim();
      if (slug) fd.append('slug', slug);
      if (comment) fd.append('comment', comment);
      if (tags) fd.append('tags', tags);
      if (fileHash) fd.append('fileHash', fileHash);
      fd.append('compress', (document.getElementById('compress-image') as HTMLInputElement).checked ? 'true' : 'false');
      fd.append('visibility', (document.getElementById('visibility') as HTMLSelectElement).value);
      const expiresAt = computeExpiresAt();
      if (expiresAt) fd.append('expiresAt', expiresAt);

      const res = await fetch('/api/images/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { ...App.csrfHeader(), ...App.apiAuthHeader() },
        body: fd,
      });
      const data: any = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');

      const uploaded: Array<{ url: string; compression?: { requested: boolean; applied: boolean; finalSize: number; originalSize: number } }> =
        Array.isArray(data.uploaded) ? data.uploaded : [data];
      if (!uploaded.length || !uploaded[0].url) {
        throw new Error('Upload completed but response was invalid.');
      }

      const lines = uploaded.map((item) => {
        let suffix = '';
        if (item.compression?.requested) {
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
      viewLink.textContent = uploaded.length > 1 ? 'Open first image' : 'Open image';
      resultEl.style.display = 'block';
      form.style.display = 'none';
    } catch (err: any) {
      App.showAlert(alertEl, err.message);
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = 'Upload';
    }
  });

  copyBtn.addEventListener('click', () => App.copyText(resultUrl.textContent ?? '', copyBtn));

  document.getElementById('upload-another')!.addEventListener('click', () => {
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
    uploadBtn.innerHTML = 'Upload';
  });
})();
