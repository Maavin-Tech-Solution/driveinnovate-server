# GT06 GPS Device - Packet Types & Data Fields

## Overview
The GT06 GPS tracking device sends various packet types to the server. This document lists all packet types and the valuable data each contains.

---

## 📦 Packet Types Summary

| Protocol | Packet Type | Key Data | Frequency |
|----------|-------------|----------|-----------|
| `0x01` | LOGIN | IMEI, Device Model | Once per connection |
| `0x12` | LOCATION | GPS, Speed, ACC, Satellites | Every 10-30s |
| `0x13` | STATUS | Battery, GSM, Oil, Electric, Door, Alarms | On status change |
| `0x16` | ALARM | GPS + Alarm Type | On alarm trigger |
| `0x17` | GPS_ADDRESS_REQUEST | GPS coordinates | On request |
| `0x1A` | COMBINED_POSITIONING | GPS + LBS (Cell tower) | Every 10-30s |
| `0x22` | LOCATION_EXT | GPS + Defense + Charge status | Every 10-30s |
| `0x23` | HEARTBEAT | Voltage, GSM Signal | Every 60s |
| `0x26` | ONLINE_COMMAND | Server command response | On command |
| `0x2A` | TIMEZONE_LANGUAGE | Timezone, Language | On setting change |
| `0x80` | COMMAND_INFO | Command responses | On command |
| `0x94` | INFO_TRANSMISSION | Odometer, Voltage | Periodic/On request |
| `0x98` | SERVICE_EXTENSION | Extended services | Varies |

---

## 🔍 Detailed Packet Data

### 1. **LOGIN (0x01)**
**Purpose:** Device registration on connection

**Data Fields:**
- `imei` - Device IMEI (15 digits)
- `deviceId` - Device type identifier
- `deviceModel` - Device model (GT06, GT06N, GT02, GT06E, GT100)

**Use Case:** Device identification

---

### 2. **LOCATION (0x12)** ⭐
**Purpose:** Basic GPS location data

**Data Fields:**
- `timestamp` - GPS timestamp
- `latitude` - GPS latitude
- `longitude` - GPS longitude
- `speed` - Speed in km/h
- `course` - Direction (0-360°)
- `satellites` - Number of satellites
- `gpsFixed` - GPS fix status (true/false)
- `acc` - **Ignition status** (true=ON, false=OFF)
- `mcc`, `mnc`, `lac`, `cellId` - Cell tower info

**Use Case:** Real-time vehicle tracking

---

### 3. **STATUS (0x13)** ⭐
**Purpose:** Device status inquiry

**Data Fields:**
- `terminalInfo` - Status flags byte
- `oil` - **Fuel/Oil circuit** (true=ON, false=CUT)
- `electric` - **Electric circuit** (true=ON, false=CUT)
- `door` - **Door status** (true=OPEN, false=CLOSED)
- `acc` - **Ignition** (true=ON, false=OFF)
- `defense` - **Defense mode** (true=ARMED, false=DISARMED)
- `gpsTracking` - **GPS tracking** (true=ON, false=OFF)
- `batteryLevel` - **Battery percentage** (0-100%)
- `gsmSignal` - **GSM signal strength** (0-5)
- `alarm` - Alarm type if any

**Use Case:** Vehicle security status, battery monitoring

---

### 4. **ALARM (0x16)** ⭐
**Purpose:** Alarm notification with GPS data

**Data Fields:**
- All GPS data (same as LOCATION)
- `alarm` - **Alarm type:**
  - `SOS` - Emergency button pressed
  - `POWER_CUT` - External power disconnected
  - `VIBRATION` - Vibration detected
  - `OVERSPEED` - Speed limit exceeded
  - `MOVEMENT` - Unauthorized movement
  - `LOW_BATTERY` - Battery low
  - `GPS_ANTENNA_CUT` - GPS antenna disconnected
  - `SIM_CHANGE` - SIM card changed
  - Others: FENCE (enter/exit), GPS deadzone, etc.
- `oil`, `electric`, `door`, `defense` - Status flags

**Use Case:** Security alerts, theft prevention

---

### 5. **GPS_ADDRESS_REQUEST (0x17)**
**Purpose:** GPS coordinate request

**Data Fields:**
- Same basic GPS data as LOCATION

**Use Case:** On-demand location query

---

### 6. **COMBINED_POSITIONING (0x1A)**
**Purpose:** GPS + LBS (Cell tower) combined positioning

**Data Fields:**
- All GPS data
- `positioningType` - 'COMBINED'
- `satellites` - GPS satellite count
- `gsmSignal` - GSM signal strength
- Cell tower data (MCC, MNC, LAC, Cell ID)

**Use Case:** Positioning in areas with weak GPS

---

### 7. **LOCATION_EXT (0x22)** ⭐
**Purpose:** Extended location with additional status

**Data Fields:**
- All GPS data
- `satellites` - Satellite count
- `gsmSignal` - GSM signal strength
- `acc` - **Ignition status**
- `defense` - **Defense armed/disarmed**
- `charge` - **Charging status** (true=CHARGING, false=NOT CHARGING)
- Cell tower data

**Use Case:** Complete vehicle status with location

---

### 8. **HEARTBEAT (0x23)** ⭐
**Purpose:** Keep-alive signal with device status

**Data Fields:**
- `terminalInfo` - Terminal status byte
- `voltage` - **External power voltage** (in volts)
- `gsmSignal` - **GSM signal strength**
- `languageIdentifier` - Device language setting

**Use Case:** Connection health, power monitoring

---

### 9. **ONLINE_COMMAND (0x26)**
**Purpose:** Server command response

**Data Fields:**
- `commandType` - Type of command executed
- `commandLength` - Command data length

**Use Case:** Remote control confirmation

---

### 10. **TIMEZONE_LANGUAGE (0x2A)**
**Purpose:** Device timezone and language settings

**Data Fields:**
- `languageIdentifier` - Language code
- `timezoneOffset` - Timezone offset in half-hours

**Use Case:** Device configuration

---

### 11. **INFO_TRANSMISSION (0x94)** ⭐
**Purpose:** Information transmission (odometer, voltage, etc.)

**Data Fields:**
- `infoType` - Type of information
  - `0x01` - **Odometer/Mileage**
    - `odometer` - Total distance traveled (meters)
  - `0x05` - **External Power Voltage**
    - `voltage` - Power voltage in volts

**Use Case:** Trip tracking, power diagnostics

---

### 12. **COMMAND_INFO (0x80)**
**Purpose:** Command information and responses

**Use Case:** Command execution feedback

---

### 13. **SERVICE_EXTENSION (0x98)**
**Purpose:** Service extension features

**Use Case:** Extended device services

---

## 🎯 Most Valuable Data for UI Display

### **Dashboard / Status Card**
1. ✅ **Ignition Status** (`acc`)
   - Source: LOCATION, STATUS, ALARM, LOCATION_EXT
   - Display: ON/OFF with icon

2. ✅ **Battery Level** (`batteryLevel`)
   - Source: STATUS
   - Display: Percentage with battery icon

3. ✅ **External Voltage** (`voltage`)
   - Source: HEARTBEAT, INFO_TRANSMISSION
   - Display: XX.X V

4. ✅ **GSM Signal** (`gsmSignal`)
   - Source: STATUS, LOCATION_EXT, HEARTBEAT
   - Display: Signal bars (0-5)

5. ✅ **Speed** (`speed`)
   - Source: LOCATION, ALARM, LOCATION_EXT
   - Display: XX km/h

6. ✅ **GPS Satellites** (`satellites`)
   - Source: All location packets
   - Display: Number of satellites

### **Security Status**
7. ✅ **Oil/Fuel Circuit** (`oil`)
   - Source: STATUS, ALARM
   - Display: ON/CUT

8. ✅ **Electric Circuit** (`electric`)
   - Source: STATUS, ALARM
   - Display: ON/CUT

9. ✅ **Door Status** (`door`)
   - Source: STATUS, ALARM
   - Display: OPEN/CLOSED

10. ✅ **Defense Mode** (`defense`)
    - Source: STATUS, ALARM, LOCATION_EXT
    - Display: ARMED/DISARMED

11. ✅ **Charge Status** (`charge`)
    - Source: LOCATION_EXT
    - Display: CHARGING/NOT CHARGING

12. ✅ **GPS Tracking** (`gpsTracking`)
    - Source: STATUS
    - Display: ON/OFF

### **Trip Information**
13. ✅ **Odometer** (`odometer`)
    - Source: INFO_TRANSMISSION (0x94, type 0x01)
    - Display: Total km traveled

### **Alerts**
14. ✅ **Active Alarms** (`alarm`)
    - Source: ALARM, STATUS
    - Display: Alarm type and icon

---

## 🔄 Recommended /sync API Enhancement

### Fetch Latest of Each Important Packet Type:

```javascript
// Fetch latest packets for comprehensive vehicle status
const packets = await Promise.all([
  Location.findOne({ imei, packetType: 'LOCATION' }).sort({ timestamp: -1 }).lean(),
  Location.findOne({ imei, packetType: 'LOCATION_EXT' }).sort({ timestamp: -1 }).lean(),
  Location.findOne({ imei, packetType: 'STATUS' }).sort({ timestamp: -1 }).lean(),
  Location.findOne({ imei, packetType: 'HEARTBEAT' }).sort({ timestamp: -1 }).lean(),
  Location.findOne({ imei, packetType: 'INFO_TRANSMISSION', 'data.infoType': 0x01 }).sort({ timestamp: -1 }).lean(),
  Location.findOne({ imei, packetType: 'INFO_TRANSMISSION', 'data.infoType': 0x05 }).sort({ timestamp: -1 }).lean(),
  Location.findOne({ imei, packetType: 'ALARM' }).sort({ timestamp: -1 }).lean(),
]);
```

### Aggregate Data for UI:
```javascript
{
  gpsData: { latitude, longitude, speed, satellites, timestamp },
  status: {
    ignition: acc,
    battery: batteryLevel,
    voltage: voltage,
    gsmSignal: gsmSignal,
    charging: charge,
    defense: defense,
    oil: oil,
    electric: electric,
    door: door,
    gpsTracking: gpsTracking
  },
  trip: {
    odometer: odometer
  },
  alerts: {
    latestAlarm: alarm,
    alarmTimestamp: timestamp
  }
}
```

---

## 📊 Data Freshness

| Packet Type | Typical Frequency | Importance |
|-------------|-------------------|------------|
| LOCATION/LOCATION_EXT | 10-30 seconds | High |
| HEARTBEAT | 60 seconds | Medium |
| STATUS | On change | High |
| ALARM | On event | Critical |
| INFO_TRANSMISSION | Periodic/On request | Medium |

**Strategy:** Return the latest available data from each packet type, even if timestamps differ. This gives the most complete current status.

---

## 🎨 UI Display Recommendations

### Status Icons
- 🔑 Ignition: Engine icon (green=ON, gray=OFF)
- 🔋 Battery: Battery icon with percentage
- ⚡ Voltage: Lightning bolt with value
- 📶 Signal: Signal bars (1-5)
- 🚗 Speed: Speedometer
- 🛰️ Satellites: Satellite icon with count
- ⛽ Fuel: Fuel pump icon
- 🔌 Electric: Plug icon
- 🚪 Door: Door icon
- 🛡️ Defense: Shield icon
- 🔌 Charging: Charging icon
- ⚠️ Alarm: Bell icon (red when active)

---

**Summary:** By fetching latest packets of types **LOCATION_EXT**, **STATUS**, **HEARTBEAT**, and **INFO_TRANSMISSION** during /sync, we can provide a comprehensive real-time dashboard showing vehicle status, security, battery, and trip information!
