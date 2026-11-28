import { BUSINESS_TEMPLATES, templateProducts } from './templates';

describe('business templates (UMK-2128)', () => {
  it('has the seven research segments, each with 20 to 30 products and unique names', () => {
    expect(BUSINESS_TEMPLATES).toHaveLength(7);
    expect(new Set(BUSINESS_TEMPLATES.map((t) => t.key)).size).toBe(7);
    for (const t of BUSINESS_TEMPLATES) {
      const items = templateProducts(t);
      expect(items.length).toBeGreaterThanOrEqual(20);
      expect(items.length).toBeLessThanOrEqual(30);
      const names = items.map((i) => i.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
      const cats = t.categories.map((c) => c.name.toLowerCase());
      expect(new Set(cats).size).toBe(cats.length);
      for (const i of items) {
        expect(i.name.length).toBeLessThanOrEqual(120);
        expect(i.unit).toMatch(/^[A-Z]{1,20}$/);
      }
    }
  });

  it('matches the counts shown in design 44', () => {
    const count = (key: string) =>
      templateProducts(BUSINESS_TEMPLATES.find((t) => t.key === key)!).length;
    expect(count('warung_makan')).toBe(24);
    expect(count('warung_kelontong')).toBe(30);
    expect(count('kafe_minuman')).toBe(22);
    expect(count('kue_roti')).toBe(20);
  });
});
