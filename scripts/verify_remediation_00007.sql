\set ON_ERROR_STOP on

\echo '=== Phase 2: least-privilege remediation verification ==='
\echo 'Target database: nabuuma_rls_test'
\echo 'Read-only checks only; no schema or privilege changes.'

BEGIN READ ONLY;

WITH targets(table_name) AS (
    VALUES
        ('assessments'),
        ('evidence_records'),
        ('telemetry_observations')
),
observed AS (
    SELECT
        t.table_name,
        c.oid IS NOT NULL AS table_exists,
        COALESCE(c.relrowsecurity, false) AS rls_enabled,
        COALESCE(c.relforcerowsecurity, false) AS force_rls,
        CASE WHEN c.oid IS NOT NULL
             THEN has_table_privilege('nabuuma_app', c.oid, 'UPDATE')
             ELSE true
        END AS app_can_update,
        CASE WHEN c.oid IS NOT NULL
             THEN has_table_privilege('nabuuma_app', c.oid, 'DELETE')
             ELSE true
        END AS app_can_delete
    FROM targets t
    LEFT JOIN pg_namespace n ON n.nspname = 'nabuuma'
    LEFT JOIN pg_class c
      ON c.relnamespace = n.oid
     AND c.relname = t.table_name
     AND c.relkind IN ('r', 'p')
),
checks AS (
    SELECT table_name, 'table_exists' AS check_name,
           table_exists AS passed FROM observed
    UNION ALL
    SELECT table_name, 'rls_enabled',
           rls_enabled FROM observed
    UNION ALL
    SELECT table_name, 'force_rls',
           force_rls FROM observed
    UNION ALL
    SELECT table_name, 'app_update_revoked',
           NOT app_can_update FROM observed
    UNION ALL
    SELECT table_name, 'app_delete_revoked',
           NOT app_can_delete FROM observed
)
SELECT
    table_name,
    check_name,
    CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks
ORDER BY table_name, check_name;

ROLLBACK;

\echo '=== End of read-only verification ==='
