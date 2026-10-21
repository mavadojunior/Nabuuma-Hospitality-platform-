/*
Migration: 00007_remediate_app_least_privilege.sql
Project: Nabuuma Hospitality Platform
Schema: nabuuma
Role: nabuuma_app

Purpose:
  Revoke UPDATE and DELETE from nabuuma_app on exactly three tables
  and enforce row-level security for table owners.

Prerequisites:
  - Schema nabuuma and all three target tables exist.
  - Role nabuuma_app exists.
  - Existing RLS policies and application workflows have been reviewed.
  - This migration has been approved for execution.

Security scope:
  - No dynamic SQL.
  - No role creation or ownership changes.
  - No changes to unrelated tables or schemas.
  - No migration-history changes.

Static review only. Do not execute before approval.
*/

BEGIN;

REVOKE UPDATE, DELETE
    ON TABLE nabuuma.assessments
    FROM nabuuma_app;

REVOKE UPDATE, DELETE
    ON TABLE nabuuma.evidence_records
    FROM nabuuma_app;

REVOKE UPDATE, DELETE
    ON TABLE nabuuma.telemetry_observations
    FROM nabuuma_app;

ALTER TABLE nabuuma.assessments
    FORCE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.evidence_records
    FORCE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.telemetry_observations
    FORCE ROW LEVEL SECURITY;

COMMIT;
