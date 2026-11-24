import ExcelJS from 'exceljs';
import type { Product } from '@sdm/shared';

export interface ImportRow {
  shopCode?: string;
  goodsPlu: string;
  goodsName: string;
  itemCode?: string;
  unitName?: string;
  priceModel?: 0 | 1;
  price?: number;
  memberPrice?: number;
  promotionPrice?: number;
  barCode?: string;
  deptCode?: string;
  brand?: string;
  spec?: string;
  qualityPeriod?: number;
  imagePath?: string;
}

const COLUMN_MAPPING: Record<string, keyof ImportRow> = {
  plu: 'goodsPlu',
  goodsplu: 'goodsPlu',
  codigo: 'itemCode',
  sku: 'itemCode',
  itemcode: 'itemCode',
  nombre: 'goodsName',
  name: 'goodsName',
  goodsname: 'goodsName',
  descripcion: 'goodsName',
  precio: 'price',
  price: 'price',
  preciosocio: 'memberPrice',
  memberprice: 'memberPrice',
  preciopromocion: 'promotionPrice',
  promotionprice: 'promotionPrice',
  unidad: 'unitName',
  unit: 'unitName',
  unitname: 'unitName',
  tipo: 'priceModel',
  pricemodel: 'priceModel',
  modelo: 'priceModel',
  codigobarras: 'barCode',
  barcode: 'barCode',
  departamento: 'deptCode',
  dept: 'deptCode',
  deptcode: 'deptCode',
  marca: 'brand',
  brand: 'brand',
  especificacion: 'spec',
  spec: 'spec',
  vidautil: 'qualityPeriod',
  qualityperiod: 'qualityPeriod',
  shopcode: 'shopCode',
  tienda: 'shopCode',
  imagen: 'imagePath',
  image: 'imagePath',
  foto: 'imagePath',
  picture: 'imagePath',
};

function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export interface ParseResult {
  rows: ImportRow[];
  warnings: string[];
  unknownHeaders: string[];
}

export async function parseExcel(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene hojas.');

  const headerRow = ws.getRow(1);
  const headers: (keyof ImportRow | null)[] = [];
  const unknownHeaders: string[] = [];
  headerRow.eachCell((cell, col) => {
    const raw = String(cell.value ?? '').trim();
    if (!raw) {
      headers[col] = null;
      return;
    }
    const norm = normalizeHeader(raw);
    const mapped = COLUMN_MAPPING[norm];
    if (mapped) headers[col] = mapped;
    else {
      headers[col] = null;
      unknownHeaders.push(raw);
    }
  });

  const requiredFields: (keyof ImportRow)[] = ['goodsPlu', 'goodsName'];
  for (const req of requiredFields) {
    if (!headers.includes(req)) {
      throw new Error(`Falta columna requerida: "${req}". Headers reconocidos: ${headers.filter((h) => h).join(', ')}`);
    }
  }

  const rows: ImportRow[] = [];
  const warnings: string[] = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Partial<ImportRow> = {};
    let hasData = false;
    headers.forEach((field, col) => {
      if (!field) return;
      const v = row.getCell(col).value;
      if (v === null || v === undefined || v === '') return;
      hasData = true;
      if (
        field === 'price' ||
        field === 'memberPrice' ||
        field === 'promotionPrice' ||
        field === 'qualityPeriod'
      ) {
        const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
        if (Number.isFinite(n)) (obj as Record<string, unknown>)[field] = n;
        else warnings.push(`Fila ${r}: "${field}" no es número (${v})`);
      } else if (field === 'priceModel') {
        const s = String(v).toLowerCase();
        if (s === '0' || s === 'peso' || s.startsWith('weig') || s === 'pesable') obj.priceModel = 0;
        else if (s === '1' || s === 'conteo' || s.startsWith('count') || s === 'unidad') obj.priceModel = 1;
        else warnings.push(`Fila ${r}: tipo "${v}" no reconocido (uso 0=peso, 1=conteo)`);
      } else {
        (obj as Record<string, unknown>)[field] = String(v).trim();
      }
    });
    if (!hasData) continue;
    if (!obj.goodsPlu || !obj.goodsName) {
      warnings.push(`Fila ${r}: falta PLU o Nombre, se descarta`);
      continue;
    }
    rows.push(obj as ImportRow);
  }

  return { rows, warnings, unknownHeaders: [...new Set(unknownHeaders)] };
}

export async function exportProductsToExcel(products: Product[], filename = 'catalogo.xlsx') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Catálogo');
  ws.columns = [
    { header: 'PLU', key: 'goodsPlu', width: 12 },
    { header: 'SKU', key: 'itemCode', width: 14 },
    { header: 'Nombre', key: 'goodsName', width: 40 },
    { header: 'Tienda', key: 'shopCode', width: 14 },
    { header: 'Tipo', key: 'priceModel', width: 8 },
    { header: 'Unidad', key: 'unitName', width: 8 },
    { header: 'Precio', key: 'price', width: 12 },
    { header: 'PrecioSocio', key: 'memberPrice', width: 12 },
    { header: 'PrecioPromocion', key: 'promotionPrice', width: 12 },
    { header: 'CodigoBarras', key: 'barCode', width: 16 },
    { header: 'Departamento', key: 'deptCode', width: 14 },
    { header: 'Marca', key: 'brand', width: 16 },
    { header: 'VidaUtil', key: 'qualityPeriod', width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const p of products) {
    ws.addRow({
      goodsPlu: p.goodsPlu,
      itemCode: p.itemCode ?? '',
      goodsName: p.goodsName?.trim() ?? '',
      shopCode: p.shopCode,
      priceModel: p.priceModel === 0 ? 'Peso' : 'Conteo',
      unitName: p.unitName ?? '',
      price: p.price ?? '',
      memberPrice: p.memberPrice ?? '',
      promotionPrice: p.promotionPrice ?? '',
      barCode: p.barCode ?? '',
      deptCode: p.deptCode ?? '',
      brand: p.brand ?? '',
      qualityPeriod: p.qualityPeriod ?? '',
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
