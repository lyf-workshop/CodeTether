export interface SqlResult<Row extends Record<string, unknown>> {
  readonly rows: readonly Row[]
  readonly rowCount: number
}

export interface SqlExecutor {
  query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<SqlResult<Row>>
  exec(sql: string): Promise<void>
}

export interface ControlPlaneDatabase extends SqlExecutor {
  transaction<Result>(
    operation: (transaction: SqlExecutor) => Promise<Result>,
  ): Promise<Result>
  close(): Promise<void>
}
