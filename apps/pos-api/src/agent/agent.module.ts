import { Module } from '@nestjs/common';
import { AgentAccessController } from './access.controller';
import { AgentController } from './agent.controller';
import { AgentIdempotency } from './idempotency';
import { AgentUsage } from './usage';

@Module({
  controllers: [AgentController, AgentAccessController],
  providers: [AgentIdempotency, AgentUsage],
})
export class AgentModule {}
