const { submitContactEnquiry } = require('../services/contact.service');

exports.submit = async (req, res, next) => {
  try {
    const result = await submitContactEnquiry(req.body || {});
    res.json({ success: true, message: "Thanks! We'll get back to you within 24 hours.", ...result });
  } catch (err) {
    next(err);
  }
};
