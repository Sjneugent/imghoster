/* upload.js – upload page logic */
'use strict';

(async () => {
  const me = await App.requireAuth();
  if (!me) return;
  App.initNavbar(me);

  const form = document.getElementById('upload-form');
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const previewImg = document.getElementById('preview-img');
  const dzPreview = document.getElementById('dz-preview');
  const uploadBtn = document.getElementById('upload-btn');
  const alertEl = document.getElementById('alert');
  const resultEl = document.getElementById('result');
  const resultUrl = document.getElementById('result-url');
  const viewLink = document.getElementById('view-link');
  const copyBtn = document.getElementById('copy-btn');

  function onFileSelected(file) {
    if (!file) return;
    dzPreview.style.display = 'block';
    previewImg.src = URL.createObjectURL(file);
    uploadBtn.disabled = false;
    App.hideAlert(alertEl);
  }

  fileInput.addEventListener('change', () => onFileSelected(fileInput.files[0]));

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      onFileSelected(file);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    App.hideAlert(alertEl);

    const file = fileInput.files[0];
    if (!file) {
      App.showAlert(alertEl, 'Please select an image file.');
      return;
    }

    const fd = new FormData();
    fd.append('image', file);
    const slug = document.getElementById('slug').value.trim();
    if (slug) fd.append('slug', slug);

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

      const url = data.url;
      resultUrl.textContent = url;
      viewLink.href = url;
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
    dzPreview.style.display = 'none';
    previewImg.src = '';
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = '\u2b06\ufe0f Upload';
  });
})();
