const express = require('express');
const router = express.Router();
const challanController = require('../controllers/challan.controller');
const validateConsumer = require('../middleware/validateConsumer');

// GET /api/challans - list all challans
router.get('/', validateConsumer, challanController.getChallans);

// GET /api/challans/:id - get challan by id
router.get('/:id', validateConsumer, challanController.getChallanById);

// POST /api/challans - create challan
router.post('/', validateConsumer, challanController.createChallan);

// PUT /api/challans/:id - update challan
router.put('/:id', validateConsumer, challanController.updateChallan);

// PUT /api/challans/:id/pay - mark challan as paid
router.put('/:id/pay', validateConsumer, challanController.payChallan);

// DELETE /api/challans/:id - delete challan
router.delete('/:id', validateConsumer, challanController.deleteChallan);

module.exports = router;
