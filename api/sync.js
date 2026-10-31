const https = require('https');

const FIRESTORE_API_KEY = process.env.FIRESTORE_API_KEY || process.env.FIREBASE_API_KEY || "AIzaSyDIc44Bwr6J67PsngXXT85CFSaGCy1xUuQ";
const PROJECT_ID = process.env.FIRESTORE_PROJECT_ID || "apexcrm-f4d3a";
const SYNC_API_KEY = process.env.QALOON_SYNC_SECRET || "qal365_x7Kp2wQ9Lz4VrT8m";
const ALLOWED_ORIGINS = (process.env.QALOON_ALLOWED_ORIGINS || "*").split(',').map(o => o.trim()).filter(Boolean);
const MAX_PAYLOAD_BYTES = 200 * 1024; // 200 KB
const SYNC_ID_REGEX = /^[A-Z0-9-]{4,32}$/;

// Warm cache across lambdas
let memoryCache = {};

function requestFirestore(docPath, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}?key=${FIRESTORE_API_KEY}`;
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsedBody = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: parsedBody });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error('Firestore timeout'));
    });

    if (data) req.write(data);
    req.end();
  });
}

function fail(res, status, error) {
  return res.status(status).json({ success: false, error });
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (origin) {
    // Origin non autorisée : pas de header CORS retourné (le navigateur bloquera la réponse)
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-api-key'
  );

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return fail(res, 405, 'Method not allowed');
  }

  // Authentification requise pour toutes les opérations (lecture et écriture)
  const providedKey = (req.headers['x-api-key'] || '').trim();
  if (!SYNC_API_KEY || providedKey !== SYNC_API_KEY) {
    return fail(res, 401, 'Unauthorized');
  }

  try {
    if (req.method === 'GET') {
      const syncId = (req.query ? req.query.syncId : '') || '';
      const cleanSyncId = syncId.trim().toUpperCase();

      if (!cleanSyncId) {
        return fail(res, 400, 'Missing syncId parameter');
      }
      if (!SYNC_ID_REGEX.test(cleanSyncId)) {
        return fail(res, 400, 'Invalid syncId format');
      }

      if (memoryCache[cleanSyncId] && memoryCache[cleanSyncId].data) {
        return res.status(200).json({
          success: true,
          found: true,
          syncId: cleanSyncId,
          data: memoryCache[cleanSyncId].data,
          updatedAt: memoryCache[cleanSyncId].updatedAt
        });
      }

      const docPath = `adhkar/hifdh_${encodeURIComponent(cleanSyncId)}`;
      const result = await requestFirestore(docPath, 'GET');

      if (result.status === 200 && result.data && result.data.fields) {
        const fields = result.data.fields;
        let parsedData = null;
        if (fields.payload && fields.payload.stringValue) {
          try {
            parsedData = JSON.parse(fields.payload.stringValue);
          } catch(e) {
            parsedData = fields.payload.stringValue;
          }
        }
        const updatedAt = fields.updatedAt ? fields.updatedAt.stringValue : new Date().toISOString();

        if (parsedData) {
          memoryCache[cleanSyncId] = { data: parsedData, updatedAt };
          return res.status(200).json({
            success: true,
            found: true,
            syncId: cleanSyncId,
            data: parsedData,
            updatedAt: updatedAt
          });
        }
      }

      return fail(res, 404, `No cloud backup found for Sync ID: ${cleanSyncId}`);
    }

    if (req.method === 'POST') {
      let payload = req.body;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (e) {
          return fail(res, 400, 'Invalid JSON payload');
        }
      }

      const { syncId, data } = payload || {};
      if (!syncId || !data) {
        return fail(res, 400, 'Missing syncId or data in request body');
      }

      const cleanSyncId = String(syncId).trim().toUpperCase();
      if (!SYNC_ID_REGEX.test(cleanSyncId)) {
        return fail(res, 400, 'Invalid syncId format');
      }

      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return fail(res, 400, 'Invalid data payload (object expected)');
      }

      let rawSize = 0;
      try {
        rawSize = Buffer.byteLength(JSON.stringify(data));
      } catch (e) {
        return fail(res, 400, 'Invalid data payload (not serializable)');
      }
      if (rawSize > MAX_PAYLOAD_BYTES) {
        return fail(res, 413, 'Payload too large');
      }

      const now = new Date().toISOString();

      memoryCache[cleanSyncId] = {
        data,
        updatedAt: now
      };

      const firestoreBody = JSON.stringify({
        fields: {
          syncId: { stringValue: cleanSyncId },
          payload: { stringValue: JSON.stringify(data) },
          updatedAt: { stringValue: now }
        }
      });

      const docPath = `adhkar/hifdh_${encodeURIComponent(cleanSyncId)}`;
      await requestFirestore(docPath, 'PATCH', firestoreBody);

      return res.status(200).json({
        success: true,
        message: 'Progression synchronisée dans le Cloud avec succès',
        syncId: cleanSyncId,
        updatedAt: now
      });
    }
  } catch (error) {
    console.error('Serverless Sync Error:', error);
    return fail(res, 500, 'Internal server error');
  }
};