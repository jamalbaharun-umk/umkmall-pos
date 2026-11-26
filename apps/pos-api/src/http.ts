import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';

/** A product photo sent to the MCP server as base64 (2 MB image ≈ 2.7 MB of text, plus the JSON-RPC envelope). */
export const MCP_BODY_LIMIT = '3mb';

/**
 * Body parsing, set once here for the app and its tests (create the app with `bodyParser: false`): Nest's defaults
 * (JSON and urlencoded, 100 kB) everywhere, and a larger JSON limit on `/mcp` only, for `add_product_photo`.
 */
export function configureBody(app: NestExpressApplication): void {
  app.use('/mcp', json({ limit: MCP_BODY_LIMIT }));
  app.use(json({ limit: '100kb' }));
  app.use(urlencoded({ extended: true, limit: '100kb' }));
}
