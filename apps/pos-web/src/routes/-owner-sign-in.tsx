import { Alert, Button, CheckBox, Dialog, OtpInput, TextField } from '@umkmall/ui/primitives'
import { Card } from '@umkmall/ui/compositions'
import { MessageCircle, Store } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { showError } from '@/lib/feedback'
import { WHATSAPP_NOT_SET_UP, WHATSAPP_NOT_SET_UP_TEXT, failureText } from '@/lib/sign-in'
import { requestOtp, verifyOtp, type Consent, type ConsentAsk, type OtpFailure } from './-otp-api'

/** Seconds before "Kirim ulang kode" opens again, as on UMKMall's own login. */
const RESEND_SECONDS = 60

/**
 * Lakasir's login card, with UMKMall's WhatsApp sign-in for the owner (UMK-2065): number, then the code UMKMall sends.
 * A new number, or a new policy version, first asks for consent (UMKMall's rule). Mistakes in the input show under
 * the field; failures that stop the sign-in open the error dialog. Success lands with the "Berhasil masuk" toast.
 */
export function OwnerSignIn({ failed, devSignIn }: { failed?: number; devSignIn: boolean }) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [otpLength, setOtpLength] = useState(6)
  const [consent, setConsent] = useState<Consent>()
  const [ask, setAsk] = useState<ConsentAsk>()
  const [fieldError, setFieldError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [notSetUp, setNotSetUp] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  /** A refusal that names the field stays under it; consent opens its dialog; anything else is the error dialog. */
  function handle(f: OtpFailure, field: 'phone' | 'otp', action: string, retry: () => void) {
    if (f.code === WHATSAPP_NOT_SET_UP) return setNotSetUp(true)
    if (f.code === 'consent_required' && f.consent) return setAsk(f.consent)
    if (f.status === 422) return setFieldError(f.errors?.[field] ?? f.error ?? 'Isian belum benar.')
    showError(f, { action, retry })
  }

  async function sendCode(given = consent) {
    setBusy(true)
    setFieldError(undefined)
    try {
      const r = await requestOtp({ data: { phone, ...(given && { consent: given }) } })
      if (!r.ok) return handle(r, 'phone', 'mengirim kode', () => void sendCode(given))
      setOtpLength(r.otpLength)
      setOtp('')
      setStep('otp')
      setResendIn(RESEND_SECONDS)
    } catch (error) {
      showError(error, { action: 'mengirim kode', retry: () => void sendCode(given) })
    } finally {
      setBusy(false)
    }
  }

  async function verify(code: string) {
    if (busy || code.length < otpLength) return
    setBusy(true)
    setFieldError(undefined)
    try {
      const r = await verifyOtp({ data: { phone, otp: code, ...(consent && { consent }) } })
      if (r.ok) return window.location.assign(r.landing) // a full load, so the shell reads the new session
      setOtp('')
      handle(r, 'otp', 'masuk', () => void verify(code))
    } catch (error) {
      showError(error, { action: 'masuk', retry: () => void verify(code) })
    } finally {
      setBusy(false)
    }
  }

  const submitPhone = (e: FormEvent) => {
    e.preventDefault()
    void sendCode()
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-default-secondary px-4">
      <Card variant="outlined" padding="large" className="flex w-full max-w-md flex-col items-center gap-5 bg-default-primary text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-weak-brand text-default-brand">
          <Store className="size-6" aria-hidden />
        </span>
        {failed !== undefined && (
          <Alert variant="danger" className="w-full text-left">
            {failureText(failed)}
          </Alert>
        )}
        {notSetUp ? (
          <>
            <h1 className="text-2xl font-bold text-default-primary">Masuk ke Kasir</h1>
            <Alert variant="info" className="w-full text-left">
              {WHATSAPP_NOT_SET_UP_TEXT} Kasir tetap bisa masuk dengan PIN.
            </Alert>
          </>
        ) : step === 'phone' ? (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold text-default-primary">Masuk ke Kasir</h1>
              <p className="text-sm text-default-secondary">Pemilik toko masuk dengan nomor WhatsApp akun UMKMall.</p>
            </div>
            <form onSubmit={submitPhone} noValidate className="flex w-full flex-col gap-4 text-left">
              <TextField
                id="owner-phone"
                label="Nomor WhatsApp"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="081234567890"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value.replace(/[^0-9+ -]/g, ''))
                  setFieldError(undefined)
                }}
                error={fieldError}
                maxLength={20}
                disabled={busy}
                autoFocus
              />
              <p className="-mt-2 text-xs text-default-secondary">Kode verifikasi dikirim lewat WhatsApp.</p>
              <Button htmlType="submit" type="primary" color="primary" width="full" disabled={busy || phone.replace(/\D/g, '').length < 8}>
                {busy ? 'Mengirim...' : 'Kirim kode'}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold text-default-primary">Masukkan kode</h1>
              <p className="text-sm text-default-secondary">Kami mengirim kode {otpLength} digit ke WhatsApp di bawah ini.</p>
            </div>
            <div className="flex w-full items-center gap-2 text-left">
              <span className="flex size-6 items-center justify-center rounded-full bg-default-success text-default-invert">
                <MessageCircle className="size-3.5" aria-hidden />
              </span>
              <span className="font-semibold text-default-primary">{phone}</span>
              <Button
                type="text"
                size="small"
                width="auto"
                className="ml-auto"
                disabled={busy}
                onClick={() => {
                  setStep('phone')
                  setFieldError(undefined)
                }}
              >
                Ubah
              </Button>
            </div>
            <OtpInput
              id="owner-otp"
              aria-label="Kode verifikasi"
              className="items-center"
              length={otpLength}
              value={otp}
              onChange={(v) => {
                setOtp(v)
                setFieldError(undefined)
              }}
              onComplete={(v) => void verify(v)}
              error={fieldError}
              disabled={busy}
              autoFocus
            />
            {resendIn > 0 ? (
              <p className="text-sm text-default-secondary">
                Kirim ulang kode dalam <span className="font-semibold text-default-brand">{formatWait(resendIn)}</span>
              </p>
            ) : (
              <Button type="text" size="small" width="auto" disabled={busy} onClick={() => void sendCode()}>
                Kirim ulang kode
              </Button>
            )}
            <Button type="primary" color="primary" width="full" disabled={busy || otp.length < otpLength} onClick={() => void verify(otp)}>
              {busy ? 'Memeriksa...' : 'Masuk'}
            </Button>
          </>
        )}
        <Button asChild type="outline" color="primary" width="full">
          <a href="/kasir/masuk">Masuk sebagai kasir (PIN)</a>
        </Button>
        {devSignIn && (
          <form method="post" action="/masuk/dev" className="w-full">
            <Button htmlType="submit" type="outline" color="primary" width="full">
              Masuk (pengembangan)
            </Button>
          </form>
        )}
      </Card>
      {ask && (
        <ConsentDialog
          ask={ask}
          busy={busy}
          onClose={() => setAsk(undefined)}
          onAgree={(given) => {
            setAsk(undefined)
            setConsent(given)
            // agreed before the code was sent: send it now; at the code step (a policy changed meanwhile) try the code again
            if (step === 'phone') void sendCode(given)
          }}
        />
      )}
    </main>
  )
}

/** UMKMall's consent for a new account or a new policy version: both policies, and the age when UMKMall asks for it. */
function ConsentDialog({
  ask,
  busy,
  onClose,
  onAgree,
}: {
  ask: ConsentAsk
  busy: boolean
  onClose: () => void
  onAgree: (consent: Consent) => void
}) {
  const [policies, setPolicies] = useState(false)
  const [age, setAge] = useState(false)
  const ready = policies && (!ask.needsAgeConfirmation || age)
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Aturan Pemakaian UMKMall" size="medium">
      <div className="flex flex-col gap-4 px-6 pt-2 pb-6 text-sm text-default-primary">
        <p>Sebelum melanjutkan, setujui Syarat &amp; Ketentuan dan Kebijakan Privasi UMKMall.</p>
        <CheckBox
          id="consent-policies"
          label={
            <span>
              Saya setuju dengan{' '}
              <a href={ask.links.tos} target="_blank" rel="noreferrer" className="text-default-brand underline">
                Syarat &amp; Ketentuan
              </a>{' '}
              dan{' '}
              <a href={ask.links.privacy} target="_blank" rel="noreferrer" className="text-default-brand underline">
                Kebijakan Privasi
              </a>{' '}
              UMKMall.
            </span>
          }
          checked={policies}
          onChange={(e) => setPolicies(e.target.checked)}
        />
        {ask.needsAgeConfirmation && (
          <CheckBox
            id="consent-age"
            label="Saya berusia 18 tahun atau lebih."
            checked={age}
            onChange={(e) => setAge(e.target.checked)}
          />
        )}
        <div className="flex flex-col gap-2 md:flex-row-reverse md:justify-start">
          <Button
            type="primary"
            size="medium"
            width="auto"
            className="w-full md:w-auto"
            disabled={!ready || busy}
            onClick={() =>
              onAgree({
                ...(ask.tos && { tosVersionId: ask.tos.id }),
                ...(ask.privacy && { privacyVersionId: ask.privacy.id }),
                ...(ask.needsAgeConfirmation && { ageConfirmed: true }),
              })
            }
          >
            Setuju dan lanjutkan
          </Button>
          <Button type="outline" color="light" size="medium" width="auto" className="w-full md:w-auto" onClick={onClose}>
            Batal
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

const formatWait = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
