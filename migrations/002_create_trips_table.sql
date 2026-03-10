-- Create trips table for storing vehicle trip data
CREATE TABLE IF NOT EXISTS trips (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id INT NOT NULL,
    imei VARCHAR(20),
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    duration INT NOT NULL COMMENT 'Duration in seconds',
    distance DECIMAL(10, 2) NOT NULL COMMENT 'Distance in kilometers',
    start_latitude DECIMAL(10, 7) NOT NULL,
    start_longitude DECIMAL(10, 7) NOT NULL,
    end_latitude DECIMAL(10, 7) NOT NULL,
    end_longitude DECIMAL(10, 7) NOT NULL,
    avg_speed DECIMAL(6, 2) DEFAULT 0 COMMENT 'Average speed in km/h',
    max_speed DECIMAL(6, 2) DEFAULT 0 COMMENT 'Maximum speed in km/h',
    idle_time INT DEFAULT 0 COMMENT 'Idle time during trip in seconds',
    fuel_consumed DECIMAL(8, 2) DEFAULT 0 COMMENT 'Fuel consumed in liters',
    route_data JSON COMMENT 'Array of route points with lat, lng, time, speed',
    start_location VARCHAR(255),
    end_location VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign key
    FOREIGN KEY (vehicle_id) REFERENCES di_user_vehicle(id) ON DELETE CASCADE,
    
    -- Indexes for better query performance
    INDEX idx_vehicle_start_time (vehicle_id, start_time),
    INDEX idx_imei_start_time (imei, start_time),
    INDEX idx_start_time (start_time),
    INDEX idx_end_time (end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
