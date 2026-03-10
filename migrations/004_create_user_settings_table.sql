-- Create user_settings table for storing user-level vehicle configurations
CREATE TABLE IF NOT EXISTS user_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    
    -- Speed range configuration (JSON array of {min, max, color, label})
    -- Example: [{"min": 0, "max": 10, "color": "#22c55e", "label": "Idle"}, ...]
    speed_ranges JSON DEFAULT NULL COMMENT 'Speed ranges with color coding',
    
    -- Speed threshold for alerts (in km/h)
    speed_threshold INT DEFAULT 80 COMMENT 'Alert if vehicle exceeds this speed',
    
    -- Future settings can be added here
    -- idle_timeout INT DEFAULT 300 COMMENT 'Idle timeout in seconds',
    -- geofence_alerts BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE KEY unique_user_settings (user_id),
    FOREIGN KEY (user_id) REFERENCES di_user(id) ON DELETE CASCADE,
    
    -- Indexes
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default settings for existing users
INSERT INTO user_settings (user_id, speed_ranges, speed_threshold)
SELECT 
    id as user_id,
    JSON_ARRAY(
        JSON_OBJECT('min', 0, 'max', 10, 'color', '#22c55e', 'label', 'Idle'),
        JSON_OBJECT('min', 10, 'max', 40, 'color', '#3b82f6', 'label', 'Slow'),
        JSON_OBJECT('min', 40, 'max', 80, 'color', '#f59e0b', 'label', 'Normal'),
        JSON_OBJECT('min', 80, 'max', 120, 'color', '#ef4444', 'label', 'Fast'),
        JSON_OBJECT('min', 120, 'max', 999, 'color', '#dc2626', 'label', 'Overspeed')
    ) as speed_ranges,
    80 as speed_threshold
FROM di_user
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings WHERE user_settings.user_id = di_user.id
);
