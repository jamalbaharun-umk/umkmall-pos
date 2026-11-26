<div align="center">

# 🏪 UMKMall POS

**A multi-tenant point of sale for Indonesian small businesses (UMKM), built to complement UMKMall.**

Sell at the counter or on a phone · Track stock, cash and credit · See today's profit

[User guide](#-user-guide) · [Architecture](#-architecture) · [Local setup](#-run-it-locally) · [Apps and packages](#-apps-and-packages)

<img src="docs/screenshots/53-kasir-desktop.png" alt="Cashier screen on a desktop" width="68%" />
<img src="docs/screenshots/21-hp-qris-menunggu.png" alt="Dynamic QRIS payment on a phone" width="21%" />

</div>

---

## 📦 What it is

UMKMall POS runs a shop's daily work: catalog, stock, cashier sales with shifts, customers, vouchers, store credit
(*kasbon*), expenses and reports. It is a port of [Lakasir](https://github.com/lakasir/lakasir), rebuilt on NestJS and
TanStack Start, and licensed **GPL-3.0-or-later** (see [LICENSE](LICENSE) and [NOTICE](NOTICE)).

**How it complements UMKMall**

- The owner signs in with their **UMKMall account** (shared login cookie on `.umkmall.id`). There is no second password.
- One UMKMall account is one store. Cashiers are local POS users who sign in with a PIN on a paired device.
- When a UMKMall account is erased, UMKMall calls the POS purge endpoint, which deletes that store's data.
- **Planned:** entering data through UMKMall's assistant by way of a **POS MCP server**, so an owner can ask the
  assistant to add products or record purchases. That MCP server is **not in this repository yet**; today all data is
  entered on the screens below.

The app's interface is in **Indonesian**. This documentation is in English and quotes the on-screen labels exactly,
**in bold**.

## ✨ Features at a glance

| Area | What you can do |
|---|---|
| 🧾 Selling | Cashier screen, discounts, vouchers, notes, customers, cash / debit / static QRIS / kasbon, receipts |
| 📱 Online payments | Dynamic QRIS and virtual accounts (test gateway only for now), switch to cash, refunds |
| 💵 Cash control | Shifts, drawer in/out, shift closing with differences, store cash, collector deposits |
| 📚 Inventory | Products, categories, barcodes, extra units, wholesale prices, purchases, suppliers, stock counts |
| 👥 People | Staff with PINs, roles and permissions, paired cashier devices |
| 📊 Money | Receivables, expenses, sales / product / cashier / purchase reports, profit and loss, CSV export |
| 🔒 Safety | Void with a supervisor PIN, per-store data isolation, PIN lockout |

## 🏗 Architecture

```mermaid
flowchart LR
  B["Browser<br/>desktop or phone"] --> W["pos-web<br/>TanStack Start · :3101"]
  W -->|HTTP| A["pos-api<br/>NestJS · :3000"]
  A -->|service key + tenant header| P["payment-api<br/>NestJS · :3001"]
  A --> D1[("Postgres<br/>schema pos")]
  P --> D2[("Postgres database payment<br/>schema payment")]
  A -->|"/api/auth/me"| U["UMKMall web<br/>owner sign-in"]
  P -.->|adapter| G["Payment gateway<br/>fake, local only"]
  UI["@umkmall/ui"] --- W
```

- **Tenant isolation:** the store comes only from the signed-in session; every table is in its own schema with a
  `tenant_id` and row-level security enabled.
- **Money is integer rupiah.** The server computes every price and total. Tax is applied after discounts.
- **Safe retries:** creating a sale uses an idempotency key, so pressing the button again never records it twice.
- **Payments are a separate service.** Only payment-api talks to gateway adapters; the POS never receives identity
  documents or bank account numbers.

## 🧩 Apps and packages

| Path | What it is | README |
|---|---|---|
| `apps/pos-web` | Merchant web app (desktop and phone) | [pos-web](apps/pos-web/README.md) |
| `apps/pos-api` | POS business API | [pos-api](apps/pos-api/README.md) |
| `apps/payment-api` | Payment records and gateway adapters | [payment-api](apps/payment-api/README.md) |
| `packages/ui` | Vendored copy of `@umkmall/ui` | [ui](packages/ui/README.md) · [copy notes](packages/ui/POS-COPY.md) |

## 🎨 UI rules

- The interface uses **only `@umkmall/ui`** (primitives, compositions, layouts) with the **UMKMall admin theme**
  (`apps/pos-web/src/styles/app.css`).
- Every action answers: a **success toast** when it worked, or a **clear error dialog** saying what happened
  (**Apa yang terjadi**), what to do (**Yang bisa dilakukan**) and the error code.
- Every screen has loading, empty and error states, and works on **desktop and phone**.

<img src="docs/screenshots/55-dialog-gagal.png" alt="Error dialog" width="66%" /> <img src="docs/screenshots/57-hp-menu.png" alt="Phone menu" width="22%" />

## 🛠 Libraries

| Where | Libraries (see each `package.json`) |
|---|---|
| Repository | npm workspaces, Turborepo, commitlint, Node.js 22+ |
| APIs | NestJS 11, Drizzle ORM and drizzle-kit, `postgres` driver, zod, RxJS; `jose` (pos-api); Jest and Supertest |
| Web | React 19, TanStack Start and Router, Vite 8, Nitro, Tailwind CSS 4, `tw-animate-css`, lucide-react, `qrcode-generator`; Vitest |
| UI package | Radix UI (dialog, dropdown, popover, tooltip), TanStack Table, class-variance-authority, clsx, tailwind-merge, react-day-picker, sonner |
| Database | PostgreSQL 16 (Docker Compose for local work) |

## 🚀 Run it locally

You need **Node.js 22+** and **Docker**.

### Quick way (the maintainer's machine)

The maintainer keeps helper scripts in `.local-qa/`. That folder is **deliberately not committed**, so a fresh clone
does not have it; use the manual steps below instead.

| Command | What it does |
|---|---|
| `.local-qa/start.sh` | Starts Postgres, builds and migrates both APIs, runs pos-web at http://localhost:3101 |
| `.local-qa/seed.sh` | Fills a demo store (run after the first start) |
| `.local-qa/stop.sh` | Stops everything and keeps the data |
| `.local-qa/reset.sh` | **Deletes all QA data** and seeds again |
| `.local-qa/fakepg.sh` | Plays the payment gateway: pay, fail, expire, refund, approve the store's account |

`.local-qa/PANDUAN.md` is the Indonesian guide to these scripts. Demo logins there: **Masuk (pengembangan)** for the
owner, PIN `111111` for the admin and `222222` for the cashier. Pair the browser first (see
[Pair a cashier device](#3-pair-a-cashier-device)).

### Manual setup

```bash
npm install
```

```bash
npm run db:up
```

Create the roles, the payment database and a stub UMKMall user (local only):

```bash
docker compose exec -T postgres psql -U pos -d pos < ops/local-public-users.sql
docker compose exec -T postgres psql -U pos -d pos < ops/pos-role.sql
docker compose exec -T postgres psql -U pos -d pos -c "create database payment"
docker compose exec -T postgres psql -U pos -d payment < ops/payment-role.sql
docker compose exec -T postgres psql -U pos -d pos -c "alter role pos_app password 'local-pos'" -c "alter role payment_app password 'local-pay'"
docker compose exec -T postgres psql -U pos -d pos -tAc "insert into public.users default values returning id"
```

Keep the id printed by the last command. Note that `npm test` resets the two role passwords, so run the `alter role`
line again after testing.

```bash
npm run build -w pos-api -w payment-api
```

```bash
DATABASE_URL=postgres://payment_app:local-pay@localhost:5544/payment npm run db:migrate -w payment-api
```

```bash
DATABASE_URL=postgres://pos_app:local-pos@localhost:5544/pos npm run db:migrate -w pos-api
```

Then start each service in its own terminal.

payment-api, with the fake gateway:

```bash
NODE_ENV=development PAYMENT_ADAPTERS=fake DATABASE_URL=postgres://payment_app:local-pay@localhost:5544/payment PAYMENT_SERVICE_KEY=local-payment-service-key npm run start -w payment-api
```

pos-api:

```bash
NODE_ENV=development DATABASE_URL=postgres://pos_app:local-pos@localhost:5544/pos POS_SESSION_SECRET=local-session-secret-at-least-32-characters POS_SERVICE_KEY=local-pos-service-key UMKMALL_WEB_URL=http://127.0.0.1:9099 PAYMENT_API_URL=http://localhost:3001 PAYMENT_SERVICE_KEY=local-payment-service-key npm run start -w pos-api
```

pos-web (replace `<user id>`):

```bash
POS_API_URL=http://localhost:3000 POS_DEV_USER_ID=<user id> npm run dev -w pos-web
```

Open http://localhost:3101 and press **Masuk (pengembangan)**. The development sign-in lasts 15 minutes and is refused
in production. All variables are listed in [.env.example](.env.example).

### The fake payment gateway

With `PAYMENT_ADAPTERS=fake` (allowed only when `NODE_ENV` is `development` or `test`), payment-api offers dynamic
QRIS and virtual accounts without any real money. Drive it through `/dev/fake-gateway/…` on port 3001, or with
`.local-qa/fakepg.sh`. Details: [payment-api](apps/payment-api/README.md#fake-gateway).

### Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

---

# 📖 User guide

For shop owners and cashiers. Screenshots use a demo shop called *Warung Berkah*.

| Getting started | Selling | Stock | Money | Settings |
|---|---|---|---|---|
| [1 Sign in](#1-sign-in-as-the-owner) | [6 Open a shift](#6-open-a-shift) | [13 Products](#13-products-and-categories) | [17 Receivables](#17-collect-kasbon-receivables) | [22 Online payments](#22-turn-on-online-payments) |
| [2 Store profile](#2-set-up-your-store) | [7 Make a sale](#7-make-a-sale) | [14 Suppliers and purchases](#14-suppliers-and-purchases) | [18 Expenses](#18-expenses) | [23 Roles](#23-roles-and-permissions) |
| [3 Pair a device](#3-pair-a-cashier-device) | [8 Dynamic QRIS](#8-dynamic-qris-and-virtual-account) | [15 Stock count](#15-stock-count) | [19 Store cash](#19-store-cash-and-collector-deposits) | |
| [4 Staff](#4-add-staff) | [9 Kasbon](#9-vouchers-customers-and-kasbon) | [16 Vouchers and customers](#16-vouchers-and-customers) | [20 Dashboard and reports](#20-dashboard-and-reports) | |
| [5 Cashier sign-in](#5-sign-in-as-a-cashier) | [10 History, void, refund](#10-sales-history-void-and-refund) | | [21 Payment methods](#21-payment-methods) | |
| | [11 Drawer cash](#11-cash-in-and-out-of-the-drawer) | | | |
| | [12 Close a shift](#12-close-the-shift) | | | |

## 1. Sign in as the owner

1. Open the POS address.
2. Press **Masuk dengan akun UMKMall** and sign in to UMKMall.
3. You land on the **Dashboard**.

On a local machine, use **Masuk (pengembangan)** instead.

<img src="docs/screenshots/01-masuk.png" alt="Sign-in page" width="48%" /> <img src="docs/screenshots/02-dashboard.png" alt="Dashboard" width="48%" />

## 2. Set up your store

1. Open **Pengaturan**.
2. In **Profil toko**, fill **Nama toko**, **Jenis usaha**, **Alamat toko** and, if you like, **Logo toko**. Press **Simpan**.
3. In **Pembayaran**, upload your static QRIS image (**Kode QRIS**) and press **Simpan QRIS**. Cashiers show it when
   the customer pays by e-wallet.
4. In **Aplikasi**, set the default tax (**Pajak bawaan**) and **Zona waktu laporan**. Tax is calculated after discounts.
5. Open **Keamanan** and create your own 6-digit **PIN admin**, then press **Simpan PIN**. It approves voids and
   refunds. Every admin has a personal PIN; five wrong entries lock it for five minutes.

<img src="docs/screenshots/03-pengaturan.png" alt="Store profile" width="48%" /> <img src="docs/screenshots/04-keamanan.png" alt="Admin PIN" width="48%" />

## 3. Pair a cashier device

Cashiers can use their PIN only on a device the owner has paired.

1. On the **cashier's phone or tablet**, open `/kasir/masuk`. It shows a 6-digit code, valid for 10 minutes and usable once.
2. On the **owner's** screen, open **Staf → Perangkat** and press **Hubungkan perangkat**.
3. Type the code, give the device a name (**Nama perangkat**), and confirm.
4. The phone moves on by itself. Pair only devices you asked for yourself.

Using one browser for both? On **Staf → Perangkat**, fill the name under **Jadikan browser ini perangkat kasir** and
press **Hubungkan**.

To remove a lost device press **Cabut**; to sign a cashier out press **Keluarkan**.

<p><img src="docs/screenshots/05-hp-kode-pasang.png" alt="Pairing code on the phone" width="22%" /> <img src="docs/screenshots/06-hubungkan-perangkat.png" alt="Owner enters the code" width="52%" /> </p>
<img src="docs/screenshots/07-perangkat-terhubung.png" alt="Paired device list" width="66%" />

## 4. Add staff

1. Open **Staf** and press **Tambah staf**.
2. Fill **Nama**, **PIN** and **Konfirmasi PIN**, choose a **Peran**, and press **Simpan**.

Three roles exist from the start: **Pemilik** (everything), **Admin** (everything except managing staff, roles, devices
and online payments) and **Kasir** (selling only).

<img src="docs/screenshots/40-staf.png" alt="Staff list" width="66%" />

## 5. Sign in as a cashier

1. On the paired device, open `/kasir/masuk`.
2. Tap your name under **Siapa yang berjaga?**
3. Type your PIN and press **Masuk**.

Five wrong PINs lock sign-in briefly, and the wait grows with each further mistake (up to 15 minutes). A cashier
session lasts 12 hours.

<p><img src="docs/screenshots/08-hp-pilih-kasir.png" alt="Choose cashier" width="24%" /> <img src="docs/screenshots/09-hp-pin.png" alt="Enter PIN" width="24%" /></p>

## 6. Open a shift

Selling needs an open shift.

1. Open **Kasir**.
2. Count the money in the drawer and type it in **Uang awal di laci**.
3. Press **Buka shift**.

<img src="docs/screenshots/10-hp-buka-shift.png" alt="Open shift" width="24%" />

## 7. Make a sale

1. Find products by name or SKU (**Cari nama atau SKU…**) or by category tab.
2. Press **+** to add an item. Change the quantity in the order list, or remove it with the bin button.
3. Optional: **Pilih pelanggan**, **Tambah catatan**, **Diskon** and **Pakai voucher**.
4. Press **Lanjut ke pembayaran** and choose the method.
5. For cash, type **Uang diterima**, use a quick amount, or press **Uang pas**. Cash totals are rounded up to the
   next Rp100 (**Pembulatan**).
6. Press **Bayar**. The change (**Kembalian**) is shown.
7. Press **Cetak struk** to open the receipt, print it, then **Transaksi baru**.

For **Debit** or static **QRIS Toko**, check the money has arrived on your terminal or bank app before you confirm:
the POS records the payment but cannot check it for you.

<p>
<img src="docs/screenshots/11-hp-kasir.png" alt="Cashier on a phone" width="24%" />
<img src="docs/screenshots/12-hp-pesanan.png" alt="Order list" width="24%" />
<img src="docs/screenshots/14-hp-uang-pas.png" alt="Cash payment" width="24%" />
<img src="docs/screenshots/15-hp-berhasil.png" alt="Payment succeeded" width="24%" />
</p>
<img src="docs/screenshots/16-hp-struk.png" alt="Receipt" width="24%" />

On a desktop the order and payment sit beside the product grid:

<img src="docs/screenshots/54-pembayaran-desktop.png" alt="Desktop payment" width="66%" />

## 8. Dynamic QRIS and virtual account

Available once [online payments](#22-turn-on-online-payments) are active. **Today this works only with the local test
gateway; no real money can be taken.**

1. Add the items, press **Lanjut ke pembayaran**, choose the online method and press **Tampilkan kode QR**
   (a virtual account shows a number instead).
2. The customer scans and pays. The status is checked every 3 seconds. Keep the screen open.
3. When paid you see **Pembayaran diterima**. Press **Penjualan baru** or **Cetak struk**.

While waiting you can press **Cek status pembayaran**, **Ganti ke tunai** (switch to cash) or **Batalkan pembayaran**.
Stock and voucher are held until the sale is paid or cancelled. Waiting sales are listed under **Menunggu** at the top
of the cashier screen.

<p><img src="docs/screenshots/21-hp-qris-menunggu.png" alt="Waiting for payment" width="28%" /> <img src="docs/screenshots/22-hp-qris-lunas.png" alt="Paid" width="28%" /></p>

## 9. Vouchers, customers and kasbon

1. Press **Pilih pelanggan** and pick the customer.
2. Press **Pakai voucher**, type the code and press **Pakai**.
3. For store credit, choose the **Kasbon** method (a customer is required). Type the down payment, which may be 0, and
   press **Simpan kasbon**. The rest becomes a receivable due in 14 days.

<p><img src="docs/screenshots/24-hp-pelanggan-voucher.png" alt="Customer and voucher" width="28%" /> <img src="docs/screenshots/25-hp-kasbon.png" alt="Kasbon" width="28%" /></p>

## 10. Sales history, void and refund

1. Open **Riwayat penjualan**, filter by date, and open a sale.
2. Press **Cetak struk** to reprint it.
3. To cancel a cash, debit, QRIS Toko or kasbon sale, press **Batalkan transaksi**. Choose a reason (**Alasan**), the
   approving admin (**Admin yang menyetujui**) and let that admin type their **PIN admin**. A void is always for the
   whole receipt: stock and voucher return, and the receipt stays with a VOID mark. Cash goes back out of your open
   drawer, so open a shift first.
4. A paid online sale is **refunded** instead (**Refund struk**), in full and once. The money returns when the gateway
   confirms; if it fails, the owner can retry or mark it **Dikembalikan manual** after returning the money by hand.

<p><img src="docs/screenshots/17-hp-detail-penjualan.png" alt="Sale detail" width="28%" /> <img src="docs/screenshots/18-hp-batalkan.png" alt="Void with admin PIN" width="28%" /></p>

## 11. Cash in and out of the drawer

1. Open **Kas laci**.
2. Press **+ Tambah uang** or **− Ambil uang**, type the amount, choose what it is for, and save.

Buying something for the shop from the drawer? Record it under [Expenses](#18-expenses) with the drawer as the source;
the drawer is reduced there.

<p><img src="docs/screenshots/41-hp-kas-masuk.png" alt="Add drawer money" width="24%" /> <img src="docs/screenshots/42-hp-kas-laci.png" alt="Drawer ledger" width="24%" /></p>

## 12. Close the shift

1. On the cashier screen press **Tutup shift**.
2. Count the drawer and type it in **Uang yang dihitung**. The app shows the expected amount and the difference
   (more or less).
3. Press **Tutup shift** and confirm. A closed shift cannot be reopened. Sales still waiting for payment must be
   settled first.
4. Past shifts are under **Riwayat shift**; press **Lihat** for the details.

<p><img src="docs/screenshots/43-hp-tutup-shift.png" alt="Close shift" width="24%" /> <img src="docs/screenshots/44-hp-shift-ditutup.png" alt="Shift closed" width="24%" /></p>
<img src="docs/screenshots/52-detail-shift.png" alt="Shift detail" width="66%" />

## 13. Products and categories

1. Open **Kategori**, press **Tambah kategori** and save. A category in use cannot be deleted.
2. Open **Produk** and press **Tambah produk**.
3. Fill the name, category, unit (**Satuan**), cost (**Harga modal**) and selling price (**Harga jual**).
4. Optional: images, barcodes, SKU (blank is generated), opening stock, low-stock limit, other units such as a box
   (**Satuan lain**) and wholesale prices (**Harga grosir per PCS**).
5. Press **Simpan**, or **Simpan & buat lagi** to add the next one.

The product list has **Menipis** (running low) and **Habis** (out of stock) filters. Open a product to see its stock
movements.

<img src="docs/screenshots/32-produk.png" alt="Product list" width="48%" /> <img src="docs/screenshots/31-produk-baru.png" alt="New product" width="48%" />

<img src="docs/screenshots/33-kategori.png" alt="Categories" width="48%" />

## 14. Suppliers and purchases

1. Open **Pemasok**, press **Pemasok baru** and save the supplier.
2. Open **Pembelian**, press **Pembelian baru**, choose the supplier, add products with quantity (**Jumlah**) and buying
   price (**Harga beli**).
3. Press **Simpan sebagai draf**. A draft can still be edited or deleted.
4. Open it and press **Setujui dan tambah stok**, then **Setujui**. Stock increases and the purchase is locked.

<img src="docs/screenshots/26-pemasok.png" alt="Suppliers" width="48%" /> <img src="docs/screenshots/27-pembelian-baru.png" alt="New purchase" width="48%" />

<img src="docs/screenshots/28-pembelian-draf.png" alt="Approve a purchase" width="48%" /> <img src="docs/screenshots/51-pembelian.png" alt="Purchase list" width="48%" />

## 15. Stock count

1. Open **Stok opname** and press **Stok opname baru**.
2. Pick each product, type the counted quantity (**Jumlah dihitung**) and the reason (**Alasan**).
3. Press **Simpan sebagai draf** and check the differences (**Selisih**).
4. Press **Setujui dan sesuaikan stok**. The system stock is set to what you counted.

<img src="docs/screenshots/29-stok-opname.png" alt="Stock count form" width="48%" /> <img src="docs/screenshots/30-stok-opname-draf.png" alt="Stock count draft" width="48%" />

## 16. Vouchers and customers

- **Voucher** → **Tambah voucher**: name, code, type (percent or rupiah), value, optional minimum purchase, quota
  (**Kuota**) and the valid dates.
- **Pelanggan** → **Tambah pelanggan**: name and code, with optional phone and address.

<img src="docs/screenshots/35-voucher.png" alt="New voucher" width="48%" /> <img src="docs/screenshots/36-pelanggan.png" alt="New customer" width="48%" />

## 17. Collect kasbon (receivables)

1. Open **Piutang**. You see what is still unpaid and when it is due.
2. Press **Bayar** on a row, then **Tambah pembayaran**.
3. Enter the amount received and the method, and save. Paying in instalments is fine.

<img src="docs/screenshots/37-piutang.png" alt="Receivables" width="48%" /> <img src="docs/screenshots/38-bayar-piutang.png" alt="Receivable detail" width="48%" />

## 18. Expenses

1. Open **Pengeluaran** and press **+ Catat pengeluaran**.
2. Type the amount, choose what it was for, and the source: **Laci kasir** (reduces the drawer) or **Di luar laci**.
3. Press **Simpan**. A mistake can be edited, or cancelled with **Batalkan pengeluaran**.

<img src="docs/screenshots/34-pengeluaran.png" alt="Record an expense" width="48%" />

## 19. Store cash and collector deposits

Kasbon cash collected by someone **without an open shift** is held by that person (**Dipegang penagih**).

1. Open **Kas toko** to see the store cash balance and who is holding money.
2. When the collector hands it over, another person presses **Terima setoran**, enters the amount and saves. Collectors
   cannot record their own deposit. If the app asks, open a shift first so the money enters your drawer.
3. **Setoran penagih** lists past deposits: who handed over and who received.

<img src="docs/screenshots/50-kas-toko.png" alt="Store cash" width="66%" />

## 20. Dashboard and reports

- **Dashboard:** revenue, transactions and gross profit for **Hari ini**, **Minggu ini**, **Bulan ini** or **Tahun ini**.
- **Laporan:** sales, products, cashiers, purchases. Pick the dates, press **Tampilkan**, then **Cetak** or
  **Unduh CSV**.
- **Untung rugi:** sales without tax, minus cost of goods and expenses.

<img src="docs/screenshots/47-laporan.png" alt="Reports" width="48%" /> <img src="docs/screenshots/48-laporan-penjualan.png" alt="Sales report" width="48%" />

<img src="docs/screenshots/49-untung-rugi.png" alt="Profit and loss" width="48%" /> <img src="docs/screenshots/46-riwayat-penjualan.png" alt="Sales history" width="48%" />

## 21. Payment methods

Open **Metode pembayaran** and press **Tambah metode pembayaran**. Choose the type: cash, debit, **Kasbon (kredit)**,
**Dompet digital** (your static QRIS) or **Pembayaran online (QRIS dinamis / VA)**.

<img src="docs/screenshots/23-metode-pembayaran.png" alt="Payment methods" width="48%" /> <img src="docs/screenshots/20-metode-online.png" alt="Online method" width="48%" />

## 22. Turn on online payments

Owner only. **Currently available with the local test gateway only.**

1. Open **Pembayaran Online**.
2. Fill the business type and name, responsible email and phone, accept the terms, and press **Ajukan** (or **Simpan
   draf**).
3. Press **Lanjutkan verifikasi** and finish on the gateway's own page. Identity documents and bank accounts are
   entered there, never in the POS.
4. When the status is verified, switch on the methods you want; the status becomes **Aktif**.
5. Add a matching [payment method](#21-payment-methods).

Locally, approve the account with `.local-qa/fakepg.sh akun-setujui` (or `POST /dev/fake-gateway/account/approve`) and
press **Cek status**.

<img src="docs/screenshots/19-pembayaran-online.png" alt="Online payments" width="66%" />

## 23. Roles and permissions

1. Open **Peran** and press **Tambah peran** (or **Ubah** on a role).
2. Name it, tick the permissions, and press **Simpan**.
3. Assign it to staff under **Staf**. The menu shows each person only what they may use.

<img src="docs/screenshots/39-peran.png" alt="Role permissions" width="66%" />

---

## 📚 More documentation

- [Epic plan](docs/plans/2026-11-17-001-feat-pos-epic-plan.md) (Linear UMK-1924) and the other [plans](docs/plans)
- [Reference run of Lakasir](docs/reference/lakasir-findings.md)
- [Working rules for contributors and agents](CLAUDE.md)

## ⚖️ License

GPL-3.0-or-later. A port of Lakasir; see [NOTICE](NOTICE) for attribution.
