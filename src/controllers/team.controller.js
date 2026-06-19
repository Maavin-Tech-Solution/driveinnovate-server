const teamService = require('../services/team.service');

const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

module.exports = {
  list:        handle((req) => teamService.listTeams(req.user)),
  create:      handle((req) => teamService.createTeam(req.user, req.body)),
  detail:      handle((req) => teamService.getTeam(req.user, req.params.id)),
  update:      handle((req) => teamService.updateTeam(req.user, req.params.id, req.body)),
  remove:      handle((req) => teamService.deleteTeam(req.user, req.params.id)),
  setVehicles: handle((req) => teamService.setTeamVehicles(req.user, req.params.id, req.body.vehicleIds)),
  addVehicle:  handle((req) => teamService.addVehicle(req.user, req.params.id, req.params.vehicleId)),
  removeVehicle: handle((req) => teamService.removeVehicle(req.user, req.params.id, req.params.vehicleId)),
  addMember:   handle((req) => teamService.addMember(req.user, req.params.id, req.body)),
  attachMember:handle((req) => teamService.attachMember(req.user, req.params.id, req.params.userId)),
  removeMember:handle((req) => teamService.removeMember(req.user, req.params.id, req.params.userId)),
  deleteMember:handle((req) => teamService.deleteMember(req.user, req.params.userId)),
  setMemberPermissions: handle((req) => teamService.setMemberPermissions(req.user, req.params.userId, req.body.permissions || req.body)),
  listMembers:        handle((req) => teamService.listMembers(req.user)),
  assignableVehicles: handle((req) => teamService.listAssignableVehicles(req.user)),
};
