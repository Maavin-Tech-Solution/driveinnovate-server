// Centralised vehicle-visibility scope.
//
// Returns a Sequelize where-fragment limiting Vehicle rows to what `user` may see:
//   • account (papa/dealer/client) → { clientId: [self,...descendants] }  (ownership)
//   • member  (team-member login)  → { id: [assigned vehicle ids] }       (team scope)
//
// ⚠️ EVERY vehicle-scoped endpoint must derive its WHERE from this — most importantly
// the fleet list (getVehicles) AND the live-position poll (getLivePositions) must use
// the SAME scope. If they disagree, whatever the list shows but the poll omits will
// silently freeze on the map (the 2026-06-18 regression). See [[livetracking-poll-scope-and-marker]].
//
// `requestedClientId` (optional, accounts only) lets an account drill into one
// sub-client it has access to. Members ignore it.
const buildVehicleScope = (user, requestedClientId) => {
  if (user.role === 'member') {
    const ids = Array.isArray(user.teamVehicleIds) ? user.teamVehicleIds : [];
    return { id: ids }; // empty → matches no rows → empty fleet (not an error)
  }

  if (requestedClientId != null && requestedClientId !== '') {
    const targetId = Number(requestedClientId);
    if (!user.clientIds?.includes(targetId)) {
      const err = new Error('You do not have access to this client.');
      err.status = 403;
      throw err;
    }
    return { clientId: targetId };
  }

  return { clientId: user.clientIds || [user.id] };
};

module.exports = { buildVehicleScope };
