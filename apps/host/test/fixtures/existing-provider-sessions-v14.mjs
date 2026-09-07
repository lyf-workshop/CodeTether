/** Test-only reverse fixture yielding the exact Conversation columns at v14. */
export function downgradeExistingProviderSessionsToVersionFourteen(database) {
  database.exec(`
    DROP TABLE onboarding_progress;
    DELETE FROM schema_migrations WHERE version = 17;
    DROP TABLE conversation_provider_installation_bindings;
    DROP TABLE provider_backend_observations;
    DROP TABLE provider_installation_compatibility;
    DROP TABLE machine_provider_installation_selections;
    DROP TABLE provider_installations;
    DROP INDEX idx_conversations_provider_installation_identity;
    DELETE FROM schema_migrations WHERE version = 16;
    DROP INDEX idx_conversations_provider_session_identity;
    ALTER TABLE conversations DROP COLUMN origin;
    ALTER TABLE conversations DROP COLUMN provider_session_materialized;
    DELETE FROM schema_migrations WHERE version = 15;
  `)
}
