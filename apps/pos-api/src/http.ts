import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';

/** A product photo sent to the MCP server as base64 (2 MB image ≈ 2.7 MB of text, plus the JSON-RPC envelope). */
export const MCP_BODY_LIMIT = '3mb';
/** UMK-2129: the product import's CSV text (400 000 characters, up to 4 bytes each in UTF-8, plus JSON escapes). */
export const IMPORT_BODY_LIMIT = '2mb';

/**
 * Body parsing, set once here for the app and its tests (create the app with `bodyParser: false`): Nest's defaults
 * (JSON and urlencoded, 100 kB) everywhere, and a larger JSON limit on `/mcp` only, for `add_product_photo`.
 */
export function configureBody(app: NestExpressApplication): void {
  app.use('/mcp', json({ limit: MCP_BODY_LIMIT }));
  // UMK-2129: a 500-row CSV import (the routes cap the text at IMPORT_MAX_CHARS).
  app.use('/catalog/products/import', json({ limit: IMPORT_BODY_LIMIT }));
  app.use(json({ limit: '100kb' }));
  app.use(urlencoded({ extended: true, limit: '100kb' }));
}
