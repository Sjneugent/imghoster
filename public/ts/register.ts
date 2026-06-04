/* register.ts – account creation page */

(() => {
  const form = document.getElementById('register-form') as HTMLFormElement;
  const alertEl = document.getElementById('alert') as HTMLElement;
  const registerBtn = document.getElementById('register-btn') as HTMLButtonElement;
  const captchaImage = document.getElementById('captcha-image') as HTMLElement;
  const refreshCaptchaBtn = document.getElementById('refresh-captcha') as HTMLButtonElement;

  function showAlert(message: string, type = 'error'): void {
    alertEl.className = `alert alert-${type} show`;
    alertEl.textContent = message;
  }

  function clearAlert(): void {
    alertEl.className = 'alert';
    alertEl.textContent = '';
  }

  async function loadCaptcha(): Promise<void> {
    try {
      const res = await fetch('/api/auth/captcha', { credentials: 'same-origin' });
      const data: any = await res.json();
      if (!res.ok || !data.svg) throw new Error(data.error || 'Failed to load captcha.');
      captchaImage.innerHTML = data.svg;
    } catch {
      showAlert('Could not load captcha. Refresh the page and try again.');
    }
  }

  refreshCaptchaBtn.addEventListener('click', () => {
    clearAlert();
    loadCaptcha();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();

    const email = (document.getElementById('email') as HTMLInputElement).value.trim();
    const username = (document.getElementById('username') as HTMLInputElement).value.trim();
    const realName = (document.getElementById('realName') as HTMLInputElement).value.trim();
    const password = (document.getElementById('password') as HTMLInputElement).value;
    const captcha = (document.getElementById('captcha') as HTMLInputElement).value.trim();

    if (!email || !username || !realName || !password || !captcha) {
      showAlert('Please complete all fields.');
      return;
    }

    registerBtn.disabled = true;
    registerBtn.innerHTML = '<span class="spinner"></span> Creating account...';

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, username, realName, password, captcha }),
      });
      const data: any = await res.json();

      if (!res.ok) {
        showAlert(data.error || 'Registration failed.');
        registerBtn.disabled = false;
        registerBtn.textContent = 'Create account';
        (document.getElementById('captcha') as HTMLInputElement).value = '';
        await loadCaptcha();
        return;
      }

      showAlert('Account created successfully. Redirecting to login...', 'success');
      setTimeout(() => {
        window.location.href = '/login.html';
      }, 900);
    } catch {
      showAlert('Network error. Please try again.');
      registerBtn.disabled = false;
      registerBtn.textContent = 'Create account';
    }
  });

  loadCaptcha();
})();
