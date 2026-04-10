/* ═══════════════════════════════════════════════════════════
   Smart Library — Student Mobile App (Expo)
   QR-Based Smart Library System
   ═══════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Vibration,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  StatusBar as RNStatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { io } from 'socket.io-client';
import { api, apiBase } from './src/api';
import { colors } from './src/theme';

// Safe area top offset — clears status bar & notch on all devices
const STATUS_BAR_HEIGHT = Platform.OS === 'android'
  ? (RNStatusBar.currentHeight || 24)
  : 0; // iOS: SafeAreaView handles it
// Bottom offset — clears Android gesture/3-button navigation bar (typically 48-72px)
const NAV_BAR_HEIGHT = Platform.OS === 'android' ? 80 : 34;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const STORAGE_KEY = 'library_session_v1';

/* ═══ SHARED COMPONENTS ═══ */

function Icon({ name, size = 24, color = colors.primary, filled = false }) {
  /* Simple placeholder for Material Symbols - using emoji/text fallbacks */
  const iconMap = {
    home: '🏠', books: '📚', qr: '📷', history: '📋', person: '👤',
    scan: '📱', send: '➤', logout: '🚪', refresh: '🔄', back: '←',
    check: '✓', close: '✕', arrow: '→', book: '📖', clock: '⏰',
    star: '⭐', info: 'ℹ️', warning: '⚠️', error: '❌', success: '✅',
  };
  return <Text style={{ fontSize: size, color }}>{iconMap[name] || '•'}</Text>;
}

function Toast({ message, type, visible }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(60)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 60, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!message) return null;

  const bgMap = { success: '#dcfce7', error: '#fee2e2', info: '#eff6ff' };
  const fgMap = { success: '#166534', error: '#991b1b', info: '#1e40af' };

  return (
    <Animated.View style={[styles.toast, { opacity, transform: [{ translateY }], backgroundColor: bgMap[type] || bgMap.info }]}>
      <Text style={[styles.toastText, { color: fgMap[type] || fgMap.info }]}>{message}</Text>
    </Animated.View>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending: { bg: '#fef3c7', fg: '#92400e' },
    approved: { bg: '#dcfce7', fg: '#166534' },
    rejected: { bg: '#fee2e2', fg: '#991b1b' },
    available: { bg: colors.primaryFixed || '#d6e3ff', fg: colors.primary },
    issued: { bg: '#fff3e0', fg: '#e65100' },
    active: { bg: '#fff3e0', fg: '#e65100' },
    returned: { bg: '#dcfce7', fg: '#166534' },
  };
  const s = String(status || '').toLowerCase();
  const { bg, fg } = map[s] || { bg: '#eceef0', fg: '#43474e' };
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{s.toUpperCase()}</Text>
    </View>
  );
}

function SectionTitle({ title, right }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </View>
  );
}

function EmptyState({ icon, title, subtitle }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>{icon || '📚'}</Text>
      <Text style={styles.emptyTitle}>{title || 'Nothing here yet'}</Text>
      {subtitle && <Text style={styles.emptySub}>{subtitle}</Text>}
    </View>
  );
}

function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/* ═══ AUTH SCREEN ═══ */

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState({ message: '', type: 'info', visible: false });
  const [form, setForm] = useState({ name: '', className: '', college: '', email: '', password: '' });
  const isRegister = mode === 'register';

  const showToast = (message, type = 'info') => {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 3000);
  };

  const submit = async () => {
    try {
      setLoading(true);
      const payload = isRegister
        ? { name: form.name.trim(), className: form.className.trim(), college: form.college.trim(), email: form.email.trim(), password: form.password }
        : { email: form.email.trim(), password: form.password };
      const data = isRegister ? await api.register(payload) : await api.login(payload);
      
      if (data.user?.role === 'admin') {
        showToast('Admin panel is on the web. Use browser at http://server-ip:3000', 'error');
        setLoading(false);
        return;
      }
      onAuthenticated(data);
    } catch (error) {
      showToast(error.message || 'Authentication failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { paddingTop: STATUS_BAR_HEIGHT }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}>
        <ScrollView contentContainerStyle={styles.authContainer} keyboardShouldPersistTaps="handled">
          {/* Hero */}
          <View style={styles.authHero}>
            <Text style={styles.authHeroTitle}>Smart{'\n'}Library</Text>
            <Text style={styles.authHeroSubtitle}>QR-based library automation</Text>
            <View style={styles.authHeroDivider} />
            <Text style={styles.authHeroSmall}>SCAN · REQUEST · TRACK</Text>
          </View>

          {/* Auth Card */}
          <Card style={styles.authCard}>
            {/* Tab Switch */}
            <View style={styles.authTabs}>
              <Pressable onPress={() => setMode('login')} style={[styles.authTab, mode === 'login' && styles.authTabActive]}>
                <Text style={[styles.authTabText, mode === 'login' && styles.authTabTextActive]}>Login</Text>
              </Pressable>
              <Pressable onPress={() => setMode('register')} style={[styles.authTab, mode === 'register' && styles.authTabActive]}>
                <Text style={[styles.authTabText, mode === 'register' && styles.authTabTextActive]}>Register</Text>
              </Pressable>
            </View>

            {isRegister && (
              <>
                <View>
                  <Text style={styles.inputLabel}>FULL NAME</Text>
                  <TextInput style={styles.input} placeholder="Enter your full name" placeholderTextColor="#a0a8b4" value={form.name} onChangeText={v => setForm(p => ({ ...p, name: v }))} />
                </View>
                <View style={styles.rowGap}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>CLASS / DEPT</Text>
                    <TextInput style={styles.input} placeholder="e.g. ME-VLSI" placeholderTextColor="#a0a8b4" value={form.className} onChangeText={v => setForm(p => ({ ...p, className: v }))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>COLLEGE</Text>
                    <TextInput style={styles.input} placeholder="e.g. GKCE" placeholderTextColor="#a0a8b4" value={form.college} onChangeText={v => setForm(p => ({ ...p, college: v }))} />
                  </View>
                </View>
              </>
            )}

            <View>
              <Text style={styles.inputLabel}>EMAIL</Text>
              <TextInput style={styles.input} placeholder="your@email.com" placeholderTextColor="#a0a8b4" autoCapitalize="none" keyboardType="email-address" value={form.email} onChangeText={v => setForm(p => ({ ...p, email: v }))} />
            </View>
            <View>
              <Text style={styles.inputLabel}>PASSWORD</Text>
              <View style={styles.passwordWrap}>
                <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="Min 4 characters" placeholderTextColor="#a0a8b4" secureTextEntry={!showPassword} value={form.password} onChangeText={v => setForm(p => ({ ...p, password: v }))} />
                <Pressable onPress={() => setShowPassword(p => !p)} style={styles.eyeBtn}>
                  <Text style={styles.eyeBtnText}>{showPassword ? 'HIDE' : 'SHOW'}</Text>
                </Pressable>
              </View>
            </View>

            <Pressable onPress={submit} disabled={loading} style={({ pressed }) => [styles.primaryBtn, (pressed || loading) && { opacity: 0.8 }]}>
              {loading ? <ActivityIndicator color="#fff" size="small" /> : (
                <Text style={styles.primaryBtnText}>{isRegister ? 'Register →' : 'Login →'}</Text>
              )}
            </Pressable>

            <Text style={styles.authSwitch}>
              {isRegister ? 'Already have an account? ' : 'New to the library? '}
              <Text style={styles.authSwitchLink} onPress={() => setMode(isRegister ? 'login' : 'register')}>
                {isRegister ? 'Login' : 'Register'}
              </Text>
            </Text>

            <View style={styles.apiHintBox}>
              <Text style={styles.apiHintText}>Server: {apiBase}</Text>
            </View>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
      <Toast {...toast} />
    </SafeAreaView>
  );
}

/* ═══ MAIN STUDENT APP ═══ */

function StudentApp({ session, onLogout }) {
  const [activeTab, setActiveTab] = useState('home');
  const [books, setBooks] = useState([]);
  const [requests, setRequests] = useState([]);
  const [issued, setIssued] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const [toast, setToast] = useState({ message: '', type: 'info', visible: false });
  const [zoom, setZoom] = useState(0);
  const [lastScanned, setLastScanned] = useState(null);
  const [scanCount, setScanCount] = useState(0);
  const scanLocked = useRef(false);
  const scanCooldown = useRef(false);

  const showToast = (message, type = 'info') => {
    setToast({ message, type, visible: true });
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 3500);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [b, r, i] = await Promise.all([
        api.books(session.token),
        api.myRequests(session.token),
        api.myIssued(session.token),
      ]);
      setBooks(b.books || []);
      setRequests(r.requests || []);
      setIssued(i.issued || []);
    } catch (error) {
      showToast(error.message || 'Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  }, [session.token]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Socket.IO real-time
  useEffect(() => {
    const socket = io(apiBase, { auth: { token: session.token } });
    socket.on('request:updated', (data) => {
      if (data?.status === 'approved') showToast('Your book request was approved! 🎉', 'success');
      else if (data?.status === 'rejected') showToast('Your book request was rejected.', 'error');
      loadAll();
    });
    return () => socket.disconnect();
  }, [session.token, loadAll]);

  const sendRequest = async (code) => {
    if (!code?.trim()) { showToast('Book code is required', 'error'); return; }
    try {
      const data = await api.createRequest(session.token, code.trim());
      showToast(`Request sent for "${data.request?.book_name || code}"`, 'success');
      setManualCode('');
      await loadAll();
    } catch (error) {
      showToast(error.message || 'Request failed', 'error');
    }
  };

  const startScanner = async () => {
    if (!permission?.granted) {
      const response = await requestPermission();
      if (!response.granted) { showToast('Camera permission required', 'error'); return; }
    }
    scanLocked.current = false;
    scanCooldown.current = false;
    setLastScanned(null);
    setZoom(0);
    setScannerOpen(true);
  };

  const onScanned = async ({ data }) => {
    if (!data || scanCooldown.current) return;
    // Prevent rapid duplicate scans — 3 second cooldown
    scanCooldown.current = true;
    const code = String(data).trim();
    setLastScanned(code);
    setScanCount(c => c + 1);
    // Vibrate on successful scan
    try { Vibration.vibrate(200); } catch (_) {}
    // Send request but DON'T close camera
    await sendRequest(code);
    // Allow re-scan after 3 seconds
    setTimeout(() => { scanCooldown.current = false; }, 3000);
  };

  const closeScanner = () => {
    setScannerOpen(false);
    setLastScanned(null);
    scanCooldown.current = false;
  };

  const activeBorrows = useMemo(() => issued.filter(i => !i.return_date), [issued]);
  const totalBorrows = issued.length;

  const fmtDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  /* ── HOME TAB ── */
  const renderHome = () => (
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* Welcome */}
      <View style={styles.welcomeSection}>
        <Text style={styles.welcomeText}>Welcome back,</Text>
        <Text style={styles.welcomeName}>{session.user.name || 'Student'}</Text>
        <Text style={styles.welcomeSub}>
          {activeBorrows.length > 0
            ? `You have ${activeBorrows.length} active book${activeBorrows.length > 1 ? 's' : ''} from the archive.`
            : 'Scan a QR code to request your first book!'}
        </Text>
      </View>

      {/* Stats */}
      <Card style={styles.statCard}>
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{totalBorrows}</Text>
          <Text style={styles.statLabel}>TOTAL BORROWS</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{activeBorrows.length}</Text>
          <Text style={styles.statLabel}>ACTIVE NOW</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{requests.filter(r => r.status === 'pending').length}</Text>
          <Text style={styles.statLabel}>PENDING</Text>
        </View>
      </Card>

      {/* QR Scan Hero */}
      <Pressable onPress={() => { setActiveTab('scan'); startScanner(); }} style={({ pressed }) => [styles.scanHero, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]}>
        <View style={styles.scanHeroIcon}>
          <Text style={{ fontSize: 36 }}>📷</Text>
        </View>
        <Text style={styles.scanHeroTitle}>Scan QR to Issue Book</Text>
        <Text style={styles.scanHeroSub}>INSTANT ARCHIVAL RETRIEVAL</Text>
      </Pressable>

      {/* Currently Issued */}
      <SectionTitle
        title="Currently Issued"
        right={activeBorrows.length > 0 && <Pressable onPress={() => setActiveTab('history')}><Text style={styles.sectionLink}>View All →</Text></Pressable>}
      />

      {activeBorrows.length === 0 ? (
        <EmptyState icon="📖" title="No active books" subtitle="Scan a QR code to request a book" />
      ) : (
        activeBorrows.map(item => (
          <Card key={item.id} style={styles.bookCard}>
            <View style={styles.bookCardTop}>
              <View style={styles.bookIcon}>
                <Text style={{ fontSize: 28 }}>📖</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bookCardTitle}>{item.book_name}</Text>
                <Text style={styles.bookCardCode}>{item.book_code}</Text>
                <StatusBadge status="active" />
              </View>
            </View>
            <View style={styles.bookCardFooter}>
              <View>
                <Text style={styles.bookCardFooterLabel}>ISSUE DATE</Text>
                <Text style={styles.bookCardFooterValue}>{fmtDate(item.issue_date)}</Text>
              </View>
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );

  /* ── BOOKS TAB ── */
  const renderBooks = () => (
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.pageTitle}>Available Books</Text>
      <Text style={styles.pageSub}>Browse all books in the library collection.</Text>

      {loading && books.length === 0 ? (
        <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 40 }} />
      ) : books.length === 0 ? (
        <EmptyState icon="📚" title="No books in catalog" subtitle="The librarian hasn't added any books yet" />
      ) : (
        books.map(b => (
          <Card key={b.id} style={styles.bookListItem}>
            <View style={styles.bookListRow}>
              {/* Cover image or fallback */}
              {b.cover_url ? (
                <Image
                  source={{ uri: b.cover_url }}
                  style={styles.bookCoverImg}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.bookCoverPlaceholder}>
                  <Text style={{ fontSize: 28 }}>📖</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.bookListName}>{b.name}</Text>
                <Text style={styles.bookListCode}>{b.code}</Text>
                {b.description ? <Text style={styles.bookListDesc}>{b.description}</Text> : null}
              </View>
              <StatusBadge status={b.available ? 'available' : 'issued'} />
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );

  /* ── SCAN TAB ── */
  const renderScan = () => (
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.pageTitle}>Scan QR Code</Text>
      <Text style={styles.pageSub}>Point your camera at the book's QR code, or enter the code manually.</Text>

      <Card style={{ gap: 12 }}>
        <View style={styles.scanPreview}>
          <Text style={{ fontSize: 48, opacity: 0.3 }}>📷</Text>
          <Text style={styles.scanPreviewText}>Camera preview will open in fullscreen</Text>
        </View>

        <View style={styles.scanBtnRow}>
          <Pressable onPress={startScanner} style={({ pressed }) => [styles.primaryBtn, { flex: 1 }, pressed && { opacity: 0.8 }]}>
            <Text style={styles.primaryBtnText}>📷 Open Scanner</Text>
          </Pressable>
        </View>
      </Card>

      {/* Manual Entry */}
      <Card style={{ gap: 10 }}>
        <Text style={styles.inputLabel}>MANUAL BOOK CODE</Text>
        <TextInput
          style={styles.input}
          placeholder="LIB_BOOK_0001"
          placeholderTextColor="#a0a8b4"
          value={manualCode}
          onChangeText={setManualCode}
          autoCapitalize="characters"
          onSubmitEditing={() => sendRequest(manualCode)}
        />
        <Pressable onPress={() => sendRequest(manualCode)} style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.8 }]}>
          <Text style={styles.secondaryBtnText}>➤ Send Request</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );

  /* ── HISTORY TAB ── */
  const renderHistory = () => (
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* My Requests */}
      <SectionTitle title="My Requests" />
      {requests.length === 0 ? (
        <EmptyState icon="📋" title="No requests yet" subtitle="Scan a QR code to send your first request" />
      ) : (
        requests.map(r => (
          <Card key={r.id} style={styles.requestItem}>
            <View style={styles.requestRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.requestTitle}>#{r.id} · {r.book_name}</Text>
                <Text style={styles.requestCode}>{r.book_code}</Text>
                <Text style={styles.requestDate}>{fmt(r.created_at)}</Text>
              </View>
              <StatusBadge status={r.status} />
            </View>
          </Card>
        ))
      )}

      {/* Issue History */}
      <SectionTitle title="Issue History" />
      {issued.length === 0 ? (
        <EmptyState icon="📖" title="No history" subtitle="Your issued books will appear here" />
      ) : (
        issued.map(i => (
          <Card key={i.id} style={styles.requestItem}>
            <View style={styles.requestRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.requestTitle}>{i.book_name}</Text>
                <Text style={styles.requestCode}>{i.book_code}</Text>
                <Text style={styles.requestDate}>Issued: {fmtDate(i.issue_date)}</Text>
              </View>
              <StatusBadge status={i.return_date ? 'returned' : 'active'} />
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );

  /* ── ACCOUNT TAB ── */
  const renderAccount = () => (
    <ScrollView contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.pageTitle}>My Account</Text>

      <Card style={{ gap: 16 }}>
        {/* Avatar + Name */}
        <View style={styles.profileHeader}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>
              {(session.user.name || 'S').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.profileName}>{session.user.name || '—'}</Text>
            <Text style={styles.profileEmail}>{session.user.email || '—'}</Text>
          </View>
        </View>

        {/* Details */}
        <View style={styles.profileGrid}>
          <View style={styles.profileDetail}>
            <Text style={styles.profileDetailLabel}>CLASS / DEPARTMENT</Text>
            <Text style={styles.profileDetailValue}>{session.user.class_name || '—'}</Text>
          </View>
          <View style={styles.profileDetail}>
            <Text style={styles.profileDetailLabel}>COLLEGE</Text>
            <Text style={styles.profileDetailValue}>{session.user.college || '—'}</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.profileStats}>
          <View style={styles.profileStatItem}>
            <Text style={styles.profileStatNum}>{totalBorrows}</Text>
            <Text style={styles.profileStatLabel}>Total Borrows</Text>
          </View>
          <View style={styles.profileStatItem}>
            <Text style={styles.profileStatNum}>{activeBorrows.length}</Text>
            <Text style={styles.profileStatLabel}>Active Books</Text>
          </View>
          <View style={styles.profileStatItem}>
            <Text style={styles.profileStatNum}>{requests.length}</Text>
            <Text style={styles.profileStatLabel}>Requests</Text>
          </View>
        </View>

        {/* Server Info */}
        <View style={styles.serverInfo}>
          <Text style={styles.serverInfoText}>Connected to: {apiBase}</Text>
        </View>

        {/* Logout */}
        <Pressable onPress={() => {
          Alert.alert('Logout', 'Are you sure you want to logout?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Logout', style: 'destructive', onPress: onLogout },
          ]);
        }} style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.8 }]}>
          <Text style={styles.logoutBtnText}>🚪 Logout</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );

  /* ── RENDER ACTIVE TAB ── */
  const renderTab = () => {
    switch (activeTab) {
      case 'home': return renderHome();
      case 'books': return renderBooks();
      case 'scan': return renderScan();
      case 'history': return renderHistory();
      case 'account': return renderAccount();
      default: return renderHome();
    }
  };

  return (
    <View style={[styles.safe, { paddingTop: STATUS_BAR_HEIGHT }]}>
      <StatusBar style="dark" />

      {/* Top Header */}
      <View style={styles.topHeader}>
        <View style={styles.topHeaderLeft}>
          <View style={styles.headerAvatar}>
            <Text style={styles.headerAvatarText}>
              {(session.user.name || 'S').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.topHeaderTitle}>Smart Library</Text>
        </View>
        <Pressable onPress={loadAll} style={({ pressed }) => [styles.refreshBtn, pressed && { opacity: 0.6 }]}>
          <Text style={{ fontSize: 18 }}>🔄</Text>
        </Pressable>
      </View>

      {/* Tab Content */}
      <View style={{ flex: 1 }}>{renderTab()}</View>

      {/* Bottom Navigation — sits above system nav/gesture bar */}
      <View style={[styles.bottomNav, { paddingBottom: NAV_BAR_HEIGHT }]}>
        {[
          { key: 'home', label: 'Home', icon: '🏠' },
          { key: 'books', label: 'Books', icon: '📚' },
          { key: 'scan', label: '', icon: '📷', center: true },
          { key: 'history', label: 'History', icon: '📋' },
          { key: 'account', label: 'Account', icon: '👤' },
        ].map(tab =>
          tab.center ? (
            <Pressable key={tab.key} onPress={() => { setActiveTab('scan'); startScanner(); }} style={({ pressed }) => [styles.bottomNavCenter, pressed && { transform: [{ scale: 0.95 }] }]}>
              <Text style={{ fontSize: 26, color: '#fff' }}>📷</Text>
            </Pressable>
          ) : (
            <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} style={styles.bottomNavItem}>
              <Text style={[styles.bottomNavIcon, activeTab === tab.key && styles.bottomNavIconActive]}>{tab.icon}</Text>
              <Text style={[styles.bottomNavLabel, activeTab === tab.key && styles.bottomNavLabelActive]}>{tab.label}</Text>
              {activeTab === tab.key && <View style={styles.bottomNavDot} />}
            </Pressable>
          )
        )}
      </View>

      {/* QR Scanner Modal */}
      <Modal visible={scannerOpen} animationType="slide" onRequestClose={closeScanner}>
        <SafeAreaView style={styles.scannerModal}>
          <View style={styles.scannerHeader}>
            <View>
              <Text style={styles.scannerTitle}>Scan Book QR</Text>
              {scanCount > 0 && <Text style={{ color: '#8aa8d0', fontSize: 11 }}>{scanCount} scanned this session</Text>}
            </View>
            <Pressable onPress={closeScanner} style={styles.scannerClose}>
              <Text style={styles.scannerCloseText}>✕ Close</Text>
            </Pressable>
          </View>

          {/* Last Scanned Result */}
          {lastScanned && (
            <View style={styles.scanResult}>
              <Text style={styles.scanResultIcon}>✅</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.scanResultText}>Scanned: {lastScanned}</Text>
                <Text style={styles.scanResultHint}>Camera stays open — scan another book or close</Text>
              </View>
            </View>
          )}

          <Text style={styles.scannerHint}>
            {lastScanned ? 'Ready to scan another QR code...' : 'Point camera at the book\'s QR code'}
          </Text>

          <View style={styles.cameraWrapper}>
            <CameraView
              onBarcodeScanned={onScanned}
              style={StyleSheet.absoluteFill}
              zoom={zoom}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            />
            {/* Scan overlay */}
            <View style={styles.scanOverlay}>
              <View style={styles.scanCornerTL} />
              <View style={styles.scanCornerTR} />
              <View style={styles.scanCornerBL} />
              <View style={styles.scanCornerBR} />
            </View>
          </View>

          {/* Zoom Control */}
          <View style={styles.zoomControl}>
            <Text style={styles.zoomLabel}>🔍 Zoom</Text>
            <View style={styles.zoomSlider}>
              {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map(z => (
                <Pressable key={z} onPress={() => setZoom(z)} style={[styles.zoomDot, zoom === z && styles.zoomDotActive]}>
                  <Text style={[styles.zoomDotText, zoom === z && styles.zoomDotTextActive]}>{z === 0 ? '1x' : `${(1 + z * 4).toFixed(1)}x`}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      <Toast {...toast} />
    </View>
  );
}

/* ═══ APP ROOT ═══ */

export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setSession(JSON.parse(raw));
      } catch (_) {} finally { setBooting(false); }
    })();
  }, []);

  const onAuthenticated = async (payload) => {
    const data = { token: payload.token, user: payload.user };
    setSession(data);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  };

  const onLogout = async () => {
    setSession(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  if (booting) {
    return (
      <View style={[styles.safe, styles.center]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 12, color: colors.muted, fontSize: 13 }}>Loading...</Text>
      </View>
    );
  }

  if (!session) {
    return <AuthScreen onAuthenticated={onAuthenticated} />;
  }

  return <StudentApp session={session} onLogout={onLogout} />;
}

/* ═══ STYLES ═══ */

const styles = StyleSheet.create({
  safe: { 
    flex: 1, 
    backgroundColor: colors.background,
    // paddingTop is now handled dynamically via useSafeAreaInsets in each screen
  },
  center: { alignItems: 'center', justifyContent: 'center' },

  /* Toast */
  toast: {
    position: 'absolute', bottom: 100, left: 20, right: 20,
    borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14,
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12,
    zIndex: 999,
  },
  toastText: { fontWeight: '700', fontSize: 14, textAlign: 'center' },

  /* Badge */
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  /* Section */
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: colors.primary },
  sectionLink: { color: '#855300', fontWeight: '700', fontSize: 13 },

  /* Empty State */
  emptyState: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyIcon: { fontSize: 40, opacity: 0.3 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.primary },
  emptySub: { fontSize: 13, color: colors.muted, textAlign: 'center' },

  /* Card */
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 10 },

  /* Auth */
  authContainer: { padding: 20, justifyContent: 'center', minHeight: '100%', gap: 16 },
  authHero: { backgroundColor: colors.primary, borderRadius: 20, padding: 28, gap: 6 },
  authHeroTitle: { color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -0.5 },
  authHeroSubtitle: { color: '#bbcde8', fontSize: 16, marginTop: 4 },
  authHeroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 10 },
  authHeroSmall: { color: '#8aa8d0', fontSize: 10, letterSpacing: 3, fontWeight: '700' },
  authCard: { padding: 20, gap: 14 },
  authTabs: { flexDirection: 'row', backgroundColor: colors.surfaceSoft, borderRadius: 12, padding: 4, marginBottom: 4 },
  authTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  authTabActive: { backgroundColor: '#fff', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
  authTabText: { color: colors.muted, fontWeight: '700', fontSize: 14 },
  authTabTextActive: { color: colors.primary },
  authSwitch: { textAlign: 'center', color: colors.muted, fontSize: 13, marginTop: 4 },
  authSwitchLink: { color: '#855300', fontWeight: '800' },
  apiHintBox: { backgroundColor: colors.surfaceSoft, borderRadius: 10, padding: 10, marginTop: 4 },
  apiHintText: { fontSize: 11, color: colors.muted, textAlign: 'center' },
  rowGap: { flexDirection: 'row', gap: 12 },

  /* Inputs */
  inputLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5, color: '#855300', marginBottom: 6, marginLeft: 2 },
  input: {
    backgroundColor: colors.surfaceLow, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
    color: colors.text, fontSize: 15,
  },

  /* Buttons */
  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  secondaryBtn: {
    backgroundColor: '#fea619', borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryBtnText: { color: '#684000', fontWeight: '800', fontSize: 14 },

  /* Top Header */
  topHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 18, paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,32,69,0.08)',
  },
  topHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primaryContainer || '#1a365d',
    alignItems: 'center', justifyContent: 'center',
  },
  headerAvatarText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  topHeaderTitle: { fontSize: 16, fontWeight: '900', color: colors.primary },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  /* Tab Content */
  tabContent: { padding: 18, paddingBottom: 40, gap: 12 },

  /* Welcome */
  welcomeSection: { gap: 4 },
  welcomeText: { fontSize: 28, fontWeight: '800', color: colors.primary },
  welcomeName: { fontSize: 32, fontWeight: '900', color: '#855300', marginBottom: 4 },
  welcomeSub: { fontSize: 14, color: colors.muted, lineHeight: 20 },

  /* Stats */
  statCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 20 },
  statItem: { flex: 1, alignItems: 'center', gap: 4 },
  statNumber: { fontSize: 28, fontWeight: '900', color: '#855300' },
  statLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 1.5, color: colors.muted },
  statDivider: { width: 1, height: 36, backgroundColor: '#eceef0' },

  /* Scan Hero */
  scanHero: {
    backgroundColor: colors.primary, borderRadius: 20, paddingVertical: 32,
    alignItems: 'center', gap: 10, overflow: 'hidden',
  },
  scanHeroIcon: {
    width: 70, height: 70, borderRadius: 35, backgroundColor: '#fea619',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  scanHeroTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  scanHeroSub: { color: '#8aa8d0', fontSize: 10, letterSpacing: 3, fontWeight: '700' },

  /* Book Cards */
  bookCard: { gap: 12 },
  bookCardTop: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  bookIcon: {
    width: 56, height: 72, borderRadius: 10,
    backgroundColor: 'rgba(0,32,69,0.05)', alignItems: 'center', justifyContent: 'center',
  },
  bookCardTitle: { fontSize: 17, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  bookCardCode: { fontSize: 12, color: colors.muted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 6 },
  bookCardFooter: {
    backgroundColor: colors.surfaceLow, borderRadius: 12, padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  bookCardFooterLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 1.5, color: colors.muted, marginBottom: 2 },
  bookCardFooterValue: { fontSize: 14, fontWeight: '800', color: colors.primary },

  /* Book List */
  bookListItem: { paddingVertical: 4 },
  bookListRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bookListName: { fontSize: 15, fontWeight: '700', color: colors.primary, marginBottom: 2 },
  bookListCode: { fontSize: 11, color: colors.muted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  bookListDesc: { fontSize: 12, color: colors.muted, marginTop: 2 },
  bookCoverImg: { width: 44, height: 60, borderRadius: 6 },
  bookCoverPlaceholder: {
    width: 44, height: 60, borderRadius: 6,
    backgroundColor: 'rgba(0,32,69,0.06)', alignItems: 'center', justifyContent: 'center',
  },

  /* Scan */
  scanPreview: {
    height: 100, borderRadius: 14, backgroundColor: colors.surfaceSoft,
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  scanPreviewText: { fontSize: 13, color: colors.muted },
  scanBtnRow: { flexDirection: 'row', gap: 10 },

  /* Requests */
  requestItem: { paddingVertical: 4 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  requestTitle: { fontSize: 14, fontWeight: '700', color: colors.primary },
  requestCode: { fontSize: 11, color: colors.muted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 2 },
  requestDate: { fontSize: 11, color: colors.muted, marginTop: 2 },

  /* Profile */
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  profileAvatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  profileAvatarText: { color: '#fff', fontWeight: '900', fontSize: 22 },
  profileName: { fontSize: 22, fontWeight: '900', color: colors.primary },
  profileEmail: { fontSize: 13, color: colors.muted, marginTop: 2 },
  profileGrid: { flexDirection: 'row', gap: 12 },
  profileDetail: { flex: 1, backgroundColor: colors.surfaceLow, borderRadius: 14, padding: 16, gap: 6 },
  profileDetailLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5, color: colors.muted },
  profileDetailValue: { fontSize: 15, fontWeight: '700', color: colors.primary },
  profileStats: { flexDirection: 'row', gap: 10 },
  profileStatItem: { flex: 1, backgroundColor: colors.surfaceLow, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4 },
  profileStatNum: { fontSize: 22, fontWeight: '900', color: '#855300' },
  profileStatLabel: { fontSize: 10, color: colors.muted, fontWeight: '600' },
  serverInfo: { backgroundColor: colors.surfaceSoft, borderRadius: 10, padding: 10 },
  serverInfoText: { fontSize: 11, color: colors.muted, textAlign: 'center' },
  logoutBtn: {
    backgroundColor: '#fee2e2', borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  logoutBtnText: { color: '#991b1b', fontWeight: '800', fontSize: 14 },

  /* Bottom Nav — paddingBottom is set dynamically via insets.bottom in JSX */
  bottomNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingTop: 10,
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 12,
    borderTopWidth: 1.5, borderColor: 'rgba(0,32,69,0.10)',
  },
  bottomNavItem: { alignItems: 'center', justifyContent: 'center', paddingVertical: 4, gap: 2 },
  bottomNavIcon: { fontSize: 22, opacity: 0.4 },
  bottomNavIconActive: { opacity: 1 },
  bottomNavLabel: { fontSize: 9, fontWeight: '700', color: colors.muted, letterSpacing: 0.5, textTransform: 'uppercase' },
  bottomNavLabelActive: { color: '#855300' },
  bottomNavDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#fea619', marginTop: 2 },
  bottomNavCenter: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#855300',
    alignItems: 'center', justifyContent: 'center', marginTop: -24,
    elevation: 8, shadowColor: '#855300', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8,
  },

  /* Scanner Modal */
  scannerModal: { flex: 1, backgroundColor: '#000' },
  scannerHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14, backgroundColor: colors.primary,
  },
  scannerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  scannerClose: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  scannerCloseText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  scannerHint: { color: '#aaa', fontSize: 13, textAlign: 'center', paddingVertical: 10 },
  cameraWrapper: { flex: 1, margin: 16, borderRadius: 20, overflow: 'hidden', backgroundColor: '#111' },

  /* Scan Overlay Corners */
  scanOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  scanCornerTL: { position: 'absolute', top: '25%', left: '15%', width: 40, height: 40, borderTopWidth: 3, borderLeftWidth: 3, borderColor: '#fea619', borderTopLeftRadius: 8 },
  scanCornerTR: { position: 'absolute', top: '25%', right: '15%', width: 40, height: 40, borderTopWidth: 3, borderRightWidth: 3, borderColor: '#fea619', borderTopRightRadius: 8 },
  scanCornerBL: { position: 'absolute', bottom: '25%', left: '15%', width: 40, height: 40, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: '#fea619', borderBottomLeftRadius: 8 },
  scanCornerBR: { position: 'absolute', bottom: '25%', right: '15%', width: 40, height: 40, borderBottomWidth: 3, borderRightWidth: 3, borderColor: '#fea619', borderBottomRightRadius: 8 },

  /* Password Toggle */
  passwordWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyeBtn: {
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
    backgroundColor: colors.surfaceSoft, alignItems: 'center', justifyContent: 'center',
  },
  eyeBtnText: { fontSize: 10, fontWeight: '900', letterSpacing: 1, color: '#855300' },

  /* Scan Result */
  scanResult: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#166534', marginHorizontal: 16, marginTop: 8,
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
  },
  scanResultIcon: { fontSize: 24 },
  scanResultText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  scanResultHint: { color: '#86efac', fontSize: 11, marginTop: 2 },

  /* Zoom Control */
  zoomControl: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#111',
  },
  zoomLabel: { color: '#aaa', fontSize: 12, fontWeight: '700' },
  zoomSlider: { flexDirection: 'row', flex: 1, gap: 6, justifyContent: 'space-around' },
  zoomDot: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: '#333',
  },
  zoomDotActive: { backgroundColor: '#fea619' },
  zoomDotText: { color: '#aaa', fontSize: 12, fontWeight: '700' },
  zoomDotTextActive: { color: '#000' },

  /* Page */
  pageTitle: { fontSize: 24, fontWeight: '900', color: colors.primary },
  pageSub: { fontSize: 13, color: colors.muted, marginBottom: 4 },
});
