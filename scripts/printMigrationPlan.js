const steps = [
  {
    project: "Project 1 - AUTH",
    migration: "supabase/migrations/202605250003_studentos_pass3_auth_metadata.sql",
  },
  {
    project: "Project 2 - DATA SHARD 1",
    migration: "supabase/migrations/202605250004_studentos_pass3_data_shard_schema.sql",
  },
  {
    project: "Project 3 - DATA SHARD 2",
    migration: "supabase/migrations/202605250004_studentos_pass3_data_shard_schema.sql",
  },
  {
    project: "Project 4 - DATA SHARD 3",
    migration: "supabase/migrations/202605250004_studentos_pass3_data_shard_schema.sql",
  },
];

const additionalShardMigrations = [
  "supabase/migrations/202605250005_studentos_pass5_source_upload_columns.sql",
  "supabase/migrations/202605250006_studentos_pass6_source_chunks.sql",
  "supabase/migrations/202605250007_studentos_pass7_extraction_ai.sql",
  "supabase/migrations/202605250008_studentos_pass8_pgvector_hybrid.sql",
  "supabase/migrations/202605250009_studentos_pass9_match_source_chunks_rpc.sql",
  "supabase/migrations/202605250010_studentos_pass10_background_jobs.sql",
  "supabase/migrations/202605250011_studentos_pass11_job_claiming.sql",
  "supabase/migrations/202605250012_studentos_pass12_job_events_cleanup.sql",
  "supabase/migrations/202605250013_studentos_pass16_billing_entitlements.sql",
  "supabase/migrations/202605250014_studentos_pass17_identity_consent_lifecycle.sql",
  "supabase/migrations/202605250015_studentos_pass18_export_worker_dry_run.sql",
  "supabase/migrations/202605250016_studentos_pass19_operator_review_retention.sql",
  "supabase/migrations/202605250017_studentos_pass20_final_deletion_safety.sql",
  "supabase/migrations/202605250018_studentos_pass21_operator_rbac_monitoring.sql",
  "supabase/migrations/202605250019_studentos_pass22_mfa_billing_alerts.sql",
  "supabase/migrations/202605250020_studentos_pass24_classroom_tokens_sync_history.sql",
  "supabase/migrations/202606290001_studentos_pass35_4_plan_entitlements.sql",
  "supabase/migrations/202607010001_studentos_task2_classroom_selection_truth.sql",
  "supabase/migrations/202607010002_studentos_task33_ai_weekly_allowance.sql",
  "supabase/migrations/202607020001_studentos_task34_ai_allowance_permissions.sql",
  "supabase/migrations/202607130001_studentos_multi_provider_routing.sql",
  "supabase/migrations/202607190001_studentos_adaptive_recovery_engine.sql",
];

console.log("StudentOS migration plan through Adaptive Recovery Engine Build Week");
for (const [index, step] of steps.entries()) {
  console.log(`${index + 1}. ${step.project}: ${step.migration}`);
}
console.log("Additional shard migrations to run identically on Projects 2, 3, and 4:");
for (const migration of additionalShardMigrations) {
  console.log(`- ${migration}`);
}
console.log("No migrations are run by this script.");
