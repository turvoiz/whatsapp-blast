const express = require('express');
const cors = require('cors');
const multer = require('multer');
const config = require('./config');
const wa = require('./waClient');
const { parseSpreadsheetBuffer, rowsToRecipients } = require('./parser');

const PORT = config.server.port;
const HOST = config.server.host;

const app = express();

// CORS — '*' = allow all. Atau comma-separated list of origins.
const corsOptions =
  config.server.corsOrigin === '*'
    ? {} // default cors() = allow all
    : { origin: config.server.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean) };
app.use(cors(corsOptions));
app.use(express.json({ limit: config.server.jsonBodyLimit }));

// Upload (memory storage). Size limit dari config.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.server.uploadMaxSizeMB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /\.(csv|xlsx|xls|txt)$/i.test(file.originalname || '') ||
      [
        'text/csv',
        'text/plain',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/octet-stream',
      ].includes(file.mimetype);
    if (!ok) return cb(new Error('File harus CSV / Excel (.csv, .xlsx, .xls)'));
    cb(null, true);
  },
});

// Helper: parse multipart form's optional `rateLimit` field yg dikirim sbg JSON string
function parseOptionalJson(value) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return undefined;
  }
}

// Helper: extract recipients dari multipart file + form fields
function extractRecipientsFromMultipart(req) {
  if (!req.file || !req.file.buffer) {
    const err = new Error('File tidak ditemukan. Kirim sebagai multipart field "file".');
    err.status = 400;
    throw err;
  }
  const rows = parseSpreadsheetBuffer(req.file.buffer, {
    filename: req.file.originalname,
    mimetype: req.file.mimetype,
  });
  if (!rows.length) {
    const err = new Error('File kosong / tidak bisa di-parse');
    err.status = 400;
    throw err;
  }
  const opts = {
    nameCol: req.body.nameCol != null ? parseInt(req.body.nameCol, 10) : 0,
    phoneCol: req.body.phoneCol != null ? parseInt(req.body.phoneCol, 10) : 1,
    messageCol: req.body.messageCol != null ? parseInt(req.body.messageCol, 10) : 2,
    hasHeader:
      req.body.hasHeader === undefined
        ? 'auto'
        : req.body.hasHeader === 'true' || req.body.hasHeader === true,
  };
  return { rows, parseResult: rowsToRecipients(rows, opts), filename: req.file.originalname };
}

app.get('/api/wa/health', (_req, res) => {
  res.json({ ok: true, service: 'grosenia-wa-blast-server', uptime: process.uptime() });
});

app.get('/api/wa/status', (_req, res) => {
  res.json(wa.getStatus());
});

app.post('/api/wa/connect', async (_req, res) => {
  try {
    await wa.initClient();
    res.json({ ok: true, ...wa.getStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/wa/logout', async (_req, res) => {
  try {
    const result = await wa.logout();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/wa/blast', async (req, res) => {
  try {
    const { recipients, defaultMessage, rateLimit, delayMs } = req.body || {};
    const result = await wa.sendBlast({ recipients, defaultMessage, rateLimit, delayMs });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/wa/rate-limit-defaults', (_req, res) => {
  res.json(wa.DEFAULT_RATE_LIMIT);
});

app.get('/api/wa/jobs', (req, res) => {
  const limit = parseInt(req.query.limit || String(config.jobs.defaultListLimit), 10);
  res.json({ jobs: wa.listJobs(limit) });
});

app.get('/api/wa/jobs/:id', (req, res) => {
  const job = wa.getJob(req.params.id);
  if (!job) return res.status(404).json({ ok: false, error: 'Job tidak ditemukan' });
  res.json(job);
});

app.post('/api/wa/jobs/:id/cancel', (req, res) => {
  const cancelled = wa.cancelJob(req.params.id);
  if (!cancelled) return res.status(400).json({ ok: false, error: 'Job tidak running atau tidak ditemukan' });
  res.json({ ok: true });
});

// Hapus riwayat job dari memory. Default cuma finished jobs (completed/cancelled/error);
// pakai ?all=true untuk clear semua termasuk yang running (jarang dipakai).
app.delete('/api/wa/jobs', (req, res) => {
  const all = req.query.all === 'true' || req.query.all === '1';
  const result = wa.clearJobs({ all });
  res.json({ ok: true, ...result });
});

// Parse-only endpoint: upload CSV/Excel → return recipients preview (no blast)
// multipart fields: file (required), nameCol?, phoneCol?, messageCol?, hasHeader? ("true"/"false"/omit=auto)
// Useful utk dry-run / preview sebelum benar-benar blast.
app.post('/api/wa/parse-file', upload.single('file'), async (req, res) => {
  try {
    const { parseResult, filename } = extractRecipientsFromMultipart(req);
    res.json({
      ok: true,
      filename,
      totalRows: parseResult.totalRows,
      headerDetected: parseResult.headerDetected,
      recipientsCount: parseResult.recipientsCount,
      recipients: parseResult.recipients,
      errors: parseResult.errors.slice(0, 50),
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// One-shot upload + blast: upload CSV/Excel langsung dieksekusi blast-nya
// multipart fields:
//   file (required)
//   defaultMessage? (string, fallback kalau row gak punya kolom pesan)
//   rateLimit? (JSON string: { messagesPerHour, dailyLimit, ... })
//   delayMs? (int, fallback delay sederhana kalau rateLimit gak diset)
//   nameCol?, phoneCol?, messageCol?, hasHeader?
//
// Cocok utk testing via curl/Postman tanpa frontend, contoh:
//   curl -F "file=@list.xlsx" -F 'defaultMessage=Halo {nama}' \
//        -F 'rateLimit={"messagesPerHour":60}' http://localhost:3010/api/wa/blast-upload
app.post('/api/wa/blast-upload', upload.single('file'), async (req, res) => {
  try {
    const { parseResult, filename } = extractRecipientsFromMultipart(req);
    if (parseResult.recipients.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Tidak ada recipient valid di file',
        errors: parseResult.errors.slice(0, 20),
      });
    }

    const rateLimit = parseOptionalJson(req.body.rateLimit);
    const delayMs = req.body.delayMs ? parseInt(req.body.delayMs, 10) : undefined;
    const defaultMessage = req.body.defaultMessage || undefined;

    const result = await wa.sendBlast({
      recipients: parseResult.recipients,
      defaultMessage,
      rateLimit,
      delayMs,
    });

    res.json({
      ok: true,
      source: { filename, totalRows: parseResult.totalRows, headerDetected: parseResult.headerDetected },
      skipped: parseResult.errors.slice(0, 20),
      ...result,
    });
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, error: err.message });
  }
});

// Import recipients from Google Sheet (public / shared "anyone with link")
// body: { sheetId: string, gid?: string|number, nameCol?: number, phoneCol?: number, messageCol?: number, hasHeader?: boolean }
app.post('/api/wa/import-sheet', async (req, res) => {
  try {
    const {
      sheetId,
      gid = 0,
      nameCol = 0,
      phoneCol = 1,
      messageCol = 2,
      hasHeader = true,
    } = req.body || {};

    if (!sheetId || typeof sheetId !== 'string') {
      return res.status(400).json({ ok: false, error: 'sheetId wajib (string)' });
    }

    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    let csvText;
    try {
      const resp = await fetch(url, { redirect: 'follow' });
      if (!resp.ok) {
        return res.status(400).json({
          ok: false,
          error: `Gagal fetch sheet (HTTP ${resp.status}). Pastikan sheet di-share "Anyone with the link can view".`,
        });
      }
      csvText = await resp.text();
    } catch (err) {
      return res.status(400).json({ ok: false, error: `Gagal fetch sheet: ${err.message}` });
    }

    const rows = parseSpreadsheetBuffer(Buffer.from(csvText, 'utf8'), { filename: 'sheet.csv' });
    const parseResult = rowsToRecipients(rows, { nameCol, phoneCol, messageCol, hasHeader });

    res.json({
      ok: true,
      totalRows: parseResult.totalRows,
      headerDetected: parseResult.headerDetected,
      recipientsCount: parseResult.recipientsCount,
      recipients: parseResult.recipients,
      errors: parseResult.errors.slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use((err, _req, res, _next) => {
  // Multer-specific errors (file too big, invalid type, dll)
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ ok: false, error: `Upload error: ${err.message}` });
  }
  console.error('[express] Unhandled:', err);
  res.status(err.status || 500).json({ ok: false, error: err.message || 'Internal error' });
});

app.listen(PORT, HOST, () => {
  console.log('='.repeat(60));
  console.log('  Grosenia WA Blast Server');
  console.log(`  Listening:        http://${HOST}:${PORT}`);
  console.log(`  Auth dir:         ${config.wa.authDir}`);
  console.log(`  CORS origin:      ${config.server.corsOrigin}`);
  console.log(`  Upload max:       ${config.server.uploadMaxSizeMB} MB`);
  console.log(`  JSON body limit:  ${config.server.jsonBodyLimit}`);
  console.log(`  Job history max:  ${config.jobs.maxHistory}`);
  console.log(`  Log level:        ${config.log.level}`);
  console.log(
    `  Rate-limit def:   ${config.rateLimit.messagesPerHour}/hr, daily=${config.rateLimit.dailyLimit}, ` +
      `active=${config.rateLimit.activeHoursStart}-${config.rateLimit.activeHoursEnd} (${config.rateLimit.timezone})`,
  );
  console.log('='.repeat(60));
  console.log('Endpoints:');
  console.log('  GET    /api/wa/health');
  console.log('  GET    /api/wa/status');
  console.log('  POST   /api/wa/connect');
  console.log('  POST   /api/wa/logout');
  console.log('  POST   /api/wa/blast              body: { recipients, defaultMessage, rateLimit?: {...} }');
  console.log('  GET    /api/wa/rate-limit-defaults');
  console.log('  GET    /api/wa/jobs');
  console.log('  GET    /api/wa/jobs/:id');
  console.log('  POST   /api/wa/jobs/:id/cancel');
  console.log('  DELETE /api/wa/jobs               ?all=true (default: only finished jobs)');
  console.log('  POST   /api/wa/parse-file         multipart: file=@list.csv|xlsx (preview-only)');
  console.log('  POST   /api/wa/blast-upload       multipart: file=@list.csv|xlsx + defaultMessage + rateLimit');
  console.log('  POST   /api/wa/import-sheet       body: { sheetId, gid?, nameCol?, phoneCol?, messageCol?, hasHeader? }');
  console.log('='.repeat(60));

  if (config.wa.autoConnect) {
    console.log('[startup] Auto-connect WA client...');
    wa.initClient().catch((err) => console.error('[startup] initClient error:', err));
  } else {
    console.log('[startup] Auto-connect disabled (WA_BLAST_AUTOCONNECT=false). Trigger via POST /api/wa/connect.');
  }
});
