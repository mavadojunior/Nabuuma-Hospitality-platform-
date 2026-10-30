BEGIN;

CREATE OR REPLACE FUNCTION nabuuma.custom_access_token_hook(
    event JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_auth_subject UUID;
    v_user_id UUID;
    v_organisation_id UUID;
    v_role TEXT;
    v_membership_count BIGINT;
    v_claims JSONB;
BEGIN
    BEGIN
        v_auth_subject := (event ->> 'user_id')::UUID;
    EXCEPTION
        WHEN invalid_text_representation THEN
            RAISE EXCEPTION
                'Invalid authentication subject'
                USING ERRCODE = '22023';
    END;

    IF v_auth_subject IS NULL THEN
        RAISE EXCEPTION
            'Authentication subject is required'
            USING ERRCODE = '22023';
    END IF;

    SELECT u.id
    INTO v_user_id
    FROM nabuuma.users AS u
    WHERE u.auth_subject = v_auth_subject;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION
            'Authentication subject is not provisioned'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*)
    INTO v_membership_count
    FROM nabuuma.organisation_memberships AS m
    WHERE m.user_id = v_user_id
      AND m.is_active = true;

    IF v_membership_count = 0 THEN
        RAISE EXCEPTION
            'Authenticated user has no active organisation'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_membership_count <> 1 THEN
        RAISE EXCEPTION
            'Authenticated user has ambiguous active organisations'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT
        m.organisation_id,
        m.role::TEXT
    INTO STRICT
        v_organisation_id,
        v_role
    FROM nabuuma.organisation_memberships AS m
    WHERE m.user_id = v_user_id
      AND m.is_active = true;

    v_role :=
        CASE v_role
            WHEN 'LEARNER' THEN 'LEARNER'
            WHEN 'PROFESSIONAL' THEN 'PROFESSIONAL'
            WHEN 'ASSESSOR' THEN 'TRAINER'
            WHEN 'MANAGER' THEN 'ORGANISATION_MANAGER'
            WHEN 'ORGANISATION_OWNER' THEN 'ORGANISATION_OWNER'
            WHEN 'PLATFORM_ADMIN' THEN 'PLATFORM_ADMIN'
            ELSE NULL
        END;

    IF v_role IS NULL THEN
        RAISE EXCEPTION
            'Active organisation role cannot be represented in access token'
            USING ERRCODE = '42501';
    END IF;

    v_claims := event -> 'claims';

    IF v_claims IS NULL OR
       jsonb_typeof(v_claims) <> 'object'
    THEN
        RAISE EXCEPTION
            'Authentication claims are invalid'
            USING ERRCODE = '22023';
    END IF;

    v_claims := jsonb_set(
        v_claims,
        '{organisation_id}',
        to_jsonb(v_organisation_id::TEXT),
        true
    );

    v_claims := jsonb_set(
        v_claims,
        '{roles}',
        jsonb_build_array(v_role),
        true
    );

    RETURN jsonb_build_object(
        'claims',
        v_claims
    );
END;
$$;

REVOKE ALL
ON FUNCTION nabuuma.custom_access_token_hook(JSONB)
FROM PUBLIC;

COMMIT;
