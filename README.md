<div align="center">

# 🏪 UMKMall POS

### UMKMall's cashier, and the data behind everything else UMKMall does for your shop

**UMKMall POS exists to support UMKMall. It is one of UMKMall's tools, and the main source of data for all its other features: the store's database, ledger and figures that the HPP calculator, UMKMall's agent (over MCP) and the reports read from. For the shop it is a cashier, a stock book and a cash notebook that run on a phone, tablet or computer.**

[![CI](https://github.com/jamalbaharun-umk/umkmall-pos/actions/workflows/ci.yml/badge.svg)](https://github.com/jamalbaharun-umk/umkmall-pos/actions/workflows/ci.yml)
![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)
![Node.js 22+](https://img.shields.io/badge/node-22%2B-339933)
![Status: in development](https://img.shields.io/badge/status-in%20development-orange)

[Why](#-why-umkmall-pos) · [UMKMall ecosystem](#-a-tool-of-the-umkmall-ecosystem) · [Features](#-features) · [Install](#-installation) · [How to use](#-how-to-use-a-day-at-warung-berkah) · [Coming soon](#-coming-soon) · [Contributing](#-contributing)

<img src="docs/screenshots/53-kasir-desktop.png" alt="Cashier screen on a desktop" width="68%" />
<img src="docs/screenshots/21-hp-qris-menunggu.png" alt="Dynamic QRIS payment on a phone" width="21%" />

</div>

---

## 💡 Why UMKMall POS

UMKMall can only help a shop with the facts the shop has. The POS records them where they happen, at the counter,
and hands them to the rest of UMKMall. For the owner, that starts with questions like these:

- The shop was busy all day, yet the drawer feels light tonight.
- A neighbour's *kasbon* lives in a notebook that nobody can find.
- You learn the cooking oil is gone when a customer asks for it.
- You know your sales, but not your **profit**.

UMKMall POS answers each of them from a phone, tablet or computer:

| Your question | The answer |
|---|---|
| Where did the money go? | Every shift is opened with a count and closed with a count, and the difference is shown |
| Who still owes me? | Every *kasbon* has a name, a balance and a due date |
| What must I restock? | Stock moves with each sale and purchase, with a running-low filter |
| Did I make money today? | Sales minus cost of goods minus expenses, on one page |
| Can I trust my staff's receipts? | Own PIN per person; cancelling needs an admin PIN and a reason |

> **Project status:** in active development, not yet deployed to production. Online payments work only with a built-in
> test gateway, so no real money moves through them.

## 🧩 A tool of the UMKMall ecosystem

UMKMall POS is not a separate product. It is **one of UMKMall's tools**, like the HPP calculator or the finance
notebook in the UMKMall app and web, and **the main source of data** for all of UMKMall's features. It holds what the
rest of UMKMall needs from a shop:

| UMKMall needs… | UMKMall POS is… |
|---|---|
| Real sales, stock and customers | **The store's database**: products, units and prices, stock batches at cost, customers, suppliers |
| Money it can trust | **The store's ledger**: every sale, shift, drawer movement, kasbon, expense and refund, in integer rupiah, append-only where money moves |
| A place to put its results | **The place results land**: an HPP calculated in UMKMall becomes POS products with cost and selling price |
| Facts for its journeys and tools | **The source of figures**: actual margins per product, profit and loss, purchases, all readable by UMKMall's agent |

How it fits:

- **One account, one ecosystem.** The owner signs in with their **UMKMall account** by a WhatsApp code (a one-time
  password checked by UMKMall); no second password, and the POS never sees UMKMall's login cookie. One UMKMall account is one store. Cashiers are local POS users with a PIN on a
  paired device.
- **UMKMall's agent works the POS for the owner** over MCP ([docs/agent-integration.md](docs/agent-integration.md)):
  it reads the catalog, stock, sales, margins and profit and loss, and fills the catalog, including importing HPP
  results. It cannot void, change prices at the till, take cash out of a drawer or touch store settings.
- **UMKMall's features feed on POS data**: "Strategi Harga dan Profit" and the HPP calculator (cost, price, actual
  margin), the finance notebook and cashflow templates (sales, purchases, profit), chat and label tools (products,
  prices, stock). The full map is in the PRD's "Dukungan fitur UMKMall".
- **Erasure follows UMKMall.** When a UMKMall account is erased, UMKMall calls the POS purge endpoint, which deletes
  that store's data, payments included.

The app speaks **Indonesian**. This documentation is in English and quotes the on-screen labels exactly, **in bold**.

## ✨ Features

| Area | What you can do |
|---|---|
| 🧾 Selling | Cashier screen, discounts, vouchers, notes, customers, cash / debit / static QRIS / kasbon, receipts |
| 📱 Online payments *(test gateway only)* | Dynamic QRIS and virtual accounts, switch to cash, refunds |
| 💵 Cash control | Shifts, drawer in and out, closing differences, store cash, collector deposits |
| 📚 Inventory | Products, categories, barcodes, extra units, wholesale prices, purchases, suppliers, stock counts |
| 👥 People | Staff with PINs, roles and permissions, paired cashier devices |
| 📊 Money | Receivables, expenses, sales / product / cashier / purchase reports, profit and loss, CSV export |
| 🔒 Safety | Void with an admin PIN, per-store data isolation, PIN lockout, no double sale on retry |
| 🤝 UMKMall agent (MCP) | Agent session from the UMKMall login, catalog and report reads, HPP import with preview and once-only writes |
| 🖥 Every screen size | Desktop and phone layouts, a success message or a clear error dialog after each action |

## 🚀 Installation

### Requirements

| Tool | Version | Check with |
|---|---|---|
| [Node.js](https://nodejs.org) (includes npm) | 22 or newer | `node -v` |
| [Docker](https://docs.docker.com/get-docker/) with Compose | recent, and running | `docker compose version` |
| Git | any | `git --version` |

Free ports needed: **3000**, **3001**, **3101** and **5544**. Commands below are for macOS or Linux shells (on Windows,
use WSL).

### Step 1: get the code

```bash
git clone https://github.com/jamalbaharun-umk/umkmall-pos.git
cd umkmall-pos
npm install
```

### Step 2: start the database

```bash
npm run db:up
```

### Step 3: prepare roles and a demo owner (once)

```bash
docker compose exec -T postgres psql -U pos -d pos < ops/local-public-users.sql
docker compose exec -T postgres psql -U pos -d pos < ops/pos-role.sql
docker compose exec -T postgres psql -U pos -d pos -c "create database payment"
docker compose exec -T postgres psql -U pos -d payment < ops/payment-role.sql
docker compose exec -T postgres psql -U pos -d pos -c "alter role pos_app password 'local-pos'" -c "alter role payment_app password 'local-pay'"
docker compose exec -T postgres psql -U pos -d pos -tAc "insert into public.users default values returning id"
```

**Copy the id printed by the last command.** It is your demo owner. These passwords and keys are for local use only.

### Step 4: build and create the tables

```bash
npm run build -w pos-api -w payment-api
```

```bash
DATABASE_URL=postgres://payment_app:local-pay@localhost:5544/payment npm run db:migrate -w payment-api
DATABASE_URL=postgres://pos_app:local-pos@localhost:5544/pos npm run db:migrate -w pos-api
```

### Step 5: start the three services, each in its own terminal

Terminal 1, payments (with the test gateway):

```bash
NODE_ENV=development PAYMENT_ADAPTERS=fake DATABASE_URL=postgres://payment_app:local-pay@localhost:5544/payment PAYMENT_SERVICE_KEY=local-payment-service-key npm run start -w payment-api
```

Terminal 2, the POS API:

```bash
NODE_ENV=development DATABASE_URL=postgres://pos_app:local-pos@localhost:5544/pos POS_SESSION_SECRET=local-session-secret-at-least-32-characters POS_SERVICE_KEY=local-pos-service-key UMKMALL_WEB_URL=http://127.0.0.1:9099 PAYMENT_API_URL=http://localhost:3001 PAYMENT_SERVICE_KEY=local-payment-service-key npm run start -w pos-api
```

Terminal 3, the web app (replace `<user id>` with the id from step 3):

```bash
POS_API_URL=http://localhost:3000 POS_DEV_USER_ID=<user id> npm run dev -w pos-web
```

### Step 6: open the shop

Go to **http://localhost:3101** and press **Masuk (pengembangan)**. Your store starts empty; follow
[the story below](#-how-to-use-a-day-at-warung-berkah) to fill it. All settings are listed in
[.env.example](.env.example).

### Next time

Run `npm run db:up`, then step 5. After pulling new code, repeat `npm install` and step 4 first. Stop the services with
`Ctrl+C` and the database with `docker compose stop`.

<details>
<summary><b>Maintainer shortcut scripts (not in the repository)</b></summary>

The maintainer's machine has helper scripts in `.local-qa/`. The folder is deliberately not committed, so a fresh clone
does not have it.

| Command | What it does |
|---|---|
| `.local-qa/start.sh` | Starts Postgres, builds and migrates both APIs, runs all services |
| `.local-qa/seed.sh` | Fills a demo store |
| `.local-qa/stop.sh` | Stops everything and keeps the data |
| `.local-qa/reset.sh` | **Deletes all QA data** and seeds again |
| `.local-qa/fakepg.sh` | Plays the payment gateway: pay, fail, expire, refund, approve the store's account |

`.local-qa/PANDUAN.md` is the Indonesian guide. Its demo logins: **Masuk (pengembangan)** for the owner, PIN `111111`
for the admin, `222222` for the cashier.

</details>

### Troubleshooting

| Problem | Fix |
|---|---|
| `db:up` fails | Make sure Docker is running and port 5544 is free |
| `password authentication failed` | `npm test` resets the role passwords. Run the `alter role` line from step 3 again |
| `create database` says it already exists | You did step 3 before; skip that line |
| Thrown back to the sign-in page | The development sign-in lasts 15 minutes; press **Masuk (pengembangan)** again |
| Cashier cannot use a PIN | [Pair the device](#3-pair-a-cashier-device) first |
| Online methods missing at the cashier | [Turn on online payments](#23-turn-on-online-payments), then add the payment method |

---

## 📖 How to use: a day at Warung Berkah

*An illustrative story with a demo shop. The people are made up; the screens and numbers come from the real app.*

Meet the team: **Bu Ani**, the owner. **Sari**, who helps run the shop. **Budi**, at the counter. And **Ibu Rina**, the
neighbour who loves to say *"kasbon dulu ya"*.

| Chapter | Features |
|---|---|
| [🌅 Chapter 1 · Moving in](#-chapter-1--moving-in) | [Sign in as the owner](#1-sign-in-as-the-owner) · [Set up your store](#2-set-up-your-store) · [Pair a cashier device](#3-pair-a-cashier-device) · [Add staff](#4-add-staff) · [Roles and permissions](#5-roles-and-permissions) |
| [📦 Chapter 2 · Filling the shelves](#-chapter-2--filling-the-shelves) | [Products and categories](#6-products-and-categories) · [Suppliers and purchases](#7-suppliers-and-purchases) · [Payment methods](#8-payment-methods) · [Vouchers and customers](#9-vouchers-and-customers) |
| [🛒 Chapter 3 · The shop is open](#-chapter-3--the-shop-is-open) | [Sign in as a cashier](#10-sign-in-as-a-cashier) · [Open a shift](#11-open-a-shift) · [Make a sale](#12-make-a-sale) · [Dynamic QRIS and virtual account](#13-dynamic-qris-and-virtual-account) · [Vouchers, customers and kasbon](#14-vouchers-customers-and-kasbon) · [Sales history, void and refund](#15-sales-history-void-and-refund) · [Cash in and out of the drawer](#16-cash-in-and-out-of-the-drawer) |
| [🌙 Chapter 4 · Closing time](#-chapter-4--closing-time) | [Close the shift](#17-close-the-shift) · [Stock count](#18-stock-count) · [Expenses](#19-expenses) · [Dashboard and reports](#20-dashboard-and-reports) |
| [📆 Chapter 5 · The weeks after](#-chapter-5--the-weeks-after) | [Collect kasbon (receivables)](#21-collect-kasbon-receivables) · [Store cash and collector deposits](#22-store-cash-and-collector-deposits) · [Turn on online payments](#23-turn-on-online-payments) |

## 🌅 Chapter 1 · Moving in

Before the first customer, the shop owner teaches the system who they are.

### 1. Sign in as the owner

> Bu Ani owns *Warung Berkah*. She does not want another password to forget, so she walks in with the UMKMall account she already has.

1. Open the POS address.
2. Type the WhatsApp number of your UMKMall account (**Nomor WhatsApp**), press **Kirim kode** and enter the code you
   receive. UMKMall checks the code; the POS keeps its own short session.
3. You land on the **Dashboard**.

On a local machine, use **Masuk (pengembangan)** instead.

<img src="docs/screenshots/01-masuk.png" alt="Sign-in page" width="48%" /> <img src="docs/screenshots/02-dashboard.png" alt="Dashboard" width="48%" />

### 2. Set up your store

> She gives the shop its name and address, puts her QRIS sticker into the system, and creates the secret PIN that only an admin may use to cancel a receipt.

1. Open **Pengaturan**.
2. In **Profil toko**, fill **Nama toko**, **Jenis usaha**, **Alamat toko** and, if you like, **Logo toko**. Press **Simpan**.
3. In **Pembayaran**, upload your static QRIS image (**Kode QRIS**) and press **Simpan QRIS**. Cashiers show it when
   the customer pays by e-wallet.
4. In **Aplikasi**, set the default tax (**Pajak bawaan**) and **Zona waktu laporan**. Tax is calculated after discounts.
5. Open **Keamanan** and create your own 6-digit **PIN admin**, then press **Simpan PIN**. It approves voids and
   refunds. Every admin has a personal PIN; five wrong entries lock it for five minutes.

<img src="docs/screenshots/03-pengaturan.png" alt="Store profile" width="48%" /> <img src="docs/screenshots/04-keamanan.png" alt="Admin PIN" width="48%" />

### 3. Pair a cashier device

> Her nephew Budi will sell from a phone. Bu Ani does not hand him her password. She lets that one phone in with a six-digit code.

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

### 4. Add staff

> Sari helps run the shop and Budi guards the counter. Each gets their own PIN, so every receipt has a name on it.

1. Open **Staf** and press **Tambah staf**.
2. Fill **Nama**, **PIN** and **Konfirmasi PIN**, choose a **Peran**, and press **Simpan**.

Three roles exist from the start: **Pemilik** (everything), **Admin** (everything except managing staff, roles, devices
and online payments) and **Kasir** (selling only).

<img src="docs/screenshots/40-staf.png" alt="Staff list" width="66%" />

### 5. Roles and permissions

> Trust grows step by step. Bu Ani decides who may change prices, see profit or cancel a sale.

1. Open **Peran** and press **Tambah peran** (or **Ubah** on a role).
2. Name it, tick the permissions, and press **Simpan**.
3. Assign it to staff under **Staf**. The menu shows each person only what they may use.

<img src="docs/screenshots/39-peran.png" alt="Role permissions" width="66%" />

## 📦 Chapter 2 · Filling the shelves

No stock, no sales. The shelves come next.

### 6. Products and categories

> Sari types in iced tea, fried rice and cooking oil, with what each one costs and what it sells for. From now on the shop knows its margin on every cup.

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

### 7. Suppliers and purchases

> The cooking oil is nearly gone. 24 bottles arrive from CV Sumber Pangan, and approving the purchase puts them on the shelf in the system too.

1. Open **Pemasok**, press **Pemasok baru** and save the supplier.
2. Open **Pembelian**, press **Pembelian baru**, choose the supplier, add products with quantity (**Jumlah**) and buying
   price (**Harga beli**).
3. Press **Simpan sebagai draf**. A draft can still be edited or deleted.
4. Open it and press **Setujui dan tambah stok**, then **Setujui**. Stock increases and the purchase is locked.

<img src="docs/screenshots/26-pemasok.png" alt="Suppliers" width="48%" /> <img src="docs/screenshots/27-pembelian-baru.png" alt="New purchase" width="48%" />

<img src="docs/screenshots/28-pembelian-draf.png" alt="Approve a purchase" width="48%" /> <img src="docs/screenshots/51-pembelian.png" alt="Purchase list" width="48%" />

### 8. Payment methods

> Customers pay in different ways. Cash, debit, the QRIS sticker, or *"write it down first, Bu"*.

Open **Metode pembayaran** and press **Tambah metode pembayaran**. Choose the type: cash, debit, **Kasbon (kredit)**,
**Dompet digital** (your static QRIS) or **Online (QRIS / VA / link)**.

<img src="docs/screenshots/23-metode-pembayaran.png" alt="Payment methods" width="48%" /> <img src="docs/screenshots/20-metode-online.png" alt="Online method" width="48%" />

### 9. Vouchers and customers

> Ibu Rina next door buys every week. Sari saves her name and prepares a 10% voucher, `DISKON10`.

- **Voucher** → **Tambah voucher**: name, code, type (percent or rupiah), value, optional minimum purchase, quota
  (**Kuota**) and the valid dates.
- **Pelanggan** → **Tambah pelanggan**: name and code, with optional phone and address.

<img src="docs/screenshots/35-voucher.png" alt="New voucher" width="48%" /> <img src="docs/screenshots/36-pelanggan.png" alt="New customer" width="48%" />

## 🛒 Chapter 3 · The shop is open

07.00. The shutters go up.

### 10. Sign in as a cashier

> Budi picks up the shop phone, taps his name and types his PIN.

1. On the paired device, open `/kasir/masuk`.
2. Tap your name under **Siapa yang berjaga?**
3. Type your PIN and press **Masuk**.

Five wrong PINs lock sign-in briefly, and the wait grows with each further mistake (up to 15 minutes). A cashier
session lasts 12 hours.

<p><img src="docs/screenshots/08-hp-pilih-kasir.png" alt="Choose cashier" width="24%" /> <img src="docs/screenshots/09-hp-pin.png" alt="Enter PIN" width="24%" /></p>

### 11. Open a shift

> He counts Rp200.000 in the drawer and writes it down. Tonight that number protects him: nobody can say the money was short from the start.

Selling needs an open shift.

1. Open **Kasir**.
2. Count the money in the drawer and type it in **Uang awal di laci**.
3. Press **Buka shift**.

<img src="docs/screenshots/10-hp-buka-shift.png" alt="Open shift" width="24%" />

### 12. Make a sale

> First customer: two iced teas and a plate of fried rice, Rp28.000. A few taps, **Uang pas**, done.

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

### 13. Dynamic QRIS and virtual account

> An office worker wants coffee and chicken noodles and has no cash. The phone shows a QR for exactly Rp27.000 and tells Budi when the money is in, with no screenshot to squint at.

Available once [online payments](#23-turn-on-online-payments) are active. **Today this works only with the local test
gateway; no real money can be taken.**

1. Add the items, press **Lanjut ke pembayaran**, choose the online method and press **Tampilkan kode QR**
   (a virtual account shows a number instead).
2. The customer scans and pays. The status is checked every 3 seconds. Keep the screen open.
3. When paid you see **Pembayaran diterima**. Press **Penjualan baru** or **Cetak struk**.

While waiting you can press **Cek status pembayaran**, **Ganti ke tunai** (switch to cash) or **Batalkan pembayaran**.
Stock and voucher are held until the sale is paid or cancelled. Waiting sales are listed under **Menunggu** at the top
of the cashier screen.

<p><img src="docs/screenshots/21-hp-qris-menunggu.png" alt="Waiting for payment" width="28%" /> <img src="docs/screenshots/22-hp-qris-lunas.png" alt="Paid" width="28%" /></p>

### 14. Vouchers, customers and kasbon

> Ibu Rina needs a 5 kg sack of rice. The voucher makes it Rp67.500, she pays Rp20.000 today, and the other Rp47.500 is recorded as kasbon, not on a torn page of a notebook.

1. Press **Pilih pelanggan** and pick the customer.
2. Press **Pakai voucher**, type the code and press **Pakai**.
3. For store credit, choose the **Kasbon** method (a customer is required). Type the down payment, which may be 0, and
   press **Simpan kasbon**. The rest becomes a receivable due in 14 days.

<p><img src="docs/screenshots/24-hp-pelanggan-voucher.png" alt="Customer and voucher" width="28%" /> <img src="docs/screenshots/25-hp-kasbon.png" alt="Kasbon" width="28%" /></p>

### 15. Sales history, void and refund

> Wrong item typed? It happens. The receipt is cancelled openly, with a reason and an admin's PIN, instead of quietly disappearing.

1. Open **Riwayat penjualan**, filter by date, and open a sale.
2. Press **Cetak struk** to reprint it.
3. To cancel a cash, debit, QRIS Toko or kasbon sale, press **Batalkan transaksi**. Choose a reason (**Alasan**), the
   approving admin (**Admin yang menyetujui**) and let that admin type their **PIN admin**. A void is always for the
   whole receipt: stock and voucher return, and the receipt stays with a VOID mark. Cash goes back out of your open
   drawer, so open a shift first.
4. A paid online sale is **refunded** instead (**Refund struk**), in full and once. The money returns when the gateway
   confirms; if it fails, the owner can retry or mark it **Dikembalikan manual** after returning the money by hand.

<p><img src="docs/screenshots/17-hp-detail-penjualan.png" alt="Sale detail" width="28%" /> <img src="docs/screenshots/18-hp-batalkan.png" alt="Void with admin PIN" width="28%" /></p>

### 16. Cash in and out of the drawer

> The change runs low, so Rp50.000 goes into the drawer. It is written down, so tonight's count still makes sense.

1. Open **Kas laci**.
2. Press **+ Tambah uang** or **− Ambil uang**, type the amount, choose what it is for, and save.

Buying something for the shop from the drawer? Record it under [Expenses](#19-expenses) with the drawer as the source;
the drawer is reduced there.

<p><img src="docs/screenshots/41-hp-kas-masuk.png" alt="Add drawer money" width="24%" /> <img src="docs/screenshots/42-hp-kas-laci.png" alt="Drawer ledger" width="24%" /></p>

## 🌙 Chapter 4 · Closing time

The last customer leaves. Now the question every owner asks: *where did the money go?*

### 17. Close the shift

> Budi counts Rp300.000. The system expected Rp298.000 and says so: Rp2.000 over. No guessing, no arguing.

1. On the cashier screen press **Tutup shift**.
2. Count the drawer and type it in **Uang yang dihitung**. The app shows the expected amount and the difference
   (more or less).
3. Press **Tutup shift** and confirm. A closed shift cannot be reopened. Sales still waiting for payment must be
   settled first.
4. Past shifts are under **Riwayat shift**; press **Lihat** for the details.

<p><img src="docs/screenshots/43-hp-tutup-shift.png" alt="Close shift" width="24%" /> <img src="docs/screenshots/44-hp-shift-ditutup.png" alt="Shift closed" width="24%" /></p>
<img src="docs/screenshots/52-detail-shift.png" alt="Shift detail" width="66%" />

### 18. Stock count

> Sari finds one broken packet of crackers. The system said 5, the shelf says 4, and the reason is written beside it.

1. Open **Stok opname** and press **Stok opname baru**.
2. Pick each product, type the counted quantity (**Jumlah dihitung**) and the reason (**Alasan**).
3. Press **Simpan sebagai draf** and check the differences (**Selisih**).
4. Press **Setujui dan sesuaikan stok**. The system stock is set to what you counted.

<img src="docs/screenshots/29-stok-opname.png" alt="Stock count form" width="48%" /> <img src="docs/screenshots/30-stok-opname-draf.png" alt="Stock count draft" width="48%" />

### 19. Expenses

> The electricity bill took Rp50.000. Sari records it, because a shop that forgets its costs thinks it is richer than it is.

1. Open **Pengeluaran** and press **+ Catat pengeluaran**.
2. Type the amount, choose what it was for, and the source: **Laci kasir** (reduces the drawer) or **Di luar laci**.
3. Press **Simpan**. A mistake can be edited, or cancelled with **Batalkan pengeluaran**.

<img src="docs/screenshots/34-pengeluaran.png" alt="Record an expense" width="48%" />

### 20. Dashboard and reports

> Bu Ani opens the report: Rp122.500 revenue, Rp32.500 gross profit, and after the electricity, Rp17.500 in the red for the day. Not a happy number, but a true one.

- **Dashboard:** revenue, transactions and gross profit for **Hari ini**, **Minggu ini**, **Bulan ini** or **Tahun ini**.
- **Laporan:** sales, products, cashiers, purchases. Pick the dates, press **Tampilkan**, then **Cetak** or
  **Unduh CSV**.
- **Untung rugi:** sales without tax, minus cost of goods and expenses.

<img src="docs/screenshots/47-laporan.png" alt="Reports" width="48%" /> <img src="docs/screenshots/48-laporan-penjualan.png" alt="Sales report" width="48%" />

<img src="docs/screenshots/49-untung-rugi.png" alt="Profit and loss" width="48%" /> <img src="docs/screenshots/46-riwayat-penjualan.png" alt="Sales history" width="48%" />

## 📆 Chapter 5 · The weeks after

A shop is not one day. Money comes back, and new ways to be paid open up.

### 21. Collect kasbon (receivables)

> Ibu Rina comes to pay part of her balance. Sari finds it in seconds, with the due date beside it.

1. Open **Piutang**. You see what is still unpaid and when it is due.
2. Press **Bayar** on a row, then **Tambah pembayaran**.
3. Enter the amount received and the method, and save. Paying in instalments is fine.

<img src="docs/screenshots/37-piutang.png" alt="Receivables" width="48%" /> <img src="docs/screenshots/38-bayar-piutang.png" alt="Receivable detail" width="48%" />

### 22. Store cash and collector deposits

> A helper who only collects debts picks up cash on the way home. The system remembers the money is in their hands until someone receives it.

Kasbon cash needs an open shift for anyone who can sell (holds the permission to create sales, as every owner and cashier
does): the app tells them to open a shift instead of holding the cash, and the cash goes into that shift's drawer. Only
collector-only staff, whose role does **not** include selling (for example a role with just receivables management),
take kasbon instalments without a shift. That cash is held by that person (**Dipegang penagih**). Debit and wallet
instalments never need a shift.

1. Open **Kas toko** to see the store cash balance and who is holding money.
2. When the collector hands it over, another person presses **Terima setoran**, enters the amount and saves. Collectors
   cannot record their own deposit. If the app asks, open a shift first so the money enters your drawer.
3. **Setoran penagih** lists past deposits: who handed over and who received.

<img src="docs/screenshots/50-kas-toko.png" alt="Store cash" width="66%" />

### 23. Turn on online payments

> When the shop is ready for QR codes that confirm themselves, Bu Ani switches it on. Her ID card and bank account go to the payment gateway, never into the POS.

Owner only. **Currently available with the local test gateway only.**

1. Open **Pembayaran Online**.
2. Fill the business type and name, responsible email and phone, accept the terms, and press **Ajukan** (or **Simpan
   draf**).
3. Press **Lanjutkan verifikasi** and finish on the gateway's own page. Identity documents and bank accounts are
   entered there, never in the POS.
4. When the status is verified, switch on the methods you want; the status becomes **Aktif**.
5. Add a matching [payment method](#8-payment-methods).

Locally, approve the account with `.local-qa/fakepg.sh akun-setujui` (or `POST /dev/fake-gateway/account/approve`) and
press **Cek status**.

<img src="docs/screenshots/19-pembayaran-online.png" alt="Online payments" width="66%" />

**The end of the story, and the start of yours.** Bu Ani now closes the shop knowing what came in, what went out and
who still owes. [Install it](#-installation) and open your own *warung*.

---

## 🔭 Coming soon

Ideas on the roadmap. **None of these is available yet**, there are no promised dates, and plans may change.

| Soon you may be able to… | What it means for your shop |
|---|---|
| 🤖 **Ask UMKMall's assistant to record sales, purchases and kasbon** (more MCP tools) | Say "record this order" or "record this purchase" and let the assistant type |
| 📸 Product photos and finance notes from UMKMall land in the POS | Photos made in UMKMall go to the catalog; POS sales fill the UMKMall finance notebook |
| 💳 **Take real QRIS payments** through a payment gateway | Self-confirming QR with real money, after legal approval |
| 🔁 Renew a QR, send a payment link, choose the VA bank | Fewer stuck payments at the counter |
| 🔎 A "needs review" list for odd payments | Late or unmatched money is easy to check |
| 🖨 Thermal printer receipts | Print straight from the counter |
| 💬 Receipts and kasbon reminders on WhatsApp | Remind politely, without the notebook |
| 📷 Scan barcodes with the phone camera | No scanner to buy |
| 🏷 Discounts per item | Discount one product, not only the whole order |
| 📈 Best sellers and expiring stock on the dashboard | See what to restock or push first |
| 🧾 Purchase due dates and returns | Keep supplier bills under control |
| 👤 Invite an admin with their own UMKMall account, staff activity log | Share the work with a clear trail |
| 📶 Offline cashier and 🛍 online store stock sync *(being explored)* | Keep selling without signal; one stock for shop and online |
| 🌐 Launch on `pos.umkmall.id` with a menu link in UMKMall | Open the POS with no installation |

Also noted for later: multiple outlets, restaurant tables, product import and label printing.

---

## 🏗 Architecture

```mermaid
flowchart LR
  B["Browser<br/>desktop or phone"] --> W["pos-web<br/>TanStack Start · :3101"]
  W -->|HTTP| A["pos-api<br/>NestJS · :3000"]
  A -->|service key + tenant header| P["payment-api<br/>NestJS · :3001"]
  A --> D1[("Postgres<br/>schema pos")]
  P --> D2[("Postgres database payment<br/>schema payment")]
  A -->|"WhatsApp OTP sign-in"| U["UMKMall API<br/>owner sign-in"]
  P -.->|adapter| G["Payment gateway<br/>fake, local only"]
  UI["@umkmall/ui"] --- W
```

- **Tenant isolation:** the store comes only from the signed-in session; every table is in its own schema with a
  `tenant_id` and row-level security enabled.
- **Money is integer rupiah.** The server computes every price and total. Tax is applied after discounts.
- **Safe retries:** creating a sale uses an idempotency key, so pressing the button again never records it twice.
- **Payments are a separate service.** Only payment-api talks to gateway adapters; the POS never receives identity
  documents or bank account numbers.

## 🧩 Project structure

| Path | What it is | README |
|---|---|---|
| `apps/pos-web` | Merchant web app (desktop and phone) | [pos-web](apps/pos-web/README.md) |
| `apps/pos-api` | POS business API | [pos-api](apps/pos-api/README.md) |
| `apps/payment-api` | Payment records and gateway adapters, [test gateway](apps/payment-api/README.md#fake-gateway) | [payment-api](apps/payment-api/README.md) |
| `packages/ui` | Vendored copy of `@umkmall/ui` | [packages](packages/README.md) · [ui](packages/ui/README.md) |
| `ops/` | One-time database role scripts | |
| `docs/` | Plans, QA notes, references, screenshots | |

## 🎨 UI

- Built **only** with `@umkmall/ui` (primitives, compositions, layouts) and the **UMKMall admin theme**
  (`apps/pos-web/src/styles/app.css`).
- Every action answers with a **success toast**, or a **clear error dialog** saying what happened
  (**Apa yang terjadi**), what to do (**Yang bisa dilakukan**) and the error code.
- Screens have loading, empty and error states, with **desktop and phone** layouts.

<img src="docs/screenshots/55-dialog-gagal.png" alt="Error dialog" width="66%" /> <img src="docs/screenshots/57-hp-menu.png" alt="Phone menu" width="22%" />

## 🛠 Libraries

| Where | Libraries (see each `package.json`) |
|---|---|
| Repository | npm workspaces, Turborepo, commitlint, Node.js 22+ |
| APIs | NestJS 11, Drizzle ORM and drizzle-kit, `postgres` driver, zod, RxJS; `jose` (pos-api); Jest and Supertest |
| Web | React 19, TanStack Start and Router, Vite 8, Nitro, Tailwind CSS 4, `tw-animate-css`, lucide-react, `qrcode-generator`; Vitest |
| UI package | Radix UI (dialog, dropdown, popover, tooltip), TanStack Table, class-variance-authority, clsx, tailwind-merge, react-day-picker, sonner |
| Database | PostgreSQL 16 (Docker Compose for local work) |

## 🤝 Contributing

1. Read [CLAUDE.md](CLAUDE.md): the working rules for people and agents.
2. Use conventional commits with a scope from `commitlint.config.js`, for example `feat(catalog): …`.
3. With the database up, run every check before sending changes:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

**Found a bug or have an idea?** Open an issue in this repository. Never include real customer data, PINs or keys; for
a security problem, contact the maintainer privately.

## 📚 More documentation

- [Epic plan](docs/plans/2026-11-17-001-feat-pos-epic-plan.md) and the other [plans](docs/plans)
- [Reference run of Lakasir](docs/reference/lakasir-findings.md)

## ⚖️ License and credits

**GPL-3.0-or-later**, see [LICENSE](LICENSE). A port of [Lakasir](https://github.com/lakasir/lakasir), rebuilt on
NestJS and TanStack Start; attribution is in [NOTICE](NOTICE).
