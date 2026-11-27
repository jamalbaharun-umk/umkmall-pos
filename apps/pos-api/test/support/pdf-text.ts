import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT = `
import { PDFParse } from 'pdf-parse';
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const parser = new PDFParse({ data: new Uint8Array(Buffer.concat(chunks)) });
const r = await parser.getText();
await parser.destroy();
process.stdout.write(JSON.stringify({ text: r.text, pages: r.total }));
`;

/**
 * The text of a PDF and its page count, read by pdf-parse in a child process: pdfjs is ESM-only and Jest's
 * sandbox cannot load it. Throws when the bytes are not a readable PDF.
 */
export function pdfText(bytes: Buffer): { text: string; pages: number } {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {
    input: bytes,
    cwd: path.join(__dirname, '..', '..'),
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  });
  if (r.status !== 0)
    throw new Error(`pdf text failed: ${r.stderr.slice(0, 500)}`);
  return JSON.parse(r.stdout) as { text: string; pages: number };
}
