import { TLSSocket } from 'node:tls'
import pg from 'pg'
import type {
  ControlPlaneDatabase,
  SqlExecutor,
  SqlResult,
} from './database.js'

const { Pool } = pg

export interface PostgresDatabaseOptions {
  readonly connectionString: string
  readonly maxConnections?: number
  readonly connectionTimeoutMilliseconds?: number
  readonly idleTimeoutMilliseconds?: number
  readonly statementTimeoutMilliseconds?: number
  readonly applicationName?: string
  readonly tls?: 'verify-full' | 'disable'
}

export interface PostgresClientTlsEvidence {
  readonly verificationMode: 'verified_ca' | 'disabled'
  readonly encrypted: boolean
  readonly authorized: boolean
  readonly authorizationErrorPresent: boolean
}

export function postgresTlsConfiguration(
  mode: 'verify-full' | 'disable',
): false | { readonly rejectUnauthorized: true } {
  return mode === 'disable' ? false : { rejectUnauthorized: true }
}

function toSqlResult<Row extends Record<string, unknown>>(
  result: pg.QueryResult<Row>,
): SqlResult<Row> {
  return {
    rows: result.rows,
    rowCount: result.rowCount ?? result.rows.length,
  }
}

class PostgresExecutor implements SqlExecutor {
  public constructor(private readonly client: pg.PoolClient) {}

  public async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlResult<Row>> {
    return toSqlResult(await this.client.query<Row>(sql, [...parameters]))
  }

  public async exec(sql: string): Promise<void> {
    await this.client.query(sql)
  }
}

export class PostgresDatabase implements ControlPlaneDatabase {
  readonly #pool: pg.Pool
  readonly #tlsMode: 'verify-full' | 'disable'

  public constructor(options: PostgresDatabaseOptions) {
    this.#tlsMode = options.tls ?? 'verify-full'
    this.#pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
      connectionTimeoutMillis: options.connectionTimeoutMilliseconds ?? 5_000,
      idleTimeoutMillis: options.idleTimeoutMilliseconds ?? 30_000,
      statement_timeout: options.statementTimeoutMilliseconds ?? 15_000,
      application_name: options.applicationName ?? 'codetether-control-plane',
      ssl: postgresTlsConfiguration(this.#tlsMode),
    })
  }

  public async inspectClientTls(): Promise<PostgresClientTlsEvidence> {
    const client = await this.#pool.connect()
    try {
      await client.query('SELECT 1')
      const stream = client.connection.stream
      const tlsSocket = stream instanceof TLSSocket ? stream : undefined
      return {
        verificationMode:
          this.#tlsMode === 'verify-full' ? 'verified_ca' : 'disabled',
        encrypted: tlsSocket?.encrypted === true,
        authorized: tlsSocket?.authorized === true,
        authorizationErrorPresent: tlsSocket?.authorizationError != null,
      }
    } finally {
      client.release()
    }
  }

  public async query<Row extends Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<SqlResult<Row>> {
    return toSqlResult(await this.#pool.query<Row>(sql, [...parameters]))
  }

  public async exec(sql: string): Promise<void> {
    await this.#pool.query(sql)
  }

  public async transaction<Result>(
    operation: (transaction: SqlExecutor) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.#pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(new PostgresExecutor(client))
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  public async close(): Promise<void> {
    await this.#pool.end()
  }
}
