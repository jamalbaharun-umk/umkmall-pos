import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv } from '../config';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
export const DB = Symbol('DB');
const SQL = Symbol('SQL');

export const InjectDb = () => Inject(DB);

@Global()
@Module({
  providers: [
    {
      provide: SQL,
      useFactory: () => postgres(loadEnv().DATABASE_URL, { max: 10 }),
    },
    {
      provide: DB,
      inject: [SQL],
      useFactory: (sql: postgres.Sql) => drizzle(sql, { schema }),
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  async onApplicationShutdown() {
    await this.sql.end({ timeout: 5 });
  }
}
