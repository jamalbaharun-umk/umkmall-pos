import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentIdempotency } from './idempotency';

@Module({
  controllers: [AgentController],
  providers: [AgentIdempotency],
})
export class AgentModule {}
