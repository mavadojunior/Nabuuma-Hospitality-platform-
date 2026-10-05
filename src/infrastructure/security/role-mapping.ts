import type { SecurityRole } from "./security";

export type PersistenceActorRole =
  | "LEARNER"
  | "PROFESSIONAL"
  | "ASSESSOR"
  | "MANAGER"
  | "CONTENT_EDITOR"
  | "ORGANISATION_OWNER"
  | "PLATFORM_ADMIN";

/**
 * Maps application authorization roles to the canonical
 * persistence-layer membership roles.
 *
 * The persistence vocabulary remains unchanged.
 */
export function toPersistenceActorRoles(
  roles: readonly SecurityRole[],
): PersistenceActorRole[] {
  const mapped = new Set<PersistenceActorRole>();

  for (const role of roles) {
    switch (role) {
      case "LEARNER":
        mapped.add("LEARNER");
        break;

      case "PROFESSIONAL":
        mapped.add("PROFESSIONAL");
        break;

      case "TRAINER":
        mapped.add("ASSESSOR");
        break;

      case "ORGANISATION_MANAGER":
        mapped.add("MANAGER");
        break;

      case "ORGANISATION_OWNER":
        mapped.add("ORGANISATION_OWNER");
        break;

      case "PLATFORM_ADMIN":
        mapped.add("PLATFORM_ADMIN");
        break;
    }
  }

  return [...mapped];
}
