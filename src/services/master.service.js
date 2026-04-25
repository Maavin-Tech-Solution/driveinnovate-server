const { DeviceConfig, StateDefinition } = require('../models');
const { getCapabilities }               = require('../config/deviceCapabilities');

// ─── Default state definitions ────────────────────────────────────────────────
// Spec mirrored in docs/vehicle-states.xlsx (regenerate via
// `node scripts/gen-vehicle-states.js` after any change here).
//
// Six states only — applied identically across every device type.
//
//   10  Offline    no packet in last 2 min      → lastSeenSeconds > 120
//   20  Speeding   speed at/above threshold     → speed >= 80 (editable per device)
//   30  Running    speed > 5 in 3 packets       → runningStreak >= 3
//   40  Idle       engine ON + 4 min stationary → ignition=true AND speedZeroSeconds >= 240
//   50  Stopped    engine OFF for 5 min         → ignition=false AND ignitionOffSeconds >= 300
//   99  Online     fallback / online-but-no-state-yet  (isDefault)

const OFFLINE_SECONDS  = 120;       // 2 min — Offline rule
const SPEEDING_KMPH    = 80;        // editable per device type via Master Settings
const RUNNING_STREAK   = 3;         // consecutive packets above 5 km/h
const IDLE_ZERO_SECS   = 240;       // 4 min — engine-on stationary window
const STOPPED_OFF_SECS = 300;       // 5 min — engine-off settling window

const SHARED_DEFAULTS = [
  {
    stateName: 'Offline',
    stateColor: '#64748B', stateIcon: '📵', priority: 10, conditionLogic: 'AND',
    conditions: [{ field: 'lastSeenSeconds', operator: 'gt', value: OFFLINE_SECONDS }],
    isDefault: false,
  },
  {
    stateName: 'Speeding',
    stateColor: '#DC2626', stateIcon: '🏎️', priority: 20, conditionLogic: 'AND',
    conditions: [{ field: 'speed', operator: 'gte', value: SPEEDING_KMPH }],
    isDefault: false,
  },
  {
    stateName: 'Running',
    stateColor: '#16A34A', stateIcon: '🟢', priority: 30, conditionLogic: 'AND',
    conditions: [{ field: 'runningStreak', operator: 'gte', value: RUNNING_STREAK }],
    isDefault: false,
  },
  {
    stateName: 'Idle',
    stateColor: '#D97706', stateIcon: '⏸️', priority: 40, conditionLogic: 'AND',
    conditions: [
      { field: 'ignition',         operator: 'eq',  value: true },
      { field: 'speedZeroSeconds', operator: 'gte', value: IDLE_ZERO_SECS },
    ],
    isDefault: false,
  },
  {
    stateName: 'Stopped',
    stateColor: '#EF4444', stateIcon: '🔴', priority: 50, conditionLogic: 'AND',
    conditions: [
      { field: 'ignition',           operator: 'eq',  value: false },
      { field: 'ignitionOffSeconds', operator: 'gte', value: STOPPED_OFF_SECS },
    ],
    isDefault: false,
  },
  {
    // Default fallback — fires whenever Offline does NOT match (so the device
    // is online) and none of the motion-state rules above have triggered yet
    // (e.g. just after ignition-off, or while runningStreak is still building).
    stateName: 'Online',
    stateColor: '#0EA5E9', stateIcon: '🌐', priority: 99, conditionLogic: 'AND',
    conditions: [], isDefault: true,
  },
];

// All built-in device types share the same six-state spec defined above.
// (Per-device differences — ignition source, capabilities — are handled
// elsewhere in the packet pipeline, not here.)
const GT06_DEFAULTS      = SHARED_DEFAULTS;
const FMB125_DEFAULTS    = SHARED_DEFAULTS;
const TELTONIKA_DEFAULTS = SHARED_DEFAULTS;
const AIS140_DEFAULTS    = SHARED_DEFAULTS;

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
    name: 'GT06N GPS Tracker',
    type: 'GT06N',
    serverIp: null,
    serverPort: 9000,                 // same port as GT06 — same TCP server
    mongoCollection: 'gt06locations', // same collection as GT06
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
    defaults: TELTONIKA_DEFAULTS,
  },
  {
    name: 'Teltonika FMB920',
    type: 'FMB920',
    serverIp: null,
    serverPort: 5028,
    mongoCollection: 'fmb920locations',
    isBuiltIn: true,
    defaults: TELTONIKA_DEFAULTS,
  },
  {
    name: 'AIS-140 VLTD (India)',
    type: 'AIS140',
    serverIp: null,
    serverPort: 5025,   // ais140/ TCP server — matches PORT in ais140/.env
    mongoCollection: 'ais140locations',
    isBuiltIn: true,
    defaults: AIS140_DEFAULTS,
  },
];

const seedBuiltIns = async () => {
  for (const spec of BUILT_INS) {
    const { defaults, ...configData } = spec;

    // Attach capability snapshot so the frontend/API can read it without importing server config
    const caps = getCapabilities(spec.type);
    configData.capabilities = {
      ignitionSource:       caps.ignitionSource,
      supportsGps:          caps.supportsGps,
      supportsAltitude:     caps.supportsAltitude,
      supportsSatellites:   caps.supportsSatellites,
      supportsBattery:      caps.supportsBattery,
      supportsExternalVoltage: caps.supportsExternalVoltage,
      supportsOdometer:     caps.supportsOdometer,
      supportsFuel:         caps.supportsFuel,
      supportsRpm:          caps.supportsRpm,
      supportsTemperature:  caps.supportsTemperature,
      supportsGsmSignal:    caps.supportsGsmSignal,
      supportsDigitalInputs: caps.supportsDigitalInputs,
      supportsAnalogInputs: caps.supportsAnalogInputs,
      supportsCustomIo:     caps.supportsCustomIo,
    };

    const [config, created] = await DeviceConfig.findOrCreate({
      where: { type: spec.type },
      defaults: configData,
    });

    // Keep capabilities in sync even if record already existed
    if (!created) {
      await config.update({
        capabilities:    configData.capabilities,
        mongoCollection: configData.mongoCollection,
        serverPort:      config.serverPort || configData.serverPort,
      });
    }

    // Always replace built-in states so updated defaults are applied on every server start.
    await StateDefinition.destroy({ where: { deviceConfigId: config.id } });
    await StateDefinition.bulkCreate(
      defaults.map(d => ({ ...d, deviceConfigId: config.id }))
    );
  }
};

// Manually reset a built-in device's states to the current defaults (called via API)
const reseedBuiltInStates = async (deviceConfigId) => {
  const config = await DeviceConfig.findByPk(deviceConfigId);
  if (!config) { const e = new Error('Device not found'); e.status = 404; throw e; }
  if (!config.isBuiltIn) {
    const e = new Error('Only built-in device types can be reset to defaults');
    e.status = 400; throw e;
  }
  const spec = BUILT_INS.find(s => s.type === config.type);
  if (!spec) { const e = new Error('No defaults defined for this device type'); e.status = 404; throw e; }

  await StateDefinition.destroy({ where: { deviceConfigId: config.id } });
  await StateDefinition.bulkCreate(
    spec.defaults.map(d => ({ ...d, deviceConfigId: config.id }))
  );
  return listStates(deviceConfigId);
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

// ─── System Settings ─────────────────────────────────────────────────────────

const { SystemSetting } = require('../models');

const DEFAULT_SETTINGS = {
  liveShareEnabled:    false,
  trialAccountEnabled: false,
  trialDurationDays:   30,
};

/**
 * Returns the single system-settings row, creating it with defaults if absent.
 */
const getSystemSettings = async () => {
  let row = await SystemSetting.findByPk(1);
  if (!row) {
    row = await SystemSetting.create({ id: 1, ...DEFAULT_SETTINGS });
  }
  return {
    liveShareEnabled:    Boolean(row.liveShareEnabled),
    trialAccountEnabled: Boolean(row.trialAccountEnabled),
    trialDurationDays:   Number(row.trialDurationDays) || 30,
  };
};

/**
 * Upserts the single settings row.  Only known keys are applied.
 * @param {object} updates – e.g. { liveShareEnabled: true, trialDurationDays: 14 }
 */
const updateSystemSettings = async (updates) => {
  const boolKeys = ['liveShareEnabled', 'trialAccountEnabled'];
  const intKeys  = ['trialDurationDays'];
  const safe = {};
  for (const k of boolKeys) {
    if (k in updates) safe[k] = Boolean(updates[k]);
  }
  for (const k of intKeys) {
    if (k in updates) {
      const v = parseInt(updates[k], 10);
      if (!isNaN(v) && v > 0) safe[k] = v;
    }
  }
  await SystemSetting.upsert({ id: 1, ...safe });
  return getSystemSettings();
};

module.exports = {
  seedBuiltIns,
  reseedBuiltInStates,
  listDeviceConfigs,
  createDeviceConfig,
  updateDeviceConfig,
  deleteDeviceConfig,
  listStates,
  createState,
  updateState,
  deleteState,
  getAllStateDefinitions,
  getSystemSettings,
  updateSystemSettings,
};
