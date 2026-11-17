/** RFC 4180 CSV. Cells starting with = + - @ (or tab/CR) are prefixed with ' so spreadsheets never run them. */
export function toCsv(
  header: string[],
  rows: (string | number | null)[][],
): string {
  const cell = (v: string | number | null) => {
    if (v === null) return '';
    if (typeof v === 'number') return String(v);
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
  );
}
