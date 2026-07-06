/**
 * vehicleExpiryJob.js
 *
 * Runs every day at 02:00 IST. Only fires when prepaid billing is enabled.
 *
 *  1. AUTO-RENEW — vehicles reaching expiry (within 24h) whose owner has auto-renew
 *                  ON and enough tokens are renewed automatically from the wallet.
 *  2. REMINDER   — for each client with vehicles expiring within the next 7 days
 *                  (and not yet reminded this term) a single consolidated email is
 *                  sent to smartchallan@gmail.com, the papa (top) account, the
 *                  client and their dealer, listing the vehicles; plus a bell note.
 *  3. EXPIRE     — vehicles past their GRACE expiry are auto-set to 'inactive'.
 */

'use strict';

const { Op } = require('sequelize');
const { Vehicle, User, Notification } = require('../models');
const { getSystemSettings } = require('../services/master.service');
const { getTransporter, getFromAddress } = require('../services/email.service');
const billingService = require('../services/billing.service');

const REMIND_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_EMAIL = 'smartchallan@gmail.com';

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const reg = (v) => v.vehicleNumber || v.imei || `vehicle #${v.id}`;

// Walk up the tree: the client's direct dealer + the papa (parentId===0) account.
async function findAncestors(client) {
  if (!client.parentId) return { dealer: null, papa: null };
  const parent = await User.findByPk(client.parentId, { attributes: ['id', 'name', 'email', 'parentId'], raw: true });
  if (!parent) return { dealer: null, papa: null };
  if (Number(parent.parentId) === 0) return { dealer: null, papa: parent };
  const grandparent = await User.findByPk(parent.parentId, { attributes: ['id', 'name', 'email', 'parentId'], raw: true });
  return { dealer: parent, papa: grandparent || null };
}

// ── 1. Auto-renew vehicles at expiry for opted-in clients with tokens ─────────
async function autoRenewDue(now) {
  const soon = new Date(now.getTime() + DAY_MS); // expiring within 24h or already past
  const due = await Vehicle.findAll({
    where: { status: 'active', subscriptionExpiresAt: { [Op.lte]: soon } },
    attributes: ['id', 'clientId'],
    raw: true,
  });
  if (!due.length) return 0;

  const ownerIds = [...new Set(due.map((v) => v.clientId))];
  const owners = await User.findAll({ where: { id: ownerIds }, attributes: ['id', 'autoRenew', 'billingType', 'accountType'], raw: true });
  const ownerById = Object.fromEntries(owners.map((o) => [o.id, o]));

  let renewed = 0;
  for (const v of due) {
    const o = ownerById[v.clientId];
    if (!o?.autoRenew || o.billingType !== 'prepaid' || o.accountType !== 'billable') continue;
    try {
      await billingService.autoRenewVehicle(v.id);
      renewed++;
    } catch (e) {
      if (e.code !== 'INSUFFICIENT_FUNDS') console.error('[VehicleExpiryJob] auto-renew failed:', e.message);
      // no tokens → leave it; it will get a reminder / eventually inactivate
    }
  }
  return renewed;
}

// ── 2. Consolidated 7-day reminder per client ─────────────────────────────────
async function sendExpiryReminders(now) {
  const windowEnd = new Date(now.getTime() + REMIND_DAYS * DAY_MS);
  const due = await Vehicle.findAll({
    where: {
      status: 'active',
      subscriptionExpiresAt: { [Op.gt]: now, [Op.lte]: windowEnd },
      expiryReminderSentAt: null,
    },
    attributes: ['id', 'clientId', 'vehicleNumber', 'imei', 'subscriptionExpiresAt', 'graceExpiresAt'],
  });
  if (!due.length) return 0;

  // Group by client.
  const byClient = new Map();
  for (const v of due) {
    if (!byClient.has(v.clientId)) byClient.set(v.clientId, []);
    byClient.get(v.clientId).push(v);
  }

  const transporter = getTransporter();
  let clientsNotified = 0;

  for (const [clientId, vehicles] of byClient) {
    const client = await User.findByPk(clientId, { attributes: ['id', 'name', 'email', 'parentId'], raw: true });
    if (!client) continue;
    const { dealer, papa } = await findAncestors(client);

    const rowsHtml = vehicles
      .sort((a, b) => new Date(a.subscriptionExpiresAt) - new Date(b.subscriptionExpiresAt))
      .map((v) => {
        const days = Math.max(0, Math.ceil((new Date(v.subscriptionExpiresAt) - now) / DAY_MS));
        return `<tr>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${reg(v)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${fmt(v.subscriptionExpiresAt)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">${fmt(v.graceExpiresAt || v.subscriptionExpiresAt)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;color:${days <= 2 ? '#dc2626' : '#d97706'};font-weight:700">${days} day${days === 1 ? '' : 's'}</td>
        </tr>`;
      }).join('');

    const html = `<div style="font-family:Segoe UI,Roboto,Arial,sans-serif;color:#1e293b">
      <p>Hi,</p>
      <p><strong>${vehicles.length}</strong> vehicle${vehicles.length === 1 ? '' : 's'} of <strong>${client.name || 'a client'}</strong> ${vehicles.length === 1 ? 'is' : 'are'} expiring within the next ${REMIND_DAYS} days. Please renew to avoid interruption.</p>
      <table style="border-collapse:collapse;font-size:13px;margin-top:8px">
        <thead><tr style="background:#1e293b;color:#fff">
          <th style="padding:8px 10px;text-align:left">Vehicle</th>
          <th style="padding:8px 10px;text-align:left">Actual expiry</th>
          <th style="padding:8px 10px;text-align:left">Grace expiry</th>
          <th style="padding:8px 10px">In</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;

    const recipients = [...new Set([ADMIN_EMAIL, papa?.email, dealer?.email, client.email].filter(Boolean))];
    if (transporter && recipients.length) {
      try {
        await transporter.sendMail({
          from: getFromAddress(),
          to: recipients.join(', '),
          subject: `[Reminder] ${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} of ${client.name || 'client'} expiring within ${REMIND_DAYS} days`,
          html,
        });
      } catch (e) { console.error('[VehicleExpiryJob] email failed:', e.message); }
    } else {
      console.log(`[VehicleExpiryJob] (no SMTP) would notify ${recipients.join(', ')} of ${vehicles.length} expiring vehicle(s)`);
    }

    // Bell notification for the client (single summary).
    await Notification.create({
      clientId,
      title: `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} expiring within ${REMIND_DAYS} days`,
      message: `Vehicles nearing expiry: ${vehicles.map(reg).join(', ')}. Renew to avoid interruption.`,
      alertType: 'SUBSCRIPTION_EXPIRY',
      triggeredAt: now,
    }).catch((e) => console.error('[VehicleExpiryJob] notification failed:', e.message));

    // Stamp so we don't re-remind daily (cleared on renew → next term reminds again).
    await Vehicle.update({ expiryReminderSentAt: now }, { where: { id: vehicles.map((v) => v.id) } });
    clientsNotified++;
  }
  return clientsNotified;
}

// ── 3. Auto-inactivate vehicles past grace ────────────────────────────────────
async function autoInactivateExpired(now) {
  const expired = await Vehicle.findAll({
    where: { status: 'active', graceExpiresAt: { [Op.lt]: now } },
    attributes: ['id', 'clientId', 'vehicleNumber', 'imei'],
  });
  if (!expired.length) return 0;
  for (const v of expired) {
    await v.update({ status: 'inactive' });
    await Notification.create({
      clientId: v.clientId,
      vehicleId: v.id,
      title: `Vehicle ${reg(v)} expired`,
      message: `${reg(v)} has passed its grace period and is now inactive. Renew to reactivate it.`,
      alertType: 'SUBSCRIPTION_EXPIRED',
      triggeredAt: now,
    }).catch((e) => console.error('[VehicleExpiryJob] notification failed:', e.message));
  }
  return expired.length;
}

async function runVehicleExpiryCheck() {
  try {
    const settings = await getSystemSettings();
    if (!settings.billingEnabled) return;
    const now = new Date();
    const renewed = await autoRenewDue(now);
    const reminded = await sendExpiryReminders(now);
    const inactivated = await autoInactivateExpired(now);
    console.log(`[VehicleExpiryJob] auto-renewed=${renewed}, clients reminded=${reminded}, inactivated=${inactivated}`);
  } catch (err) {
    console.error('[VehicleExpiryJob] Error during expiry check:', err.message);
  }
}

// Milliseconds until the next HH:00 in IST (duration is timezone-agnostic).
function msUntilNextIST(hour = 2) {
  const IST = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + IST);
  const target = new Date(nowIst);
  target.setUTCHours(hour, 0, 0, 0);
  if (target.getTime() <= nowIst.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - nowIst.getTime();
}

function startVehicleExpiryJob() {
  const schedule = () => {
    const delay = msUntilNextIST(2);
    console.log(`[VehicleExpiryJob] next run in ${(delay / 3600000).toFixed(1)}h (02:00 IST)`);
    setTimeout(() => {
      runVehicleExpiryCheck();
      setInterval(runVehicleExpiryCheck, 24 * 60 * 60 * 1000);
    }, delay);
  };
  schedule();
}

module.exports = { startVehicleExpiryJob, runVehicleExpiryCheck };
