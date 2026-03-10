const bcrypt = require('bcryptjs');
const { UniqueConstraintError } = require('sequelize');
const { User, UserMeta } = require('../models');

const getProfile = async (userId) => {
  const user = await User.findByPk(userId, { attributes: { exclude: ['password'] } });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return user;
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
  { name, email, phone, password, companyName, address, state, city, zip, country, businessCategory, gtin }
) => {
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    const err = new Error('Email is already registered');
    err.status = 409;
    throw err;
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  let user;
  try {
    user = await User.create({
      parentId: parentUserId,
      name,
      email,
      phone,
      password: hashedPassword,
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

module.exports = { getProfile, updateProfile, updatePassword, updateNotifications, createClient };
