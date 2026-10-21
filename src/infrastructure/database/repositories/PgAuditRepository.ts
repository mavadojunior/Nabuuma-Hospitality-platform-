import type { AuditEvent, NewAuditEvent } from "../../../domain/competency/repositories/audit-contracts";
import {
  DomainConstraintError,
  TenantBoundaryViolationError,
} from "../../../domain/competency/errors";
import { mapPgError } from "../error-mapping";
import type { PgExecutionContext } from "../transaction";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AuditEventRow {
  id: string;
  organisation_id: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  occurred_at: Date | string;
  correlation_id: string;
  outcome: "SUCCESS" | "FAILURE";
  metadata: Record<string, unknown>;
}

function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    correlationId: row.correlation_id,
    outcome: row.outcome,
    metadata: row.metadata,
  };
}

/**
 * Appends audit events using the caller's existing transaction.
 * The database transaction manager remains responsible for commit/rollback.
 */
export class PgAuditRepository {
  constructor(private readonly context: PgExecutionContext) {}

  async append(event: NewAuditEvent): Promise<AuditEvent> {
    const security = this.context.security;

    if (
      event.organisationId !== this.context.organisationId ||
      event.organisationId !== security.organisationId ||
      event.actorUserId !== security.userId ||
      event.correlationId !== security.correlationId
    ) {
      throw new TenantBoundaryViolationError(
        "Audit event identity does not match the verified execution context.",
      );
    }

    if (!UUID_PATTERN.test(event.correlationId)) {
      throw new DomainConstraintError(
        "Audit correlation ID must be a UUID.",
      );
    }

    let result;
    try {
      result = await this.context.client.query<AuditEventRow>(
      `
        INSERT INTO nabuuma.audit_events (
          id,
          organisation_id,
          actor_user_id,
          action,
          entity_type,
          entity_id,
          correlation_id,
          outcome,
          metadata
        )
        VALUES (
          gen_random_uuid(),
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5::uuid,
          $6::uuid,
          $7,
          $8::jsonb
        )
        RETURNING
          id,
          organisation_id,
          actor_user_id,
          action,
          entity_type,
          entity_id,
          occurred_at,
          correlation_id,
          outcome,
          metadata
      `,
      [
        event.organisationId,
        event.actorUserId,
        event.action,
        event.entityType,
        event.entityId,
        event.correlationId,
        event.outcome,
        JSON.stringify(event.metadata ?? {}),
      ],
      );
    } catch (error) {
      throw mapPgError(error, "audit");
    }

    const row = result.rows[0];

    if (!row) {
      throw new Error("Audit event insert returned no row.");
    }

    return toAuditEvent(row);
  }
}
