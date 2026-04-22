const nodemailer = require('nodemailer');

/**
 * Reusable transporter — created once, reused for all sends.
 * Configure via environment variables:
 *   EMAIL_HOST       — SMTP host (default: smtp.gmail.com)
 *   EMAIL_PORT       — SMTP port (default: 587)
 *   EMAIL_USER       — SMTP username / from address
 *   EMAIL_PASS       — SMTP password / app password
 *   EMAIL_FROM_NAME  — Display name (default: DriveInnovate Alerts)
 *
 * Stakeholders that receive every alert email:
 *   ALERT_STAKEHOLDER_EMAILS — comma-separated list (default: smartchallan@gmail.com)
 */

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    name:   process.env.EMAIL_HELO_HOST || undefined,
    auth: {
      user: process.env.EMAIL_USER || '',
      pass: process.env.EMAIL_PASS || '',
    },
  });
  return _transporter;
}

function getFromAddress(fallbackName = 'DriveInnovate') {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  const user = process.env.EMAIL_USER || 'no-reply@driveinnovate.in';
  const name = process.env.EMAIL_FROM_NAME || fallbackName;
  return `"${name}" <${user}>`;
}

/**
 * Get the full list of stakeholder emails for a given alert.
 * Merges env-level default with any per-alert extra emails.
 * @param {string|null} extraEmails — comma-separated from Alert.notifyEmails
 * @returns {string[]} de-duped list of email addresses
 */
function getRecipients(extraEmails = '') {
  const defaults = (process.env.ALERT_STAKEHOLDER_EMAILS || 'smartchallan@gmail.com')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);
  const extras = (extraEmails || '')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);
  return [...new Set([...defaults, ...extras])];
}

/**
 * Send an alert notification email.
 * @param {object} opts
 * @param {string} opts.subject
 * @param {string} opts.htmlBody
 * @param {string|null} [opts.extraEmails]
 */
async function sendAlertEmail({ subject, htmlBody, extraEmails = '' }) {
  const recipients = getRecipients(extraEmails);
  if (!recipients.length) return;

  const from = getFromAddress('DriveInnovate Alerts');

  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from,
      to: recipients.join(', '),
      subject,
      html: htmlBody,
    });
    console.log(`[Email] Alert sent to: ${recipients.join(', ')} | ${subject}`);
    return true;
  } catch (err) {
    console.error('[Email] Failed to send alert email:', err.message);
    return false;
  }
}

/**
 * Build a styled HTML email body for an alert notification.
 */
function buildAlertEmailHtml({ alertName, alertType, vehicleNumber, vehicleName, message, triggeredAt, metadata }) {
  const typeColor = {
    SPEED_EXCEEDED: '#dc2626',
    NOT_MOVING:     '#d97706',
    IDLE_ENGINE:    '#7c3aed',
  }[alertType] || '#2563eb';

  const typeLabel = {
    SPEED_EXCEEDED: 'Speed Exceeded',
    NOT_MOVING:     'Vehicle Not Moving',
    IDLE_ENGINE:    'Engine Idle',
  }[alertType] || alertType;

  const metaRows = metadata ? Object.entries({
    'Speed':       metadata.speed != null ? `${metadata.speed} km/h` : null,
    'Location':    metadata.lat && metadata.lng ? `${metadata.lat.toFixed(5)}, ${metadata.lng.toFixed(5)}` : null,
    'Packet Time': metadata.packetTime ? new Date(metadata.packetTime).toLocaleString('en-IN') : null,
  }).filter(([, v]) => v).map(([k, v]) => `
    <tr>
      <td style="padding:6px 12px;color:#64748b;font-size:13px;font-weight:600;width:130px">${k}</td>
      <td style="padding:6px 12px;color:#0f172a;font-size:13px">${v}</td>
    </tr>`).join('') : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:24px 32px">
            <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em">🚨 DriveInnovate Alert</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px">Automated fleet monitoring notification</div>
          </td>
        </tr>
        <!-- Alert badge -->
        <tr>
          <td style="padding:24px 32px 0">
            <span style="display:inline-block;background:${typeColor}18;color:${typeColor};border:1px solid ${typeColor}40;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase">${typeLabel}</span>
          </td>
        </tr>
        <!-- Title -->
        <tr>
          <td style="padding:16px 32px 0">
            <div style="font-size:20px;font-weight:800;color:#0f172a">${alertName}</div>
            <div style="font-size:15px;color:#374151;margin-top:8px">${message}</div>
          </td>
        </tr>
        <!-- Vehicle info -->
        <tr>
          <td style="padding:20px 32px">
            <table style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;width:100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:6px 12px;color:#64748b;font-size:13px;font-weight:600;width:130px">Vehicle No.</td>
                <td style="padding:6px 12px;color:#0f172a;font-size:13px;font-weight:700">${vehicleNumber || '—'}</td>
              </tr>
              <tr style="border-top:1px solid #e2e8f0">
                <td style="padding:6px 12px;color:#64748b;font-size:13px;font-weight:600">Vehicle Name</td>
                <td style="padding:6px 12px;color:#0f172a;font-size:13px">${vehicleName || '—'}</td>
              </tr>
              ${metaRows}
              <tr style="border-top:1px solid #e2e8f0">
                <td style="padding:6px 12px;color:#64748b;font-size:13px;font-weight:600">Triggered At</td>
                <td style="padding:6px 12px;color:#0f172a;font-size:13px">${new Date(triggeredAt).toLocaleString('en-IN')}</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px">
            <div style="font-size:12px;color:#94a3b8">This is an automated alert from DriveInnovate Fleet Management. Please do not reply to this email.</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Send a trial expiry warning email.
 * @param {object} opts
 * @param {string}   opts.clientName
 * @param {string}   opts.clientEmail
 * @param {string}   opts.dealerEmail    — may be null if client is direct under papa
 * @param {string}   opts.papaEmail      — top-level admin email
 * @param {Date}     opts.trialExpiresAt
 * @param {number}   opts.daysLeft
 */
async function sendTrialExpiryWarningEmail({ clientName, clientEmail, dealerEmail, papaEmail, trialExpiresAt, daysLeft }) {
  const recipients = [...new Set([clientEmail, dealerEmail, papaEmail].filter(Boolean))];
  if (!recipients.length) return;

  const from = getFromAddress('DriveInnovate');
  const expiryStr = new Date(trialExpiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const urgencyColor = daysLeft <= 2 ? '#dc2626' : daysLeft <= 4 ? '#d97706' : '#2563eb';

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:24px 32px">
            <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.02em">⏳ Trial Expiry Notice</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px">DriveInnovate Fleet Management</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px">
            <span style="display:inline-block;background:${urgencyColor}18;color:${urgencyColor};border:1px solid ${urgencyColor}40;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase">
              ${daysLeft === 0 ? 'Expires Today' : `${daysLeft} Day${daysLeft === 1 ? '' : 's'} Left`}
            </span>
            <div style="font-size:20px;font-weight:800;color:#0f172a;margin-top:16px">Trial Account Expiring Soon</div>
            <div style="font-size:15px;color:#374151;margin-top:8px;line-height:1.6">
              The trial account for <strong>${clientName}</strong> will expire on <strong>${expiryStr}</strong>.
              After expiry, the account will not be able to login until it is upgraded to a billable plan.
            </div>
            <table style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;width:100%;margin-top:20px" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:8px 14px;color:#64748b;font-size:13px;font-weight:600;width:140px">Account</td>
                <td style="padding:8px 14px;color:#0f172a;font-size:13px;font-weight:700">${clientName}</td>
              </tr>
              <tr style="border-top:1px solid #e2e8f0">
                <td style="padding:8px 14px;color:#64748b;font-size:13px;font-weight:600">Email</td>
                <td style="padding:8px 14px;color:#0f172a;font-size:13px">${clientEmail}</td>
              </tr>
              <tr style="border-top:1px solid #e2e8f0">
                <td style="padding:8px 14px;color:#64748b;font-size:13px;font-weight:600">Expires On</td>
                <td style="padding:8px 14px;color:${urgencyColor};font-size:13px;font-weight:700">${expiryStr}</td>
              </tr>
            </table>
            <div style="margin-top:24px;padding:16px 20px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe">
              <div style="font-size:13px;font-weight:700;color:#1d4ed8;margin-bottom:6px">Action Required</div>
              <div style="font-size:13px;color:#1e40af;line-height:1.6">
                Please log in to the DriveInnovate dashboard and upgrade this account to a billable plan (3 months, 6 months, or 1 year) to continue uninterrupted access.
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px">
            <div style="font-size:12px;color:#94a3b8">This is an automated notification from DriveInnovate Fleet Management. Please do not reply to this email.</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const transporter = getTransporter();
    await transporter.sendMail({ from, to: recipients.join(', '), subject: `[Action Required] Trial account for ${clientName} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, html: htmlBody });
    console.log(`[Email] Trial expiry warning sent to: ${recipients.join(', ')} | client: ${clientName}`);
    return true;
  } catch (err) {
    console.error('[Email] Failed to send trial expiry warning:', err.message);
    return false;
  }
}

module.exports = { sendAlertEmail, buildAlertEmailHtml, getRecipients, sendTrialExpiryWarningEmail, getTransporter, getFromAddress };
