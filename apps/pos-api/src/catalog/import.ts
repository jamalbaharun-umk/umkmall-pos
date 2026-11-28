/**
 * UMK-2129: product import from a CSV file (an Excel sheet saved as CSV, or a Moka/Majoo export). Pure: parsing,
 * header mapping and the checks of one row. What needs the database (SKU, barcode or name already in the store) is
 * added by ImportService. Every message is Indonesian and names the row (the header is row 1).
 */

/** At most this many product rows per file (owner ruling 2026-11-28). */
export const IMPORT_MAX_ROWS = 500;
/** The CSV text the routes take (the JSON body limit of the import routes is set in http.ts). */
export const IMPORT_MAX_CHARS = 400_000;

export type ImportField =
  | 'name'
  | 'sellingPrice'
  | 'costPrice'
  | 'sku'
  | 'category'
  | 'unit'
  | 'barcode'
  | 'stock';

/** Header names per field, compared lower case with spaces, dots, dashes and underscores removed. */
const HEADERS: Record<ImportField, string[]> = {
  name: [
    'nama',
    'namaproduk',
    'namabarang',
    'name',
    'productname',
    'itemname',
    'produk',
    'barang',
  ],
  sellingPrice: ['hargajual', 'harga', 'price', 'sellingprice', 'hargajualrp'],
  costPrice: [
    'hargamodal',
    'modal',
    'hpp',
    'cost',
    'costprice',
    'hargabeli',
    'hargapokok',
  ],
  sku: ['sku', 'kode', 'kodeproduk', 'kodebarang', 'code', 'itemcode'],
  category: ['kategori', 'category', 'kategoriproduk'],
  unit: ['satuan', 'unit', 'uom'],
  barcode: ['barcode', 'kodebarcode', 'ean'],
  stock: ['stok', 'stock', 'stokawal', 'qty', 'jumlah', 'jumlahstok'],
};

const key = (h: string) => h.toLowerCase().replace(/[\s._\-()]/g, '');

/** A whole-file refusal (422 `CSV_INVALID`): nothing is read and nothing is saved. */
export class ImportFileError extends Error {}

/** RFC 4180 records with the delimiter of the header line (`;` from an Indonesian Excel, `,` or a tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => firstLine.split(c).length - 1;
  const delim = [';', ',', '\t'].reduce(
    (best, c) => (count(c) > count(best) ? c : best),
    ',',
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (quoted)
    throw new ImportFileError('Ada tanda kutip (") yang tidak ditutup.');
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Whole rupiah from a cell: "68000", "68.000", "68,000", "Rp 68.000", "68.000,00". Null for a blank cell, NaN for
 * anything else ("abc", "1,5", "-1"): money is integer rupiah, never a float.
 */
export function parseMoney(raw: string): number | null {
  let t = raw
    .trim()
    .replace(/^rp\.?\s*/i, '')
    .replace(/\s/g, '');
  if (t === '') return null;
  // A zero fraction ("68.000,00", "68,000.00", "68000,00") is whole rupiah; the rest must parse without it.
  const whole = /^(.+)[.,]00$/.exec(t);
  if (whole && /^\d+$|^\d{1,3}(?:[.,]\d{3})+$/.test(whole[1])) t = whole[1];
  if (/^\d+$/.test(t)) return Number(t);
  const grouped = /^\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*$/.exec(t);
  if (grouped) return Number(t.replace(/[.,]/g, ''));
  return NaN;
}

const MONEY_MAX = 1_000_000_000_000;

export type ImportRow = {
  /** Row number in the file (the header is row 1). */
  row: number;
  name: string;
  sellingPrice: number | null;
  costPrice: number | null;
  sku: string | null;
  category: string | null;
  unit: string | null;
  barcode: string | null;
  /** Opening stock; null = the product does not track stock ("Tanpa stok"). */
  stock: number | null;
  errors: string[];
};

/** The header row mapped to fields; a column with an unknown header is ignored. */
export function mapHeader(
  header: string[],
): Partial<Record<ImportField, number>> {
  const map: Partial<Record<ImportField, number>> = {};
  header.forEach((h, i) => {
    const k = key(h);
    for (const f of Object.keys(HEADERS) as ImportField[])
      if (map[f] === undefined && HEADERS[f].includes(k)) map[f] = i;
  });
  if (map.name === undefined || map.sellingPrice === undefined)
    throw new ImportFileError(
      'Kolom "Nama" dan "Harga jual" wajib ada di baris pertama.',
    );
  return map;
}

/** Every row of the file with its own errors (checks of the row alone and duplicates inside the file). */
export function readRows(text: string): ImportRow[] {
  if (text.length > IMPORT_MAX_CHARS)
    throw new ImportFileError(
      'Berkas terlalu besar. Maksimal 500 baris produk.',
    );
  const records = parseCsv(text);
  if (records.length === 0) throw new ImportFileError('Berkas ini kosong.');
  const map = mapHeader(records[0]);
  const data = records.slice(1);
  if (data.length === 0)
    throw new ImportFileError('Berkas ini kosong: hanya ada baris judul.');
  if (data.length > IMPORT_MAX_ROWS)
    throw new ImportFileError(
      `Berkas berisi ${data.length} baris produk. Maksimal ${IMPORT_MAX_ROWS} baris per impor.`,
    );
  const cell = (r: string[], f: ImportField) =>
    map[f] === undefined ? '' : (r[map[f]] ?? '').trim();
  const rows = data.map((r, i): ImportRow => {
    const errors: string[] = [];
    const name = cell(r, 'name');
    if (!name) errors.push('Nama wajib diisi');
    else if (name.length > 120) errors.push('Nama maksimal 120 karakter');
    const price = parseMoney(cell(r, 'sellingPrice'));
    if (price === null) errors.push('Harga jual wajib diisi');
    else if (Number.isNaN(price))
      errors.push('Harga jual bukan angka rupiah bulat');
    else if (price <= 0) errors.push('Harga jual harus lebih dari 0');
    else if (price > MONEY_MAX) errors.push('Harga jual terlalu besar');
    const cost = parseMoney(cell(r, 'costPrice'));
    if (cost !== null && Number.isNaN(cost))
      errors.push('Harga modal bukan angka rupiah bulat');
    else if (
      cost !== null &&
      price !== null &&
      !Number.isNaN(price) &&
      cost > price
    )
      errors.push('Harga modal melebihi harga jual');
    const sku = cell(r, 'sku') || null;
    if (sku && (/\s/.test(sku) || sku.length < 3 || sku.length > 64))
      errors.push('SKU 3 sampai 64 karakter tanpa spasi');
    const barcode = cell(r, 'barcode') || null;
    if (
      barcode &&
      (/\s/.test(barcode) || barcode.length < 3 || barcode.length > 64)
    )
      errors.push('Barcode 3 sampai 64 karakter tanpa spasi');
    const category = cell(r, 'category') || null;
    if (category && category.length > 120)
      errors.push('Kategori maksimal 120 karakter');
    const unit = cell(r, 'unit') || null;
    if (unit && unit.length > 20) errors.push('Satuan maksimal 20 karakter');
    const stockText = cell(r, 'stock');
    let stock: number | null = null;
    if (stockText) {
      if (!/^\d+$/.test(stockText.replace(/\./g, '')))
        errors.push('Stok harus bilangan bulat');
      else {
        stock = Number(stockText.replace(/\./g, ''));
        if (stock > 1_000_000) errors.push('Stok terlalu besar');
      }
    }
    return {
      row: i + 2,
      name,
      sellingPrice: price !== null && !Number.isNaN(price) ? price : null,
      costPrice: cost !== null && !Number.isNaN(cost) ? cost : null,
      sku,
      category,
      unit,
      barcode,
      stock,
      errors,
    };
  });
  // Duplicates inside the file: the first row keeps its place, a later one is reported (never merged).
  const firstOf = (pick: (r: ImportRow) => string | null, label: string) => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const v = pick(r);
      if (!v) continue;
      const k = v.toLowerCase();
      const first = seen.get(k);
      if (first !== undefined)
        r.errors.push(`${label} ganda dengan baris ${first}`);
      else seen.set(k, r.row);
    }
  };
  firstOf((r) => r.sku, 'SKU');
  firstOf((r) => r.barcode, 'Barcode');
  firstOf((r) => r.name || null, 'Nama');
  return rows;
}
