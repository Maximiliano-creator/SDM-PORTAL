/**
 * Parser CSV minimalista para los pushes de ERP. Soporta:
 *   - Separador `,` o `;` (autodetectado por la primera línea)
 *   - Campos quoted con `"`, escapando `""` interno
 *   - CRLF o LF
 *   - Filas con menos campos que el header (se rellenan con string vacío)
 */
export function parseCsv(input: string): Record<string, string>[] {
  if (!input.trim()) return [];
  const sep = detectSeparator(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === sep) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = (rows[0] ?? []).map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells || cells.every((c) => c === '')) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c] ?? `_col${c}`] = (cells[c] ?? '').trim();
    }
    out.push(obj);
  }
  return out;
}

function detectSeparator(input: string): ',' | ';' {
  const firstLine = input.slice(0, 4096).split(/\r?\n/, 1)[0] ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  return semis > commas ? ';' : ',';
}
