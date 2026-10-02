# Integration contract

This slice assumes the Step 3–4 source tree is present in the same modular monolith and that:

- `src/infrastructure/security/security.ts` exports `TokenClaims`.
- Existing repository contracts remain the persistence boundary.
- Existing `CompetencyTransitionEngine` remains responsible for the final authorized verification path.

The new scenario repository, lab-session journal and telemetry append ports are intentionally small. Infrastructure adapters can implement them using the existing PostgreSQL repositories without changing the scenario domain.
