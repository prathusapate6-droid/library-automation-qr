/* ── Auth Page Logic (main.js) ── */

function setMessage(id, text, ok = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `mt-2 rounded-xl px-4 py-3 text-sm font-medium animate-fade-in ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`;
  el.textContent = text;
  // Auto-clear after 5s
  setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.className = 'text-sm'; } }, 5000);
}

function saveAuth(payload) {
  localStorage.setItem('token', payload.token);
  localStorage.setItem('user', JSON.stringify(payload.user));
}

function goByRole(user) {
  if (user.role === 'admin') {
    window.location.href = '/admin.html';
    return;
  }
  window.location.href = '/student.html';
}

// ── Auto-redirect if already logged in ──
const existingToken = localStorage.getItem('token');
const existingUser = localStorage.getItem('user');
if (existingToken && existingUser) {
  try {
    const user = JSON.parse(existingUser);
    goByRole(user);
  } catch (_) {
    localStorage.clear();
  }
}

// ── View Toggle (Register ↔ Login) ──
const registerView = document.getElementById('registerView');
const loginView = document.getElementById('loginView');
const showLoginBtn = document.getElementById('showLoginBtn');
const showRegisterBtn = document.getElementById('showRegisterBtn');

showLoginBtn?.addEventListener('click', () => {
  registerView.classList.add('hidden');
  loginView.classList.remove('hidden');
  loginView.classList.add('animate-fade-in');
});

showRegisterBtn?.addEventListener('click', () => {
  loginView.classList.add('hidden');
  registerView.classList.remove('hidden');
  registerView.classList.add('animate-fade-in');
});

// ── Register ──
const registerForm = document.getElementById('registerForm');
const loginForm = document.getElementById('loginForm');

registerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = registerForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-lg">progress_activity</span> Registering...';

  const form = new FormData(registerForm);
  const body = {
    name: String(form.get('name') || '').trim(),
    className: String(form.get('className') || '').trim(),
    college: String(form.get('college') || '').trim(),
    email: String(form.get('email') || '').trim(),
    password: String(form.get('password') || ''),
  };

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    saveAuth(data);
    setMessage('registerMsg', '✓ Registration successful! Redirecting...', true);
    setTimeout(() => goByRole(data.user), 600);
  } catch (error) {
    setMessage('registerMsg', error.message || 'Registration failed');
    btn.disabled = false;
    btn.innerHTML = '<span>Register</span><span class="material-symbols-outlined text-lg">arrow_forward</span>';
  }
});

// ── Login ──
loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = loginForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-lg">progress_activity</span> Logging in...';

  const form = new FormData(loginForm);
  const body = {
    email: String(form.get('email') || '').trim(),
    password: String(form.get('password') || ''),
  };

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    saveAuth(data);
    setMessage('loginMsg', '✓ Login successful! Redirecting...', true);
    setTimeout(() => goByRole(data.user), 500);
  } catch (error) {
    setMessage('loginMsg', error.message || 'Login failed');
    btn.disabled = false;
    btn.innerHTML = '<span>Login</span><span class="material-symbols-outlined text-lg">login</span>';
  }
});
