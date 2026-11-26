import { Module } from '@nestjs/common';
import { AgentAccessController } from './access.controller';
import { AgentController } from './agent.controller';
import { AgentIdempotency } from './idempotency';
import { LedgerController } from './ledger.controller';
import { AgentUsage } from './usage';

@Module({
  controllers: [AgentController, AgentAccessController, LedgerController],
  providers: [AgentIdempotency, AgentUsage],
})
export class AgentModule {}
