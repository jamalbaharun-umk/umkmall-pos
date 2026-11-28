import {
  Alert,
  Badge,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Upload,
} from '@umkmall/ui/primitives'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { ActionRow } from '@/components/action-row'
import { NoAccess, Page, Panel, rupiah } from '@/components/page'
import { useCan } from '@/components/shell'
import { notifySuccess, showError } from '@/lib/feedback'
import { previewImport, runImport, type ImportPreview, type ImportResult } from '../-api'
import { importFileError, importToast, previewSummary, SAMPLE_CSV, saveLabel } from './-import'

export const Route = createFileRoute('/catalog/products/impor')({
  component: ImportProducts,
})

type State =
  | { step: 'pick' }
  | { step: 'reading'; fileName: string }
  | { step: 'preview'; fileName: string; csv: string; preview: ImportPreview }
  | { step: 'saving'; fileName: string; csv: string; preview: ImportPreview }
  | { step: 'done'; result: ImportResult }

const SAMPLE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${SAMPLE_CSV}`)}`

/**
 * UMK-2129 "Impor produk" (design 44, screen 4): pick a CSV (an Excel sheet saved as CSV, or a Moka/Majoo export),
 * see every row with what is wrong with it, then save the rows that are right. Up to 500 rows; a SKU, barcode or
 * name already in the store is reported, never overwritten.
 */
function ImportProducts() {
  const canEdit = useCan('catalog.manage')
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ step: 'pick' })
  const [fileError, setFileError] = useState<string>()
  const busy = useRef(false)

  async function read(file: File) {
    const refused = importFileError(file)
    setFileError(refused)
    if (refused) return
    setState({ step: 'reading', fileName: file.name })
    try {
      const csv = await file.text()
      const r = await previewImport({ data: csv })
      if (!r.ok) {
        setState({ step: 'pick' })
        showError(r, { action: 'membaca berkas', fallback: 'Berkas belum bisa dibaca.' })
        return
      }
      setState({ step: 'preview', fileName: file.name, csv, preview: r.data })
    } catch (e) {
      setState({ step: 'pick' })
      showError(e, { action: 'membaca berkas', fallback: 'Berkas belum bisa dibaca.' })
    }
  }

  async function save() {
    if (state.step !== 'preview' || busy.current) return
    busy.current = true
    const { fileName, csv, preview } = state
    setState({ step: 'saving', fileName, csv, preview })
    try {
      const r = await runImport({ data: csv })
      if (!r.ok) {
        setState({ step: 'preview', fileName, csv, preview })
        showError(r, { action: 'menyimpan produk', retry: () => void save() })
        return
      }
      notifySuccess(importToast(r.data))
      if (r.data.failed.length === 0) void navigate({ to: '/catalog/products' })
      else setState({ step: 'done', result: r.data })
    } catch (e) {
      setState({ step: 'preview', fileName, csv, preview })
      showError(e, { action: 'menyimpan produk', retry: () => void save() })
    } finally {
      busy.current = false
    }
  }

  return (
    <Page title="Impor produk" crumbs={[{ label: 'Produk', to: '/catalog/products' }, { label: 'Impor' }]}>
      {!canEdit ? (
        <NoAccess permission="Mengelola katalog" />
      ) : state.step === 'done' ? (
        <Done result={state.result} onAgain={() => setState({ step: 'pick' })} />
      ) : (
        <Panel className="flex flex-col gap-4 p-4 md:p-6">
          <Upload
            label="Berkas"
            accept=".csv,text/csv"
            filled={state.step !== 'pick'}
            busy={state.step === 'reading'}
            onFilesChange={(files) => files[0] && void read(files[0])}
            helperText="CSV dari Excel, Moka, atau Majoo. Kolom wajib: Nama dan Harga jual."
            browseLabel="Pilih"
            error={fileError}
          >
            {state.step === 'pick' ? 'Tarik berkas CSV ke sini atau pilih dari perangkat' : state.fileName}
          </Upload>
          <p className="text-sm text-default-secondary">
            Maksimal 500 baris. SKU, barcode, atau nama yang sudah ada tidak menimpa produk lama.{' '}
            <a href={SAMPLE_HREF} download="contoh-impor-produk.csv" className="font-semibold text-default-brand underline">
              Unduh contoh CSV
            </a>
          </p>
          {state.step === 'reading' && (
            <div className="flex flex-col gap-2" aria-label="Membaca berkas">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
          {(state.step === 'preview' || state.step === 'saving') && (
            <>
              <PreviewTable preview={state.preview} />
              <p className="text-sm text-default-secondary">{previewSummary(state.preview)}</p>
              <ActionRow>
                <Button width="auto" type="outline" color="light" disabled={state.step === 'saving'} onClick={() => setState({ step: 'pick' })}>
                  Pilih berkas lain
                </Button>
                <Button width="auto" disabled={state.step === 'saving' || state.preview.okCount === 0} onClick={() => void save()}>
                  {saveLabel(state.preview.okCount)}
                </Button>
              </ActionRow>
            </>
          )}
        </Panel>
      )}
    </Page>
  )
}

function PreviewTable({ preview }: { preview: ImportPreview }) {
  return (
    <Table density="comfortable" containerClassName="border border-border-light rounded-xl" className="whitespace-nowrap">
      <TableHeader>
        <TableRow>
          <TableHead className="text-right">Baris</TableHead>
          <TableHead>Nama</TableHead>
          <TableHead className="text-right">Harga</TableHead>
          <TableHead>Keterangan</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {preview.rows.map((r) => (
          <TableRow key={r.row}>
            <TableCell className="text-right tabular-nums">{r.row}</TableCell>
            <TableCell>{r.name || '–'}</TableCell>
            <TableCell className="text-right tabular-nums">{r.sellingPrice === null ? '–' : rupiah(r.sellingPrice)}</TableCell>
            <TableCell className="min-w-48 whitespace-normal">
              {r.status === 'ok' ? (
                <Badge color="success" size="small">
                  OK
                </Badge>
              ) : (
                <span className="text-sm text-default-error">{r.errors.join('; ')}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Some rows were not saved (another session took a SKU meanwhile, or they were marked in the preview). */
function Done({ result, onAgain }: { result: ImportResult; onAgain: () => void }) {
  return (
    <Panel className="flex flex-col gap-4 p-4 md:p-6">
      <Alert variant="warning" size="small">
        {result.created} produk ditambahkan. {result.failed.length} baris tidak disimpan:
      </Alert>
      <ul className="flex flex-col gap-1 text-sm">
        {result.failed.map((f) => (
          <li key={f.row}>
            <span className="font-semibold">Baris {f.row}</span> {f.name ? `(${f.name})` : ''}: {f.errors.join('; ')}
          </li>
        ))}
      </ul>
      <ActionRow>
        <Button width="auto" type="outline" color="light" onClick={onAgain}>
          Impor berkas lain
        </Button>
        <Button width="auto" asChild>
          <Link to="/catalog/products">Lihat produk</Link>
        </Button>
      </ActionRow>
    </Panel>
  )
}
