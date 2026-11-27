import { describe, expect, it } from 'vitest'
import { isNotFoundError } from './not-found'

describe('isNotFoundError', () => {
  it('recognises the 404 wording of the screens', () => {
    expect(isNotFoundError(new Error('Data tidak ditemukan.'))).toBe(true)
    expect(isNotFoundError(new Error('Shift tidak ditemukan.'))).toBe(true)
    expect(isNotFoundError(new Error('Data tidak ditemukan, mungkin sudah dihapus.'))).toBe(true)
  })

  it('leaves other failures retryable', () => {
    expect(isNotFoundError(new Error('Gagal memuat data shift.'))).toBe(false)
    expect(isNotFoundError(new Error('Coba lagi sebentar lagi.'))).toBe(false)
    expect(isNotFoundError('tidak ditemukan')).toBe(false)
    expect(isNotFoundError(undefined)).toBe(false)
  })
})
