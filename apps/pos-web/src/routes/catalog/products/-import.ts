// UMK-2129 (design 44, screen 4): pure helpers of the product import screen. pos-api parses and checks the file.

/** A file larger than this cannot hold 500 product rows sensibly; pos-api refuses past 400 000 characters too. */
export const IMPORT_MAX_BYTES = 400_000

/** The sample the screen offers for download: the columns pos-api reads, `;` as an Indonesian Excel saves it. */
export const SAMPLE_CSV = [
  'Nama;Harga jual;Harga modal;SKU;Kategori;Satuan;Barcode;Stok',
  'Beras 5 kg;68.000;60.000;BRS-5;Sembako;karung;;10',
  'Gula 1 kg;16.500;14.000;;Sembako;pcs;;',
  'Es teh;4.000;;;Minuman;gelas;;',
].join('\r\n')

/** Why a picked file is not read (undefined when it is): a CSV, not empty, not too large. */
export function importFileError(file: { name: string; size: number; type: string }): string | undefined {
  const csv = /\.csv$/i.test(file.name) || file.type === 'text/csv'
  if (/\.xlsx?$/i.test(file.name)) return 'Berkas Excel belum bisa dibaca langsung. Di Excel pilih Simpan sebagai, lalu CSV.'
  if (!csv) return 'Pilih berkas CSV (.csv).'
  if (file.size === 0) return 'Berkas ini kosong.'
  if (file.size > IMPORT_MAX_BYTES) return 'Berkas terlalu besar. Maksimal 500 baris produk.'
  return undefined
}

/** The primary button: how many rows a save would make. */
export const saveLabel = (ok: number) => (ok === 0 ? 'Tidak ada baris yang benar' : `Simpan ${ok} baris yang benar`)

/** The summary under the table. */
export function previewSummary(p: { total: number; okCount: number; errorCount: number }): string {
  if (p.errorCount === 0) return `${p.total} baris siap disimpan.`
  return `${p.okCount} dari ${p.total} baris siap disimpan. ${p.errorCount} baris ditandai dan tidak akan disimpan; perbaiki di berkas lalu impor lagi.`
}

/** The toast after a save, and whether some rows were left out. */
type ImportOutcome = { created: number; failed: { saved?: true }[] }

/** Rows not saved at all; a row whose product was made without its opening stock is saved, with a note. */
const notSaved = (r: ImportOutcome) => r.failed.filter((f) => !f.saved).length

export function importToast(r: ImportOutcome): string {
  const n = notSaved(r)
  return n ? `${r.created} produk ditambahkan, ${n} baris tidak disimpan` : `${r.created} produk ditambahkan`
}

/** The heading of the result list: what was added, what was not saved, what was saved with a note. */
export function doneText(r: ImportOutcome): string {
  const n = notSaved(r)
  const noted = r.failed.length - n
  return [
    `${r.created} produk ditambahkan.`,
    n ? `${n} baris tidak disimpan.` : '',
    noted ? `${noted} produk tersimpan tanpa stok awal.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}
