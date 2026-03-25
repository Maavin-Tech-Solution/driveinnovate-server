const { Op } = require('sequelize');
const { SupportTicket, Vehicle, VehicleGroup, User } = require('../models');
const { sendAlertEmail } = require('./email.service');

// ── Ticket number generator ───────────────────────────────────────────────────
/**
 * Generates the next sequential ticket number for the current month.
 * Format: TKT-YYYYMM-NNNN  e.g.  TKT-202603-0042
 */
async function generateTicketNumber() {
  const now = new Date();
  const prefix = `TKT-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;

  // Find the highest sequence for this month
  const last = await SupportTicket.findOne({
    where: { ticketNumber: { [Op.like]: `${prefix}%` } },
    order: [['ticketNumber', 'DESC']],
    attributes: ['ticketNumber'],
  });

  let seq = 1;
  if (last) {
    const parts = last.ticketNumber.split('-');
    seq = parseInt(parts[parts.length - 1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ── Issue type labels ─────────────────────────────────────────────────────────
const ISSUE_LABELS = {
  VEHICLE_TRACKING: 'Vehicle Tracking',
  GPS_DEVICE:       'GPS Device Issue',
  ACCOUNT:          'Account & Profile',
  BILLING:          'Billing & Subscription',
  REPORTS:          'Reports & Data',
  TECHNICAL:        'Technical / App Bug',
  OTHER:            'Other',
};

const PRIORITY_LABELS = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };
const STATUS_LABELS   = { OPEN: 'Open', IN_PROGRESS: 'In Progress', RESOLVED: 'Resolved', CLOSED: 'Closed' };

// ── Create ────────────────────────────────────────────────────────────────────
const createTicket = async (clientId, body, files = []) => {
  const { email, phone, alternatePhone, issueType, vehicleScope, vehicleId, groupId,
          subject, description, priority } = body;

  // Basic validation
  if (!email?.trim()) throw Object.assign(new Error('Email is required'), { status: 400 });
  if (!phone?.trim()) throw Object.assign(new Error('Phone is required'), { status: 400 });
  if (!issueType)     throw Object.assign(new Error('Issue type is required'), { status: 400 });
  if (!subject?.trim()) throw Object.assign(new Error('Subject is required'), { status: 400 });
  if (!description?.trim()) throw Object.assign(new Error('Description is required'), { status: 400 });

  // Ownership checks for vehicle / group
  if (issueType === 'VEHICLE_TRACKING' && vehicleScope === 'SINGLE' && vehicleId) {
    const v = await Vehicle.findOne({ where: { id: vehicleId, clientId } });
    if (!v) throw Object.assign(new Error('Vehicle not found'), { status: 404 });
  }
  if (issueType === 'VEHICLE_TRACKING' && vehicleScope === 'GROUP' && groupId) {
    const g = await VehicleGroup.findOne({ where: { id: groupId, clientId } });
    if (!g) throw Object.assign(new Error('Group not found'), { status: 404 });
  }

  // Build attachments array from multer files
  const attachments = files.map(f => ({
    filename:     f.filename,
    originalname: f.originalname,
    mimetype:     f.mimetype,
    size:         f.size,
    path:         `uploads/support/${f.filename}`,
  }));

  const ticketNumber = await generateTicketNumber();

  const ticket = await SupportTicket.create({
    ticketNumber,
    clientId,
    email:          email.trim(),
    phone:          phone.trim(),
    alternatePhone: alternatePhone?.trim() || null,
    issueType,
    vehicleScope:   issueType === 'VEHICLE_TRACKING' ? (vehicleScope || null) : null,
    vehicleId:      issueType === 'VEHICLE_TRACKING' && vehicleScope === 'SINGLE' ? (vehicleId || null) : null,
    groupId:        issueType === 'VEHICLE_TRACKING' && vehicleScope === 'GROUP'  ? (groupId  || null) : null,
    subject:        subject.trim(),
    description:    description.trim(),
    attachments,
    status:   'OPEN',
    priority: priority || 'MEDIUM',
  });

  // Send email notification (fire-and-forget)
  sendTicketEmail(ticket).catch(() => {});

  return ticket;
};

// ── Email ─────────────────────────────────────────────────────────────────────
async function sendTicketEmail(ticket) {
  const issueLabel    = ISSUE_LABELS[ticket.issueType]    || ticket.issueType;
  const priorityLabel = PRIORITY_LABELS[ticket.priority]  || ticket.priority;
  const priorityColor = { LOW: '#6b7280', MEDIUM: '#d97706', HIGH: '#dc2626', CRITICAL: '#7f1d1d' }[ticket.priority] || '#2563eb';
  const attachCount   = (ticket.attachments || []).length;

  const htmlBody = `
<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">
  <tr><td style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:24px 32px">
    <div style="font-size:22px;font-weight:800;color:#fff">🎫 New Support Ticket</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:4px">DriveInnovate Support Center</div>
  </td></tr>
  <tr><td style="padding:20px 32px 0">
    <div style="display:inline-block;background:#eff6ff;border:1px solid #bfdbfe;padding:6px 16px;border-radius:20px;font-size:18px;font-weight:800;color:#2563eb;letter-spacing:0.03em">${ticket.ticketNumber}</div>
  </td></tr>
  <tr><td style="padding:16px 32px">
    <div style="font-size:20px;font-weight:800;color:#0f172a;margin-bottom:6px">${ticket.subject}</div>
    <div style="display:inline-block;background:${priorityColor}18;color:${priorityColor};border:1px solid ${priorityColor}40;padding:3px 12px;border-radius:12px;font-size:11px;font-weight:700;text-transform:uppercase">${priorityLabel} Priority</div>
    &nbsp;
    <div style="display:inline-block;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;padding:3px 12px;border-radius:12px;font-size:11px;font-weight:700;text-transform:uppercase">OPEN</div>
  </td></tr>
  <tr><td style="padding:0 32px 20px">
    <table style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px" cellpadding="0" cellspacing="0">
      ${[
        ['Issue Type',   issueLabel],
        ['Contact Email', ticket.email],
        ['Phone',        ticket.phone],
        ['Alt. Phone',   ticket.alternatePhone || '—'],
        ['Attachments',  attachCount ? `${attachCount} file(s)` : 'None'],
        ['Submitted At', new Date(ticket.createdAt).toLocaleString('en-IN')],
      ].map(([k, v], i) => `
        <tr${i > 0 ? ' style="border-top:1px solid #e2e8f0"' : ''}>
          <td style="padding:7px 14px;color:#64748b;font-size:13px;font-weight:600;width:140px">${k}</td>
          <td style="padding:7px 14px;color:#0f172a;font-size:13px">${v}</td>
        </tr>`).join('')}
    </table>
  </td></tr>
  <tr><td style="padding:0 32px 20px">
    <div style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Description</div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;font-size:13px;color:#374151;line-height:1.7;white-space:pre-wrap">${ticket.description}</div>
  </td></tr>
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 32px">
    <div style="font-size:12px;color:#94a3b8">Automated notification from DriveInnovate Support Center. Ticket reference: <strong>${ticket.ticketNumber}</strong></div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  // Build recipients: stakeholders + the ticket submitter's email
  const stakeholders = (process.env.ALERT_STAKEHOLDER_EMAILS || 'smartchallan@gmail.com')
    .split(',').map(e => e.trim()).filter(Boolean);
  const all = [...new Set([...stakeholders, ticket.email])];
  const from = `"${process.env.EMAIL_FROM_NAME || 'DriveInnovate Support'}" <${process.env.EMAIL_USER || 'smartchallan@gmail.com'}>`;

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth:   { user: process.env.EMAIL_USER || '', pass: process.env.EMAIL_PASS || '' },
  });

  await transporter.sendMail({
    from,
    to: all.join(', '),
    subject: `[Support Ticket ${ticket.ticketNumber}] ${ticket.subject}`,
    html:    htmlBody,
  });
}

// ── Read ──────────────────────────────────────────────────────────────────────
const getTickets = async (clientId, { page = 0, limit = 20, status, issueType } = {}) => {
  const where = { clientId };
  if (status)    where.status    = status;
  if (issueType) where.issueType = issueType;

  const { count, rows } = await SupportTicket.findAndCountAll({
    where,
    include: [
      { model: Vehicle, as: 'vehicle', attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon'], required: false },
    ],
    order: [['createdAt', 'DESC']],
    limit:  parseInt(limit),
    offset: parseInt(page) * parseInt(limit),
  });
  return { tickets: rows, total: count };
};

const getTicketById = async (id, clientId) => {
  const ticket = await SupportTicket.findOne({
    where: { id, clientId },
    include: [
      { model: Vehicle, as: 'vehicle', attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon'], required: false },
    ],
  });
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });
  return ticket;
};

// ── Update status ─────────────────────────────────────────────────────────────
const updateTicketStatus = async (id, clientId, { status, priority, adminNotes }) => {
  const ticket = await SupportTicket.findOne({ where: { id, clientId } });
  if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });

  const updates = {};
  if (status)      { updates.status = status; if (status === 'RESOLVED') updates.resolvedAt = new Date(); if (status === 'CLOSED') updates.closedAt = new Date(); }
  if (priority)    updates.priority = priority;
  if (adminNotes !== undefined) updates.adminNotes = adminNotes;

  await ticket.update(updates);
  return ticket;
};

module.exports = { createTicket, getTickets, getTicketById, updateTicketStatus, ISSUE_LABELS, STATUS_LABELS, PRIORITY_LABELS };
