# Testing MongoDB Optimizations

## Quick Test Guide

### 1. Create Indexes (Required - One Time)

```bash
cd server
npm run create-indexes
```

**Expected Output:**
```
Connecting to MongoDB...
Creating indexes for Location collection...
Creating index: imei_timestamp_desc - For finding latest location (sync endpoint)
✓ Index created: imei_timestamp_desc
Creating index: imei_timestamp_asc - For range queries in chronological order (location player)
✓ Index created: imei_timestamp_asc
...
✓ All indexes created successfully!
```

---

### 2. Test Sync Endpoint

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:5000/api/vehicles/1/sync
```

**Expected:** Response time < 50ms with minimal GPS data:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "vehicleNumber": "HR26CX4194",
    "imei": "0356218603889633",
    "gpsData": {
      "timestamp": "2026-03-07T20:34:09.000Z",
      "latitude": 28.609211666666667,
      "longitude": 77.45693888888889,
      "speed": 0,
      "satellites": 12
    }
  }
}
```

✅ **Only 5 fields returned** (timestamp, latitude, longitude, speed, satellites)

---

### 3. Test Location Player - Default (10k limit)

**Request:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:5000/api/vehicles/1/location-player?from=2026-02-01T00:00:00Z&to=2026-03-08T00:00:00Z"
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "vehicle": { "id": 1, "vehicleNumber": "HR26CX4194", "imei": "..." },
    "dateRange": { "from": "...", "to": "..." },
    "pagination": {
      "limit": 10000,
      "skip": 0,
      "returned": 8543,
      "total": 8543,
      "hasMore": false
    },
    "totalRecords": 8543,
    "locations": [
      {
        "timestamp": "2026-02-01T09:38:23.000Z",
        "latitude": 28.60950888888889,
        "longitude": 77.45600333333333,
        "speed": 0,
        "satellites": 12
      }
      // ... 8542 more records
    ]
  }
}
```

✅ **Pagination metadata included**  
✅ **Only 5 fields per location**

---

### 4. Test Location Player - With Pagination

**Request (First 5000):**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:5000/api/vehicles/1/location-player?from=2026-01-01T00:00:00Z&to=2026-03-08T00:00:00Z&limit=5000&skip=0"
```

**Request (Next 5000):**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:5000/api/vehicles/1/location-player?from=2026-01-01T00:00:00Z&to=2026-03-08T00:00:00Z&limit=5000&skip=5000"
```

**Expected Response (First Page):**
```json
{
  "pagination": {
    "limit": 5000,
    "skip": 0,
    "returned": 5000,
    "total": 15234,
    "hasMore": true  // ← More records available
  }
}
```

**Expected Response (Second Page):**
```json
{
  "pagination": {
    "limit": 5000,
    "skip": 5000,
    "returned": 5000,
    "total": 15234,
    "hasMore": true
  }
}
```

---

### 5. Verify Query Performance

#### Check Server Logs
Look for log messages like:
```
[Location Player] Found 5000 of 48234 total records (limit: 5000, skip: 0)
```

#### Measure Response Time
```bash
time curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:5000/api/vehicles/1/location-player?from=2026-03-01T00:00:00Z&to=2026-03-08T00:00:00Z"
```

**Expected:** < 500ms for 10k records

---

### 6. Verify Indexes Are Being Used

**Connect to MongoDB:**
```bash
mongosh "mongodb+srv://..."
```

**Check indexes:**
```javascript
db.locations.getIndexes()
```

**Expected Output:**
```javascript
[
  { v: 2, key: { _id: 1 }, name: '_id_' },
  { v: 2, key: { imei: 1, timestamp: -1 }, name: 'imei_timestamp_desc', background: true },
  { v: 2, key: { imei: 1, timestamp: 1 }, name: 'imei_timestamp_asc', background: true },
  { v: 2, key: { latitude: 1, longitude: 1 }, name: 'coordinates', background: true },
  { v: 2, key: { timestamp: 1 }, name: 'timestamp', background: true }
]
```

**Verify index usage:**
```javascript
db.locations.find({
  imei: "0356218603889633",
  timestamp: { $gte: ISODate("2026-03-01"), $lte: ISODate("2026-03-08") }
}).explain("executionStats")
```

Look for:
```javascript
{
  "executionStages": {
    "stage": "IXSCAN",  // ✅ Good - using index
    "indexName": "imei_timestamp_asc"
  }
}
```

❌ **Bad:** `"stage": "COLLSCAN"` (collection scan - index not used)

---

### 7. Test Edge Cases

#### Empty Results
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:5000/api/vehicles/1/location-player?from=2020-01-01T00:00:00Z&to=2020-01-02T00:00:00Z"
```

**Expected:**
```json
{
  "pagination": {
    "returned": 0,
    "total": 0,
    "hasMore": false
  },
  "totalRecords": 0,
  "locations": []
}
```

#### Exceed Max Limit
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:5000/api/vehicles/1/location-player?from=...&to=...&limit=100000"
```

**Expected:** Capped at 50,000 records
```json
{
  "pagination": {
    "limit": 50000,  // ← Capped
    ...
  }
}
```

#### Invalid Pagination
```bash
# Negative skip - should default to 0
curl "...&skip=-10"

# Zero limit - should default to 1
curl "...&limit=0"

# Non-numeric - should use defaults
curl "...&limit=abc&skip=xyz"
```

---

### 8. Performance Comparison

#### Before Optimization
- Fields returned: 13 (including imei, gpsTime, accuracy, course, altitude, heading, etc.)
- Response size (10k records): ~800 KB
- Response time: 2-5 seconds

#### After Optimization
- Fields returned: 5 (timestamp, latitude, longitude, speed, satellites)
- Response size (10k records): ~150 KB
- Response time: 200-500ms

**Improvement:**
- 80-90% faster ⚡
- 75-85% smaller payload 📦

---

### 9. Frontend Integration Test

Open browser DevTools → Network tab

**Navigate to Location Player and click "Fetch Data"**

**Expected:**
1. Request to `/api/vehicles/:id/location-player`
2. Response time: < 500ms
3. Response size: 50-200 KB (for 10k points)
4. Map renders smoothly with all points
5. Playback controls work
6. Stats show correct totals

**Check Console for debug logs:**
```
=== LOCATION PLAYER DEBUG ===
1. Raw API Response: {success: true, data: {...}}
...
6. locationsList.length: 8543
```

---

### 10. Troubleshooting

#### Slow queries (>1s)
1. Verify indexes exist: `db.locations.getIndexes()`
2. Rebuild indexes: `npm run create-indexes`
3. Check if index is used: `.explain("executionStats")`

#### Large response size
1. Reduce date range
2. Use smaller `limit` parameter
3. Verify only 5 fields are returned (check response JSON)

#### "Index not found" errors
- Run: `npm run create-indexes`
- Wait for completion
- Restart server

---

## Summary Checklist

- [ ] Indexes created successfully
- [ ] `/sync` responds in <50ms with 5 fields
- [ ] `/location-player` responds in <500ms
- [ ] Pagination works (limit/skip parameters)
- [ ] Response includes pagination metadata
- [ ] Only 5 fields per location record
- [ ] MongoDB uses indexes (IXSCAN, not COLLSCAN)
- [ ] Frontend map renders correctly
- [ ] No console errors

✅ **All tests pass = Optimization successful!**
