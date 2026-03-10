const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// POST /api/auth/register
router.post('/register', authController.register);

// POST /api/auth/login
router.post('/login', authController.login);

// POST /api/auth/login-otp/request
router.post('/login-otp/request', authController.requestLoginOtp);

// POST /api/auth/login-otp/verify
router.post('/login-otp/verify', authController.verifyLoginOtp);

// POST /api/auth/forgot-password/request-otp
router.post('/forgot-password/request-otp', authController.requestForgotPasswordOtp);

// POST /api/auth/forgot-password/reset
router.post('/forgot-password/reset', authController.resetPasswordWithOtp);

module.exports = router;
