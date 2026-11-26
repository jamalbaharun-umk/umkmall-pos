import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AreaChart,
  BarChart,
  CHART_CSS,
  CHART_TOKEN_NAMES,
  ChartFrame,
  DonutChart,
  HeatStrip,
  LineChart,
  MarginTile,
  Meter,
  MeterList,
  SegmentedBar,
  Sparkline,
  StatTile,
} from './index';
import { FALLBACK_WIDTH } from './hooks';

const days = ['Rab', 'Kam', 'Jum', 'Sab', 'Min', 'Sen', 'Sel'];
const sales = [1_390_000, 1_100_000, 1_620_000, 2_050_000, 2_400_000, 1_250_000, 1_350_000];

/** Markup without the inlined <style>, so a class name in the CSS text cannot satisfy an assertion. */
const ssr = (el: React.ReactElement) => renderToString(el).replace(/<style[\s\S]*?<\/style>/g, '');
const ssrRaw = (el: React.ReactElement) => renderToString(el);

describe('server render (the PDF path): values are in the markup, no browser needed', () => {
  it('BarChart vertical writes the summary and every value', () => {
    const html = ssr(<BarChart title="Penjualan 7 hari" unit="rupiah" categories={days} series={[{ label: 'Penjualan', values: sales }]} width={600} />);
    expect(html).toContain('Penjualan 7 hari');
    expect(html).toContain('Rab Rp1.390.000');
    expect(html).toContain('>Rp1 jt<'); // axis tick, short format
    expect(html).toContain('role="group"');
    expect(html).toContain('width="600"');
    expect(html).toContain('Lihat tabel');
  });
  it('BarChart horizontal writes the value beside each bar and truncates nothing it can fit', () => {
    const html = ssr(<BarChart orientation="horizontal" categories={['Indomie Goreng', 'Teh Botol 350ml']} series={[{ label: 'Terjual', values: [128, 96] }]} width={375} />);
    expect(html).toContain('>128<');
    expect(html).toContain('>96<');
    expect(html).toContain('Indomie Goreng');
  });
  it('a bridge from zero draws a negative value grey with a minus sign', () => {
    const html = ssr(
      <BarChart
        orientation="horizontal"
        unit="rupiah"
        width={375}
        categories={['Penjualan', 'Harga pokok', 'Laba kotor']}
        series={[{ label: 'Rupiah', values: [10_180_000, -6_100_000, 4_080_000] }]}
      />,
    );
    expect(html).toContain('−Rp6.100.000');
    expect(html).toContain('var(--ds-chart-neg)');
    expect(html).toContain('var(--ds-chart-1)');
  });
  it('LineChart and AreaChart label the last point and fill the area', () => {
    const line = ssr(<LineChart unit="rupiah" categories={days} series={[{ label: 'Penjualan', values: sales }]} width={400} />);
    expect(line).toContain('Rp1,35 jt');
    expect(line).not.toContain('opacity:0.14');
    const area = ssr(<AreaChart unit="rupiah" categories={days} series={{ label: 'Penjualan', values: sales }} width={400} />);
    expect(area).toContain('opacity:0.14');
  });
  it('a second line is dashed so it differs without colour', () => {
    const html = ssr(<LineChart categories={days} series={[{ label: 'A', values: [1, 2, 3, 4, 5, 6, 7] }, { label: 'B', values: [2, 3, 4, 5, 6, 7, 8] }]} width={400} />);
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html).toContain('>A<');
    expect(html).toContain('>B<');
  });
  it('DonutChart writes total in the middle and value plus percent per part', () => {
    const html = ssr(
      <DonutChart
        unit="rupiah"
        width={360}
        parts={[
          { label: 'Tunai', value: 620_000 },
          { label: 'QRIS', value: 410_000 },
          { label: 'Transfer', value: 180_000 },
          { label: 'Kasbon', value: 140_000 },
        ]}
      />,
    );
    expect(html).toContain('Rp1,35 jt');
    expect(html).toContain('Rp620.000');
    expect(html).toContain('46%');
    expect(html).toContain('31%');
  });
  it('DonutChart folds a sixth part into Lainnya', () => {
    const parts = ['A', 'B', 'C', 'D', 'E', 'F'].map((label, i) => ({ label, value: 60 - i * 5 }));
    const html = ssr(<DonutChart parts={parts} width={360} />);
    expect(html).toContain('Lainnya');
    expect(html).not.toContain('>F<');
  });
  it('SegmentedBar writes a legend with values and shares, sequential palette for ageing', () => {
    const html = ssr(
      <SegmentedBar
        unit="rupiah"
        palette="sequential"
        width={375}
        parts={[
          { label: 'Belum jatuh tempo', value: 650_000 },
          { label: '1 sampai 7 hari', value: 803_500 },
          { label: '8 sampai 30 hari', value: 1_250_000 },
          { label: 'Lebih dari 30 hari', value: 0 },
        ]}
      />,
    );
    expect(html).toContain('Rp650.000');
    expect(html).toContain('Lebih dari 30 hari');
    expect(html).toContain('Rp0');
    expect(html).toContain('var(--ds-chart-seq-1)');
    expect(html).toContain('var(--ds-chart-seq-5)');
  });
  it('HeatStrip, Meter, tiles and Sparkline render their numbers', () => {
    const heat = ssr(<HeatStrip labels={['8', '9', '10', '11']} values={[0, 3, 9, 4]} valueLabel="Struk" width={300} />);
    expect(heat).toContain('paling ramai 10');
    const meter = ssr(<Meter label="Telur 1 kg" value={4} max={20} limit={5} unit="pcs" />);
    expect(meter).toContain('4 dari 20 pcs');
    expect(meter).toContain('Menipis');
    expect(ssr(<Meter label="Gula 1 kg" value={0} max={15} />)).toContain('Habis');
    expect(ssr(<Meter label="Beras 5 kg" value={34} max={40} />)).not.toContain('ds-chart-badge"');
    const tile = ssr(<StatTile label="Transaksi" value="41" delta={{ value: 5, unit: 'count', label: 'dari kemarin' }} values={[3, 5, 4, 6]} />);
    expect(tile).toContain('naik 5');
    expect(tile).toContain('dari kemarin');
    expect(ssr(<MarginTile label="Margin kotor" percent={40} amount="Laba bersih Rp2.980.000" />)).toContain('40%');
    expect(ssr(<Sparkline values={[1, 2, 3]} />)).toContain('Tren naik');
    expect(ssr(<Sparkline values={[1]} />)).toBe('');
  });
  it('MeterList writes every row in its table', () => {
    const html = ssr(<MeterList title="Stok" showTable items={[{ label: 'Gula', value: 0, max: 15 }, { label: 'Telur', value: 4, max: 20, limit: 5 }]} />);
    expect(html).toContain('Habis');
    expect(html).toContain('Menipis');
    expect(html).toContain('<table');
  });
  it('is the same markup every time for the same props', () => {
    const el = <BarChart categories={days} series={[{ label: 'P', values: sales }]} width={500} title="T" />;
    expect(ssr(el)).toBe(ssr(el));
  });
  it('carries its own styles with the token definitions', () => {
    const html = ssrRaw(<LineChart categories={days} series={[{ label: 'P', values: sales }]} width={400} />);
    expect(html).toContain('--ds-chart-1');
    expect(html).toContain('.dark .ds-chart');
  });
  it('uses the phone width without a width prop on the server', () => {
    const html = ssr(<BarChart categories={['A', 'B', 'C']} series={[{ label: 'P', values: [1, 2, 3] }]} />);
    expect(html).toContain(`width="${FALLBACK_WIDTH}"`);
  });
});

describe('states', () => {
  it('loading: a skeleton, a polite status, no chart', () => {
    const html = ssr(<BarChart title="Tren" state="loading" categories={days} series={[{ label: 'P', values: sales }]} width={400} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('Memuat Tren');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('<svg');
  });
  it('empty: a dashed box with one sentence, for no data', () => {
    const html = ssr(<BarChart title="Tren" categories={[]} series={[{ label: 'P', values: [] }]} />);
    expect(html).toContain('Grafik muncul setelah ada data.');
    expect(html).toContain('ds-chart-empty');
    expect(html).not.toContain('<svg');
    expect(ssr(<DonutChart parts={[{ label: 'A', value: 0 }]} emptyText="Belum ada penjualan." />)).toContain('Belum ada penjualan.');
    expect(ssr(<SegmentedBar parts={[]} />)).toContain('ds-chart-empty');
    expect(ssr(<HeatStrip labels={['8']} values={[0]} />)).toContain('ds-chart-empty');
    expect(ssr(<MeterList items={[]} />)).toContain('ds-chart-empty');
  });
  it('error: a clear message and a retry button, no old chart', () => {
    const html = ssr(<LineChart title="Tren" state="error" errorText="Grafik tidak bisa dimuat." onRetry={() => {}} categories={days} series={[{ label: 'P', values: sales }]} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Muat ulang');
    expect(html).not.toContain('<svg');
  });
  it('one data point becomes a number tile, not a one-point chart', () => {
    const bar = ssr(<BarChart unit="rupiah" categories={['Rab']} series={[{ label: 'Penjualan', values: [1_390_000] }]} />);
    expect(bar).toContain('Rp1.390.000');
    expect(bar).toContain('ds-chart-tile');
    expect(bar).not.toContain('role="group"');
    const line = ssr(<LineChart unit="rupiah" categories={['Rab']} series={[{ label: 'Penjualan', values: [5] }]} />);
    expect(line).toContain('ds-chart-tile');
  });
});

describe('tokens: light and dark', () => {
  const block = (re: RegExp) => CHART_CSS.match(re)?.[0] ?? '';
  const light = block(/\.ds-chart\{[\s\S]*?\}\n\.dark/);
  const dark = block(/\.dark \.ds-chart,\[data-theme="dark"\] \.ds-chart\{[\s\S]*?\}/);
  it('defines every chart token for light', () => {
    for (const name of CHART_TOKEN_NAMES) expect(light, name).toContain(`${name}:`);
  });
  it('defines every chart token again for dark, under .dark and data-theme', () => {
    expect(dark).not.toBe('');
    for (const name of CHART_TOKEN_NAMES) expect(dark, name).toContain(`${name}:`);
  });
  it('uses only the primary ramp and neutrals for series; red, yellow, green only as status', () => {
    for (const name of CHART_TOKEN_NAMES) {
      const re = new RegExp(`${name}: var\\(--([a-z]+)-`, 'g');
      for (const m of CHART_CSS.matchAll(re)) {
        const family = m[1];
        if (name.startsWith('--ds-chart-status')) expect(['red', 'yellow', 'green']).toContain(family);
        else expect(['brand', 'neutral']).toContain(family);
      }
    }
  });
  it('does not shadow the admin theme chart-1..5 colours', () => {
    expect(CHART_CSS).not.toMatch(/--chart-\d/);
  });
});

describe('interaction (client)', () => {
  const roots: Array<{ unmount: () => void; el: HTMLElement }> = [];
  afterEach(() => {
    for (const r of roots.splice(0)) {
      act(() => r.unmount());
      r.el.remove();
    }
  });
  function mount(el: React.ReactElement): HTMLElement {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(el));
    roots.push({ unmount: () => root.unmount(), el: host });
    return host;
  }

  it('shows the value on pointer enter and focus, hides on leave', () => {
    const host = mount(<BarChart unit="rupiah" categories={days} series={[{ label: 'Penjualan', values: sales }]} width={500} />);
    const datum = host.querySelectorAll('[data-datum]')[2] as SVGGElement;
    expect(host.querySelector('.ds-chart-tip')).toBeNull();
    act(() => {
      datum.dispatchEvent(new Event('pointerover', { bubbles: true }));
      datum.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    const tip = host.querySelector('.ds-chart-tip');
    expect(tip?.textContent).toContain('Jum');
    expect(tip?.textContent).toContain('Rp1.620.000');
    act(() => datum.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(host.querySelector('.ds-chart-tip')).toBeNull();
  });

  it('every datum is reachable with the keyboard and named', () => {
    const host = mount(<BarChart categories={days} series={[{ label: 'P', values: sales }]} width={500} />);
    const data = host.querySelectorAll('[data-datum]');
    expect(data).toHaveLength(7);
    for (const d of data) {
      expect(d.getAttribute('tabindex')).toBe('0');
      expect(d.getAttribute('aria-label')).toMatch(/^[A-Za-z]{3}: /);
    }
  });

  it('opens and closes the table with the same numbers as the picture', () => {
    const host = mount(<BarChart title="Tren" unit="rupiah" categories={days} series={[{ label: 'Penjualan', values: sales }]} width={500} />);
    const btn = host.querySelector('button.ds-chart-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Lihat tabel');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('table')).toBeNull();
    act(() => btn.click());
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const cells = [...host.querySelectorAll('tbody td')].map((c) => c.textContent);
    expect(cells).toEqual(sales.map((v) => `Rp${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`));
    expect(host.querySelector('caption')?.textContent).toBe('Tren');
  });

  it('calls onRetry from the error state and onSelect from a bar (Enter)', () => {
    const retry = vi.fn();
    const host = mount(<ChartFrame title="X" state="error" onRetry={retry} />);
    act(() => (host.querySelector('button.ds-chart-btn') as HTMLButtonElement).click());
    expect(retry).toHaveBeenCalledTimes(1);

    const pick = vi.fn();
    const h2 = mount(<BarChart categories={days} series={[{ label: 'P', values: sales }]} width={500} onSelect={pick} />);
    const d = h2.querySelectorAll('[data-datum]')[1] as SVGGElement;
    expect(d.getAttribute('role')).toBe('button');
    act(() => d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(pick).toHaveBeenCalledWith({ category: 1, series: 0 });
  });

  it('follows its container width when no width is given', () => {
    const orig = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { width: 700, height: 100, top: 0, left: 0, right: 700, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect;
    };
    try {
      const host = mount(<BarChart categories={days} series={[{ label: 'P', values: sales }]} />);
      expect(host.querySelector('svg')?.getAttribute('width')).toBe('700');
    } finally {
      HTMLElement.prototype.getBoundingClientRect = orig;
    }
  });
});

describe('phone layout: at most seven columns in view, the rest scroll', () => {
  it('widens the plot past the container for 12 categories at 375px', () => {
    const cats = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);
    const html = ssr(<BarChart categories={cats} series={[{ label: 'P', values: cats.map((_, i) => i + 1) }]} width={375} />);
    expect(html).toContain('class="ds-chart-scroll"');
    const w = Number(/<svg[^>]*width="(\d+)"/.exec(html)?.[1]);
    expect(w).toBeGreaterThan(375);
  });
  it('does not scroll for seven', () => {
    const html = ssr(<BarChart categories={days} series={[{ label: 'P', values: sales }]} width={375} />);
    expect(html).not.toContain('ds-chart-scroll');
  });
});
