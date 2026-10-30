BEGIN;

ALTER TABLE nabuuma.users
    ADD COLUMN auth_subject UUID;

CREATE UNIQUE INDEX uq_users_auth_subject
    ON nabuuma.users(auth_subject)
    WHERE auth_subject IS NOT NULL;

COMMENT ON COLUMN nabuuma.users.auth_subject IS
'Immutable external identity-provider subject used to resolve authenticated users.';

COMMIT;
