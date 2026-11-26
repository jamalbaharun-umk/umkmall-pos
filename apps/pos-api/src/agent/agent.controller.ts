import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { AgentRoute, CurrentSession } from '../tenancy/decorators';
import type { PosSession } from '../tenancy/session';
import { AgentIdempotency } from './idempotency';
import { buildAgentServer } from './tools';

/**
 * The MCP server for UMKMall's agent (UMK-1979): Streamable HTTP, stateless (one server per request), behind the
 * agent session of UMK-1978. Owner and cashier sessions are refused: their screens use the REST routes.
 */
@Controller('mcp')
export class AgentController {
  constructor(private readonly idempotency: AgentIdempotency) {}

  @Post()
  @AgentRoute()
  async handle(
    @CurrentSession() s: PosSession,
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    if (s.kind !== 'agent') throw new ForbiddenException();
    // Tools call this same process on the port the request came in on, with the caller's own token.
    const server = buildAgentServer(
      s,
      {
        base: `http://127.0.0.1:${req.socket.localPort}`,
        authorization: req.headers.authorization ?? '',
      },
      this.idempotency,
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
