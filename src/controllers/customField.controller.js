const { VehicleCustomField, Vehicle } = require('../models');

const getCustomFields = async (req, res) => {
  try {
    const { id } = req.params;
    const fields = await VehicleCustomField.findAll({
      where: { vehicleId: id },
      order: [['created_at', 'ASC']],
    });
    res.json({ success: true, data: fields });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createCustomField = async (req, res) => {
  try {
    const { id } = req.params;
    const { fieldName, fieldValue } = req.body;
    if (!fieldName || !fieldName.trim()) {
      return res.status(400).json({ success: false, message: 'Field name is required' });
    }
    const field = await VehicleCustomField.create({
      vehicleId: id,
      fieldName: fieldName.trim(),
      fieldValue: fieldValue || '',
    });
    res.status(201).json({ success: true, data: field });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateCustomField = async (req, res) => {
  try {
    const { id, fieldId } = req.params;
    const { fieldName, fieldValue } = req.body;
    const field = await VehicleCustomField.findOne({ where: { id: fieldId, vehicleId: id } });
    if (!field) {
      return res.status(404).json({ success: false, message: 'Custom field not found' });
    }
    if (fieldName !== undefined) field.fieldName = fieldName.trim();
    if (fieldValue !== undefined) field.fieldValue = fieldValue;
    await field.save();
    res.json({ success: true, data: field });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteCustomField = async (req, res) => {
  try {
    const { id, fieldId } = req.params;
    const deleted = await VehicleCustomField.destroy({ where: { id: fieldId, vehicleId: id } });
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Custom field not found' });
    }
    res.json({ success: true, message: 'Custom field deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getCustomFields, createCustomField, updateCustomField, deleteCustomField };
