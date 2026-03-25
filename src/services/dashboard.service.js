const { Vehicle, Challan, RtoDetail, VehicleGroup } = require('../models');
const { Op } = require('sequelize');
const { Location } = require('../config/mongodb');

const getStats = async (userId) => {
  const vehicles = await Vehicle.findAll({ where: { userId } });
  const vehicleIds = vehicles.map((v) => v.id);

  const [totalChallans, pendingChallans, challanAmountResult, vehicleRenewals] = await Promise.all([
    Challan.count({ where: { vehicleId: { [Op.in]: vehicleIds } } }),
    Challan.count({ where: { vehicleId: { [Op.in]: vehicleIds }, status: 'pending' } }),
    Challan.sum('amount', { where: { vehicleId: { [Op.in]: vehicleIds }, status: 'pending' } }),
    RtoDetail.count({
      where: {
        vehicleId: { [Op.in]: vehicleIds },
        [Op.or]: [
          { insuranceExpiry: { [Op.lt]: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } },
          { roadTaxExpiry: { [Op.lt]: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } },
          { fitnessExpiry: { [Op.lt]: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } },
          { pollutionExpiry: { [Op.lt]: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } },
        ],
      },
    }),
  ]);

  return {
    registeredVehicles: vehicles.length,
    totalChallans,
    pendingChallans,
    totalChallanAmount: challanAmountResult || 0,
    vehicleRenewals,
  };
};

const getUserStats = async (userId) => {
  const vehicles = await Vehicle.findAll({ where: { clientId: userId }, attributes: ['id', 'status'] });
  const vehicleIds = vehicles.map((v) => v.id);

  const activeVehicles   = vehicles.filter((v) => v.status === 'active').length;
  const inactiveVehicles = vehicles.filter((v) => v.status === 'inactive').length;
  const deletedVehicles  = vehicles.filter((v) => v.status === 'deleted').length;

  const [pendingChallans, upcomingRenewals] = vehicleIds.length
    ? await Promise.all([
        Challan.count({ where: { vehicleId: { [Op.in]: vehicleIds }, status: 'pending' } }),
        RtoDetail.count({
          where: {
            vehicleId: { [Op.in]: vehicleIds },
            [Op.or]: [
              { insuranceExpiry: { [Op.lt]: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } },
              { roadTaxExpiry:   { [Op.lt]: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } },
              { fitnessExpiry:   { [Op.lt]: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } },
              { pollutionExpiry: { [Op.lt]: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } },
            ],
          },
        }),
      ])
    : [0, 0];

  return {
    registeredVehicles: vehicles.length,
    vehicleStatusWise: {
      active: activeVehicles,
      inactive: inactiveVehicles,
      deleted: deletedVehicles,
    },
    pendingChallans,
    upcomingRenewals,
  };
};

/**
 * Get vehicles that exceeded speed threshold in last 24 hours
 * @param {number} userId - User ID
 * @param {number} speedThreshold - Speed threshold in km/h
 * @returns {Promise<Array>} Array of vehicles with overspeed details
 */
const getOverspeedVehicles = async (userId, speedThreshold = 80) => {
  try {
    // Get user's active vehicles
    const vehicles = await Vehicle.findAll({ 
      where: { 
        clientId: userId,
        status: 'active'
      },
      attributes: ['id', 'vehicleNumber', 'imei']
    });

    if (!vehicles.length) {
      return [];
    }

    // Get IMEIs
    const imeis = vehicles.map(v => v.imei).filter(Boolean);
    if (!imeis.length) {
      return [];
    }

    // Query MongoDB for locations in last 24 hours with speed > threshold
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const overspeedRecords = await Location.aggregate([
      {
        $match: {
          imei: { $in: imeis },
          timestamp: { $gte: last24Hours },
          speed: { $gt: speedThreshold }
        }
      },
      {
        $group: {
          _id: '$imei',
          maxSpeed: { $max: '$speed' },
          lastOverspeedTime: { $max: '$timestamp' },
          overspeedCount: { $sum: 1 }
        }
      }
    ]);

    // Map results to vehicles
    const overspeedVehicles = [];
    for (const record of overspeedRecords) {
      const vehicle = vehicles.find(v => v.imei === record._id);
      if (vehicle) {
        overspeedVehicles.push({
          id: vehicle.id,
          vehicleNumber: vehicle.vehicleNumber,
          imei: vehicle.imei,
          maxSpeed: Math.round(record.maxSpeed),
          lastOverspeedTime: record.lastOverspeedTime,
          overspeedCount: record.overspeedCount,
          speedThreshold
        });
      }
    }

    return overspeedVehicles;
  } catch (error) {
    console.error('Error fetching overspeed vehicles:', error);
    throw error;
  }
};

module.exports = { getStats, getUserStats, getOverspeedVehicles };
