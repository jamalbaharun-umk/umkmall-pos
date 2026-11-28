import type { ProductType } from '../db/schema/catalog';

/**
 * UMK-2128: business-type templates (design 44, the seven segments of the BD research). A template gives a new
 * store its categories, units and 20 to 30 sample products with NO price: they are written inactive at Rp0 and
 * reach the till only once the owner fills the price ("Isi harga"). Every template also gives Tunai and "QRIS toko"
 * and records the tax as 0% when the store has not chosen one yet.
 *
 * Products are `non_stock` (sold at once, no stock-in needed for the first receipt) except services. An owner who
 * wants stock kept switches the product to "Produk" later.
 */
export type TemplateProduct = { name: string; unit: string };
export type TemplateCategory = { name: string; products: TemplateProduct[] };
export type BusinessTemplate = {
  key: string;
  name: string;
  description: string;
  type: Extract<ProductType, 'non_stock' | 'service'>;
  categories: TemplateCategory[];
};

const p = (unit: string, ...names: string[]): TemplateProduct[] =>
  names.map((name) => ({ name, unit }));

export const TEMPLATE_PAYMENT_METHODS = [
  { name: 'Tunai', kind: 'cash' },
  { name: 'QRIS toko', kind: 'wallet' },
] as const;

export const BUSINESS_TEMPLATES: BusinessTemplate[] = [
  {
    key: 'warung_makan',
    name: 'Warung makan',
    description: 'Nasi, lauk, mi, dan minuman.',
    type: 'non_stock',
    categories: [
      {
        name: 'Nasi',
        products: p(
          'PORSI',
          'Nasi putih',
          'Nasi goreng',
          'Nasi uduk',
          'Nasi rames',
          'Nasi ayam goreng',
          'Nasi telur balado',
        ),
      },
      {
        name: 'Lauk',
        products: p(
          'PCS',
          'Ayam goreng',
          'Ayam bakar',
          'Telur dadar',
          'Tempe goreng',
          'Tahu goreng',
          'Ikan goreng',
          'Perkedel',
        ),
      },
      {
        name: 'Mi dan sup',
        products: p('PORSI', 'Mi goreng', 'Mi rebus', 'Soto ayam', 'Sop iga'),
      },
      {
        name: 'Minuman',
        products: p(
          'GELAS',
          'Teh es',
          'Teh hangat',
          'Jeruk es',
          'Kopi hitam',
          'Air mineral',
          'Es campur',
          'Jus alpukat',
        ),
      },
    ],
  },
  {
    key: 'warung_kelontong',
    name: 'Warung kelontong',
    description: 'Sembako, makanan ringan, minuman, dan kebutuhan rumah.',
    type: 'non_stock',
    categories: [
      {
        name: 'Sembako',
        products: [
          ...p('KG', 'Beras', 'Gula pasir', 'Telur ayam', 'Tepung terigu'),
          ...p(
            'PCS',
            'Minyak goreng 1 L',
            'Garam',
            'Kecap manis',
            'Saus sambal',
            'Mentega',
          ),
        ],
      },
      {
        name: 'Mi dan makanan instan',
        products: p(
          'PCS',
          'Mi instan goreng',
          'Mi instan kuah',
          'Bubur instan',
          'Sarden kaleng',
        ),
      },
      {
        name: 'Makanan ringan',
        products: p(
          'PCS',
          'Keripik singkong',
          'Biskuit',
          'Wafer',
          'Kacang kulit',
          'Permen',
        ),
      },
      {
        name: 'Minuman',
        products: p(
          'PCS',
          'Air mineral 600 ml',
          'Teh botol',
          'Kopi saset',
          'Susu kotak',
          'Minuman bersoda',
        ),
      },
      {
        name: 'Kebutuhan rumah',
        products: p(
          'PCS',
          'Sabun mandi',
          'Sampo saset',
          'Pasta gigi',
          'Deterjen',
          'Sabun cuci piring',
          'Tisu',
          'Gas elpiji 3 kg',
        ),
      },
    ],
  },
  {
    key: 'kafe_minuman',
    name: 'Kafe dan minuman',
    description: 'Kopi, teh, minuman dingin, dan camilan.',
    type: 'non_stock',
    categories: [
      {
        name: 'Kopi',
        products: p(
          'GELAS',
          'Espresso',
          'Americano',
          'Kopi susu',
          'Cappuccino',
          'Latte',
          'Kopi susu gula aren',
          'Mocha',
        ),
      },
      {
        name: 'Non kopi',
        products: p(
          'GELAS',
          'Cokelat',
          'Matcha latte',
          'Teh tarik',
          'Lemon tea',
          'Thai tea',
          'Red velvet',
        ),
      },
      {
        name: 'Minuman segar',
        products: p('GELAS', 'Es jeruk', 'Soda gembira', 'Air mineral'),
      },
      {
        name: 'Camilan',
        products: p(
          'PORSI',
          'Kentang goreng',
          'Roti bakar',
          'Pisang goreng',
          'Cireng',
          'Croissant',
          'Dimsum',
        ),
      },
    ],
  },
  {
    key: 'kue_roti',
    name: 'Kue dan roti',
    description: 'Roti, kue basah, kue kering, dan pesanan.',
    type: 'non_stock',
    categories: [
      {
        name: 'Roti',
        products: p(
          'PCS',
          'Roti tawar',
          'Roti cokelat',
          'Roti keju',
          'Roti sosis',
          'Donat',
        ),
      },
      {
        name: 'Kue basah',
        products: p(
          'PCS',
          'Bolu pandan',
          'Brownies',
          'Lapis legit',
          'Kue lumpur',
          'Klepon',
          'Dadar gulung',
          'Risoles',
        ),
      },
      {
        name: 'Kue kering',
        products: p(
          'TOPLES',
          'Nastar',
          'Kastengel',
          'Putri salju',
          'Kue kacang',
        ),
      },
      {
        name: 'Pesanan',
        products: p(
          'PCS',
          'Kue ulang tahun',
          'Tumpeng mini',
          'Snack box',
          'Bolu gulung',
        ),
      },
    ],
  },
  {
    key: 'fashion',
    name: 'Fashion dan aksesoris',
    description: 'Pakaian, hijab, sepatu, dan aksesoris.',
    type: 'non_stock',
    categories: [
      {
        name: 'Atasan',
        products: p(
          'PCS',
          'Kaos polos',
          'Kemeja',
          'Blus',
          'Tunik',
          'Kaos anak',
        ),
      },
      {
        name: 'Bawahan',
        products: p('PCS', 'Celana jin', 'Celana kain', 'Rok', 'Celana pendek'),
      },
      {
        name: 'Gamis dan hijab',
        products: p(
          'PCS',
          'Gamis',
          'Hijab segi empat',
          'Hijab instan',
          'Ciput',
          'Mukena',
        ),
      },
      {
        name: 'Aksesoris',
        products: p(
          'PCS',
          'Tas',
          'Dompet',
          'Ikat pinggang',
          'Kaus kaki',
          'Sandal',
          'Sepatu',
          'Jam tangan',
        ),
      },
    ],
  },
  {
    key: 'atk_fotokopi',
    name: 'ATK dan fotokopi',
    description: 'Alat tulis, kertas, fotokopi, dan cetak.',
    type: 'non_stock',
    categories: [
      {
        name: 'Alat tulis',
        products: p(
          'PCS',
          'Pulpen',
          'Pensil',
          'Penghapus',
          'Penggaris',
          'Spidol',
          'Stabilo',
          'Tip-ex',
          'Lem kertas',
        ),
      },
      {
        name: 'Kertas dan buku',
        products: p(
          'PCS',
          'Buku tulis',
          'Kertas HVS A4 (rim)',
          'Map plastik',
          'Amplop',
          'Kertas kado',
        ),
      },
      {
        name: 'Fotokopi dan cetak',
        products: p(
          'LEMBAR',
          'Fotokopi hitam putih',
          'Fotokopi warna',
          'Cetak hitam putih',
          'Cetak warna',
          'Scan dokumen',
          'Laminating',
        ),
      },
      {
        name: 'Jilid',
        products: p('PCS', 'Jilid lakban', 'Jilid spiral', 'Jilid hard cover'),
      },
    ],
  },
  {
    key: 'jasa',
    name: 'Jasa salon dan laundry',
    description: 'Potong rambut, perawatan, dan cuci pakaian.',
    type: 'service',
    categories: [
      {
        name: 'Rambut',
        products: p(
          'KALI',
          'Potong rambut pria',
          'Potong rambut wanita',
          'Potong rambut anak',
          'Cuci dan blow',
          'Creambath',
          'Smoothing',
          'Pewarnaan rambut',
        ),
      },
      {
        name: 'Perawatan',
        products: p('KALI', 'Facial', 'Manicure', 'Pedicure', 'Pijat refleksi'),
      },
      {
        name: 'Laundry',
        products: [
          ...p(
            'KG',
            'Cuci kering',
            'Cuci setrika',
            'Setrika saja',
            'Kilat 1 hari',
          ),
          ...p('PCS', 'Bed cover', 'Selimut', 'Jas', 'Sepatu', 'Boneka'),
        ],
      },
    ],
  },
];

export const templateProducts = (t: BusinessTemplate) =>
  t.categories.flatMap((c) =>
    c.products.map((prod) => ({ ...prod, category: c.name })),
  );

export const findTemplate = (key: string) =>
  BUSINESS_TEMPLATES.find((t) => t.key === key);
