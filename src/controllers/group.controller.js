const groupService = require('../services/group.service');

/** GET /api/groups */
const getGroups = async (req, res) => {
  try {
    const groups = await groupService.getGroups(req.user.id);
    return res.json({ success: true, data: groups });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/** GET /api/groups/:id */
const getGroupById = async (req, res) => {
  try {
    const group = await groupService.getGroupById(req.params.id, req.user.id);
    return res.json({ success: true, data: group });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/** POST /api/groups */
const createGroup = async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Group name is required' });
    }
    const group = await groupService.createGroup(req.user.id, { name, description, color });
    return res.status(201).json({ success: true, message: 'Group created successfully', data: group });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/** PUT /api/groups/:id */
const updateGroup = async (req, res) => {
  try {
    const { name, description, color } = req.body;
    const group = await groupService.updateGroup(req.params.id, req.user.id, { name, description, color });
    return res.json({ success: true, message: 'Group updated successfully', data: group });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/** DELETE /api/groups/:id */
const deleteGroup = async (req, res) => {
  try {
    const result = await groupService.deleteGroup(req.params.id, req.user.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/** POST /api/groups/:id/vehicles — body: { vehicleId } */
const addVehicleToGroup = async (req, res) => {
  try {
    const { vehicleId } = req.body;
    if (!vehicleId) {
      return res.status(400).json({ success: false, message: 'vehicleId is required' });
    }
    const member = await groupService.addVehicleToGroup(req.params.id, req.user.id, vehicleId);
    return res.status(201).json({ success: true, message: 'Vehicle added to group', data: member });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/** DELETE /api/groups/:id/vehicles/:vehicleId */
const removeVehicleFromGroup = async (req, res) => {
  try {
    const result = await groupService.removeVehicleFromGroup(req.params.id, req.user.id, req.params.vehicleId);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/** GET /api/groups/:id/report/summary?from=YYYY-MM-DD&to=YYYY-MM-DD */
const getGroupReportSummary = async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: 'from and to query params are required' });
    }
    const data = await groupService.getGroupReportSummary(req.params.id, req.user.id, from, to);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/** GET /api/groups/:id/report/trips?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50&offset=0 */
const getGroupReportTrips = async (req, res) => {
  try {
    const { from, to, limit, offset } = req.query;
    if (!from || !to) {
      return res.status(400).json({ success: false, message: 'from and to query params are required' });
    }
    const data = await groupService.getGroupReportTrips(req.params.id, req.user.id, from, to, limit, offset);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/** GET /api/groups/:id/report/export-xlsx */
const exportGroupReport = async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ success: false, message: 'from and to are required' });
    const buffer = await groupService.exportGroupReportExcel(req.params.id, req.user.id, from, to);
    const group  = await groupService.getGroupById(req.params.id, req.user.id);
    const name   = group?.name?.replace(/\s+/g, '_') || req.params.id;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="group_${name}_${from}_${to}.xlsx"`);
    return res.send(buffer);
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  addVehicleToGroup,
  removeVehicleFromGroup,
  getGroupReportSummary,
  getGroupReportTrips,
  exportGroupReport,
};
