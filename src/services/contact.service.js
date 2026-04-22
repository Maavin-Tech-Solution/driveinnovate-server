const { getTransporter, getFromAddress } = require('./email.service');

const DASHBOARD_URL = 'https://app.driveinnovate.in';
const SUPPORT_PHONE = '+91 93154 89988';
const SUPPORT_EMAIL = 'support@driveinnovate.in';
const COMPANY_NAME  = process.env.COMPANY_NAME || 'DriveInnovate';

const FLEET_LABELS = {
  '1-10':  '1 – 10 vehicles',
  '11-50': '11 – 50 vehicles',
  '51-200': '51 – 200 vehicles',
  '200+':  '200+ vehicles',
};

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nl2br(str = '') {
  return escapeHtml(str).replace(/\r?\n/g, '<br/>');
}

function getContactRecipients() {
  const list = (process.env.CONTACT_RECIPIENTS || 'smartchallan@gmail.com')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);
  return [...new Set(list)];
}

// ── Logo block (text-only, matches website navbar) ─────────────────────────────
function logoBlock() {
  return `
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr>
        <td style="background:linear-gradient(135deg,#2563eb,#06b6d4);background-color:#2563eb;width:44px;height:44px;border-radius:10px;text-align:center;vertical-align:middle;font-family:'Segoe UI',Arial,sans-serif;font-weight:800;font-size:15px;color:#ffffff;letter-spacing:0.02em">DI</td>
        <td style="padding-left:12px;font-family:'Segoe UI',Arial,sans-serif;font-weight:700;font-size:20px;letter-spacing:-0.02em;color:#ffffff;white-space:nowrap">
          Drive<span style="color:#7dd3fc">Innovate</span>
        </td>
      </tr>
    </table>`;
}

// ── Stakeholder notification template ──────────────────────────────────────────
function buildInquiryHtml({ name, email, company, fleet, device, message, submittedAt }) {
  const fleetLabel = FLEET_LABELS[fleet] || fleet || '—';
  const rows = [
    ['Full Name',  escapeHtml(name)],
    ['Email',      `<a href="mailto:${escapeHtml(email)}" style="color:#2563eb;text-decoration:none">${escapeHtml(email)}</a>`],
    ['Company',    escapeHtml(company) || '—'],
    ['Fleet Size', escapeHtml(fleetLabel)],
    ['Device',     escapeHtml(device) || '—'],
    ['Submitted',  escapeHtml(submittedAt)],
  ].map(([k, v]) => `
    <tr>
      <td style="padding:10px 14px;color:#64748b;font-size:13px;font-weight:600;width:130px;border-bottom:1px solid #e2e8f0">${k}</td>
      <td style="padding:10px 14px;color:#0f172a;font-size:13px;border-bottom:1px solid #e2e8f0">${v}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);max-width:620px">
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f,#2563eb);background-color:#1e3a5f;padding:24px 32px">
            ${logoBlock()}
            <div style="margin-top:18px;font-size:13px;color:rgba(255,255,255,0.80);letter-spacing:0.04em;text-transform:uppercase;font-weight:600">New Contact Enquiry</div>
            <div style="margin-top:4px;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.02em">Someone wants to talk fleet</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 8px">
            <div style="font-size:14px;color:#475569;line-height:1.6">
              A new lead has submitted the contact form on
              <a href="https://driveinnovate.in" style="color:#2563eb;text-decoration:none;font-weight:600">driveinnovate.in</a>.
              Reach out within 24 hours to keep response rate high.
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 8px">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
              ${rows}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 32px 4px">
            <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Message</div>
            <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;font-size:14px;color:#0f172a;line-height:1.65">
              ${nl2br(message)}
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 28px">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:10px;background:#2563eb">
                  <a href="mailto:${escapeHtml(email)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;font-family:'Segoe UI',Arial,sans-serif">Reply to ${escapeHtml(name.split(' ')[0] || 'Lead')} →</a>
                </td>
                <td style="width:10px"></td>
                <td style="border-radius:10px;background:#ffffff;border:1px solid #e2e8f0">
                  <a href="tel:${SUPPORT_PHONE.replace(/\s/g,'')}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#0f172a;text-decoration:none;font-family:'Segoe UI',Arial,sans-serif">Call Lead</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px">
            <div style="font-size:12px;color:#94a3b8;line-height:1.5">
              Automated notification from ${escapeHtml(COMPANY_NAME)} · driveinnovate.in<br/>
              Dashboard · <a href="${DASHBOARD_URL}" style="color:#2563eb;text-decoration:none">${DASHBOARD_URL}</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Customer thank-you template ────────────────────────────────────────────────
function buildThankYouHtml({ name, device, fleet }) {
  const firstName = escapeHtml((name || '').trim().split(/\s+/)[0] || 'there');
  const fleetLabel = FLEET_LABELS[fleet] || fleet || null;

  const highlight = [
    fleetLabel ? `<strong style="color:#0f172a">${escapeHtml(fleetLabel)}</strong>` : null,
    device ? `<strong style="color:#0f172a">${escapeHtml(device)}</strong> devices` : null,
  ].filter(Boolean).join(' · ');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:36px 0">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(2,6,23,0.45);max-width:620px">
        <!-- Hero -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 55%,#06b6d4 100%);background-color:#2563eb;padding:36px 36px 32px">
            ${logoBlock()}
            <div style="margin-top:28px;display:inline-block;background:rgba(255,255,255,0.15);color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:5px 12px;border-radius:20px">Message Received</div>
            <div style="margin-top:14px;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;line-height:1.2">Thanks, ${firstName}! 👋</div>
            <div style="margin-top:10px;font-size:15px;color:rgba(255,255,255,0.85);line-height:1.6">
              Your enquiry just landed with our fleet team.<br/>
              A human (not a bot) will reach out within <strong style="color:#ffffff">24 hours</strong>.
            </div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:30px 36px 8px">
            <div style="font-size:15px;color:#334155;line-height:1.7">
              We've got your message${highlight ? ` — noted ${highlight}` : ''}.
              While our team preps a tailored response, feel free to explore the live dashboard or reach out directly.
            </div>
          </td>
        </tr>

        <!-- Dashboard CTA card -->
        <tr>
          <td style="padding:20px 36px 8px">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#eff6ff,#ecfeff);background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:14px">
              <tr>
                <td style="padding:22px 24px">
                  <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#2563eb">Live App Dashboard</div>
                  <div style="margin-top:6px;font-size:18px;font-weight:800;color:#0f172a;letter-spacing:-0.01em">See your fleet in real time</div>
                  <div style="margin-top:6px;font-size:13px;color:#475569;line-height:1.6">
                    Log in or request demo access — live tracking, reports, geofences and alerts, all in one place.
                  </div>
                  <div style="margin-top:16px">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="border-radius:10px;background:#2563eb">
                          <a href="${DASHBOARD_URL}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;font-family:'Segoe UI',Arial,sans-serif">Open Dashboard →</a>
                        </td>
                      </tr>
                    </table>
                  </div>
                  <div style="margin-top:10px;font-size:12px;color:#64748b">
                    <a href="${DASHBOARD_URL}" style="color:#2563eb;text-decoration:none">${DASHBOARD_URL}</a>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Contact details -->
        <tr>
          <td style="padding:20px 36px 8px">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:10px">Need us sooner?</div>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="50%" style="padding-right:8px;vertical-align:top">
                  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
                    <tr>
                      <td style="padding:16px 18px">
                        <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Call us</div>
                        <a href="tel:${SUPPORT_PHONE.replace(/\s/g,'')}" style="display:block;margin-top:4px;font-size:16px;font-weight:700;color:#0f172a;text-decoration:none">${SUPPORT_PHONE}</a>
                        <div style="margin-top:4px;font-size:12px;color:#64748b">Mon – Sat · 10 AM – 7 PM IST</div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="50%" style="padding-left:8px;vertical-align:top">
                  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
                    <tr>
                      <td style="padding:16px 18px">
                        <div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Email us</div>
                        <a href="mailto:${SUPPORT_EMAIL}" style="display:block;margin-top:4px;font-size:15px;font-weight:700;color:#2563eb;text-decoration:none;word-break:break-all">${SUPPORT_EMAIL}</a>
                        <div style="margin-top:4px;font-size:12px;color:#64748b">Usually replies within 2 hrs</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Why us -->
        <tr>
          <td style="padding:22px 36px 10px">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:12px">Why teams choose ${escapeHtml(COMPANY_NAME)}</div>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${[
                ['⚡', 'Real-time tracking', 'WebSocket-powered live updates'],
                ['🛰️', 'Multi-protocol', 'GT06, Teltonika FMB, AIS140 supported'],
                ['📊', 'Rich analytics', 'Trips, stops, violations & CSV export'],
                ['🔔', 'Smart alerts', 'Speed, geofence & ignition alerts'],
              ].map(([icon, title, sub]) => `
              <tr>
                <td style="padding:8px 0">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:36px;height:36px;background:#eff6ff;border-radius:10px;text-align:center;vertical-align:middle;font-size:16px">${icon}</td>
                      <td style="padding-left:14px">
                        <div style="font-size:14px;font-weight:700;color:#0f172a">${title}</div>
                        <div style="font-size:12px;color:#64748b;margin-top:2px">${sub}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`).join('')}
            </table>
          </td>
        </tr>

        <!-- Sign off -->
        <tr>
          <td style="padding:22px 36px 28px">
            <div style="font-size:14px;color:#334155;line-height:1.7">
              Cheers,<br/>
              <strong style="color:#0f172a">The ${escapeHtml(COMPANY_NAME)} Team</strong>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0f172a;padding:20px 36px;text-align:center">
            <div style="font-size:12px;color:rgba(255,255,255,0.55);line-height:1.6">
              You're receiving this because you contacted us via driveinnovate.in<br/>
              <a href="${DASHBOARD_URL}" style="color:#60a5fa;text-decoration:none">${DASHBOARD_URL}</a>
              &nbsp;·&nbsp;
              <a href="mailto:${SUPPORT_EMAIL}" style="color:#60a5fa;text-decoration:none">${SUPPORT_EMAIL}</a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Main entry ────────────────────────────────────────────────────────────────
async function submitContactEnquiry(formData) {
  const name    = (formData.name || '').trim();
  const email   = (formData.email || '').trim();
  const company = (formData.company || '').trim();
  const fleet   = (formData.fleet || '').trim();
  const device  = (formData.device || '').trim();
  const message = (formData.message || '').trim();

  if (!name)    throw Object.assign(new Error('Name is required'), { status: 400 });
  if (!email)   throw Object.assign(new Error('Email is required'), { status: 400 });
  if (!message) throw Object.assign(new Error('Message is required'), { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('Invalid email address'), { status: 400 });
  }

  const submittedAt = new Date().toLocaleString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  }) + ' IST';

  const transporter = getTransporter();
  const from = getFromAddress(process.env.COMPANY_NAME || 'DriveInnovate');
  const stakeholders = getContactRecipients();

  const inquiryHtml = buildInquiryHtml({ name, email, company, fleet, device, message, submittedAt });
  const thankYouHtml = buildThankYouHtml({ name, device, fleet });

  const firstName = name.split(/\s+/)[0] || 'Lead';
  const subjectInquiry = `[Contact] ${firstName}${company ? ` · ${company}` : ''}${fleet ? ` · ${FLEET_LABELS[fleet] || fleet}` : ''}`;
  const subjectThanks  = `Thanks for reaching out to ${process.env.COMPANY_NAME || 'DriveInnovate'}`;

  const sends = [];

  if (stakeholders.length) {
    sends.push(
      transporter.sendMail({
        from,
        to: stakeholders.join(', '),
        replyTo: `"${name}" <${email}>`,
        subject: subjectInquiry,
        html: inquiryHtml,
      }).then(() => console.log(`[Contact] Inquiry sent to: ${stakeholders.join(', ')}`))
        .catch(err => console.error('[Contact] Inquiry email failed:', err.message))
    );
  }

  sends.push(
    transporter.sendMail({
      from,
      to: `"${name}" <${email}>`,
      subject: subjectThanks,
      html: thankYouHtml,
    }).then(() => console.log(`[Contact] Thank-you sent to: ${email}`))
      .catch(err => console.error('[Contact] Thank-you email failed:', err.message))
  );

  await Promise.all(sends);

  return { success: true, submittedAt };
}

module.exports = { submitContactEnquiry };
