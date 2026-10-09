BEGIN;

SET LOCAL search_path = nabuuma, public;

-- ============================================================================
-- Migration: 00005_create_audit_events_ledger.sql
-- Purpose:
--   Create the append-only audit ledger used to record tenant-scoped business
--   events and user actions for later review and investigation.
--
-- NOTE:
--   This file matches the authoritative schema already present in the validated
--   local nabuuma_test database. The DB schema is treated as canonical because it
--   has already been applied and verified in the live test environment.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nabuuma.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL
        REFERENCES nabuuma.organisations(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL
        REFERENCES nabuuma.users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    correlation_id UUID,
    outcome TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_events_org_time
    ON nabuuma.audit_events (organisation_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_time
    ON nabuuma.audit_events (actor_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_entity
    ON nabuuma.audit_events (entity_type, entity_id);

ALTER TABLE nabuuma.audit_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT
    ON TABLE nabuuma.audit_events
    TO nabuuma_app;

CREATE POLICY tenant_audit_events_select
ON nabuuma.audit_events
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);

CREATE POLICY tenant_audit_events_insert
ON nabuuma.audit_events
FOR INSERT
TO nabuuma_app
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()
    AND actor_user_id = nabuuma.current_app_user_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);

COMMIT;
