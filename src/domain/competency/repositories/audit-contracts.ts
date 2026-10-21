export type AuditOutcome = "SUCCESS" | "FAILURE";

export interface AuditEvent {
readonly id: string;
readonly organisationId: string;
readonly actorUserId: string;
readonly action: string;
readonly entityType: string;
readonly entityId: string;
readonly occurredAt: string;
readonly correlationId: string;
readonly outcome: AuditOutcome;
readonly metadata: Readonly<Record<string, unknown>>;
}

export interface NewAuditEvent {
readonly organisationId: string;
readonly actorUserId: string;
readonly action: string;
readonly entityType: string;
readonly entityId: string;
readonly correlationId: string;
readonly outcome: AuditOutcome;
readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditRepository {
append(event: NewAuditEvent): Promise<AuditEvent>;
}
