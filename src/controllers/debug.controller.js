const mongoose = require('mongoose');

// Dynamic model loader for device types
const getModelForDeviceType = (deviceType) => {
  if (deviceType === 'gt06') {
    return mongoose.models.GT06Location || mongoose.model('GT06Location', new mongoose.Schema({}, { strict: false }), 'gt06locations');
  } else if (deviceType === 'fmb125') {
    return mongoose.models.FMB125Location || mongoose.model('FMB125Location', new mongoose.Schema({}, { strict: false }), 'fmb125locations');
  }
  return null;
};

/**
 * GET /api/debug/data-packets?imei=...&deviceType=...
 * Returns data packets filtered by IMEI and deviceType, sorted by date desc
 */
const getDataPackets = async (req, res) => {
  try {
    const { imei, deviceType } = req.query;
    if (!imei || !deviceType) {
      return res.status(400).json({ success: false, message: 'imei and deviceType are required' });
    }
    const Model = getModelForDeviceType(deviceType);
    if (!Model) {
      return res.status(400).json({ success: false, message: 'Invalid device type' });
    }
    // Sort by latest packet using all possible date fields
    const packets = await Model.find({ imei })
      .sort({
        date: -1,
        timestamp: -1,
        createdAt: -1,
        updatedAt: -1
      })
      .limit(Number(req.query.limit) || 20)
      .skip(Number(req.query.skip) || 0);
    // Map to expected structure
    const mapped = packets.map(doc => ({
      date: doc.date || doc.timestamp || doc.createdAt || doc.updatedAt || null,
      imei: doc.imei || imei,
      deviceType,
      data: doc
    }));
    return res.json(mapped);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getDataPackets };
