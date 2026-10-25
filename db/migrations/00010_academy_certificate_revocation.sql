BEGIN;

SET LOCAL search_path = pg_catalog;

ALTER TABLE nabuuma.academy_certificates
    ADD CONSTRAINT uq_academy_certificates_org_id
    UNIQUE (organisation_id, id);

CREATE TABLE nabuuma.academy_certificate_revocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL,
    certificate_id UUID NOT NULL,
    revoked_by_id UUID NOT NULL
        REFERENCES nabuuma.users(id)
        ON DELETE RESTRICT,
    reason TEXT NOT NULL
        CHECK (
            length(btrim(reason)) BETWEEN 1 AND 1000
        ),
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (
        organisation_id,
        certificate_id
    )
        REFERENCES nabuuma.academy_certificates(
            organisation_id,
            id
        )
        ON DELETE RESTRICT,

    UNIQUE (certificate_id)
);

CREATE INDEX idx_academy_certificate_revocations_org_time
    ON nabuuma.academy_certificate_revocations(
        organisation_id,
        revoked_at DESC
    );

ALTER TABLE nabuuma.academy_certificate_revocations
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.academy_certificate_revocations
    FORCE ROW LEVEL SECURITY;

CREATE FUNCTION nabuuma.prevent_certificate_revocation_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
    RAISE EXCEPTION
        'Certificate revocations are append-only';
END;
$function$;

REVOKE ALL
ON FUNCTION nabuuma.prevent_certificate_revocation_mutation()
FROM PUBLIC;

CREATE TRIGGER trg_certificate_revocations_immutable
BEFORE UPDATE OR DELETE
ON nabuuma.academy_certificate_revocations
FOR EACH ROW
EXECUTE FUNCTION nabuuma.prevent_certificate_revocation_mutation();

CREATE FUNCTION nabuuma.revoke_academy_certificate(
    p_certificate_number TEXT,
    p_reason TEXT
)
RETURNS TABLE (
    certificate_number TEXT,
    revoked_at TIMESTAMPTZ,
    newly_revoked BOOLEAN
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    actor_id UUID;
    tenant_id UUID;
    target_certificate_id UUID;
    target_learner_id UUID;
    inserted_at TIMESTAMPTZ;
BEGIN
    actor_id := nabuuma.current_app_user_id();
    tenant_id := nabuuma.current_app_organisation_id();

    IF actor_id IS NULL OR tenant_id IS NULL THEN
        RAISE EXCEPTION
            'Application actor and organisation context are required'
            USING ERRCODE = '42501';
    END IF;

    IF p_certificate_number IS NULL
       OR length(btrim(p_certificate_number)) = 0 THEN
        RAISE EXCEPTION
            'Certificate number is required'
            USING ERRCODE = '22023';
    END IF;

    IF p_reason IS NULL
       OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION
            'Revocation reason must contain 1 to 1000 characters'
            USING ERRCODE = '22023';
    END IF;

    SELECT
        certificate.id,
        certificate.learner_id
    INTO
        target_certificate_id,
        target_learner_id
    FROM nabuuma.academy_certificates AS certificate
    WHERE certificate.organisation_id = tenant_id
      AND certificate.certificate_number =
          p_certificate_number;

    IF target_certificate_id IS NULL THEN
        RAISE EXCEPTION
            'Certificate not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT nabuuma.is_authorized_assessor(
        tenant_id,
        actor_id,
        target_learner_id
    ) THEN
        RAISE EXCEPTION
            'Actor is not authorised to revoke certificates'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO nabuuma.academy_certificate_revocations AS revocation (
        organisation_id,
        certificate_id,
        revoked_by_id,
        reason
    )
    VALUES (
        tenant_id,
        target_certificate_id,
        actor_id,
        btrim(p_reason)
    )
    ON CONFLICT (certificate_id)
    DO NOTHING
    RETURNING revocation.revoked_at
    INTO inserted_at;

    RETURN QUERY
    SELECT
        p_certificate_number,
        revocation.revoked_at,
        inserted_at IS NOT NULL
    FROM nabuuma.academy_certificate_revocations
        AS revocation
    WHERE revocation.certificate_id =
        target_certificate_id;
END;
$function$;

REVOKE ALL
ON FUNCTION nabuuma.revoke_academy_certificate(TEXT, TEXT)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION nabuuma.revoke_academy_certificate(TEXT, TEXT)
TO nabuuma_app;

REVOKE ALL
ON TABLE nabuuma.academy_certificate_revocations
FROM PUBLIC;

REVOKE ALL
ON TABLE nabuuma.academy_certificate_revocations
FROM nabuuma_app;

DROP FUNCTION nabuuma.verify_academy_certificate(TEXT);

CREATE FUNCTION nabuuma.verify_academy_certificate(
    p_certificate_number TEXT
)
RETURNS TABLE (
    valid BOOLEAN,
    status TEXT,
    certificate_number TEXT,
    issued_at TIMESTAMPTZ,
    course_title TEXT,
    revoked_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT
        revocation.id IS NULL AS valid,
        CASE
            WHEN revocation.id IS NULL THEN 'VALID'
            ELSE 'REVOKED'
        END AS status,
        certificate.certificate_number,
        certificate.issued_at,
        course.title AS course_title,
        revocation.revoked_at
    FROM nabuuma.academy_certificates AS certificate
    INNER JOIN nabuuma.academy_courses AS course
        ON course.organisation_id =
            certificate.organisation_id
       AND course.id = certificate.course_id
    LEFT JOIN nabuuma.academy_certificate_revocations
        AS revocation
        ON revocation.organisation_id =
            certificate.organisation_id
       AND revocation.certificate_id =
            certificate.id
    WHERE certificate.certificate_number =
        p_certificate_number
    LIMIT 1
$function$;

REVOKE ALL
ON FUNCTION nabuuma.verify_academy_certificate(TEXT)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION nabuuma.verify_academy_certificate(TEXT)
FROM nabuuma_app;

GRANT EXECUTE
ON FUNCTION nabuuma.verify_academy_certificate(TEXT)
TO nabuuma_certificate_verifier;

COMMIT;
