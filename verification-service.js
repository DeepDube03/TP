/* Authenticated bridge to DOCDON's existing document processor. Keeps only
   verification workflow metadata in browser storage; documents and OCR remain
   in the user's DOCDON account through the existing backend. */
(function () {
  'use strict';
  const STORAGE_PREFIX = 'docdon_visa_verification_v2:';

  function getUser() {
    try { return JSON.parse(localStorage.getItem('docdon_current_user') || 'null'); }
    catch (_) { return null; }
  }
  function getUserKey(user) {
    return String(user && (user.identifier || user.id) || '').trim().toLowerCase();
  }
  function storageKey(user) { return STORAGE_PREFIX + encodeURIComponent(getUserKey(user)); }
  function requireUser() {
    const user = getUser();
    if (!user || !getUserKey(user) || (/^https?:$/.test(location.protocol) && !user.sessionToken)) {
      location.replace('index.html');
      throw new Error('Please sign in to use document verification.');
    }
    return user;
  }
  function loadSession() {
    const user = requireUser();
    try {
      const value = JSON.parse(localStorage.getItem(storageKey(user)) || 'null');
      return value && value.ownerKey === getUserKey(user) ? value : null;
    } catch (_) { return null; }
  }
  function clearSession() { localStorage.removeItem(storageKey(requireUser())); }
  function saveSession(session) {
    const user = requireUser();
    session.ownerKey = getUserKey(user);
    session.updatedAt = new Date().toISOString();
    localStorage.setItem(storageKey(user), JSON.stringify(session));
    return session;
  }
  function startSession(input) {
    const user = requireUser();
    const session = {
      id: (crypto.randomUUID ? crypto.randomUUID() : 'vr-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
      ownerKey: getUserKey(user),
      applicant: {
        fullName: String(input.fullName || user.name || '').trim(),
        email: String(input.email || user.email || (user.identifier && user.identifier.includes('@') ? user.identifier : '')).trim()
      },
      application: {
        country: String(input.country || '').trim(),
        visaType: String(input.visaType || '').trim(),
        purpose: String(input.purpose || '').trim()
      },
      answers: [], documents: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    return saveSession(session);
  }
  function addAnswer(question, answer) {
    const session = loadSession();
    if (!session) throw new Error('Start a verification session first.');
    session.answers.push({ question: String(question), answer: String(answer), createdAt: new Date().toISOString() });
    return saveSession(session);
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });
  }
  async function uploadEvidence(file, documentType, title) {
    const user = requireUser();
    const session = loadSession();
    if (!session) throw new Error('Start a verification session first.');
    if (!file) throw new Error('Choose a document file to upload.');
    if (!window.DocdonAPI || typeof window.DocdonAPI.processDocument !== 'function') {
      throw new Error('The DOCDON document service is unavailable. Open this page through the DOCDON server and try again.');
    }
    const fileData = await fileToDataUrl(file);
    const result = await window.DocdonAPI.processDocument({
      fileData, fileName: file.name, fileType: file.type, fileSize: file.size,
      title: String(title || file.name).trim(), documentType: String(documentType || 'other_custom'),
      ownerId: getUserKey(user)
    });
    if (!result || result.success !== true || !result.document) {
      throw new Error((result && result.error) || 'DOCDON could not process this document.');
    }
    const doc = result.document;
    const record = {
      id: doc.document_id || doc.id,
      name: doc.title || doc.file_name || file.name,
      documentType: doc.document_type || documentType || 'document',
      status: doc.verification_label || doc.current_status || 'Needs Human Review',
      reason: doc.verification_reason || doc.error_reason || null,
      uploadedAt: doc.uploaded_at || new Date().toISOString()
    };
    session.documents = session.documents || [];
    session.documents = session.documents.filter(item => item.id !== record.id).concat(record);
    saveSession(session);
    return { result, record };
  }
  async function getDocuments() {
    const user = requireUser();
    if (/^https?:$/.test(location.protocol)) {
      const response = await fetch(apiUrl('/api/documents'));
      const result = await response.json();
      if (!response.ok || result.success === false) throw new Error(result.error || 'Could not load your DOCDON documents.');
      return result.documents || [];
    }
    const db = window.DocdonBackend && window.DocdonBackend.database;
    if (!db || typeof db.getDocuments !== 'function') throw new Error('The DOCDON document service is unavailable.');
    return db.getDocuments(getUserKey(user)) || [];
  }
  async function getAnalysis(documentId) {
    requireUser();
    if (/^https?:$/.test(location.protocol)) {
      const response = await fetch(apiUrl('/api/documents/' + encodeURIComponent(documentId) + '/analysis'));
      const result = await response.json();
      if (!response.ok || result.success === false) throw new Error(result.error || 'Could not load document analysis.');
      return result;
    }
    const doc = window.DocdonBackend && window.DocdonBackend.database && window.DocdonBackend.database.getDocumentById(documentId);
    if (!doc) throw new Error('Document not found in the signed-in account.');
    return { success: true, documentId, academicVerification: doc.academic_verification || null,
      ocr: window.DocdonBackend.database.getOcrResult(documentId) || null,
      classification: { type: doc.detected_document_type || doc.document_type, confidence: doc.classification_confidence ?? null },
      validation: { status: doc.verification_label || doc.current_status, confidence: doc.confidence_score ?? null, reason: doc.verification_reason || doc.error_reason || null } };
  }
  async function getReportData() {
    const session = loadSession();
    if (!session) return null;
    const allDocs = await getDocuments();
    const wanted = new Set((session.documents || []).map(doc => String(doc.id)));
    const docs = allDocs.filter(doc => wanted.has(String(doc.document_id || doc.id)));
    const analyses = await Promise.all(docs.map(async doc => {
      const id = doc.document_id || doc.id;
      try { return { document: doc, analysis: await getAnalysis(id) }; }
      catch (error) { return { document: doc, analysisError: error.message }; }
    }));
    return { session, documents: analyses };
  }
  window.DocdonVerificationService = { getUser, requireUser, loadSession, saveSession, clearSession, startSession, addAnswer, uploadEvidence, getDocuments, getAnalysis, getReportData };
})();
