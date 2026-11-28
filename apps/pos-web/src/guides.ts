import { NAV } from './nav'

/**
 * THE step-by-step guides (coach marks, design 46, UMK-2134): one guide per screen in the navigation, 3 to 5 steps,
 * each step one short Indonesian sentence pointing at one element. A step's `target` is the value of a
 * `data-guide="…"` attribute on the page. The shared ones are on every page (`components/page.tsx`): `page-title`,
 * `panel` (the first panel), `guide-button`. A screen's own targets are written on its elements; `guides.test.ts`
 * fails a target no file carries and a navigation screen without a guide.
 *
 * A new screen adds its line in `nav.ts` AND its guide here (Definition of Done).
 */
export type GuideStep = { target: string; title: string; text: string }
export type Guide = { key: string; to: string; title: string; steps: GuideStep[] }

/** The targets every page built on `Page`/`Panel` has. */
export const SHARED_TARGETS = ['page-title', 'panel', 'guide-button'] as const

const replay: GuideStep = {
  target: 'guide-button',
  title: 'Putar ulang kapan saja',
  text: 'Ketuk "? Panduan" di judul halaman untuk melihat panduan ini lagi.',
}

/** A screen's three-step guide: what the screen is for, what its main panel holds, how to replay. */
const screen = (title: string, purpose: string, panel: string): GuideStep[] => [
  { target: 'page-title', title, text: purpose },
  { target: 'panel', title: 'Isi halaman', text: panel },
  replay,
]

/** The guide's key from the screen's path: "/" is "dashboard", "/catalog/products" is "catalog.products". */
export const guideKeyOf = (to: string) => (to === '/' ? 'dashboard' : to.slice(1).replace(/\//g, '.'))

const STEPS: Record<string, GuideStep[]> = {
  '/': [
    {
      target: 'page-title',
      title: 'Dashboard',
      text: 'Di sini Anda melihat penjualan, transaksi, dan untung hari ini.',
    },
    {
      target: 'dashboard-period',
      title: 'Pilih periode',
      text: 'Ganti ke minggu ini atau bulan ini, dan semua angka di bawah ikut berganti.',
    },
    replay,
  ],
  '/kasir': [
    {
      target: 'kasir-search',
      title: 'Mulai dari sini',
      text: 'Ketik nama barang atau kodenya untuk mencarinya.',
    },
    {
      target: 'kasir-scan',
      title: 'Scan barang',
      text: 'Ketuk Scan, lalu arahkan kamera ke kode batang di bungkus barang.',
    },
    {
      target: 'kasir-products',
      title: 'Pilih barang',
      text: 'Ketuk barang untuk memasukkannya ke keranjang.',
    },
    {
      target: 'kasir-cart',
      title: 'Keranjang',
      text: 'Ubah jumlah atau hapus barang di rincian pesanan ini.',
    },
    {
      target: 'kasir-pay',
      title: 'Terima pembayaran',
      text: 'Total dihitung oleh sistem; ketuk tombol ini, pilih Tunai atau QRIS, lalu struk keluar.',
    },
  ],
  '/kasir/riwayat': screen(
    'Riwayat penjualan',
    'Semua struk yang sudah dibayar ada di sini, terbaru di atas.',
    'Ketuk satu struk untuk melihat rinciannya, mencetak ulang, atau membatalkannya.',
  ),
  '/kasir/shift': screen(
    'Riwayat shift',
    'Setiap shift mencatat uang awal, penjualan, dan hitungan laci saat ditutup.',
    'Ketuk satu shift untuk melihat selisih laci dan uang masuk atau keluar.',
  ),
  '/kasir/kas-laci': screen(
    'Kas laci',
    'Catat uang yang masuk atau keluar dari laci di luar penjualan.',
    'Setiap catatan butuh alasan, supaya hitungan laci saat tutup tetap cocok.',
  ),
  '/kas-toko': screen(
    'Kas toko',
    'Kas toko adalah uang toko di luar laci kasir, misalnya setoran shift.',
    'Saldo dan riwayat uang masuk dan keluar kas toko tampil di sini.',
  ),
  '/kas-toko/setoran': screen(
    'Setoran penagih',
    'Penagih kasbon menyetor uang cicilan yang mereka pegang di sini.',
    'Daftar ini menunjukkan berapa yang masih dipegang setiap penagih.',
  ),
  '/pemasok': screen(
    'Pemasok',
    'Simpan daftar pemasok supaya pembelian dan utang tercatat rapi.',
    'Tambah pemasok baru, atau ketuk satu pemasok untuk melihat riwayatnya.',
  ),
  '/pelanggan': screen(
    'Pelanggan',
    'Simpan pelanggan tetap untuk kasbon dan riwayat belanja.',
    'Tambah pelanggan baru, atau cari dengan nama atau nomor.',
  ),
  '/metode-pembayaran': screen(
    'Metode pembayaran',
    'Atur cara bayar yang diterima toko, misalnya Tunai dan QRIS toko.',
    'Metode di daftar ini muncul sebagai pilihan saat membayar di kasir.',
  ),
  '/piutang': screen(
    'Piutang',
    'Kasbon pelanggan dan cicilannya dicatat di sini.',
    'Ketuk satu kasbon untuk menerima pembayaran atau mengirim pengingat.',
  ),
  '/pengeluaran': screen(
    'Pengeluaran',
    'Catat biaya toko seperti listrik, gaji, atau sewa.',
    'Pilih kategori supaya laporan untung rugi menghitungnya dengan benar.',
  ),
  '/pembelian': screen(
    'Pembelian',
    'Catat barang yang datang dari pemasok supaya stok dan modal bertambah.',
    'Ketuk satu pembelian untuk membayar pemasok atau meretur barang.',
  ),
  '/stok-opname': screen(
    'Stok opname',
    'Hitung stok di rak lalu bandingkan dengan stok di sistem.',
    'Selisih yang disimpan menjadi susut stok di laporan untung rugi.',
  ),
  '/catalog/products': screen(
    'Produk',
    'Semua barang yang Anda jual ada di sini, lengkap dengan harga dan stok.',
    'Tambah produk, impor dari CSV, atau ketuk produk untuk mengubah harga dan satuan.',
  ),
  '/catalog/categories': screen(
    'Kategori',
    'Kategori mengelompokkan produk supaya mudah dicari di kasir.',
    'Tambah, ubah nama, atau hapus kategori yang tidak dipakai lagi.',
  ),
  '/staf': screen(
    'Staf',
    'Tambahkan kasir atau admin yang membantu Anda di toko.',
    'Setiap staf punya PIN sendiri dan peran yang menentukan izinnya.',
  ),
  '/staf/peran': screen(
    'Peran',
    'Peran menentukan apa saja yang boleh dilakukan seorang staf.',
    'Ubah izin sebuah peran, dan semua staf dengan peran itu ikut berubah.',
  ),
  '/staf/perangkat': screen(
    'Perangkat',
    'Pasangkan HP atau tablet kasir ke toko dengan kode 6 angka.',
    'Perangkat yang tidak dipakai lagi bisa dilepas dari daftar ini.',
  ),
  '/laporan': screen(
    'Laporan',
    'Lihat penjualan, untung, dan stok untuk periode yang Anda pilih.',
    'Pilih laporan dan periode, lalu ekspor ke PDF bila perlu.',
  ),
  '/laporan/kasbon': screen(
    'Laporan kasbon',
    'Lihat siapa yang masih berutang, berapa, dan siapa yang terlambat.',
    'Ketuk nama pelanggan untuk melihat rincian kasbonnya.',
  ),
  '/laporan/penjualan-pengeluaran': screen(
    'Penjualan dan pengeluaran',
    'Bandingkan uang masuk dari penjualan dengan pengeluaran toko.',
    'Pilih harian, bulanan, atau tahunan untuk melihat polanya.',
  ),
  '/resep': screen(
    'Resep',
    'Hitung modal satu porsi dari bahan, bungkus, dan tenaga kerja.',
    'Bandingkan modal tiap resep, lalu pakai sebagai harga modal produk.',
  ),
  '/produksi': [
    {
      target: 'page-title',
      title: 'Produksi',
      text: 'Catat saat Anda memasak: bahan keluar dari stok dan barang jadi masuk stok.',
    },
    {
      target: 'produksi-filter',
      title: 'Pilih tanggal',
      text: 'Atur tanggal untuk melihat produksi di periode tertentu.',
    },
    {
      target: 'panel',
      title: 'Riwayat produksi',
      text: 'Setiap baris menunjukkan hasil rencana, hasil nyata, dan selisihnya; ketuk untuk rinciannya.',
    },
    replay,
  ],
  '/voucher': screen(
    'Voucher',
    'Buat kode voucher diskon untuk pelanggan.',
    'Atur nilai, kuota, dan masa berlaku setiap voucher di sini.',
  ),
  '/pengaturan': screen(
    'Pengaturan',
    'Atur profil toko, struk, pajak, dan QRIS toko.',
    'Nama dan alamat toko di sini tercetak di setiap struk.',
  ),
  '/pengaturan/pembayaran-online': screen(
    'Pembayaran online',
    'Aktifkan QRIS dan virtual account dari penyedia pembayaran.',
    'Status akun dan metode yang aktif tampil di sini.',
  ),
  '/perlu-ditinjau': screen(
    'Perlu ditinjau',
    'Uang online yang tidak cocok dengan penjualan muncul di sini.',
    'Tinjau setiap baris dan tandai setelah uangnya diurus.',
  ),
  '/pengaturan/log-aktivitas': screen(
    'Log aktivitas',
    'Catatan siapa melakukan apa, misalnya pembatalan struk atau perubahan staf.',
    'Saring berdasarkan staf atau jenis kegiatan untuk mencari kejadian tertentu.',
  ),
  '/pengaturan/panduan': screen(
    'Panduan',
    'Semua panduan layar ada di sini, dengan tanda sudah atau belum dilihat.',
    'Ketuk Ulangi untuk memutar lagi panduan sebuah layar.',
  ),
  '/pengaturan/keamanan': screen(
    'Keamanan',
    'Atur PIN untuk menyetujui pembatalan struk dan diskon besar.',
    'Ubah PIN di sini; PIN pemilik butuh masuk ulang lewat WhatsApp.',
  ),
}

/** Every guide, one per navigation screen, in navigation order. */
export const GUIDES: Guide[] = NAV.flatMap((g) => g.items).flatMap((item) => {
  const steps = STEPS[item.to]
  return steps ? [{ key: guideKeyOf(item.to), to: item.to, title: item.label, steps }] : []
})

/** The guide of a path, only for the screen itself (a sub-page such as "/catalog/products/baru" has none). */
export const guideFor = (pathname: string): Guide | undefined => {
  const path = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname
  return GUIDES.find((g) => g.to === path)
}

/** Paths where a guide never starts on its own: the cashier PIN sign-in and the receipt print page. */
export const NO_AUTO_START = [/^\/kasir\/masuk/, /^\/kasir\/struk\//]

/** Exported for the test: the raw table, to find screens without a guide. */
export const GUIDE_STEPS = STEPS
