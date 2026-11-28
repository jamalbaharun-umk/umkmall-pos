import { ImportFileError, parseCsv, parseMoney, readRows } from './import';

describe('product import parsing (UMK-2129)', () => {
  it('reads rupiah as whole numbers and refuses fractions or words', () => {
    expect(parseMoney('68000')).toBe(68000);
    expect(parseMoney('68.000')).toBe(68000);
    expect(parseMoney('68,000')).toBe(68000);
    expect(parseMoney('Rp 68.000')).toBe(68000);
    expect(parseMoney('Rp16.500')).toBe(16500);
    expect(parseMoney('68.000,00')).toBe(68000);
    expect(parseMoney('68,000.00')).toBe(68000);
    expect(parseMoney('1.250.000')).toBe(1250000);
    expect(parseMoney('')).toBeNull();
    for (const bad of [
      'abc',
      '1,5',
      '16.5',
      '-1',
      '68.000,50',
      '1.2.3',
      '6.80',
    ])
      expect(parseMoney(bad)).toBeNaN();
  });

  it('parses quoted cells and picks the delimiter of the header line', () => {
    expect(parseCsv('Nama;Harga\n"Kopi; susu";5.000\r\n')).toEqual([
      ['Nama', 'Harga'],
      ['Kopi; susu', '5.000'],
    ]);
    expect(parseCsv('\uFEFFnama,harga\n"Teh ""manis""","3,000"\n\n')).toEqual([
      ['nama', 'harga'],
      ['Teh "manis"', '3,000'],
    ]);
    expect(() => parseCsv('Nama,Harga\n"Kopi,5000')).toThrow(ImportFileError);
  });

  it('checks each row and reports duplicates inside the file against the first row', () => {
    const rows = readRows(
      [
        'Nama;Harga jual;Harga modal;SKU;Kategori;Satuan;Stok',
        'Beras 5 kg;Rp68.000;60.000;BRS-5;Sembako;karung;10',
        'Gula 1 kg;16.500;;;;;',
        'Minyak 1 L;abc;;;;;',
        'Beras 5 kg;68000;;BRS-5;;;',
        ';1000;2000;a b;;;x',
      ].join('\n'),
    );
    expect(rows.map((r) => [r.row, r.errors])).toEqual([
      [2, []],
      [3, []],
      [4, ['Harga jual bukan angka rupiah bulat']],
      [5, ['SKU ganda dengan baris 2', 'Nama ganda dengan baris 2']],
      [
        6,
        [
          'Nama wajib diisi',
          'Harga modal melebihi harga jual',
          'SKU 3 sampai 64 karakter tanpa spasi',
          'Stok harus bilangan bulat',
        ],
      ],
    ]);
    expect(rows[0]).toMatchObject({
      sellingPrice: 68000,
      costPrice: 60000,
      sku: 'BRS-5',
      category: 'Sembako',
      unit: 'karung',
      stock: 10,
    });
    // No stock cell: the product does not track stock.
    expect(rows[1]).toMatchObject({ stock: null, costPrice: null, sku: null });
  });

  it('refuses a whole file without the name and price columns, empty, or over 500 rows', () => {
    expect(() => readRows('Produk;Modal\nKopi;1000')).toThrow(
      'Kolom "Nama" dan "Harga jual"',
    );
    expect(() => readRows('')).toThrow('Berkas ini kosong.');
    expect(() => readRows('Nama,Harga\n')).toThrow('hanya ada baris judul');
    const big = [
      'Nama,Harga',
      ...Array.from({ length: 501 }, (_, i) => `P${i},1000`),
    ].join('\n');
    expect(() => readRows(big)).toThrow('Maksimal 500 baris');
    const ok = [
      'Nama,Harga',
      ...Array.from({ length: 500 }, (_, i) => `P${i},1000`),
    ].join('\n');
    expect(readRows(ok)).toHaveLength(500);
  });

  it('knows Moka/Majoo-style English headers', () => {
    const [r] = readRows(
      'Item Name,Price,Cost,Category,Barcode\nEs teh,4000,1500,Minuman,899100',
    );
    expect(r).toMatchObject({
      name: 'Es teh',
      sellingPrice: 4000,
      costPrice: 1500,
      category: 'Minuman',
      barcode: '899100',
      errors: [],
    });
  });
});
