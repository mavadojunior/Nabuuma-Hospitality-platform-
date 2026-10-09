BEGIN;

SET LOCAL search_path = nabuuma, public;

-- ============================================================================
-- Migration: 00005_create_audit_events_ledger.sql
-- Purpose:
--   Create the append-only audit ledger used to record tenant-scoped business
--   events and user actions for later review, investigation, and compliance.
--
-- The ledger is intentionally append-only at the database boundary: no UPDATE or
-- DELETE policies are created here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nabuuma.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL
        REFERENCES nabuuma.organisations(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL
        REFERENCES nabuuma.users(id) ON DELETE RESTRICT,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    action TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_org_time
    ON nabuuma.audit_events (organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_time
    ON nabuuma.audit_events (actor_user_id, created_at DESC);

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
