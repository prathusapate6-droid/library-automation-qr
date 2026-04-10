import { Platform } from 'react-native';
import Constants from 'expo-constants';

function inferExpoHostBase() {
  // ⚠️ UPDATE THIS URL if deploying on a new Render account
  return 'https://smart-library-b7ue.onrender.com';
}

// ⚠️ IMPORTANT: Change this URL to your new Render deployment URL
// Example: 'https://your-app-name.onrender.com'
const API_BASE = 'https://smart-library-b7ue.onrender.com';

async function request(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export const apiBase = API_BASE;

export const api = {
  request,
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
  books: (token) => request('/api/books', { token }),
  createRequest: (token, bookCode) => request('/api/requests', { method: 'POST', token, body: { bookCode } }),
  myRequests: (token) => request('/api/requests/my', { token }),
  myIssued: (token) => request('/api/issued/my', { token }),
  addBook: (token, payload) => request('/api/admin/books', { method: 'POST', token, body: payload }),
  adminRequests: (token) => request('/api/admin/requests', { token }),
  updateRequest: (token, id, status) => request(`/api/admin/requests/${id}`, { method: 'PATCH', token, body: { status } }),
  adminIssued: (token) => request('/api/admin/issued', { token }),
};
