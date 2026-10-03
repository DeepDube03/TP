/**
 * ============================================================================
 * DOCDON - Official Backend Server (Node.js Built-in Zero-Dependency Server)
 * ============================================================================
 * Provides real HTTP REST API endpoints and static file serving:
 * - POST /api/requests
 * - GET  /api/requests/:id
 * - GET  /api/requests
 * - POST /api/documents/upload
 * - GET  /api/documents/:id
 * - GET  /api/documents
 * - POST /api/documents/:id/verify
 * - GET  /api/documents/:id/verification
 * - POST /api/documents/:id/review
 * - POST /api/requests/:id/share
 * - GET  /api/audit/:requestId
 * - GET  /api/audit
 * - GET  /api/advisor/checklist
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// Load Docdon Backend Module
const DocdonBackend = require('./docdon-backend.js');
const api = DocdonBackend.api;

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const SESSION_SECRET = process.env.DOCDON_SESSION_SECRET || crypto.randomBytes(32);
const REVIEWER_ROLES = new Set(['admin', 'reviewer', 'compliance_officer']);

function accountKeyForUser(user) {
  return Object.keys(DocdonBackend.database.data.users || {}).find(key => DocdonBackend.database.data.users[key] === user) || String(user?.email_or_phone || '').toLowerCase();
}

function issueSession(user) {
  const payload = Buffer.from(JSON.stringify({
    userId: accountKeyForUser(user), userRecordId: user.id, role: user.role || 'student', exp: Date.now() + 12 * 60 * 60 * 1000
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSession(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch (e) { return null; }
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.userId || !session.exp || session.exp <= Date.now()) return null;
    const user = DocdonBackend.database.getUser(session.userId);
    if (!user || user.id !== session.userRecordId) return null;
    return { ...session, user };
  } catch (e) { return null; }
}

function canAccessDocument(session, document, allowReviewer = true) {
  if (!session || !document) return false;
  if (String(session.userId).toLowerCase() === String(document.owner_id || '').toLowerCase()) return true;
  return allowReviewer && REVIEWER_ROLES.has(String(session.user.role || '').toLowerCase());
}

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data, null, 2));
}

function parseRequestBody(req) {
  return new Promise((resolve) => {
    let body = '';
    let receivedBytes = 0;
    let bodyTooLarge = false;
    const maxBodyBytes = 36 * 1024 * 1024; // accommodates a 25MB file encoded as base64 JSON
    req.on('data', chunk => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBodyBytes) {
        bodyTooLarge = true;
        body = '';
        return;
      }
      if (!bodyTooLarge) body += chunk.toString();
    });
    req.on('end', () => {
      if (bodyTooLarge) {
        resolve({ __bodyTooLarge: true });
        return;
      }
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE, PATCH',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // ==========================================================================
  // REST API ROUTING LAYER
  // ==========================================================================
  const isApiRoute = pathname.startsWith('/api/') || 
    pathname.startsWith('/requirements') || 
    pathname.startsWith('/document-checklist') || 
    pathname.startsWith('/document-progress') || 
    pathname.startsWith('/roadmap') || 
    pathname.startsWith('/profile') || 
    pathname.startsWith('/advisor/') || 
    (pathname.startsWith('/documents/') && (method === 'DELETE' || method === 'PATCH' || method === 'POST' || pathname.endsWith('/status') || pathname.endsWith('/check')));

  if (isApiRoute) {
    const apiPath = pathname.startsWith('/api/') ? pathname : ('/api' + (pathname.startsWith('/') ? pathname : '/' + pathname));
    const body = (method === 'POST' || method === 'PUT' || method === 'PATCH') ? await parseRequestBody(req) : {};
    if (body && body.__bodyTooLarge) {
      return sendJson(res, 413, { success: false, isRejected: true, error: 'Security Exception: Request body exceeds the 25MB document upload limit.' });
    }

    // Authentication endpoints used by the existing login and signup screens.
    if (apiPath === '/api/auth/session' && method === 'POST') {
      const user = DocdonBackend.database.getUser(body.identifier || '');
      const password = user?.auth_info?.passwordHash;
      if (!user || !password || String(password) !== String(body.password || '')) {
        return sendJson(res, 401, { success: false, error: 'Invalid account or password' });
      }
      return sendJson(res, 200, { success: true, token: issueSession(user), user: { id: accountKeyForUser(user), name: user.name, role: user.role || 'student' } });
    }

    if (apiPath === '/api/auth/register' && method === 'POST') {
      const identifier = String(body.identifier || '').trim().toLowerCase();
      const password = String(body.password || '');
      const fullName = String(body.fullName || '').trim();
      if (!identifier || !fullName || password.length < 6) return sendJson(res, 400, { success: false, error: 'Name, identifier, and a password of at least six characters are required' });
      if (DocdonBackend.database.getUser(identifier)) return sendJson(res, 409, { success: false, error: 'Account already exists' });
      const user = DocdonBackend.database.saveUser({ identifier, fullName, password, role: 'student', biometricType: body.biometricType });
      return sendJson(res, 201, { success: true, token: issueSession(user), user: { id: accountKeyForUser(user), name: user.name, role: user.role } });
    }

    const session = readSession(req);
    const isProtectedUserDataRoute = apiPath.startsWith('/api/documents') || apiPath.startsWith('/api/audit') ||
      ['/api/profile', '/api/requirements', '/api/document-checklist', '/api/document-progress', '/api/roadmap', '/api/advisor/consult', '/api/advisor/chat'].includes(apiPath);
    if (isProtectedUserDataRoute && !session) {
      return sendJson(res, 401, { success: false, error: 'Sign in is required to access user documents and verification data' });
    }
    const isReviewerSession = Boolean(session && REVIEWER_ROLES.has(String(session.user.role || '').toLowerCase()));
    const scopedUserId = session ? (isReviewerSession && parsedUrl.query.userId ? parsedUrl.query.userId : session.userId) : null;

    // 0. User Profile: GET /api/profile, PUT /api/profile, PATCH /api/profile
    if (apiPath === '/api/profile' && method === 'GET') {
      const result = api.getUserProfile(scopedUserId);
      return sendJson(res, 200, result);
    }

    if (apiPath === '/api/profile' && (method === 'PUT' || method === 'PATCH' || method === 'POST')) {
      const result = api.updateUserProfile(scopedUserId, { ...body, userId: scopedUserId });
      return sendJson(res, 200, result);
    }

    // 0a. Requirements Status Breakdown: GET /api/requirements/status
    if (apiPath === '/api/requirements/status' && method === 'GET') {
      const userId = scopedUserId;
      const result = api.getRequirementsStatus(userId, parsedUrl.query);
      return sendJson(res, 200, result);
    }

    // 0b. Dynamic Requirements: GET /api/requirements
    if (apiPath === '/api/requirements' && method === 'GET') {
      const userId = scopedUserId;
      const result = api.getRequirements(userId, parsedUrl.query);
      return sendJson(res, 200, result);
    }

    // 0c. Document Checklist: GET /api/document-checklist
    if (apiPath === '/api/document-checklist' && method === 'GET') {
      const userId = scopedUserId;
      const result = api.getDocumentChecklist(userId, parsedUrl.query);
      return sendJson(res, 200, result);
    }

    // 0d. Document Progress: GET /api/document-progress
    if (apiPath === '/api/document-progress' && method === 'GET') {
      const userId = scopedUserId;
      const result = api.getDocumentProgress(userId, parsedUrl.query);
      return sendJson(res, 200, result);
    }

    // 0e. Dynamic Roadmap: GET /api/roadmap
    if (apiPath === '/api/roadmap' && method === 'GET') {
      const userId = scopedUserId;
      const result = api.getRoadmap(userId, parsedUrl.query);
      return sendJson(res, 200, result);
    }

    // 1. Advisor Checklist: GET /api/advisor/checklist?purpose=...
    if (apiPath === '/api/advisor/checklist' && method === 'GET') {
      const result = api.getAdvisorChecklist(parsedUrl.query.purpose || '', parsedUrl.query);
      return sendJson(res, 200, result);
    }

    // 1b. Advisor Consultation: POST /api/advisor/consult or POST /api/advisor/chat
    if ((apiPath === '/api/advisor/consult' || apiPath === '/api/advisor/chat') && method === 'POST') {
      const result = api.consultAdvisor(body);
      return sendJson(res, 200, result);
    }

    // 2. Verification Requests: GET /api/requests, POST /api/requests
    if (apiPath === '/api/requests' && method === 'GET') {
      const result = api.listRequests(parsedUrl.query.userId || null);
      return sendJson(res, 200, result);
    }

    if (apiPath === '/api/requests' && method === 'POST') {
      const result = api.createVerificationRequest(body);
      return sendJson(res, 201, result);
    }

    // 3. Share Request: POST /api/requests/:id/share
    if (apiPath.startsWith('/api/requests/') && apiPath.endsWith('/share') && method === 'POST') {
      const reqId = apiPath.split('/')[3];
      const result = api.shareDocument(reqId, body);
      return sendJson(res, result.success ? 200 : 400, result);
    }

    // 3b. Direct Vault Shares: GET /api/shares, POST /api/shares, POST /api/shares/:token/revoke, GET /api/shares/:token
    if (apiPath === '/api/shares' && method === 'GET') {
      const result = api.listShares(parsedUrl.query.documentId || null, parsedUrl.query.ownerId || null);
      return sendJson(res, 200, result);
    }

    if (apiPath === '/api/shares' && method === 'POST') {
      const result = api.shareDocument(body);
      return sendJson(res, result.success ? 201 : 400, result);
    }

    if (apiPath.startsWith('/api/shares/') && apiPath.endsWith('/revoke') && method === 'POST') {
      const token = apiPath.split('/')[3];
      const result = api.revokeShare(token, body);
      return sendJson(res, result.success ? 200 : 400, result);
    }

    if (apiPath.startsWith('/api/shares/') && method === 'GET') {
      const token = apiPath.split('/')[3];
      const result = api.getSharedDocument(token);
      const statusCode = result.success ? 200 : (result.status === 'revoked' || result.status === 'expired' || result.status === 'integrity_failure' ? 403 : (result.status === 'not_found' ? 404 : 400));
      return sendJson(res, statusCode, result);
    }

    // 4. Single Request: GET /api/requests/:id
    if (apiPath.startsWith('/api/requests/') && method === 'GET') {
      const reqId = apiPath.split('/')[3];
      const result = api.getRequest(reqId);
      return sendJson(res, result.success ? 200 : 404, result);
    }

    // 5. Common Document Processor: POST /api/documents/process, POST /api/documents/upload, POST /api/documents/camera
    if ((apiPath === '/api/documents/process' || apiPath === '/api/documents/upload' || apiPath === '/api/documents/camera') && method === 'POST') {
      const isCamera = apiPath === '/api/documents/camera';
      const result = await api.processDocument({ ...body, ownerId: session.userId, ...(isCamera ? { isCameraCapture: true } : {}) });
      return sendJson(res, result.success ? 201 : 400, result);
    }

    // 5b. Optical Text Extraction / OCR Helper: POST /api/ocr/inspect
    if ((apiPath === '/api/ocr/inspect' || apiPath === '/api/ocr') && method === 'POST') {
      const ocrRes = await api.ocr.extractRawTextFromPayload(body);
      return sendJson(res, 200, ocrRes);
    }

    // 6. Documents List: GET /api/documents
    if (apiPath === '/api/documents' && method === 'GET') {
      const isReviewer = REVIEWER_ROLES.has(String(session.user.role || '').toLowerCase());
      const requestedOwner = parsedUrl.query.ownerId || null;
      const ownerId = isReviewer
        ? (requestedOwner && requestedOwner.toLowerCase() !== session.userId.toLowerCase() ? requestedOwner : null)
        : session.userId;
      const result = api.getDocuments(ownerId);
      return sendJson(res, 200, result);
    }

    // 7. Verify Document: POST /api/documents/:id/verify
    if (apiPath.startsWith('/api/documents/') && apiPath.endsWith('/verify') && method === 'POST') {
      const docId = apiPath.split('/')[3];
      const document = DocdonBackend.database.getDocumentById(docId);
      if (!canAccessDocument(session, document, false)) return sendJson(res, 404, { success: false, error: 'Document not found' });
      const result = await api.verifyDocument(docId, body);
      return sendJson(res, result.success ? 200 : 400, result);
    }

    // 7b. Check Document: POST /api/documents/:id/check
    if (apiPath.startsWith('/api/documents/') && apiPath.endsWith('/check') && method === 'POST') {
      const docId = apiPath.split('/')[3];
      const document = DocdonBackend.database.getDocumentById(docId);
      if (!canAccessDocument(session, document)) return sendJson(res, 404, { success: false, error: 'Document not found' });
      const result = await api.checkDocument(docId, body);
      return sendJson(res, result.success ? 200 : 400, result);
    }

    if (apiPath.startsWith('/api/documents/') && apiPath.endsWith('/preview') && method === 'GET') {
      const docId = apiPath.split('/')[3];
      const document = DocdonBackend.database.getDocumentById(docId);
      if (!canAccessDocument(session, document)) return sendJson(res, 404, { success: false, error: 'Document not found' });
      const uploadRoot = path.resolve(PUBLIC_DIR, 'uploads');
      const storedPath = path.resolve(PUBLIC_DIR, String(document.file_reference?.stored_path || ''));
      if (!storedPath.startsWith(uploadRoot + path.sep) || !fs.existsSync(storedPath)) {
        return sendJson(res, 404, { success: false, error: 'Document preview is unavailable' });
      }
      const mimeType = String(document.file_reference?.file_type || 'application/octet-stream');
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/tiff'].includes(mimeType)) {
        return sendJson(res, 415, { success: false, error: 'Unsupported document preview type' });
      }
      const content = fs.readFileSync(storedPath);
      DocdonBackend.database.logAuditEvent({
        document_id: docId, owner_id: document.owner_id, actor: session.user.id,
        action: 'HUMAN_REVIEW_OPENED', result: 'opened',
        metadata: { documentType: document.document_type, verificationStatus: document.verification_label || document.current_status }
      });
      res.writeHead(200, { 'Content-Type': mimeType, 'Content-Length': content.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(content);
    }

    if (apiPath.startsWith('/api/documents/') && apiPath.endsWith('/analysis') && method === 'GET') {
      const docId = apiPath.split('/')[3];
      const document = DocdonBackend.database.getDocumentById(docId);
      if (!canAccessDocument(session, document)) return sendJson(res, 404, { success: false, error: 'Document not found' });
      const academicVerification = document.academic_verification || null;
      const storedOcr = DocdonBackend.database.getOcrResult(docId) || null;
      return sendJson(res, 200, {
        success: true, documentId: docId, ownerId: document.owner_id,
        academicVerification,
        ocr: storedOcr,
        classification: {
          type: document.detected_document_type || document.document_type,
          confidence: document.classification_confidence ?? null,
          match: document.classification_match ?? null
        },
        validation: {
          status: document.verification_label || document.current_status,
          confidence: document.confidence_score ?? null,
          reason: document.verification_reason || document.error_reason || null
        }
      });
    }

    // 8. Human Review Action: POST /api/documents/:id/review
    if (apiPath.startsWith('/api/documents/') && apiPath.endsWith('/review') && method === 'POST') {
      const docId = apiPath.split('/')[3];
      const document = DocdonBackend.database.getDocumentById(docId);
      if (!document) return sendJson(res, 404, { success: false, error: 'Document not found' });
      if (!REVIEWER_ROLES.has(String(session.user.role || '').toLowerCase())) {
        return sendJson(res, 403, { success: false, error: 'An authorized human reviewer account is required' });
      }
      const result = api.reviewDocument(docId, { ...body, reviewerId: session.userId, reviewerRole: session.user.role, reviewerName: session.user.name, ownerId: document.owner_id });
      const statusCode = result.success ? 200 : (/authorized|owner context/i.test(result.error || '') ? 403 : 400);
      return sendJson(res, statusCode, result);
    }

    // 8b. Document Vault Status: GET /api/documents/:id/status
    if (apiPath.startsWith('/api/documents/') && apiPath.endsWith('/status') && method === 'GET') {
      const docId = apiPath.split('/')[3];
      const userId = REVIEWER_ROLES.has(String(session.user.role || '').toLowerCase()) && parsedUrl.query.userId
        ? parsedUrl.query.userId : session.userId;
      const result = api.getDocumentStatus(docId, userId);
      return sendJson(res, result.success ? 200 : 404, result);
    }

    // 8c. Patch Document: PATCH /api/documents/:id
    if (apiPath.startsWith('/api/documents/') && method === 'PATCH') {
      const docId = apiPath.split('/')[3];
      const document = DocdonBackend.database.getDocumentById(docId);
      if (!canAccessDocument(session, document, false)) return sendJson(res, 404, { success: false, error: 'Document not found' });
      const result = api.patchDocument(docId, body);
      return sendJson(res, result.success ? 200 : 404, result);
    }

    // 9. Single Document: GET /api/documents/:id
    if (apiPath.startsWith('/api/documents/') && method === 'GET') {
      const docId = apiPath.split('/')[3];
      const doc = DocdonBackend.database.getDocumentById(docId);
      if (!doc) return sendJson(res, 404, { success: false, error: 'Document not found' });
      if (!REVIEWER_ROLES.has(String(session.user.role || '').toLowerCase()) && String(session.userId).toLowerCase() !== String(doc.owner_id || '').toLowerCase()) {
        return sendJson(res, 404, { success: false, error: 'Document not found' });
      }
      return sendJson(res, 200, { success: true, document: doc });
    }

    // 9b. Delete Document: DELETE /api/documents/:id
    if (apiPath.startsWith('/api/documents/') && method === 'DELETE') {
      const docId = apiPath.split('/')[3];
      const document = DocdonBackend.database.getDocumentById(docId);
      if (!canAccessDocument(session, document, false)) return sendJson(res, 404, { success: false, error: 'Document not found' });
      const result = api.deleteDocument ? api.deleteDocument(docId) : { success: true };
      return sendJson(res, 200, result);
    }

    // 10. Audit Trail: GET /api/audit or GET /api/audit/:requestId
    if (apiPath === '/api/audit' && method === 'GET') {
      const { requestId, docId, ownerId } = parsedUrl.query;
      if (docId) {
        const document = DocdonBackend.database.getDocumentById(docId);
        if (!document || (!REVIEWER_ROLES.has(String(session.user.role || '').toLowerCase()) && String(document.owner_id || '').toLowerCase() !== String(session.userId).toLowerCase())) {
          return sendJson(res, 404, { success: false, error: 'Audit record not found' });
        }
        return sendJson(res, 200, api.getAuditTrail(requestId, docId));
      }
      const result = api.getAuditTrail(requestId);
      const scopedOwner = REVIEWER_ROLES.has(String(session.user.role || '').toLowerCase()) ? ownerId : session.userId;
      const ownedIds = new Set(api.getDocuments(scopedOwner).documents.map(document => document.id));
      result.events = result.events.filter(event => ownedIds.has(event.document_id));
      return sendJson(res, 200, result);
    }

    if (apiPath.startsWith('/api/audit/') && method === 'GET') {
      const reqId = apiPath.split('/')[3];
      const ownerId = parsedUrl.query.ownerId;
      const request = api.getRequest(reqId);
      const requestOwner = request.request?.owner_id || request.request?.submitter_id || request.request?.user_id;
      if (!request.success || (!REVIEWER_ROLES.has(String(session.user.role || '').toLowerCase()) && String(requestOwner || '').toLowerCase() !== String(session.userId).toLowerCase()) ||
          (REVIEWER_ROLES.has(String(session.user.role || '').toLowerCase()) && ownerId && String(requestOwner || '').toLowerCase() !== String(ownerId).toLowerCase())) {
        return sendJson(res, 404, { success: false, error: 'Audit record not found' });
      }
      const result = api.getAuditTrail(reqId);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { success: false, error: 'API Endpoint Not Found' });
  }

  // ==========================================================================
  // STATIC FILE SERVING LAYER
  // ==========================================================================
  // Do not allow direct access to raw uploaded vault files without valid share authorization
  const normalizedPath = pathname.replace(/\\/g, '/');
  if (normalizedPath.startsWith('/uploads/') || normalizedPath === '/uploads') {
    const shareToken = parsedUrl.query.token || parsedUrl.query.share_token;
    if (!shareToken) {
      return sendJson(res, 403, {
        success: false,
        error: 'Access Denied: Direct access to underlying raw vault files is forbidden without a valid share authorization token.'
      });
    }
    const shareCheck = api.getSharedDocument(shareToken);
    if (!shareCheck.success) {
      const code = (shareCheck.status === 'revoked' || shareCheck.status === 'expired' || shareCheck.status === 'integrity_failure') ? 403 : (shareCheck.status === 'not_found' ? 404 : 400);
      return sendJson(res, code, {
        success: false,
        error: shareCheck.error,
        status: shareCheck.status
      });
    }
  }

  let safePath = pathname === '/' ? '/index.html' : pathname;
  safePath = path.normalize(safePath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`DOCDON Verification Backend Server active on port ${PORT}`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`====================================================`);
  });
}

module.exports = server;
