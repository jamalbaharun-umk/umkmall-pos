import { createFileRoute } from '@tanstack/react-router'

// U0 shell. U1 replaces this with the UMKMall sign-in handoff and the store dashboard.
export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold text-ink">UMKMall Kasir</h1>
      <p className="text-ink-muted">Masuk lewat akun UMKMall kamu untuk membuka toko.</p>
    </main>
  )
}
