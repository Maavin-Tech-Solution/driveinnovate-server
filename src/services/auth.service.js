const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Op, UniqueConstraintError } = require('sequelize');
const { User, UserMeta, UserActivity, AuthOtp } = require('../models');
const { getPermissions } = require('./permission.service');
const { getSystemSettings } = require('./master.service');

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

const generateOtp = () => `${Math.floor(100000 + Math.random() * 900000)}`;

/**
 * BFS to collect all descendant user IDs under rootId.
 * Uses batched IN-queries so depth=2 hierarchy = 2 SQL calls max.
 */
const getAllDescendants = async (rootId) => {
  const descendants = [];
  let batch = [rootId];
  while (batch.length > 0) {
    const children = await User.findAll({
      where: { parentId: batch },
      attributes: ['id'],
      raw: true,
    });
    if (!children.length) break;
    const childIds = children.map(c => c.id);
    descendants.push(...childIds);
    batch = childIds;
  }
  return descendants;
};

/**
 * Determine role + network for a user:
 *   papa   — parentId === 0 (top-level account)
 *   dealer — has children but parentId != 0
 *   client — no children
 * clientIds includes the user's own id + all descendant ids.
 */
const resolveUserRole = async (user) => {
  if (Number(user.parentId) === 0) {
    const descendants = await getAllDescendants(user.id);
    return { role: 'papa', hasClients: true, clientIds: [user.id, ...descendants] };
  }
  const childCount = await User.count({ where: { parentId: user.id } });
  if (childCount > 0) {
    const descendants = await getAllDescendants(user.id);
    return { role: 'dealer', hasClients: true, clientIds: [user.id, ...descendants] };
  }
  return { role: 'client', hasClients: false, clientIds: [user.id] };
};

const hashOtp = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');

const createTransporter = () => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_PORT || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const sendOtpEmail = async ({ email, otp, purpose }) => {
  const transporter = createTransporter();
  const subject =
    purpose === 'LOGIN' ? 'DriveInnovate Login OTP' : 'DriveInnovate Password Reset OTP';
  const text = `Your OTP is ${otp}. It is valid for ${OTP_EXPIRY_MINUTES} minutes.`;
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@driveinnovate.local';

  if (!transporter) {
    console.log(`[OTP:${purpose}] ${email} -> ${otp}`);
    return;
  }

  await transporter.sendMail({
    from: fromAddress,
    to: email,
    subject,
    text,
  });
};

const createOtpRecord = async ({ user, purpose }) => {
  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await AuthOtp.update(
    { consumedAt: new Date() },
    {
      where: {
        userId: user.id,
        purpose,
        consumedAt: null,
      },
    }
  );

  await AuthOtp.create({
    userId: user.id,
    email: user.email,
    purpose,
    otpHash,
    expiresAt,
  });

  return otp;
};

const getLatestActiveOtp = async ({ userId, email, purpose }) => {
  return AuthOtp.findOne({
    where: {
      userId,
      email,
      purpose,
      consumedAt: null,
      expiresAt: { [Op.gt]: new Date() },
    },
    order: [['created_at', 'DESC']],
  });
};

const register = async ({ name, email, password, phone, companyName, address, state, city, zip, country, businessCategory, gtin, accountType }) => {
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
    user = await User.create({ name, email, password: hashedPassword, phone, accountType: resolvedType, trialExpiresAt });
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

  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

  const { password: _, ...userWithoutPassword } = user.toJSON();
  return { user: userWithoutPassword, token };
};

const login = async ({ email, password, ipAddress, userAgent }) => {
  const user = await User.findOne({ where: { email } });
  if (!user) {
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  if (user.status !== 'active') {
    const err = new Error('Account is deactivated. Please contact support.');
    err.status = 403;
    throw err;
  }

  // Trial expiry check (only when feature is enabled)
  const loginSettings = await getSystemSettings();
  if (loginSettings.trialAccountEnabled && user.accountType === 'trial' && user.trialExpiresAt && new Date() > user.trialExpiresAt) {
    const err = new Error('Your trial account has expired. Please contact your dealer to upgrade.');
    err.status = 403;
    err.code = 'TRIAL_EXPIRED';
    throw err;
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    await UserActivity.create({
      userId: user.id,
      action: 'LOGIN_FAILED',
      description: 'Failed login attempt',
      ipAddress,
      userAgent,
      module: 'Auth',
      status: 'failure',
    });
    const err = new Error('Invalid email or password');
    err.status = 401;
    throw err;
  }

  await UserActivity.create({
    userId: user.id,
    action: 'LOGIN',
    description: 'User logged in successfully',
    ipAddress,
    userAgent,
    module: 'Auth',
    status: 'success',
  });

  const roleData = await resolveUserRole(user);
  const permissions = await getPermissions(user);

  const token = jwt.sign(
    { id: user.id, email: user.email, role: roleData.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  const { password: _, ...userWithoutPassword } = user.toJSON();
  return { user: { ...userWithoutPassword, ...roleData, permissions }, token };
};

const requestLoginOtp = async ({ email, ipAddress, userAgent }) => {
  const user = await User.findOne({ where: { email } });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (user.status !== 'active') {
    const err = new Error('Account is deactivated. Please contact support.');
    err.status = 403;
    throw err;
  }

  const otp = await createOtpRecord({ user, purpose: 'LOGIN' });
  await sendOtpEmail({ email: user.email, otp, purpose: 'LOGIN' });

  await UserActivity.create({
    userId: user.id,
    action: 'LOGIN_OTP_REQUESTED',
    description: 'OTP requested for login',
    ipAddress,
    userAgent,
    module: 'Auth',
    status: 'success',
  });

  const response = { message: 'OTP sent to your registered email' };
  if (process.env.NODE_ENV !== 'production') {
    response.devOtp = otp;
  }

  return response;
};

const verifyLoginOtp = async ({ email, otp, ipAddress, userAgent }) => {
  const user = await User.findOne({ where: { email } });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const otpRecord = await getLatestActiveOtp({ userId: user.id, email: user.email, purpose: 'LOGIN' });
  if (!otpRecord) {
    const err = new Error('No active OTP found or OTP expired');
    err.status = 400;
    throw err;
  }

  if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
    await otpRecord.update({ consumedAt: new Date() });
    const err = new Error('Maximum OTP attempts exceeded. Please request a new OTP.');
    err.status = 429;
    throw err;
  }

  const isMatch = otpRecord.otpHash === hashOtp(otp);
  if (!isMatch) {
    await otpRecord.update({ attempts: otpRecord.attempts + 1 });

    await UserActivity.create({
      userId: user.id,
      action: 'LOGIN_OTP_FAILED',
      description: 'Invalid OTP entered for login',
      ipAddress,
      userAgent,
      module: 'Auth',
      status: 'failure',
    });

    const err = new Error('Invalid OTP');
    err.status = 401;
    throw err;
  }

  await otpRecord.update({ consumedAt: new Date() });

  // Trial expiry check (only when feature is enabled)
  const otpLoginSettings = await getSystemSettings();
  if (otpLoginSettings.trialAccountEnabled && user.accountType === 'trial' && user.trialExpiresAt && new Date() > user.trialExpiresAt) {
    const err = new Error('Your trial account has expired. Please contact your dealer to upgrade.');
    err.status = 403;
    err.code = 'TRIAL_EXPIRED';
    throw err;
  }

  await UserActivity.create({
    userId: user.id,
    action: 'LOGIN_OTP_SUCCESS',
    description: 'User logged in with OTP',
    ipAddress,
    userAgent,
    module: 'Auth',
    status: 'success',
  });

  const roleData = await resolveUserRole(user);
  const permissions = await getPermissions(user);

  const token = jwt.sign(
    { id: user.id, email: user.email, role: roleData.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  const { password: _, ...userWithoutPassword } = user.toJSON();
  return { user: { ...userWithoutPassword, ...roleData, permissions }, token };
};

const requestForgotPasswordOtp = async ({ email, ipAddress, userAgent }) => {
  const user = await User.findOne({ where: { email } });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  if (user.status !== 'active') {
    const err = new Error('Account is deactivated. Please contact support.');
    err.status = 403;
    throw err;
  }

  const otp = await createOtpRecord({ user, purpose: 'FORGOT_PASSWORD' });
  await sendOtpEmail({ email: user.email, otp, purpose: 'FORGOT_PASSWORD' });

  await UserActivity.create({
    userId: user.id,
    action: 'FORGOT_PASSWORD_OTP_REQUESTED',
    description: 'OTP requested for password reset',
    ipAddress,
    userAgent,
    module: 'Auth',
    status: 'success',
  });

  const response = { message: 'Password reset OTP sent to your registered email' };
  if (process.env.NODE_ENV !== 'production') {
    response.devOtp = otp;
  }

  return response;
};

const resetPasswordWithOtp = async ({ email, otp, newPassword, ipAddress, userAgent }) => {
  const user = await User.findOne({ where: { email } });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const otpRecord = await getLatestActiveOtp({
    userId: user.id,
    email: user.email,
    purpose: 'FORGOT_PASSWORD',
  });

  if (!otpRecord) {
    const err = new Error('No active OTP found or OTP expired');
    err.status = 400;
    throw err;
  }

  if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
    await otpRecord.update({ consumedAt: new Date() });
    const err = new Error('Maximum OTP attempts exceeded. Please request a new OTP.');
    err.status = 429;
    throw err;
  }

  const isMatch = otpRecord.otpHash === hashOtp(otp);
  if (!isMatch) {
    await otpRecord.update({ attempts: otpRecord.attempts + 1 });
    const err = new Error('Invalid OTP');
    err.status = 401;
    throw err;
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await user.update({ password: hashedPassword });
  await otpRecord.update({ consumedAt: new Date() });

  await UserActivity.create({
    userId: user.id,
    action: 'PASSWORD_RESET',
    description: 'Password reset with OTP',
    ipAddress,
    userAgent,
    module: 'Auth',
    status: 'success',
  });

  return { message: 'Password reset successful' };
};

module.exports = {
  register,
  login,
  requestLoginOtp,
  verifyLoginOtp,
  requestForgotPasswordOtp,
  resetPasswordWithOtp,
  resolveUserRole,
};
