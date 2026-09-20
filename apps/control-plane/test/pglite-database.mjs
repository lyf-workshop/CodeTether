import { PGlite } from '@electric-sql/pglite'

class PGliteExecutor {
  constructor(database) {
    this.database = database
  }

  async query(sql, parameters = []) {
    const result = await this.database.query(sql, parameters)
    return {
      rows: result.rows,
      rowCount:
        result.rows.length > 0
          ? result.rows.length
          : (result.affectedRows ?? result.rows.length),
    }
  }

  async exec(sql) {
    await this.database.exec(sql)
  }
}

export class PGliteControlPlaneDatabase extends PGliteExecutor {
  static async create() {
    const database = await PGlite.create()
    return new PGliteControlPlaneDatabase(database)
  }

  async transaction(operation) {
    return this.database.transaction(async (transaction) =>
      operation(new PGliteExecutor(transaction)),
    )
  }

  async close() {
    await this.database.close()
  }
}
