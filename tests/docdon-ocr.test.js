const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
process.env.NODE_ENV = 'test';

// Keep tests isolated from the repository's seeded JSON database and uploads folder.
const originalWriteFileSync = fs.writeFileSync;
fs.writeFileSync = function (filePath, ...args) {
  const resolved = path.resolve(String(filePath));
  if (resolved.endsWith(`${path.sep}database.json`) || resolved.includes(`${path.sep}uploads${path.sep}`)) return;
  return originalWriteFileSync.call(this, filePath, ...args);
};
const DocdonBackend = require('../docdon-backend.js');
fs.writeFileSync = originalWriteFileSync;
DocdonBackend.database.save = () => {};

const classifier = DocdonBackend.api.classifier;

function marksheetText({ heading = 'SECONDARY SCHOOL EXAMINATION (CLASS X)', year = '2022', roll = 'CBSE-10-482917', name = 'Avery Sample', marks = 'English 88/100, Mathematics 92/100, Science 89/100, Social Studies 90/100' } = {}) {
  return `CENTRAL BOARD OF SECONDARY EDUCATION\n${heading}\nSTATEMENT OF MARKS\nCandidate Name: ${name}\nRoll No: ${roll}\nSchool Name: Sample High School\nPassing Year: ${year}\nSubject Marks: ${marks}\nTotal Marks: 359/400\nResult: PASS`;
}

async function makeScannedPdf(academicLevel = '10th') {
  const isTwelfth = academicLevel === '12th';
  const pageText = isTwelfth ? [
    [
      'CENTRAL BOARD OF SECONDARY EDUCATION',
      'SENIOR SECONDARY EXAMINATION (CLASS XII)',
      'STATEMENT OF MARKS 2023',
      'Candidate Name: Avery Sample',
      'Roll No: CBSE-12-223301',
      'School Name: Sample Senior School'
    ],
    [
      'Passing Year: 2023',
      'Subject Marks',
      'Physics 88/100  Chemistry 91/100',
      'Mathematics 94/100  English 85/100',
      'Total Marks: 358/400',
      'Result: PASS'
    ]
  ] : [
    [
      'CENTRAL BOARD OF SECONDARY EDUCATION',
      'SECONDARY SCHOOL EXAMINATION (CLASS X)',
      'STATEMENT OF MARKS 2022',
      'Candidate Name: Avery Sample',
      'Roll No: CBSE-10-482917',
      'School Name: Sample High School'
    ],
    [
      'Passing Year: 2022',
      'Subject Marks',
      'English 88/100  Mathematics 92/100',
      'Science 89/100  Social Studies 90/100',
      'Total Marks: 359/400',
      'Result: PASS'
    ]
  ];
  const pdf = await PDFDocument.create();
  for (const lines of pageText) {
    const svgLines = lines.map((line, index) => `<text x="100" y="${150 + index * 120}" font-size="54">${line}</text>`).join('');
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200"><rect width="100%" height="100%" fill="white"/><g fill="#111" font-family="Arial, sans-serif">${svgLines}</g></svg>`);
    const png = await sharp(svg).png().toBuffer();
    const page = pdf.addPage([595, 842]);
    const embedded = await pdf.embedPng(png);
    page.drawImage(embedded, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await pdf.save());
}

async function makeTextPdf() {
  const lines = marksheetText().split('\n');
  const commands = lines.map((line, index) => `1 0 0 1 44 ${790 - index * 30} Tm (${line.replace(/[()\\]/g, '\\$&')}) Tj`).join('\n');
  const stream = `BT /F1 12 Tf\n${commands}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

test('canonical Class 10 wording and controlled OCR substitutions classify correctly', () => {
  const variants = [
    'SECONDARY SCHOOL EXAMINATION (CLASS X)',
    'Class 10 Result and Statement of Marks',
    'SSC Marksheet - Secondary Examination',
    'X Standard Marksheet - Matriculation Examination',
    'Secondary School Certificate - High School Marksheet'
  ];
  for (const heading of variants) {
    const detected = classifier.detectTypeFromContent(marksheetText({ heading }));
    assert.equal(detected.detectedTypeKey, '10th_marksheet', heading);
    assert.equal(detected.isConfident, true, heading);
  }

  const noisy = marksheetText({ heading: 'C8SE CL4SS IOTH SECONDARY EXAMINATION', name: 'Avery Sample' })
    .replace('Candidate Name', 'Candidate STUOENT Name');
  assert.match(DocdonBackend.normalizeOcrText(noisy), /cbse class 10th secondary examination/);
  assert.match(DocdonBackend.normalizeOcrText(noisy), /student name/);
  assert.equal(classifier.detectTypeFromContent(noisy).detectedTypeKey, '10th_marksheet');
});

test('backend detects marksheet family and academic level independently in both directions', () => {
  const cases = [
    ['10th', 'CBSE Class X marksheet Candidate Name: Avery Sample Roll No: CBSE-10-482917 Result: PASS English 88/100 Mathematics 92/100 Science 89/100'],
    ['10th', 'CBSE 10th Standard statement of marks Candidate Name: Avery Sample Roll No: CBSE-10-482917 Result: PASS English 88/100 Mathematics 92/100 Science 89/100'],
    ['10th', 'State Board SSC marksheet Candidate Name: Avery Sample Seat No: SSC-12-8821 Result: PASS English 88/100 Mathematics 92/100 Science 89/100'],
    ['10th', 'SECONDARY SCHOOL EXAMINATION Class X marksheet Candidate Name: Avery Sample Roll No: 2012-10 Result: PASS English 88/100 Mathematics 92/100 Science 89/100'],
    ['12th', 'CBSE Class XII marksheet Candidate Name: Avery Sample Roll No: CBSE-12-223301 Result: PASS Physics 88/100 Chemistry 91/100 Mathematics 94/100'],
    ['12th', 'CBSE 12th Standard statement of marks Candidate Name: Avery Sample Roll No: CBSE-12-223301 Result: PASS Physics 88/100 Chemistry 91/100 Mathematics 94/100'],
    ['12th', 'SENIOR SECONDARY EXAMINATION marksheet Candidate Name: Avery Sample Roll No: 2012-12 Result: PASS Physics 88/100 Chemistry 91/100 Mathematics 94/100'],
    ['12th', 'HIGHER SECONDARY CERTIFICATE HSC statement of marks Candidate Name: Avery Sample Roll No: HSC-223301 Result: PASS Physics 88/100 Chemistry 91/100 Mathematics 94/100'],
    ['12th', 'INTERMEDIATE EXAMINATION Class XII marksheet Candidate Name: Avery Sample Roll No: 12-223301 Result: PASS Physics 88/100 Chemistry 91/100 Mathematics 94/100']
  ];
  for (const [expected, text] of cases) {
    const result = classifier.detectTypeFromContent(text);
    assert.equal(result.documentFamily, 'marksheet', text);
    assert.equal(result.academicLevel, expected, text);
    assert.equal(result.detectedTypeKey, `${expected}_marksheet`, text);
    assert.ok(result.academicLevelConfidence >= 78, text);
  }
});

test('header level wins over incidental body evidence; unresolved mixed levels need review', () => {
  const headerWins = classifier.detectTypeFromContent('CLASS X SECONDARY SCHOOL EXAMINATION\nStatement of Marks\nSchool XII Road\nCandidate Name: Avery Sample Roll No: 10-12 Result: PASS English 88/100 Mathematics 92/100 Science 89/100');
  assert.equal(headerWins.academicLevel, '10th');
  assert.equal(headerWins.detectedTypeKey, '10th_marksheet');

  const conflict = classifier.detectTypeFromContent('Marksheet Candidate Name: Avery Sample Roll No: AB-10-12\nClass X and Class XII both appear as references. English 88/100 Mathematics 92/100 Science 89/100 Result: PASS');
  assert.equal(conflict.documentFamily, 'marksheet');
  assert.equal(conflict.academicLevel, 'unknown');
  assert.equal(conflict.academicLevelConflict, true);
  assert.equal(conflict.status, 'NEEDS_REVIEW');
  assert.equal(conflict.detectedTypeKey, 'unknown');
  const ocrTypo = classifier.detectTypeFromContent('CLASS XIl marksheet Candidate Name: Avery Sample Roll No: CBSE-12-223301 Result: PASS Physics 88/100 Chemistry 91/100 Mathematics 94/100');
  assert.equal(ocrTypo.academicLevel, '12th');
  assert.ok(ocrTypo.rawLevelTokens.some(token => token.rawToken.includes('XIl') && token.normalizedToken.includes('xii')));
});

test('unresolved marksheet levels are returned for human review and never assigned to a class', async () => {
  const ownerId = `level-review-${Date.now()}`;
  const text = 'Marksheet Candidate Name: Avery Sample Roll No: AB-10-12 Class X and Class XII appear as unrelated references. English 88/100 Mathematics 92/100 Science 89/100 Result: PASS';
  const result = await DocdonBackend.api.processDocument({
    file: { name: 'unclear_marksheet.pdf', type: 'application/pdf', size: text.length },
    fileName: 'unclear_marksheet.pdf', fileType: 'application/pdf', fileText: text,
    isSimulation: true, documentType: '10th_marksheet', ownerId
  });
  assert.equal(result.success, false);
  assert.equal(result.needsReview, true);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.classification.academicLevel, 'unknown');
  assert.equal(result.classification.detectedTypeKey, 'unknown');
  assert.equal(DocdonBackend.database.getDocuments(ownerId).length, 0);
});

test('incidental numbers, years, and level words alone do not create a marksheet classification', () => {
  for (const text of [
    'A random note mentioning 2012, 10 and 12. No credential or marksheet.',
    'A random image with the text 10th on it and no school record.',
    'A random image with the text 12th on it and no school record.',
    'Roll No: 10-12-2012 Subject Code: 10 Result Code: 12'
  ]) {
    const result = classifier.detectTypeFromContent(text);
    assert.notEqual(result.detectedTypeKey, '10th_marksheet', text);
    assert.notEqual(result.detectedTypeKey, '12th_marksheet', text);
  }
});

test('dashboard and storage classification previews keep the backend API receiver bound', () => {
  for (const fileName of ['dashboard.html', 'storage.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
    const match = html.match(/function classifyUploadedContent\(rawText, attachment\) \{([\s\S]*?)\n    \}/);
    assert.ok(match, `classification wrapper found in ${fileName}`);
    const classify = vm.runInNewContext(`(function classifyUploadedContent(rawText, attachment) {${match[1]}\n})`, {
      window: { DocdonBackend }
    });
    const result = classify('CBSE Class X marksheet Candidate Name: Avery Sample Roll No: CBSE-10-482917 Result: PASS English 88/100 Mathematics 92/100 Science 89/100', { name: 'sample.pdf' });
    assert.equal(result.detectedKey, '10th_marksheet', fileName);
    assert.equal(result.academicLevel, '10th', fileName);
  }
});

test('single keywords, random text, and random numbers do not classify as a marksheet', () => {
  const falsePositives = [
    'Class 10',
    'CBSE',
    '500 marks',
    '11223344556677889900',
    'English Mathematics Science Hindi Social Studies',
    'A selfie photo in a room near a CBSE poster',
    'Class 10 CBSE 500 marks English Mathematics Science',
    'CBSE Secondary Examination Class 10 Student Name: Avery Sample Roll No: 12345 Result: PASS'
  ];
  for (const text of falsePositives) {
    const detected = classifier.detectTypeFromContent(text);
    if (text.startsWith('CBSE Secondary Examination')) {
      assert.equal(detected.detectedTypeKey, '10th_marksheet', text);
    } else {
      assert.notEqual(detected.detectedTypeKey, '10th_marksheet', text);
    }
    assert.equal(detected.isConfident, false, text);
  }
});

test('probable but incomplete Class 10 content is stored only for human review', async () => {
  const ownerId = `review-test-${Date.now()}`;
  const result = await DocdonBackend.api.processDocument({
    file: { name: 'possible_marksheet.pdf', type: 'application/pdf', size: 64 },
    fileName: 'possible_marksheet.pdf',
    fileType: 'application/pdf',
    fileText: 'CBSE Secondary Examination Class 10 Result PASS English Mathematics Science',
    isSimulation: true,
    documentType: '10th_marksheet',
    ownerId
  });
  assert.equal(result.success, true, result.error);
  assert.equal(result.document.document_type, '10th_marksheet');
  assert.equal(result.verification.finalStatus, 'Needs Human Review');
  assert.equal(result.document.verification_label, 'Needs Human Review');
  assert.equal(result.document.verified, false);
  assert.equal(result.ocr.extractedFields.roll_number, null);
});

test('random document payload is rejected without a normal Vault record', async () => {
  const ownerId = `random-test-${Date.now()}`;
  const result = await DocdonBackend.api.processDocument({
    file: { name: 'selfie.png', type: 'image/png', size: 100 },
    fileName: 'selfie.png',
    fileType: 'image/png',
    fileText: 'This is a random selfie and a room photo',
    isSimulation: true,
    documentType: '10th_marksheet',
    ownerId
  });
  assert.equal(result.success, false);
  assert.equal(result.isRejected, true);
  assert.equal(DocdonBackend.database.getDocuments(ownerId).length, 0);
});

test('classification exceptions finish safely as NEEDS_REVIEW with diagnostic timing', async () => {
  const ownerId = `classification-error-${Date.now()}`;
  const originalClassify = DocdonBackend.api.classifier.classifyDocument;
  DocdonBackend.api.classifier.classifyDocument = () => { throw new Error('intentional classifier fault fixture'); };
  let result;
  try {
    const text = marksheetText();
    result = await DocdonBackend.api.processDocument({
      file: { name: 'fault-fixture.pdf', type: 'application/pdf', size: text.length },
      fileName: 'fault-fixture.pdf', fileType: 'application/pdf', fileText: text,
      isSimulation: true, documentType: '10th_marksheet', ownerId
    });
  } finally {
    DocdonBackend.api.classifier.classifyDocument = originalClassify;
  }
  assert.equal(result.success, false);
  assert.equal(result.needsReview, true);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.failedStage, 'classification');
  assert.ok(result.processingTime.classificationMs >= 0);
  assert.equal(DocdonBackend.database.getDocuments(ownerId).length, 0);
});

test('supported document profiles keep distinct content classification', () => {
  const cases = [
    ['aadhaar_card', 'UNIQUE IDENTIFICATION AUTHORITY OF INDIA UIDAI Aadhaar 4821 9034 1182 Name: Avery Sample DOB: 12/03/2005 Gender Female'],
    ['pan_card', 'INCOME TAX DEPARTMENT PERMANENT ACCOUNT NUMBER PAN: ABCDE1234F Name: Avery Sample Father Name: Morgan Sample DOB: 12/03/2005'],
    ['passport', 'REPUBLIC OF INDIA PASSPORT Passport No: Z4892104 Given Name: Avery Sample Nationality: Indian Expiry Date: 12/03/2030 P<IND'],
    ['driving_licence', 'TRANSPORT DEPARTMENT DRIVING LICENCE DL No: MH-0420110023481 Name: Avery Sample DOB: 12/03/2005 Valid Till: 12/03/2030 Vehicle Classes: LMV'],
    ['12th_marksheet', 'HIGHER SECONDARY EDUCATION BOARD HSC CLASS 12 MARKSHEET Candidate Name: Avery Sample Roll No: HSC-223301 Passing Year: 2023 Result: PASS Physics 88 Chemistry 91 Mathematics 94 English 85'],
    ['degree_certificate', 'STATE TECHNICAL UNIVERSITY CONVOCATION DEGREE CERTIFICATE Conferred upon Avery Sample Bachelor of Technology Degree No BE-2023-90812'],
    ['resume', 'CURRICULUM VITAE Candidate Name: Avery Sample Skills JavaScript Python Work Experience Projects Education History']
  ];
  for (const [expected, text] of cases) {
    assert.equal(classifier.detectTypeFromContent(text).detectedTypeKey, expected, expected);
  }
});

test('academic type matrix separates school, semester, degree, diploma, and weak keyword evidence', () => {
  const cases = [
    ['10th_marksheet', marksheetText()],
    ['12th_marksheet', 'CBSE SENIOR SECONDARY EXAMINATION CLASS XII STATEMENT OF MARKS Candidate Name: Avery Sample Roll No: CBSE-12-223301 Result: PASS Physics 88/100 Chemistry 91/100 Mathematics 94/100'],
    ['semester_marksheet', 'NORTH UNIVERSITY Semester I Examination Grade Card Student Name: Avery Sample Course Code CS101 Subject Code CS102 SGPA 8.7 Credits 24 Result PASS'],
    ['semester_marksheet', 'NORTH UNIVERSITY Semester III Result Statement of Marks Student Name: Avery Sample Course B.Tech Course Code CS301 CGPA 8.4 Credits 22'],
    ['semester_marksheet', 'NORTH UNIVERSITY Semester VI End Semester Examination Grade Sheet Course Code EE601 SGPA 8.1 Credit Points 21'],
    ['semester_marksheet', 'NORTH UNIVERSITY Grade Card University Examination Student Name: Avery Sample Course Code CS101 CGPA 8.2 Credits 20'],
    ['diploma_marksheet', 'STATE BOARD OF TECHNICAL EDUCATION Diploma Semester Examination Semester IV Polytechnic Marksheet Student Name: Avery Sample Course Code ME401 SGPA 7.9 Credits 22'],
    ['degree_marksheet', 'STATE TECHNICAL UNIVERSITY Bachelor of Technology Degree Marksheet Student Name: Avery Sample Course Code CS401 Subject Code CS402 Marks Statement Result PASS'],
    ['unknown', 'a random image with a blue wall and a table'],
    ['unknown', '10th marks'],
    ['unknown', '12th appears on a random poster with unrelated text'],
    ['unknown', 'This random note happens to say semester but has no school or college record'],
    ['unknown', 'CLASS X EXAMINATION SEMESTER III MARKSHEET\nNORTH UNIVERSITY Course Code CS301 SGPA 8.4 Credits 22 Result PASS']
  ];
  for (const [expected, text] of cases) {
    assert.equal(classifier.detectTypeFromContent(text).detectedTypeKey, expected, text);
  }
  assert.equal(DocdonBackend.normalizeDocumentType('Semester Marksheet').canonicalId, 'semester_marksheet');
  assert.equal(DocdonBackend.normalizeDocumentType('Degree Marksheet').canonicalId, 'degree_marksheet');
  assert.equal(DocdonBackend.normalizeDocumentType('Diploma Semester Marksheet').canonicalId, 'diploma_marksheet');

  const romanSemesters = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  romanSemesters.forEach((roman, index) => {
    const result = classifier.detectTypeFromContent(`NORTH UNIVERSITY Semester ${roman} Result Grade Card Student Name: Avery Sample Course Code CS${index + 1}01 SGPA 8.4 Credits 22`);
    assert.equal(result.detectedTypeKey, 'semester_marksheet', `Semester ${roman}`);
    assert.equal(result.semesterNumber, index + 1, `Semester ${roman} number`);
  });
  assert.equal(classifier.detectTypeFromContent('NORTH UNIVERSITY Semester Ill Result Grade Card Course Code CS301 SGPA 8.4 Credits 22').semesterNumber, 3);
  assert.equal(DocdonBackend.normalizeOcrText('Semester Ill'), 'semester iii');
});

test('selected academic type is compared against detected content for all requested wrong matches', () => {
  const class10 = marksheetText();
  const class12 = 'CBSE SENIOR SECONDARY EXAMINATION CLASS XII STATEMENT OF MARKS Candidate Name: Avery Sample Roll No: CBSE-12-223301 Passing Year: 2023 Result: PASS Physics 88/100 Chemistry 91/100 Mathematics 94/100';
  const semester3 = 'NORTH UNIVERSITY Semester III Result Grade Card Student Name: Avery Sample Course Code CS301 SGPA 8.4 Credits 22';
  const cases = [
    ['10th_marksheet', class12, '12th_marksheet'],
    ['10th_marksheet', semester3, 'semester_marksheet'],
    ['12th_marksheet', class10, '10th_marksheet'],
    ['semester_marksheet', class10, '10th_marksheet']
  ];
  for (const [expected, text, detected] of cases) {
    const result = classifier.classifyDocument(expected, { name: 'academic.pdf' }, [], text);
    assert.equal(result.isMatch, false, `${expected} must reject ${detected}`);
    assert.equal(result.detectedTypeKey, detected);
  }
  const matchingSemester = classifier.classifyDocument('semester_marksheet', { name: 'semester.pdf' }, [], semester3);
  assert.equal(matchingSemester.isMatch, true);
  assert.equal(matchingSemester.semesterNumber, 3);
});

test('hosted processing reuses the completed preview OCR pass without invoking server OCR again', async () => {
  const text = marksheetText();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200"><rect width="100%" height="100%" fill="white"/></svg>');
  const image = await sharp(svg).png().toBuffer();
  const ownerId = `ocr-reuse-${Date.now()}`;
  const originalPreprocess = DocdonBackend.api.ocr.preprocessImageForOcr;
  const originalExtract = DocdonBackend.api.ocr.extractRawTextFromPayload;
  let ocrCalls = 0;
  DocdonBackend.api.ocr.preprocessImageForOcr = async () => { ocrCalls++; throw new Error('unexpected second preprocessing pass'); };
  DocdonBackend.api.ocr.extractRawTextFromPayload = async () => { ocrCalls++; throw new Error('unexpected second OCR pass'); };
  try {
    const result = await DocdonBackend.api.processDocument({
      file: { name: 'class-x-preview.png', type: 'image/png', size: image.length },
      fileName: 'class-x-preview.png', fileType: 'image/png', fileSize: image.length,
      fileData: `data:image/png;base64,${image.toString('base64')}`,
      preExtractedOcrText: text, preExtractedOcrAttempted: true,
      preExtractedOcrConfidence: 91, preExtractedOcrMs: 123, preExtractedPreprocessingMs: 45, preExtractedPreviewMs: 500,
      documentType: '10th_marksheet', ownerId
    });
    assert.equal(result.success, true, result.error);
    assert.equal(ocrCalls, 0);
    assert.equal(result.document.detected_document_type, '10th_marksheet');
    assert.equal(result.processingTime.ocrMs, 123);
    assert.equal(result.processingTime.preprocessingMs, 45);
    assert.equal(result.processingTime.clientPreviewMs, 500);
    assert.ok(result.processingTime.totalMs >= 500);
  } finally {
    DocdonBackend.api.ocr.preprocessImageForOcr = originalPreprocess;
    DocdonBackend.api.ocr.extractRawTextFromPayload = originalExtract;
  }
});

test('selected type is an expected type and a mismatch is saved for review', async () => {
  const ownerId = `selected-mismatch-${Date.now()}`;
  const text = 'HIGHER SECONDARY EDUCATION BOARD HSC CLASS XII MARKSHEET Candidate Name: Avery Sample Roll No: HSC-223301 Passing Year: 2023 Result: PASS Physics 88 Chemistry 91 Mathematics 94';
  const result = await DocdonBackend.api.processDocument({
    file: { name: 'selected-semester.pdf', type: 'application/pdf', size: text.length }, fileName: 'selected-semester.pdf',
    fileType: 'application/pdf', fileText: text, isSimulation: true, documentType: 'semester_marksheet', ownerId
  });
  assert.equal(result.success, true, result.error);
  assert.equal(result.document.expected_document_type, 'semester_marksheet');
  assert.equal(result.document.detected_document_type, '12th_marksheet');
  assert.equal(result.document.classification_match, false);
  assert.equal(result.document.document_type, 'semester_marksheet');
  assert.equal(result.document.verification_label, 'Needs Human Review');
  assert.match(result.document.verification_reason, /selected Semester Marksheet.*12th Marksheet/i);
});

test('custom document name persists for review and Human Verify records an audit', async () => {
  const ownerId = `custom-human-${Date.now()}`;
  const text = 'Internship completion letter issued by a small studio to the participant after training.';
  const result = await DocdonBackend.api.processDocument({
    file: { name: 'internship.pdf', type: 'application/pdf', size: text.length }, fileName: 'internship.pdf',
    fileType: 'application/pdf', fileText: text, isSimulation: true, documentType: 'custom_document',
    customDocumentType: 'Internship Certificate', category: 'employment', title: 'Internship Certificate', ownerId
  });
  assert.equal(result.success, true, result.error);
  assert.equal(result.document.document_type, 'custom_document');
  assert.equal(result.document.custom_document_type, 'Internship Certificate');
  assert.equal(result.document.title, 'Internship Certificate');
  assert.equal(result.document.verification_label, 'Needs Human Review');
  assert.equal(result.document.verified, false);

  const verified = DocdonBackend.api.reviewDocument(result.document.document_id, { action: 'approve' });
  assert.equal(verified.success, true);
  assert.equal(verified.document.verification_label, 'Human Verified');
  assert.equal(verified.document.verification_method, 'HUMAN');
  const audit = DocdonBackend.api.getAuditTrail(null, result.document.document_id).events.find(event => event.action === 'HUMAN_VERIFIED');
  assert.ok(audit);
  assert.equal(audit.actor, null);
  assert.equal(audit.metadata.previousStatus, 'Needs Human Review');
  assert.equal(audit.metadata.newStatus, 'Human Verified');
});

test('academic verification persists OCR, classification, fields and requires an authorized owner-scoped human decision', async () => {
  const ownerId = `academic-review-${Date.now()}`;
  const reviewerId = `reviewer-${Date.now()}`;
  DocdonBackend.database.saveUser({ identifier: reviewerId, fullName: 'Academic Reviewer', role: 'reviewer' });
  const text = marksheetText({ heading: 'Class X Secondary Examination', roll: 'REVIEW-10-12345' });
  const result = await DocdonBackend.api.processDocument({
    file: { name: 'scan001.pdf', type: 'application/pdf', size: text.length }, fileName: 'scan001.pdf',
    fileType: 'application/pdf', fileText: text, isSimulation: true, documentType: 'auto', ownerId
  });
  assert.equal(result.success, true, result.error);
  assert.equal(result.document.document_type, '10th_marksheet');
  assert.notEqual(result.document.verification_label, 'Human Verified');
  const saved = DocdonBackend.database.getDocumentById(result.document.document_id);
  assert.equal(saved.academic_verification.ownerId, ownerId);
  assert.equal(saved.academic_verification.documentType, '10th_marksheet');
  assert.match(saved.academic_verification.ocr.text, /Secondary Examination/);
  assert.ok(saved.academic_verification.fields.studentName);
  assert.equal(DocdonBackend.api.reviewDocument(saved.document_id, { action: 'approve', reviewerId, ownerId: 'another-user' }).success, false);
  assert.equal(DocdonBackend.api.reviewDocument(saved.document_id, { action: 'approve', reviewerId: ownerId, ownerId }).success, false);

  const approved = DocdonBackend.api.reviewDocument(saved.document_id, { action: 'approve', reviewerId, ownerId, note: 'Checked original board and marks.' });
  assert.equal(approved.success, true, approved.error);
  assert.equal(approved.document.verification_label, 'Human Verified');
  assert.equal(approved.document.academic_verification.verificationStatus, 'HUMAN_VERIFIED');
  assert.equal(approved.document.academic_verification.humanReview.reviewerId, DocdonBackend.database.getUser(reviewerId).id);
  assert.equal(approved.document.academic_verification.humanReview.decision, 'approved');
  const audit = DocdonBackend.api.getAuditTrail(null, saved.document_id).events.find(event => event.action === 'HUMAN_VERIFIED');
  assert.equal(audit.metadata.ownerId, ownerId);
  assert.equal(audit.metadata.decision, 'approved');

  const twelfthText = 'CENTRAL BOARD OF SECONDARY EDUCATION SENIOR SECONDARY EXAMINATION CLASS XII Candidate Name: Avery Sample Roll No: CBSE-12-12345 Passing Year: 2023 Physics 88/100 Chemistry 91/100 Mathematics 94/100 English 85/100 Result: PASS';
  const twelfth = await DocdonBackend.api.processDocument({
    file: { name: 'document.pdf', type: 'application/pdf', size: twelfthText.length }, fileName: 'document.pdf',
    fileType: 'application/pdf', fileText: twelfthText, isSimulation: true, documentType: 'auto', ownerId
  });
  assert.equal(twelfth.success, true, twelfth.error);
  assert.equal(twelfth.document.document_type, '12th_marksheet');
  assert.notEqual(twelfth.document.verification_label, 'Human Verified');
  const rejected = DocdonBackend.api.reviewDocument(twelfth.document.document_id, { action: 'reject', reviewerId, ownerId, note: 'The certificate details did not match.' });
  assert.equal(rejected.success, true, rejected.error);
  assert.equal(rejected.document.verification_label, 'Rejected');
  assert.equal(rejected.document.academic_verification.verificationStatus, 'REJECTED');
  assert.equal(DocdonBackend.api.getAuditTrail(null, twelfth.document.document_id).events.some(event => event.action === 'DOCUMENT_REJECTED'), true);
});

test('requirements matching keeps semester, school-level, and custom document types distinct', () => {
  const match = DocdonBackend.matchRequirementToVaultDoc;
  const requirement = (typeKey, name) => ({ typeKey, name });
  const vaultDoc = (documentType, title) => ({ documentType, title });
  assert.equal(match(requirement('10th_marksheet', '10th Marksheet'), [vaultDoc('semester_marksheet', 'Semester Marksheet')]), null);
  assert.equal(match(requirement('12th_marksheet', '12th Marksheet'), [vaultDoc('semester_marksheet', 'Semester Marksheet')]), null);
  assert.equal(match(requirement('semester_marksheet', 'Semester Marksheet'), [vaultDoc('10th_marksheet', '10th Marksheet')]), null);
  assert.equal(match(requirement('10th_marksheet', '10th Marksheet'), [vaultDoc('custom_document', '10th Marksheet')]), null);
  assert.ok(match(requirement('semester_marksheet', 'Semester Marksheet'), [vaultDoc('semester_marksheet', 'Semester Marksheet')]));
});

test('Tesseract reads scanned multi-page PDFs and combines evidence across pages', async () => {
  const pdfBuffer = await makeScannedPdf();
  const result = await DocdonBackend.api.ocr.extractTextFromPdf(pdfBuffer);
  assert.equal(result.success, true, result.error);
  assert.equal(result.pageCount, 2);
  assert.match(result.text, /Avery Sample/i);
  assert.match(result.text, /Mathematics/i);
  assert.ok(result.ocrConfidence >= 0 && result.ocrConfidence <= 100);
  assert.equal(result.source, 'pdfjs-rendered-page-ocr');
  const classification = classifier.classifyDocument('10th_marksheet', {}, [], result.text);
  assert.equal(classification.isMatch, true, classification.mismatchReason);
  assert.equal(classification.detectedTypeKey, '10th_marksheet');

  const scanned12 = await DocdonBackend.api.ocr.extractTextFromPdf(await makeScannedPdf('12th'));
  assert.equal(scanned12.success, true, scanned12.error);
  const detected12 = classifier.detectTypeFromContent(scanned12.text);
  assert.equal(detected12.documentFamily, 'marksheet');
  assert.equal(detected12.academicLevel, '12th', JSON.stringify({ text: scanned12.text, detected12 }));
  assert.equal(detected12.detectedTypeKey, '12th_marksheet');
  assert.equal(classifier.classifyDocument('12th_marksheet', {}, [], scanned12.text).isMatch, true);
});

test('searchable PDFs use text extraction without mislabeling extraction score as OCR confidence', async () => {
  const result = await DocdonBackend.api.ocr.extractTextFromPdf(await makeTextPdf());
  assert.equal(result.success, true);
  assert.match(result.text, /Avery Sample/);
  assert.ok(['pdf-parse', 'pdf-parse-fallback', 'pdfjs-text'].includes(result.source));
  assert.equal(result.ocrConfidence, null);
  assert.ok(result.extractionConfidence >= 90);
});

test('backend stores likely and verified documents safely, distinguishes duplicates and versions', async () => {
  const ownerId = `ocr-test-${Date.now()}`;
  const originalText = marksheetText();
  const basePayload = {
    file: { name: '10th_marksheet.pdf', type: 'application/pdf', size: originalText.length },
    fileName: '10th_marksheet.pdf',
    fileType: 'application/pdf',
    fileText: originalText,
    isSimulation: true,
    documentType: '10th_marksheet',
    ownerId
  };

  const first = await DocdonBackend.api.processDocument(basePayload);
  assert.equal(first.success, true, first.error);
  assert.equal(first.document.document_type, '10th_marksheet');
  assert.equal(first.classification.documentFamily, 'marksheet');
  assert.equal(first.classification.academicLevel, '10th');
  assert.ok(first.processingTime.ocrMs >= 0);
  assert.ok(first.processingTime.classificationMs >= 0);
  assert.ok(first.processingTime.fieldExtractionMs >= 0);
  assert.ok(first.processingTime.validationMs >= 0);
  assert.ok(first.processingTime.duplicateDetectionMs >= 0);
  assert.ok(first.processingTime.totalMs >= 0);
  assert.equal(first.verification.finalStatus, 'AI Check Passed');
  assert.equal(first.document.verified, false, 'OCR must never set Human Verified');
  assert.equal(first.document.verification_label, 'AI Check Passed');
  assert.ok(first.ocr.extractedFields.student_name);
  assert.ok(first.ocr.extractedFields.roll_number);
  assert.ok(first.ocr.extractedFields.subjects_grades);
  assert.ok(first.requirements.requiredDocuments.some(doc => doc.typeKey === '10th_marksheet' && doc.isStored));
  const pipelineAudit = DocdonBackend.api.getAuditTrail(null, first.document.document_id).events;
  for (const action of ['document_uploaded', 'ocr_completed', 'classification_completed', 'validation_completed', 'document_created']) {
    assert.ok(pipelineAudit.some(event => event.action === action), `audit action ${action} recorded`);
  }

  const renamedDuplicate = await DocdonBackend.api.processDocument({
    ...basePayload,
    fileName: 'My_10th_Final.jpg',
    fileType: 'application/pdf'
  });
  assert.equal(renamedDuplicate.success, true, renamedDuplicate.error);
  assert.equal(renamedDuplicate.duplicateDetected, true);
  assert.equal(renamedDuplicate.document.document_id, first.document.document_id);
  assert.equal(renamedDuplicate.document.version, 1);

  const differentCredential = await DocdonBackend.api.processDocument({
    ...basePayload,
    fileName: 'Different_Roll.pdf',
    fileText: marksheetText({ roll: 'CBSE-10-992114' })
  });
  assert.equal(differentCredential.success, true, differentCredential.error);
  assert.equal(differentCredential.duplicateDetected, false);
  assert.notEqual(differentCredential.document.document_id, first.document.document_id);

  const newVersion = await DocdonBackend.api.processDocument({
    ...basePayload,
    fileName: 'marksheet_final.pdf',
    fileText: marksheetText({ marks: 'English 90/100, Mathematics 94/100, Science 91/100, Social Studies 92/100' })
  });
  assert.equal(newVersion.success, true, newVersion.error);
  assert.equal(newVersion.duplicateDetected, true);
  assert.equal(newVersion.document.version, 2);
  assert.equal(newVersion.document.previousVersionId, first.document.document_id);
  assert.equal(DocdonBackend.database.getDocumentById(first.document.document_id).versionStatus, 'history');
});

test('camera alias uses the same backend classifier and never human-verifies', async () => {
  const result = await DocdonBackend.api.cameraDocument({
    fileText: marksheetText({ roll: 'CAMERA-10-123456' }),
    isSimulation: true,
    documentType: '10th_marksheet',
    ownerId: `camera-test-${Date.now()}`
  });
  assert.equal(result.success, true, result.error);
  assert.equal(result.document.document_type, '10th_marksheet');
  assert.equal(result.document.current_status, 'AI Checked');
  assert.equal(result.document.verification_label, 'AI Check Passed');
  assert.equal(result.document.verified, false);
  assert.equal(result.processingDocument.source, 'camera');

  const twelfthText = 'SENIOR SECONDARY EXAMINATION CLASS XII STATEMENT OF MARKS Candidate Name: Avery Sample Roll No: CAM-12-223301 Passing Year: 2024 Result: PASS Physics 88/100 Chemistry 91/100 Mathematics 94/100 English 85/100';
  const twelfth = await DocdonBackend.api.cameraDocument({
    fileText: twelfthText, isSimulation: true, documentType: '12th_marksheet', ownerId: `camera-12-test-${Date.now()}`
  });
  assert.equal(twelfth.success, true, twelfth.error);
  assert.equal(twelfth.document.document_type, '12th_marksheet');
  assert.equal(twelfth.classification.academicLevel, '12th');
  assert.equal(twelfth.document.current_status, 'AI Checked');
  assert.equal(twelfth.document.verified, false);
});

test('upload rejects MIME and filename extension mismatches before OCR or storage', async () => {
  const result = await DocdonBackend.api.processDocument({
    file: { name: 'credential.pdf', type: 'image/png' },
    fileData: 'data:image/png;base64,iVBORw0KGgo=',
    documentType: '10th_marksheet', ownerId: `mime-test-${Date.now()}`
  });
  assert.equal(result.success, false);
  assert.match(result.error, /extension does not match/i);
});

test('Vault search survives server sync with extracted names and document identifiers', async () => {
  const ownerId = `vault-search-${Date.now()}`;
  const result = await DocdonBackend.api.processDocument({
    file: { name: 'marksheet.pdf', type: 'application/pdf' }, fileType: 'application/pdf',
    fileText: marksheetText({ name: 'Searchable Sample', roll: 'SEARCH-10-12345' }),
    isSimulation: true, documentType: '10th_marksheet', ownerId
  });
  assert.equal(result.success, true, result.error);
  const listed = DocdonBackend.api.getDocuments(ownerId).documents[0];
  assert.equal(listed.personName, 'Searchable Sample');
  assert.equal(listed.extractedFields.roll_number, 'SEARCH-10-12345');
  const html = fs.readFileSync(path.join(__dirname, '..', 'storage.html'), 'utf8');
  assert.match(html, /\.\.\.Object\.values\(doc\.extractedFields \|\| \{\}\)/);
  assert.match(html, /onclick="inspectDocument\('\$\{doc\.id\}'\)"[^>]*>Review Document/);
  assert.match(html, /Confirm Human Review/);
  assert.match(html, /reviewed the uploaded document, OCR fields, confidence, and verification reason/);
});
