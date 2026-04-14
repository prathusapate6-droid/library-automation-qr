/* ═══════════════════════════════════════════
   Student Dashboard Logic — QR Based Smart Library Management System
   ═══════════════════════════════════════════ */

// ── Auth Guard ──
const token = localStorage.getItem('token');
const userRaw = localStorage.getItem('user');
if (!token || !userRaw) { window.location.href = '/'; }
const user = JSON.parse(userRaw || '{}');
if (user.role !== 'student') { window.location.href = '/'; }

const apiHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// ── DOM Refs ──
const booksBody = document.getElementById('booksBody');
const requestsBody = document.getElementById('requestsBody');
const issuedBody = document.getElementById('issuedBody');
const issuedCards = document.getElementById('issuedCards');
const scanMsg = document.getElementById('scanMsg');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const manualSendBtn = document.getElementById('manualSendBtn');
const manualCode = document.getElementById('manualCode');
const startScanBtn = document.getElementById('startScanBtn');
const stopScanBtn = document.getElementById('stopScanBtn');
const heroScanBtn = document.getElementById('heroScanBtn');
const navScanBtn = document.getElementById('navScanBtn');
const accountLogoutBtn = document.getElementById('accountLogoutBtn');

// ── Set Profile ──
const initials = (user.name || 'S').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
document.getElementById('headerInitials').textContent = initials;
document.getElementById('welcomeName').textContent = user.name || 'Student';
document.getElementById('profileAvatar').textContent = initials;
document.getElementById('profileName').textContent = user.name || '—';
document.getElementById('profileEmail').textContent = user.email || '—';
document.getElementById('profileClass').textContent = user.class_name || '—';
document.getElementById('profileCollege').textContent = user.college || '—';

// ── Helpers ──
function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => { toast.classList.remove('show'); }, 3500);
}

function setScanMsg(text, ok = false) {
  scanMsg.className = `mt-3 rounded-xl px-4 py-3 text-sm font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`;
  scanMsg.textContent = text;
  setTimeout(() => { scanMsg.textContent = ''; scanMsg.className = 'text-sm'; }, 5000);
}

function statusBadge(status) {
  const map = { pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected' };
  return `<span class="badge ${map[status] || 'badge-pending'}">${status}</span>`;
}

async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...apiHeaders, ...(options.headers || {}) } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ═══ BOTTOM NAV ═══
function switchStudentView(name) {
  document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));
  const target = document.getElementById(`view-${name}`);
  if (target) {
    target.classList.add('active');
    target.classList.add('animate-fade-in');
  }
  const navItem = document.querySelector(`.bottom-nav-item[data-view="${name}"]`);
  if (navItem) navItem.classList.add('active');
}

document.querySelectorAll('.bottom-nav-item').forEach(item => {
  item.addEventListener('click', () => switchStudentView(item.dataset.view));
});

// QR Scan shortcuts
heroScanBtn?.addEventListener('click', () => switchStudentView('scan'));
navScanBtn?.addEventListener('click', () => {
  switchStudentView('scan');
  startScanner();
});

// ═══ BOOKS ═══
async function loadBooks() {
  const data = await api('/api/books');
  booksBody.innerHTML = data.books.map(b => `
    <tr class="hover:bg-slate-50/50 transition-colors">
      <td class="px-5 py-3.5 text-sm font-mono text-slate-500">${b.code}</td>
      <td class="px-5 py-3.5">
        <p class="font-semibold text-primary text-sm">${b.name}</p>
        ${b.description ? `<p class="text-xs text-slate-400 mt-0.5">${b.description}</p>` : ''}
      </td>
      <td class="px-5 py-3.5">
        <span class="badge ${b.available ? 'badge-available' : 'badge-issued'}">${b.available ? 'Available' : 'Issued'}</span>
      </td>
    </tr>
  `).join('');
}

// ═══ MY REQUESTS ═══
async function loadMyRequests() {
  const data = await api('/api/requests/my');
  requestsBody.innerHTML = data.requests.map(r => `
    <tr class="hover:bg-slate-50/50 transition-colors">
      <td class="px-5 py-3.5 text-sm text-slate-500">#${r.id}</td>
      <td class="px-5 py-3.5">
        <p class="font-semibold text-primary text-sm">${r.book_name}</p>
        <p class="text-xs text-slate-400 font-mono">${r.book_code}</p>
      </td>
      <td class="px-5 py-3.5">${statusBadge(r.status)}</td>
      <td class="px-5 py-3.5 text-sm text-slate-500">${fmt(r.created_at)}</td>
    </tr>
  `).join('');
}

// ═══ ISSUED BOOKS ═══
async function loadIssued() {
  const data = await api('/api/issued/my');
  const issued = data.issued;

  // Table in history
  issuedBody.innerHTML = issued.map(i => `
    <tr class="hover:bg-slate-50/50 transition-colors">
      <td class="px-5 py-3.5">
        <p class="font-semibold text-primary text-sm">${i.book_name}</p>
        <p class="text-xs text-slate-400 font-mono">${i.book_code}</p>
      </td>
      <td class="px-5 py-3.5 text-sm text-slate-500">${fmt(i.issue_date)}</td>
      <td class="px-5 py-3.5">
        ${i.return_date
          ? `<span class="badge badge-approved">Returned ${fmtDate(i.return_date)}</span>`
          : '<span class="badge badge-issued">Not Returned</span>'
        }
      </td>
    </tr>
  `).join('');

  // Cards on home (only currently issued = not returned)
  const active = issued.filter(i => !i.return_date);
  document.getElementById('totalBorrows').textContent = issued.length;
  document.getElementById('welcomeSubtext').textContent = active.length > 0
    ? `You have ${active.length} active book${active.length > 1 ? 's' : ''} from the Central Archive.`
    : 'You have no active books right now. Scan a QR to get started!';

  if (active.length === 0) {
    issuedCards.innerHTML = `
      <div class="text-center py-12 col-span-full text-slate-400">
        <span class="material-symbols-outlined text-5xl mb-3 block opacity-30">auto_stories</span>
        <p class="font-headline font-bold">No books currently issued</p>
        <p class="text-sm mt-1">Scan a QR code to request your first book!</p>
      </div>`;
    return;
  }

  issuedCards.innerHTML = active.map(i => `
    <div class="bg-surface-container-lowest rounded-xl p-5 flex flex-col justify-between transition-all hover:shadow-lg group">
      <div class="flex gap-4 mb-5">
        <div class="w-16 h-22 bg-gradient-to-br from-primary/10 to-primary-container/10 rounded-lg flex items-center justify-center flex-shrink-0">
          <span class="material-symbols-outlined text-primary text-3xl opacity-40">menu_book</span>
        </div>
        <div class="flex flex-col justify-start min-w-0">
          <h3 class="font-bold text-primary text-lg leading-tight font-headline group-hover:text-secondary transition-colors truncate">${i.book_name}</h3>
          <p class="text-xs font-mono text-slate-400 mt-1">${i.book_code}</p>
          <span class="badge badge-issued mt-2 w-fit">Active</span>
        </div>
      </div>
      <div class="bg-surface-container-low rounded-lg p-3.5 flex justify-between items-center">
        <div>
          <p class="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-0.5">Issue Date</p>
          <p class="text-sm font-bold text-primary">${fmtDate(i.issue_date)}</p>
        </div>
        <div class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-primary">
          <span class="material-symbols-outlined text-lg">info</span>
        </div>
      </div>
    </div>
  `).join('');
}

// ═══ SEND REQUEST ═══
async function sendRequest(bookCode) {
  if (!bookCode) {
    setScanMsg('Book code is required');
    return;
  }
  try {
    const data = await api('/api/requests', {
      method: 'POST',
      body: JSON.stringify({ bookCode }),
    });
    setScanMsg(`✓ Request sent for "${data.request.book_name}"`, true);
    showToast(`Request sent for ${data.request.book_name}!`, 'success');
    await Promise.all([loadMyRequests(), loadBooks(), loadIssued()]);
  } catch (error) {
    setScanMsg(error.message || 'Could not send request');
    showToast(error.message || 'Request failed', 'error');
  }
}

// ═══ QR SCANNER ═══
let scanner = null;
let scannerActive = false;

async function startScanner() {
  if (scannerActive) return;
  scanner = new Html5Qrcode('scanner');
  try {
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 220 },
      async (decodedText) => {
        await stopScanner();
        await sendRequest(decodedText.trim());
      }
    );
    scannerActive = true;
    setScanMsg('Scanner started. Point camera to QR code.', true);
  } catch (error) {
    setScanMsg(`Camera error: ${error.message}`);
  }
}

async function stopScanner() {
  if (!scanner || !scannerActive) return;
  try {
    await scanner.stop();
    await scanner.clear();
  } catch (_) {
  } finally {
    scannerActive = false;
    scanner = null;
  }
}

// ═══ EVENT LISTENERS ═══
logoutBtn.addEventListener('click', async () => {
  await stopScanner();
  localStorage.clear();
  window.location.href = '/';
});

accountLogoutBtn?.addEventListener('click', async () => {
  await stopScanner();
  localStorage.clear();
  window.location.href = '/';
});

refreshBtn.addEventListener('click', async () => {
  await loadAll();
  showToast('Data refreshed', 'info');
});

manualSendBtn.addEventListener('click', async () => {
  await sendRequest(manualCode.value.trim());
  manualCode.value = '';
});

manualCode?.addEventListener('keypress', async (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    await sendRequest(manualCode.value.trim());
    manualCode.value = '';
  }
});

startScanBtn.addEventListener('click', startScanner);
stopScanBtn.addEventListener('click', stopScanner);

// ═══ SOCKET.IO ═══
const socket = io({ auth: { token } });

socket.on('connect_error', (err) => {
  console.warn('Socket error:', err.message);
});

socket.on('request:updated', async (data) => {
  if (data && data.status === 'approved') {
    showToast('Your book request was approved! 🎉', 'success');
  } else if (data && data.status === 'rejected') {
    showToast('Your book request was rejected.', 'error');
  }
  await loadAll();
});

// ═══ LOAD ALL ═══
async function loadAll() {
  await Promise.all([loadBooks(), loadMyRequests(), loadIssued()]);
}

// ═══ INIT ═══
(async function init() {
  try {
    await loadAll();
  } catch (error) {
    if (String(error.message || '').toLowerCase().includes('token')) {
      localStorage.clear();
      window.location.href = '/';
      return;
    }
    showToast(error.message || 'Failed to load data', 'error');
  }
})();
