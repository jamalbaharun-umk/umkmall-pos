#!/usr/bin/env node
// M2 local end-to-end run, API and MCP part (UMK-1975). Drives a RUNNING local stack over real HTTP: two stores
// side by side through the owner's and a paired cashier device's sessions, then the agent scenario over MCP with
// the same numbers checked against the REST reports. It changes nothing but the data of the stores it creates.
//
// Run from the repository root (node_modules installed), with pos-api started with NODE_ENV=development:
//   POS_API_URL=http://localhost:3000 \
//   QA_ADMIN_DATABASE_URL=postgres://pos:pos@localhost:5544/pos \   # creates the stub UMKMall users (local only)
//   PAYMENT_API_URL=http://localhost:3001 PAYMENT_SERVICE_KEY=... \  # optional: online sale with the fake gateway
//   QA_OUT=.evidence/m2-api-mcp-run.json \                           # optional: every check as JSON
//   node scripts/qa/m2-api-mcp-run.mjs
// Instead of QA_ADMIN_DATABASE_URL, QA_USER_A, QA_USER_B and QA_USER_C may name three existing public.users ids
// (each becomes, or already is, one store: use fresh ones, the expected numbers assume empty stores).
// Exit code 1 when any check fails. Never prints a token, PIN or pairing code.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const POS = (process.env.POS_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PAY = process.env.PAYMENT_API_URL?.replace(/\/$/, '');
const PAY_KEY = process.env.PAYMENT_SERVICE_KEY;
const RUN = randomUUID().slice(0, 8);

// ---------------------------------------------------------------- checks

const results = [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Records one check: `expected` is compared as JSON with `observed`; a function decides by itself. */
function check(id, what, observed, expected) {
  const ok = typeof expected === 'function' ? !!expected(observed) : same(observed, expected);
  results.push({
    id,
    what,
    ok,
    observed,
    ...(typeof expected !== 'function' && { expected }),
  });
  const show = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  process.stdout.write(
    `${ok ? 'PASS' : 'FAIL'} ${id} ${what}: ${show(observed)}${ok || typeof expected === 'function' ? '' : ` (expected ${show(expected)})`}\n`,
  );
  return ok;
}
/** The items of a list answer, whatever its envelope. */
const rows = (d) =>
  Array.isArray(d)
    ? d
    : (d?.data ?? d?.rows ?? d?.items ?? d?.staff ?? d?.approvers ?? d?.collectors ?? d?.calls ?? []);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k]]));

// ---------------------------------------------------------------- http

async function api(method, path, { auth, body, key, device, raw } = {}) {
  const headers = { accept: raw ? 'text/csv' : 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (key) headers['idempotency-key'] = key;
  if (device) headers['x-pos-device'] = device;
  const res = await fetch(POS + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  if (!raw) {
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON: kept as text */
    }
  }
  return { status: res.status, data, type: res.headers.get('content-type') ?? '' };
}
/** A call that must succeed: throws with the route and answer otherwise (the run stops there). */
async function ok(method, path, opts) {
  const r = await api(method, path, opts);
  if (r.status >= 300)
    throw new Error(`${method} ${path} answered ${r.status}: ${JSON.stringify(r.data).slice(0, 500)}`);
  return r.data;
}
const key = (what) => `qa-${RUN}-${what}`;

async function gateway(tenantId, path, body = {}) {
  const res = await fetch(`${PAY}/dev/fake-gateway${path}`, {
    method: body === null ? 'GET' : 'POST',
    headers: {
      'X-Payment-Service-Key': PAY_KEY,
      'X-Tenant-Id': tenantId,
      'Content-Type': 'application/json',
    },
    body: body === null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

// ---------------------------------------------------------------- setup helpers

async function stubUsers(n) {
  const given = [process.env.QA_USER_A, process.env.QA_USER_B, process.env.QA_USER_C].filter(Boolean);
  if (given.length >= n) return given.slice(0, n);
  const url = process.env.QA_ADMIN_DATABASE_URL;
  if (!url) throw new Error('Set QA_ADMIN_DATABASE_URL, or QA_USER_A, QA_USER_B and QA_USER_C');
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const ids = [];
    for (let i = 0; i < n; i++) ids.push((await sql`insert into public.users default values returning id`)[0].id);
    return ids;
  } finally {
    await sql.end();
  }
}

/** The owner's dev session (15 minutes; signed again before each part). */
async function owner(userId) {
  const s = await ok('POST', '/auth/dev/sign-in', { body: { userId } });
  return { token: s.sessionToken, tenantId: s.tenant.id, userId };
}

function today(tz = 'Asia/Jakarta') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}
function plusDays(d, n) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- store A: the full day

async function storeA(userA) {
  let o = await owner(userA);
  const A = { owner: o };
  const T = () => A.owner.token;
  const day = today();

  // --- setup: profile, tax 10%, catalog
  await ok('PUT', '/store/profile', {
    auth: T(),
    body: { name: 'Toko QA A', businessType: 'retail', address: 'Jl. QA 1' },
  });
  check(
    'A.setup.tax',
    'tax set to 10% (taxBps)',
    (await ok('PUT', '/sales/settings', { auth: T(), body: { taxBps: 1000 } })).taxBps,
    1000,
  );
  const cat = await ok('POST', '/catalog/categories', { auth: T(), body: { name: 'Sembako' } });
  const product = (body) => ok('POST', '/catalog/products', { auth: T(), body: { categoryId: cat.id, ...body } });
  const teh = await product({
    name: 'Teh Botol',
    costPrice: 3000,
    sellingPrice: 5000,
    units: [{ name: 'dus', unitQty: 12, price: 54000 }],
    priceTiers: [{ minQty: 10, price: 4500 }],
  });
  const beras = await product({ name: 'Beras 5kg', costPrice: 60000, sellingPrice: 75000 });
  const gula = await product({ name: 'Gula 1kg', costPrice: 13000, sellingPrice: 16000 });
  const kerupuk = await product({ name: 'Kerupuk', costPrice: 2000, sellingPrice: 2750 });
  A.products = { teh, beras, gula, kerupuk };
  A.category = cat;
  check(
    'A.catalog.list',
    'product list total after 4 creates',
    (await ok('GET', '/catalog/products', { auth: T() })).total,
    4,
  );

  // --- purchase + approve (stock in)
  const supplier = await ok('POST', '/suppliers', {
    auth: T(),
    body: { name: 'CV Sumber Pangan', phone: '081234567890' },
  });
  A.supplier = supplier;
  const po = await ok('POST', '/purchasing/orders', {
    auth: T(),
    body: {
      supplierId: supplier.id,
      lines: [
        { productId: teh.id, qty: 48, unitCost: 3000 },
        { productId: beras.id, qty: 10, unitCost: 60000 },
        { productId: gula.id, qty: 20, unitCost: 13000 },
        { productId: kerupuk.id, qty: 10, unitCost: 2000 },
      ],
    },
  });
  A.purchase = po;
  check('A.purchase.draft', 'purchase draft status and total', pick(po, ['status', 'total']), {
    status: 'draft',
    total: 1024000,
  });
  const approved = await ok('POST', `/purchasing/orders/${po.id}/approve`, { auth: T(), body: {} });
  check('A.purchase.approve', 'purchase approved', approved.status, (s) => s === 'approved' || s === 'received');
  const onHand = async (p) => (await ok('GET', `/stock/products/${p.id}`, { auth: T() })).onHand;
  check(
    'A.stock.afterPurchase',
    'on hand Teh/Beras/Gula/Kerupuk after approve',
    [await onHand(teh), await onHand(beras), await onHand(gula), await onHand(kerupuk)],
    [48, 10, 20, 10],
  );

  // --- payment methods, member, voucher, owner void PIN
  const debit = await ok('POST', '/payment-methods', { auth: T(), body: { name: 'Debit BCA', kind: 'debit' } });
  const kasbon = await ok('POST', '/payment-methods', { auth: T(), body: { name: 'Kasbon', kind: 'credit' } });
  const member = await ok('POST', '/members', { auth: T(), body: { name: 'Ibu Rina', code: 'PLG001' } });
  const voucher = await ok('POST', '/vouchers', {
    auth: T(),
    body: {
      name: 'Diskon 10%',
      code: 'DISKON10',
      type: 'percentage',
      nominal: 10,
      kuota: 5,
      startDate: day,
      expired: plusDays(day, 30),
    },
  });
  A.member = member;
  A.voucher = voucher;
  A.methods = { debit, kasbon };
  check(
    'A.voidPin.set',
    'owner sets a void PIN',
    (await api('PUT', '/void-pin', { auth: T(), body: { pin: '111111' } })).status,
    (s) => s === 200 || s === 204,
  );

  // --- staff: a till cashier with receivables, store cash, expenses and reports; a collector (Penagih)
  const roles = rows(await ok('GET', '/roles', { auth: T() }));
  const tillRole = await ok('POST', '/roles', {
    auth: T(),
    body: {
      name: 'Kasir senior',
      // reports.view: the browser's Kas toko screen, where he receives a collector's deposit, needs it.
      permissions: ['sales.create', 'receivables.manage', 'store_cash.manage', 'expenses.manage', 'reports.view'],
    },
  });
  const budi = await ok('POST', '/staff', { auth: T(), body: { name: 'Budi', pin: '222222', roleIds: [tillRole.id] } });
  // A collector is someone who may take kasbon payments but does not sell (no sales.create): cash she takes is held
  // by her until another person receives it (a seller is told to open a shift instead).
  const collectorRole = await ok('POST', '/roles', {
    auth: T(),
    body: { name: 'Penagih', permissions: ['receivables.manage'] },
  });
  const sari = await ok('POST', '/staff', {
    auth: T(),
    body: { name: 'Sari', pin: '333333', roleIds: [collectorRole.id] },
  });
  check(
    'A.roles.default',
    'default roles Pemilik, Admin, Kasir exist',
    ['Pemilik', 'Admin', 'Kasir'].every((n) => roles.some((r) => r.name === n)),
    true,
  );
  A.staff = { budi, sari };

  // --- device pairing by code (UMK-2022)
  const start = await ok('POST', '/auth/device/pairing', { body: {} });
  check(
    'A.pair.code',
    'pairing answers a 6-digit code and a token',
    /^[0-9]{6}$/.test(start.code) && typeof start.pairingToken === 'string',
    true,
  );
  const pending = await ok('POST', '/auth/device/pairing/status', { body: { pairingToken: start.pairingToken } });
  check('A.pair.pending', 'status before the claim', pending.status, 'pending');
  const claim = await api('POST', '/staff/devices/pair', {
    auth: T(),
    body: { code: start.code, name: 'HP Kasir QA' },
  });
  check('A.pair.claim', 'owner claims the code', claim.status, (s) => s === 200 || s === 201);
  const paired = await ok('POST', '/auth/device/pairing/status', { body: { pairingToken: start.pairingToken } });
  check('A.pair.paired', 'status after the claim', paired.status, 'paired');
  const device = paired.deviceToken;
  const reuse = await api('POST', '/staff/devices/pair', { auth: T(), body: { code: start.code, name: 'Lagi' } });
  check('A.pair.singleUse', 'the same code a second time is refused', reuse.status, (s) => s >= 400 && s < 500);
  const roster = await ok('GET', '/auth/device/staff', { device });
  const names = rows(roster).map((s) => s.name);
  check(
    'A.pair.roster',
    'device roster lists Budi and Sari',
    ['Budi', 'Sari'].every((n) => names.includes(n)),
    true,
  );
  const pin = async (staffId, p) => (await ok('POST', '/auth/pin', { device, body: { staffId, pin: p } })).sessionToken;
  const wrong = await api('POST', '/auth/pin', { device, body: { staffId: budi.id, pin: '999999' } });
  check('A.pin.wrong', 'wrong PIN refused', wrong.status, 401);
  const budiT = await pin(budi.id, '222222');
  A.budiToken = budiT;
  const noDevice = await api('POST', '/auth/pin', { body: { staffId: budi.id, pin: '222222' } });
  check(
    'A.pin.noDevice',
    'PIN sign-in without a paired device refused',
    noDevice.status,
    (s) => s === 401 || s === 403,
  );

  // --- open shift as Budi
  check(
    'A.shift.none',
    'no open shift before opening',
    (await ok('GET', '/shifts/current', { auth: budiT })).shift,
    null,
  );
  const noShiftSale = await api('POST', '/sales', {
    auth: budiT,
    key: key('noshift'),
    body: { lines: [{ productId: gula.id, qty: 1 }], paid: 20000 },
  });
  check('A.sale.noShift', 'sale without an open shift refused', noShiftSale.status, (s) => s >= 400 && s < 500);
  const shift = await ok('POST', '/shifts/open', { auth: budiT, body: { openingCash: 200000 } });
  A.shift = shift;
  check('A.shift.open', 'shift opened with Rp200.000', shift.openingCash, 200000);

  const sale = (k, body) => ok('POST', '/sales', { auth: budiT, key: key(k), body });
  const money = ['subtotal', 'voucherDiscount', 'tax', 'total', 'rounding', 'amountDue', 'paid', 'change', 'status'];
  // A cashier's answers carry no cost; the owner's read of the same sale does.
  const costOf = async (sale) => (await ok('GET', `/sales/${sale.id}`, { auth: T() })).costTotal;

  // S1 cash with rounding: Teh 3 x 5.000 + Kerupuk 1 x 2.750 = 17.750; tax 1.775; total 19.525; due 19.600
  const s1 = await sale('s1', {
    lines: [
      { productId: teh.id, qty: 3 },
      { productId: kerupuk.id, qty: 1 },
    ],
    paid: 20000,
  });
  check('A.S1.cash', 'cash sale with cash rounding', pick(s1, money), {
    subtotal: 17750,
    voucherDiscount: 0,
    tax: 1775,
    total: 19525,
    rounding: 75,
    amountDue: 19600,
    paid: 20000,
    change: 400,
    status: 'completed',
  });
  const s1again = await sale('s1', {
    lines: [
      { productId: teh.id, qty: 3 },
      { productId: kerupuk.id, qty: 1 },
    ],
    paid: 20000,
  });
  check('A.S1.idem', 'same Idempotency-Key answers the first sale', s1again.id, s1.id);

  // S2 unit + wholesale: 1 dus (54.000) + 10 pcs at the tier for 22 base units (4.500) = 99.000; tax 9.900
  const s2 = await sale('s2', {
    lines: [
      { productId: teh.id, qty: 1, unit: 'dus' },
      { productId: teh.id, qty: 10 },
    ],
    paid: 110000,
  });
  check('A.S2.unitTier', 'dus + wholesale tier sale', pick(s2, money), {
    subtotal: 99000,
    voucherDiscount: 0,
    tax: 9900,
    total: 108900,
    rounding: 0,
    amountDue: 108900,
    paid: 110000,
    change: 1100,
    status: 'completed',
  });
  check(
    'A.S2.lines',
    'line prices (dus 54.000, pcs at tier 4.500)',
    s2.lines.map((l) => [l.unit, l.qty, l.unitPrice, l.lineTotal]).sort(),
    [
      ['PCS', 10, 4500, 45000],
      ['dus', 1, 54000, 54000],
    ],
  );
  const s2Tampered = await api('POST', '/sales', {
    auth: budiT,
    key: key('s2t'),
    body: { lines: [{ productId: teh.id, qty: 1, price: 1 }], paid: 10000 },
  });
  // S2b: Teh 1 with a client price of Rp1 from a cashier without sales.price_override: 5.000 + 500 = 5.500
  check(
    'A.S2b.noPriceOverride',
    'a cashier-sent price is ignored (server price used)',
    [s2Tampered.data?.lines?.[0]?.unitPrice, s2Tampered.data?.total],
    [5000, 5500],
  );
  check(
    'A.cost.S1-S3',
    'cost stored per sale (owner read): S1, S2, S2b, S3',
    [await costOf(s1), await costOf(s2), await costOf(s2Tampered.data)],
    [11000, 66000, 3000],
  );

  // S3 voucher + debit: Beras 2 x 75.000 = 150.000; voucher 10% = 15.000; tax on 135.000 = 13.500; total 148.500
  const s3 = await sale('s3', {
    lines: [{ productId: beras.id, qty: 2 }],
    voucherCode: 'diskon10',
    paymentMethodId: debit.id,
    paid: 148500,
  });
  check('A.S3.voucher', 'voucher sale paid by debit, tax after discount', pick(s3, money), {
    subtotal: 150000,
    voucherDiscount: 15000,
    tax: 13500,
    total: 148500,
    rounding: 0,
    amountDue: 148500,
    paid: 148500,
    change: 0,
    status: 'completed',
  });

  check('A.cost.S3', 'cost stored on the voucher sale', await costOf(s3), 120000);

  // S4 kasbon: Beras 1 = 75.000 + tax 7.500 = 82.500; down payment 20.000; rest 62.500
  const noMember = await api('POST', '/sales', {
    auth: budiT,
    key: key('s4x'),
    body: { lines: [{ productId: beras.id, qty: 1 }], paymentMethodId: kasbon.id, paid: 0 },
  });
  check('A.S4.needsMember', 'kasbon without a member refused (422)', noMember.status, 422);
  const s4 = await sale('s4', {
    lines: [{ productId: beras.id, qty: 1 }],
    memberId: member.id,
    paymentMethodId: kasbon.id,
    paid: 20000,
  });
  check(
    'A.S4.kasbon',
    'kasbon sale with Rp20.000 down payment',
    pick(s4, ['total', 'paid', 'receivableRest', 'memberName', 'status']),
    {
      total: 82500,
      paid: 20000,
      receivableRest: 62500,
      memberName: 'Ibu Rina',
      status: 'completed',
    },
  );

  // S5 cash, voided: Gula 2 = 32.000 + 3.200 = 35.200
  const s5 = await sale('s5', { lines: [{ productId: gula.id, qty: 2 }], paid: 35200 });
  check('A.S5.cash', 'sale to be voided', pick(s5, ['total', 'amountDue', 'change']), {
    total: 35200,
    amountDue: 35200,
    change: 0,
  });
  check(
    'A.stock.afterSales',
    'on hand Teh/Beras/Gula/Kerupuk after S1-S5',
    [await onHand(teh), await onHand(beras), await onHand(gula), await onHand(kerupuk)],
    [48 - 3 - 22 - 1, 10 - 3, 20 - 2, 10 - 1],
  );
  const approvers = await ok('GET', '/void-pin/approvers', { auth: budiT });
  const approverList = rows(approvers);
  const ownerApprover = approverList.find((a) => a.kind === 'owner' || a.id === userA) ?? approverList[0];
  const badPin = await api('POST', `/sales/${s5.id}/void`, {
    auth: budiT,
    key: key('v5bad'),
    body: { reasonCode: 'customer_cancelled', approverId: ownerApprover.id, pin: '000000' },
  });
  check('A.void.badPin', 'void with a wrong admin PIN refused', badPin.status, (s) => s >= 400 && s < 500);
  const v5 = await api('POST', `/sales/${s5.id}/void`, {
    auth: budiT,
    key: key('v5'),
    body: { reasonCode: 'customer_cancelled', approverId: ownerApprover.id, pin: '111111' },
  });
  check('A.void.ok', 'void approved by the owner PIN', v5.status, (s) => s === 200 || s === 201);
  check('A.void.status', 'voided sale status', (await ok('GET', `/sales/${s5.id}`, { auth: budiT })).status, 'void');
  check('A.void.stockBack', 'Gula back to 20 after the void', await onHand(gula), 20);
  A.sales = { s1, s2, s3, s4, s5 };

  // S6 online (fake gateway), paid, then refunded
  if (PAY && PAY_KEY) await onlineSale(A, budiT, gula, ownerApprover.id);
  else results.push({ id: 'A.S6', what: 'online sale (fake gateway)', ok: true, skipped: 'PAYMENT_API_URL not set' });

  // --- receivable payment at the till (Budi): 30.000 → rest 32.500
  const recs = await ok('GET', `/receivables?memberId=${member.id}`, { auth: budiT });
  const rec = rows(recs)[0];
  A.receivable = rec;
  check('A.rec.open', 'kasbon receivable rest before payments', rec?.rest, 62500);
  const over = await api('POST', `/receivables/${rec.id}/payments`, {
    auth: budiT,
    key: key('r-over'),
    body: { amount: 70000 },
  });
  check('A.rec.overpay', 'payment above the balance refused', over.status, (s) => s >= 400 && s < 500);
  await ok('POST', `/receivables/${rec.id}/payments`, { auth: budiT, key: key('r1'), body: { amount: 30000 } });
  check(
    'A.rec.afterPay',
    'rest after Rp30.000',
    (await ok('GET', `/receivables/${rec.id}`, { auth: budiT })).rest,
    32500,
  );

  // --- collector (Sari, no shift) collects 12.500, Budi receives the deposit into his drawer
  const sariT = await pin(sari.id, '333333');
  await ok('POST', `/receivables/${rec.id}/payments`, { auth: sariT, key: key('r2'), body: { amount: 12500 } });
  const collectors = await ok('GET', '/store-cash/collectors', { auth: T() });
  const held = rows(collectors).find((c) => (c.collectorId ?? c.id) === sari.id);
  check('A.collector.held', 'Sari holds Rp12.500 (outstanding)', held?.outstanding, 12500);
  const selfDeposit = await api('POST', '/store-cash/deposits', {
    auth: sariT,
    key: key('d-self'),
    body: { collectorId: sari.id, amount: 12500 },
  });
  check(
    'A.collector.noSelf',
    'a collector cannot record her own deposit',
    selfDeposit.status,
    (s) => s >= 400 && s < 500,
  );
  const dep = await api('POST', '/store-cash/deposits', {
    auth: budiT,
    key: key('d1'),
    body: { collectorId: sari.id, amount: 12500 },
  });
  check('A.collector.deposit', 'Budi receives the deposit', dep.status, (s) => s === 200 || s === 201);
  const handed = rows(await ok('GET', '/store-cash/collectors', { auth: T() })).find((c) => c.collectorId === sari.id);
  check(
    'A.collector.handedOver',
    'after the deposit: outstanding 0, handed over 12.500',
    pick(handed, ['outstanding', 'handedOver']),
    { outstanding: 0, handedOver: 12500 },
  );
  check(
    'A.rec.afterCollector',
    'rest after the collector payment',
    (await ok('GET', `/receivables/${rec.id}`, { auth: budiT })).rest,
    20000,
  );

  // --- manual drawer cash and a drawer expense
  await ok('POST', '/shifts/current/cash-entries', {
    auth: budiT,
    key: key('c-in'),
    body: { direction: 'in', amount: 50000, reason: 'tambah_modal' },
  });
  await ok('POST', '/shifts/current/cash-entries', {
    auth: budiT,
    key: key('c-out'),
    body: { direction: 'out', amount: 100000, reason: 'setor_bank' },
  });
  const exp = await api('POST', '/expenses', {
    auth: budiT,
    key: key('e1'),
    body: { amount: 10000, category: 'listrik_air', source: 'drawer', note: 'Token listrik' },
  });
  check('A.expense.drawer', 'drawer expense Rp10.000 recorded', exp.status, (s) => s === 200 || s === 201);

  const cur = (await ok('GET', '/shifts/current', { auth: budiT })).shift;
  check(
    'A.shift.parts',
    'shift ledger parts before close',
    pick(cur, [
      'openingCash',
      'cashSales',
      'receivablePayments',
      'voidRefunds',
      'manualIn',
      'manualOut',
      'expenses',
      'collectorDeposits',
    ]),
    {
      // cash sales = S1 19.600 + S2 108.900 + S2b 5.500 + S5 35.200 + kasbon down payment 20.000
      openingCash: 200000,
      cashSales: 189200,
      receivablePayments: 30000,
      voidRefunds: 35200,
      manualIn: 50000,
      manualOut: 100000,
      expenses: 10000,
      collectorDeposits: 12500,
    },
  );
  // 200.000 + S1 19.600 + S2 108.900 + S2b 5.500 + S5 35.200 − void 35.200 + DP 20.000 + kasbon 30.000
  // + deposit 12.500 + in 50.000 − out 100.000 − expense 10.000 = 336.500
  check('A.shift.expected', 'expected cash in the drawer', cur.expectedCash, 336500);

  // --- stock opname (owner): Kerupuk counted 8, system 9
  A.owner = o = await owner(userA);
  const op = await ok('POST', '/stock-opnames', {
    auth: T(),
    body: { note: 'QA', lines: [{ productId: kerupuk.id, countedQty: 8, reason: 'Rusak 1' }] },
  });
  A.opname = op;
  const opRead = await ok('GET', `/stock-opnames/${op.id}`, { auth: T() });
  const line = (opRead.lines ?? [])[0] ?? {};
  check(
    'A.opname.diff',
    'opname line: system 9, counted 8, difference -1',
    [line.systemQty ?? line.expectedQty, line.countedQty, line.difference ?? line.diff],
    [9, 8, -1],
  );
  await ok('POST', `/stock-opnames/${op.id}/approve`, { auth: T(), body: {} });
  check('A.opname.applied', 'Kerupuk on hand after approve', await onHand(kerupuk), 8);

  // --- close the shift: counted 336.000 → difference −500
  const pendingClose = await ok('POST', '/shifts/current/close', { auth: budiT, body: { countedCash: 336000 } });
  check(
    'A.shift.close',
    'close: expected, counted, difference',
    pick(pendingClose, ['expectedCash', 'countedCash', 'difference']),
    { expectedCash: 336500, countedCash: 336000, difference: -500 },
  );

  // --- reports and CSV (owner)
  const q = `from=${day}&to=${day}`;
  const sales = await ok('GET', `/reports/sales?${q}`, { auth: T() });
  check(
    'A.report.sales',
    'sales report totals',
    pick(sales.totals, [
      'salesCount',
      'grossSales',
      'voucher',
      'tax',
      'revenue',
      'cost',
      'grossProfit',
      'rounding',
      'voidCount',
    ]),
    {
      salesCount: 5,
      grossSales: 346750,
      voucher: 15000,
      tax: 33175,
      revenue: 364925,
      cost: 260000,
      grossProfit: 71750,
      rounding: 75,
      voidCount: PAY && PAY_KEY ? 2 : 1,
    },
  );
  const products = await ok('GET', `/reports/products?${q}`, { auth: T() });
  const byName = Object.fromEntries((products.rows ?? []).map((r) => [r.name, r.qty]).sort());
  check('A.report.products', 'products report qty (base units)', byName, {
    'Beras 5kg': 3,
    Kerupuk: 1,
    'Teh Botol': 26,
  });
  const dash = await ok('GET', '/reports/dashboard?period=today', { auth: T() });
  check(
    'A.report.dashboard',
    'dashboard today = sales report',
    pick(dash.current, ['salesCount', 'revenue', 'grossProfit']),
    { salesCount: 5, revenue: 364925, grossProfit: 71750 },
  );
  const shifts = await ok('GET', `/reports/shifts?${q}`, { auth: T() });
  check(
    'A.report.shifts',
    'shifts report: one shift, Budi, difference −500',
    (shifts.rows ?? []).map((r) => [r.cashier ?? r.actorName, r.difference]),
    [['Budi', -500]],
  );
  const purch = await ok('GET', `/reports/purchasing?${q}`, { auth: T() });
  check('A.report.purchasing', 'purchasing report total', purch.totals?.total ?? purch.total, 1024000);
  const pl = await ok('GET', `/reports/profit-loss?${q}`, { auth: T() });
  A.reports = { sales, products, dash, shifts, purch, pl };
  check(
    'A.report.pl',
    'profit and loss: revenue ex tax, COGS, gross, Susut stok, expenses, net, tax, rounding',
    pick(pl.current, ['revenue', 'cost', 'grossProfit', 'shrinkage', 'expenses', 'netProfit', 'tax', 'rounding']),
    {
      revenue: 331750,
      cost: 260000,
      grossProfit: 71750,
      // UMK-2072 Susut stok: the approved opname took Kerupuk 1 short, 1 x cost 2.000.
      shrinkage: 2000,
      expenses: 10000,
      // gross 71.750 - Susut stok 2.000 - expenses 10.000
      netProfit: 59750,
      tax: 33175,
      rounding: 75,
    },
  );
  const csvs = {};
  for (const path of [
    '/reports/sales/csv',
    '/reports/products/csv',
    '/reports/shifts/csv',
    '/reports/purchasing/csv',
    '/reports/profit-loss/csv',
    '/expenses/csv',
  ]) {
    const r = await api('GET', `${path}?${q}`, { auth: T(), raw: true });
    const rows = String(r.data).trim().split(/\r?\n/).length;
    csvs[path] = { status: r.status, type: r.type.split(';')[0], rows };
    check(
      `A.csv${path.replace(/\//g, '.')}`,
      `${path} answers CSV`,
      { status: r.status, csv: r.type.includes('csv') },
      { status: 200, csv: true },
    );
    csvs[path].text = String(r.data);
  }
  // The CSV says what the screen says: the summary lines carry the JSON report's numbers.
  const summary = (path, label) =>
    csvs[path].text
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${label},`))
      ?.split(',')
      .filter(Boolean)
      .at(-1);
  check(
    'A.csv.salesTotals',
    'sales CSV Pendapatan / Laba kotor / Pembulatan',
    [
      summary('/reports/sales/csv', 'Pendapatan'),
      summary('/reports/sales/csv', 'Laba kotor'),
      summary('/reports/sales/csv', 'Pembulatan'),
    ],
    ['364925', '71750', '75'],
  );
  check(
    'A.csv.productsTeh',
    'products CSV Teh Botol row',
    csvs['/reports/products/csv'].text.split(/\r?\n/).find((l) => l.includes('Teh Botol')),
    'SEM-TEH-0001,Teh Botol,26,119000,78000,41000',
  );
  check(
    'A.csv.shift',
    'shifts CSV: expected, counted, difference',
    csvs['/reports/shifts/csv'].text.split(/\r?\n/)[1]?.split(',').slice(-3),
    ['336500', '336000', '-500'],
  );
  check(
    'A.csv.purchasing',
    'purchasing CSV total',
    csvs['/reports/purchasing/csv'].text
      .split(/\r?\n/)
      .find((l) => l.startsWith('Total'))
      ?.split(',')
      .at(-1),
    '1024000',
  );
  check(
    'A.csv.pl',
    'profit-loss CSV net profit',
    csvs['/reports/profit-loss/csv'].text
      .split(/\r?\n/)
      .find((l) => l.startsWith('Untung bersih'))
      ?.split(',')[1],
    '59750',
  );
  for (const c of Object.values(csvs)) delete c.text;
  A.csvs = csvs;
  return A;
}

async function onlineSale(A, budiT, gula, approverId) {
  const T = A.owner.token;
  const tenant = A.owner.tenantId;
  const draft = await api('PUT', '/online-payments/fake/draft', {
    auth: T,
    body: { businessType: 'individual', businessName: 'Toko QA A', email: 'qa@example.test', phone: '+6281234567890' },
  });
  check('A.S6.draft', 'fake gateway draft saved', draft.status, 200);
  await ok('POST', '/online-payments/fake/submit', { auth: T, body: { termsAccepted: true } });
  check('A.S6.approve', 'fake gateway approves the account', (await gateway(tenant, '/account/approve')).status, 200);
  await ok('POST', '/online-payments/fake/sync', { auth: T, body: {} }).catch(() => null);
  await ok('PUT', '/online-payments/fake/methods/fake_qris', { auth: T, body: { enabled: true } });
  const acct = (await ok('GET', '/online-payments', { auth: T })).accounts[0];
  check('A.S6.active', 'merchant account active', acct.status, 'active');
  const qris = await ok('POST', '/payment-methods', {
    auth: T,
    body: { name: 'QRIS Online', kind: 'online', gatewayMethod: 'fake_qris' },
  });
  // Gula 1 = 16.000 + 1.600 = 17.600, awaiting payment
  const s6 = await ok('POST', '/sales', {
    auth: budiT,
    key: key('s6'),
    body: { lines: [{ productId: gula.id, qty: 1 }], paymentMethodId: qris.id, paid: 17600 },
  });
  check('A.S6.awaiting', 'online sale waits for its payment', pick(s6, ['status', 'total']), {
    status: 'awaiting_payment',
    total: 17600,
  });
  const bills = await gateway(tenant, '/payments', null);
  const bill = rows(bills.data).find((b) => b.amount === 17600 && b.orderRef === s6.id);
  const ref = bill?.providerRef;
  check('A.S6.bill', 'fake gateway holds a bill of Rp17.600', !!ref, true);
  await gateway(tenant, `/payments/${ref}/pay`, {});
  const checked = await ok('POST', `/sales/${s6.id}/payment/check`, { auth: budiT, body: {} });
  const after = await ok('GET', `/sales/${s6.id}`, { auth: budiT });
  check('A.S6.paid', 'online sale completed after the gateway paid', after.status, 'completed');
  const voidTry = await api('POST', `/sales/${s6.id}/void`, {
    auth: budiT,
    key: key('v6'),
    body: { reasonCode: 'customer_cancelled', approverId, pin: '111111' },
  });
  check(
    'A.S6.noVoid',
    'a paid online sale cannot be voided (409 use_refund)',
    [voidTry.status, voidTry.data?.code],
    [409, 'use_refund'],
  );
  const refund = await api('POST', `/sales/${s6.id}/refund`, {
    auth: budiT,
    key: key('rf6'),
    body: { reasonCode: 'goods_returned', approverId, pin: '111111' },
  });
  check('A.S6.refund', 'refund accepted', refund.status, (s) => s === 200 || s === 201);
  let state = await ok('GET', `/sales/${s6.id}/void`, { auth: budiT });
  if (state.refundStatus === 'pending' || state.void?.refundStatus === 'pending') {
    const rid = state.refundId ?? state.void?.refundId;
    if (rid) await gateway(tenant, `/refunds/${rid}/succeed`, {});
    await ok('POST', `/sales/${s6.id}/payment/check`, { auth: budiT, body: {} }).catch(() => null);
    state = await ok('GET', `/sales/${s6.id}/void`, { auth: budiT });
  }
  A.online = { s6, checked, refund: refund.data, state };
  check(
    'A.S6.reversed',
    'refunded sale is reversed (void)',
    (await ok('GET', `/sales/${s6.id}`, { auth: budiT })).status,
    'void',
  );
}

// ---------------------------------------------------------------- store B: isolation

async function storeB(userB, A) {
  const B = await owner(userB);
  const T = B.token;
  const cat = await ok('POST', '/catalog/categories', { auth: T, body: { name: 'Toko B' } });
  const pb = await ok('POST', '/catalog/products', {
    auth: T,
    body: { categoryId: cat.id, name: 'Produk B', sellingPrice: 1000, type: 'non_stock' },
  });
  await ok('POST', '/shifts/open', { auth: T, body: { openingCash: 0 } });
  const sb = await ok('POST', '/sales', {
    auth: T,
    key: key('b1'),
    body: { lines: [{ productId: pb.id, qty: 2 }], paid: 2000 },
  });
  check('B.sale', 'store B own sale', sb.total, 2000);

  const ids = {
    'catalog/products': A.products.teh.id,
    'catalog/categories': A.category.id,
    suppliers: A.supplier.id,
    members: A.member.id,
    vouchers: A.voucher.id,
    'payment-methods': A.methods.debit.id,
    'purchasing/orders': A.purchase.id,
    'stock-opnames': A.opname.id,
    staff: A.staff.budi.id,
  };
  for (const [res, id] of Object.entries(ids)) {
    const read = res === 'catalog/categories' ? null : await api('GET', `/${res}/${id}`, { auth: T });
    const upd = await api('PATCH', `/${res}/${id}`, {
      auth: T,
      body: ['purchasing/orders', 'stock-opnames'].includes(res) ? { note: 'X' } : { name: 'X' },
    });
    const del = await api('DELETE', `/${res}/${id}`, { auth: T });
    check(
      `B.x.${res}`,
      `store B on store A's ${res} id: read/update/delete`,
      [read?.status ?? 404, upd.status, del.status],
      [404, 404, 404],
    );
  }
  for (const [what, path] of [
    ['sale', `/sales/${A.sales.s1.id}`],
    ['receipt', `/sales/${A.sales.s1.id}/receipt`],
    ['receivable', `/receivables/${A.receivable.id}`],
    ['shift', `/shifts/${A.shift.id}`],
    ['stock', `/stock/products/${A.products.teh.id}`],
    ['movements', `/stock/products/${A.products.teh.id}/movements`],
    ['void', `/sales/${A.sales.s5.id}/void`],
  ])
    check(`B.x.${what}`, `store B reads store A's ${what}`, (await api('GET', path, { auth: T })).status, 404);
  const voidA = await api('POST', `/sales/${A.sales.s1.id}/void`, {
    auth: T,
    key: key('bv'),
    body: { reasonCode: 'customer_cancelled', approverId: B.userId, pin: '111111' },
  });
  check('B.x.voidA', "store B voids store A's sale", voidA.status, (s) => s === 404 || s === 422);
  const payA = await api('POST', `/receivables/${A.receivable.id}/payments`, {
    auth: T,
    key: key('bp'),
    body: { amount: 1000 },
  });
  check('B.x.payA', "store B pays store A's kasbon", payA.status, 404);
  const sellA = await api('POST', '/sales', {
    auth: T,
    key: key('bs'),
    body: { lines: [{ productId: A.products.teh.id, qty: 1 }], paid: 10000 },
  });
  check('B.x.sellA', "store B sells store A's product", sellA.status, (s) => s === 404 || s === 422);
  const vB = await api('POST', '/vouchers/check', { auth: T, body: { code: 'DISKON10', amount: 100000 } });
  check('B.x.voucherA', "store A's voucher code in store B", vB.status, (s) => s === 404 || s === 422);

  const day = today();
  const lists = {
    '/catalog/products': (d) => d.total === 1 && d.data.every((p) => p.name === 'Produk B'),
    '/catalog/categories': (d) => rows(d).length === 1,
    '/sales': (d) => d.total === 1,
    '/suppliers': (d) => rows(d).length === 0,
    '/members': (d) => rows(d).length === 0,
    '/vouchers': (d) => rows(d).length === 0,
    '/receivables': (d) => rows(d).length === 0,
    '/purchasing/orders': (d) => rows(d).length === 0,
    '/stock-opnames': (d) => rows(d).length === 0,
    '/staff': (d) => rows(d).length === 0,
    '/shifts': (d) => d.total === 1,
    '/store-cash/collectors': (d) => rows(d).length === 0,
    '/store-cash/deposits': (d) => rows(d).length === 0,
    '/payment-methods': (d) => d.data.length === 1 && d.data[0].name === 'Tunai',
    '/expenses': (d) => rows(d).length === 0,
  };
  for (const [path, fine] of Object.entries(lists)) {
    const r = await api('GET', path, { auth: T });
    check(
      `B.list${path.replace(/\//g, '.')}`,
      `store B list ${path} shows only B`,
      r.status === 200 && fine(r.data) ? 'only B' : JSON.stringify(r.data).slice(0, 200),
      'only B',
    );
  }
  const rep = await ok('GET', `/reports/sales?from=${day}&to=${day}`, { auth: T });
  check('B.report.sales', 'store B sales report = its one sale', pick(rep.totals, ['salesCount', 'revenue']), {
    salesCount: 1,
    revenue: 2000,
  });
  const purch = await ok('GET', `/reports/purchasing?from=${day}&to=${day}`, { auth: T });
  check('B.report.purchasing', 'store B purchasing report empty', (purch.rows ?? []).length, 0);
  const csv = await api('GET', `/reports/sales/csv?from=${day}&to=${day}`, { auth: T, raw: true });
  check(
    'B.csv.sales',
    'store B sales CSV has none of store A',
    ['Teh Botol', 'Beras', 'Budi'].some((w) => String(csv.data).includes(w)),
    false,
  );
  const tenantQuery = await api('GET', `/catalog/products?tenantId=${A.owner.tenantId}`, { auth: T });
  check(
    'B.x.tenantParam',
    'a tenantId query parameter is ignored',
    tenantQuery.data?.total,
    (t) => t === 1 || tenantQuery.status === 422,
  );
  const budiOnB = await api('GET', '/catalog/products', { auth: A.budiToken });
  check(
    'B.x.cashierA',
    "store A's cashier sees store A's catalog only",
    budiOnB.data?.data?.some((p) => p.name === 'Produk B'),
    false,
  );
  return B;
}

// ---------------------------------------------------------------- store C: the agent over MCP

async function mcpClient(token) {
  const client = new Client({ name: 'umkmall-qa', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${POS}/mcp`), {
      requestInit: {
        headers: { Authorization: `Bearer ${token}`, 'X-Umkmall-Run': `qa-${RUN}`, 'X-Umkmall-Mode': 'agentic' },
      },
    }),
  );
  return client;
}
async function tool(client, name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  if (r.isError) return { error: text };
  return { data: JSON.parse(text) };
}
/** A write: preview, then confirm with the same key. */
async function write(client, name, args, k) {
  const preview = await tool(client, name, { ...args, idempotencyKey: k });
  const done = await tool(client, name, { ...args, idempotencyKey: k, confirm: true });
  return { preview, done };
}

async function storeC(userC, B) {
  const C = await owner(userC);
  const session = await ok('POST', '/auth/dev/agent-session', {
    body: { userId: userC, scopes: ['pos.read', 'pos.write'], consentRef: `qa-${RUN}` },
  });
  check('C.agent.session', 'agent session for the same store', session.tenant.id, C.tenantId);
  const agent = await mcpClient(session.sessionToken);
  const list = await agent.listTools();
  const documented = [
    ...readFileSync(new URL('../../docs/agent-integration.md', import.meta.url), 'utf8').matchAll(
      /^### `([a-z_]+)`$/gm,
    ),
  ].map((m) => m[1]);
  check(
    'C.mcp.tools',
    'tools/list = the tools of docs/agent-integration.md, in order',
    list.tools.map((t) => t.name),
    documented,
  );
  const ownerAsAgent = await fetch(`${POS}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${C.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: '{}',
  });
  check('C.mcp.ownerToken', 'an owner token on /mcp refused (403)', ownerAsAgent.status, 403);

  const ctx = await tool(agent, 'business_context');
  check('C.mcp.context', 'business_context of an empty store', ctx.data?.productCount, 0);
  const cat = await write(agent, 'create_category', { name: 'Kopi & Roti' }, `qa-${RUN}-cat`);
  check('C.mcp.catPreview', 'create_category without confirm is a preview', cat.preview.data?.preview, true);
  const catId = cat.done.data?.category?.id ?? cat.done.data?.id;
  check(
    'C.mcp.catDone',
    'create_category confirmed, with provenance',
    [!!catId, cat.done.data?.provenance?.by],
    [true, 'agent'],
  );
  const kopi = await write(
    agent,
    'create_product',
    { name: 'Kopi Susu', categoryId: catId, sellingPrice: 12000, costPrice: 7000, unit: 'cup' },
    `qa-${RUN}-kopi`,
  );
  const roti = await write(
    agent,
    'create_product',
    { name: 'Roti Bakar', categoryId: catId, sellingPrice: 8500, costPrice: 5000 },
    `qa-${RUN}-roti`,
  );
  const kopiId = kopi.done.data?.product?.id ?? kopi.done.data?.id;
  const rotiId = roti.done.data?.product?.id ?? roti.done.data?.id;
  check('C.mcp.products', 'two products created by the agent', [!!kopiId, !!rotiId], [true, true]);
  const replay = await tool(agent, 'create_product', {
    name: 'Kopi Susu',
    categoryId: catId,
    sellingPrice: 12000,
    costPrice: 7000,
    unit: 'cup',
    idempotencyKey: `qa-${RUN}-kopi`,
    confirm: true,
  });
  check(
    'C.mcp.productReplay',
    'same key and input answers the first product',
    replay.data?.product?.id ?? replay.data?.id,
    kopiId,
  );

  // Stock in: no MCP tool exists (docs/agent-integration.md section 6), so the owner receives a purchase in REST.
  const sup = await ok('POST', '/suppliers', { auth: C.token, body: { name: 'Pemasok C' } });
  const po = await ok('POST', '/purchasing/orders', {
    auth: C.token,
    body: {
      supplierId: sup.id,
      lines: [
        { productId: kopiId, qty: 20, unitCost: 7000 },
        { productId: rotiId, qty: 10, unitCost: 5000 },
      ],
    },
  });
  await ok('POST', `/purchasing/orders/${po.id}/approve`, { auth: C.token, body: {} });
  const stock = await tool(agent, 'get_product_stock', { productId: kopiId });
  check('C.mcp.stock', 'get_product_stock after the purchase (Kopi)', stock.data?.onHand, 20);

  const noShift = await write(agent, 'record_sale', { lines: [{ productId: kopiId, qty: 1 }] }, `qa-${RUN}-sale0`);
  check('C.mcp.saleNoShift', 'record_sale with no open shift refused', !!noShift.done.error, true);
  const shift = await write(agent, 'open_shift', { openingCash: 100000 }, `qa-${RUN}-shift`);
  check(
    'C.mcp.openShift',
    'open_shift confirmed',
    shift.done.data?.shift?.openingCash ?? shift.done.data?.openingCash,
    100000,
  );
  // Kopi 2 x 12.000 + Roti 3 x 8.500 = 49.500 (tax 0, no rounding)
  const s1 = await write(
    agent,
    'record_sale',
    {
      lines: [
        { productId: kopiId, qty: 2 },
        { productId: rotiId, qty: 3 },
      ],
    },
    `qa-${RUN}-sale1`,
  );
  check(
    'C.mcp.salePreview',
    'record_sale preview quote total and wouldPay',
    [s1.preview.data?.preview, s1.preview.data?.quote?.total ?? s1.preview.data?.total, s1.preview.data?.wouldPay],
    [true, 49500, 49500],
  );
  const sale1 = s1.done.data?.sale ?? s1.done.data;
  check(
    'C.mcp.sale1',
    'record_sale confirmed: total, paid, cost',
    pick(sale1, ['total', 'paid', 'change', 'costTotal', 'status']),
    { total: 49500, paid: 49500, change: 0, costTotal: 29000, status: 'completed' },
  );
  const again = await tool(agent, 'record_sale', {
    lines: [
      { productId: kopiId, qty: 2 },
      { productId: rotiId, qty: 3 },
    ],
    idempotencyKey: `qa-${RUN}-sale1`,
    confirm: true,
  });
  check('C.mcp.saleReplay', 'record_sale replay answers the same sale', (again.data?.sale ?? again.data)?.id, sale1.id);
  // A preview only (it writes nothing whatever the answer): does the tool refuse a line price, as POST /sales does?
  const priced = await tool(agent, 'record_sale', {
    lines: [{ productId: kopiId, qty: 1, price: 1 }],
    idempotencyKey: `qa-${RUN}-sale-p`,
  });
  check(
    'C.mcp.noPrice',
    'record_sale refuses a line price sent by the agent',
    priced.error ?? `accepted: preview total ${priced.data?.quote?.total ?? priced.data?.total}`,
    (v) => !String(v).startsWith('accepted'),
  );
  // Roti 1 = 8.500
  const s2 = await write(agent, 'record_sale', { lines: [{ productId: rotiId, qty: 1 }] }, `qa-${RUN}-sale2`);
  const sale2 = s2.done.data?.sale ?? s2.done.data;
  check('C.mcp.sale2', 'second sale total', sale2?.total, 8500);

  const day = today();
  const mSales = (await tool(agent, 'sales_report', { from: day, to: day })).data;
  const mProducts = (await tool(agent, 'product_report', { from: day, to: day })).data;
  const mSummary = (await tool(agent, 'store_summary', { period: 'today' })).data;
  const mPl = (await tool(agent, 'profit_loss', { from: day, to: day })).data;
  const mShift = (await tool(agent, 'current_shift')).data;
  const mLedger = (await tool(agent, 'ledger_entries', { from: day, to: day })).data;
  const mActivity = (await tool(agent, 'agent_activity', { days: 1 })).data;
  check(
    'C.mcp.salesReport',
    'MCP sales_report totals',
    pick(mSales?.totals, ['salesCount', 'revenue', 'cost', 'grossProfit']),
    { salesCount: 2, revenue: 58000, cost: 34000, grossProfit: 24000 },
  );
  check(
    'C.mcp.noCashier',
    'MCP sales_report lines carry no cashier name',
    (mSales?.rows ?? []).some((r) => 'cashier' in r),
    false,
  );
  check(
    'C.mcp.productReport',
    'MCP product_report qty',
    Object.fromEntries((mProducts?.rows ?? []).map((r) => [r.name, r.qty]).sort()),
    { 'Kopi Susu': 2, 'Roti Bakar': 4 },
  );
  check('C.mcp.summary', 'MCP store_summary today', pick(mSummary?.current, ['salesCount', 'revenue', 'grossProfit']), {
    salesCount: 2,
    revenue: 58000,
    grossProfit: 24000,
  });
  check('C.mcp.shift', 'MCP current_shift expected cash', mShift?.shift?.expectedCash, 158000);
  check(
    'C.mcp.ledger',
    'MCP ledger_entries: two sales in, Rp58.000',
    [mLedger?.entries?.filter((e) => e.kind === 'sale').length, mLedger?.totals?.in],
    [2, 58000],
  );
  check('C.mcp.activity', 'agent_activity recorded the confirmed writes', rows(mActivity).length, (n) => n >= 6);

  // The same numbers through the owner's REST reports (what pos-web shows on /laporan and the dashboard).
  const q = `from=${day}&to=${day}`;
  const rSales = await ok('GET', `/reports/sales?${q}`, { auth: C.token });
  const rProducts = await ok('GET', `/reports/products?${q}`, { auth: C.token });
  const rDash = await ok('GET', '/reports/dashboard?period=today', { auth: C.token });
  const rPl = await ok('GET', `/reports/profit-loss?${q}`, { auth: C.token });
  const rShift = (await ok('GET', '/shifts/current', { auth: C.token })).shift;
  check('C.rest.sales', 'REST sales report totals = MCP', same(rSales.totals, mSales?.totals), true);
  check('C.rest.products', 'REST products report rows = MCP', same(rProducts.rows, mProducts?.rows), true);
  check('C.rest.dashboard', 'REST dashboard = MCP store_summary', same(rDash.current, mSummary?.current), true);
  check('C.rest.pl', 'REST profit and loss = MCP profit_loss', same(rPl, mPl), true);
  check('C.rest.shift', 'REST current shift expected cash = MCP', rShift?.expectedCash, mShift?.shift?.expectedCash);
  const receipt = await ok('GET', `/sales/${sale1.id}`, { auth: C.token });
  check(
    'C.rest.receipt',
    'the agent sale is in the owner sales list, seller Agent UMKMall',
    [receipt.total, receipt.actorKind],
    [49500, 'agent'],
  );

  // Store B's agent cannot reach store C.
  const bAgent = await ok('POST', '/auth/dev/agent-session', {
    body: { userId: B.userId, scopes: ['pos.read', 'pos.write'] },
  });
  const bClient = await mcpClient(bAgent.sessionToken);
  const cross = await tool(bClient, 'get_product', { productId: kopiId });
  check('C.mcp.crossTenant', "store B's agent reads store C's product", !!cross.error, true);
  const crossSale = await tool(bClient, 'record_sale', {
    lines: [{ productId: kopiId, qty: 1 }],
    idempotencyKey: `qa-${RUN}-bx`,
    confirm: true,
  });
  check('C.mcp.crossSale', "store B's agent sells store C's product", !!crossSale.error, true);
  await bClient.close();
  await agent.close();
  return { C, mcp: { mSales, mProducts, mSummary, mPl, mShift, mLedger }, rest: { rSales, rProducts, rDash, rPl } };
}

// ---------------------------------------------------------------- main

const health = await api('GET', '/health');
if (health.status !== 200) throw new Error(`pos-api at ${POS} does not answer /health`);
const [userA, userB, userC] = await stubUsers(3);
let failed = null;
const out = {};
try {
  out.A = await storeA(userA);
  out.B = await storeB(userB, out.A);
  out.C = await storeC(userC, out.B);
} catch (error) {
  failed = String(error?.stack ?? error);
  process.stdout.write(`ABORT ${failed}\n`);
}
const passed = results.filter((r) => r.ok).length;
process.stdout.write(`\n${passed}/${results.length} checks passed${failed ? ' (run aborted)' : ''}\n`);
if (process.env.QA_OUT) {
  mkdirSync(dirname(process.env.QA_OUT), { recursive: true });
  const evidence = {
    run: RUN,
    at: new Date().toISOString(),
    posApi: POS,
    paymentApi: PAY ? 'on (fake gateway)' : 'off',
    aborted: failed,
    checks: results,
    reports: {
      A: out.A && {
        sales: out.A.reports?.sales?.totals,
        products: out.A.reports?.products?.rows,
        dashboard: out.A.reports?.dash?.current,
        pl: out.A.reports?.pl,
        csv: out.A.csvs,
      },
      C: out.C && {
        mcp: { sales: out.C.mcp.mSales?.totals, products: out.C.mcp.mProducts?.rows, pl: out.C.mcp.mPl },
        rest: { sales: out.C.rest.rSales?.totals },
      },
    },
  };
  writeFileSync(process.env.QA_OUT, `${JSON.stringify(evidence, null, 2)}\n`);
}
process.exit(failed || passed !== results.length ? 1 : 0);
