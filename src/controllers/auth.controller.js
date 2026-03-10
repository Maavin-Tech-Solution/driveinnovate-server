const authService = require('../services/auth.service');

/**
 * POST /api/auth/register
 * Body: { name, email, password, phone }
 */
const register = async (req, res) => {
  try {
    const { name, email, password, phone, companyName, address, state, city, zip, country, businessCategory, gtin } = req.body;
    if (!name || !email || !password || !phone) {
      return res.status(400).json({ success: false, message: 'name, email, phone and password are required' });
    }
    const result = await authService.register({ name, email, password, phone, companyName, address, state, city, zip, country, businessCategory, gtin });
    return res.status(201).json({ success: true, message: 'Registration successful', data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'email and password are required' });
    }
    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    const result = await authService.login({ email, password, ipAddress, userAgent });
    return res.status(200).json({ success: true, message: 'Login successful', data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/auth/login-otp/request
 * Body: { email }
 */
const requestLoginOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    const result = await authService.requestLoginOtp({ email, ipAddress, userAgent });

    return res.status(200).json({ success: true, message: result.message, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/auth/login-otp/verify
 * Body: { email, otp }
 */
const verifyLoginOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'email and otp are required' });
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    const result = await authService.verifyLoginOtp({ email, otp, ipAddress, userAgent });

    return res.status(200).json({ success: true, message: 'Login successful', data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/auth/forgot-password/request-otp
 * Body: { email }
 */
const requestForgotPasswordOtp = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    const result = await authService.requestForgotPasswordOtp({ email, ipAddress, userAgent });

    return res.status(200).json({ success: true, message: result.message, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/auth/forgot-password/reset
 * Body: { email, otp, newPassword }
 */
const resetPasswordWithOtp = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'email, otp and newPassword are required' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, message: 'newPassword must be at least 6 characters' });
    }

    const ipAddress = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    const result = await authService.resetPasswordWithOtp({
      email,
      otp,
      newPassword,
      ipAddress,
      userAgent,
    });

    return res.status(200).json({ success: true, message: result.message, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = {
  register,
  login,
  requestLoginOtp,
  verifyLoginOtp,
  requestForgotPasswordOtp,
  resetPasswordWithOtp,
};
