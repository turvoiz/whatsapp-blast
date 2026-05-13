const XLSX = require('xlsx');

// Minimal CSV parser dengan support quoted fields & escape ""
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Parse Excel buffer (.xlsx / .xls) → 2D array of strings
function parseExcelBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
  return rows.map((r) => r.map((c) => String(c == null ? '' : c)));
}

// Detect file type berdasarkan extension/mime, lalu parse jadi rows 2D
function parseSpreadsheetBuffer(buffer, { filename = '', mimetype = '' } = {}) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const isExcel =
    ext === 'xlsx' ||
    ext === 'xls' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimetype === 'application/vnd.ms-excel';
  if (isExcel) return parseExcelBuffer(buffer);
  // default treat as CSV / text
  return parseCsvText(buffer.toString('utf8'));
}

// Heuristik: kalau cell phone-col baris pertama gak diawali digit/+, kemungkinan header
function detectHeader(rows, phoneCol = 1) {
  if (!rows.length) return false;
  const cell = String((rows[0] || [])[phoneCol] || '').trim();
  if (!cell) return true; // empty → assume header
  return !/^\+?\d/.test(cell);
}

// Convert 2D rows → recipients array dengan validasi
// opts: { nameCol, phoneCol, messageCol, hasHeader: boolean | 'auto' }
function rowsToRecipients(rows, opts = {}) {
  const {
    nameCol = 0,
    phoneCol = 1,
    messageCol = 2,
  } = opts;
  let { hasHeader = 'auto' } = opts;
  if (hasHeader === 'auto') hasHeader = detectHeader(rows, phoneCol);

  const start = hasHeader ? 1 : 0;
  const recipients = [];
  const errors = [];
  for (let i = start; i < rows.length; i++) {
    const row = rows[i] || [];
    const nama = String(row[nameCol] || '').trim();
    const nomor = String(row[phoneCol] || '').trim();
    const pesan = String(row[messageCol] || '').trim();
    if (!nama && !nomor) continue;
    if (!nama || !nomor) {
      errors.push(`Baris ${i + 1}: nama/nomor kosong`);
      continue;
    }
    recipients.push({ nama, nomor, pesan: pesan || undefined });
  }

  return {
    totalRows: rows.length - start,
    headerDetected: hasHeader,
    recipientsCount: recipients.length,
    recipients,
    errors,
  };
}

module.exports = {
  parseCsvText,
  parseExcelBuffer,
  parseSpreadsheetBuffer,
  detectHeader,
  rowsToRecipients,
};
