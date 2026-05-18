/**
 * Centralized config untuk wa-blast-service.
 *
 * Semua nilai dibaca dari env variable. Override lewat shell export atau
 * `environment:` di docker-compose.yml. Lihat README → "Environment Variables"
 * utk daftar lengkap & default.
 *
 * Cara pakai dari modul lain:
 *   const config = require('./config');
 *   app.listen(config.server.port, config.server.host);
 */

const path = require('path');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function envStr(key, fallback) {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

// envInt yg treat 0 sbg "disabled" → return undefined
function envIntOrUndefined(key, fallback) {
  const v = envInt(key, fallback);
  return v && v > 0 ? v : undefined;
}

// ─── Config Object ───────────────────────────────────────────────────────────

const config = {
  // ─── HTTP Server ─────────────────────────────────────────
  server: {
    port: envInt('WA_BLAST_PORT', 3010),
    host: envStr('WA_BLAST_HOST', '0.0.0.0'),
    /** body limit untuk JSON requests (mis. /blast dengan recipients besar) */
    jsonBodyLimit: envStr('WA_BLAST_JSON_BODY_LIMIT', '5mb'),
    /** max file upload size dalam MB (utk /parse-file & /blast-upload) */
    uploadMaxSizeMB: envInt('WA_BLAST_UPLOAD_MAX_MB', 10),
    /** CORS allowed origin. '*' = allow all. Bisa comma-separated. */
    corsOrigin: envStr('WA_BLAST_CORS_ORIGIN', '*'),
  },

  // ─── WhatsApp / Baileys Client ───────────────────────────
  wa: {
    /** path folder utk simpan session keys (auth_info_baileys) */
    authDir: envStr('WA_AUTH_DIR', path.resolve(__dirname, '..', 'auth_info_baileys')),
    /** auto-connect saat startup (false = manual via tombol / POST /connect) */
    autoConnect: envBool('WA_BLAST_AUTOCONNECT', false),
    /** browser fingerprint — jangan pakai nama custom, WA sering tolak (→ Connection Failure 401) */
    browserName: envStr('WA_BROWSER_NAME', ''),
    browserClient: envStr('WA_BROWSER_CLIENT', 'Chrome'),
    browserVersion: envStr('WA_BROWSER_VERSION', '22.04.4'),
    /** pin WA Web version, format: "2,3000,1035194821" — kosong = fetch latest */
    webVersion: (() => {
      const raw = envStr('WA_WEB_VERSION', '');
      if (!raw) return null;
      const parts = raw.split(',').map((s) => parseInt(s.trim(), 10));
      return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? parts : null;
    })(),
    /** timeout connect awal (ms) */
    connectTimeoutMs: envInt('WA_CONNECT_TIMEOUT_MS', 60_000),
    /** interval keepalive ping (ms) — kalau idle terlalu lama WA disconnect */
    keepAliveIntervalMs: envInt('WA_KEEPALIVE_INTERVAL_MS', 30_000),
    /** delay sebelum auto-reconnect setelah disconnect (ms) */
    reconnectDelayMs: envInt('WA_RECONNECT_DELAY_MS', 3000),
    /** default query timeout. 0/empty = disabled (recommended, hindari error "Timed Out" di init queries) */
    defaultQueryTimeoutMs: envIntOrUndefined('WA_DEFAULT_QUERY_TIMEOUT_MS', 0),
    /** sync seluruh history saat first connect (false utk service kirim-only, lebih ringan) */
    syncFullHistory: envBool('WA_SYNC_FULL_HISTORY', false),
    /** tandai online ke kontak saat connect (false = stealth, kontak gak tau kita online) */
    markOnlineOnConnect: envBool('WA_MARK_ONLINE_ON_CONNECT', false),
    /** cetak QR ASCII di terminal (dev). Production default false. */
    printQrInTerminal: envBool(
      'WA_PRINT_QR_TERMINAL',
      process.env.NODE_ENV !== 'production',
    ),
    /** auto-logout kalau idle (tanpa job running) */
    idleDisconnect: {
      enabled: envBool('WA_IDLE_DISCONNECT_ENABLED', true),
      checkIntervalMs: envInt('WA_IDLE_CHECK_INTERVAL_MS', 15 * 60 * 1000),
      /** setelah blast selesai / tidak ada aktivitas, logout setelah N jam (default 24 jam) */
      afterBlastIdleHours: envInt('WA_IDLE_AFTER_BLAST_HOURS', 24),
      /** maksimal tetap connect tanpa aktivitas (0 = nonaktifkan, hanya pakai afterBlastIdleHours) */
      maxConnectedDays: envInt('WA_MAX_CONNECTED_DAYS', 4),
    },
  },

  // ─── Jobs / History ──────────────────────────────────────
  jobs: {
    /** max job yg disimpan di memory. Default 100 (older dibuang FIFO). */
    maxHistory: envInt('WA_JOBS_MAX_HISTORY', 100),
    /** default limit utk endpoint GET /api/wa/jobs */
    defaultListLimit: envInt('WA_JOBS_DEFAULT_LIST_LIMIT', 20),
  },

  // ─── Rate Limit Defaults ────────────────────────────────
  // Nilai yg dipakai kalau client gak pass `rateLimit` di /blast body.
  // Frontend juga fetch ini via /rate-limit-defaults utk fill default UI.
  rateLimit: {
    messagesPerHour: envInt('WA_RL_MESSAGES_PER_HOUR', 50),
    dailyLimit: envInt('WA_RL_DAILY_LIMIT', 500),
    activeHoursStart: envInt('WA_RL_ACTIVE_HOURS_START', 8),
    activeHoursEnd: envInt('WA_RL_ACTIVE_HOURS_END', 21),
    timezone: envStr('WA_RL_TIMEZONE', 'Asia/Jakarta'),
    randomJitter: envFloat('WA_RL_RANDOM_JITTER', 0.3),
    longPauseEvery: envInt('WA_RL_LONG_PAUSE_EVERY', 30),
    longPauseMinMinutes: envInt('WA_RL_LONG_PAUSE_MIN_MINUTES', 3),
    longPauseMaxMinutes: envInt('WA_RL_LONG_PAUSE_MAX_MINUTES', 8),
  },

  // ─── Logging ─────────────────────────────────────────────
  log: {
    /** pino level: trace | debug | info | warn | error | fatal */
    level: envStr('PINO_LEVEL', 'warn'),
    /** pretty-print logs (lebih readable, lebih lambat) — pakai utk dev */
    pretty: envBool('LOG_PRETTY', false),
  },
};

// Validasi minimal — tambahkan check kalau ada nilai gak masuk akal
if (config.rateLimit.activeHoursStart < 0 || config.rateLimit.activeHoursStart > 23) {
  console.warn(`[config] WA_RL_ACTIVE_HOURS_START invalid (${config.rateLimit.activeHoursStart}), reset ke 8`);
  config.rateLimit.activeHoursStart = 8;
}
if (config.rateLimit.activeHoursEnd <= config.rateLimit.activeHoursStart || config.rateLimit.activeHoursEnd > 24) {
  console.warn(`[config] WA_RL_ACTIVE_HOURS_END invalid (${config.rateLimit.activeHoursEnd}), reset ke 21`);
  config.rateLimit.activeHoursEnd = 21;
}

// Pretty print summary saat startup (debug membantu kalau env-nya gak terbaca)
function printSummary() {
  const safeJson = JSON.stringify(config, null, 2);
  console.log('[config] Loaded:');
  console.log(safeJson);
}

config.printSummary = printSummary;

module.exports = config;
