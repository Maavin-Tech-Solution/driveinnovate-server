/**
 * vehicleExpiryJob.js
 *
 * Runs once per day (immediately on start, then every 24h). Only fires when
 * prepaid billing is enabled.
 *
 *  1. REMINDER  — vehicles whose ACTUAL expiry falls within the next REMIND_DAYS
 *                 and that haven't been reminded this term get a bell notification
 *                 + email to the owner. expiryReminderSentAt is stamped so we
 *                 don't spam daily; it's cleared on renew so the next term reminds.
 *  2. EXPIRE    — vehicles past their GRACE expiry are auto-set to 'inactive'.
 */

'use strict';

const { Op } = require('sequelize');
const { Vehicle, User, Notification } = require('../models');
const { getSystemSettings } = require('../services/master.service');
const { sendAlertEmail } = require('../services/email.service');

const REMIND_DAYS = 30;                       // remind when actual expiry is within this window
const INTERVAL_MS = 24 * 60 * 60 * 1000;      // run daily

const fmt = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const reg = (v) => v.vehicleNumber || v.imei || `vehicle #${v.id}`;

async function sendExpiryReminders(now) {
  const windowEnd = new Date(now.getTime() + REMIND_DAYS * 24 * 60 * 60 * 1000);
  const due = await Vehicle.findAll({
    where: {
      status: 'active',
      subscriptionExpiresAt: { [Op.gt]: now, [Op.lte]: windowEnd }, // NULLs excluded
      expiryReminderSentAt: null,
    },
    attributes: ['id', 'clientId', 'vehicleNumber', 'imei', 'subscriptionExpiresAt', 'graceExpiresAt'],
  });
  if (!due.length) return 0;

  const ownerIds = [...new Set(due.map((v) => v.clientId))];
  const owners = await User.findAll({ where: { id: ownerIds }, attributes: ['id', 'name', 'email'], raw: true });
  const ownerById = Object.fromEntries(owners.map((o) => [o.id, o]));

  for (const v of due) {
    const name = reg(v);
    const daysLeft = Math.max(0, Math.ceil((new Date(v.subscriptionExpiresAt) - now) / (24 * 60 * 60 * 1000)));
    const graceNote = v.graceExpiresAt && new Date(v.graceExpiresAt) > new Date(v.subscriptionExpiresAt)
      ? ` (grace until ${fmt(v.graceExpiresAt)})` : '';

    await Notification.create({
      clientId: v.clientId,
      vehicleId: v.id,
      title: `Vehicle ${name} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      message: `Subscription for ${name} expires on ${fmt(v.subscriptionExpiresAt)}${graceNote}. Renew to avoid interruption.`,
      alertType: 'SUBSCRIPTION_EXPIRY',
      triggeredAt: now,
    }).catch((e) => console.error('[VehicleExpiryJob] notification failed:', e.message));

    const owner = ownerById[v.clientId];
    if (owner?.email) {
      await sendAlertEmail({
        subject: `[Reminder] ${name} subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        htmlBody: `<p>Hi ${owner.name || ''},</p><p>The subscription for <strong>${name}</strong> expires on <strong>${fmt(v.subscriptionExpiresAt)}</strong>${graceNote}. Please renew to keep tracking active.</p>`,
        extraEmails: owner.email,
      }).catch((e) => console.error('[VehicleExpiryJob] email failed:', e.message));
    }

    await v.update({ expiryReminderSentAt: now });
  }
  return due.length;
}

async function autoInactivateExpired(now) {
  const expired = await Vehicle.findAll({
    where: { status: 'active', graceExpiresAt: { [Op.lt]: now } }, // NULLs excluded
    attributes: ['id', 'clientId', 'vehicleNumber', 'imei', 'graceExpiresAt'],
  });
  if (!expired.length) return 0;

  for (const v of expired) {
    const name = reg(v);
    await v.update({ status: 'inactive' });
    await Notification.create({
      clientId: v.clientId,
      vehicleId: v.id,
      title: `Vehicle ${name} expired`,
      message: `${name} has passed its grace period and is now inactive. Renew to reactivate it.`,
      alertType: 'SUBSCRIPTION_EXPIRED',
      triggeredAt: now,
    }).catch((e) => console.error('[VehicleExpiryJob] notification failed:', e.message));
  }
  return expired.length;
}

async function runVehicleExpiryCheck() {
  try {
    const settings = await getSystemSettings();
    if (!settings.billingEnabled) return; // feature off — skip
    const now = new Date();
    const reminded = await sendExpiryReminders(now);
    const inactivated = await autoInactivateExpired(now);
    if (reminded || inactivated) {
      console.log(`[VehicleExpiryJob] reminders sent=${reminded}, auto-inactivated=${inactivated}`);
    }
  } catch (err) {
    console.error('[VehicleExpiryJob] Error during expiry check:', err.message);
  }
}

function startVehicleExpiryJob() {
  console.log('[VehicleExpiryJob] Starting daily vehicle expiry check');
  runVehicleExpiryCheck();
  setInterval(runVehicleExpiryCheck, INTERVAL_MS);
}

module.exports = { startVehicleExpiryJob, runVehicleExpiryCheck };
