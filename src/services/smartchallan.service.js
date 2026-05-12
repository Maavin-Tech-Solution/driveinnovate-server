/**
 * SmartChallan external API proxy service.
 *
 * Handles authentication (token cache, auto-refresh on expiry) and
 * proxies the three SmartChallan endpoints to the client application.
 *
 * Token lifetime is 12 h per the SmartChallan API spec.  We refresh
 * 5 minutes before expiry so callers never get a stale token.
 */

const http  = require('http');
const https = require('https');
const url   = require('url');

// SC_API_URL can be set in server .env — defaults to http://api.technoton.co.in:4001
const SC_API_URL  = process.env.SC_API_URL || 'http://api.technoton.co.in:4001';
const _parsed     = url.parse(SC_API_URL);
const SC_PROTOCOL = _parsed.protocol === 'https:' ? 'https' : 'http';
const SC_BASE_HOST = _parsed.hostname;
const SC_BASE_PORT = parseInt(_parsed.port || (SC_PROTOCOL === 'https' ? '443' : '80'), 10);
const TOKEN_TTL_MS    = 12 * 60 * 60 * 1000;
const REFRESH_BEFORE_MS = 5 * 60 * 1000;

console.log(`[SmartChallan] API base: ${SC_PROTOCOL}://${SC_BASE_HOST}:${SC_BASE_PORT}`);

const _tokenCache = new Map();

function _request(method, path, body, headers = {}, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: SC_BASE_HOST,
      port: SC_BASE_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    };
    console.log(`[SC] → ${method} ${SC_PROTOCOL}://${SC_BASE_HOST}:${SC_BASE_PORT}${path}`);
    const transport = SC_PROTOCOL === 'https' ? https : http;
    const req = transport.request(opts, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        console.log(`[SC] ← ${res.statusCode} ${path} (${raw.length} bytes)`);
        try {
          const data = JSON.parse(raw);
          if (res.statusCode >= 400) {
            const err = new Error(data?.message || `HTTP ${res.statusCode}`);
            err.status = res.statusCode; err.response = { data };
            return reject(err);
          }
          resolve(data);
        } catch (e) { reject(new Error(`Invalid JSON from SC API: ${raw.slice(0, 100)}`)); }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      console.error(`[SC] TIMEOUT after ${timeoutMs}ms — ${SC_BASE_HOST}:${SC_BASE_PORT} unreachable`);
      reject(new Error(`SmartChallan API unreachable (${SC_BASE_HOST}:${SC_BASE_PORT}) — check network/firewall`));
    });
    req.on('error', (e) => {
      console.error(`[SC] ERROR ${path}:`, e.message);
      reject(e);
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function _getToken(userId, username, password) {
  const cached = _tokenCache.get(userId);
  if (cached && Date.now() < cached.expiresAt - REFRESH_BEFORE_MS) return cached.token;
  const data = await _request('POST', '/auth/login', { email: username, password });
  const token = data?.token;
  if (!token) throw new Error('SmartChallan login did not return a token');
  _tokenCache.set(userId, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

async function _paginate(path, token) {
  let page = 1;
  const all = [];
  while (true) {
    const res = await _request('GET', `${path}?page=${page}&limit=300`, null, { Authorization: `Bearer ${token}` });
    const { data = [], meta } = res;
    all.push(...data);
    if (!meta?.hasNext) break;
    page++;
  }
  return all;
}

const getRtoData = async (userId, username, password) => {
  const token = await _getToken(userId, username, password);
  return _paginate('/api/rto-data', token);
};

const getChallanData = async (userId, username, password) => {
  const token = await _getToken(userId, username, password);
  return _paginate('/api/challan-data', token);
};

const testCredentials = async (username, password) => {
  const data = await _request('POST', '/auth/login', { email: username, password });
  return !!data?.token;
};

module.exports = { getRtoData, getChallanData, testCredentials };
