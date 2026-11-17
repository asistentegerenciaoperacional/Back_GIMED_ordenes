import postgres from "postgres";

export interface Executor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(statement: string, params?: unknown[]): Promise<T[]>;
}
export interface Postgres extends Executor {
  transaction<T>(run: (tx: Executor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function executor(sql: postgres.Sql | postgres.TransactionSql): Executor {
  return {
    async query<T extends Record<string, unknown>>(statement: string, params: unknown[] = []) {
      return await sql.unsafe<T[]>(statement, params as never[]);
    },
  };
}
export function connect(url: string): Postgres {
  const host = new URL(url).hostname;
  const sql = postgres(url, {
    prepare: false,
    max: 2,
    idle_timeout: 15,
    connect_timeout: 8,
    ssl: ["localhost", "127.0.0.1", "db", "supabase_db_gimed-ordenes"].includes(host) ? false : "verify-full",
  });
  return {
    ...executor(sql),
    async transaction<T>(run: (tx: Executor) => Promise<T>) {
      return await sql.begin((transaction) => run(executor(transaction))) as T;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
