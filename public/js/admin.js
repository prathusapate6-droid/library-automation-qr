/* ═══════════════════════════════════════════
   Admin Panel Logic — QR Based Smart Library Management System
   ═══════════════════════════════════════════ */

// ── Auth Guard ──
const token = localStorage.getItem('token');
const userRaw = localStorage.getItem('user');
if (!token || !userRaw) { window.location.href = '/'; }
const user = JSON.parse(userRaw || '{}');
if (user.role !== 'admin') { window.location.href = '/'; }

const apiHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// ── DOM Refs ──
const adminAvatar = document.getElementById('adminAvatar');
const adminName = document.getElementById('adminName');
const bookForm = document.getElementById('bookForm');
const bookMsg = document.getElementById('bookMsg');
const booksBody = document.getElementById('booksBody');
const issuedBody = document.getElementById('issuedBody');
const refreshBtn = document.getElementById('refreshBtn');
const logoutBtn = document.getElementById('logoutBtn');
const batchPdfBtn = document.getElementById('batchPdfBtn');
const catalogPdfBtn = document.getElementById('catalogPdfBtn');
const menuToggle = document.getElementById('menuToggle');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const settingRefreshSec = document.getElementById('settingRefreshSec');
const settingDefaultFilter = document.getElementById('settingDefaultFilter');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const resetSettingsBtn = document.getElementById('resetSettingsBtn');
const settingsMsg = document.getElementById('settingsMsg');

const SETTINGS_KEY = 'admin_panel_settings_v1';
let autoRefreshTimer = null;
let pendingCoverDataUrl = null; // base64 data URI of selected cover photo

// ── Cover Upload Helpers ──
function compressImageToPortrait(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        // Portrait target: max 400w x 600h, maintain aspect but crop to portrait if landscape
        const TARGET_W = 400;
        const TARGET_H = 600;
        const canvas = document.createElement('canvas');
        let sw = img.width, sh = img.height, sx = 0, sy = 0;

        // If landscape, center-crop to portrait ratio
        const imgRatio = sw / sh;
        const targetRatio = TARGET_W / TARGET_H;
        if (imgRatio > targetRatio) {
          // wider than portrait — crop sides
          sw = Math.round(sh * targetRatio);
          sx = Math.round((img.width - sw) / 2);
        } else {
          // taller than portrait — crop top/bottom
          sh = Math.round(sw / targetRatio);
          sy = Math.round((img.height - sh) / 2);
        }

        canvas.width = TARGET_W;
        canvas.height = TARGET_H;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TARGET_W, TARGET_H);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function showCoverPreview(dataUrl) {
  const preview = document.getElementById('coverPreview');
  const icon = document.getElementById('uploadIcon');
  const label = document.getElementById('uploadLabel');
  const hint = document.getElementById('uploadHint');
  const clearBtn = document.getElementById('clearCoverBtn');
  preview.src = dataUrl;
  preview.style.display = 'block';
  icon.style.display = 'none';
  label.textContent = 'Photo selected ✔';
  label.style.color = '#166534';
  hint.style.display = 'none';
  clearBtn.style.display = 'inline-block';
  pendingCoverDataUrl = dataUrl;
}

function clearCoverPreview() {
  const preview = document.getElementById('coverPreview');
  const icon = document.getElementById('uploadIcon');
  const label = document.getElementById('uploadLabel');
  const hint = document.getElementById('uploadHint');
  const clearBtn = document.getElementById('clearCoverBtn');
  const fileInput = document.getElementById('coverFileInput');
  preview.src = ''; preview.style.display = 'none';
  icon.style.display = ''; label.textContent = 'Click or drag & drop a photo here';
  label.style.color = ''; hint.style.display = '';
  clearBtn.style.display = 'none';
  fileInput.value = '';
  pendingCoverDataUrl = null;
}

// Wire up upload zone events
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('coverFileInput');
  const clearBtn = document.getElementById('clearCoverBtn');
  if (!zone) return;

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await compressImageToPortrait(file);
    showCoverPreview(dataUrl);
  });

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await compressImageToPortrait(file);
    showCoverPreview(dataUrl);
  });

  clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearCoverPreview(); });
});

// Set admin info
if (user.name) {
  adminName.textContent = user.name;
  adminAvatar.textContent = user.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

// ── Helpers ──
function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function fmtShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => { toast.classList.remove('show'); }, 3500);
}

function statusBadge(status) {
  const map = {
    pending: 'badge-pending',
    approved: 'badge-approved',
    rejected: 'badge-rejected',
  };
  return `<span class="badge ${map[status] || 'badge-pending'}">${status}</span>`;
}

function setBookMsg(text, ok = false) {
  bookMsg.className = `mt-3 rounded-xl px-4 py-3 text-sm font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`;
  bookMsg.textContent = text;
  setTimeout(() => { bookMsg.textContent = ''; bookMsg.className = 'mt-3 text-sm'; }, 5000);
}

async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...apiHeaders, ...(options.headers || {}) } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function qrDataUrl(text) {
  if (window.QRCode && typeof window.QRCode.toDataURL === 'function') {
    return QRCode.toDataURL(text, { margin: 1, width: 140, color: { dark: '#0f2d52', light: '#FFFFFF' } });
  }
  const data = await api(`/api/admin/qr?text=${encodeURIComponent(text)}`);
  return data.dataUrl;
}

// ═══ SIDEBAR NAVIGATION ═══
function switchView(name) {
  document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const target = document.getElementById(`view-${name}`);
  if (target) {
    target.classList.add('active');
    target.classList.add('animate-fade-in');
  }
  const navItem = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (navItem) navItem.classList.add('active');
  // Close mobile sidebar
  sidebar.classList.add('-translate-x-full');
  sidebarOverlay.classList.add('hidden');
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => switchView(item.dataset.view));
});

// Mobile sidebar toggle
function toggleSidebar() {
  sidebar.classList.toggle('-translate-x-full');
  sidebarOverlay.classList.toggle('hidden');
}
menuToggle?.addEventListener('click', toggleSidebar);

// ═══ DASHBOARD STATS ═══
async function loadStats() {
  try {
    const data = await api('/api/admin/stats');
    const s = data.stats;
    document.getElementById('statTotalBooks').textContent = s.totalBooks;
    document.getElementById('statAvailable').textContent = `${s.availableBooks} available`;
    document.getElementById('statIssued').textContent = s.issuedBooks;
    document.getElementById('statIssuedToday').textContent = `${s.issuedToday} today`;
    document.getElementById('statStudents').textContent = s.totalStudents;
    document.getElementById('statPending').textContent = s.pendingRequests;

    // Nav badge
    const navBadge = document.getElementById('navPendingBadge');
    if (s.pendingRequests > 0) {
      navBadge.textContent = s.pendingRequests;
      navBadge.classList.remove('hidden');
    } else {
      navBadge.classList.add('hidden');
    }

    // Dashboard badge
    document.getElementById('dashPendingBadge').textContent = `${s.pendingRequests} PENDING`;

    // Analytics view
    const analyticsTotalBooks = document.getElementById('analyticsTotalBooks');
    const analyticsAvailableBooks = document.getElementById('analyticsAvailableBooks');
    const analyticsPendingRequests = document.getElementById('analyticsPendingRequests');
    const analyticsStudents = document.getElementById('analyticsStudents');
    if (analyticsTotalBooks) analyticsTotalBooks.textContent = s.totalBooks ?? 0;
    if (analyticsAvailableBooks) analyticsAvailableBooks.textContent = s.availableBooks ?? 0;
    if (analyticsPendingRequests) analyticsPendingRequests.textContent = s.pendingRequests ?? 0;
    if (analyticsStudents) analyticsStudents.textContent = s.totalStudents ?? 0;
  } catch (e) {
    console.error('Stats error:', e);
  }
}

async function loadStudents() {
  try {
    const data = await api('/api/admin/students');
    const rows = data.students || [];
    const body = document.getElementById('analyticsStudentsBody');
    if (!body) return;

    body.innerHTML = rows.length
      ? rows.map((s) => `
        <tr class="hover:bg-slate-50/50 transition-colors">
          <td class="px-6 py-4 text-sm font-semibold text-primary">${s.name}</td>
          <td class="px-6 py-4 text-sm text-slate-600">${s.class_name}</td>
          <td class="px-6 py-4 text-sm text-slate-600">${s.college}</td>
          <td class="px-6 py-4 text-sm text-slate-500">${s.email}</td>
        </tr>
      `).join('')
      : `<tr><td class="px-6 py-6 text-sm text-slate-500" colspan="4">No students found.</td></tr>`;
  } catch (e) {
    console.error('Students error:', e);
  }
}

// ═══ BOOKS ═══
let allBooks = [];

async function loadBooks() {
  const data = await api('/api/books');
  allBooks = data.books;
  await renderBooksTable(data.books);
  renderDashBooks(data.books.slice(0, 5));
}

async function renderBooksTable(books) {
  const rows = await Promise.all(
    books.map(async (b) => {
      const url = await qrDataUrl(b.code);
      const coverHtml = b.cover_url
        ? `<img src="${b.cover_url}" alt="cover" class="h-14 w-10 rounded object-cover shadow-sm" onerror="this.style.display='none'" />`
        : `<div class="h-14 w-10 rounded bg-slate-100 flex items-center justify-center text-xl">📖</div>`;
      return `
        <tr class="hover:bg-slate-50/50 transition-colors">
          <td class="px-4 py-4">
            <div class="flex items-center gap-3">
              ${coverHtml}
              <div>
                <p class="font-semibold text-primary text-sm">${b.name}</p>
                <p class="text-xs text-slate-400 mt-0.5">${b.description || '—'}</p>
              </div>
            </div>
          </td>
          <td class="px-6 py-4">
            <p class="text-sm font-mono text-slate-600">${b.code}</p>
            <span class="badge ${b.available ? 'badge-available' : 'badge-issued'} mt-1">${b.available ? 'Available' : 'Issued'}</span>
          </td>
          <td class="px-6 py-4">
            <img class="h-16 w-16 rounded-lg bg-white object-contain" src="${url}" alt="${b.code}" />
          </td>
          <td class="px-6 py-4">
            <button class="rounded-lg bg-secondary-container/20 px-3 py-2 text-xs font-bold text-on-secondary-container hover:bg-secondary-container/40 transition-colors flex items-center gap-1" data-action="pdf" data-book='${JSON.stringify(b).replace(/'/g, '&#39;')}'>
              <span class="material-symbols-outlined text-sm">picture_as_pdf</span> PDF
            </button>
          </td>
        </tr>`;
    })
  );
  booksBody.innerHTML = rows.join('');

  booksBody.querySelectorAll('button[data-action="pdf"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const book = JSON.parse(btn.getAttribute('data-book').replace(/&#39;/g, "'"));
      await downloadQrPdf(book);
      showToast(`QR PDF downloaded for ${book.code}`, 'success');
    });
  });
}

function renderDashBooks(books) {
  const body = document.getElementById('dashBooksBody');
  if (!body) return;
  body.innerHTML = books.map(b => {
    const coverHtml = b.cover_url
      ? `<img src="${b.cover_url}" alt="cover" class="h-10 w-8 rounded object-cover" onerror="this.style.display='none'" />`
      : `<span class="text-lg">📖</span>`;
    return `
    <tr class="hover:bg-slate-50/50 transition-colors">
      <td class="px-4 py-4">
        <div class="flex items-center gap-3">
          ${coverHtml}
          <div>
            <p class="font-semibold text-primary text-sm">${b.name}</p>
            <p class="text-xs text-slate-400">${b.description || '—'}</p>
          </div>
        </div>
      </td>
      <td class="px-6 py-4 text-sm font-mono text-slate-500">${b.code}</td>
      <td class="px-6 py-4"><span class="badge ${b.available ? 'badge-available' : 'badge-issued'}">${b.available ? 'In Library' : 'Issued'}</span></td>
    </tr>`;
  }).join('');
}

// ═══ QR PDF ═══
async function downloadQrPdf(book) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const qr = await qrDataUrl(book.code);

  // Header
  pdf.setFontSize(20);
  pdf.setTextColor(0, 32, 69);
  pdf.text('QR Based Smart Library Management System', 60, 60);
  pdf.setFontSize(10);
  pdf.setTextColor(100, 100, 100);
  pdf.text('Library Book QR Label', 60, 80);

  // Line
  pdf.setDrawColor(200, 200, 200);
  pdf.line(60, 92, 540, 92);

  // Book info
  pdf.setFontSize(14);
  pdf.setTextColor(0, 32, 69);
  pdf.text(`Book: ${book.name}`, 60, 120);
  pdf.setFontSize(11);
  pdf.setTextColor(80, 80, 80);
  pdf.text(`Code: ${book.code}`, 60, 140);
  if (book.description) {
    pdf.setFontSize(9);
    pdf.text(`Description: ${book.description}`, 60, 158);
  }

  // QR
  pdf.addImage(qr, 'PNG', 60, 175, 180, 180);

  // Footer
  pdf.setFontSize(8);
  pdf.setTextColor(150, 150, 150);
  pdf.text('Print this label and attach it to the book cover.', 60, 375);
  pdf.text(`Generated: ${new Date().toLocaleString()}`, 60, 390);

  pdf.save(`${book.code}.pdf`);
}

async function generateCatalogPdf() {
  if (allBooks.length === 0) { showToast('No books in inventory', 'error'); return; }

  showToast('Generating catalog PDF...', 'info');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const perPage = 4;
  const margin = 60;

  for (let i = 0; i < allBooks.length; i++) {
    if (i > 0 && i % perPage === 0) pdf.addPage();
    const b = allBooks[i];
    const row = i % perPage;
    const y = margin + row * 185;
    const qr = await qrDataUrl(b.code);

    pdf.setFontSize(12);
    pdf.setTextColor(0, 32, 69);
    pdf.text(b.name, margin, y + 15);
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text(b.code, margin, y + 30);
    pdf.addImage(qr, 'PNG', margin, y + 40, 120, 120);

    // Separator line
    if (row < perPage - 1) {
      pdf.setDrawColor(220, 220, 220);
      pdf.setLineDashPattern([2, 2], 0);
      pdf.line(margin, y + 170, 540, y + 170);
    }
  }

  pdf.save('Library_Catalog_QR.pdf');
  showToast('Catalog PDF downloaded!', 'success');
}

batchPdfBtn?.addEventListener('click', generateCatalogPdf);
catalogPdfBtn?.addEventListener('click', generateCatalogPdf);

// ═══ REQUESTS ═══
let allRequests = [];
let currentFilter = 'pending';

async function loadRequests() {
  const data = await api('/api/admin/requests');
  allRequests = data.requests;
  renderRequests(allRequests);
  renderDashRequests(allRequests.filter(r => r.status === 'pending').slice(0, 4));

  const pendingCount = allRequests.filter(r => r.status === 'pending').length;
  document.getElementById('reqPendingCount').textContent = pendingCount;
  document.getElementById('reqTotalCount').textContent = allRequests.length;
}

function renderRequests(requests) {
  const filtered = currentFilter ? requests.filter(r => r.status === currentFilter) : requests;
  const container = document.getElementById('requestsList');

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-16 text-slate-400">
        <span class="material-symbols-outlined text-5xl mb-3 block opacity-30">inbox</span>
        <p class="font-headline font-bold">${currentFilter === 'pending' ? 'No pending requests right now' : 'No requests found'}</p>
        <p class="text-xs mt-2">${currentFilter === 'pending' ? 'Ask a student to scan a book QR to create a new request.' : ''}</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(r => {
    const canAct = r.status === 'pending';
    const initials = (r.user_name || 'U').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    return `
      <div class="bg-surface-container-lowest rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:shadow-md transition-shadow">
        <div class="flex items-center gap-4 flex-1 min-w-0">
          <div class="w-12 h-12 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">${initials}</div>
          <div class="min-w-0">
            <p class="font-bold text-primary text-sm">${r.user_name}</p>
            <p class="text-xs text-slate-500">${r.class_name} · ${r.college}</p>
            <p class="text-xs text-slate-400">${r.email}</p>
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-bold text-on-surface text-sm">"${r.book_name}"</p>
          <p class="text-xs text-slate-400 font-mono">${r.book_code}</p>
        </div>
        <div class="flex items-center gap-3 flex-shrink-0">
          <span class="text-[9px] font-bold text-slate-400 uppercase">${timeAgo(r.created_at)}</span>
          ${statusBadge(r.status)}
          ${canAct ? `
            <button class="bg-primary px-4 py-2 text-xs font-bold text-white rounded-lg hover:bg-primary-container transition-colors" data-action="approve" data-id="${r.id}">Approve</button>
            <button class="text-slate-400 hover:text-error text-xs font-bold transition-colors px-3 py-2 hover:bg-red-50 rounded-lg" data-action="reject" data-id="${r.id}">Reject</button>
          ` : ''}
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('button[data-action="approve"]').forEach(btn => {
    btn.addEventListener('click', () => updateRequest(btn.dataset.id, 'approved'));
  });
  container.querySelectorAll('button[data-action="reject"]').forEach(btn => {
    btn.addEventListener('click', () => updateRequest(btn.dataset.id, 'rejected'));
  });
}

function renderDashRequests(requests) {
  const feed = document.getElementById('dashRequestsFeed');
  if (!feed) return;

  if (requests.length === 0) {
    feed.innerHTML = '<p class="text-sm text-slate-400 text-center py-8">No pending requests</p>';
    return;
  }

  feed.innerHTML = requests.map(r => {
    const initials = (r.user_name || 'U').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    return `
      <div class="flex gap-4 group">
        <div class="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">${initials}</div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-bold text-primary">${r.user_name}</p>
          <p class="text-xs text-slate-500 italic truncate">"${r.book_name}"</p>
          <div class="flex items-center gap-2 mt-2">
            <button class="bg-primary px-3 py-1 text-[10px] font-bold text-white rounded hover:bg-primary-container transition-colors" data-action="dash-approve" data-id="${r.id}">APPROVE</button>
            <button class="text-slate-400 hover:text-error text-[10px] font-bold transition-colors" data-action="dash-reject" data-id="${r.id}">DECLINE</button>
          </div>
        </div>
        <span class="text-[9px] font-bold text-slate-400 uppercase">${timeAgo(r.created_at)}</span>
      </div>`;
  }).join('');

  feed.querySelectorAll('button[data-action="dash-approve"]').forEach(btn => {
    btn.addEventListener('click', () => updateRequest(btn.dataset.id, 'approved'));
  });
  feed.querySelectorAll('button[data-action="dash-reject"]').forEach(btn => {
    btn.addEventListener('click', () => updateRequest(btn.dataset.id, 'rejected'));
  });
}

// Request filter buttons
document.querySelectorAll('.req-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.req-filter').forEach(b => {
      b.classList.remove('bg-primary', 'text-white');
      b.classList.add('bg-surface-container-lowest', 'text-slate-600');
    });
    btn.classList.add('bg-primary', 'text-white');
    btn.classList.remove('bg-surface-container-lowest', 'text-slate-600');
    currentFilter = btn.dataset.status;
    renderRequests(allRequests);
  });
});

async function updateRequest(id, status) {
  try {
    await api(`/api/admin/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    showToast(`Request ${status}!`, status === 'approved' ? 'success' : 'info');
    await loadAll();
  } catch (error) {
    showToast(error.message || 'Action failed', 'error');
  }
}

// ═══ ISSUED BOOKS ═══
async function loadIssued() {
  const data = await api('/api/admin/issued');
  issuedBody.innerHTML = data.issued.map(i => `
    <tr class="hover:bg-slate-50/50 transition-colors">
      <td class="px-6 py-4">
        <p class="font-semibold text-primary text-sm">${i.user_name}</p>
        <p class="text-xs text-slate-400">${i.class_name} · ${i.college}</p>
        <p class="text-xs text-slate-400">${i.email}</p>
      </td>
      <td class="px-6 py-4">
        <p class="font-semibold text-on-surface text-sm">${i.book_name}</p>
        <p class="text-xs text-slate-400 font-mono">${i.book_code}</p>
      </td>
      <td class="px-6 py-4 text-sm text-slate-600">${fmt(i.issue_date)}</td>
      <td class="px-6 py-4">
        ${i.return_date
          ? `<span class="badge badge-approved">Returned ${fmtShort(i.return_date)}</span>`
          : `<span class="badge badge-issued">Not Returned</span>`
        }
      </td>
      <td class="px-6 py-4">
        ${!i.return_date
          ? `<button class="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1" data-action="return" data-id="${i.id}">
               <span class="material-symbols-outlined text-sm">assignment_return</span> Return
             </button>`
          : '—'
        }
      </td>
    </tr>
  `).join('');

  issuedBody.querySelectorAll('button[data-action="return"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/return/${btn.dataset.id}`, { method: 'PATCH' });
        showToast('Book marked as returned!', 'success');
        await loadAll();
      } catch (error) {
        showToast(error.message || 'Return failed', 'error');
      }
    });
  });
}

// ═══ ADD BOOK ═══
bookForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(bookForm);
  const payload = {
    name: String(form.get('name') || '').trim(),
    description: String(form.get('description') || '').trim(),
    coverUrl: pendingCoverDataUrl || '',
  };

  try {
    const data = await api('/api/admin/books', { method: 'POST', body: JSON.stringify(payload) });
    bookForm.reset();
    clearCoverPreview();
    setBookMsg(`Book added: ${data.book.code}`, true);
    showToast(`New book added: ${data.book.name}`, 'success');
    await loadAll();
  } catch (error) {
    setBookMsg(error.message || 'Could not add book');
  }
});

// ═══ LOAD ALL ═══
async function loadAll() {
  await Promise.all([loadStats(), loadBooks(), loadRequests(), loadIssued(), loadStudents()]);
}

// ═══ REFRESH & LOGOUT ═══
refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span> Loading...';
  await loadAll();
  refreshBtn.disabled = false;
  refreshBtn.innerHTML = '<span class="material-symbols-outlined text-sm">refresh</span> Refresh';
  showToast('Data refreshed', 'info');
});

logoutBtn.addEventListener('click', () => {
  localStorage.clear();
  window.location.href = '/';
});

function getPanelSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch (_) {
    return {};
  }
}

function setSettingsMsg(text, ok = true) {
  if (!settingsMsg) return;
  settingsMsg.className = `mt-2 rounded-lg px-3 py-2 text-sm font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`;
  settingsMsg.textContent = text;
}

function applyPanelSettings() {
  const s = getPanelSettings();
  if (settingRefreshSec) settingRefreshSec.value = s.refreshSec ?? 0;
  if (settingDefaultFilter) settingDefaultFilter.value = s.defaultFilter ?? 'pending';
  currentFilter = s.defaultFilter ?? 'pending';

  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  const sec = Number(s.refreshSec || 0);
  if (sec > 0) {
    autoRefreshTimer = setInterval(() => loadAll(), sec * 1000);
  }

  // Sync filter button style
  document.querySelectorAll('.req-filter').forEach((btn) => {
    const match = (btn.dataset.status || '') === currentFilter;
    btn.classList.toggle('bg-primary', match);
    btn.classList.toggle('text-white', match);
    btn.classList.toggle('bg-surface-container-lowest', !match);
    btn.classList.toggle('text-slate-600', !match);
  });
}

saveSettingsBtn?.addEventListener('click', () => {
  const refreshSec = Math.max(0, Number(settingRefreshSec?.value || 0));
  const defaultFilter = settingDefaultFilter?.value ?? 'pending';
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ refreshSec, defaultFilter }));
  applyPanelSettings();
  loadRequests();
  setSettingsMsg('Settings saved successfully.', true);
});

resetSettingsBtn?.addEventListener('click', () => {
  localStorage.removeItem(SETTINGS_KEY);
  applyPanelSettings();
  loadRequests();
  setSettingsMsg('Settings reset to defaults.', true);
});

// ═══ SOCKET.IO ═══
const socket = io({ auth: { token } });

socket.on('request:new', async () => {
  showToast('New book request received!', 'info');
  await loadAll();
});

socket.on('request:updated', async () => {
  await loadAll();
});

socket.on('book:created', async () => {
  await loadAll();
});

socket.on('book:returned', async () => {
  await loadAll();
});

// ═══ INIT ═══
(async function init() {
  try {
    applyPanelSettings();
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
