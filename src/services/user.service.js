const bcrypt = require('bcryptjs');
const { UniqueConstraintError, fn, col, Op } = require('sequelize');
const { sequelize, User, UserMeta, Vehicle, TeamMember, TeamVehicle } = require('../models');
const { getSystemSettings } = require('./master.service');

const getProfile = async (userId) => {
  const user = await User.findByPk(userId, { attributes: { exclude: ['password'] } });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return user;
};

/**
 * Return the parent (dealer/papa) contact details for a given user.
 * Used by the client-side subscription-unavailable UI to show who to contact.
 * Only name, email, and phone are returned — no sensitive data.
 */
const getParentContact = async (userId) => {
  const user = await User.findByPk(userId, { attributes: ['parentId', 'name', 'email', 'phone'] });
  if (!user) {
    const err = new Error('User not found'); err.status = 404; throw err;
  }
  // If the user IS the root (parentId === 0 or null), return their own details
  // so they always have a contact to display.
  const parentId = user.parentId && Number(user.parentId) !== 0 ? user.parentId : user.id;
  const parent = await User.findByPk(parentId, { attributes: ['id', 'name', 'email', 'phone'] });
  if (!parent) return { name: null, email: null, phone: null };
  return { name: parent.name, email: parent.email, phone: parent.phone };
};

const updateProfile = async (userId, { name, phone }) => {
  const user = await User.findByPk(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  await user.update({ name, phone });
  const { password: _, ...updated } = user.toJSON();
  return updated;
};

const updatePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await User.findByPk(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) {
    const err = new Error('Current password is incorrect');
    err.status = 400;
    throw err;
  }
  const hashed = await bcrypt.hash(newPassword, 12);
  await user.update({ password: hashed });
  return { message: 'Password updated successfully' };
};

const updateNotifications = async (userId, { emailNotifications, smsNotifications, marketingNotifications }) => {
  const user = await User.findByPk(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  await user.update({ emailNotifications, smsNotifications, marketingNotifications });
  const { password: _, ...updated } = user.toJSON();
  return updated;
};

const createClient = async (
  parentUserId,
  { name, email, phone, password, companyName, address, state, city, zip, country, businessCategory, gtin, accountType, billingType, graceDays }
) => {
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    const err = new Error('Email is already registered');
    err.status = 409;
    throw err;
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  // Resolve trial expiry from system settings
  const settings = await getSystemSettings();
  const resolvedType = accountType || 'trial';
  const trialExpiresAt = (resolvedType === 'trial' && settings.trialAccountEnabled)
    ? new Date(Date.now() + settings.trialDurationDays * 24 * 60 * 60 * 1000)
    : null;

  let user;
  try {
    user = await User.create({
      parentId: parentUserId,
      name,
      email,
      phone,
      password: hashedPassword,
      accountType: resolvedType,
      trialExpiresAt,
      billingType: billingType === 'prepaid' ? 'prepaid' : 'postpaid',
      graceDays: Number.isInteger(Number(graceDays)) && Number(graceDays) >= 0 ? Number(graceDays) : 0,
    });
  } catch (e) {
    if (e instanceof UniqueConstraintError) {
      const field = e.errors?.[0]?.path || 'email/phone';
      const err = new Error(`${field} is already registered`);
      err.status = 409;
      throw err;
    }
    throw e;
  }

  await UserMeta.create({
    userId: user.id,
    companyName,
    address,
    state,
    city,
    zip,
    country,
    businessCategory,
    gtin,
  });

  const { password: _, ...clientWithoutPassword } = user.toJSON();
  return clientWithoutPassword;
};

// Distinct assigned-vehicle count per member (union of vehicles across their
// teams). Members own no vehicles, so their "vehicle count" comes from here.
const _memberVehicleCounts = async (memberIds) => {
  const out = {};
  if (!memberIds.length) return out;
  const tmRows = await TeamMember.findAll({ where: { userId: memberIds }, attributes: ['userId', 'teamId'], raw: true });
  const teamIds = [...new Set(tmRows.map(r => r.teamId))];
  const tvRows = teamIds.length
    ? await TeamVehicle.findAll({ where: { teamId: teamIds }, attributes: ['teamId', 'vehicleId'], raw: true })
    : [];
  const teamVeh = {};
  for (const r of tvRows) { (teamVeh[r.teamId] = teamVeh[r.teamId] || []).push(r.vehicleId); }
  const memberTeams = {};
  for (const r of tmRows) { (memberTeams[r.userId] = memberTeams[r.userId] || []).push(r.teamId); }
  for (const uid of memberIds) {
    const vset = new Set();
    for (const tid of (memberTeams[uid] || [])) for (const vid of (teamVeh[tid] || [])) vset.add(vid);
    out[uid] = vset.size;
  }
  return out;
};

const listClients = async (parentUserId) => {
  // Include BOTH sub-account clients and team-member logins. `kind` distinguishes
  // them so the UI can badge members; their vehicle count comes from team
  // assignments rather than ownership.
  const clients = await User.findAll({
    where: { parentId: parentUserId },
    attributes: { exclude: ['password'] },
    include: [{ model: UserMeta, as: 'meta', required: false }],
    order: [['created_at', 'DESC']],
  });

  if (!clients.length) return [];

  const ids = clients.map(c => c.id);

  // Batch: owned-vehicle count per ACCOUNT client (ownership).
  const vcRows = await Vehicle.findAll({
    where: { clientId: ids },
    attributes: ['clientId', [fn('COUNT', col('id')), 'cnt']],
    group: ['clientId'],
    raw: true,
  });
  const vcMap = Object.fromEntries(vcRows.map(r => [r.clientId, Number(r.cnt)]));

  // Batch: sub-client count per client (members never have sub-clients).
  const scRows = await User.findAll({
    where: { parentId: ids, kind: 'account' },
    attributes: ['parentId', [fn('COUNT', col('id')), 'cnt']],
    group: ['parentId'],
    raw: true,
  });
  const scMap = Object.fromEntries(scRows.map(r => [r.parentId, Number(r.cnt)]));

  // Batch: assigned-vehicle count per MEMBER (distinct vehicles across their teams).
  const memberVcMap = await _memberVehicleCounts(clients.filter(c => c.kind === 'member').map(c => c.id));

  return clients.map(c => ({
    ...c.toJSON(),
    vehicleCount: c.kind === 'member' ? (memberVcMap[c.id] || 0) : (vcMap[c.id] || 0),
    subClientCount: scMap[c.id] || 0,
  }));
};

const getClientDetail = async (callerClientIds, clientId) => {
  if (!callerClientIds.includes(clientId)) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }

  const client = await User.findByPk(clientId, {
    attributes: { exclude: ['password'] },
    include: [{ model: UserMeta, as: 'meta', required: false }],
  });
  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }

  // Direct sub-clients
  const subClients = await User.findAll({
    where: { parentId: clientId, kind: 'account' }, // exclude team-member logins
    attributes: { exclude: ['password'] },
    include: [{ model: UserMeta, as: 'meta', required: false }],
    order: [['created_at', 'DESC']],
  });

  // Vehicle counts for sub-clients (batch)
  const subIds = subClients.map(sc => sc.id);
  let subVcMap = {};
  if (subIds.length) {
    const rows = await Vehicle.findAll({
      where: { clientId: subIds },
      attributes: ['clientId', [fn('COUNT', col('id')), 'cnt']],
      group: ['clientId'],
      raw: true,
    });
    subVcMap = Object.fromEntries(rows.map(r => [r.clientId, Number(r.cnt)]));
  }

  const subClientsData = subClients.map(sc => ({
    ...sc.toJSON(),
    vehicleCount: subVcMap[sc.id] || 0,
  }));

  // Direct vehicles
  const vehicles = await Vehicle.findAll({
    where: { clientId: clientId },
    attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon', 'deviceType', 'status', 'imei'],
    order: [['registered_at', 'DESC']],
  });

  const vehicleCount = vehicles.length;
  const networkVehicleCount = vehicleCount + Object.values(subVcMap).reduce((s, c) => s + c, 0);

  return {
    client: client.toJSON(),
    subClients: subClientsData,
    vehicles: vehicles.map(v => v.toJSON()),
    stats: {
      subClientCount: subClients.length,
      vehicleCount,
      networkVehicleCount,
    },
  };
};

/**
 * Recursively build a full client tree rooted at parentId.
 * Returns nested array of clients, each with vehicleCount and children[].
 * depth guard prevents runaway recursion on corrupted data.
 */
const buildClientTree = async (parentId, depth = 0) => {
  if (depth > 10) return [];

  const clients = await User.findAll({
    where: { parentId },
    attributes: { exclude: ['password'] },
    include: [{ model: UserMeta, as: 'meta', required: false }],
    order: [['name', 'ASC']],
  });

  if (!clients.length) return [];

  const ids = clients.map(c => c.id);

  // Vehicle counts (batch)
  const vcRows = await Vehicle.findAll({
    where: { clientId: ids },
    attributes: ['clientId', [fn('COUNT', col('id')), 'cnt']],
    group: ['clientId'],
    raw: true,
  });
  const vcMap = Object.fromEntries(vcRows.map(r => [r.clientId, Number(r.cnt)]));
  const memberVcMap = await _memberVehicleCounts(clients.filter(c => c.kind === 'member').map(c => c.id));

  // Recursively build children for each client in parallel
  const result = await Promise.all(
    clients.map(async (c) => {
      const children = await buildClientTree(c.id, depth + 1);
      // Members' count comes from team assignments, accounts' from ownership.
      const ownCount = c.kind === 'member' ? (memberVcMap[c.id] || 0) : (vcMap[c.id] || 0);
      const networkVehicleCount = ownCount +
        children.reduce((s, ch) => s + (ch.networkVehicleCount || 0), 0);
      return {
        ...c.toJSON(),
        vehicleCount: ownCount,
        networkVehicleCount,
        children,
      };
    })
  );

  return result;
};

const PLAN_DAYS = { '3months': 90, '6months': 180, '1year': 365 };

/**
 * Upgrade a client account to billable.
 * Sets accountType='billable' on the User and stamps subscriptionExpiresAt
 * on every active vehicle owned by the client.
 * @param {number}   clientId       — the user to upgrade
 * @param {number[]} callerClientIds — must include clientId (access check)
 * @param {'3months'|'6months'|'1year'} plan
 */
const upgradeToBillable = async (clientId, callerClientIds, plan) => {
  if (!callerClientIds.includes(clientId)) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }

  const days = PLAN_DAYS[plan];
  if (!days) {
    const err = new Error('plan must be 3months, 6months or 1year');
    err.status = 400;
    throw err;
  }

  const client = await User.findByPk(clientId);
  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await client.update({ accountType: 'billable', trialExpiresAt: null });

  await Vehicle.update(
    { subscriptionExpiresAt: expiresAt },
    { where: { clientId, status: { [Op.ne]: 'deleted' } } }
  );

  return { accountType: 'billable', subscriptionExpiresAt: expiresAt, plan };
};

/**
 * Extend the trial period of a client account.
 * @param {number}   clientId
 * @param {number[]} callerClientIds
 * @param {string}   newExpiresAt  — ISO date string
 */
const extendTrial = async (clientId, callerClientIds, newExpiresAt) => {
  if (!callerClientIds.includes(clientId)) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }

  const expiry = new Date(newExpiresAt);
  if (isNaN(expiry.getTime())) {
    const err = new Error('Invalid date for newExpiresAt');
    err.status = 400;
    throw err;
  }

  const client = await User.findByPk(clientId);
  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }

  if (client.accountType !== 'trial') {
    const err = new Error('Can only extend trial for trial accounts');
    err.status = 400;
    throw err;
  }

  await client.update({ trialExpiresAt: expiry });
  return { accountType: 'trial', trialExpiresAt: expiry };
};

/** Update a client's billing settings: billing type and/or grace period (days). */
const setBillingType = async (clientId, callerClientIds, { billingType, graceDays } = {}) => {
  if (callerClientIds?.length && !callerClientIds.includes(Number(clientId))) {
    const err = new Error('You do not have access to this client.'); err.status = 403; throw err;
  }
  const client = await User.findByPk(clientId);
  if (!client) { const err = new Error('Client not found'); err.status = 404; throw err; }

  const updates = {};
  if (billingType !== undefined) {
    if (!['prepaid', 'postpaid'].includes(billingType)) {
      const err = new Error('billingType must be prepaid or postpaid'); err.status = 400; throw err;
    }
    updates.billingType = billingType;
  }
  if (graceDays !== undefined && graceDays !== null && graceDays !== '') {
    const g = Number(graceDays);
    if (!Number.isInteger(g) || g < 0) { const err = new Error('Grace period must be a whole number ≥ 0'); err.status = 400; throw err; }
    updates.graceDays = g;
  }
  if (!Object.keys(updates).length) { const err = new Error('Nothing to update'); err.status = 400; throw err; }

  await client.update(updates);
  return { id: client.id, billingType: client.billingType, graceDays: client.graceDays };
};

module.exports = {
  getProfile,
  getParentContact,
  updateProfile,
  updatePassword,
  updateNotifications,
  createClient,
  listClients,
  getClientDetail,
  buildClientTree,
  upgradeToBillable,
  extendTrial,
  setBillingType,
};
