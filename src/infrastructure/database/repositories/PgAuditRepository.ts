import type { UUID } from "../../../domain/competency/repositories/contracts";
import { TenantBoundaryViolationError } from "../../../domain/competency/errors";
import type { PgExecutionContext } from "../transaction";
import { mapPgError } from "../error-mapping";

/**
 * Audit event entity stored in nabuuma.audit_events.
 * Represents a single business action taken by a user in an organisation.
 */
export interface AuditEvent {
  id: UUID;
  organisationId: UUID;
  actorUserId: UUID;
  action: string;
  entityType: string;
  entityId: UUID | null;
  occurredAt: string; // ISO 8601
  correlationId: UUID | null;
  outcome: string;
  metadata: Record<string, unknown>;
}

/**
 * Input for creating an audit event (omits generated fields).
 */
export interface CreateAuditEventInput {
  organisationId: UUID;
  actorUserId: UUID;
  action: string;
  entityType: string;
  entityId?: UUID | null;
  correlationId?: UUID | null;
  outcome: string;
  metadata?: Record<string, unknown>;
}

interface AuditEventRow {
  id: string;
  organisation_id: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  occurred_at: Date | string;
  correlation_id: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
}

function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    occurredAt:
      row.occurred_at instanceof Date
        ? row.occurred_at.toISOString()
        : row.occurred_at,
    correlationId: row.correlation_id,
    outcome: row.outcome,
    metadata: row.metadata ?? {},
  };
}

/**
 * PostgreSQL repository for append-only audit event recording.
 *
 * Design principles:
 * - Audit events are immutable after creation.
 * - Tenant ownership is enforced at the database boundary via RLS.
 * - The authenticated actor (actorUserId) must match the transaction context.
 * - All fields are queryable for compliance, investigation, and analytics.
 * - Append-only intent: no UPDATE or DELETE operations supported.
 */
export class PgAuditRepository {
  constructor(private readonly context: PgExecutionContext) {}

  /**
   * Record a new audit event.
   *
   * Enforces:
   * - Audit organisation matches the active tenant context.
   * - Actor user ID matches the authenticated database user.
   * - RLS policies on nabuuma.audit_events further restrict visibility.
   *
   * @param input Audit event to record
   * @returns The persisted audit event with generated ID and timestamp
   * @throws TenantBoundaryViolationError if organisation or actor does not match context
   */
  async record(input: CreateAuditEventInput): Promise<AuditEvent> {
    // Enforce tenant boundary: audit event organisation must match active context
    if (input.organisationId !== this.context.organisationId) {
      throw new TenantBoundaryViolationError(
        "Audit event organisation must match the active tenant context.",
      );
    }

    // Enforce actor boundary: actor must match the authenticated database user
    if (input.actorUserId !== this.context.claims.subject) {
      throw new TenantBoundaryViolationError(
        "Audit event actor must match the authenticated database user.",
      );
    }

    try {
      const result = await this.context.client.query<AuditEventRow>(
        `
          INSERT INTO nabuuma.audit_events (
            organisation_id,
            actor_user_id,
            action,
            entity_type,
            entity_id,
            correlation_id,
            outcome,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
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
          input.organisationId,
          input.actorUserId,
          input.action,
          input.entityType,
          input.entityId ?? null,
          input.correlationId ?? null,
          input.outcome,
          JSON.stringify(input.metadata ?? {}),
        ],
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error("Audit event insertion did not return a row.");
      }

      return mapAuditEvent(row);
    } catch (error) {
      if (error instanceof TenantBoundaryViolationError) throw error;
      throw mapPgError(error, "audit");
    }
  }

  /**
   * Query audit events for the current organisation and actor.
   *
   * Limited to:
   * - Active tenant (enforced by RLS policy)
   * - Events where the authenticated actor is a member (enforced by RLS policy)
   *
   * @param filters Optional filters for action, entity_type, outcome
   * @param limit Maximum number of events to return (default 100, max 1000)
   * @param offset Number of events to skip (default 0)
   * @returns Audit events matching the filters
   */
  async list(options?: {
    action?: string;
    entityType?: string;
    outcome?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuditEvent[]> {
    const limit = Math.min(options?.limit ?? 100, 1000);
    const offset = options?.offset ?? 0;

    let query = `
      SELECT
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
      FROM nabuuma.audit_events
      WHERE organisation_id = $1
    `;

    const params: unknown[] = [this.context.organisationId];
    let paramIndex = 2;

    if (options?.action) {
      query += ` AND action = $${paramIndex}`;
      params.push(options.action);
      paramIndex++;
    }

    if (options?.entityType) {
      query += ` AND entity_type = $${paramIndex}`;
      params.push(options.entityType);
      paramIndex++;
    }

    if (options?.outcome) {
      query += ` AND outcome = $${paramIndex}`;
      params.push(options.outcome);
      paramIndex++;
    }

    query += ` ORDER BY occurred_at DESC, id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    try {
      const result = await this.context.client.query<AuditEventRow>(query, params);
      return result.rows.map(mapAuditEvent);
    } catch (error) {
      throw mapPgError(error, "audit");
    }
  }

  /**
   * Query audit events for a specific entity.
   *
   * @param entityType Type of entity (e.g., 'learner_competency', 'practice_session')
   * @param entityId UUID of the entity
   * @param limit Maximum number of events to return (default 50, max 500)
   * @returns Audit events for the entity, ordered by most recent first
   */
  async findForEntity(
    entityType: string,
    entityId: UUID,
    limit?: number,
  ): Promise<AuditEvent[]> {
    const maxLimit = Math.min(limit ?? 50, 500);

    try {
      const result = await this.context.client.query<AuditEventRow>(
        `
          SELECT
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
          FROM nabuuma.audit_events
          WHERE organisation_id = $1
            AND entity_type = $2
            AND entity_id = $3
          ORDER BY occurred_at DESC, id DESC
          LIMIT $4
        `,
        [this.context.organisationId, entityType, entityId, maxLimit],
      );

      return result.rows.map(mapAuditEvent);
    } catch (error) {
      throw mapPgError(error, "audit");
    }
  }

  /**
   * Query audit events by correlation ID (for distributed request tracing).
   *
   * @param correlationId UUID correlating related events across services
   * @returns All audit events with this correlation ID in the current organisation
   */
  async findByCorrelationId(correlationId: UUID): Promise<AuditEvent[]> {
    try {
      const result = await this.context.client.query<AuditEventRow>(
        `
          SELECT
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
          FROM nabuuma.audit_events
          WHERE organisation_id = $1
            AND correlation_id = $2
          ORDER BY occurred_at ASC, id ASC
        `,
        [this.context.organisationId, correlationId],
      );

      return result.rows.map(mapAuditEvent);
    } catch (error) {
      throw mapPgError(error, "audit");
    }
  }
}
