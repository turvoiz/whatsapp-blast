/**
 * WA Client — Baileys-based.
 *
 * Tidak butuh Chromium/Puppeteer — Baileys connect langsung ke WhatsApp server
 * pakai WebSocket. RAM & disk footprint jauh lebih kecil dari whatsapp-web.js.
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const config = require('./config');

const AUTH_DIR = config.wa.authDir;

const logger = pino({
  level: config.log.level,
  ...(config.log.pretty
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

const state = {
  status: 'initializing',
  qrDataUrl: null,
  qrRawString: null,
  lastError: null,
  connectedSince: null,
  selfNumber: null,
  jobs: [],
};

let sock = null;
let reconnecting = false;

function getStatus() {
  return {
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    lastError: state.lastError,
    connectedSince: state.connectedSince,
    selfNumber: state.selfNumber,
    jobsCount: state.jobs.length,
  };
}

function getJob(id) {
  return state.jobs.find((j) => j.id === id) || null;
}

function listJobs(limit = config.jobs.defaultListLimit) {
  return state.jobs.slice(-limit).reverse();
}

function pushJob(job) {
  state.jobs.push(job);
  // FIFO trim: keep only N latest
  const max = config.jobs.maxHistory;
  if (max > 0 && state.jobs.length > max) {
    state.jobs.splice(0, state.jobs.length - max);
  }
}

function formatJid(raw) {
  let n = String(raw || '').replace(/\D/g, '');
  if (!n) return null;
  if (n.startsWith('0')) n = '62' + n.slice(1);
  if (!n.startsWith('62')) n = '62' + n;
  return `${n}@s.whatsapp.net`;
}

function renderTemplate(template, data) {
  if (!template) return '';
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const val = data[key];
    return val == null ? '' : String(val);
  });
}

async function initClient() {
  if (sock) {
    return;
  }

  state.status = 'initializing';
  state.lastError = null;

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined, isLatest: false }));
  console.log(`[wa] Baileys WA Web version: ${version ? version.join('.') : 'default'} (isLatest=${isLatest})`);

  sock = makeWASocket({
    version,
    auth: authState,
    logger,
    printQRInTerminal: false,
    browser: [config.wa.browserName, config.wa.browserClient, config.wa.browserVersion],
    syncFullHistory: config.wa.syncFullHistory,
    markOnlineOnConnect: config.wa.markOnlineOnConnect,
    // Default-nya 60s utk init queries (fetchProps, dll). Error "Timed Out"
    // di init queries non-fatal utk send message, tapi bikin log berisik.
    // config.wa.defaultQueryTimeoutMs = undefined = no timeout (recommended).
    defaultQueryTimeoutMs: config.wa.defaultQueryTimeoutMs,
    connectTimeoutMs: config.wa.connectTimeoutMs,
    keepAliveIntervalMs: config.wa.keepAliveIntervalMs,
    // Stub: Baileys minta getMessage utk re-deliver pesan retry. Karena
    // service ini one-way (kirim, gak terima/re-send), return undefined.
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      state.qrRawString = qr;
      try {
        state.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, scale: 6 });
      } catch (err) {
        state.qrDataUrl = null;
      }
      state.status = 'qr_required';
      console.log('[wa] QR code dibuat — scan dari WA HP (Linked Devices)');
    }

    if (connection === 'connecting') {
      if (state.status !== 'qr_required') {
        state.status = 'authenticating';
      }
      console.log('[wa] Connecting...');
    }

    if (connection === 'open') {
      state.status = 'connected';
      state.connectedSince = new Date().toISOString();
      state.qrDataUrl = null;
      state.qrRawString = null;
      const id = sock.user?.id || '';
      state.selfNumber = id.split(':')[0] || id.split('@')[0] || null;
      console.log(`[wa] Connected sebagai ${state.selfNumber}`);
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || 'closed';
      state.connectedSince = null;
      state.selfNumber = null;

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      state.lastError = reason;

      console.warn(`[wa] Connection closed (code=${statusCode}) reason=${reason} reconnect=${shouldReconnect}`);

      sock = null;

      if (statusCode === DisconnectReason.loggedOut) {
        state.status = 'disconnected';
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          fs.mkdirSync(AUTH_DIR, { recursive: true });
        } catch (_) {}
        return;
      }

      state.status = 'disconnected';
      if (shouldReconnect && !reconnecting) {
        reconnecting = true;
        setTimeout(async () => {
          reconnecting = false;
          try {
            await initClient();
          } catch (err) {
            console.error('[wa] Reconnect failed:', err.message);
          }
        }, config.wa.reconnectDelayMs);
      }
    }
  });
}

async function logout() {
  if (!sock) {
    state.status = 'disconnected';
    state.qrDataUrl = null;
    return { ok: true };
  }
  try {
    await sock.logout();
  } catch (err) {
    console.error('[wa] Logout error:', err.message);
  }
  try {
    sock.end?.(undefined);
  } catch (_) {}
  sock = null;

  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  } catch (_) {}

  state.status = 'disconnected';
  state.qrDataUrl = null;
  state.qrRawString = null;
  state.connectedSince = null;
  state.selfNumber = null;
  return { ok: true };
}

/**
 * Default rate limit — kalau client gak kirim config, pakai ini.
 * Nilai dibaca dari env (WA_RL_*) via config module. Lihat .env.example.
 */
const DEFAULT_RATE_LIMIT = { ...config.rateLimit };

function normalizeRateLimit(input = {}) {
  const out = { ...DEFAULT_RATE_LIMIT, ...input };
  out.messagesPerHour = Math.max(1, Math.min(out.messagesPerHour, 3600));
  out.dailyLimit = out.dailyLimit == null ? null : Math.max(1, out.dailyLimit);
  out.activeHoursStart = Math.max(0, Math.min(23, out.activeHoursStart));
  out.activeHoursEnd = Math.max(0, Math.min(24, out.activeHoursEnd));
  out.randomJitter = Math.max(0, Math.min(0.9, out.randomJitter));
  out.longPauseEvery = Math.max(0, out.longPauseEvery);
  return out;
}

function getLocalHour(timezone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false });
    return parseInt(fmt.format(new Date()), 10);
  } catch {
    return new Date().getHours();
  }
}

function getLocalDateKey(timezone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function msUntilNextHour(timezone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, minute: 'numeric', second: 'numeric' });
    const parts = fmt.formatToParts(new Date());
    const min = parseInt(parts.find((p) => p.type === 'minute').value, 10);
    const sec = parseInt(parts.find((p) => p.type === 'second').value, 10);
    return ((60 - min) * 60 - sec) * 1000;
  } catch {
    const now = new Date();
    return ((60 - now.getMinutes()) * 60 - now.getSeconds()) * 1000;
  }
}

function msUntilActiveWindowOpen(rl) {
  const now = new Date();
  const todayHour = getLocalHour(rl.timezone);
  const target = new Date(now);
  if (todayHour < rl.activeHoursStart) {
    target.setHours(target.getHours() + (rl.activeHoursStart - todayHour));
  } else {
    target.setHours(target.getHours() + (24 - todayHour + rl.activeHoursStart));
  }
  target.setMinutes(0, 0, 0);
  return Math.max(60_000, target.getTime() - now.getTime());
}

function isInActiveWindow(rl) {
  const h = getLocalHour(rl.timezone);
  return h >= rl.activeHoursStart && h < rl.activeHoursEnd;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitteredDelay(rl) {
  const baseMs = 3_600_000 / rl.messagesPerHour;
  const jit = (Math.random() * 2 - 1) * rl.randomJitter;
  return Math.max(1000, Math.round(baseMs * (1 + jit)));
}

function longPauseMs(rl) {
  const min = rl.longPauseMinMinutes * 60_000;
  const max = rl.longPauseMaxMinutes * 60_000;
  return Math.max(min, Math.round(min + Math.random() * (max - min)));
}

async function sendBlast({ recipients, defaultMessage, rateLimit, delayMs }) {
  if (state.status !== 'connected' || !sock) {
    throw new Error(`WhatsApp belum terhubung (status: ${state.status})`);
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('Recipients tidak boleh kosong');
  }

  let rl;
  if (delayMs != null && rateLimit == null) {
    // Backward-compat: kalau client kirim delayMs aja, convert ke equivalent messagesPerHour
    const perHour = Math.max(1, Math.round(3_600_000 / Math.max(1000, delayMs)));
    rl = normalizeRateLimit({ messagesPerHour: perHour, randomJitter: 0, longPauseEvery: 0, dailyLimit: null });
  } else {
    rl = normalizeRateLimit(rateLimit || {});
  }

  const job = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: 'running',
    total: recipients.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    paused: false,
    pausedReason: null,
    pausedUntil: null,
    nextSendAt: null,
    rateLimit: rl,
    sentToday: 0,
    sentThisHour: 0,
    currentDay: getLocalDateKey(rl.timezone),
    currentHour: getLocalHour(rl.timezone),
    results: [],
  };
  pushJob(job);

  (async () => {
    let sinceLastLongPause = 0;

    for (const rec of recipients) {
      if (job.status === 'cancelled') break;

      // Reset hour/day counters kalau berpindah jam/hari
      const nowDay = getLocalDateKey(rl.timezone);
      const nowHour = getLocalHour(rl.timezone);
      if (nowDay !== job.currentDay) {
        job.currentDay = nowDay;
        job.sentToday = 0;
        job.currentHour = nowHour;
        job.sentThisHour = 0;
      } else if (nowHour !== job.currentHour) {
        job.currentHour = nowHour;
        job.sentThisHour = 0;
      }

      // 1. Cek active hours window
      if (!isInActiveWindow(rl)) {
        const waitMs = msUntilActiveWindowOpen(rl);
        job.paused = true;
        job.pausedReason = 'outside_active_hours';
        job.pausedUntil = new Date(Date.now() + waitMs).toISOString();
        await sleep(waitMs);
        job.paused = false;
        job.pausedReason = null;
        job.pausedUntil = null;
        continue;
      }

      // 2. Cek daily limit
      if (rl.dailyLimit && job.sentToday >= rl.dailyLimit) {
        const waitMs = msUntilActiveWindowOpen(rl);
        job.paused = true;
        job.pausedReason = 'daily_limit_reached';
        job.pausedUntil = new Date(Date.now() + waitMs).toISOString();
        await sleep(waitMs);
        job.sentToday = 0;
        job.paused = false;
        job.pausedReason = null;
        job.pausedUntil = null;
        continue;
      }

      // 3. Cek hourly limit
      if (job.sentThisHour >= rl.messagesPerHour) {
        const waitMs = msUntilNextHour(rl.timezone);
        job.paused = true;
        job.pausedReason = 'hourly_limit_reached';
        job.pausedUntil = new Date(Date.now() + waitMs).toISOString();
        await sleep(waitMs);
        job.currentHour = getLocalHour(rl.timezone);
        job.sentThisHour = 0;
        job.paused = false;
        job.pausedReason = null;
        job.pausedUntil = null;
        continue;
      }

      const jid = formatJid(rec.nomor);
      const nama = rec.nama || '';
      const messageTemplate = (rec.pesan && String(rec.pesan).trim()) || defaultMessage || '';
      const message = renderTemplate(messageTemplate, { nama, ...rec });

      if (!jid) {
        job.failed++;
        job.results.push({ nama, nomor: rec.nomor, status: 'failed', error: 'Nomor invalid' });
        continue;
      }
      if (!message) {
        job.failed++;
        job.results.push({ nama, nomor: rec.nomor, status: 'failed', error: 'Pesan kosong' });
        continue;
      }

      try {
        await sock.sendMessage(jid, { text: message });
        job.sent++;
        job.sentToday++;
        job.sentThisHour++;
        sinceLastLongPause++;
        job.results.push({ nama, nomor: rec.nomor, status: 'sent', at: new Date().toISOString() });
      } catch (err) {
        job.failed++;
        job.results.push({ nama, nomor: rec.nomor, status: 'failed', error: err.message });
      }

      // Long pause setiap N pesan (anti-pattern detection)
      if (rl.longPauseEvery > 0 && sinceLastLongPause >= rl.longPauseEvery) {
        const pauseMs = longPauseMs(rl);
        sinceLastLongPause = 0;
        job.paused = true;
        job.pausedReason = 'long_pause_cooldown';
        job.pausedUntil = new Date(Date.now() + pauseMs).toISOString();
        await sleep(pauseMs);
        job.paused = false;
        job.pausedReason = null;
        job.pausedUntil = null;
        continue;
      }

      // Jeda antar pesan (random)
      const delay = jitteredDelay(rl);
      job.nextSendAt = new Date(Date.now() + delay).toISOString();
      await sleep(delay);
      job.nextSendAt = null;
    }

    if (job.status !== 'cancelled') job.status = 'completed';
    job.finishedAt = new Date().toISOString();
    // FIFO trim handled by pushJob() (WA_JOBS_MAX_HISTORY)
  })().catch((err) => {
    job.status = 'error';
    job.finishedAt = new Date().toISOString();
    job.error = err.message;
  });

  return { jobId: job.id, total: job.total, rateLimit: rl };
}

function cancelJob(id) {
  const job = getJob(id);
  if (!job) return false;
  if (job.status === 'running') {
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    return true;
  }
  return false;
}

// Hapus riwayat job. Default: cuma finished jobs (completed/cancelled/error)
// supaya job yang lagi running tidak ke-clear.
// opts.all=true → clear semua termasuk yang running (rare, jarang dipakai).
function clearJobs({ all = false } = {}) {
  const before = state.jobs.length;
  if (all) {
    state.jobs = [];
  } else {
    state.jobs = state.jobs.filter((j) => j.status === 'running' || j.status === 'paused');
  }
  return { cleared: before - state.jobs.length, remaining: state.jobs.length };
}

module.exports = {
  initClient,
  logout,
  sendBlast,
  cancelJob,
  clearJobs,
  getStatus,
  getJob,
  listJobs,
  DEFAULT_RATE_LIMIT,
};
