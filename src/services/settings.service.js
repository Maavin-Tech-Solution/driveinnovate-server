const { UserSettings } = require('../models');

/**
 * Get user settings
 */
const getUserSettings = async (userId) => {
  let settings = await UserSettings.findOne({ where: { userId } });
  
  // Create default settings if none exist
  if (!settings) {
    settings = await UserSettings.create({
      userId,
      speedRanges: [
        { min: 0, max: 10, color: '#22c55e', label: 'Idle' },
        { min: 10, max: 40, color: '#3b82f6', label: 'Slow' },
        { min: 40, max: 80, color: '#f59e0b', label: 'Normal' },
        { min: 80, max: 120, color: '#ef4444', label: 'Fast' },
        { min: 120, max: 999, color: '#dc2626', label: 'Overspeed' },
      ],
      speedThreshold: 80,
    });
  }
  
  return settings;
};

/**
 * Update user settings
 */
const updateUserSettings = async (userId, data) => {
  const { speedRanges, speedThreshold } = data;
  
  // Validate speed ranges
  if (speedRanges) {
    if (!Array.isArray(speedRanges)) {
      const err = new Error('speedRanges must be an array');
      err.status = 400;
      throw err;
    }
    
    // Validate each range
    for (const range of speedRanges) {
      if (
        typeof range.min !== 'number' ||
        typeof range.max !== 'number' ||
        !range.color ||
        !range.label
      ) {
        const err = new Error('Each speed range must have min, max, color, and label');
        err.status = 400;
        throw err;
      }
      
      if (range.min >= range.max) {
        const err = new Error('Range min must be less than max');
        err.status = 400;
        throw err;
      }
    }
  }
  
  // Validate speed threshold
  if (speedThreshold !== undefined && (typeof speedThreshold !== 'number' || speedThreshold < 0)) {
    const err = new Error('speedThreshold must be a positive number');
    err.status = 400;
    throw err;
  }
  
  let settings = await UserSettings.findOne({ where: { userId } });
  
  if (settings) {
    // Update existing settings
    await settings.update({
      ...(speedRanges && { speedRanges }),
      ...(speedThreshold !== undefined && { speedThreshold }),
    });
  } else {
    // Create new settings
    settings = await UserSettings.create({
      userId,
      speedRanges: speedRanges || [
        { min: 0, max: 10, color: '#22c55e', label: 'Idle' },
        { min: 10, max: 40, color: '#3b82f6', label: 'Slow' },
        { min: 40, max: 80, color: '#f59e0b', label: 'Normal' },
        { min: 80, max: 120, color: '#ef4444', label: 'Fast' },
        { min: 120, max: 999, color: '#dc2626', label: 'Overspeed' },
      ],
      speedThreshold: speedThreshold !== undefined ? speedThreshold : 80,
    });
  }
  
  return settings;
};

/**
 * Reset user settings to defaults
 */
const resetUserSettings = async (userId) => {
  const defaultSettings = {
    speedRanges: [
      { min: 0, max: 10, color: '#22c55e', label: 'Idle' },
      { min: 10, max: 40, color: '#3b82f6', label: 'Slow' },
      { min: 40, max: 80, color: '#f59e0b', label: 'Normal' },
      { min: 80, max: 120, color: '#ef4444', label: 'Fast' },
      { min: 120, max: 999, color: '#dc2626', label: 'Overspeed' },
    ],
    speedThreshold: 80,
  };
  
  let settings = await UserSettings.findOne({ where: { userId } });
  
  if (settings) {
    await settings.update(defaultSettings);
  } else {
    settings = await UserSettings.create({ userId, ...defaultSettings });
  }
  
  return settings;
};

module.exports = {
  getUserSettings,
  updateUserSettings,
  resetUserSettings,
};
