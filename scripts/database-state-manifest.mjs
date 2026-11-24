#!/usr/bin/env node

import fs from "node:fs/promises";
import pg from "pg";

const databaseUrl =
  process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL required");
  process.exit(2);
}

const parsed =
  new URL(databaseUrl);

if (
  ![
    "postgres:",
    "postgresql:",
  ].includes(parsed.protocol)
) {
  console.error(
    "DATABASE_URL must use PostgreSQL.",
  );
  process.exit(2);
}

if (
  parsed.hostname === "127.0.0.1" &&
  parsed.port === "55433"
) {
  console.error(
    "Manifest generation refuses protected port 55433.",
  );
  process.exit(2);
}

const client =
  new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 8000,
    statement_timeout: 30000,
  });

function quoteIdentifier(value) {
  return `"${String(value)
    .replaceAll('"', '""')}"`;
}

async function query(text) {
  const result =
    await client.query(text);

  return result.rows;
}

try {
  await client.connect();

  await client.query(
    "BEGIN READ ONLY",
  );

  const database =
    (
      await client.query(
        "SELECT current_database() AS name",
      )
    ).rows[0]?.name;

  const relations =
    await query(`
      SELECT
        namespace.nspname
          AS schema_name,
        relation.relname
          AS relation_name,
        relation.relkind,
        pg_catalog.pg_get_userbyid(
          relation.relowner
        ) AS owner,
        relation.relrowsecurity
          AS rls,
        relation.relforcerowsecurity
          AS force_rls,
        pg_catalog.pg_get_expr(
          relation.relpartbound,
          relation.oid
        ) AS partition_bound,
        CASE
          WHEN relation.relkind = 'p'
          THEN pg_catalog.pg_get_partkeydef(
            relation.oid
          )
          ELSE NULL
        END AS partition_key
      FROM pg_catalog.pg_class
        AS relation
      JOIN pg_catalog.pg_namespace
        AS namespace
        ON namespace.oid =
           relation.relnamespace
      WHERE namespace.nspname =
        'nabuuma'
        AND relation.relkind IN (
          'r',
          'p'
        )
      ORDER BY
        namespace.nspname,
        relation.relname
    `);

  const data = [];

  for (const relation of relations) {
    const qualified =
      `${quoteIdentifier(
        relation.schema_name,
      )}.${quoteIdentifier(
        relation.relation_name,
      )}`;

    const result =
      await client.query(`
        SELECT
          count(*)::text AS row_count,
          md5(
            coalesce(
              string_agg(
                to_jsonb(row_value)::text,
                E'\\n'
                ORDER BY
                  to_jsonb(
                    row_value
                  )::text
              ),
              ''
            )
          ) AS data_digest
        FROM ${qualified}
          AS row_value
      `);

    data.push({
      ...relation,
      row_count:
        result.rows[0].row_count,
      data_digest:
        result.rows[0].data_digest,
    });
  }

  const columns =
    await query(`
      SELECT
        namespace.nspname
          AS schema_name,
        relation.relname
          AS relation_name,
        attribute.attnum,
        attribute.attname
          AS column_name,
        pg_catalog.format_type(
          attribute.atttypid,
          attribute.atttypmod
        ) AS data_type,
        attribute.attnotnull
          AS not_null,
        pg_catalog.pg_get_expr(
          default_value.adbin,
          default_value.adrelid
        ) AS default_expression,
        attribute.attidentity
          AS identity_kind,
        attribute.attgenerated
          AS generated_kind
      FROM pg_catalog.pg_attribute
        AS attribute
      JOIN pg_catalog.pg_class
        AS relation
        ON relation.oid =
           attribute.attrelid
      JOIN pg_catalog.pg_namespace
        AS namespace
        ON namespace.oid =
           relation.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef
        AS default_value
        ON default_value.adrelid =
           attribute.attrelid
       AND default_value.adnum =
           attribute.attnum
      WHERE namespace.nspname =
        'nabuuma'
        AND relation.relkind IN (
          'r',
          'p'
        )
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
      ORDER BY
        namespace.nspname,
        relation.relname,
        attribute.attnum
    `);

  const constraints =
    await query(`
      SELECT
        namespace.nspname
          AS schema_name,
        relation.relname
          AS relation_name,
        constraint_value.conname
          AS constraint_name,
        constraint_value.contype
          AS constraint_type,
        pg_catalog.pg_get_constraintdef(
          constraint_value.oid,
          true
        ) AS definition,
        constraint_value.convalidated
          AS validated,
        constraint_value.condeferrable
          AS deferrable,
        constraint_value.condeferred
          AS initially_deferred
      FROM pg_catalog.pg_constraint
        AS constraint_value
      JOIN pg_catalog.pg_class
        AS relation
        ON relation.oid =
           constraint_value.conrelid
      JOIN pg_catalog.pg_namespace
        AS namespace
        ON namespace.oid =
           relation.relnamespace
      WHERE namespace.nspname =
        'nabuuma'
      ORDER BY
        namespace.nspname,
        relation.relname,
        constraint_value.conname
    `);

  const indexes =
    await query(`
      SELECT
        namespace.nspname
          AS schema_name,
        table_relation.relname
          AS relation_name,
        index_relation.relname
          AS index_name,
        pg_catalog.pg_get_indexdef(
          index_relation.oid
        ) AS definition,
        index_value.indisunique
          AS is_unique,
        index_value.indisprimary
          AS is_primary,
        index_value.indisvalid
          AS is_valid,
        index_value.indisready
          AS is_ready
      FROM pg_catalog.pg_index
        AS index_value
      JOIN pg_catalog.pg_class
        AS table_relation
        ON table_relation.oid =
           index_value.indrelid
      JOIN pg_catalog.pg_class
        AS index_relation
        ON index_relation.oid =
           index_value.indexrelid
      JOIN pg_catalog.pg_namespace
        AS namespace
        ON namespace.oid =
           table_relation.relnamespace
      WHERE namespace.nspname =
        'nabuuma'
      ORDER BY
        namespace.nspname,
        table_relation.relname,
        index_relation.relname
    `);

  const policies =
    await query(`
      SELECT
        schemaname,
        tablename,
        policyname,
        permissive,
        roles,
        cmd,
        qual,
        with_check
      FROM pg_catalog.pg_policies
      WHERE schemaname =
        'nabuuma'
      ORDER BY
        schemaname,
        tablename,
        policyname
    `);

  const triggers =
    await query(`
      SELECT
        namespace.nspname
          AS schema_name,
        relation.relname
          AS relation_name,
        trigger_value.tgname
          AS trigger_name,
        trigger_value.tgenabled
          AS enabled,
        pg_catalog.pg_get_triggerdef(
          trigger_value.oid,
          true
        ) AS definition
      FROM pg_catalog.pg_trigger
        AS trigger_value
      JOIN pg_catalog.pg_class
        AS relation
        ON relation.oid =
           trigger_value.tgrelid
      JOIN pg_catalog.pg_namespace
        AS namespace
        ON namespace.oid =
           relation.relnamespace
      WHERE namespace.nspname =
        'nabuuma'
        AND NOT trigger_value.tgisinternal
      ORDER BY
        namespace.nspname,
        relation.relname,
        trigger_value.tgname
    `);

  const functions =
    await query(`
      SELECT
        namespace.nspname
          AS schema_name,
        routine.proname,
        routine.oid::regprocedure::text
          AS signature,
        pg_catalog.pg_get_userbyid(
          routine.proowner
        ) AS owner,
        routine.prosecdef
          AS security_definer,
        routine.proconfig,
        md5(
          pg_catalog.pg_get_functiondef(
            routine.oid
          )
        ) AS definition_digest
      FROM pg_catalog.pg_proc
        AS routine
      JOIN pg_catalog.pg_namespace
        AS namespace
        ON namespace.oid =
           routine.pronamespace
      WHERE namespace.nspname =
        'nabuuma'
      ORDER BY
        routine.oid::regprocedure::text
    `);

  const sequences =
    await query(`
      SELECT
        namespace.nspname
          AS schema_name,
        relation.relname
          AS sequence_name,
        pg_catalog.pg_get_userbyid(
          relation.relowner
        ) AS owner
      FROM pg_catalog.pg_class
        AS relation
      JOIN pg_catalog.pg_namespace
        AS namespace
        ON namespace.oid =
           relation.relnamespace
      WHERE namespace.nspname =
        'nabuuma'
        AND relation.relkind =
          'S'
      ORDER BY
        namespace.nspname,
        relation.relname
    `);

  const relationAcl =
    await query(`
      SELECT
        namespace.nspname
          AS schema_name,
        relation.relname
          AS object_name,
        relation.relkind
          AS object_kind,
        pg_catalog.pg_get_userbyid(
          acl.grantor
        ) AS grantor,
        CASE
          WHEN acl.grantee = 0
          THEN 'PUBLIC'
          ELSE pg_catalog.pg_get_userbyid(
            acl.grantee
          )
        END AS grantee,
        acl.privilege_type,
        acl.is_grantable
      FROM pg_catalog.pg_class
        AS relation
      JOIN pg_catalog.pg_namespace
        AS namespace
        ON namespace.oid =
           relation.relnamespace
      CROSS JOIN LATERAL
        pg_catalog.aclexplode(
          coalesce(
            relation.relacl,
            pg_catalog.acldefault(
              CASE
                WHEN relation.relkind =
                  'S'
                THEN 'S'::"char"
                ELSE 'r'::"char"
              END,
              relation.relowner
            )
          )
        ) AS acl
      WHERE namespace.nspname =
        'nabuuma'
        AND relation.relkind IN (
          'r',
          'p',
          'S'
        )
      ORDER BY
        namespace.nspname,
        relation.relname,
        grantor,
        grantee,
        acl.privilege_type,
        acl.is_grantable
    `);

  const routineAcl =
    await query(`
      SELECT
        namespace.nspname
          AS schema_name,
        routine.oid::regprocedure::text
          AS object_name,
        pg_catalog.pg_get_userbyid(
          acl.grantor
        ) AS grantor,
        CASE
          WHEN acl.grantee = 0
          THEN 'PUBLIC'
          ELSE pg_catalog.pg_get_userbyid(
            acl.grantee
          )
        END AS grantee,
        acl.privilege_type,
        acl.is_grantable
      FROM pg_catalog.pg_proc
        AS routine
      JOIN pg_catalog.pg_namespace
        AS namespace
        ON namespace.oid =
           routine.pronamespace
      CROSS JOIN LATERAL
        pg_catalog.aclexplode(
          coalesce(
            routine.proacl,
            pg_catalog.acldefault(
              'f'::"char",
              routine.proowner
            )
          )
        ) AS acl
      WHERE namespace.nspname =
        'nabuuma'
      ORDER BY
        namespace.nspname,
        routine.oid::regprocedure::text,
        grantor,
        grantee,
        acl.privilege_type,
        acl.is_grantable
    `);

  const schemaAcl =
    await query(`
      SELECT
        namespace.nspname
          AS schema_name,
        pg_catalog.pg_get_userbyid(
          acl.grantor
        ) AS grantor,
        CASE
          WHEN acl.grantee = 0
          THEN 'PUBLIC'
          ELSE pg_catalog.pg_get_userbyid(
            acl.grantee
          )
        END AS grantee,
        acl.privilege_type,
        acl.is_grantable
      FROM pg_catalog.pg_namespace
        AS namespace
      CROSS JOIN LATERAL
        pg_catalog.aclexplode(
          coalesce(
            namespace.nspacl,
            pg_catalog.acldefault(
              'n'::"char",
              namespace.nspowner
            )
          )
        ) AS acl
      WHERE namespace.nspname =
        'nabuuma'
      ORDER BY
        namespace.nspname,
        grantor,
        grantee,
        acl.privilege_type,
        acl.is_grantable
    `);

  const roleContract =
    await query(`
      SELECT
        role_value.rolname,
        role_value.rolcanlogin,
        role_value.rolsuper,
        role_value.rolinherit,
        role_value.rolcreaterole,
        role_value.rolcreatedb,
        role_value.rolreplication,
        role_value.rolbypassrls
      FROM pg_catalog.pg_roles
        AS role_value
      WHERE role_value.rolname LIKE
        'nabuuma_%'
      ORDER BY role_value.rolname
    `);

  const roleMemberships =
    await query(`
      SELECT
        member_value.rolname
          AS member,
        granted_value.rolname
          AS granted_role,
        membership.admin_option,
        membership.inherit_option,
        membership.set_option
      FROM pg_catalog.pg_auth_members
        AS membership
      JOIN pg_catalog.pg_roles
        AS granted_value
        ON granted_value.oid =
           membership.roleid
      JOIN pg_catalog.pg_roles
        AS member_value
        ON member_value.oid =
           membership.member
      WHERE member_value.rolname LIKE
              'nabuuma_%'
         OR granted_value.rolname LIKE
              'nabuuma_%'
      ORDER BY
        member,
        granted_role,
        membership.admin_option,
        membership.inherit_option,
        membership.set_option
    `);

  const manifest = {
    manifest_version: 2,
    created_at:
      new Date().toISOString(),
    database,
    relations: data,
    columns,
    constraints,
    indexes,
    policies,
    triggers,
    functions,
    sequences,
    relation_acl: relationAcl,
    routine_acl: routineAcl,
    schema_acl: schemaAcl,
    role_contract: roleContract,
    role_memberships: roleMemberships,
  };

  const json =
    JSON.stringify(
      manifest,
      null,
      2,
    );

  if (process.env.MANIFEST_FILE) {
    await fs.writeFile(
      process.env.MANIFEST_FILE,
      `${json}\n`,
      {
        flag: "wx",
        mode: 0o600,
      },
    );
  }

  console.log(json);

  await client.query("ROLLBACK");
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : String(error),
  );

  process.exitCode = 1;

  try {
    await client.query("ROLLBACK");
  } catch {
    // Ignore rollback failure during error handling.
  }
} finally {
  await client.end().catch(
    () => {},
  );
}
