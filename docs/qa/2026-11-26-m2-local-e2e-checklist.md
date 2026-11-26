# M2 local end-to-end checklist (UMK-1975)

The whole POS on a local stack, before any deploy. It covers each `[qa]` line of
[UMK-1975](https://linear.app/umkmall/issue/UMK-1975):

| UMK-1975 `[qa]` line | Where |
|---|---|
| Browser flow as owner and as cashier on a bound device: catalog, purchase/stock in, open shift, cash, voucher and kasbon sales, void/refund, receivable payment, stock opname, close shift, every report and CSV | Parts 1 to 6 (browser) |
| Two stores side by side: nothing from store A shows in store B | Part 7 (browser) and the API run |
| Agent scenario over MCP on localhost; the same numbers show in pos-web | Part 8 (API run plus a browser check) |
| Screenshots and a checklist in `docs/qa/` and `.evidence/`; every failure becomes an issue | This file, the screenshot list in each part, "Reporting" at the end |

**Who runs what.** The API and MCP part was run on 26 Nov 2026 by `scripts/qa/m2-api-mcp-run.mjs`. Its results
are in [2026-11-26-m2-api-mcp-run.md](2026-11-26-m2-api-mcp-run.md). The browser parts (1 to 7 and the pos-web
half of 8) are for a person or an agent on the owner's Mac. Follow the steps in order: later numbers depend on
earlier steps. The numbers are the same ones the script checks, except where a step says otherwise.

Tick `[x]` for pass. For a fail, write what you saw next to the box, take a screenshot and follow "Reporting".

---

## Part 0. Setup (Mac, about 15 minutes)

Needs Node 22+, Docker running, and free ports 3000, 3001, 3101, 3102 and 5544. The commands are README
"Installation" steps 1 to 5, plus a second store and the fake gateway. The same commands were run on 26 Nov 2026
against a private Postgres on another port (no Docker in that container). Every command below worked there with
only the port changed.

### 0.1 Code and database

```bash
git clone https://github.com/jamalbaharun-umk/umkmall-pos.git && cd umkmall-pos   # or: git pull --rebase in your checkout
npm install
npm run db:up
docker compose exec -T postgres psql -U pos -d pos < ops/local-public-users.sql
docker compose exec -T postgres psql -U pos -d pos < ops/pos-role.sql
docker compose exec -T postgres psql -U pos -d pos -c "create database payment"      # "already exists" is fine
docker compose exec -T postgres psql -U pos -d payment < ops/payment-role.sql
docker compose exec -T postgres psql -U pos -d pos -c "alter role pos_app password 'local-pos'" -c "alter role payment_app password 'local-pay'"
npm run build -w pos-api -w payment-api
DATABASE_URL=postgres://payment_app:local-pay@localhost:5544/payment npm run db:migrate -w payment-api
DATABASE_URL=postgres://pos_app:local-pos@localhost:5544/pos npm run db:migrate -w pos-api
```

- [ ] Both migrate commands print `... migrations applied: N` (26 Nov: payment 5, pos 44).

**Use fresh stores.** The expected numbers assume empty stores. Make two NEW owners, even if you have a demo owner
already:

```bash
docker compose exec -T postgres psql -U pos -d pos -tAc "insert into public.users default values returning id"   # → USER_A
docker compose exec -T postgres psql -U pos -d pos -tAc "insert into public.users default values returning id"   # → USER_B
```

- [ ] Note USER_A = `__________________` and USER_B = `__________________`.

### 0.2 Start the services (one terminal each)

```bash
# T1 payment-api with the fake gateway
NODE_ENV=development PAYMENT_ADAPTERS=fake DATABASE_URL=postgres://payment_app:local-pay@localhost:5544/payment PAYMENT_SERVICE_KEY=local-payment-service-key npm run start -w payment-api

# T2 pos-api (POS_AGENT_SERVICE_KEY is only needed for the real agent route; the dev agent session works without it)
NODE_ENV=development DATABASE_URL=postgres://pos_app:local-pos@localhost:5544/pos POS_SESSION_SECRET=local-session-secret-at-least-32-characters POS_SERVICE_KEY=local-pos-service-key UMKMALL_WEB_URL=http://127.0.0.1:9099 PAYMENT_API_URL=http://localhost:3001 PAYMENT_SERVICE_KEY=local-payment-service-key npm run start -w pos-api

# T3 pos-web for store A
POS_API_URL=http://localhost:3000 POS_DEV_USER_ID=<USER_A> npm run dev -w pos-web

# T4 pos-web for store B, on port 3102 (run from apps/pos-web)
cd apps/pos-web && POS_API_URL=http://localhost:3000 POS_DEV_USER_ID=<USER_B> npx vite dev --port 3102
```

- [ ] `curl -s localhost:3000/health` and `curl -s localhost:3001/health` both answer `{"status":"ok"}`.

**Three browser contexts.** A browser keeps cookies per host, not per port. So `localhost:3101` and
`localhost:3102` in one browser would share one session cookie. Use:

| Context | Browser | URL |
|---|---|---|
| OWNER A | Chrome, normal window | http://localhost:3101 |
| DEVICE A (the cashier's bound device) | Chrome, Incognito window | http://localhost:3101/kasir/masuk |
| OWNER B | Safari (or a second Chrome profile) | http://localhost:3102 |

### 0.3 Helper for the fake gateway

The fake gateway is driven with curl, as the payment gateway would be. You need store A's tenant id:

```bash
docker compose exec -T postgres psql -U pos -d pos -tAc "select id from pos.tenants where user_id = '<USER_A>'"   # → TENANT_A (exists after the first sign-in)
FG() { curl -s -X "${2:-POST}" "localhost:3001/dev/fake-gateway$1" -H "X-Payment-Service-Key: local-payment-service-key" -H "X-Tenant-Id: $TENANT_A" -H 'Content-Type: application/json' -d '{}'; echo; }
```

---

## Part 1. Owner A sets up the store (OWNER A)

Screenshots: `.evidence/m2-browser/01-*.png` for each step marked 📷.

1. **Sign in.** Open http://localhost:3101 and press **Masuk (pengembangan)**.
   - [ ] You land on the **Dashboard** (`/`). It shows Rp0 revenue and 0 transactions for **Hari ini**. 📷
2. **Store profile.** `/pengaturan` → **Profil toko**: Nama toko `Toko QA A`, Jenis usaha *Retail*, Alamat
   `Jl. QA 1` → **Simpan**.
   - [ ] Success message. After a reload the name is kept.
3. **Tax 10%.** `/pengaturan` → **Aplikasi** → Pajak bawaan `10` % → save.
   - [ ] Saved. A reload shows 10%. Zona waktu laporan is `Asia/Jakarta`.
4. **Admin PIN.** `/pengaturan/keamanan` → PIN admin `111111` → **Simpan PIN**.
   - [ ] Saved. This PIN approves the void and the refund later.
5. **Category.** `/catalog/categories` → **Tambah kategori** `Sembako`.
   - [ ] It is listed.
6. **Products.** `/catalog/products/baru`, category Sembako, unit PCS. No opening stock: stock comes from the
   purchase.

   | Nama | Harga modal | Harga jual | Extra |
   |---|---|---|---|
   | Teh Botol | 3000 | 5000 | **Satuan lain**: `dus`, isi 12, harga 54000. **Harga grosir**: min 10, harga 4500 |
   | Beras 5kg | 60000 | 75000 | |
   | Gula 1kg | 13000 | 16000 | |
   | Kerupuk | 2000 | 2750 | |

   - [ ] `/catalog/products` lists 4 products. SKUs are generated (for example `SEM-TEH-0001`). Stock is 0. 📷
   - [ ] Try a dus price of 60000 on Teh Botol: a field error says 1 dus is dearer than 12 PCS at the wholesale
     price (Rp54.000). Put it back to 54000.
7. **Supplier.** `/pemasok` → **Pemasok baru**: `CV Sumber Pangan`, phone `081234567890`.
   - [ ] Listed.
8. **Purchase (stock in).** `/pembelian/baru`: supplier CV Sumber Pangan. Lines: Teh Botol 48 × 3000, Beras 5kg
   10 × 60000, Gula 1kg 20 × 13000, Kerupuk 10 × 2000 → **Simpan sebagai draf**.
   - [ ] The draft total is **Rp1.024.000**. 📷
   - [ ] Open it → **Setujui dan tambah stok** → **Setujui**. The status is approved and the purchase is locked.
   - [ ] `/catalog/products` stock: Teh 48, Beras 10, Gula 20, Kerupuk 10.
9. **Payment methods.** `/metode-pembayaran`: add `Debit BCA` (Debit) and `Kasbon` (Kasbon (kredit)).
   - [ ] Three methods are listed: Tunai, Debit BCA, Kasbon.
10. **Customer.** `/pelanggan` → **Tambah pelanggan**: `Ibu Rina`, code `PLG001`.
    - [ ] Listed with code PLG001.
11. **Voucher.** `/voucher` → **Tambah voucher**: name `Diskon 10%`, code `DISKON10`, Persen 10, kuota 5, from
    today to today + 30 days.
    - [ ] Listed. Kuota 5.
12. **Roles and staff.** `/staf/peran` → **Tambah peran**:
    - `Kasir senior`: Membuat penjualan (`sales.create`), piutang (`receivables.manage`), kas toko
      (`store_cash.manage`), pengeluaran (`expenses.manage`), laporan (`reports.view`).
    - `Penagih`: only piutang (`receivables.manage`). A collector must NOT hold sales.create. A seller without a
      shift is told to open one instead of holding the cash.

    `/staf/baru`: `Budi`, PIN `222222`, role Kasir senior. `Sari`, PIN `333333`, role Penagih.
    - [ ] Both are listed with their roles. The default roles Pemilik, Admin and Kasir also exist.
13. **Online payments (fake gateway).** `/pengaturan/pembayaran-online`: business type individual, name
    `Toko QA A`, email `qa@example.test`, phone `+6281234567890`, accept the terms → **Ajukan**.
    - [ ] The status is *submitted*. Get TENANT_A (0.3), then run `FG /account/approve` → `200`.
    - [ ] Press **Cek status**: verified. Switch on the **fake_qris** method: the status becomes **Aktif**. 📷
    - [ ] `/metode-pembayaran`: add `QRIS Online`, type **Online (QRIS / VA / link)**, method fake_qris. It is
      listed.

## Part 2. Pair the cashier device (DEVICE A + OWNER A)

1. DEVICE A: open http://localhost:3101/kasir/masuk.
   - [ ] It shows a 6-digit code (valid for 10 minutes, single use) and no staff list. 📷
2. OWNER A: `/staf/perangkat` → **Hubungkan perangkat** → type the code, name `HP Kasir QA` → confirm.
   - [ ] The device is listed. Within a few seconds DEVICE A moves on to **Siapa yang berjaga?** and lists Budi
     and Sari. 📷
3. OWNER A: type the same code again.
   - [ ] Refused (the code is single use).
4. DEVICE A: tap Budi, type `999999`.
   - [ ] Refused with a wrong-PIN message. Then type `222222` → **Masuk**: signed in as Budi.
5. Not paired: in a browser context that was never paired (a Chrome Guest window, or Firefox; NOT a second
   Incognito window, which shares DEVICE A's cookies), `/kasir/masuk` shows a NEW pairing code, not the staff list.
   - [ ] Pass.

## Part 3. A day at the till (DEVICE A as Budi)

The shell shows Budi only the menu entries his role allows. Kasir (`/kasir`) is full screen.

1. **Open the shift.** `/kasir`: **Uang awal di laci** `200000` → **Buka shift**.
   - [ ] The product grid appears. Before this, no sale can be made.
2. **S1, cash with rounding.** Teh Botol × 3, Kerupuk × 1 → **Lanjut ke pembayaran** → Tunai, Uang diterima 20000
   → **Bayar**.
   - [ ] Subtotal 17.750, Pajak 1.775, Total 19.525, **Pembulatan 75**, to pay **19.600**, **Kembalian 400**. 📷
   - [ ] **Cetak struk** opens `/kasir/struk/<id>` with the same figures → **Transaksi baru**.
3. **S2, unit and wholesale.** Teh Botol 1 **dus** + Teh Botol 10 PCS. A tier counts the product's total base
   quantity (12 + 10 = 22 ≥ 10).
   - [ ] Lines: 1 dus × 54.000 and 10 PCS × **4.500** (wholesale price), subtotal 99.000, tax 9.900, total
     **108.900**. Pay 110000 cash → change **1.100**. 📷
4. **S3, voucher + debit.** Beras 5kg × 2, **Pakai voucher** `diskon10` (lower case is accepted) → **Pakai**.
   Method Debit BCA.
   - [ ] Subtotal 150.000, Voucher −15.000, Pajak **13.500** (10% of 135.000: tax after the discount), Total
     **148.500**, no rounding (not cash). 📷
5. **S4, kasbon.** Beras 5kg × 1. Choose Kasbon without a customer.
   - [ ] Refused: a customer is required. Then **Pilih pelanggan** Ibu Rina, Kasbon, down payment `20000` →
     **Simpan kasbon**.
   - [ ] Total 82.500, paid 20.000, the rest **62.500** becomes Ibu Rina's kasbon (due in 14 days). 📷
6. **S5, cash, to be voided.** Gula 1kg × 2, **Uang pas**.
   - [ ] Total 35.200, change 0.
7. **Stock now** (owner's `/catalog/products`, or the cashier's grid): Teh 23, Beras 7, Gula 18, Kerupuk 9.
   - [ ] Pass.
8. **Void S5.** `/kasir/riwayat` → open S5 → **Batalkan transaksi** → reason *Pelanggan batal*, approver
   Pemilik, PIN `000000`.
   - [ ] Refused (wrong PIN). Then PIN `111111` → the sale shows a **VOID** mark. Gula is back to 20. 📷
9. **S6, online (fake gateway).** Gula 1kg × 1 → method QRIS Online → show the QR.
   - [ ] A QR for **Rp17.600** with an expiry. "Menunggu" lists the sale. 📷
   - [ ] In a terminal: `FG /payments GET` lists a bill of 17600 with `providerRef` `FAKE-QR-…`. Run
     `FG /payments/<providerRef>/pay`.
   - [ ] Within about 3 seconds (or press **Cek status pembayaran**) the screen says **Pembayaran diterima**. 📷
10. **Refund S6.** `/kasir/riwayat` → S6. **Batalkan transaksi** is not offered for a paid online sale (the API
    answers 409 `use_refund`). Press **Refund struk** → reason *Barang dikembalikan*, approver Pemilik, PIN
    `111111`.
    - [ ] The refund is accepted and the sale ends as VOID / refunded. Gula is 20 again. 📷

## Part 4. Kasbon payment, drawer cash, collector deposit (DEVICE A)

1. **Receivable payment at the till.** As Budi, `/piutang` → Ibu Rina's kasbon (rest 62.500) → **Bayar** →
   **Tambah pembayaran**: 70000 Tunai.
   - [ ] Refused (more than the balance). Then 30000 Tunai → rest **32.500**. 📷
2. **Collector.** On DEVICE A sign out and sign in as **Sari** (`333333`). She has no shift and does not sell.
   `/piutang` → the same kasbon → 12500 Tunai.
   - [ ] Accepted. Rest **20.000**.
   - [ ] Sari has no Kas toko screen. Her deposit cannot be recorded by herself (API: refused).
3. **Deposit.** Sign in as **Budi** again. `/kas-toko` → **Uang dipegang penagih** lists Sari: ditagih 12.500,
   belum disetor 12.500 → **Terima setoran** 12500 → into **Laci shift Anda yang sedang buka**.
   - [ ] Sari shows 0 belum disetor. `/kas-toko/setoran` lists the deposit (Diserahkan oleh Sari, Diterima oleh
     Budi). 📷
4. **Drawer cash.** `/kasir/kas-laci` → **Tambah uang** 50000, reason Tambah modal. **Ambil uang** 100000,
   reason Setor bank.
   - [ ] Both are listed in the drawer ledger.
5. **Drawer expense.** `/pengeluaran/baru`: 10000, Listrik & air, source **Laci kasir**, note `Token listrik` →
   **Simpan**.
   - [ ] Listed on `/pengeluaran`.
6. **Expected cash.** `/kasir/kas-laci` (or the close screen) shows the parts: opening 200.000, cash sales
   **183.700** (S1 19.600 + S2 108.900 + S5 35.200 + kasbon down payment 20.000), kasbon payments 30.000, setoran
   12.500, kas masuk 50.000, kas keluar 100.000, void 35.200, pengeluaran 10.000.
   - [ ] Kas seharusnya **Rp331.000**. 📷

## Part 5. Stock opname (OWNER A)

1. `/stok-opname/baru`: Kerupuk, **Jumlah dihitung** 8, **Alasan** `Rusak 1` → **Simpan sebagai draf**.
   - [ ] The draft shows system 9, counted 8, **Selisih −1**. 📷
2. **Setujui dan sesuaikan stok**.
   - [ ] Kerupuk stock is 8. The product's stock movements show the opname.

## Part 6. Close the shift and every report (DEVICE A, then OWNER A)

1. DEVICE A as Budi: `/kasir/tutup` → **Uang yang dihitung** `330500`.
   - [ ] Expected 331.000, difference **−500** (less) → **Tutup shift** → confirm. 📷
   - [ ] `/kasir/shift` lists the closed shift. **Lihat** shows the same figures.
2. OWNER A, **Dashboard** **Hari ini**:
   - [ ] Transactions **4**, revenue **Rp359.425**, gross profit **Rp69.750**. 📷
3. `/laporan/penjualan`, today → **Tampilkan**:
   - [ ] Totals: Penjualan kotor 341.750, Voucher 15.000, Pajak 32.675, Pendapatan **359.425**, Modal 257.000,
     Laba kotor **69.750**, Pembulatan 75. The voided S5 and the refunded S6 each appear twice: once, then again
     with negative figures. 📷
   - [ ] **Unduh CSV** → `laporan-penjualan-<date>_<date>.csv`. The `Total` row has Qty 18 (each line in its own
     unit), Jumlah 341750 (the line amounts before the voucher), Modal 257000. The summary lines are Pendapatan 359425, Laba kotor 69750,
     Pembulatan 75.
   - [ ] **Cetak** prints only the report card.
4. `/laporan/produk`:
   - [ ] Teh Botol qty **25**, Penjualan 114.000, Modal 75.000, Laba kotor 39.000. Beras 5kg 3 / 225.000 / 180.000 /
     45.000. Kerupuk 1 / 2.750 / 2.000 / 750. Gula is not listed (sold and voided the same day nets to nothing).
   - [ ] **Unduh CSV**: the same rows.
5. `/laporan/shift`:
   - [ ] One row: Budi, Transaksi 4, Pendapatan 359.425, Kas awal 200.000, Pembayaran piutang 30.000, Kas masuk
     92.500, Kas keluar 145.200, Kas seharusnya 331.000, Kas dihitung 330.500, Selisih −500.
   - [ ] **Unduh CSV**: the same row.
6. `/laporan/pembelian`:
   - [ ] CV Sumber Pangan, 4 lines, total qty 88, **Rp1.024.000**. **Unduh CSV**: the same.
7. `/laporan/untung-rugi`, today:
   - [ ] Hasil jualan (tanpa pajak) **326.750**, Modal barang terjual 257.000, Untung kotor 69.750, Pengeluaran
     10.000 (Listrik & air), Untung bersih **59.750**. Pajak 32.675 and Pembulatan 75 are shown outside revenue.
   - [ ] Known gap: pos-web has no CSV button here (the API has `GET /reports/profit-loss/csv`). Note it, do not
     fail the run on it.
8. `/pengeluaran`: one expense 10.000, Laci kasir, by Budi.
   - [ ] Pass. (The API has `GET /expenses/csv`; pos-web shows no button. Same note as above.)
9. Empty and error states: `/laporan/penjualan` for a date range with no sales shows the empty state. Stop pos-api
   (T2) for a moment and reload: an Indonesian error message, no stack trace. Start it again.
   - [ ] Pass.

## Part 7. Two stores side by side (OWNER B, with OWNER A open)

1. OWNER B: http://localhost:3102 → **Masuk (pengembangan)**.
   - [ ] Dashboard Rp0, 0 transactions. Store name empty.
2. Every list in store B is empty of store A's data: `/catalog/products`, `/catalog/categories`, `/pemasok`,
   `/pelanggan`, `/voucher`, `/pembelian`, `/stok-opname`, `/piutang`, `/kas-toko`, `/kas-toko/setoran`,
   `/pengeluaran`, `/kasir/riwayat`, `/kasir/shift`, `/staf`, `/staf/perangkat`, `/metode-pembayaran` (Tunai only),
   `/laporan/penjualan` (today: 0), `/laporan/untung-rugi` (0), `/pengaturan/pembayaran-online` (not submitted).
   - [ ] Nothing of store A appears anywhere. 📷 one of them.
3. Paste store A's URLs into OWNER B. Copy them from OWNER A's address bar: a product
   `/catalog/products/<id>`, a purchase `/pembelian/<id>`, an opname `/stok-opname/<id>`, a sale
   `/kasir/riwayat/<id>`, a receipt `/kasir/struk/<id>`, a kasbon `/piutang/<id>`, a shift `/kasir/shift/<id>`, an
   expense `/pengeluaran/<id>`, a staff member `/staf/<id>`.
   - [ ] Each shows "not found" (or the not-found page). None shows store A's data. 📷
4. In store B, add a product `Produk B` (non-stock, 1000), open a shift with 0 and sell 2. Then check store A.
   - [ ] Store A's reports, sales list and products do not change.
5. DEVICE A stays bound to store A: Budi's grid shows store A's products only.
   - [ ] Pass.

## Part 8. The agent over MCP, the same numbers in pos-web

The MCP calls were run by the script on 26 Nov 2026 (store "C", see the run file). To see it yourself on the Mac:

1. Make a third owner USER_C (as in 0.1) and start pos-web for it on port 3103 (as T4, with
   `POS_DEV_USER_ID=<USER_C>`). Open it in a third browser context.
2. Run the script against the same stack. It makes its own stores, so use fresh ids:

   ```bash
   POS_API_URL=http://localhost:3000 PAYMENT_API_URL=http://localhost:3001 PAYMENT_SERVICE_KEY=local-payment-service-key \
   QA_ADMIN_DATABASE_URL=postgres://pos:pos@localhost:5544/pos QA_OUT=.evidence/m2-api-mcp-run.json \
   node scripts/qa/m2-api-mcp-run.mjs
   ```

   Or by hand with an MCP client. Get a session with
   `curl -s -X POST localhost:3000/auth/dev/agent-session -H 'content-type: application/json' -d '{"userId":"<USER_C>","scopes":["pos.read","pos.write"]}'`,
   then use `claude mcp add --transport http umkmall-pos http://localhost:3000/mcp --header "Authorization: Bearer <sessionToken>"`
   (or the MCP Inspector, docs/agent-integration.md section 2). Then: `create_category` "Kopi & Roti";
   `create_product` Kopi Susu (12000, cost 7000, unit cup) and Roti Bakar (8500, cost 5000), each first without
   `confirm` (preview), then with `confirm: true` and the same key. Stock in is done by the owner in the browser:
   a purchase of Kopi 20 × 7000 and Roti 10 × 5000, approved (there is no MCP tool for stock in). Then
   `open_shift` 100000; `record_sale` Kopi 2 + Roti 3 (preview, then confirm); `record_sale` Roti 1; then
   `sales_report`, `product_report`, `store_summary`, `profit_loss` for today.
   - [ ] The MCP answers are: 2 sales, revenue **58.000**, cost 34.000, gross profit **24.000**; Kopi qty 2, Roti
     qty 4; current shift expected cash **158.000**.
3. In pos-web for that store (the owner's browser):
   - [ ] Dashboard Hari ini: 2 transactions, Rp58.000, gross profit Rp24.000.
   - [ ] `/laporan/penjualan`: Pendapatan 58.000, Laba kotor 24.000. The cashier column says **Agent UMKMall**.
   - [ ] `/laporan/produk`: Kopi Susu 2, Roti Bakar 4.
   - [ ] `/kasir/riwayat`: two receipts, seller Agent UMKMall, 49.500 and 8.500.
   - [ ] `/pengaturan` or the agent activity page (if shown): the agent's calls are recorded (`GET /agent/activity`).
4. Owner switch: `curl -X POST localhost:3000/agent/access/revoke -H "Authorization: Bearer <owner token>"`. The
   owner token is in the response of `POST /auth/dev/sign-in {"userId":"<USER_C>"}`. After that, an MCP call with
   the old agent token answers 401, and a new agent session answers 403. `POST /agent/access/enable` turns it back
   on.
   - [ ] Pass.

---

## Reporting

- Screenshots: `.evidence/m2-browser/<part>-<step>.png` (the 📷 steps). `.evidence/` is git-ignored: keep the
  files on the Mac, attach the important ones to the Linear issue, and list them in a results file
  `docs/qa/<date>-m2-browser-run.md` (what ran, pass/fail per step, what was not exercised).
- Every failure: one Linear issue in project **UMKMall POS**, label **Bug**, English. Give the route, the step
  number here, what you did, the expected and observed values, and the screenshot. Link it to UMK-1975.
- Already known, do not file again: UMK-2069 (MCP `record_sale` drops a line price instead of refusing it).
- Stop everything at the end: Ctrl+C in T1 to T4, then `docker compose stop`.
