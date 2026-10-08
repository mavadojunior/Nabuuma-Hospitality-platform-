-- ============================================================================
-- Migration: 00003_fix_rls_relationship_correlations.sql
-- Purpose:
--   Correct RLS relationship checks that were unintentionally self-comparisons
--   in migration 00002.
--
-- Security invariant:
--   Cross-row relationships must be explicitly correlated to the outer row.
--
-- This migration intentionally does NOT modify migration 00002.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TELEMETRY WRITE RLS
-- ============================================================================
--
-- Require the referenced practice session to belong to the same organisation
-- as the telemetry observation.
-- ============================================================================

DROP POLICY IF EXISTS tenant_telemetry_insert
ON nabuuma.telemetry_observations;

CREATE POLICY tenant_telemetry_insert
ON nabuuma.telemetry_observations
FOR INSERT
TO nabuuma_app
WITH CHECK (
    telemetry_observations.organisation_id =
        nabuuma.current_app_organisation_id()

    AND telemetry_observations.observed_by_id =
        nabuuma.current_app_user_id()

    AND nabuuma.is_active_member(
        telemetry_observations.organisation_id,
        nabuuma.current_app_user_id()
    )

    AND EXISTS (
        SELECT 1
        FROM nabuuma.practice_sessions ps
        WHERE ps.id = telemetry_observations.practice_session_id
          AND ps.organisation_id =
              telemetry_observations.organisation_id
    )
);

-- ============================================================================
-- 2. EVIDENCE WRITE RLS
-- ============================================================================
--
-- Require:
--   - evidence belongs to current tenant;
--   - actor is active in that tenant;
--   - learner is an active member of that tenant;
--   - referenced practice session belongs to that tenant;
--   - referenced practice session belongs to that learner.
-- ============================================================================

DROP POLICY IF EXISTS tenant_evidence_insert
ON nabuuma.evidence_records;

CREATE POLICY tenant_evidence_insert
ON nabuuma.evidence_records
FOR INSERT
TO nabuuma_app
WITH CHECK (
    evidence_records.organisation_id =
        nabuuma.current_app_organisation_id()

    AND nabuuma.is_active_member(
        evidence_records.organisation_id,
        nabuuma.current_app_user_id()
    )

    AND EXISTS (
        SELECT 1
        FROM nabuuma.organisation_memberships learner_membership
        WHERE learner_membership.organisation_id =
              evidence_records.organisation_id
          AND learner_membership.user_id =
              evidence_records.learner_id
          AND learner_membership.is_active = true
    )

    AND EXISTS (
        SELECT 1
        FROM nabuuma.practice_sessions ps
        WHERE ps.id = evidence_records.practice_session_id
          AND ps.organisation_id =
              evidence_records.organisation_id
          AND ps.learner_id =
              evidence_records.learner_id
    )
);

COMMIT;
