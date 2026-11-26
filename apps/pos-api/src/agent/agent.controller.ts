import {
  Body,
  Controller,
  ForbiddenException,
  HttpException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { validate } from '../common/validation';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { AgentIdempotency } from './idempotency';
import { WindowLimiter } from './rate-limit';
import { buildAgentServer } from './tools';

/** MCP requests per store per minute: room for a busy agent, a stop for a runaway loop (UMK-1979 review). */
export const MCP_REQUESTS_PER_MINUTE = 300;
import { AgentUsage, type CallContext } from './usage';

const ref = z
  .string()
  .regex(/^[A-Za-z0-9:._-]{1,100}$/, 'Referensi tidak valid');
/** New Teman AI call context, sent by UMKMall as headers: which goal, assistant, run and step mode a call serves. */
const ContextHeaders = z.object({
  'x-umkmall-goal': ref.optional(),
  'x-umkmall-assistant': ref.optional(),
  'x-umkmall-run': ref.optional(),
  'x-umkmall-mode': z.enum(['agentic', 'guided']).optional(),
});

/**
 * The MCP server for UMKMall's agent (UMK-1979): Streamable HTTP, stateless (one server per request), behind the
 * agent session of UMK-1978. Owner and cashier sessions are refused: their screens use the REST routes.
 */
@Controller('mcp')
export class AgentController {
  private readonly limit = new WindowLimiter(MCP_REQUESTS_PER_MINUTE, 60_000);

  constructor(
    private readonly idempotency: AgentIdempotency,
    private readonly usage: AgentUsage,
  ) {}

  @AgentRoute()
  @Post()
  async handle(
    @CurrentSession() s: PosSession,
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (s.kind !== 'agent') throw new ForbiddenException();
    if (!this.limit.hit(s.tenantId))
      throw new HttpException(
        { message: 'Terlalu banyak permintaan agent, coba lagi sebentar' },
        429,
      );
    const h = validate(ContextHeaders, {
      'x-umkmall-goal': req.headers['x-umkmall-goal'],
      'x-umkmall-assistant': req.headers['x-umkmall-assistant'],
      'x-umkmall-run': req.headers['x-umkmall-run'],
      'x-umkmall-mode': req.headers['x-umkmall-mode'],
    });
    const context: CallContext = {
      goalRef: h['x-umkmall-goal'],
      assistantRef: h['x-umkmall-assistant'],
      runRef: h['x-umkmall-run'],
      mode: h['x-umkmall-mode'],
    };
    // Tools call this same process on the port the request came in on, with the caller's own token.
    const server = buildAgentServer(
      s,
      {
        base: `http://127.0.0.1:${req.socket.localPort}`,
        authorization: req.headers.authorization ?? '',
      },
      { idempotency: this.idempotency, usage: this.usage },
      context,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}
