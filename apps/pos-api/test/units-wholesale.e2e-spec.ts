import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import request from 'supertest';
import { ADMIN_DATABASE_URL } from './support/env';
import { createApp, createStore } from './support/fixtures';
import { createCashier } from './support/staff';

type Store = Awaited<ReturnType<typeof createStore>>;
type Line = {
  productId: string;
  qty: number;
  unit: string;
  unitQty: number;
  baseQty: number;
  normalUnitPrice: number;
  listPrice: number;
  unitPrice: number;
  lineTotal: number;
  costTotal?: number;
  appliedTier: { minQty: number; price: number } | null;
  savings: number;
  priceOverriddenBy: string | null;
};

// UMK-1985. The design's product: Teh Botol, Rp3.500 per pcs (cost Rp2.000), a dus of 24 at Rp78.000,
// wholesale 12+ pcs → Rp3.300, 48+ pcs → Rp3.200.
const UNITS = [{ name: 'dus', unitQty: 24, price: 78_000 }];
const TIERS = [
  { minQty: 12, price: 3300 },
  { minQty: 48, price: 3200 },
];

describe('units and wholesale pricing (UMK-1985)', () => {
  let app: INestApplication;
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await admin.end();
  });

  const post = (store: { auth: string }, url: string, body: object) =>
    http().post(url).set('Authorization', store.auth).send(body);
  const patch = (store: { auth: string }, url: string, body: object) =>
    http().patch(url).set('Authorization', store.auth).send(body);
  const get = (store: { auth: string }, url: string) =>
    http().get(url).set('Authorization', store.auth);

  async function category(store: Store) {
    const cat = await post(store, '/catalog/categories', {
      name: 'Minuman',
    }).expect(201);
    return cat.body.id as string;
  }

  /** A store with Teh Botol (units and tiers above), `stock` pcs in stock and the owner's shift open. */
  async function tehStore(stock = 200, extra: object = {}) {
    const store = await createStore();
    const categoryId = await category(store);
    const p = await post(store, '/catalog/products', {
      categoryId,
      name: 'Teh Botol 350ml',
      unit: 'pcs',
      costPrice: 2000,
      sellingPrice: 3500,
      units: UNITS,
      priceTiers: TIERS,
      ...extra,
    }).expect(201);
    const productId = p.body.id as string;
    if (stock > 0)
      await post(store, '/stock/opening', { productId, qty: stock }).expect(
        201,
      );
    await post(store, '/shifts/open', { openingCash: 100_000 }).expect(201);
    return { store, productId, categoryId, product: p.body };
  }

  const sell = (auth: string, body: object, key: string = randomUUID()) =>
    http()
      .post('/sales')
      .set('Authorization', auth)
      .set('Idempotency-Key', key)
      .send(body);

  const onHand = async (store: Store, productId: string) =>
    (await get(store, `/stock/products/${productId}`).expect(200)).body
      .onHand as number;

  const linesOf = (body: { lines: Line[] }) => body.lines;

  describe('product units and tiers', () => {
    it('saves a dus and two tiers, reads them back on get and list; the design example does not warn', async () => {
      const { store, productId, product } = await tehStore(0);
      expect(product.units).toEqual([
        { id: expect.any(String), name: 'dus', unitQty: 24, price: 78_000 },
      ]);
      expect(product.priceTiers).toEqual(TIERS);
      // One dus is 24 pcs, which reach the 12+ tier: 24 × 3.300 = 79.200 ≥ 78.000, so no warning. The
      // 48+ tier (76.800) is not the measure (owner ruling 2026-11-25).
      expect(product.warnings).toEqual([]);
      const one = await get(store, `/catalog/products/${productId}`).expect(
        200,
      );
      expect(one.body.units).toEqual(product.units);
      expect(one.body.priceTiers).toEqual(TIERS);
      expect(one.body.warnings).toBeUndefined();
      const list = await get(store, '/catalog/products').expect(200);
      expect(list.body.data[0]).toMatchObject({
        id: productId,
        units: product.units,
        priceTiers: TIERS,
      });
    });

    it('warns only when the unit is above pack × the price of the tier the pack reaches; a product without units answers empty lists', async () => {
      const store = await createStore();
      const categoryId = await category(store);
      const fair = await post(store, '/catalog/products', {
        categoryId,
        name: 'Teh Botol',
        unit: 'pcs',
        sellingPrice: 3500,
        units: [{ name: 'dus', unitQty: 24, price: 79_200 }],
        priceTiers: TIERS,
      }).expect(201);
      expect(fair.body.warnings).toEqual([]);
      const plain = await post(store, '/catalog/products', {
        categoryId,
        name: 'Indomie',
        sellingPrice: 3000,
      }).expect(201);
      expect(plain.body).toMatchObject({
        units: [],
        priceTiers: [],
        warnings: [],
      });
      // An update that makes the unit dearer than its content warns too.
      const dearer = await patch(store, `/catalog/products/${fair.body.id}`, {
        units: [{ name: 'dus', unitQty: 24, price: 79_201 }],
      }).expect(200);
      expect(dearer.body.warnings).toEqual([
        {
          code: 'unit_price_above_wholesale',
          field: 'units.0.price',
          message:
            'Harga 1 dus (Rp79.201) lebih mahal dari 24 pcs dengan harga grosir (Rp79.200)',
        },
      ]);
    });

    it('update replaces units and tiers; lists left out stay; an empty list removes them', async () => {
      const { store, productId } = await tehStore(0);
      const renamed = await patch(store, `/catalog/products/${productId}`, {
        name: 'Teh Botol',
      }).expect(200);
      expect(renamed.body.units).toHaveLength(1);
      expect(renamed.body.priceTiers).toEqual(TIERS);
      const changed = await patch(store, `/catalog/products/${productId}`, {
        units: [
          { name: 'Karton', unitQty: 48, price: 150_000 },
          { name: 'Pak', unitQty: 6, price: 20_000 },
        ],
        priceTiers: [{ minQty: 10, price: 3400 }],
      }).expect(200);
      // Smallest pack first.
      expect(
        (changed.body.units as { name: string }[]).map((u) => u.name),
      ).toEqual(['Pak', 'Karton']);
      expect(changed.body.priceTiers).toEqual([{ minQty: 10, price: 3400 }]);
      const cleared = await patch(store, `/catalog/products/${productId}`, {
        units: [],
        priceTiers: [],
      }).expect(200);
      expect(cleared.body).toMatchObject({
        units: [],
        priceTiers: [],
        warnings: [],
      });
    });

    it('422 with the field for every bad unit or tier, on create', async () => {
      const store = await createStore();
      const categoryId = await category(store);
      const base = {
        categoryId,
        name: 'Teh Botol',
        unit: 'pcs',
        sellingPrice: 3500,
      };
      const refused = async (extra: object, field: string) => {
        const res = await post(store, '/catalog/products', {
          ...base,
          ...extra,
        }).expect(422);
        expect(Object.keys(res.body.errors)).toContain(field);
        expect(typeof res.body.message).toBe('string');
      };
      const unit = (u: object) => ({
        units: [{ name: 'dus', unitQty: 24, price: 78_000, ...u }],
      });
      await refused(unit({ unitQty: 0 }), 'units.0.unitQty');
      await refused(unit({ unitQty: 1 }), 'units.0.unitQty');
      await refused(unit({ unitQty: -24 }), 'units.0.unitQty');
      await refused(unit({ unitQty: 2.5 }), 'units.0.unitQty');
      await refused(unit({ unitQty: '24' }), 'units.0.unitQty');
      await refused(unit({ unitQty: 10_001 }), 'units.0.unitQty');
      await refused(unit({ price: 0 }), 'units.0.price');
      await refused(unit({ price: 78_000.5 }), 'units.0.price');
      await refused(unit({ name: ' ' }), 'units.0.name');
      await refused(unit({ name: 'PCS' }), 'units.0.name'); // the base unit, any case
      await refused(unit({ tenantId: randomUUID() }), 'units.0.tenantId');
      await refused(
        {
          units: [
            { name: 'dus', unitQty: 24, price: 78_000 },
            { name: 'Dus', unitQty: 48, price: 150_000 },
          ],
        },
        'units.1.name',
      );
      const tiers = (...t: [number, number][]) => ({
        priceTiers: t.map(([minQty, price]) => ({ minQty, price })),
      });
      await refused(tiers([1, 3300]), 'priceTiers.0.minQty');
      await refused(tiers([0, 3300]), 'priceTiers.0.minQty');
      await refused(tiers([12.5, 3300]), 'priceTiers.0.minQty');
      await refused(tiers([12, 0]), 'priceTiers.0.price');
      await refused(tiers([12, 3300], [12, 3200]), 'priceTiers.1.minQty'); // same threshold
      await refused(tiers([48, 3300], [12, 3200]), 'priceTiers.1.minQty'); // not ascending
      await refused(tiers([12, 3300], [48, 3300]), 'priceTiers.1.price'); // not cheaper
      await refused(tiers([12, 3200], [48, 3300]), 'priceTiers.1.price'); // dearer
      await refused(tiers([12, 3501]), 'priceTiers.0.price'); // above the base price
      expect(
        (await get(store, '/catalog/products').expect(200)).body.total,
      ).toBe(0);
    });

    it('422 on update against the stored product: base price below a tier, base unit named like a unit', async () => {
      const { store, productId } = await tehStore(0);
      const low = await patch(store, `/catalog/products/${productId}`, {
        sellingPrice: 3250,
      }).expect(422);
      expect(low.body.errors).toEqual({
        sellingPrice: 'Harga jual tidak boleh di bawah harga grosir',
      });
      const clash = await patch(store, `/catalog/products/${productId}`, {
        unit: 'DUS',
      }).expect(422);
      expect(Object.keys(clash.body.errors)).toEqual(['units.0.name']);
      const tier = await patch(store, `/catalog/products/${productId}`, {
        priceTiers: [{ minQty: 12, price: 3600 }],
      }).expect(422);
      expect(Object.keys(tier.body.errors)).toEqual(['priceTiers.0.price']);
      // Nothing changed.
      const now = await get(store, `/catalog/products/${productId}`).expect(
        200,
      );
      expect(now.body).toMatchObject({
        unit: 'pcs',
        sellingPrice: 3500,
        priceTiers: TIERS,
      });
      // Lowering the base price together with its tiers is fine.
      await patch(store, `/catalog/products/${productId}`, {
        sellingPrice: 3250,
        priceTiers: [{ minQty: 12, price: 3100 }],
      }).expect(200);
    });

    it('needs catalog.manage to set units and tiers', async () => {
      const { store, productId } = await tehStore(0);
      const cashier = await createCashier(app, store, ['sales.create']);
      await patch(cashier, `/catalog/products/${productId}`, {
        units: [],
      }).expect(403);
      // The cashier still reads them (the unit picker).
      const seen = await get(cashier, `/catalog/products/${productId}`).expect(
        200,
      );
      expect(seen.body.units).toHaveLength(1);
      expect(seen.body.priceTiers).toEqual(TIERS);
    });
  });

  describe('selling', () => {
    it('tier boundaries for loose pcs: 1, 11, 12, 47, 48 (QA table), cost per base unit stored', async () => {
      const { store, productId } = await tehStore(200);
      const cases: [qty: number, unitPrice: number, total: number][] = [
        [1, 3500, 3500],
        [11, 3500, 38_500],
        [12, 3300, 39_600],
        [47, 3300, 155_100],
        [48, 3200, 153_600],
      ];
      for (const [qty, unitPrice, total] of cases) {
        const res = await sell(store.auth, {
          lines: [{ productId, qty }],
          paid: total,
        }).expect(201);
        expect(res.body).toMatchObject({
          subtotal: total,
          total,
          costTotal: qty * 2000,
        });
        const [line] = linesOf(res.body);
        expect(line).toMatchObject({
          qty,
          unit: 'pcs',
          unitQty: 1,
          baseQty: qty,
          normalUnitPrice: 3500,
          listPrice: unitPrice,
          unitPrice,
          lineTotal: total,
          costTotal: qty * 2000,
          appliedTier:
            unitPrice === 3500
              ? null
              : { minQty: unitPrice === 3300 ? 12 : 48, price: unitPrice },
          savings: (3500 - unitPrice) * qty,
          priceOverriddenBy: null,
        });
      }
      expect(await onHand(store, productId)).toBe(200 - 119);
    });

    it('a dus is its fixed price, never tiered, and draws 24 base units per dus', async () => {
      const { store, productId } = await tehStore(100);
      const one = await sell(store.auth, {
        lines: [{ productId, qty: 1, unit: 'dus' }],
        paid: 78_000,
      }).expect(201);
      expect(one.body).toMatchObject({ total: 78_000, costTotal: 48_000 });
      expect(linesOf(one.body)[0]).toMatchObject({
        qty: 1,
        unit: 'dus',
        unitQty: 24,
        baseQty: 24,
        normalUnitPrice: 78_000,
        listPrice: 78_000,
        unitPrice: 78_000,
        lineTotal: 78_000,
        appliedTier: null,
        savings: 0,
      });
      expect(await onHand(store, productId)).toBe(76);
      // 2 dus = 48 pcs: still the dus price (loose, 48 pcs would be 153.600).
      const two = await sell(store.auth, {
        lines: [{ productId, qty: 2, unit: 'DUS' }],
        paid: 156_000,
      }).expect(201);
      expect(two.body).toMatchObject({ total: 156_000, costTotal: 96_000 });
      expect(linesOf(two.body)[0]).toMatchObject({
        unit: 'dus',
        baseQty: 48,
        appliedTier: null,
      });
      expect(await onHand(store, productId)).toBe(28);
      // The stock ledger moved in base units.
      const [{ sum }] = await admin<{ sum: number }[]>`
        select sum(delta)::int as sum from pos.stock_movements
        where ref_id = ${two.body.id} and reason = 'sale'`;
      expect(sum).toBe(-48);
    });

    it('owner rule: the tier comes from the product total in base units across its lines', async () => {
      const { store, productId } = await tehStore(200);
      // 1 dus + 6 pcs = 30 pcs → the 6 pcs cost 6 × 3.300 = 19.800; dus 78.000; total 97.800.
      const mixed = await sell(store.auth, {
        lines: [
          { productId, qty: 1, unit: 'dus' },
          { productId, qty: 6 },
        ],
        paid: 97_800,
      }).expect(201);
      expect(mixed.body).toMatchObject({ subtotal: 97_800, total: 97_800 });
      // Base unit first, then the larger unit.
      expect(linesOf(mixed.body)).toMatchObject([
        {
          unit: 'pcs',
          qty: 6,
          baseQty: 6,
          unitPrice: 3300,
          lineTotal: 19_800,
          normalUnitPrice: 3500,
          appliedTier: { minQty: 12, price: 3300 },
          savings: 1200,
        },
        {
          unit: 'dus',
          qty: 1,
          baseQty: 24,
          unitPrice: 78_000,
          lineTotal: 78_000,
          appliedTier: null,
          savings: 0,
        },
      ]);
      expect(await onHand(store, productId)).toBe(170);
      // 6 loose pcs alone: no tier.
      const alone = await sell(store.auth, {
        lines: [{ productId, qty: 6 }],
        paid: 21_000,
      }).expect(201);
      expect(alone.body.total).toBe(21_000);
      // 11 pcs + 1 dus = 35 pcs: 11 × 3.300 + 78.000.
      const thirtyFive = await sell(store.auth, {
        lines: [
          { productId, qty: 11 },
          { productId, qty: 1, unit: 'dus' },
        ],
        paid: 114_300,
      }).expect(201);
      expect(thirtyFive.body.total).toBe(114_300);
      // 24 loose pcs stay loose (79.200): nothing is converted to a dus.
      const loose = await sell(store.auth, {
        lines: [{ productId, qty: 24, unit: 'pcs' }],
        paid: 79_200,
      }).expect(201);
      expect(linesOf(loose.body)).toMatchObject([
        { unit: 'pcs', qty: 24, unitPrice: 3300, lineTotal: 79_200 },
      ]);
    });

    it('design cart 12 pcs + 1 dus at 11% tax: 117.600 + 12.936 = 130.536, cash rounding 64; receipt carries the unit fields', async () => {
      const { store, productId } = await tehStore(100);
      await http()
        .put('/sales/settings')
        .set('Authorization', store.auth)
        .send({ taxBps: 1100 })
        .expect(200);
      const lines = [
        { productId, qty: 12 },
        { productId, qty: 1, unit: 'dus' },
      ];
      // Cash owes the rounded amount: 130.536 alone is refused.
      await sell(store.auth, { lines, paid: 130_536 }).expect(422);
      const res = await sell(store.auth, { lines, paid: 150_000 }).expect(201);
      expect(res.body).toMatchObject({
        subtotal: 117_600,
        tax: 12_936,
        total: 130_536,
        rounding: 64,
        amountDue: 130_600,
        change: 19_400,
        costTotal: 72_000,
      });
      expect(await onHand(store, productId)).toBe(64);
      const receipt = await get(store, `/sales/${res.body.id}/receipt`).expect(
        200,
      );
      expect(receipt.body.lines).toEqual([
        {
          name: 'Teh Botol 350ml',
          qty: 12,
          unit: 'pcs',
          unitQty: 1,
          baseQty: 12,
          unitPrice: 3300,
          lineTotal: 39_600,
          normalUnitPrice: 3500,
          appliedTier: { minQty: 12, price: 3300 },
          savings: 2400,
          manualPrice: false,
        },
        {
          name: 'Teh Botol 350ml',
          qty: 1,
          unit: 'dus',
          unitQty: 24,
          baseQty: 24,
          unitPrice: 78_000,
          lineTotal: 78_000,
          normalUnitPrice: 78_000,
          appliedTier: null,
          savings: 0,
          manualPrice: false,
        },
      ]);
      // Tax after the discount: (117.600 − 10.000) × 11% = 11.836; total 119.436; rounding 64.
      const discounted = await sell(store.auth, {
        lines,
        discount: 10_000,
        paid: 119_500,
      }).expect(201);
      expect(discounted.body).toMatchObject({
        subtotal: 117_600,
        discount: 10_000,
        tax: 11_836,
        total: 119_436,
        rounding: 64,
        amountDue: 119_500,
        change: 0,
      });
    });

    it('ignores a client price without sales.price_override (tiered pcs and dus); honours it with the permission, cost unchanged', async () => {
      const { store, productId } = await tehStore(200);
      const cashier = await createCashier(app, store, ['sales.create']);
      await post(cashier, '/shifts/open', { openingCash: 0 }).expect(201);
      const ignored = await sell(cashier.auth, {
        lines: [
          { productId, qty: 12, price: 1000 },
          { productId, qty: 1, unit: 'dus', price: 1 },
        ],
        paid: 117_600,
      }).expect(201);
      expect(ignored.body).toMatchObject({
        subtotal: 117_600,
        overrideBy: null,
      });
      expect(linesOf(ignored.body)).toMatchObject([
        { unitPrice: 3300, priceOverriddenBy: null },
        { unitPrice: 78_000, priceOverriddenBy: null },
      ]);

      const senior = await createCashier(app, store, [
        'sales.create',
        'sales.price_override',
        'reports.view',
      ]);
      await post(senior, '/shifts/open', { openingCash: 0 }).expect(201);
      const overridden = await sell(senior.auth, {
        lines: [
          { productId, qty: 12, price: 3000 },
          { productId, qty: 1, unit: 'dus', price: 75_000 },
        ],
        paid: 111_000,
      }).expect(201);
      expect(overridden.body).toMatchObject({
        subtotal: 111_000,
        overrideBy: senior.staffId,
        costTotal: 72_000,
      });
      expect(linesOf(overridden.body)).toMatchObject([
        {
          listPrice: 3300, // the server's (tier) price is kept beside the charged one
          unitPrice: 3000,
          lineTotal: 36_000,
          costTotal: 24_000,
          // A manual price is not wholesale (owner ruling 2026-11-25): no tier, no savings.
          normalUnitPrice: 3500,
          appliedTier: null,
          savings: 0,
          manualPrice: true,
          priceOverriddenBy: senior.staffId,
        },
        {
          listPrice: 78_000,
          normalUnitPrice: 78_000,
          unitPrice: 75_000,
          lineTotal: 75_000,
          costTotal: 48_000,
          appliedTier: null,
          savings: 0,
          manualPrice: true,
          priceOverriddenBy: senior.staffId,
        },
      ]);
      const [stored] = await admin<
        {
          normal_unit_price: string;
          list_price: string;
          applied_tier_min_qty: number | null;
        }[]
      >`select normal_unit_price, list_price, applied_tier_min_qty from pos.sale_lines
        where sale_id = ${overridden.body.id} and unit_qty = 1`;
      expect(stored).toEqual({
        normal_unit_price: '3500',
        list_price: '3300',
        applied_tier_min_qty: null,
      });
      const slip = await get(
        senior,
        `/sales/${overridden.body.id}/receipt`,
      ).expect(200);
      expect(slip.body.lines).toMatchObject([
        {
          unit: 'pcs',
          unitPrice: 3000,
          normalUnitPrice: 3500,
          appliedTier: null,
          savings: 0,
          manualPrice: true,
        },
        {
          unit: 'dus',
          unitPrice: 75_000,
          appliedTier: null,
          manualPrice: true,
        },
      ]);

      // Only the typed line is manual: the price sent for the pcs equals the server's tier price (so it
      // is no override) and stays wholesale; the dus is manual, and its 24 pcs still count toward the
      // product's total (6 + 24 = 30 pcs reach the 12+ tier).
      const mixed = await sell(senior.auth, {
        lines: [
          { productId, qty: 6, price: 3300 },
          { productId, qty: 1, unit: 'dus', price: 70_000 },
        ],
        paid: 89_800,
      }).expect(201);
      expect(mixed.body.subtotal).toBe(89_800);
      expect(linesOf(mixed.body)).toMatchObject([
        {
          unitPrice: 3300,
          appliedTier: { minQty: 12, price: 3300 },
          savings: 1200,
          manualPrice: false,
          priceOverriddenBy: null,
        },
        { unitPrice: 70_000, appliedTier: null, savings: 0, manualPrice: true },
      ]);
    });

    it('stock is checked in base units: 12 pcs + 1 dus with 35 left is refused naming 35, nothing drawn; 1 dus + 11 pcs sells out; 1 dus with 23 is refused', async () => {
      const { store, productId } = await tehStore(35);
      const short = await sell(store.auth, {
        lines: [
          { productId, qty: 12 },
          { productId, qty: 1, unit: 'dus' },
        ],
        paid: 200_000,
      }).expect(422);
      expect(short.body).toMatchObject({
        message: 'Stok Teh Botol 350ml tidak cukup (sisa 35)',
        available: 35,
        productId,
      });
      expect(await onHand(store, productId)).toBe(35);
      expect((await get(store, '/sales').expect(200)).body.data).toHaveLength(
        0,
      );
      // 35 pcs in all: the 11 loose pcs are in the 12+ tier (owner rule), 11 × 3.300 + 78.000.
      const exact = await sell(store.auth, {
        lines: [
          { productId, qty: 1, unit: 'dus' },
          { productId, qty: 11 },
        ],
        paid: 114_300,
      }).expect(201);
      expect(exact.body.total).toBe(114_300);
      expect(await onHand(store, productId)).toBe(0);

      const few = await tehStore(23);
      const refused = await sell(few.store.auth, {
        lines: [{ productId: few.productId, qty: 1, unit: 'dus' }],
        paid: 78_000,
      }).expect(422);
      expect(refused.body).toMatchObject({
        message: 'Stok Teh Botol 350ml tidak cukup (sisa 23)',
        available: 23,
      });
      expect(Object.keys(refused.body.errors)).toEqual(['lines.0.qty']);
      expect(await onHand(few.store, few.productId)).toBe(23);
      await sell(few.store.auth, {
        lines: [{ productId: few.productId, qty: 23 }],
        paid: 75_900,
      }).expect(201);
    });

    it('FIFO cost per base unit: a dus across two batches costs 10 × 2.000 + 14 × 2.500', async () => {
      const { store, productId } = await tehStore(10);
      const sup = await post(store, '/suppliers', {
        name: 'CV Sumber Rejeki',
        phone: '081234567890',
        address: 'Jl. Pasar 1',
      }).expect(201);
      const po = await post(store, '/purchasing/orders', {
        supplierId: sup.body.id,
        paymentMethod: 'Tunai',
        lines: [{ productId, qty: 30, unitCost: 2500 }],
      }).expect(201);
      await post(store, `/purchasing/orders/${po.body.id}/approve`, {}).expect(
        200,
      );
      const res = await sell(store.auth, {
        lines: [
          { productId, qty: 1, unit: 'dus' },
          { productId, qty: 2 },
        ],
        paid: 84_600,
      }).expect(201);
      // 26 pcs → the 2 loose pcs are 3.300 each. Lines draw in request order within the product.
      expect(res.body).toMatchObject({ total: 84_600, costTotal: 60_000 });
      expect(linesOf(res.body)).toMatchObject([
        { unit: 'pcs', costTotal: 5000 },
        { unit: 'dus', costTotal: 20_000 + 14 * 2500 },
      ]);
      expect(await onHand(store, productId)).toBe(14);
    });

    it('void of a pcs + dus sale puts back 36 base units', async () => {
      const { store, productId } = await tehStore(100);
      await http()
        .put('/void-pin')
        .set('Authorization', store.freshAuth)
        .send({ pin: '482913' })
        .expect(200);
      const sale = await sell(store.auth, {
        lines: [
          { productId, qty: 12 },
          { productId, qty: 1, unit: 'dus' },
        ],
        paid: 117_600,
      }).expect(201);
      expect(await onHand(store, productId)).toBe(64);
      await http()
        .post(`/sales/${sale.body.id}/void`)
        .set('Authorization', store.auth)
        .set('Idempotency-Key', randomUUID())
        .send({
          reasonCode: 'customer_cancelled',
          approverId: store.userId,
          pin: '482913',
        })
        .expect(201);
      expect(await onHand(store, productId)).toBe(100);
      const [{ sum }] = await admin<{ sum: number }[]>`
        select sum(delta)::int as sum from pos.stock_movements
        where ref_id = ${sale.body.id} and reason = 'sale_void'`;
      expect(sum).toBe(36);
      // The voided receipt still shows what was rung up.
      const after = await get(store, `/sales/${sale.body.id}`).expect(200);
      expect(after.body.status).toBe('void');
      expect(linesOf(after.body)).toMatchObject([
        { unit: 'pcs', baseQty: 12, lineTotal: 39_600 },
        { unit: 'dus', baseQty: 24, lineTotal: 78_000 },
      ]);
      // The product report nets to nothing.
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
      }).format(new Date());
      const report = await get(
        store,
        `/reports/products?from=${day}&to=${day}`,
      ).expect(200);
      expect(report.body.rows).toEqual([]);
    });

    it('a past sale keeps its unit and prices after the dus is repriced and then removed; the product report counts base units', async () => {
      const { store, productId } = await tehStore(100);
      const sale = await sell(store.auth, {
        lines: [
          { productId, qty: 12 },
          { productId, qty: 1, unit: 'dus' },
        ],
        paid: 117_600,
      }).expect(201);
      await patch(store, `/catalog/products/${productId}`, {
        units: [{ name: 'dus', unitQty: 20, price: 60_000 }],
        priceTiers: [{ minQty: 10, price: 3000 }],
      }).expect(200);
      await patch(store, `/catalog/products/${productId}`, {
        units: [],
        priceTiers: [],
      }).expect(200);
      const after = await get(store, `/sales/${sale.body.id}`).expect(200);
      expect(after.body.total).toBe(117_600);
      expect(linesOf(after.body)).toMatchObject([
        {
          unit: 'pcs',
          unitPrice: 3300,
          appliedTier: { minQty: 12, price: 3300 },
          savings: 2400,
        },
        { unit: 'dus', unitQty: 24, baseQty: 24, unitPrice: 78_000 },
      ]);
      // The removed unit can no longer be sold.
      const gone = await sell(store.auth, {
        lines: [{ productId, qty: 1, unit: 'dus' }],
        paid: 78_000,
      }).expect(422);
      expect(gone.body.errors).toEqual({
        'lines.0.unit': 'Satuan tidak ditemukan untuk produk ini',
      });
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
      }).format(new Date());
      const products = await get(
        store,
        `/reports/products?from=${day}&to=${day}`,
      ).expect(200);
      expect(products.body.rows).toMatchObject([
        { productId, qty: 36, sales: 117_600, cost: 72_000 },
      ]);
      const lines = await get(
        store,
        `/reports/sales?from=${day}&to=${day}`,
      ).expect(200);
      expect(
        (lines.body.rows as { qty: number; unit: string }[]).map((r) => [
          r.qty,
          r.unit,
        ]),
      ).toEqual(
        expect.arrayContaining([
          [12, 'pcs'],
          [1, 'dus'],
        ]),
      );
    });

    it('a line from before this change (no unit stored) reads as the product base unit', async () => {
      const { store, productId } = await tehStore(10);
      const sale = await sell(store.auth, {
        lines: [{ productId, qty: 2 }],
        paid: 7000,
      }).expect(201);
      await admin`update pos.sale_lines set unit = null, normal_unit_price = null
        where sale_id = ${sale.body.id}`;
      const old = await get(store, `/sales/${sale.body.id}`).expect(200);
      expect(linesOf(old.body)).toMatchObject([
        {
          unit: 'pcs',
          unitQty: 1,
          baseQty: 2,
          normalUnitPrice: 3500,
          appliedTier: null,
          savings: 0,
        },
      ]);
    });

    it('refuses an unknown unit, and the same product and unit twice (also "pcs" beside no unit)', async () => {
      const { store, productId } = await tehStore(100);
      const unknown = await sell(store.auth, {
        lines: [
          { productId, qty: 1 },
          { productId, qty: 1, unit: 'karton' },
        ],
        paid: 100_000,
      }).expect(422);
      expect(unknown.body.errors).toEqual({
        'lines.1.unit': 'Satuan tidak ditemukan untuk produk ini',
      });
      for (const lines of [
        [
          { productId, qty: 1, unit: 'dus' },
          { productId, qty: 1, unit: 'Dus' },
        ],
        [
          { productId, qty: 1 },
          { productId, qty: 1, unit: 'pcs' },
        ],
      ]) {
        const twice = await sell(store.auth, { lines, paid: 200_000 }).expect(
          422,
        );
        expect(twice.body.errors).toEqual({
          lines: 'Satu produk dan satuan cukup satu baris',
        });
      }
      await sell(store.auth, {
        lines: [{ productId, qty: 1, unit: '' }],
        paid: 3500,
      }).expect(422);
      expect(await onHand(store, productId)).toBe(100);
    });

    it('a retry of a pcs + dus cart with the same key returns the first sale, whatever the line order; stock moves once', async () => {
      const { store, productId } = await tehStore(100);
      const key = randomUUID();
      const pcs = { productId, qty: 12 };
      const dus = { productId, qty: 1, unit: 'dus' };
      const first = await sell(
        store.auth,
        { lines: [pcs, dus], paid: 117_600 },
        key,
      ).expect(201);
      const again = await sell(
        store.auth,
        { lines: [dus, pcs], paid: 117_600 },
        key,
      ).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(await onHand(store, productId)).toBe(64);
      // Another unit under the same key is another request.
      await sell(
        store.auth,
        { lines: [pcs, { productId, qty: 2, unit: 'dus' }], paid: 200_000 },
        key,
      ).expect(422);
    });

    it('a service product sells by unit too: no stock, cost is cost price × base units', async () => {
      const store = await createStore();
      const categoryId = await category(store);
      const p = await post(store, '/catalog/products', {
        categoryId,
        name: 'Cuci Sepatu',
        type: 'service',
        unit: 'pasang',
        costPrice: 5000,
        sellingPrice: 20_000,
        units: [{ name: 'paket 5', unitQty: 5, price: 90_000 }],
      }).expect(201);
      await post(store, '/shifts/open', { openingCash: 0 }).expect(201);
      const res = await sell(store.auth, {
        lines: [{ productId: p.body.id, qty: 2, unit: 'paket 5' }],
        paid: 180_000,
      }).expect(201);
      expect(res.body).toMatchObject({ total: 180_000, costTotal: 50_000 });
    });
  });

  describe('POST /sales/quote', () => {
    it('prices the cart with nothing written: tier, savings and the next tier hint', async () => {
      const { store, productId } = await tehStore(5);
      const quote = (lines: object[], auth = store.auth) =>
        http().post('/sales/quote').set('Authorization', auth).send({ lines });
      const res = await quote([
        { productId, qty: 12 },
        { productId, qty: 1, unit: 'dus' },
      ]).expect(200);
      // 36 pcs in the cart: 12 more reach the 48+ price.
      const nextTier = { minQty: 48, price: 3200, remaining: 12 };
      expect(res.body).toEqual({
        subtotal: 117_600,
        lines: [
          {
            productId,
            name: 'Teh Botol 350ml',
            qty: 12,
            unit: 'pcs',
            unitQty: 1,
            baseQty: 12,
            normalUnitPrice: 3500,
            unitPrice: 3300,
            lineTotal: 39_600,
            appliedTier: { minQty: 12, price: 3300 },
            savings: 2400,
            nextTier,
          },
          {
            productId,
            name: 'Teh Botol 350ml',
            qty: 1,
            unit: 'dus',
            unitQty: 24,
            baseQty: 24,
            normalUnitPrice: 78_000,
            unitPrice: 78_000,
            lineTotal: 78_000,
            appliedTier: null,
            savings: 0,
            nextTier,
          },
        ],
      });
      // The design's hint at 12 loose pcs: "Tambah 36 pcs lagi untuk harga Rp3.200".
      const twelve = await quote([{ productId, qty: 12 }]).expect(200);
      expect(twelve.body.lines[0].nextTier).toEqual({
        minQty: 48,
        price: 3200,
        remaining: 36,
      });
      const top = await quote([{ productId, qty: 48 }]).expect(200);
      expect(top.body.lines[0]).toMatchObject({
        unitPrice: 3200,
        nextTier: null,
      });
      // No stock check and nothing written.
      expect(await onHand(store, productId)).toBe(5);
      expect((await get(store, '/sales').expect(200)).body.data).toHaveLength(
        0,
      );
      // A price is not part of a quote; a bad unit or product is 422; it needs sales.create.
      await quote([{ productId, qty: 1, price: 1 }]).expect(422);
      await quote([{ productId, qty: 1, unit: 'karton' }]).expect(422);
      await quote([{ productId: randomUUID(), qty: 1 }]).expect(422);
      await quote([]).expect(422);
      const viewer = await createCashier(app, store, ['reports.view']);
      await quote([{ productId, qty: 1 }], viewer.auth).expect(403);
    });

    it('answers 422 for a cart above the total cap, like a sale does', async () => {
      const { store, productId } = await tehStore(0, {
        name: 'Barang mahal',
        sellingPrice: 1_000_000_000_000,
        units: [],
        priceTiers: [],
      });
      await http()
        .post('/sales/quote')
        .set('Authorization', store.auth)
        .send({ lines: [{ productId, qty: 2 }] })
        .expect(422);
    });

    it('shows no wholesale badge when a tier price equals the normal price', async () => {
      const { store, productId } = await tehStore(0, {
        priceTiers: [{ minQty: 12, price: 3500 }],
      });
      const res = await http()
        .post('/sales/quote')
        .set('Authorization', store.auth)
        .send({ lines: [{ productId, qty: 12 }] })
        .expect(200);
      expect(res.body.lines[0]).toMatchObject({
        appliedTier: null,
        savings: 0,
        unitPrice: 3500,
      });
    });
  });

  describe('cross-tenant', () => {
    it('store B gets 404 on store A product (read, update with units, delete), cannot sell or quote it, and A is unchanged', async () => {
      const a = await tehStore(100);
      const b = await tehStore(100);
      const url = `/catalog/products/${a.productId}`;
      await get(b.store, url).expect(404);
      await patch(b.store, url, {
        units: [{ name: 'karton', unitQty: 2, price: 1 }],
        priceTiers: [],
      }).expect(404);
      await http().delete(url).set('Authorization', b.store.auth).expect(404);
      const sold = await sell(b.store.auth, {
        lines: [{ productId: a.productId, qty: 1, unit: 'dus' }],
        paid: 78_000,
      }).expect(422);
      expect(Object.keys(sold.body.errors)).toEqual(['lines.0.productId']);
      await post(b.store, '/sales/quote', {
        lines: [{ productId: a.productId, qty: 1, unit: 'dus' }],
      }).expect(422);
      // A's product, units, tiers and stock are as they were.
      const mine = await get(a.store, url).expect(200);
      expect(mine.body.units).toEqual(a.product.units);
      expect(mine.body.priceTiers).toEqual(TIERS);
      expect(await onHand(a.store, a.productId)).toBe(100);
      // B's list holds only B's product with B's unit rows.
      const list = await get(b.store, '/catalog/products').expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(b.productId);
      expect(list.body.data[0].units[0].id).not.toBe(a.product.units[0].id);
      // Every unit and tier row carries its own store's tenant id.
      const rows = await admin<{ tenant_id: string; n: number }[]>`
        select tenant_id, count(*)::int as n from (
          select tenant_id from pos.product_units where product_id in (${a.productId}, ${b.productId})
          union all
          select tenant_id from pos.product_price_tiers where product_id in (${a.productId}, ${b.productId})
        ) x group by tenant_id`;
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.n)).toEqual([3, 3]);
      // A sale of B's own dus does not touch A's stock.
      await sell(b.store.auth, {
        lines: [{ productId: b.productId, qty: 1, unit: 'dus' }],
        paid: 78_000,
      }).expect(201);
      expect(await onHand(a.store, a.productId)).toBe(100);
    });
  });
});
