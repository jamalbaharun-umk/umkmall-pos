/**
 * What the Aplikasi form sends. The tax is an explicit choice (it stamps "Pajak" on the Kelengkapan toko board, 0%
 * included) when the owner touched it, when there is no timezone to save, or when the timezone did not change.
 * A timezone-only change leaves the tax out, so it is not taken as a tax choice.
 */
export function appSettingsPayload(a: {
  bps: number
  taxTouched: boolean
  timezone: string | null
  tz: string
}): { taxBps?: number; timezone?: string } {
  const sendTax = a.taxTouched || a.timezone === null || a.tz === a.timezone
  return {
    ...(sendTax ? { taxBps: a.bps } : {}),
    ...(a.timezone === null ? {} : { timezone: a.tz }),
  }
}
