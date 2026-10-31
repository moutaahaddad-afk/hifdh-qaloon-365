const https = require('https');

const FIRESTORE_API_KEY = process.env.FIRESTORE_API_KEY || process.env.FIREBASE_API_KEY || "AIzaSyDIc44Bwr6J67PsngXXT85CFSaGCy1xUuQ";
const PROJECT_ID = process.env.FIRESTORE_PROJECT_ID || "apexcrm-f4d3a";
const SYNC_API_KEY = process.env.QALOON_SYNC_SECRET || "qal365_x7Kp2wQ9Lz4VrT8m";
const MAX_PAYLOAD_BYTES = 200 * 1024; // 200 KB
const SYNC_ID_REGEX = /^[A-Z0-9-]{4,32}$/;

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

exports.handler = async (event, context) => {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '*';
  
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  // Vérification de la clé API
  const providedKey = (event.headers && (event.headers['x-api-key'] || event.headers['X-Api-Key']) || '').trim();
  if (SYNC_API_KEY && providedKey !== SYNC_API_KEY) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ success: false, error: 'Unauthorized' })
    };
  }

  try {
    // Traitement GET (récupération de la sauvegarde)
    if (event.httpMethod === 'GET') {
      const query = event.queryStringParameters || {};
      const syncId = (query.syncId || '').trim().toUpperCase();

      if (!syncId || !SYNC_ID_REGEX.test(syncId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid or missing syncId parameter' })
        };
      }

      if (memoryCache[syncId] && memoryCache[syncId].data) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            found: true,
            syncId: syncId,
            data: memoryCache[syncId].data,
            updatedAt: memoryCache[syncId].updatedAt
          })
        };
      }

      const docPath = `adhkar/hifdh_${encodeURIComponent(syncId)}`;
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
          memoryCache[syncId] = { data: parsedData, updatedAt };
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              found: true,
              syncId: syncId,
              data: parsedData,
              updatedAt: updatedAt
            })
          };
        }
      }

      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: `No cloud backup found for Sync ID: ${syncId}` })
      };
    }

    // Traitement POST (sauvegarde dans le cloud)
    if (event.httpMethod === 'POST') {
      let bodyObj = {};
      try {
        const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
        bodyObj = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      } catch (e) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid JSON payload' })
        };
      }

      const syncId = (bodyObj.syncId || '').trim().toUpperCase();
      const payloadData = bodyObj.data;

      if (!syncId || !SYNC_ID_REGEX.test(syncId)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Invalid or missing syncId' })
        };
      }

      if (!payloadData) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'Missing data to backup' })
        };
      }

      const payloadStr = JSON.stringify(payloadData);
      if (Buffer.byteLength(payloadStr) > MAX_PAYLOAD_BYTES) {
        return {
          statusCode: 413,
          headers,
          body: JSON.stringify({ success: false, error: 'Payload exceeds size limit (200KB)' })
        };
      }

      const now = new Date().toISOString();
      const firestoreBody = JSON.stringify({
        fields: {
          syncId: { stringValue: syncId },
          payload: { stringValue: payloadStr },
          updatedAt: { stringValue: now }
        }
      });

      const docPath = `adhkar/hifdh_${encodeURIComponent(syncId)}`;
      const result = await requestFirestore(docPath, 'PATCH', firestoreBody);

      if (result.status === 200) {
        memoryCache[syncId] = { data: payloadData, updatedAt: now };
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            syncId: syncId,
            updatedAt: now,
            message: 'Backup successfully synchronized to cloud'
          })
        };
      }

      return {
        statusCode: result.status || 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Failed to write to Firestore backend' })
      };
    }
  } catch (err) {
    console.error('[Netlify Sync Function Error]:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message || 'Internal server error' })
    };
  }
};
