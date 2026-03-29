const { DeviceConfig, StateDefinition } = require('../models');

// ─── Default state definitions ────────────────────────────────────────────────

const GT06_DEFAULTS = [
  {
    stateName: 'No GPS',
    stateColor: '#94A3B8',
    stateIcon: '📡',
    priority: 1,
    conditionLogic: 'AND',
    conditions: [{ field: 'hasLocation', operator: 'eq', value: false }],
    isDefault: false,
  },
  {
    stateName: 'Overspeed',
    stateColor: '#DC2626',
    stateIcon: '🏎️',
    priority: 2,
    conditionLogic: 'AND',
    conditions: [{ field: 'speed', operator: 'gte', value: 80 }],
    isDefault: false,
  },
  {
    stateName: 'Running',
    stateColor: '#16A34A',
    stateIcon: '🟢',
    priority: 3,
    conditionLogic: 'AND',
    conditions: [
      { field: 'ignition', operator: 'eq', value: true },
      { field: 'speed', operator: 'gte', value: 5 },
    ],
    isDefault: false,
  },
  {
    stateName: 'Idle',
    stateColor: '#D97706',
    stateIcon: '⏸️',
    priority: 4,
    conditionLogic: 'AND',
    conditions: [
      { field: 'ignition', operator: 'eq', value: true },
      { field: 'speed', operator: 'lt', value: 5 },
    ],
    isDefault: false,
  },
  {
    stateName: 'Stopped',
    stateColor: '#EF4444',
    stateIcon: '🔴',
    priority: 5,
    conditionLogic: 'AND',
    conditions: [{ field: 'ignition', operator: 'eq', value: false }],
    isDefault: false,
  },
  {
    stateName: 'Unknown',
    stateColor: '#94A3B8',
    stateIcon: '❓',
    priority: 99,
    conditionLogic: 'AND',
    conditions: [],
    isDefault: true,
  },
];

const FMB125_DEFAULTS = [
  {
    stateName: 'No GPS',
    stateColor: '#94A3B8',
    stateIcon: '📡',
    priority: 1,
    conditionLogic: 'AND',
    conditions: [{ field: 'hasLocation', operator: 'eq', value: false }],
    isDefault: false,
  },
  {
    stateName: 'Overspeed',
    stateColor: '#DC2626',
    stateIcon: '🏎️',
    priority: 2,
    conditionLogic: 'AND',
    conditions: [{ field: 'speed', operator: 'gte', value: 80 }],
    isDefault: false,
  },
  {
    stateName: 'Running',
    stateColor: '#16A34A',
    stateIcon: '🟢',
    priority: 3,
    conditionLogic: 'AND',
    conditions: [
      { field: 'ignition', operator: 'eq', value: true },
      { field: 'speed', operator: 'gte', value: 1 },
    ],
    isDefault: false,
  },
  {
    stateName: 'Idle',
    stateColor: '#D97706',
    stateIcon: '⏸️',
    priority: 4,
    conditionLogic: 'AND',
    conditions: [
      { field: 'ignition', operator: 'eq', value: true },
      { field: 'speed', operator: 'lt', value: 1 },
    ],
    isDefault: false,
  },
  {
    stateName: 'Stopped',
    stateColor: '#EF4444',
    stateIcon: '🔴',
    priority: 5,
    conditionLogic: 'AND',
    conditions: [{ field: 'ignition', operator: 'eq', value: false }],
    isDefault: false,
  },
  {
    stateName: 'Unknown',
    stateColor: '#94A3B8',
    stateIcon: '❓',
    priority: 99,
    conditionLogic: 'AND',
    conditions: [],
    isDefault: true,
  },
];

// ─── Seed built-in device configs on server startup ───────────────────────────

const BUILT_INS = [
  {
    name: 'GT06 GPS Tracker',
    type: 'GT06',
    serverIp: null,
    serverPort: 9000,
    mongoCollection: 'gt06locations',
    isBuiltIn: true,
    defaults: GT06_DEFAULTS,
  },
  {
    name: 'Teltonika FMB125',
    type: 'FMB125',
    serverIp: null,
    serverPort: 5027,
    mongoCollection: 'fmb125locations',
    isBuiltIn: true,
    defaults: FMB125_DEFAULTS,
  },
];

const seedBuiltIns = async () => {
  for (const spec of BUILT_INS) {
    const { defaults, ...configData } = spec;
    const [config] = await DeviceConfig.findOrCreate({
      where: { type: spec.type },
      defaults: configData,
    });

    // Seed default states if none exist yet (handles fresh tables and re-runs)
    const existingCount = await StateDefinition.count({ where: { deviceConfigId: config.id } });
    if (existingCount === 0) {
      await StateDefinition.bulkCreate(
        defaults.map(d => ({ ...d, deviceConfigId: config.id }))
      );
    }
  }
};

// ─── Device Config CRUD ───────────────────────────────────────────────────────

const listDeviceConfigs = async () => {
  const configs = await DeviceConfig.findAll({
    order: [['id', 'ASC']],
    include: [{ model: StateDefinition, as: 'states', order: [['priority', 'ASC']] }],
  });
  return configs.map(c => c.toJSON());
};

const createDeviceConfig = async ({ name, type, serverIp, serverPort, mongoCollection }) => {
  const existing = await DeviceConfig.findOne({ where: { type: type.toUpperCase() } });
  if (existing) {
    const err = new Error(`Device type "${type}" already exists`);
    err.status = 409;
    throw err;
  }
  const config = await DeviceConfig.create({
    name,
    type: type.toUpperCase(),
    serverIp: serverIp || null,
    serverPort: serverPort ? parseInt(serverPort, 10) : null,
    mongoCollection,
    isBuiltIn: false,
  });
  return config.toJSON();
};

const updateDeviceConfig = async (id, { name, serverIp, serverPort, mongoCollection, isActive }) => {
  const config = await DeviceConfig.findByPk(id);
  if (!config) { const e = new Error('Device not found'); e.status = 404; throw e; }

  await config.update({
    name: name ?? config.name,
    serverIp: serverIp !== undefined ? (serverIp || null) : config.serverIp,
    serverPort: serverPort !== undefined ? (serverPort ? parseInt(serverPort, 10) : null) : config.serverPort,
    mongoCollection: mongoCollection ?? config.mongoCollection,
    isActive: isActive !== undefined ? isActive : config.isActive,
  });
  return config.toJSON();
};

const deleteDeviceConfig = async (id) => {
  const config = await DeviceConfig.findByPk(id);
  if (!config) { const e = new Error('Device not found'); e.status = 404; throw e; }
  if (config.isBuiltIn) {
    const e = new Error('Built-in device types cannot be deleted');
    e.status = 400; throw e;
  }
  await StateDefinition.destroy({ where: { deviceConfigId: id } });
  await config.destroy();
  return { message: 'Device deleted' };
};

// ─── State Definition CRUD ────────────────────────────────────────────────────

const listStates = async (deviceConfigId) => {
  const states = await StateDefinition.findAll({
    where: { deviceConfigId },
    order: [['priority', 'ASC']],
  });
  return states.map(s => s.toJSON());
};

const createState = async (deviceConfigId, { stateName, stateColor, stateIcon, priority, conditionLogic, conditions, isDefault }) => {
  const config = await DeviceConfig.findByPk(deviceConfigId);
  if (!config) { const e = new Error('Device not found'); e.status = 404; throw e; }

  const state = await StateDefinition.create({
    deviceConfigId,
    stateName,
    stateColor: stateColor || '#94A3B8',
    stateIcon: stateIcon || '',
    priority: priority ?? 50,
    conditionLogic: conditionLogic || 'AND',
    conditions: conditions || [],
    isDefault: !!isDefault,
  });
  return state.toJSON();
};

const updateState = async (stateId, { stateName, stateColor, stateIcon, priority, conditionLogic, conditions, isDefault }) => {
  const state = await StateDefinition.findByPk(stateId);
  if (!state) { const e = new Error('State not found'); e.status = 404; throw e; }

  await state.update({
    stateName: stateName ?? state.stateName,
    stateColor: stateColor ?? state.stateColor,
    stateIcon: stateIcon !== undefined ? stateIcon : state.stateIcon,
    priority: priority ?? state.priority,
    conditionLogic: conditionLogic ?? state.conditionLogic,
    conditions: conditions ?? state.conditions,
    isDefault: isDefault !== undefined ? !!isDefault : state.isDefault,
  });
  return state.toJSON();
};

const deleteState = async (stateId) => {
  const state = await StateDefinition.findByPk(stateId);
  if (!state) { const e = new Error('State not found'); e.status = 404; throw e; }
  await state.destroy();
  return { message: 'State deleted' };
};

// ─── Public getter (used by other services e.g. vehicle state eval) ───────────

const getAllStateDefinitions = async () => {
  const states = await StateDefinition.findAll({ order: [['device_config_id', 'ASC'], ['priority', 'ASC']] });
  return states.map(s => s.toJSON());
};

module.exports = {
  seedBuiltIns,
  listDeviceConfigs,
  createDeviceConfig,
  updateDeviceConfig,
  deleteDeviceConfig,
  listStates,
  createState,
  updateState,
  deleteState,
  getAllStateDefinitions,
};
