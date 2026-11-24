/**
 * Nabuuma API Post-Login Action.
 * Emits assigned Auth0 roles as a namespaced access-token claim.
 * Organisation and membership authority remains PostgreSQL.
 */
exports.onExecutePostLogin = async (event, api) => {
  const assignedRoles = event.authorization && event.authorization.roles;
  if (Array.isArray(assignedRoles)) {
    api.accessToken.setCustomClaim(
      "https://api.nabuuma.com/roles",
      assignedRoles,
    );
  }
};
