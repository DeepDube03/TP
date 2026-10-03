/**
 * DOCDON MCP Server
 * Exposes the existing DOCDON document-verification pipeline to AgenticOrg.
 * Uses stateless Streamable HTTP so it can run inside the existing Node HTTP server.
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const DocdonBackend = require('./docdon-backend.js');

const MAX_MCP_FILE_DATA_URL_CHARS = 34 * 1024 * 1024;

function textResult(value) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
  };
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }) }] };
}

function validateFileData(fileData) {
  if (!fileData || typeof fileData !== 'string' || !fileData.startsWith('data:')) {
    throw new Error('file_data must be a base64 data URL such as data:image/jpeg;base64,...');
  }
  if (fileData.length > MAX_MCP_FILE_DATA_URL_CHARS) {
    throw new Error('file_data is too large for the MCP document tool. Use a smaller document/image.');
  }
}

async function analyzeInput({ file_data, file_name = 'document', file_type = 'application/octet-stream' }) {
  validateFileData(file_data);

  const ocr = new DocdonBackend.OcrEngine();
  const classifier = new DocdonBackend.Classifier();
  const raw = await ocr.extractRawTextFromPayload({
    dataUrl: file_data,
    fileName: file_name,
    fileType: file_type
  });

  const rawText = raw.rawOcrText || raw.text || '';
  const classification = classifier.detectTypeFromContent(rawText, file_name);
  let fields = {};
  if (classification.detectedTypeKey && DocdonBackend.profiles[classification.detectedTypeKey]) {
    const parsed = ocr.extractFieldsForType(classification.detectedTypeKey, rawText, raw.quality || null);
    fields = parsed.extractedFields || {};
  }

  return {
    success: true,
    fileName: file_name,
    ocr: {
      text: rawText,
      confidence: raw.ocrConfidence ?? raw.confidence ?? 0,
      extractionConfidence: raw.extractionConfidence ?? raw.confidence ?? 0,
      source: raw.source || null
    },
    classification: {
      typeKey: classification.detectedTypeKey,
      typeName: classification.detectedTypeName,
      confidence: classification.confidence ?? classification.classificationConfidence ?? 0,
      isConfident: !!classification.isConfident,
      evidence: classification.evidence || {},
      missingEvidence: classification.missingEvidence || []
    },
    extractedFields: fields
  };
}

function registerTools(server) {
  const fileSchema = {
    file_data: z.string().describe('Base64 data URL of the document, e.g. data:image/jpeg;base64,...'),
    file_name: z.string().optional().describe('Original file name'),
    file_type: z.string().optional().describe('MIME type such as image/jpeg or application/pdf')
  };

  server.registerTool(
    'extract_document_text',
    {
      title: 'Extract Document Text',
      description: 'Run DOCDON OCR/text extraction on an uploaded document.',
      inputSchema: fileSchema
    },
    async ({ file_data, file_name, file_type }) => {
      try {
        validateFileData(file_data);
        const ocr = new DocdonBackend.OcrEngine();
        const raw = await ocr.extractRawTextFromPayload({ dataUrl: file_data, fileName: file_name || 'document', fileType: file_type || 'application/octet-stream' });
        return textResult({
          success: true,
          text: raw.rawOcrText || raw.text || '',
          confidence: raw.ocrConfidence ?? raw.confidence ?? 0,
          extractionConfidence: raw.extractionConfidence ?? raw.confidence ?? 0,
          source: raw.source || null
        });
      } catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    'identify_document_type',
    {
      title: 'Identify Document Type',
      description: 'Use DOCDON OCR and content-based classification to identify the document type. Filenames are not trusted as the classification source.',
      inputSchema: fileSchema
    },
    async ({ file_data, file_name, file_type }) => {
      try {
        const result = await analyzeInput({ file_data, file_name, file_type });
        return textResult({ success: true, classification: result.classification, extractedFields: result.extractedFields });
      } catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    'analyze_document',
    {
      title: 'Analyze Document',
      description: 'Run DOCDON OCR, document classification, and field extraction without storing the document in the vault.',
      inputSchema: fileSchema
    },
    async ({ file_data, file_name, file_type }) => {
      try { return textResult(await analyzeInput({ file_data, file_name, file_type })); }
      catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    'validate_document',
    {
      title: 'Validate Document',
      description: 'Validate document type, OCR quality, extracted identity and required evidence using DOCDON verification rules. Does not store the document.',
      inputSchema: {
        ...fileSchema,
        expected_document_type: z.string().optional().describe('Expected DOCDON document type key, e.g. 10th_marksheet'),
        expected_name: z.string().optional().describe('Expected applicant name for identity matching')
      }
    },
    async ({ file_data, file_name, file_type, expected_document_type, expected_name }) => {
      try {
        const analysis = await analyzeInput({ file_data, file_name, file_type });
        const targetType = DocdonBackend.normalizeDocumentType(expected_document_type || analysis.classification.typeKey).canonicalId;
        const classification = new DocdonBackend.Classifier().detectTypeFromContent(analysis.ocr.text, file_name || 'document');
        const ocr = new DocdonBackend.OcrEngine();
        const parsed = ocr.extractFieldsForType(targetType, analysis.ocr.text, null);
        parsed.rawText = analysis.ocr.text;
        parsed.ocrConfidence = analysis.ocr.confidence;
        parsed.extractionConfidence = analysis.ocr.extractionConfidence;
        const verification = new DocdonBackend.VerificationEngine().verify({
          targetTypeKey: targetType,
          userExpectedName: expected_name || '',
          attachment: { fileName: file_name || 'document' },
          ocrResult: parsed,
          classification: {
            ...classification,
            isMatch: classification.detectedTypeKey === targetType,
            classificationConfidence: classification.confidence || 0
          }
        });
        return textResult({ success: true, ...verification });
      } catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    'check_duplicate_document',
    {
      title: 'Check Duplicate Document',
      description: 'Compare a document against the DOCDON vault using file hash and extracted identity fields. Does not create a new document.',
      inputSchema: {
        ...fileSchema,
        owner_id: z.string().describe('DOCDON account/user identifier whose vault should be checked')
      }
    },
    async ({ file_data, file_name, file_type, owner_id }) => {
      try {
        validateFileData(file_data);
        const analysis = await analyzeInput({ file_data, file_name, file_type });
        const canonicalType = DocdonBackend.normalizeDocumentType(analysis.classification.typeKey).canonicalId;
        const existingDocs = DocdonBackend.database.getDocuments(owner_id) || [];
        const sha256 = DocdonBackend.computeSha256(Buffer.from(file_data.slice(file_data.indexOf(',') + 1), 'base64'));
        const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const fields = analysis.extractedFields || {};
        const currentIdentifier = normalize(fields.licence_number || fields.pan_number || fields.aadhaar_number || fields.roll_number || fields.registration_no || fields.passport_number || fields.epic_number || fields.account_number || fields.consumer_id || fields.degree_reg_no);
        let duplicate = null;
        for (const candidate of existingDocs) {
          if (!candidate || candidate.isPreviousVersion || candidate.versionStatus === 'history') continue;
          const candidateType = DocdonBackend.normalizeDocumentType(candidate.document_type || candidate.title).canonicalId;
          if (candidateType !== canonicalType) continue;
          if (sha256 && candidate.file_reference?.sha256 && candidate.file_reference.sha256 === sha256) { duplicate = candidate; break; }
          const oldOcr = DocdonBackend.database.data.ocr_results?.[candidate.document_id || candidate.id] || {};
          const oldFields = oldOcr.extractedFields || {};
          const oldIdentifier = normalize(candidate.doc_number || oldFields.roll_number || oldFields.licence_number || oldFields.pan_number || oldFields.aadhaar_number || oldFields.registration_no || oldFields.passport_number || oldFields.epic_number || oldFields.account_number || oldFields.consumer_id || oldFields.degree_reg_no);
          if (currentIdentifier && oldIdentifier && currentIdentifier === oldIdentifier) { duplicate = candidate; break; }
        }
        return textResult({ success: true, duplicate: !!duplicate, existingDocument: duplicate || null, detectedType: canonicalType });
      } catch (error) { return errorResult(error); }
    }
  );

  server.registerTool(
    'verify_document',
    {
      title: 'Verify Document',
      description: 'Run the complete DOCDON document-processing pipeline, including OCR, content classification, validation, duplicate detection, and vault storage.',
      inputSchema: {
        ...fileSchema,
        owner_id: z.string().describe('DOCDON account/user identifier'),
        title: z.string().optional().describe('Document title'),
        document_type: z.string().optional().describe('Expected DOCDON document type key; use auto when unknown'),
        expected_name: z.string().optional().describe('Expected applicant name')
      }
    },
    async ({ file_data, file_name, file_type, owner_id, title, document_type, expected_name }) => {
      try {
        validateFileData(file_data);
        const result = await DocdonBackend.processDocument({
          fileData: file_data,
          fileName: file_name || 'document',
          fileType: file_type || 'application/octet-stream',
          fileSize: Math.max(0, Math.floor((file_data.length * 3) / 4)),
          title: title || file_name || 'Document',
          documentType: document_type || 'auto',
          ownerId: owner_id,
          expectedName: expected_name || ''
        });
        return textResult(result);
      } catch (error) { return errorResult(error); }
    }
  );
}

async function handleMcpRequest(req, res, parsedBody) {
  // Stateless transport: AgenticOrg can initialize and discover tools without
  // requiring a long-lived in-memory session on Render.
  const server = new McpServer({ name: 'DOCDON Document Verification', version: '1.0.0' });
  registerTools(server);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    console.error('[DOCDON MCP]', error?.stack || error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: error?.message || 'MCP server error' }, id: null }));
    }
  } finally {
    try { await transport.close(); } catch (_) {}
    try { await server.close(); } catch (_) {}
  }
}

module.exports = { handleMcpRequest, registerTools };
