/**
 * trialExpiryJob.js
 *
 * Runs once per day (at server start then every 24 hours).
 * Scans all trial accounts whose trialExpiresAt falls within the next
 * WARN_DAYS days and sends a warning email to the client, their dealer,
 * and the papa account.
 *
 * Requires trialAccountEnabled = true in SystemSetting to fire any emails.
 */

'use strict';

const { Op } = require('sequelize');
const { User } = require('../models');
const { getSystemSettings } = require('../services/master.service');
const { sendTrialExpiryWarningEmail } = require('../services/email.service');

const WARN_DAYS     = 7;   // warn when expiry is within this many days
const INTERVAL_MS   = 24 * 60 * 60 * 1000; // run daily

/**
 * Walk up the user hierarchy to find the direct dealer and the papa.
 * Papa is identified by parentId === 0.
 * Returns { dealer: User|null, papa: User|null }
 */
async function findAncestors(client) {
  if (!client.parentId) return { dealer: null, papa: null };

  const parent = await User.findByPk(client.parentId, { attributes: ['id', 'email', 'parentId'] });
  if (!parent) return { dealer: null, papa: null };

  // If the parent's parentId is 0, the parent IS the papa (direct client of papa)
  if (Number(parent.parentId) === 0) {
    return { dealer: null, papa: parent };
  }

  // Otherwise the parent is the dealer; find their papa
  const grandparent = await User.findByPk(parent.parentId, { attributes: ['id', 'email', 'parentId'] });
  return {
    dealer: parent,
    papa: grandparent?.parentId !== undefined ? grandparent : null,
  };
}

async function runTrialExpiryCheck() {
  try {
    const settings = await getSystemSettings();
    if (!settings.trialAccountEnabled) return; // feature disabled — skip

    const now      = new Date();
    const warnDate = new Date(now.getTime() + WARN_DAYS * 24 * 60 * 60 * 1000);

    // Find trial accounts expiring within the next WARN_DAYS days (and not yet expired)
    const expiring = await User.findAll({
      where: {
        accountType:    'trial',
        trialExpiresAt: { [Op.between]: [now, warnDate] },
        status:         'active',
      },
      attributes: ['id', 'name', 'email', 'parentId', 'trialExpiresAt'],
    });

    if (!expiring.length) return;

    console.log(`[TrialExpiryJob] Found ${expiring.length} trial account(s) expiring within ${WARN_DAYS} days`);

    for (const client of expiring) {
      const daysLeft = Math.ceil((new Date(client.trialExpiresAt) - now) / (24 * 60 * 60 * 1000));
      const { dealer, papa } = await findAncestors(client);

      await sendTrialExpiryWarningEmail({
        clientName:     client.name,
        clientEmail:    client.email,
        dealerEmail:    dealer?.email || null,
        papaEmail:      papa?.email   || null,
        trialExpiresAt: client.trialExpiresAt,
        daysLeft,
      });
    }
  } catch (err) {
    console.error('[TrialExpiryJob] Error during trial expiry check:', err.message);
  }
}

/**
 * Start the daily trial-expiry job.
 * Runs immediately on startup, then every 24 hours.
 */
function startTrialExpiryJob() {
  console.log('[TrialExpiryJob] Starting daily trial expiry check');
  runTrialExpiryCheck(); // immediate first run
  setInterval(runTrialExpiryCheck, INTERVAL_MS);
}

module.exports = { startTrialExpiryJob };
