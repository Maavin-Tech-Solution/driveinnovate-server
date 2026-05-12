/**
 * SmartChallan external API proxy service.
 *
 * Handles authentication (token cache, auto-refresh on expiry) and
 * proxies the three SmartChallan endpoints to the client application.
 *
 * Token lifetime is 12 h per the SmartChallan API spec.  We refresh
 * 5 minutes before expiry so callers never get a stale token.
 */

const axios = require('axios');

const SC_BASE = 'https://api.smartchallan.com';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;   // 12 h
const REFRESH_BEFORE_MS = 5 * 60 * 1000;      // refresh 5 min before expiry

// Per-user token cache: userId → { token, expiresAt }
const _tokenCache = new Map();

async function _getToken(userId, username, password) {
  const cached = _tokenCache.get(userId);
  if (cached && Date.now() < cached.expiresAt - REFRESH_BEFORE_MS) {
    return cached.token;
  }

  const res = await axios.post(
    `${SC_BASE}/auth/login`,
    { email: username, password },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10_000 }
  );

  const token = res.data?.token;
  if (!token) throw new Error('SmartChallan login did not return a token');

  _tokenCache.set(userId, {
    token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return token;
}

async function _paginate(url, token) {
  let page = 1;
  const all = [];
  while (true) {
    const res = await axios.get(`${url}?page=${page}&limit=300`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
    });
    const { data = [], meta } = res.data;
    all.push(...data);
    if (!meta?.hasNext) break;
    page++;
  }
  return all;
}

const getRtoData = async (userId, username, password) => {
  const token = await _getToken(userId, username, password);
  return _paginate(`${SC_BASE}/api/rto-data`, token);
};

const getChallanData = async (userId, username, password) => {
  const token = await _getToken(userId, username, password);
  return _paginate(`${SC_BASE}/api/challan-data`, token);
};

const testCredentials = async (username, password) => {
  const res = await axios.post(
    `${SC_BASE}/auth/login`,
    { email: username, password },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10_000 }
  );
  return !!res.data?.token;
};

module.exports = { getRtoData, getChallanData, testCredentials };
