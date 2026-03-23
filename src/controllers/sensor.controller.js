const { VehicleSensor, Vehicle } = require('../models');

/**
 * GET /api/vehicles/:id/sensors
 */
const getSensors = async (req, res) => {
  try {
    const sensors = await VehicleSensor.findAll({
      where: { vehicleId: req.params.id },
      order: [['createdAt', 'ASC']],
    });
    return res.json({ success: true, data: sensors });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/vehicles/:id/sensors
 * Body: { name, type, unit, mappedParameter, description, visible }
 */
const createSensor = async (req, res) => {
  try {
    const { name, type, unit, mappedParameter, description, visible } = req.body;
    if (!name || !mappedParameter) {
      return res.status(400).json({ success: false, message: 'name and mappedParameter are required' });
    }
    const sensor = await VehicleSensor.create({
      vehicleId: req.params.id,
      name,
      type: type || 'number',
      unit: unit || null,
      mappedParameter,
      description: description || null,
      visible: visible !== undefined ? visible : true,
    });
    return res.status(201).json({ success: true, data: sensor });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/vehicles/:id/sensors/:sensorId
 * Body: { name, type, unit, mappedParameter, description, visible }
 */
const updateSensor = async (req, res) => {
  try {
    const sensor = await VehicleSensor.findOne({
      where: { id: req.params.sensorId, vehicleId: req.params.id },
    });
    if (!sensor) {
      return res.status(404).json({ success: false, message: 'Sensor not found' });
    }
    await sensor.update(req.body);
    return res.json({ success: true, data: sensor });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/vehicles/:id/sensors/:sensorId
 */
const deleteSensor = async (req, res) => {
  try {
    const sensor = await VehicleSensor.findOne({
      where: { id: req.params.sensorId, vehicleId: req.params.id },
    });
    if (!sensor) {
      return res.status(404).json({ success: false, message: 'Sensor not found' });
    }
    await sensor.destroy();
    return res.json({ success: true, message: 'Sensor deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getSensors, createSensor, updateSensor, deleteSensor };
