const bcrypt = require('bcryptjs');
const { fn, col, UniqueConstraintError } = require('sequelize');
const { Team, TeamVehicle, TeamMember, Vehicle, User, UserPermission } = require('../models');
const { buildVehicleScope } = require('../utils/vehicleScope');
const { setPermissions } = require('./permission.service');

const err = (status, message) => { const e = new Error(message); e.status = status; throw e; };

// Default menu for a brand-new member unless the owner supplies their own toggles.
const DEFAULT_MEMBER_PERMISSIONS = {
  canViewFleet: true,
  canTrackVehicle: true,
  canViewTrips: true,
  canViewReports: true,
};

// ── ownership guards ────────────────────────────────────────────────────────
const assertOwnedTeam = async (owner, teamId) => {
  const team = await Team.findOne({ where: { id: teamId, ownerId: owner.id } });
  if (!team) err(404, 'Team not found');
  return team;
};

const assertOwnedMember = async (owner, userId) => {
  const u = await User.findOne({ where: { id: userId, parentId: owner.id, kind: 'member' } });
  if (!u) err(404, 'Member not found');
  return u;
};

// ── teams ───────────────────────────────────────────────────────────────────
const listTeams = async (owner) => {
  const teams = await Team.findAll({ where: { ownerId: owner.id }, order: [['created_at', 'DESC']] });
  if (!teams.length) return [];
  const ids = teams.map(t => t.id);
  const [vc, mc] = await Promise.all([
    TeamVehicle.findAll({ where: { teamId: ids }, attributes: ['teamId', [fn('COUNT', col('id')), 'cnt']], group: ['teamId'], raw: true }),
    TeamMember.findAll({ where: { teamId: ids }, attributes: ['teamId', [fn('COUNT', col('id')), 'cnt']], group: ['teamId'], raw: true }),
  ]);
  const vcMap = Object.fromEntries(vc.map(r => [r.teamId, Number(r.cnt)]));
  const mcMap = Object.fromEntries(mc.map(r => [r.teamId, Number(r.cnt)]));
  return teams.map(t => ({ ...t.toJSON(), vehicleCount: vcMap[t.id] || 0, memberCount: mcMap[t.id] || 0 }));
};

const createTeam = async (owner, { name, description }) => {
  if (!name || !String(name).trim()) err(400, 'Team name is required');
  const team = await Team.create({ ownerId: owner.id, name: String(name).trim(), description: description || null });
  return team.toJSON();
};

const updateTeam = async (owner, teamId, { name, description, status }) => {
  const team = await assertOwnedTeam(owner, teamId);
  const updates = {};
  if (name !== undefined) updates.name = String(name).trim();
  if (description !== undefined) updates.description = description;
  if (status !== undefined) updates.status = status;
  await team.update(updates);
  return team.toJSON();
};

const deleteTeam = async (owner, teamId) => {
  await assertOwnedTeam(owner, teamId);
  await TeamVehicle.destroy({ where: { teamId } });
  await TeamMember.destroy({ where: { teamId } });
  await Team.destroy({ where: { id: teamId, ownerId: owner.id } });
  return { id: Number(teamId) };
};

const getTeam = async (owner, teamId) => {
  const team = await assertOwnedTeam(owner, teamId);

  const tvRows = await TeamVehicle.findAll({ where: { teamId }, attributes: ['vehicleId'], raw: true });
  const vehicleIds = tvRows.map(r => r.vehicleId);
  const vehicles = vehicleIds.length
    ? await Vehicle.findAll({ where: { id: vehicleIds }, attributes: ['id', 'vehicleNumber', 'vehicleName', 'deviceType', 'vehicleIcon'] })
    : [];

  const tmRows = await TeamMember.findAll({ where: { teamId }, attributes: ['userId'], raw: true });
  const memberIds = tmRows.map(r => r.userId);
  const members = memberIds.length
    ? await User.findAll({
        where: { id: memberIds },
        attributes: ['id', 'name', 'email', 'phone', 'status'],
        include: [{ model: UserPermission, as: 'permissions', required: false }],
      })
    : [];

  return { ...team.toJSON(), vehicles, members };
};

// ── vehicle assignment ──────────────────────────────────────────────────────
// Replace the team's vehicle set. Every id must be inside the owner's own scope.
const setTeamVehicles = async (owner, teamId, vehicleIds) => {
  await assertOwnedTeam(owner, teamId);
  const ids = [...new Set((vehicleIds || []).map(Number).filter(Boolean))];
  if (ids.length) {
    const allowed = await Vehicle.findAll({
      where: { ...buildVehicleScope(owner), id: ids },
      attributes: ['id'], raw: true,
    });
    if (allowed.length !== ids.length) err(400, 'One or more vehicles are not in your fleet');
  }
  await TeamVehicle.destroy({ where: { teamId } });
  if (ids.length) await TeamVehicle.bulkCreate(ids.map(vehicleId => ({ teamId, vehicleId })));
  return { teamId: Number(teamId), vehicleIds: ids };
};

// ── members ─────────────────────────────────────────────────────────────────
// Create a NEW restricted member login under the owner and attach it to the team.
const addMember = async (owner, teamId, { name, email, phone, password, permissions }) => {
  await assertOwnedTeam(owner, teamId);
  if (!name || !email || !password) err(400, 'name, email and password are required');
  if (await User.findOne({ where: { email } })) err(409, 'Email is already registered');

  const hashed = await bcrypt.hash(password, 12);
  let user;
  try {
    user = await User.create({
      parentId: owner.id,
      kind: 'member',
      name,
      email,
      phone: phone || '',
      password: hashed,
      accountType: 'billable',
      status: 'active',
    });
  } catch (e) {
    if (e instanceof UniqueConstraintError) err(409, 'Email or phone already registered');
    throw e;
  }

  await TeamMember.findOrCreate({ where: { teamId, userId: user.id }, defaults: { teamId, userId: user.id } });
  await setPermissions(user.id, permissions && Object.keys(permissions).length ? permissions : DEFAULT_MEMBER_PERMISSIONS);

  const { password: _pw, ...safe } = user.toJSON();
  return safe;
};

// Detach a member from one team (keeps the login + other team memberships).
const removeMember = async (owner, teamId, userId) => {
  await assertOwnedTeam(owner, teamId);
  await assertOwnedMember(owner, userId);
  await TeamMember.destroy({ where: { teamId, userId } });
  return { teamId: Number(teamId), userId: Number(userId) };
};

// Fully revoke a member login: detach from every team and deactivate the account.
const deleteMember = async (owner, userId) => {
  await assertOwnedMember(owner, userId);
  await TeamMember.destroy({ where: { userId } });
  await User.update({ status: 'inactive' }, { where: { id: userId, parentId: owner.id, kind: 'member' } });
  return { userId: Number(userId) };
};

const setMemberPermissions = async (owner, userId, permissions) => {
  await assertOwnedMember(owner, userId);
  return setPermissions(userId, permissions || {});
};

// Vehicles the owner can pick from when assigning to a team (their own fleet).
const listAssignableVehicles = async (owner) => {
  return Vehicle.findAll({
    where: { ...buildVehicleScope(owner) },
    attributes: ['id', 'vehicleNumber', 'vehicleName', 'deviceType', 'vehicleIcon', 'clientId'],
    order: [['vehicleNumber', 'ASC']],
  });
};

module.exports = {
  listTeams, createTeam, updateTeam, deleteTeam, getTeam,
  setTeamVehicles, addMember, removeMember, deleteMember, setMemberPermissions,
  listAssignableVehicles,
};
