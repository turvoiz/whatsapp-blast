# WA Blast Service

Standalone Node.js service untuk **kirim WhatsApp blast** ke banyak nomor secara
terkontrol (rate-limited, anti-ban). Backend pakai [Baileys](https://github.com/WhiskeySockets/Baileys)
— WhatsApp Multi-Device protocol via WebSocket. **Tidak butuh** Chrome/Puppeteer,
**bukan** Meta WhatsApp Business API.

## Highlights

- **Footprint kecil** — image Docker ~100MB, RAM idle ~150MB, startup ~5 detik
- **Rate-limit canggih** — kontrol messages/hour, daily limit, active hours, random
  jitter, long pause setiap N pesan — semua configurable per blast job
- **Upload CSV/Excel** — kirim file langsung ke endpoint, parser otomatis detect
  header & validasi nomor (Indonesia → normalisasi `08xx → 628xx`)
- **Import Google Sheet** — cukup share "Anyone with link", pass `sheetId` saja
- **Template pesan** — `Halo {nama}, kamu dapat promo {kode}!` — placeholder
  di-replace per recipient
- **Session persistent** — scan QR sekali, simpan keys di disk, restart container
  gak perlu scan ulang
- **Job tracking** — status real-time per recipient (sent / failed / skipped),
  pause/resume info, cancel API
- **Zero config** — semua via env var, default sudah aman utk produksi

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 20 (Alpine in Docker) |
| HTTP | Express + CORS |
| WA Protocol | [Baileys](https://github.com/WhiskeySockets/Baileys) (`@whiskeysockets/baileys`) |
| Upload | Multer (multipart) + `xlsx` (SheetJS) |
| QR | `qrcode` (data URL base64) |
| Logger | Pino (structured JSON) |
| Init | Tini (graceful SIGTERM di container) |

---

## Quick Start (Local Dev)

Butuh **Node.js 20+**. Tidak butuh Chrome/Puppeteer.

```bash
npm install
npm run dev     # auto-reload via `node --watch`
# atau:
npm start       # plain node
```

Service listen di `http://localhost:3010`. Cek health:
```bash
curl http://localhost:3010/api/wa/health
```

Setelah startup, service auto-init Baileys & generate QR. Cek logs:
```
[wa] QR code dibuat — scan dari WA HP (Linked Devices)
```

Scan QR pakai HP (WhatsApp → Settings → Linked Devices → Link a Device). Status berubah dari `qr_required` → `authenticating` → `connected`.

QR juga tersedia sebagai base64 PNG via `GET /api/wa/status` (field `qrDataUrl`), siap pakai di `<img src="...">`.

## Quick Start (Docker)

```bash
make docker-build
make docker-run
make docker-logs       # tail logs + lihat QR
```

Session disimpan di volume `wa_session_data` → restart container gak perlu scan ulang.

---

## Configuration (Environment Variables)

Semua setting dibaca dari env. Override via shell, `docker run -e`, atau `environment:` di compose. Source of truth = [`src/config.js`](./src/config.js).

### HTTP Server

| Var | Default | Keterangan |
|-----|---------|------------|
| `WA_BLAST_PORT` | `3010` | Port HTTP server |
| `WA_BLAST_HOST` | `0.0.0.0` | Bind host (`127.0.0.1` = local only) |
| `WA_BLAST_JSON_BODY_LIMIT` | `5mb` | Max ukuran JSON body utk `POST /blast` |
| `WA_BLAST_UPLOAD_MAX_MB` | `10` | Max ukuran file upload (CSV/Excel) dalam MB |
| `WA_BLAST_CORS_ORIGIN` | `*` | CORS allowed origin (`*` allow all, atau comma-separated list domain) |

### WhatsApp / Baileys Client

| Var | Default | Keterangan |
|-----|---------|------------|
| `WA_AUTH_DIR` | `./auth_info_baileys` | Folder simpan session Baileys (Docker: mount volume) |
| `WA_BLAST_AUTOCONNECT` | `true` | `false` = jangan auto-init, harus manual `POST /api/wa/connect` |
| `WA_BROWSER_NAME` | `Grosenia Admin` | Nama device yg muncul di "Linked Devices" WA HP |
| `WA_BROWSER_CLIENT` | `Chrome` | Browser fingerprint Baileys |
| `WA_BROWSER_VERSION` | `1.0.0` | Versi browser fingerprint |
| `WA_CONNECT_TIMEOUT_MS` | `60000` | Timeout handshake awal (ms) |
| `WA_KEEPALIVE_INTERVAL_MS` | `30000` | Interval ping ke WA server (ms) |
| `WA_RECONNECT_DELAY_MS` | `3000` | Delay sebelum auto-reconnect setelah disconnect (ms) |
| `WA_DEFAULT_QUERY_TIMEOUT_MS` | `0` | Timeout WA query. `0` = disabled (recommended utk hindari "Timed Out" di init queries) |
| `WA_SYNC_FULL_HISTORY` | `false` | Sync seluruh chat history (false = ringan, recommended utk service kirim-only) |
| `WA_MARK_ONLINE_ON_CONNECT` | `false` | Tandai online ke kontak saat connect (false = stealth) |

### Jobs / History

| Var | Default | Keterangan |
|-----|---------|------------|
| `WA_JOBS_MAX_HISTORY` | `100` | Max job disimpan di memory (FIFO trim, yg paling tua dibuang otomatis) |
| `WA_JOBS_DEFAULT_LIST_LIMIT` | `20` | Default `?limit` utk `GET /api/wa/jobs` |

### Rate Limit Defaults

Nilai default kalau client gak pass `rateLimit` di body `/blast`. Frontend juga fetch ini via `/rate-limit-defaults` utk pre-fill form UI.

| Var | Default | Keterangan |
|-----|---------|------------|
| `WA_RL_MESSAGES_PER_HOUR` | `50` | Target pesan per jam |
| `WA_RL_DAILY_LIMIT` | `500` | Max pesan per hari |
| `WA_RL_ACTIVE_HOURS_START` | `8` | Mulai jam aktif (0–23) |
| `WA_RL_ACTIVE_HOURS_END` | `21` | Selesai jam aktif (0–24) |
| `WA_RL_TIMEZONE` | `Asia/Jakarta` | TZ utk active hours |
| `WA_RL_RANDOM_JITTER` | `0.3` | Random jitter (0–0.9, fraksi delay) |
| `WA_RL_LONG_PAUSE_EVERY` | `30` | Long pause setiap N pesan (0 = off) |
| `WA_RL_LONG_PAUSE_MIN_MINUTES` | `3` | Durasi minimum long pause (menit) |
| `WA_RL_LONG_PAUSE_MAX_MINUTES` | `8` | Durasi maksimum long pause (menit) |

### Logging

| Var | Default | Keterangan |
|-----|---------|------------|
| `PINO_LEVEL` | `warn` | Log level (`trace` / `debug` / `info` / `warn` / `error` / `fatal`) |
| `LOG_PRETTY` | `false` | Pretty-print logs (dev: `true`, prod: `false` utk JSON structured) |

### Debug Config

Cek nilai yg ke-load:

```bash
node -e "require('./src/config').printSummary()"
```

---

## API Reference

Base URL: `http://localhost:3010` (default).

**Conventions:**
- Semua response JSON.
- Sukses → biasanya `{ "ok": true, ...data }` atau langsung object data.
- Error → `{ "ok": false, "error": "<message>" }` dengan HTTP status non-2xx.

### Index

| # | Method | Path | Keterangan |
|---|--------|------|------------|
| 1 | GET    | [`/api/wa/health`](#1-get-apiwahealth) | Health check |
| 2 | GET    | [`/api/wa/status`](#2-get-apiwastatus) | Status koneksi WA + QR data |
| 3 | POST   | [`/api/wa/connect`](#3-post-apiwaconnect) | Trigger init client |
| 4 | POST   | [`/api/wa/logout`](#4-post-apiwalogout) | Logout & hapus session |
| 5 | POST   | [`/api/wa/blast`](#5-post-apiwablast) | Blast (JSON body recipients) |
| 6 | POST   | [`/api/wa/blast-upload`](#6-post-apiwablast-upload) | Upload CSV/Excel + langsung blast |
| 7 | POST   | [`/api/wa/parse-file`](#7-post-apiwaparse-file) | Preview file (no blast) |
| 8 | POST   | [`/api/wa/import-sheet`](#8-post-apiwaimport-sheet) | Import Google Sheet public |
| 9 | GET    | [`/api/wa/jobs`](#9-get-apiwajobs) | List N job terakhir |
| 10 | GET   | [`/api/wa/jobs/:id`](#10-get-apiwajobsid) | Detail satu job |
| 11 | POST  | [`/api/wa/jobs/:id/cancel`](#11-post-apiwajobsidcancel) | Cancel running job |
| 12 | DELETE | [`/api/wa/jobs`](#12-delete-apiwajobs) | Hapus riwayat job |
| 13 | GET   | [`/api/wa/rate-limit-defaults`](#13-get-apiwarate-limit-defaults) | Default rate-limit config |

---

### 1. GET `/api/wa/health`

Health check sederhana. Buat probe / load balancer.

**Response 200:**
```json
{
  "ok": true,
  "service": "grosenia-wa-blast-server",
  "uptime": 123.456
}
```

```bash
curl http://localhost:3010/api/wa/health
```

---

### 2. GET `/api/wa/status`

Status koneksi WA saat ini. Kalau status `qr_required`, response berisi
`qrDataUrl` (base64 PNG) yang langsung bisa dipakai di `<img src="...">`.

**Response 200:**
```json
{
  "status": "connected",
  "qrDataUrl": null,
  "lastError": null,
  "connectedSince": "2026-05-12T03:24:11.123Z",
  "selfNumber": "6281234567890",
  "jobsCount": 4
}
```

**Status values:**
- `initializing` — service start, belum konek
- `authenticating` — handshake awal dengan WA server
- `qr_required` — perlu scan QR (cek `qrDataUrl`)
- `connected` — siap kirim pesan
- `disconnected` — koneksi putus (auto-reconnect kecuali kalau logged out)

**Kalau `qr_required`:**
```json
{
  "status": "qr_required",
  "qrDataUrl": "data:image/png;base64,iVBORw0KGgoAAA...",
  "lastError": null,
  "connectedSince": null,
  "selfNumber": null,
  "jobsCount": 0
}
```

```bash
curl http://localhost:3010/api/wa/status
```

---

### 3. POST `/api/wa/connect`

Trigger init client manual. Berguna kalau `WA_BLAST_AUTOCONNECT=false` (auto-init disabled). Idempotent — kalau sudah connected, return status saja.

**Request body:** *(empty)*

**Response 200:** sama dengan `GET /api/wa/status` plus `ok: true`.

```bash
curl -X POST http://localhost:3010/api/wa/connect
```

---

### 4. POST `/api/wa/logout`

Logout dari WA Web (unlink device dari HP), hapus session keys di disk. Setelah ini perlu scan QR lagi.

**Request body:** *(empty)*

**Response 200:**
```json
{ "ok": true }
```

```bash
curl -X POST http://localhost:3010/api/wa/logout
```

---

### 5. POST `/api/wa/blast`

Kirim blast ke daftar recipient (JSON body). Job dijalanin async — endpoint langsung return `jobId`, poll progress via [`GET /api/wa/jobs/:id`](#10-get-apiwajobsid).

**Request body:**
```json
{
  "recipients": [
    { "nama": "Andi", "nomor": "081234567890", "pesan": "Halo Andi, special promo nih!" },
    { "nama": "Budi", "nomor": "08129999888" },
    { "nama": "Citra", "nomor": "+6281111222" }
  ],
  "defaultMessage": "Halo {nama}, kami ada promo nih: {kode}",
  "rateLimit": {
    "messagesPerHour": 60,
    "dailyLimit": 1000,
    "activeHoursStart": 8,
    "activeHoursEnd": 21,
    "timezone": "Asia/Jakarta",
    "randomJitter": 0.3,
    "longPauseEvery": 30,
    "longPauseMinMinutes": 3,
    "longPauseMaxMinutes": 8
  },
  "delayMs": 60000
}
```

| Field | Type | Required | Keterangan |
|-------|------|----------|------------|
| `recipients` | array | ✅ | Daftar recipient (min 1) |
| `recipients[].nama` | string | — | Nama (untuk template `{nama}`) |
| `recipients[].nomor` | string | ✅ | Nomor — `08xx`/`628xx`/`+628xx` auto-normalize ke format internasional |
| `recipients[].pesan` | string | — | Pesan per recipient (override `defaultMessage`) |
| `defaultMessage` | string | — | Fallback pesan kalau recipient gak punya `pesan`. Support `{nama}` + key lain dari recipient object |
| `rateLimit` | object | — | Override default rate-limit. Field di tabel di [Rate Limit Behavior](#rate-limit-behavior) |
| `delayMs` | number | — | Shortcut: kalau gak ada `rateLimit`, pakai jeda flat sekian ms (di-convert ke `messagesPerHour` ekuivalen, no jitter, no long pause) |

**Response 200:**
```json
{
  "ok": true,
  "jobId": "job_1715485012345_a3f9b2",
  "total": 3,
  "rateLimit": {
    "messagesPerHour": 60,
    "dailyLimit": 1000,
    "activeHoursStart": 8,
    "activeHoursEnd": 21,
    "timezone": "Asia/Jakarta",
    "randomJitter": 0.3,
    "longPauseEvery": 30,
    "longPauseMinMinutes": 3,
    "longPauseMaxMinutes": 8
  }
}
```

**Errors:**
- `400` — WhatsApp belum connected, atau `recipients` kosong/invalid
- `400` — Recipient field invalid (mis. nomor format aneh)

**Template placeholder:** Gunakan `{nama}` atau key lain dari object recipient. Contoh `defaultMessage = "Halo {nama}, kode kamu: {kode}"` dan recipient `{nama: "Andi", nomor: "...", kode: "XYZ"}` → output: `"Halo Andi, kode kamu: XYZ"`.

```bash
curl -X POST http://localhost:3010/api/wa/blast \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": [
      {"nama":"Andi","nomor":"081234567890"},
      {"nama":"Budi","nomor":"081111222333"}
    ],
    "defaultMessage": "Halo {nama}, promo nih!",
    "rateLimit": {"messagesPerHour": 60}
  }'
```

---

### 6. POST `/api/wa/blast-upload`

**Upload CSV/Excel + langsung blast 1-shot**. Berguna utk testing tanpa frontend, atau script otomasi.

**Request:** `multipart/form-data`

| Field | Type | Required | Keterangan |
|-------|------|----------|------------|
| `file` | file | ✅ | CSV / `.xlsx` / `.xls`, max `WA_BLAST_UPLOAD_MAX_MB` MB |
| `defaultMessage` | string | — | Fallback pesan (dipakai kalau row gak punya kolom pesan) |
| `rateLimit` | string | — | JSON string dari rate-limit object |
| `delayMs` | string | — | Fallback delay (ms) kalau gak ada rateLimit |
| `nameCol` | int | — | Index kolom nama (0-based, default `0`) |
| `phoneCol` | int | — | Index kolom nomor (default `1`) |
| `messageCol` | int | — | Index kolom pesan (default `2`) |
| `hasHeader` | bool/`"auto"` | — | `true`/`false`/`"auto"` (default auto-detect) |

**File format:** kolom **Nama | Nomor | Pesan** (urutan default, bisa di-override via `*Col`). Contoh CSV:
```csv
Nama,Nomor,Pesan
Andi,081234567890,Promo spesial untuk kamu
Budi,081111222333,
Citra,+6281999888,Halo dari kami!
```

**Response 200:**
```json
{
  "ok": true,
  "source": {
    "filename": "kontak.xlsx",
    "totalRows": 5000,
    "headerDetected": true
  },
  "skipped": [
    { "row": 4, "error": "Nomor invalid: 'abc123'" }
  ],
  "jobId": "job_1715485012345_a3f9b2",
  "total": 4998,
  "rateLimit": { "...": "..." }
}
```

`skipped` = recipient yg di-skip karena invalid (max 20 entry, ada `row` & `error`). Validasi penuh ada di response.

**Errors:**
- `400` — file gak ada, format gak didukung, atau gak ada recipient valid
- `400` — file > `WA_BLAST_UPLOAD_MAX_MB` MB → multer error

```bash
curl -X POST http://localhost:3010/api/wa/blast-upload \
  -F "file=@kontak.xlsx" \
  -F 'defaultMessage=Halo {nama}, ada promo nih!' \
  -F 'rateLimit={"messagesPerHour":60,"dailyLimit":1000,"randomJitter":0.3}'
```

---

### 7. POST `/api/wa/parse-file`

**Preview-only** — upload file, return parsed recipients **tanpa kirim apa-apa**. Cocok utk dry-run / verifikasi sebelum benar-benar blast.

**Request:** `multipart/form-data`, field sama dengan `/blast-upload` tanpa `defaultMessage`/`rateLimit`/`delayMs`.

**Response 200:**
```json
{
  "ok": true,
  "filename": "kontak.xlsx",
  "totalRows": 1000,
  "headerDetected": true,
  "recipientsCount": 998,
  "recipients": [
    { "nama": "Andi", "nomor": "6281234567890", "pesan": "Promo spesial" },
    { "nama": "Budi", "nomor": "6281111222333", "pesan": "" }
  ],
  "errors": [
    { "row": 4, "error": "Nomor invalid: 'abc123'" }
  ]
}
```

```bash
curl -F "file=@kontak.csv" http://localhost:3010/api/wa/parse-file
```

---

### 8. POST `/api/wa/import-sheet`

Import recipient dari Google Sheet **public** (share "Anyone with the link can view"). Service fetch CSV export dari Google, parse → return recipient list. **Tidak butuh Google API key** karena pakai endpoint `export?format=csv`.

**Request body:**
```json
{
  "sheetId": "1AbCdEfGhIjKlMnOpQrStUvWxYz",
  "gid": 0,
  "nameCol": 0,
  "phoneCol": 1,
  "messageCol": 2,
  "hasHeader": true
}
```

| Field | Type | Required | Default | Keterangan |
|-------|------|----------|---------|------------|
| `sheetId` | string | ✅ | — | ID dari URL sheet: `docs.google.com/spreadsheets/d/<ID>/edit` |
| `gid` | int/string | — | `0` | Sheet tab ID (di URL: `#gid=...`). Sheet pertama biasanya `0` |
| `nameCol` | int | — | `0` | |
| `phoneCol` | int | — | `1` | |
| `messageCol` | int | — | `2` | |
| `hasHeader` | bool | — | `true` | |

**Response 200:** sama dengan `/parse-file`.

**Errors:**
- `400` — sheet gak ada, belum di-share public, atau invalid `sheetId`
- `400` — gid salah / tab gak ada

```bash
curl -X POST http://localhost:3010/api/wa/import-sheet \
  -H "Content-Type: application/json" \
  -d '{"sheetId":"1AbCdEf...","gid":"0","hasHeader":true}'
```

---

### 9. GET `/api/wa/jobs`

List job terakhir (terbaru dulu). Default limit `WA_JOBS_DEFAULT_LIST_LIMIT` (20).

**Query params:**
| Param | Type | Default | Keterangan |
|-------|------|---------|------------|
| `limit` | int | `20` | Max job yg di-return |

**Response 200:**
```json
{
  "jobs": [
    {
      "id": "job_1715485012345_a3f9b2",
      "status": "running",
      "total": 100,
      "sent": 23,
      "failed": 1,
      "skipped": 0,
      "startedAt": "2026-05-12T03:24:11.123Z",
      "finishedAt": null,
      "paused": false,
      "pausedReason": null,
      "pausedUntil": null,
      "nextSendAt": "2026-05-12T03:26:34.567Z",
      "rateLimit": { "messagesPerHour": 60, "...": "..." },
      "sentToday": 23,
      "sentThisHour": 23,
      "results": [
        { "nama":"Andi","nomor":"081234567890","status":"sent","at":"..." }
      ]
    }
  ]
}
```

**`status` values:** `running` | `completed` | `cancelled` | `error`

```bash
curl http://localhost:3010/api/wa/jobs?limit=5
```

---

### 10. GET `/api/wa/jobs/:id`

Detail satu job dengan **full results array** (per-recipient status).

**Path params:**
- `:id` — job ID dari `/blast` response

**Response 200:** sama dengan satu item dari `/jobs`, plus full `results`.

**Errors:**
- `404` — Job ID gak ditemukan

```bash
curl http://localhost:3010/api/wa/jobs/job_1715485012345_a3f9b2
```

---

### 11. POST `/api/wa/jobs/:id/cancel`

Cancel running job. Job akan stop di iterasi berikutnya. Job yg sudah `completed`/`cancelled`/`error` return error.

**Response 200:**
```json
{ "ok": true }
```

**Errors:**
- `400` — Job tidak running / tidak ditemukan

```bash
curl -X POST http://localhost:3010/api/wa/jobs/job_xxx/cancel
```

---

### 12. DELETE `/api/wa/jobs`

Hapus riwayat job dari memory. **Default cuma yang sudah finished** (running tetap aman) — pakai `?all=true` untuk paksa hapus semua.

**Query params:**
| Param | Type | Default | Keterangan |
|-------|------|---------|------------|
| `all` | bool | `false` | `true`/`1` = hapus semua termasuk running |

**Response 200:**
```json
{ "ok": true, "cleared": 14, "remaining": 2 }
```

```bash
curl -X DELETE "http://localhost:3010/api/wa/jobs"
curl -X DELETE "http://localhost:3010/api/wa/jobs?all=true"
```

---

### 13. GET `/api/wa/rate-limit-defaults`

Return default rate-limit config dari env (`WA_RL_*`). Berguna utk frontend pre-fill form.

**Response 200:**
```json
{
  "messagesPerHour": 50,
  "dailyLimit": 500,
  "activeHoursStart": 8,
  "activeHoursEnd": 21,
  "timezone": "Asia/Jakarta",
  "randomJitter": 0.3,
  "longPauseEvery": 30,
  "longPauseMinMinutes": 3,
  "longPauseMaxMinutes": 8
}
```

```bash
curl http://localhost:3010/api/wa/rate-limit-defaults
```

---

## Rate Limit Behavior

Worker per-job evaluate semua rule berikut sebelum kirim setiap pesan. Kalau salah satu trigger, worker tidur, lalu retry recipient yang sama.

| Rule | Field | Behavior kalau hit |
|------|-------|--------------------|
| **Active hours** | `activeHoursStart` / `activeHoursEnd` | Sleep sampai jam mulai berikutnya. Status: `pausedReason=outside_active_hours` |
| **Daily limit** | `dailyLimit` | Sleep sampai active hours buka esok hari, reset counter. Status: `daily_limit_reached` |
| **Hourly limit** | `messagesPerHour` | Sleep sampai jam berikutnya. Status: `hourly_limit_reached` |
| **Per-message delay** | `messagesPerHour` + `randomJitter` | Delay `3600s / messagesPerHour × (1 ± jitter)` setelah tiap pesan |
| **Long pause** | `longPauseEvery` + `longPauseMin/MaxMinutes` | Sleep random 3–8 menit setiap N pesan. Status: `long_pause_cooldown` |

Job punya field hidup-hidupan yang bisa di-poll:
- `paused`, `pausedReason`, `pausedUntil`
- `nextSendAt` — waktu kirim berikutnya
- `sentToday`, `sentThisHour` — counter aktual

### Contoh kalkulasi

Konfigurasi: `messagesPerHour: 60`, `randomJitter: 0.3`, `longPauseEvery: 20`, `longPauseMinMinutes: 3`, `longPauseMaxMinutes: 8`.

- Base delay per pesan = 3600s / 60 = **60s**
- Jitter ±30% → delay aktual = random antara **42–78 detik**
- Setiap 20 pesan → long pause **3–8 menit**

Estimasi blast 100 nomor:
- 100 pesan × ~60s = ~100 menit base
- 5 long pause (100/20) × ~5.5 menit = ~27 menit
- **Total ~2 jam 7 menit**

Worker juga respect active hours — kalau jam 21:00 lewat batas, sleep sampai 08:00 besok lalu lanjut dari recipient terakhir.

---

## Phone Number Normalization

Semua nomor di-normalize sebelum kirim:

| Input | Output (E.164 Indonesia) |
|-------|--------------------------|
| `081234567890` | `6281234567890` |
| `8123456789` | `628123456789` |
| `+6281234567890` | `6281234567890` |
| `62 812 3456 7890` | `6281234567890` |
| `0812-345-67890` | `6281234567890` |

JID Baileys final: `6281234567890@s.whatsapp.net`. Nomor yang gak bisa di-parse akan masuk `failed` dengan `error: "Nomor invalid"`.

> ℹ️ Untuk non-Indonesia, edit `formatJid()` di [`src/waClient.js`](./src/waClient.js).

---

## File Structure

```
wa-blast-service/
├── src/
│   ├── server.js       # Express + endpoints (REST + multipart upload)
│   ├── waClient.js     # Baileys socket + state + sendBlast worker loop
│   ├── parser.js       # CSV/Excel parser + header detection + validation
│   └── config.js       # Centralized env loader + defaults + validation
├── Dockerfile          # Multi-stage Node 20 Alpine + tini + non-root user
├── .dockerignore
├── Makefile            # Shortcut local dev / docker standalone
├── package.json
├── README.md           # File ini (standalone docs)
└── README.grosenia.md  # Integrasi dengan stack Grosenia (admin-web, api-web)
```

---

## ⚠️ Tips Anti-Ban WhatsApp

- Pakai **nomor spare**, jangan nomor utama bisnis
- Pesan **jangan terlalu promosi** — sifatnya conversational
- Default rate-limit (`WA_RL_MESSAGES_PER_HOUR=50`, ~1 pesan/menit) sudah sangat aman
- **Hindari blast massal** ke ribuan nomor sekaligus — batch & spread sepanjang hari pakai `dailyLimit` + `activeHours`
- Aktifkan `longPauseEvery` (default 30) supaya ada jeda 3–8 menit di tiap batch
- Hindari **link sales** dalam jumlah besar — WhatsApp sensitif terhadap pola spam
- Untuk volume tinggi & production beneran → migrasi ke **Meta WA Business API**

---

## Notes

- Service ini cuma support **kirim teks** (`sock.sendMessage(jid, { text })`). Untuk attachment (image/dok/video), perlu extend `sendBlast()` di [`src/waClient.js`](./src/waClient.js) untuk pakai `image`/`document`/`video` payload Baileys.
- Job state in-memory — restart service akan hilangkan history. Kalau perlu persist, integrasikan ke DB.
- Service ini di-design **one WA account per instance**. Untuk multi-account, deploy beberapa instance dengan `WA_AUTH_DIR` & `WA_BLAST_PORT` berbeda.

## Resources

- [Baileys docs](https://github.com/WhiskeySockets/Baileys)
- [WhatsApp Multi-Device protocol](https://github.com/sigalor/whatsapp-web-reveng)
- [SheetJS / xlsx](https://docs.sheetjs.com/)
