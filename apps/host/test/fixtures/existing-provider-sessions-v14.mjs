/** Test-only reverse fixture yielding the exact Conversation columns at v14. */
export function downgradeExistingProviderSessionsToVersionFourteen(database) {
  database.exec(`
    DROP INDEX idx_conversations_provider_session_identity;
    ALTER TABLE conversations DROP COLUMN origin;
    ALTER TABLE conversations DROP COLUMN provider_session_materialized;
    DELETE FROM schema_migrations WHERE version = 15;
  `)
}
