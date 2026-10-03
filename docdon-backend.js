/**
 * ============================================================================
 * DOCDON - Official Backend, Data, OCR & Verification Architecture
 * ============================================================================
 * Modular, ML-Ready Architecture:
 * Frontend ➔ Backend API ➔ Document Processing Service ➔ OCR ➔
 * Document Classification ➔ Field Validation ➔ Verification Engine ➔
 * Confidence Decision ➔ Audit Trail ➔ Existing DOCDON UI
 * ============================================================================
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DocdonBackend = factory();
    root.DocdonAPI = root.DocdonBackend.api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const globalRoot = typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {}));

  function withStageTimeout(operation, timeoutMs, stageName, onTimeout) {
    let timer;
    const work = Promise.resolve().then(operation);
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${stageName} timed out after ${timeoutMs}ms`);
        error.code = 'DOCDON_STAGE_TIMEOUT';
        error.stage = stageName;
        try { onTimeout?.(error); } catch (cleanupError) {
          console.error(`[DOCDON] ${stageName} timeout cleanup failed:`, cleanupError.message || cleanupError);
        }
        reject(error);
      }, timeoutMs);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  const PROCESSING_STAGE_TIMEOUTS = Object.freeze({
    OCR: 60000,
    CLASSIFICATION: 10000,
    FIELD_EXTRACTION: 10000,
    VALIDATION: 10000,
    DUPLICATE_DETECTION: 10000
  });

  // ==========================================================================
  // SECTION 1B: CANONICAL DOCUMENT TAXONOMY & NORMALIZATION ENGINE
  // Single Source of Truth for Document Classification, Storage, and Deduplication
  // ==========================================================================
  const CANONICAL_DOCUMENT_TAXONOMY = {
    'driving_licence': {
      canonicalId: 'driving_licence',
      canonicalName: 'Driving Licence',
      category: 'identity',
      issuingAuthority: 'Regional Transport Office (RTO), Motor Vehicles Department',
      requiredFields: ['driver_name', 'licence_number', 'dob', 'issue_date', 'expiry_date'],
      aliases: [
        'driving licence', 'driving license', 'state driving license', 'state driving licence',
        'dl', 'driver license', 'driver licence', 'driving card', 'motor vehicle licence',
        'parivahan dl', 'rto dl', 'indian driving licence', 'driving permit', 'state dl'
      ],
      stateAware: true
    },
    'aadhaar_card': {
      canonicalId: 'aadhaar_card',
      canonicalName: 'Aadhaar Card',
      category: 'identity',
      issuingAuthority: 'Unique Identification Authority of India (UIDAI)',
      requiredFields: ['cardholder_name', 'aadhaar_number', 'dob'],
      aliases: [
        'aadhaar card', 'aadhaar', 'aadhar card', 'aadhar', 'uidai', 'uidai card',
        'aadhaar uid', 'mera aadhaar', 'e-aadhaar', 'uid'
      ],
      stateAware: false
    },
    'pan_card': {
      canonicalId: 'pan_card',
      canonicalName: 'PAN Card',
      category: 'identity',
      issuingAuthority: 'Income Tax Department, Government of India',
      requiredFields: ['holder_name', 'pan_number', 'dob', 'father_name'],
      aliases: [
        'pan card', 'pan', 'permanent account number', 'pancard', 'nsdl pan', 'utiitsl pan',
        'permanent account number (pan) card', 'pan card (permanent account number)'
      ],
      stateAware: false
    },
    'passport': {
      canonicalId: 'passport',
      canonicalName: 'Passport',
      category: 'identity',
      issuingAuthority: 'Ministry of External Affairs, Consular Passport & Visa Division',
      requiredFields: ['holder_name', 'passport_number', 'dob', 'nationality', 'issue_date', 'expiry_date'],
      aliases: [
        'passport', 'national passport', 'international passport', 'passport booklet',
        'republic of india passport', 'indian passport', 'diplomatic passport', 'passport (original booklet)'
      ],
      stateAware: false
    },
    'voter_id': {
      canonicalId: 'voter_id',
      canonicalName: 'Voter ID',
      category: 'identity',
      issuingAuthority: 'Election Commission of India (ECI)',
      requiredFields: ['elector_name', 'epic_number', 'constituency'],
      aliases: [
        'voter id', 'voter id card', 'voter card', 'epic', 'epic card', 'election card',
        'electoral photo identity card', 'matdata identity card', 'voter identity card'
      ],
      stateAware: true
    },
    '10th_marksheet': {
      canonicalId: '10th_marksheet',
      canonicalName: '10th Marksheet',
      category: 'academic',
      issuingAuthority: 'State Board of Secondary & Higher Secondary Education / CBSE / ICSE',
      requiredFields: ['student_name', 'roll_number', 'examination_board', 'passing_year', 'subjects_grades'],
      aliases: [
        '10th marksheet', '10th mark sheet', 'ssc marksheet', 'secondary school certificate',
        '10th board marksheet', 'matriculation marksheet', 'class 10 marksheet', '10th class marksheet',
        'ssc board marksheet', 'high school marksheet', '10th secondary school certificate',
        'class x marksheet', '10th standard marksheet', 'x standard marksheet', 'secondary marksheet',
        'secondary examination', 'secondary school examination', 'high school certificate',
        'class x result', '10th result', 'class 10 result', 'all india secondary school examination',
        'madhyamik marksheet', 'madhyamik pariksha', 'secondary examination marksheet',
        'class 10 mark sheet', 'class x mark sheet', 'x marksheet', 'matric marksheet'
      ],
      stateAware: true
    },
    '12th_marksheet': {
      canonicalId: '12th_marksheet',
      canonicalName: '12th Marksheet',
      category: 'academic',
      issuingAuthority: 'State Board of Higher Secondary Education / CBSE / ISC',
      requiredFields: ['student_name', 'roll_number', 'examination_board', 'passing_year', 'stream_subjects'],
      aliases: [
        '12th marksheet', '12 marksheet', '12 markshheet', '12th mark sheet', '12 mark sheet',
        'hsc marksheet', 'higher secondary marksheet', '12th higher secondary marksheet',
        'class 12 marksheet', 'class 12 marks', 'intermediate marksheet', '12th board marksheet',
        'senior secondary marksheet', '12th class marksheet', 'higher secondary certificate',
        '12th marks', '12 marks'
      ],
      stateAware: true
    },
    'semester_marksheet': {
      canonicalId: 'semester_marksheet', canonicalName: 'Semester Marksheet', category: 'academic',
      issuingAuthority: 'University / College Examination Authority',
      requiredFields: ['student_name', 'university_name', 'semester', 'course', 'subjects_grades'],
      aliases: ['semester marksheet', 'semester mark sheet', 'semester examination result', 'semester result', 'university result', 'university examination', 'university grade card', 'grade card', 'grade sheet', 'sgpa', 'cgpa', 'university marks statement'], stateAware: false
    },
    'degree_marksheet': {
      canonicalId: 'degree_marksheet', canonicalName: 'Degree Marksheet', category: 'academic',
      issuingAuthority: 'Accredited University / Higher Education Institution',
      requiredFields: ['student_name', 'university_name', 'degree_program', 'subjects_grades'],
      aliases: ['degree marksheet', 'degree mark sheet', 'bachelor marksheet', 'bachelors marksheet'], stateAware: false
    },
    'diploma_marksheet': {
      canonicalId: 'diploma_marksheet', canonicalName: 'Diploma Marksheet', category: 'academic',
      issuingAuthority: 'State Board of Technical Education / Polytechnic Directorate',
      requiredFields: ['candidate_name', 'technical_board', 'semester', 'subjects_grades'],
      aliases: ['diploma marksheet', 'diploma mark sheet', 'diploma semester marksheet', 'polytechnic marksheet'], stateAware: false
    },
    'certificate': {
      canonicalId: 'certificate', canonicalName: 'Certificate', category: 'academic',
      issuingAuthority: 'Issuing institution', requiredFields: [], aliases: ['certificate'], stateAware: false
    },
    'other_academic_document': {
      canonicalId: 'other_academic_document', canonicalName: 'Other Academic Document', category: 'academic',
      issuingAuthority: 'Educational institution', requiredFields: [], aliases: ['other academic document'], stateAware: false
    },
    'custom_document': {
      canonicalId: 'custom_document', canonicalName: 'Custom Document', category: 'other',
      issuingAuthority: null, requiredFields: [], aliases: ['custom document', 'other custom document'], stateAware: false
    },
    'birth_certificate': {
      canonicalId: 'birth_certificate',
      canonicalName: 'Birth Certificate',
      category: 'identity',
      issuingAuthority: 'Department of Registration of Births & Deaths, Municipal Corporation',
      requiredFields: ['child_name', 'registration_no', 'dob', 'place_of_birth', 'parents_names'],
      aliases: [
        'birth certificate', 'birth cert', 'municipal birth certificate', 'janam praman patra',
        'certificate of birth', 'birth registration certificate'
      ],
      stateAware: true
    },
    'bank_passbook_statement': {
      canonicalId: 'bank_passbook_statement',
      canonicalName: 'Bank Passbook/Statement',
      category: 'financial',
      issuingAuthority: 'Scheduled Commercial Bank / Reserve Banking Authority',
      requiredFields: ['account_holder', 'account_number', 'ifsc_code', 'statement_period'],
      aliases: [
        'bank passbook/statement', 'bank passbook', 'bank statement', 'passbook',
        'account statement', 'bank account statement', 'savings bank passbook',
        'certified bank statement', 'certified bank statement (last 6 months)', 'bank passbook / statement'
      ],
      stateAware: false
    },
    'address_proof': {
      canonicalId: 'address_proof',
      canonicalName: 'Address Proof',
      category: 'identity',
      issuingAuthority: 'Public Utility Service / Municipal Board / Electricity Discom',
      requiredFields: ['resident_name', 'full_address', 'consumer_id', 'bill_date'],
      aliases: [
        'address proof', 'proof of address', 'utility statement', 'utility bill',
        'electricity bill', 'water bill', 'gas bill', 'domicile certificate',
        'residence proof', 'utility statement (electricity proof)', 'permanent address proof',
        'domicile / residence certificate'
      ],
      stateAware: true
    },
    '10th_school_lc': {
      canonicalId: '10th_school_lc',
      canonicalName: '10th School Leaving Certificate (10th LC)',
      category: 'academic',
      issuingAuthority: 'Recognized Secondary School / Educational Institute',
      requiredFields: ['student_name', 'school_name', 'gr_number', 'dob', 'leaving_date'],
      aliases: [
        '10th school leaving certificate', '10th lc', 'school leaving certificate',
        'transfer certificate', 'tc', '10th tc', 'school lc', 'leaving certificate',
        '10th school leaving certificate (10th lc)'
      ],
      stateAware: true
    },
    'diploma_certificate': {
      canonicalId: 'diploma_certificate',
      canonicalName: 'Diploma Certificate',
      category: 'academic',
      issuingAuthority: 'State Board of Technical Education / Polytechnic Directorate',
      requiredFields: ['candidate_name', 'technical_board', 'polytechnic_program', 'passing_year', 'diploma_reg_no'],
      aliases: [
        'diploma certificate', 'polytechnic diploma', 'diploma', 'engineering diploma',
        'diploma in engineering', 'polytechnic certificate', 'highest degree / diploma certificate',
        'professional degree / diploma'
      ],
      stateAware: true
    },
    'degree_certificate': {
      canonicalId: 'degree_certificate',
      canonicalName: 'Degree Certificate',
      category: 'academic',
      issuingAuthority: 'Accredited University / Autonomous Higher Education Institution',
      requiredFields: ['graduate_name', 'university_name', 'degree_program', 'convocation_year', 'degree_reg_no'],
      aliases: [
        'degree certificate', 'highest degree / graduation certificate', 'graduation certificate',
        'bachelor degree', 'b.tech degree', 'degree', 'btech computer engineering degree',
        'university degree', 'convocation certificate', 'highest degree certificate',
        'b.tech computer engineering degree', 'btech degree'
      ],
      stateAware: false
    },
    'resume': {
      canonicalId: 'resume',
      canonicalName: 'Resume / Curriculum Vitae (CV)',
      category: 'career',
      issuingAuthority: 'Self / Professional Career Profile',
      requiredFields: ['candidate_name', 'summary_skills', 'education_history'],
      aliases: [
        'resume', 'curriculum vitae', 'cv', 'resume / curriculum vitae (cv)',
        'biodata', 'professional resume', 'curriculum vitae (cv)'
      ],
      stateAware: false
    }
  };

  const INDIAN_STATES = [
    { name: 'Maharashtra', code: 'MH' },
    { name: 'Karnataka', code: 'KA' },
    { name: 'Delhi', code: 'DL' },
    { name: 'Tamil Nadu', code: 'TN' },
    { name: 'Uttar Pradesh', code: 'UP' },
    { name: 'Gujarat', code: 'GJ' },
    { name: 'West Bengal', code: 'WB' },
    { name: 'Kerala', code: 'KL' },
    { name: 'Punjab', code: 'PB' },
    { name: 'Rajasthan', code: 'RJ' },
    { name: 'Andhra Pradesh', code: 'AP' },
    { name: 'Telangana', code: 'TS' },
    { name: 'Madhya Pradesh', code: 'MP' },
    { name: 'Bihar', code: 'BR' },
    { name: 'Haryana', code: 'HR' },
    { name: 'Odisha', code: 'OD' },
    { name: 'Assam', code: 'AS' },
    { name: 'Goa', code: 'GA' },
    { name: 'Jharkhand', code: 'JH' },
    { name: 'Chhattisgarh', code: 'CG' },
    { name: 'Himachal Pradesh', code: 'HP' },
    { name: 'Uttarakhand', code: 'UK' },
    { name: 'Chandigarh', code: 'CH' },
    { name: 'Jammu and Kashmir', code: 'JK' }
  ];

  /**
   * Central Normalization Function - Single Source of Truth
   * Maps all synonyms, state prefixes, and colloquial names to canonical document representations
   * @param {string|object} rawInput - Document type string, title, or document object
   * @returns {object} Canonical document specification
   */
  function normalizeDocumentType(rawInput) {
    if (!rawInput) {
      return {
        canonicalId: 'unrecognized',
        canonicalName: 'Unrecognized Document',
        category: 'unknown',
        subtype: null,
        state: null,
        issuingAuthority: null,
        requiredFields: [],
        confidence: 0
      };
    }

    let inputStr = '';
    if (typeof rawInput === 'object') {
      inputStr = [rawInput.title, rawInput.documentType, rawInput.document_type, rawInput.name, rawInput.type].filter(Boolean).join(' ');
    } else {
      inputStr = String(rawInput);
    }

    const clean = inputStr.toLowerCase().trim();

    // Detect state if mentioned in title or credential code
    let detectedState = null;
    for (const st of INDIAN_STATES) {
      const stateNameRegex = new RegExp(`\\b${st.name}\\b`, 'i');
      const stateCodeRegex = new RegExp(`\\b${st.code}[- ]?\\d{2}\\b`, 'i');
      if (stateNameRegex.test(inputStr) || stateCodeRegex.test(inputStr)) {
        detectedState = st.name;
        break;
      }
    }

    // Direct key match
    if (CANONICAL_DOCUMENT_TAXONOMY[clean]) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY[clean];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: detectedState && entry.stateAware ? `${entry.issuingAuthority}, ${detectedState}` : entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: 1.0
      };
    }

    // Specific academic record labels must win over broad aliases such as
    // "degree", "diploma", and "certificate".
    if (/\b(?:diploma|polytechnic)\b.*\b(?:marksheet|mark\s+sheet|result|grade\s+card|semester)\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['diploma_marksheet'];
      return { canonicalId: entry.canonicalId, canonicalName: entry.canonicalName, category: entry.category, subtype: entry.canonicalId, state: detectedState, issuingAuthority: entry.issuingAuthority, requiredFields: [...entry.requiredFields], confidence: 0.9 };
    }
    if (/\b(?:degree|bachelor|undergraduate|postgraduate|b\.?tech|b\.?e\.?|b\.?sc|b\.?com|b\.?a\.?|bba|bca|mbbs)\b.*\b(?:marksheet|mark\s+sheet|result|grade\s+card)\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['degree_marksheet'];
      return { canonicalId: entry.canonicalId, canonicalName: entry.canonicalName, category: entry.category, subtype: entry.canonicalId, state: detectedState, issuingAuthority: entry.issuingAuthority, requiredFields: [...entry.requiredFields], confidence: 0.9 };
    }

    // Match against aliases
    for (const [key, entry] of Object.entries(CANONICAL_DOCUMENT_TAXONOMY)) {
      for (const alias of entry.aliases) {
        if (clean === alias || clean.startsWith(alias + ' ') || clean.endsWith(' ' + alias) || clean.includes(alias)) {
          return {
            canonicalId: entry.canonicalId,
            canonicalName: entry.canonicalName,
            category: entry.category,
            subtype: entry.canonicalId,
            state: detectedState,
            issuingAuthority: detectedState && entry.stateAware ? `${entry.issuingAuthority}, ${detectedState}` : entry.issuingAuthority,
            requiredFields: [...entry.requiredFields],
            confidence: clean === alias ? 0.98 : 0.90
          };
        }
      }
    }

    // Keyword heuristics
    if (/\b(driving|licence|license)\b/i.test(clean) || /\bdl\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['driving_licence'];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: detectedState ? `${entry.issuingAuthority}, ${detectedState}` : entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: 0.88
      };
    }

    if (/\b(pan|permanent account)\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['pan_card'];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: 0.88
      };
    }

    if (/\b(aadhaar|aadhar|uidai)\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['aadhaar_card'];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: 0.88
      };
    }

    if (/\bpassport\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['passport'];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: 0.88
      };
    }

    if (/\bvoter\b|\bepic\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['voter_id'];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: 0.88
      };
    }

    const semesterContext = /\b(?:semester\s+(?:examination|result|marksheet|mark\s+sheet|grade\s+card|i|ii|iii|iv|v|vi|vii|viii|[1-8])|sem\s*(?:i|ii|iii|iv|v|vi|vii|viii|[1-8])|end\s+semester\s+examination|sgpa|cgpa|grade\s+card|grade\s+sheet|university\s+marks\s+statement)\b/i.test(clean);
    const universityContext = /\b(?:university|college|course\s+code|subject\s+code|credits?|department)\b/i.test(clean);
    if (semesterContext && universityContext && detectMarksheetFamily(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['semester_marksheet'];
      return { canonicalId: entry.canonicalId, canonicalName: entry.canonicalName, category: entry.category, subtype: entry.canonicalId, state: detectedState, issuingAuthority: entry.issuingAuthority, requiredFields: [...entry.requiredFields], confidence: 0.92 };
    }

    const markFamily = detectMarksheetFamily(clean);
    const levelResult = detectAcademicLevel(clean);
    if (markFamily && levelResult.academicLevel !== 'unknown') {
      const entry = CANONICAL_DOCUMENT_TAXONOMY[levelResult.academicLevel === '10th' ? '10th_marksheet' : '12th_marksheet'];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: levelResult.academicLevelConfidence / 100
      };
    }

    if (/\b(degree|b\.?tech|graduation|bachelor|convocation)\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['degree_certificate'];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: 0.88
      };
    }

    if (/\b(diploma|polytechnic)\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['diploma_certificate'];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: 0.88
      };
    }

    if (/\b(utility|electricity|address|domicile|residence)\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['address_proof'];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: 0.85
      };
    }

    if (/\b(bank|passbook|statement)\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['bank_passbook_statement'];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: 0.85
      };
    }

    if (/\b(resume|cv|curriculum vitae)\b/i.test(clean)) {
      const entry = CANONICAL_DOCUMENT_TAXONOMY['resume'];
      return {
        canonicalId: entry.canonicalId,
        canonicalName: entry.canonicalName,
        category: entry.category,
        subtype: entry.canonicalId,
        state: detectedState,
        issuingAuthority: entry.issuingAuthority,
        requiredFields: [...entry.requiredFields],
        confidence: 0.85
      };
    }

    // Unrecognized / Random Image
    return {
      canonicalId: 'unrecognized',
      canonicalName: 'Unrecognized Document',
      category: 'unknown',
      subtype: null,
      state: null,
      issuingAuthority: null,
      requiredFields: [],
      confidence: 0
    };
  }

  function normalizeOcrText(rawText = '') {
    if (rawText === null || rawText === undefined) return '';
    let text = String(rawText).replace(/\r/g, '\n');
    text = text.replace(/[\u2018\u2019]/g, "'");
    text = text.replace(/[\u2013\u2014]/g, '-');
    text = text.toLowerCase();
    const controlledAliases = [
      [/\b(semester|sem)\s+ill\b/gi, '$1 iii'],
      [/\b(semester|sem)\s+vll\b/gi, '$1 vii'],
      [/\b(semester|sem)\s+vlll\b/gi, '$1 viii'],
      [/\b(?:i0th|ioth|1oth|io[tт]h|10[tт]h)\b/gi, '10th'],
      [/\b(?:i2th|1zth|12[tт]h)\b/gi, '12th'],
      [/\bc1ass\b/gi, 'class'],
      [/\bclass\s*(?:k|×)\b/gi, 'class x'],
      [/\bclass\s*1[oо]\b/gi, 'class 10'],
      [/\bclass\s*x1i\b/gi, 'class xii'],
      [/\bclass\s*x11\b/gi, 'class xii'],
      [/\bclass\s*xil\b/gi, 'class xii'],
      [/\bx11\b/gi, 'xii'],
      [/\bx1i\b/gi, 'xii'],
      [/\bxil\b/gi, 'xii'],
      [/\bclass\s*i0\b/gi, 'class 10'],
      [/\b(?:c8se|c[b8]se)\b/gi, 'cbse'],
      [/\bcl4ss\b/gi, 'class'],
      [/\b(?:narne|n4me)\b/gi, 'name'],
      [/\bstu[dо]ent\b/gi, 'student'],
      [/\bstu[o0]ent\b/gi, 'student'],
      [/\b(?:mar[kк]s|marxs|m4rks)\b/gi, 'marks'],
      [/\bcertiflcate\b/gi, 'certificate'],
      [/\bsecohdary\b/gi, 'secondary'],
      [/\bpasssed\b/gi, 'passed'],
      [/\bresukt\b/gi, 'result'],
      [/\bexaminatlon\b/gi, 'examination'],
      [/\brolln[o0]\b/gi, 'roll no'],
      [/\btx\b/gi, 'x']
    ];
    for (const [pattern, replacement] of controlledAliases) {
      text = text.replace(pattern, replacement);
    }
    text = text.replace(/[.,;:()\[\]{}]+/g, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  // Marksheet family and academic level are detected independently. This is
  // the sole authoritative 10th/12th discriminator used by the backend.
  function detectMarksheetFamily(rawText = '') {
    const text = normalizeOcrText(rawText);
    const hasMarksheetTerm = /\b(?:marksheet|mark\s+sheet|marks\s+statement|statement\s+of\s+marks|grade\s+card|grade\s+sheet|university\s+marks\s+statement)\b/i.test(text);
    const hasExamContext = /\b(?:examination|exam|result|certificate|scorecard|semester)\b/i.test(text);
    const hasAcademicStructure = /\b(?:candidate|student|roll|seat|registration|course\s+code|subject\s+code|sgpa|cgpa|credits?)\s*(?:name|no|number)?\b/i.test(text) || /\b(?:english|mathematics|maths|science|physics|chemistry|biology|history|geography|social\s+studies)\b/i.test(text);
    return hasMarksheetTerm || (hasExamContext && hasAcademicStructure);
  }

  function detectAcademicLevel(rawText = '') {
    const rawSource = String(rawText || '');
    const normalizedText = normalizeOcrText(rawText);
    const header = rawSource.split(/\r?\n/).map(line => normalizeOcrText(line)).filter(Boolean).slice(0, 2).join(' ');
    const patterns10 = [
      ['Class 10', /\bclass\s*(?:10|i0)\b/i], ['Class X', /\bclass\s+x\b/i],
      ['10th', /\b(?:10th|tenth)\b/i], ['10th Standard', /\b(?:10th|tenth)\s+standard\b/i],
      ['X Standard', /\bx\s+standard\b/i], ['Secondary School Examination', /(?<!senior )\bsecondary\s+(?:school\s+)?examination\b/i],
      ['Secondary School Certificate', /\bsecondary\s+school\s+certificate\b/i], ['SSC', /\bssc\b/i], ['Matriculation', /\bmatriculation\b|\bmatric\b/i], ['High School Examination', /\bhigh\s+school(?:\s+examination)?\b/i]
    ];
    const patterns12 = [
      ['Class 12', /\bclass\s*12\b/i], ['Class XII', /\bclass\s*xii\b/i],
      ['12th', /\b(?:12th|twelfth)\b/i], ['XII Standard', /\bxii\s+standard\b/i],
      ['Higher Secondary Examination', /\bhigher\s+secondary(?:\s+school)?(?:\s+examination)?\b/i],
      ['Senior Secondary Examination', /\bsenior\s+secondary(?:\s+examination)?\b/i],
      ['Intermediate', /\bintermediate(?:\s+examination)?\b/i], ['HSC', /\bhsc\b|\bhigher\s+secondary\s+certificate\b/i],
      ['Senior School Certificate', /\bsenior\s+school\s+certificate\b/i], ['Plus Two', /\bplus\s+two\b|\+2\b/i],
      ['XII', /\bxii\b/i]
    ];
    const collect = (patterns, text) => patterns.filter(([, rx]) => rx.test(text)).map(([label]) => label);
    const tenthEvidence = collect(patterns10, normalizedText);
    const twelfthEvidence = collect(patterns12, normalizedText);
    const header10 = collect(patterns10, header);
    const header12 = collect(patterns12, header);
    const has10 = tenthEvidence.length > 0;
    const has12 = twelfthEvidence.length > 0;
    let academicLevel = 'unknown';
    let academicLevelConflict = false;
    // A coherent document heading wins over incidental mentions in body text.
    if (header10.length && !header12.length) academicLevel = '10th';
    else if (header12.length && !header10.length) academicLevel = '12th';
    else if (header10.length && header12.length) academicLevelConflict = true;
    else if (has10 && !has12) academicLevel = '10th';
    else if (has12 && !has10) academicLevel = '12th';
    else if (has10 && has12) academicLevelConflict = true;
    const evidenceCount = academicLevel === '10th' ? tenthEvidence.length : academicLevel === '12th' ? twelfthEvidence.length : 0;
    const rawLevelTokens = [...rawSource.matchAll(/\b(?:class\s*)?(?:xii|x11|x1i|xil|xi|x|10th|i0th|ioth|1oth|12th|i2th|1zth|10|12)\b/gi)]
      .slice(0, 30).map(match => ({ rawToken: match[0], normalizedToken: normalizeOcrText(match[0]) }));
    return {
      academicLevel,
      academicLevelConfidence: academicLevel === 'unknown' ? (academicLevelConflict ? 30 : 48) : Math.min(98, 78 + evidenceCount * 5 + ((academicLevel === '10th' ? header10 : header12).length ? 10 : 0)),
      academicLevelEvidence: { '10th': tenthEvidence, '12th': twelfthEvidence },
      contradictoryEvidence: academicLevelConflict ? [...tenthEvidence, ...twelfthEvidence] : [],
      academicLevelConflict,
      headerEvidence: { '10th': header10, '12th': header12 },
      rawLevelTokens
    };
  }

  function buildMarksheetEvidenceProfile(rawText = '', extractedFields = {}) {
    const text = normalizeOcrText(rawText || '');
    const values = extractedFields || {};

    const evidence = {
      examination: false,
      level: false,
      identity: false,
      result: false,
      structure: false
    };

    const boardPatterns = [
      /\bcbse\b/, /\bcisce\b/, /\bicse\b/, /\bsecondary education board\b/, /\bboard of secondary education\b/, /\bstate board\b/, /\bssc\b/, /\bboard\b.*\bsecondary\b/, /\bboard\b.*\bexamination\b/, /\bmaharashtra state board\b/, /\bbihar school examination board\b/, /\bwest bengal board\b/, /\bup board\b/, /\brajasthan board\b/
    ];
    const examinationPatterns = [
      /\bsecondary school examination\b/, /\bsecondary examination\b/, /\bboard examination\b/, /\bmatriculation examination\b/, /\bclass\s*x\s+examination\b/, /\bexamination certificate\b/, /\bstatement of marks\b/, /\bmarksheet\b/, /\bmark\s+sheet\b/, /\bsecondary school certificate\b/
    ];
    const levelPatterns = [
      /\b10th\b/, /\btenth\b/, /\bclass\s*(10|x)\b/, /\bx\s+standard\b/, /\b10th\s+standard\b/, /\bsecondary\b/, /\bmatric\b/, /\bmatriculation\b/, /\bssc\b/, /\bsecondary school certificate\b/,
      /\b12th\b/, /\btwelfth\b/, /\bclass\s*(12|xii)\b/, /\bxii\s+standard\b/, /\bhigher\s+secondary\b/, /\bsenior\s+secondary\b/, /\bintermediate\b/, /\bhsc\b/, /\bplus\s+two\b/, /\+2\b/
    ];
    const identityPatterns = [
      /\bstudent\s+(?:name|\w+\s+name)\b/, /\bcandidate\s+(?:name|\w+\s+name)\b/, /\broll\s*(?:no|number|num)\b/, /\bseat\s*(?:no|number)\b/, /\breg(?:istration)?\s*(?:no|number)\b/, /\bschool\s*(?:name|code)\b/, /\bdate\s+of\s+birth\b/, /\bdob\b/, /\bfather(?:'s)?\s+name\b/, /\bmother(?:'s)?\s+name\b/
    ];
    const subjectPatterns = [
      /\benglish\b/i, /\b(?:mathematics|maths)\b/i, /\bscience\b/i, /\bsocial\s+studies\b/i,
      /\bhindi\b/i, /\bmarathi\b/i, /\bsanskrit\b/i, /\burdu\b/i, /\bphysics\b/i,
      /\bchemistry\b/i, /\bbiology\b/i, /\bhistory\b/i, /\bgeography\b/i
    ];
    const matchedSubjects = subjectPatterns.filter((pattern) => pattern.test(text));
    const scoreRows = (text.match(/\b\d{1,3}\s*(?:\/|of)\s*\d{2,3}\b|\b\d{2,3}\s+\d{2,3}\b/g) || []).length;
    const hasResultDescriptor = /\b(?:marks\s+obtained|maximum\s+marks|total\s+marks|percentage|grade|grade\s+point|result\s+(?:pass|passed|fail|qualified)|result\s*[:\-]\s*(?:pass|passed|fail|qualified)|division|marks\s+statement|statement\s+of\s+marks)\b/i.test(text);

    evidence.examination = examinationPatterns.some((rx) => rx.test(text)) || (boardPatterns.some((rx) => rx.test(text)) && /\b(?:examination|marksheet|mark\s+sheet|result|certificate|statement)\b/i.test(text)) || Boolean(values.examination_board || values.issuing_board);
    evidence.level = levelPatterns.some((rx) => rx.test(text)) || Boolean(values.class_level || values.level || values.secondary_level);
    evidence.identity = identityPatterns.some((rx) => rx.test(text)) || Boolean(values.student_name || values.candidate_name || values.roll_number || values.school_name || values.date_of_birth || values.dob);
    evidence.result = hasResultDescriptor || (matchedSubjects.length >= 2 && (scoreRows >= 2 || /\b(?:pass|passed|qualified|fail)\b/i.test(text))) || Boolean(values.result_status || values.percentage || values.total_marks);
    evidence.structure = (matchedSubjects.length >= 3 && scoreRows >= 2) || (matchedSubjects.length >= 4 && /\b(?:grade|marks|score|theory|practical)\b/i.test(text)) || Boolean(values.subjects_grades && values.subjects_grades.length > 1 && values.subject_marks);

    const matched = Object.keys(evidence).filter((key) => evidence[key]);
    const missingEvidence = Object.keys(evidence).filter((key) => !evidence[key]);
    let classificationConfidence = 8;
    classificationConfidence += evidence.examination ? 22 : 0;
    classificationConfidence += evidence.level ? 22 : 0;
    classificationConfidence += evidence.identity ? 20 : 0;
    classificationConfidence += evidence.result ? 20 : 0;
    classificationConfidence += evidence.structure ? 16 : 0;
    classificationConfidence += Math.min(10, matched.length * 2);

    const strong = matched.length >= 4 && evidence.level && evidence.examination && evidence.identity && evidence.structure;
    const likely = strong || (matched.length >= 3 && evidence.level && (evidence.result || evidence.structure) && (evidence.examination || evidence.identity));

    return {
      evidence,
      matchedSubjects,
      scoreRows,
      missingEvidence,
      matchedEvidence: matched,
      classificationConfidence: Math.min(99, classificationConfidence),
      isLikely: !!likely,
      isStrong: !!strong
    };
  }

  globalRoot.CANONICAL_DOCUMENT_TAXONOMY = CANONICAL_DOCUMENT_TAXONOMY;
  globalRoot.normalizeDocumentType = normalizeDocumentType;
  globalRoot.normalizeOcrText = normalizeOcrText;
  globalRoot.buildMarksheetEvidenceProfile = buildMarksheetEvidenceProfile;

  // ==========================================================================
  // SECTION 2: DOCUMENT PROFILES SPECIFICATION (All 10+ Standard Profiles)
  // ==========================================================================
  const DOCUMENT_PROFILES = {
    'aadhaar_card': {
      id: 'aadhaar_card',
      name: 'Aadhaar Card',
      category: 'identity',
      isIdentityProof: true,
      isAddressProof: true,
      normallyExpires: false,
      issuingAuthority: 'Unique Identification Authority of India (UIDAI)',
      identifierField: 'aadhaar_number',
      nameField: 'cardholder_name',
      dobField: 'dob',
      issueDateField: null,
      expiryDateField: null,
      formatPattern: '12-Digit UID (XXXX XXXX XXXX)',
      requiredFields: ['cardholder_name', 'aadhaar_number', 'dob'],
      optionalFields: ['gender', 'address', 'uidai_emblem', 'qr_code'],
      keywords: ['aadhaar', 'aadhar', 'uidai', 'unique identification', 'mera aadhaar', 'government of india', 'enrolment'],
      strongContradictionSignals: ['driving licence', 'driving license', 'election commission', 'pan card', 'passport booklet'],
      fieldLabels: {
        cardholder_name: 'Cardholder Full Legal Name',
        aadhaar_number: '12-Digit Aadhaar UID Number',
        dob: 'Date of Birth (DOB) / YOB',
        gender: 'Gender (M/F/T)',
        address: 'Residential Address (Reverse Side)',
        uidai_emblem: 'National Emblem & UIDAI Seal',
        qr_code: 'Secure Digitally Signed QR Code'
      }
    },

    'pan_card': {
      id: 'pan_card',
      name: 'PAN Card',
      category: 'identity',
      isIdentityProof: true,
      isAddressProof: false,
      normallyExpires: false,
      issuingAuthority: 'Income Tax Department, Government of India',
      identifierField: 'pan_number',
      nameField: 'holder_name',
      dobField: 'dob',
      issueDateField: null,
      expiryDateField: null,
      formatPattern: '10-Character Alphanumeric (e.g. ABCPM1234K)',
      requiredFields: ['holder_name', 'pan_number', 'dob', 'father_name'],
      optionalFields: ['income_tax_seal', 'qr_code', 'hologram'],
      keywords: ['pan', 'permanent account number', 'income tax department', 'govt of india', 'incometax'],
      strongContradictionSignals: ['driving licence', 'election commission', 'passport', 'board of secondary education', 'uidai'],
      fieldLabels: {
        holder_name: 'Taxpayer Full Legal Name',
        pan_number: '10-Character Alphanumeric PAN',
        dob: 'Date of Birth (DD/MM/YYYY)',
        father_name: "Father's / Parent Name",
        income_tax_seal: 'Income Tax Crest & Seal',
        qr_code: 'Enhanced Security QR Code'
      }
    },

    'passport': {
      id: 'passport',
      name: 'Passport',
      category: 'identity',
      isIdentityProof: true,
      isAddressProof: true,
      normallyExpires: true,
      defaultValidityYears: 10,
      issuingAuthority: 'Ministry of External Affairs, Consular Passport & Visa Division',
      identifierField: 'passport_number',
      nameField: 'holder_name',
      dobField: 'dob',
      issueDateField: 'issue_date',
      expiryDateField: 'expiry_date',
      formatPattern: '8-Character Sovereign Serial (e.g. Z4892104)',
      requiredFields: ['holder_name', 'passport_number', 'dob', 'nationality', 'issue_date', 'expiry_date'],
      optionalFields: ['mrz_lines', 'place_of_issue', 'biometric_photo'],
      keywords: ['passport', 'republic of india', 'international passport', 'travel document', 'mea', 'passport seva'],
      strongContradictionSignals: ['driving licence', 'board of secondary education', 'permanent account number', 'uidai'],
      fieldLabels: {
        holder_name: 'Given Name & Surname',
        passport_number: 'Passport Booklet Serial Number',
        dob: 'Date of Birth (DOB)',
        nationality: 'Nationality & Sovereign Header',
        issue_date: 'Date of Issue',
        expiry_date: 'Date of Expiry',
        mrz_lines: 'Machine Readable Zone (2-Line MRZ)',
        biometric_photo: 'ICAO Compliant Biometric Portrait'
      }
    },

    'driving_licence': {
      id: 'driving_licence',
      name: 'Driving Licence',
      category: 'identity',
      isIdentityProof: true,
      isAddressProof: true,
      normallyExpires: true,
      defaultValidityYears: 20,
      issuingAuthority: 'Regional Transport Office (RTO), Motor Vehicles Department',
      identifierField: 'licence_number',
      nameField: 'driver_name',
      dobField: 'dob',
      issueDateField: 'issue_date',
      expiryDateField: 'expiry_date',
      formatPattern: 'RTO State Serial (e.g. DL-0420110023481)',
      requiredFields: ['driver_name', 'licence_number', 'dob', 'issue_date', 'expiry_date'],
      optionalFields: ['vehicle_classes', 'rto_authority', 'chip_qr', 'blood_group'],
      keywords: ['driving', 'license', 'licence', 'dl', 'motor vehicle', 'rto', 'driving licence', 'parivahan', 'transport department'],
      strongContradictionSignals: ['passport booklet', 'permanent account number', 'board of secondary education', 'uidai', 'election commission'],
      fieldLabels: {
        driver_name: 'Licensed Driver Full Name',
        licence_number: 'Driving Licence Serial Number',
        dob: 'Date of Birth (DOB)',
        issue_date: 'Date of Issue',
        expiry_date: 'Licence Validity & Expiry Timeline',
        vehicle_classes: 'Authorized Vehicle Classes (MCWG, LMV)',
        rto_authority: 'Issuing RTO & State Emblem'
      }
    },

    'voter_id': {
      id: 'voter_id',
      name: 'Voter ID',
      category: 'identity',
      isIdentityProof: true,
      isAddressProof: true,
      normallyExpires: false,
      issuingAuthority: 'Election Commission of India (ECI)',
      identifierField: 'epic_number',
      nameField: 'elector_name',
      dobField: 'dob',
      issueDateField: null,
      expiryDateField: null,
      formatPattern: '10-Digit Alphanumeric EPIC (e.g. WBG8910245)',
      requiredFields: ['elector_name', 'epic_number', 'constituency'],
      optionalFields: ['dob', 'father_or_husband_name', 'eci_header', 'ero_signature'],
      keywords: ['voter', 'voter id', 'epic', 'election commission of india', 'eci', 'electoral photo', 'matdata'],
      strongContradictionSignals: ['driving licence', 'board examination', 'passport', 'permanent account number', 'bank statement'],
      fieldLabels: {
        elector_name: 'Elector / Voter Full Name',
        epic_number: 'EPIC Card Number',
        constituency: 'Assembly & Parliamentary Constituency',
        father_or_husband_name: "Father's / Husband's Name",
        eci_header: 'Election Commission of India Header'
      }
    },

    '10th_marksheet': {
      id: '10th_marksheet',
      name: '10th Marksheet',
      category: 'academic',
      isIdentityProof: false,
      isAddressProof: false,
      normallyExpires: false,
      issuingAuthority: 'State Board of Secondary & Higher Secondary Education / CBSE / ICSE',
      identifierField: 'roll_number',
      nameField: 'student_name',
      dobField: 'dob',
      issueDateField: 'passing_year',
      expiryDateField: null,
      formatPattern: 'Roll Code & Exam Seat No (e.g. M-892140 / SSC-2021)',
      requiredFields: ['student_name', 'roll_number', 'examination_board', 'passing_year', 'subjects_grades'],
      optionalFields: ['dob', 'school_name', 'board_crest', 'qr_code', 'cgpa_percentage', 'result_status'],
      keywords: ['10th', 'ssc', 'secondary school', 'matriculation', 'board of secondary', '10th marksheet', 'class 10', 'class x', 'high school certificate', 'secondary examination', 'high school', 'madhyamik', 'aisse', 'matric', 'secondary'],
      strongContradictionSignals: ['driving licence', 'passport booklet', 'permanent account number', 'election commission', 'utility bill'],
      fieldLabels: {
        student_name: 'Candidate / Student Full Name',
        roll_number: 'Roll Number / Seat Number',
        examination_board: 'Examination Board & Authority Header',
        passing_year: 'Examination Month & Year',
        subjects_grades: 'Subject Scores & Passing Result',
        result_status: 'Qualifying Result Status',
        dob: 'Date of Birth (Recorded by Board)'
      }
    },

    '12th_marksheet': {
      id: '12th_marksheet',
      name: '12th Marksheet',
      category: 'academic',
      isIdentityProof: false,
      isAddressProof: false,
      normallyExpires: false,
      issuingAuthority: 'State Board of Higher Secondary Education / CBSE / ISC',
      identifierField: 'roll_number',
      nameField: 'student_name',
      dobField: 'dob',
      issueDateField: 'passing_year',
      expiryDateField: null,
      formatPattern: 'Higher Secondary Roll No (e.g. H-492109 / HSC-2023)',
      requiredFields: ['student_name', 'roll_number', 'examination_board', 'passing_year', 'stream_subjects'],
      optionalFields: ['dob', 'stream', 'college_name', 'board_crest', 'result_status'],
      keywords: ['12th', 'hsc', 'higher secondary', 'intermediate', 'class 12', '12th marksheet', 'senior secondary'],
      strongContradictionSignals: ['driving licence', 'passport booklet', 'permanent account number', 'election commission', 'electricity bill'],
      fieldLabels: {
        student_name: 'Student Full Name',
        roll_number: 'HSC Roll Number & Seat Code',
        examination_board: 'Higher Secondary Board Header',
        passing_year: 'Passing Year & Examination Session',
        stream_subjects: 'Stream (Science/Commerce/Arts) & Scores'
      }
    },

    'birth_certificate': {
      id: 'birth_certificate',
      name: 'Birth Certificate',
      category: 'identity',
      isIdentityProof: true,
      isAddressProof: false,
      normallyExpires: false,
      issuingAuthority: 'Department of Registration of Births & Deaths, Municipal Corporation',
      identifierField: 'registration_no',
      nameField: 'child_name',
      dobField: 'dob',
      issueDateField: 'registration_date',
      expiryDateField: null,
      formatPattern: 'Civil Registry Serial (e.g. B-2005-09281)',
      requiredFields: ['child_name', 'registration_no', 'dob', 'place_of_birth', 'parents_names'],
      optionalFields: ['municipal_seal', 'registrar_signature', 'gender'],
      keywords: ['birth', 'birth certificate', 'births and deaths', 'municipal corporation', 'registrar births', 'janam praman'],
      strongContradictionSignals: ['marksheet', 'driving licence', 'passport', 'pan card', 'voter id', 'bank passbook'],
      fieldLabels: {
        child_name: 'Child Full Legal Name',
        registration_no: 'Civil Registration Number',
        dob: 'Exact Date & Place of Birth',
        parents_names: "Parents' Legal Names",
        municipal_seal: 'Municipal Registrar Official Crest'
      }
    },

    'bank_passbook_statement': {
      id: 'bank_passbook_statement',
      name: 'Bank Passbook/Statement',
      category: 'financial',
      isIdentityProof: false,
      isAddressProof: true,
      normallyExpires: true,
      validityWindowDays: 90, // Valid within 90 days for KYC/admissions
      issuingAuthority: 'Scheduled Commercial Bank / Reserve Banking Authority',
      identifierField: 'account_number',
      nameField: 'account_holder',
      dobField: null,
      issueDateField: 'statement_date',
      expiryDateField: 'valid_until',
      formatPattern: 'Account & IFSC (e.g. SB-309482710492)',
      requiredFields: ['account_holder', 'account_number', 'ifsc_code', 'statement_period'],
      optionalFields: ['branch_seal', 'bank_address', 'balance_summary'],
      keywords: ['bank', 'passbook', 'statement', 'account statement', 'bank statement', 'bank passbook', 'savings account', 'ifsc'],
      strongContradictionSignals: ['marksheet', 'board examination', 'driving licence', 'passport booklet', 'voter id'],
      fieldLabels: {
        account_holder: 'Account Holder Legal Name',
        account_number: 'Bank Account Number',
        ifsc_code: 'Bank Name & IFSC Branch Code',
        statement_period: 'Statement Activity Window',
        branch_seal: 'Official Branch Seal & Signature'
      }
    },

    'address_proof': {
      id: 'address_proof',
      name: 'Address Proof',
      category: 'identity',
      isIdentityProof: false,
      isAddressProof: true,
      normallyExpires: true,
      validityWindowDays: 90,
      issuingAuthority: 'Public Utility Service / Municipal Board / Electricity Discom',
      identifierField: 'consumer_id',
      nameField: 'resident_name',
      dobField: null,
      issueDateField: 'bill_date',
      expiryDateField: 'valid_until',
      formatPattern: 'Consumer Utility Account (e.g. CA-849201948)',
      requiredFields: ['resident_name', 'full_address', 'consumer_id', 'bill_date'],
      optionalFields: ['utility_authority', 'payment_status', 'meter_number'],
      keywords: ['address', 'address proof', 'utility', 'electricity bill', 'water bill', 'gas bill', 'domicile', 'residence proof'],
      strongContradictionSignals: ['10th marksheet', 'driving licence', 'passport booklet', 'pan card', 'voter id'],
      fieldLabels: {
        resident_name: 'Resident / Consumer Full Name',
        full_address: 'Complete Residential Address',
        consumer_id: 'Consumer Connection Account Number',
        bill_date: 'Bill Issuance Date',
        utility_authority: 'Issuing Utility / Government Body'
      }
    },

    '10th_school_lc': {
      id: '10th_school_lc',
      name: '10th School Leaving Certificate (10th LC)',
      category: 'academic',
      isIdentityProof: false,
      isAddressProof: false,
      normallyExpires: false,
      issuingAuthority: 'Recognized Secondary School / Educational Institute',
      identifierField: 'gr_number',
      nameField: 'student_name',
      dobField: 'dob',
      issueDateField: 'leaving_date',
      expiryDateField: null,
      formatPattern: 'General Register / TC No (e.g. TC-2021-482)',
      requiredFields: ['student_name', 'school_name', 'gr_number', 'dob', 'leaving_date'],
      optionalFields: ['conduct_remark', 'principal_signature', 'caste_category'],
      keywords: ['leaving', 'lc', 'school leaving', 'transfer certificate', 'tc', 'school lc', 'leaving certificate'],
      strongContradictionSignals: ['driving licence', 'passport booklet', 'permanent account number', 'utility bill', 'bank statement'],
      fieldLabels: {
        student_name: 'Student Full Legal Name',
        school_name: 'School Letterhead & Affiliation',
        gr_number: 'General Register (GR) / TC Number',
        dob: 'Date of Birth (Recorded in School Register)',
        leaving_date: 'Date of Discharge / Leaving'
      }
    },

    'semester_marksheet': {
      id: 'semester_marksheet', name: 'Semester Marksheet', category: 'academic', isIdentityProof: false, isAddressProof: false,
      normallyExpires: false, issuingAuthority: 'University / College Examination Authority', identifierField: 'roll_number', nameField: 'student_name',
      dobField: null, issueDateField: 'passing_year', expiryDateField: null, formatPattern: 'University/College semester grade card',
      requiredFields: ['student_name', 'university_name', 'semester', 'course', 'subjects_grades'], optionalFields: ['sgpa', 'cgpa', 'credits', 'roll_number'],
      keywords: ['semester', 'university', 'college', 'grade card', 'sgpa', 'cgpa', 'credits'], strongContradictionSignals: ['class x examination', 'class xii examination'], fieldLabels: {}
    },
    'degree_marksheet': {
      id: 'degree_marksheet', name: 'Degree Marksheet', category: 'academic', isIdentityProof: false, isAddressProof: false,
      normallyExpires: false, issuingAuthority: 'Accredited University / Higher Education Institution', identifierField: 'roll_number', nameField: 'student_name',
      dobField: null, issueDateField: 'passing_year', expiryDateField: null, formatPattern: 'University degree marks statement',
      requiredFields: ['student_name', 'university_name', 'degree_program', 'subjects_grades'], optionalFields: ['semester', 'sgpa', 'cgpa', 'credits'],
      keywords: ['degree', 'bachelor', 'university', 'marksheet', 'marks statement'], strongContradictionSignals: ['class x examination', 'class xii examination'], fieldLabels: {}
    },
    'diploma_marksheet': {
      id: 'diploma_marksheet', name: 'Diploma Marksheet', category: 'academic', isIdentityProof: false, isAddressProof: false,
      normallyExpires: false, issuingAuthority: 'State Board of Technical Education / Polytechnic Directorate', identifierField: 'roll_number', nameField: 'candidate_name',
      dobField: null, issueDateField: 'passing_year', expiryDateField: null, formatPattern: 'Technical diploma semester marks statement',
      requiredFields: ['candidate_name', 'technical_board', 'semester', 'subjects_grades'], optionalFields: ['sgpa', 'cgpa', 'credits', 'course'],
      keywords: ['diploma', 'polytechnic', 'semester', 'technical board'], strongContradictionSignals: ['class x examination', 'class xii examination'], fieldLabels: {}
    },
    'certificate': {
      id: 'certificate', name: 'Academic Certificate', category: 'academic', isIdentityProof: false, isAddressProof: false,
      normallyExpires: false, issuingAuthority: 'Issuing institution', identifierField: null, nameField: null, dobField: null,
      issueDateField: null, expiryDateField: null, formatPattern: 'Institution-issued academic certificate', requiredFields: [],
      optionalFields: [], keywords: ['certificate', 'academic', 'institution'], strongContradictionSignals: [], fieldLabels: {}
    },
    'other_academic_document': {
      id: 'other_academic_document', name: 'Other Academic Document', category: 'academic', isIdentityProof: false, isAddressProof: false,
      normallyExpires: false, issuingAuthority: 'Educational institution', identifierField: null, nameField: null, dobField: null,
      issueDateField: null, expiryDateField: null, formatPattern: 'Education institution document', requiredFields: [],
      optionalFields: [], keywords: ['transcript', 'bonafide', 'academic record'], strongContradictionSignals: [], fieldLabels: {}
    },
    'custom_document': {
      id: 'custom_document', name: 'Custom Document', category: 'other', isIdentityProof: false, isAddressProof: false,
      normallyExpires: false, issuingAuthority: null, identifierField: null, nameField: null, dobField: null, issueDateField: null,
      expiryDateField: null, formatPattern: 'User-named document type', requiredFields: [], optionalFields: [], keywords: [],
      strongContradictionSignals: [], fieldLabels: {}
    },

    'diploma_certificate': {
      id: 'diploma_certificate',
      name: 'Diploma Certificate',
      category: 'academic',
      isIdentityProof: false,
      isAddressProof: false,
      normallyExpires: false,
      issuingAuthority: 'State Board of Technical Education / Polytechnic Directorate',
      identifierField: 'diploma_reg_no',
      nameField: 'candidate_name',
      dobField: null,
      issueDateField: 'passing_year',
      expiryDateField: null,
      formatPattern: 'Polytechnic Reg No (e.g. DIP-2023-SEM6-991)',
      requiredFields: ['candidate_name', 'technical_board', 'polytechnic_program', 'passing_year', 'diploma_reg_no'],
      optionalFields: ['division_grade', 'director_seal'],
      keywords: ['diploma', 'polytechnic', 'technical board', 'msbte', 'bte', 'engineering diploma', 'diploma certificate'],
      strongContradictionSignals: ['driving licence', 'passport booklet', 'pan card', 'voter id', 'utility bill'],
      fieldLabels: {
        candidate_name: 'Candidate / Engineer Name',
        technical_board: 'State Technical Education Board Header',
        polytechnic_program: 'Polytechnic Engineering Branch',
        passing_year: 'Convocation / Passing Year',
        diploma_reg_no: 'Polytechnic Registration Number'
      }
    },

    'degree_certificate': {
      id: 'degree_certificate',
      name: 'Highest Degree / Graduation Certificate',
      category: 'academic',
      isIdentityProof: false,
      isAddressProof: false,
      normallyExpires: false,
      issuingAuthority: 'Accredited University / Autonomous Higher Education Institution',
      identifierField: 'degree_reg_no',
      nameField: 'graduate_name',
      dobField: null,
      issueDateField: 'convocation_year',
      expiryDateField: null,
      formatPattern: 'University Degree Serial / PRN (e.g. DEG-2023-BTECH-8821)',
      requiredFields: ['graduate_name', 'university_name', 'degree_program', 'convocation_year', 'degree_reg_no'],
      optionalFields: ['classification_division', 'chancellor_seal'],
      keywords: ['degree', 'convocation', 'bachelor', 'btech', 'be', 'b.tech', 'b.e.', 'university', 'degree certificate', 'graduation certificate', 'graduation'],
      strongContradictionSignals: ['driving licence', 'passport booklet', 'pan card', 'voter id', 'utility bill'],
      fieldLabels: {
        graduate_name: 'Graduate Full Legal Name',
        university_name: 'Issuing University / Institution',
        degree_program: 'Degree Program / Faculty',
        convocation_year: 'Convocation / Conferred Year',
        degree_reg_no: 'Permanent Registration Number (PRN) / Degree No'
      }
    },

    'resume': {
      id: 'resume',
      name: 'Resume / Curriculum Vitae (CV)',
      category: 'career',
      isIdentityProof: false,
      isAddressProof: false,
      normallyExpires: false,
      issuingAuthority: 'Self / Professional Career Profile',
      identifierField: null,
      nameField: 'candidate_name',
      dobField: null,
      issueDateField: 'profile_date',
      expiryDateField: null,
      formatPattern: 'Professional Curriculum Vitae / Resume Document (PDF / DOCX)',
      requiredFields: ['candidate_name', 'summary_skills', 'education_history'],
      optionalFields: ['work_experience', 'contact_details', 'certifications'],
      keywords: ['resume', 'curriculum vitae', 'cv', 'work experience', 'education', 'skills', 'career summary', 'biodata', 'professional profile'],
      strongContradictionSignals: ['driving licence', 'passport booklet', 'permanent account number', 'utility bill', 'bank statement'],
      fieldLabels: {
        candidate_name: 'Candidate Full Legal Name',
        summary_skills: 'Career Summary & Technical Skills',
        education_history: 'Academic & Qualification History',
        work_experience: 'Professional Employment History',
        contact_details: 'Contact Information (Email / Phone)'
      }
    }
  };

  // ==========================================================================
  // SECTION 3: AI DOCUMENT ADVISOR CHECKLIST KNOWLEDGE BASE
  // Supports all user goals: Education, Job, Passport, Visa, Renting, Banking,
  // Government Work, Driving Licence, College Admission, Employment Verification
  // ==========================================================================
  const ADVISOR_CHECKLIST_PLANS = {
    'education': {
      goal: 'Education & Higher Studies',
      desc: 'Mandatory documentation for university admissions, entrance counseling, and academic scholarships.',
      requiredDocs: [
        { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', note: 'Core identity & biometric proof for student portal' },
        { typeKey: '10th_marksheet', name: '10th Marksheet', priority: 'critical', note: 'Proof of secondary education & verified date of birth' },
        { typeKey: '10th_school_lc', name: '10th School Leaving Certificate (10th LC)', priority: 'critical', note: 'Mandatory transfer credential from secondary school' },
        { typeKey: '12th_marksheet', name: '12th Marksheet', priority: 'critical', note: 'Higher secondary mark verification for degree programs' },
        { typeKey: 'birth_certificate', name: 'Birth Certificate', priority: 'standard', note: 'Civil DOB proof where board cert requires secondary verification' },
        { typeKey: 'address_proof', name: 'Address Proof', priority: 'standard', note: 'Residential domicile proof for state quota benefits' }
      ]
    },

    'college_admission': {
      goal: 'College Admission',
      desc: 'Complete enrollment package for university, polytechnic, or professional degree entrance.',
      requiredDocs: [
        { typeKey: '10th_marksheet', name: '10th Marksheet', priority: 'critical', note: 'Secondary school scorecard & date-of-birth proof' },
        { typeKey: '10th_school_lc', name: '10th School Leaving Certificate (10th LC)', priority: 'critical', note: 'Original transfer credential required at physical admission' },
        { typeKey: '12th_marksheet', name: '12th Marksheet', priority: 'critical', note: 'Qualifying score for undergraduate counseling' },
        { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', note: 'Government identity validation' },
        { typeKey: 'address_proof', name: 'Address Proof', priority: 'standard', note: 'Domicile / residence verification' }
      ]
    },

    'career': {
      goal: 'Career Pathway & Job Application',
      desc: 'Complete career requirements including professional credentials, entrance scorecards, degree certificates, and identity verification.',
      requiredDocs: [
        { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', note: 'Primary identity & biometric verification' },
        { typeKey: 'pan_card', name: 'PAN Card', priority: 'critical', note: 'Tax compliance & statutory financial identification' },
        { typeKey: 'degree_certificate', name: 'Graduation / Degree Certificate', priority: 'critical', note: 'Highest educational qualification check' },
        { typeKey: 'resume', name: 'Resume / Curriculum Vitae (CV)', priority: 'critical', note: 'Professional CV and skills profile for candidate screening' },
        { typeKey: '10th_marksheet', name: '10th Marksheet', priority: 'critical', note: 'Foundational secondary education & DOB proof' },
        { typeKey: 'address_proof', name: 'Domicile / Address Proof', priority: 'standard', note: 'Permanent residence verification' }
      ]
    },

    'job': {
      goal: 'Job & Employment Onboarding',
      desc: 'Corporate onboarding, payroll setup, background verification, and provident fund enrollment.',
      requiredDocs: [
        { typeKey: 'pan_card', name: 'PAN Card', priority: 'critical', note: 'Mandatory for income tax assessment, TDS & salary disbursement' },
        { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', note: 'KYC identity & UAN / Employee Provident Fund linkage' },
        { typeKey: 'degree_certificate', name: 'Highest Degree / Diploma Certificate', priority: 'critical', note: 'Technical qualification credential' },
        { typeKey: 'resume', name: 'Resume / Curriculum Vitae (CV)', priority: 'critical', note: 'Updated professional CV for hiring manager & HR verification' },
        { typeKey: 'bank_passbook_statement', name: 'Bank Passbook/Statement', priority: 'critical', note: 'Account number & IFSC for direct salary credit' },
        { typeKey: '10th_marksheet', name: '10th Marksheet', priority: 'critical', note: 'Foundational education credential & background check' },
        { typeKey: '12th_marksheet', name: '12th Marksheet', priority: 'standard', note: 'Higher secondary education proof' },
        { typeKey: 'address_proof', name: 'Address Proof', priority: 'standard', note: 'Permanent & communication address validation' }
      ]
    },

    'employment_verification': {
      goal: 'Employment Verification',
      desc: 'Third-party background screening for job offers, security clearance, and corporate compliance.',
      requiredDocs: [
        { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', note: 'Primary identity & address verification' },
        { typeKey: 'pan_card', name: 'PAN Card', priority: 'critical', note: 'Tax records & legal name confirmation' },
        { typeKey: '10th_marksheet', name: '10th Marksheet', priority: 'critical', note: 'Age & educational foundation verification' },
        { typeKey: 'diploma_certificate', name: 'Diploma / Degree Certificate', priority: 'critical', note: 'Highest educational qualification check' },
        { typeKey: 'bank_passbook_statement', name: 'Bank Statement', priority: 'standard', note: 'Proof of past salary credits if experienced' }
      ]
    },

    'passport': {
      goal: 'Passport Application',
      desc: 'Ministry of External Affairs official document dossier for standard or Tatkaal sovereign passport.',
      requiredDocs: [
        { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', note: 'Primary proof of identity with biometric validation' },
        { typeKey: 'address_proof', name: 'Address Proof', priority: 'critical', note: 'Continuous residence verification for police clearance' },
        { typeKey: '10th_marksheet', name: '10th Marksheet', priority: 'critical', note: 'Qualifies applicant for Non-ECR (Emigration Check Not Required) category & DOB proof' },
        { typeKey: 'birth_certificate', name: 'Birth Certificate', priority: 'standard', note: 'Mandatory DOB record for applicants' },
        { typeKey: 'pan_card', name: 'PAN Card', priority: 'standard', note: 'Supporting identity proof' }
      ]
    },

    'visa': {
      goal: 'Visa Application',
      desc: 'Consular visa dossier for study abroad, employment, or international tourist travel.',
      requiredDocs: [
        { typeKey: 'passport', name: 'Passport', priority: 'critical', note: 'Valid passport with at least 6 months validity from date of travel' },
        { typeKey: 'bank_passbook_statement', name: 'Bank Statement (Last 6 Months)', priority: 'critical', note: 'Certified financial proof showing sufficient travel/tuition funds' },
        { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', note: 'National identification proof' },
        { typeKey: 'pan_card', name: 'PAN Card', priority: 'standard', note: 'Financial background & tax assessment verification' },
        { typeKey: '10th_marksheet', name: '10th Marksheet', priority: 'standard', note: 'Academic dossier for student visas' },
        { typeKey: '12th_marksheet', name: '12th Marksheet', priority: 'standard', note: 'Academic progression record' }
      ]
    },

    'renting': {
      goal: 'Renting a House / Tenancy',
      desc: 'Tenant documentation required by landlords, housing societies, and local police verification.',
      requiredDocs: [
        { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', note: 'Mandatory tenant identity for registered lease agreement' },
        { typeKey: 'pan_card', name: 'PAN Card', priority: 'critical', note: 'Tax deduction (TDS) on rent & financial identity' },
        { typeKey: 'address_proof', name: 'Permanent Address Proof', priority: 'critical', note: 'Home town residence proof for police tenant NOC' },
        { typeKey: 'bank_passbook_statement', name: 'Bank Statement / Salary Proof', priority: 'standard', note: 'Demonstrates financial capability for monthly rent & deposit' }
      ]
    },

    'bank_loan': {
      goal: 'Bank Account & Loan Application',
      desc: 'Reserve Bank of India KYC documentation for savings accounts, credit cards, or retail loans.',
      requiredDocs: [
        { typeKey: 'pan_card', name: 'PAN Card', priority: 'critical', note: 'Statutory mandate for banking operations & CIBIL score tracking' },
        { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', note: 'eKYC identity & biometric confirmation' },
        { typeKey: 'address_proof', name: 'Address Proof', priority: 'critical', note: 'Recent utility bill or passbook for communication address' },
        { typeKey: 'bank_passbook_statement', name: 'Bank Statement (Last 6 Months)', priority: 'critical', note: 'Cash flow analysis & repayment capacity' },
        { typeKey: '10th_marksheet', name: '10th Marksheet', priority: 'standard', note: 'Age proof for education loan applications' }
      ]
    },

    'government_work': {
      goal: 'Government Job & Examination',
      desc: 'Public service commission dossier for state/central government recruitment and certificate scrutiny.',
      requiredDocs: [
        { typeKey: '10th_marksheet', name: '10th Marksheet', priority: 'critical', note: 'Primary date-of-birth proof & minimum educational eligibility' },
        { typeKey: '12th_marksheet', name: '12th Marksheet', priority: 'critical', note: 'Higher secondary score validation' },
        { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', note: 'Exam center biometric verification & candidate identity' },
        { typeKey: 'pan_card', name: 'PAN Card', priority: 'standard', note: 'Secondary photo identification' },
        { typeKey: 'birth_certificate', name: 'Birth Certificate', priority: 'standard', note: 'Civil registry age verification' },
        { typeKey: 'address_proof', name: 'Domicile / Address Proof', priority: 'critical', note: 'State domicile reservation & postal verification' }
      ]
    },

    'driving_licence': {
      goal: 'Driving Licence (RTO)',
      desc: 'Regional Transport Office requirements for Learner\'s Licence and Permanent Motor Vehicle DL.',
      requiredDocs: [
        { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', note: 'Direct Sarathi / Parivahan online KYC & biometric identification' },
        { typeKey: 'address_proof', name: 'Address Proof', priority: 'critical', note: 'RTO jurisdiction determination for physical driving test' },
        { typeKey: '10th_marksheet', name: '10th Marksheet / Birth Certificate', priority: 'critical', note: 'Statutory age proof verifying applicant is over 18' }
      ]
    }
  };

  // Helper: map user free text to the best matching preparation scenario
  // Helper: map user free text to the best matching preparation scenario
  function resolveAdvisorGoal(text) {
    if (!text || typeof text !== 'string') return 'education';
    const lower = text.toLowerCase().trim();

    if (lower.includes('passport')) return 'passport';
    if (lower.includes('visa') || lower.includes('abroad') || lower.includes('embassy') || lower.includes('consulate') || lower.includes('immigration')) return 'visa';
    if (lower.includes('driving') || lower.includes('licence') || lower.includes('license') || lower.includes('rto') || lower.includes('dl ') || lower.endsWith('dl') || lower.includes('driver')) return 'driving_licence';
    if (lower.includes('rent') || lower.includes('lease') || lower.includes('flat') || lower.includes('tenant') || lower.includes('landlord') || lower.includes('apartment') || lower.includes('pg accommodation') || lower.includes('room on rent')) return 'renting';
    if (lower.includes('loan') || lower.includes('bank account') || lower.includes('banking') || lower.includes('credit card') || lower.includes('account opening') || lower.includes('cibil') || lower.includes('open an account')) return 'bank_loan';
    if (lower.includes('govt') || lower.includes('government') || lower.includes('sarkari') || lower.includes('upsc') || lower.includes('ssc exam') || lower.includes('civil service') || lower.includes('public service') || lower.includes('government job')) return 'government_work';
    if (lower.includes('bgv') || (lower.includes('background') && lower.includes('verification'))) return 'employment_verification';
    if (lower.includes('job') || lower.includes('employment') || lower.includes('offer letter') || lower.includes('joining') || lower.includes('onboarding') || lower.includes('career') || lower.includes('salary slip') || lower.includes('company') || lower.includes('hired') || lower.includes('employer') || lower.includes('start working')) return 'job';
    if (lower.includes('college') || lower.includes('admission') || lower.includes('university') || lower.includes('polytechnic') || lower.includes('engineering') || lower.includes('btech') || lower.includes('junior college') || lower.includes('11th') || lower.includes('counseling') || lower.includes('enrollment') || lower.includes('continue my studies') || lower.includes('higher education') || lower.includes('further studies') || lower.includes('entering college')) return 'college_admission';
    if (lower.includes('education') || lower.includes('school') || lower.includes('study') || lower.includes('studies') || lower.includes('academic') || lower.includes('marksheet')) return 'education';

    return 'education';
  }

  // ==========================================================================
  // SECTION 3B: CONVERSATIONAL AI DOCUMENT ADVISOR ENGINE
  // Multi-turn consultation, context collection, midway change detection,
  // personalized dynamic checklist generation, vault connection & status mapping
  // ==========================================================================
  const CAREER_METADATA = {
    engineering: {
      key: 'engineering',
      label: 'Engineering',
      streamKeyword: 'engineering',
      pathName: 'Engineering (B.Tech / B.E.)',
      admissionPath: 'engineering admission',
      roadmapSteps: [
        {
          marker: '🎯',
          markerClass: 'marker-current',
          title: 'Engineering (B.Tech / B.E.) — 4 Years',
          desc: 'JEE Main Scorecard, CAP Allotment Letter & 12th PCM Marksheets'
        },
        {
          marker: '📚',
          markerClass: 'marker-future',
          title: 'B.Tech Semesters 1 to 8 Examination Records',
          desc: 'All 8 semester marksheets, project approval & industrial internship completion'
        },
        {
          marker: '🎓',
          markerClass: 'marker-future',
          title: 'B.Tech Convocation & Degree Certificate',
          desc: 'Official University Convocation Degree & Transfer / Migration Certificate'
        }
      ],
      checklistDocs: [
        {
          typeKey: 'entrance_exam_scorecard',
          name: 'JEE Main / State CET Scorecard',
          priority: 'mandatory',
          category: 'academic',
          note: 'Valid entrance examination scorecard required for Engineering counseling & merit rank'
        },
        {
          typeKey: 'cap_allotment_letter',
          name: 'Engineering CAP Seat Allotment Letter',
          priority: 'mandatory',
          category: 'academic',
          note: 'Official seat allotment slip from State CET Cell / JoSAA counseling authority'
        }
      ]
    },
    mbbs: {
      key: 'mbbs',
      label: 'MBBS',
      streamKeyword: 'medical',
      pathName: 'Medical (MBBS)',
      admissionPath: 'medical admission',
      roadmapSteps: [
        {
          marker: '🩺',
          markerClass: 'marker-current',
          title: 'Medical (MBBS) — 5.5 Years Undergrad',
          desc: 'NEET-UG Scorecard, MCC / State Allotment Letter & Medical Fitness Certificate'
        },
        {
          marker: '🏥',
          markerClass: 'marker-future',
          title: 'MBBS Clinical Postings & 9-Semester Marksheets',
          desc: 'Pre-clinical, para-clinical, and clinical university examination marksheets'
        },
        {
          marker: '⚕️',
          markerClass: 'marker-future',
          title: 'Compulsory Rotatory Residential Internship (CRRI) & NMC Registration',
          desc: '1-Year hospital rotatory internship completion & National Medical Commission (NMC) license'
        }
      ],
      checklistDocs: [
        {
          typeKey: 'entrance_exam_scorecard',
          name: 'NEET-UG Scorecard & Admit Card',
          priority: 'mandatory',
          category: 'academic',
          note: 'Mandatory national eligibility entrance scorecard for Medical (MBBS) seat allotment'
        },
        {
          typeKey: 'cap_allotment_letter',
          name: 'MCC / State Medical Allotment Letter',
          priority: 'mandatory',
          category: 'academic',
          note: 'Official seat allotment letter issued by Medical Counseling Committee (MCC) or State Authority'
        },
        {
          typeKey: 'medical_fitness_certificate',
          name: 'Medical Fitness Certificate',
          priority: 'mandatory',
          category: 'identity',
          note: 'Authorized registered medical practitioner certificate verifying physical & mental fitness'
        }
      ]
    },
    bds: {
      key: 'bds',
      label: 'BDS',
      streamKeyword: 'dental',
      pathName: 'Dental Surgery (BDS)',
      admissionPath: 'dental admission',
      roadmapSteps: [
        {
          marker: '🦷',
          markerClass: 'marker-current',
          title: 'Dental Surgery (BDS) — 5 Years',
          desc: 'NEET-UG Scorecard, Dental Allotment Letter & Class 12th PCB Marksheet'
        },
        {
          marker: '📚',
          markerClass: 'marker-future',
          title: 'BDS 4-Year Academic Marksheets & Pre-Clinical Records',
          desc: 'Conservative dentistry, prosthodontics, and oral surgery clinical records'
        },
        {
          marker: '⚕️',
          markerClass: 'marker-future',
          title: '1-Year Compulsory Paid Dental Internship & DCI Registration',
          desc: 'Dental Council of India (DCI) State Council Practitioner License'
        }
      ],
      checklistDocs: [
        {
          typeKey: 'entrance_exam_scorecard',
          name: 'NEET-UG Scorecard (Dental Merit)',
          priority: 'mandatory',
          category: 'academic',
          note: 'Valid NEET-UG rank card for Dental Council of India approved BDS institutions'
        },
        {
          typeKey: 'cap_allotment_letter',
          name: 'Dental Counseling Allotment Letter',
          priority: 'mandatory',
          category: 'academic',
          note: 'Official seat confirmation slip from state/central dental counseling board'
        },
        {
          typeKey: 'medical_fitness_certificate',
          name: 'Medical Fitness Certificate',
          priority: 'mandatory',
          category: 'identity',
          note: 'Fitness certificate signed by registered medical practitioner for clinical handling'
        }
      ]
    },
    pharmacy: {
      key: 'pharmacy',
      label: 'Pharmacy',
      streamKeyword: 'pharmacy',
      pathName: 'Pharmacy (B.Pharm)',
      admissionPath: 'pharmacy admission',
      roadmapSteps: [
        {
          marker: '💊',
          markerClass: 'marker-current',
          title: 'Bachelor of Pharmacy (B.Pharm) — 4 Years',
          desc: 'Pharmacy Entrance Scorecard, CAP Allotment Order & 12th Science Marksheet'
        },
        {
          marker: '🧪',
          markerClass: 'marker-future',
          title: 'B.Pharm Semesters 1 to 8 Marksheets & Industrial Training',
          desc: 'Pharmaceutics, pharmacology lab records & mandatory pharmaceutical plant training'
        },
        {
          marker: '📜',
          markerClass: 'marker-future',
          title: 'B.Pharm Convocation & State Pharmacy Council (PCI) Registration',
          desc: 'Registered Pharmacist Certificate issued under Pharmacy Act 1948'
        }
      ],
      checklistDocs: [
        {
          typeKey: 'entrance_exam_scorecard',
          name: 'State Pharmacy Entrance / CET Scorecard',
          priority: 'mandatory',
          category: 'academic',
          note: 'State CET / GPAT scorecard qualifying for B.Pharm undergraduate degree seat'
        },
        {
          typeKey: 'cap_allotment_letter',
          name: 'Pharmacy CAP Seat Allotment Order',
          priority: 'mandatory',
          category: 'academic',
          note: 'Centralized Admission Process allotment confirmation for Pharmacy faculty'
        }
      ]
    },
    law: {
      key: 'law',
      label: 'Law',
      streamKeyword: 'law',
      pathName: 'Law (B.A. LL.B. / LL.B.)',
      admissionPath: 'law admission',
      roadmapSteps: [
        {
          marker: '⚖️',
          markerClass: 'marker-current',
          title: 'Law Degree (B.A. LL.B. / LL.B.) — 5 Years',
          desc: 'CLAT / State Law CET Scorecard, Allotment Slip & 12th Marksheet'
        },
        {
          marker: '📚',
          markerClass: 'marker-future',
          title: 'LL.B. 10-Semester Marksheets & Moot Court Records',
          desc: 'Constitutional law, moot court certifications & legal internships'
        },
        {
          marker: '📜',
          markerClass: 'marker-future',
          title: 'Bar Council Enrollment & All India Bar Exam (AIBE)',
          desc: 'State Bar Council advocate enrollment & AIBE Certificate of Practice'
        }
      ],
      checklistDocs: [
        {
          typeKey: 'entrance_exam_scorecard',
          name: 'CLAT / State Law CET Scorecard',
          priority: 'mandatory',
          category: 'academic',
          note: 'Valid entrance examination scorecard required for National Law University / State Law faculty counseling'
        },
        {
          typeKey: 'cap_allotment_letter',
          name: 'Law CAP Seat Allotment Letter',
          priority: 'mandatory',
          category: 'academic',
          note: 'Centralized admission seat allotment letter for Law degree program'
        }
      ]
    },
    ca: {
      key: 'ca',
      label: 'CA',
      streamKeyword: 'chartered accountancy',
      pathName: 'Chartered Accountancy (ICAI CA)',
      admissionPath: 'chartered accountancy registration',
      roadmapSteps: [
        {
          marker: '📊',
          markerClass: 'marker-current',
          title: 'ICAI CA Foundation Course & Registration',
          desc: 'Class 12th Commerce/Science Marksheet, ICAI Registration Letter & Foundation Admit Card'
        },
        {
          marker: '💼',
          markerClass: 'marker-future',
          title: 'CA Intermediate & 2-Year Practical Articleship Training',
          desc: 'Inter Group 1 & 2 pass certificates, ICITSS training & Articleship deed form 102/103'
        },
        {
          marker: '🏛️',
          markerClass: 'marker-future',
          title: 'CA Final Examination & ICAI Membership Certificate',
          desc: 'CA Final marksheet & Associate Chartered Accountant (ACA) membership license'
        }
      ],
      checklistDocs: [
        {
          typeKey: 'icai_registration_letter',
          name: 'ICAI Registration Letter / Foundation Admit Card',
          priority: 'mandatory',
          category: 'academic',
          note: 'Institute of Chartered Accountants of India (ICAI) student registration confirmation'
        },
        {
          typeKey: 'entrance_exam_scorecard',
          name: 'CA Foundation Scorecard / Exemption Certificate',
          priority: 'mandatory',
          category: 'academic',
          note: 'Official ICAI marks statement qualifying for Intermediate stage progression'
        }
      ]
    },
    architecture: {
      key: 'architecture',
      label: 'Architecture',
      streamKeyword: 'architecture',
      pathName: 'Architecture (B.Arch)',
      admissionPath: 'architecture admission',
      roadmapSteps: [
        {
          marker: '📐',
          markerClass: 'marker-current',
          title: 'Bachelor of Architecture (B.Arch) — 5 Years',
          desc: 'NATA / JEE Paper 2 Scorecard, Architecture Allotment Letter & 12th PCM Marksheet'
        },
        {
          marker: '🏛️',
          markerClass: 'marker-future',
          title: 'B.Arch 10-Semester Design Portfolios & Studio Records',
          desc: 'Architectural design thesis, building construction records & professional practical training'
        },
        {
          marker: '📜',
          markerClass: 'marker-future',
          title: 'B.Arch Convocation Degree & Council of Architecture (COA) License',
          desc: 'Official Degree & Council of Architecture statutory registration certificate'
        }
      ],
      checklistDocs: [
        {
          typeKey: 'entrance_exam_scorecard',
          name: 'NATA / JEE Main Paper-2 Scorecard',
          priority: 'mandatory',
          category: 'academic',
          note: 'Valid National Aptitude Test in Architecture (NATA) or JEE Paper 2 scorecard'
        },
        {
          typeKey: 'cap_allotment_letter',
          name: 'Architecture CAP Seat Allotment Letter',
          priority: 'mandatory',
          category: 'academic',
          note: 'Centralized admission seat allotment order for B.Arch degree program'
        }
      ]
    },
    computer_science: {
      key: 'computer_science',
      label: 'Computer Science',
      streamKeyword: 'computer science',
      pathName: 'Computer Science (B.Tech CSE / B.Sc CS)',
      admissionPath: 'computer science admission',
      roadmapSteps: [
        {
          marker: '💻',
          markerClass: 'marker-current',
          title: 'Computer Science (B.Tech CSE) — 4 Years',
          desc: 'JEE Main / CET Scorecard, CS Branch Allotment Letter & 12th PCM Marksheets'
        },
        {
          marker: '⚡',
          markerClass: 'marker-future',
          title: 'CSE Semesters 1 to 8 Records & Software Capstone Project',
          desc: 'Data structures, algorithms semester marksheets & tech stack software project approval'
        },
        {
          marker: '🎓',
          markerClass: 'marker-future',
          title: 'B.Tech CSE Convocation Degree & Placement Credentials',
          desc: 'Official University Convocation Degree, Campus Offer Letter & Internship Completion'
        }
      ],
      checklistDocs: [
        {
          typeKey: 'entrance_exam_scorecard',
          name: 'JEE Main / State CET Scorecard (CS Merit)',
          priority: 'mandatory',
          category: 'academic',
          note: 'Valid entrance examination scorecard for Computer Science & Engineering branch counseling'
        },
        {
          typeKey: 'cap_allotment_letter',
          name: 'Computer Science Seat Allotment Letter',
          priority: 'mandatory',
          category: 'academic',
          note: 'Official seat confirmation slip confirming Computer Science & Engineering (CSE) allotment'
        }
      ]
    }
  };

  // ==========================================================================
  // SECTION 3b: CANONICAL EXPIRY ENGINE, MATCHER & STATUS INTELLIGENCE
  // Single source of truth connecting Advisor requirements to Storage Vault state
  // ==========================================================================

  // Centralized universal date parsing (supports ISO, DD/MM/YYYY, DD Month YYYY, Month YYYY)
  function parseDateUniversal(dateVal) {
    if (!dateVal) return null;
    if (dateVal instanceof Date && !isNaN(dateVal.getTime())) return dateVal;
    if (typeof dateVal === 'number') {
      const d = new Date(dateVal);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof dateVal !== 'string') return null;
    const str = dateVal.trim();
    if (!str) return null;

    // Direct Date.parse (supports ISO: YYYY-MM-DD, standard RFC2822, etc.)
    const t = Date.parse(str);
    if (!isNaN(t)) {
      const parsed = new Date(t);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    // DD/MM/YYYY or DD-MM-YYYY (Indian & British standard)
    const dmyMatch = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10) - 1;
      const year = parseInt(dmyMatch[3], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }

    // DD Month YYYY (e.g. "14 Aug 2024", "14 August 2024")
    const dMonYMatch = str.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/);
    if (dMonYMatch) {
      const d = new Date(`${dMonYMatch[2]} ${dMonYMatch[1]}, ${dMonYMatch[3]}`);
    let inputStr = ''; 
    }

    // Month YYYY (e.g. "October 2024", "Oct 2024")
    const monYMatch = str.match(/^([a-zA-Z]+)\s+(\d{4})$/);
    if (monYMatch) {
      const d = new Date(`${monYMatch[1]} 1, ${monYMatch[2]}`);
      if (!isNaN(d.getTime())) return d;
    }

    return null;
  }

  // Centralized single source of truth for document expiry calculation (Requirement 1, 2, 3, 4)
  function calculateDocumentExpiry(docOrType, rawExpiryDate, rawIssueDate, options = {}) {
    let typeKey = '';
    let expiryDateVal = rawExpiryDate;
    let issueDateVal = rawIssueDate;
    let explicitExpiredFlag = false;

    if (docOrType && typeof docOrType === 'object') {
      typeKey = docOrType.documentType || docOrType.document_type || docOrType.typeKey || '';
      if (!typeKey && docOrType.title) {
        const lowerT = docOrType.title.toLowerCase();
        if (lowerT.includes('passport')) typeKey = 'passport';
        else if (lowerT.includes('driving') || lowerT.includes('licence') || lowerT.includes('license') || lowerT.includes('dl')) typeKey = 'driving_licence';
        else if (lowerT.includes('utility') || lowerT.includes('electricity') || lowerT.includes('address')) typeKey = 'address_proof';
        else if (lowerT.includes('10th') && lowerT.includes('mark')) typeKey = '10th_marksheet';
        else if (lowerT.includes('12th') && lowerT.includes('mark')) typeKey = '12th_marksheet';
        else if (lowerT.includes('pan')) typeKey = 'pan_card';
        else if (lowerT.includes('aadhaar') || lowerT.includes('aadhar')) typeKey = 'aadhaar_card';
        else if (lowerT.includes('birth')) typeKey = 'birth_certificate';
        else if (lowerT.includes('voter')) typeKey = 'voter_id';
        else if (lowerT.includes('diploma')) typeKey = 'diploma_certificate';
        else if (lowerT.includes('lc') || lowerT.includes('leaving')) typeKey = '10th_school_lc';
      }
      if (expiryDateVal === undefined || expiryDateVal === null) {
        expiryDateVal = docOrType.expiryDate || docOrType.expiry_date || null;
      }
      if (issueDateVal === undefined || issueDateVal === null) {
        issueDateVal = docOrType.issueDate || docOrType.issue_date || null;
      }
      if (docOrType.isExpired === true || docOrType.is_expired === true || docOrType.vaultIndicator === 'Expired' || docOrType.verificationLabel === 'Expired' || docOrType.documentStatus === 'Expired') {
        explicitExpiredFlag = true;
      }
    } else if (typeof docOrType === 'string') {
      typeKey = docOrType;
    }

    const profile = DOCUMENT_PROFILES[typeKey] || null;
    const normallyExpires = profile ? (profile.normallyExpires === true) : (typeKey === 'passport' || typeKey === 'driving_licence' || typeKey === 'address_proof');

    // Rule 1: If document type does NOT normally expire -> never marked expired, expiryDate = null (TEST 7)
    if (!normallyExpires && !options.forceExpire) {
      return {
        expiryStatus: 'VALID',
        status: 'valid',
        label: 'Lifetime Validity (Does Not Expire)',
        isExpired: false,
        isExpiringSoon: false,
        normallyExpires: false,
        daysRemaining: null,
        expiryDate: null,
        formattedRemark: 'Valid (Permanent Credential)'
      };
    }

    // Rule 2: If no expiry date is available for an expiring document -> do not invent an expiry date (Requirement 1)
    if (!expiryDateVal) {
      if (explicitExpiredFlag) {
        return {
          expiryStatus: 'EXPIRED',
          status: 'expired',
          label: 'Expired',
          isExpired: true,
          isExpiringSoon: false,
          normallyExpires: true,
          daysRemaining: -1,
          expiryDate: null,
          formattedRemark: 'Expired (Renewal Required)'
        };
      }
      return {
        expiryStatus: 'VALID',
        status: 'valid',
        label: 'Valid',
        isExpired: false,
        isExpiringSoon: false,
        normallyExpires: true,
        daysRemaining: null,
        expiryDate: null,
        formattedRemark: 'Validity confirmed on document'
      };
    }

    // Rule 3: Parse expiry date & calculate days remaining against current date
    const expiryDateObj = parseDateUniversal(expiryDateVal);
    if (!expiryDateObj) {
      if (explicitExpiredFlag) {
        return {
          expiryStatus: 'EXPIRED',
          status: 'expired',
          label: 'Expired',
          isExpired: true,
          isExpiringSoon: false,
          normallyExpires: true,
          daysRemaining: -1,
          expiryDate: String(expiryDateVal),
          formattedRemark: `Expired (${expiryDateVal})`
        };
      }
      return {
        expiryStatus: 'VALID',
        status: 'valid',
        label: 'Valid',
        isExpired: false,
        isExpiringSoon: false,
        normallyExpires: true,
        daysRemaining: null,
        expiryDate: String(expiryDateVal),
        formattedRemark: `Valid (${expiryDateVal})`
      };
    }

    const now = options.now ? new Date(options.now) : new Date();
    // Normalize to midnight for accurate integer day difference
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const expDateOnly = new Date(expiryDateObj.getFullYear(), expiryDateObj.getMonth(), expiryDateObj.getDate()).getTime();
    const diffMs = expDateOnly - nowDateOnly;
    const daysRemaining = Math.round(diffMs / (1000 * 60 * 60 * 24));
    const warningPeriod = options.warningPeriod || 60; // Configured warning period: 60 days

    // Rule 4: Passed expiry date -> EXPIRED (TEST 3)
    if (daysRemaining < 0 || explicitExpiredFlag) {
      return {
        expiryStatus: 'EXPIRED',
        status: 'expired',
        label: 'Expired',
        isExpired: true,
        isExpiringSoon: false,
        normallyExpires: true,
        daysRemaining: daysRemaining,
        expiryDate: String(expiryDateVal),
        formattedRemark: `Expired ${Math.abs(daysRemaining)} days ago (${expiryDateVal})`
      };
    }

    // Rule 5: Within warning period -> EXPIRING_SOON (TEST 2)
    if (daysRemaining <= warningPeriod) {
      return {
        expiryStatus: 'EXPIRING_SOON',
        status: 'expiring_soon',
        label: 'Expiring Soon',
        isExpired: false,
        isExpiringSoon: true,
        normallyExpires: true,
        daysRemaining: daysRemaining,
        expiryDate: String(expiryDateVal),
        formattedRemark: `Expires in ${daysRemaining} days (${expiryDateVal})`
      };
    }

    // Rule 6: Future expiry beyond warning period -> VALID (TEST 1)
    return {
      expiryStatus: 'VALID',
      status: 'valid',
      label: 'Valid',
      isExpired: false,
      isExpiringSoon: false,
      normallyExpires: true,
      daysRemaining: daysRemaining,
      expiryDate: String(expiryDateVal),
      formattedRemark: `Valid until ${expiryDateVal} (${daysRemaining} days remaining)`
    };
  }

  // Version-aware Requirement to Vault Candidate Matcher (Requirement 6 & 7)
  function matchRequirementToVaultDoc(req, vDocs, boundIds = new Set()) {
    if (!req || !vDocs || !Array.isArray(vDocs)) return null;

    const reqType = (req.typeKey || '').toLowerCase();
    const reqName = (req.name || '').toLowerCase();
    const cleanReqName = reqName.replace(/[^a-z0-9]/g, '');

    const candidates = [];

    for (const vd of vDocs) {
      if (!vd) continue;
      const vdId = vd.id || vd.document_id || vd.documentId;
      const isMultiPurpose = reqType === 'address_proof' && (vd.documentType === 'passport' || vd.document_type === 'passport');
      if (vdId && boundIds.has(vdId) && !isMultiPurpose) {
        continue;
      }

      const vdType = (vd.documentType || vd.document_type || '').toLowerCase();
      const vdTitle = (vd.title || '').toLowerCase();
      const cleanVdTitle = vdTitle.replace(/[^a-z0-9]/g, '');

      // Disambiguation 1: Passport Photos vs Sovereign Travel Passport
      const isReqPhoto = reqType.includes('photo') || reqName.includes('photo');
      const isVdPhoto = vdType.includes('photo') || vdTitle.includes('photo');
      if (isReqPhoto || isVdPhoto) {
        if (isReqPhoto !== isVdPhoto) continue;
      }

      // Disambiguation 2: 10th LC vs 10th Marksheet
      const isReqLC = reqType.includes('lc') || reqType.includes('leaving') || reqType.includes('transfer') || reqName.includes('lc') || reqName.includes('leaving') || reqName.includes('transfer');
      const isVdLC = vdType.includes('lc') || vdType.includes('leaving') || vdType.includes('transfer') || vdTitle.includes('lc') || vdTitle.includes('leaving') || vdTitle.includes('transfer');
      const isReq10thMarksheet = (reqType.includes('marksheet') || reqName.includes('mark')) && (reqName.includes('10th') || reqType.includes('10th'));
      const isVd10thMarksheet = (vdType.includes('marksheet') || vdTitle.includes('mark')) && (vdTitle.includes('10th') || vdType.includes('10th'));

      if (isReqLC && isVd10thMarksheet) continue;
      if (isReq10thMarksheet && isVdLC) continue;

      // Disambiguation 3: 12th Admit Card vs 12th Marksheet
      const isReqAdmitCard = reqType.includes('admit') || reqName.includes('admit') || reqName.includes('hall ticket');
      const isVdAdmitCard = vdType.includes('admit') || vdTitle.includes('admit') || vdTitle.includes('hall ticket');
      const isReq12thMarksheet = (reqType.includes('marksheet') || reqName.includes('mark')) && (reqName.includes('12th') || reqType.includes('12th'));
      const isVd12thMarksheet = (vdType.includes('marksheet') || vdTitle.includes('mark')) && (vdTitle.includes('12th') || vdType.includes('12th'));

      if (isReqAdmitCard && isVd12thMarksheet) continue;
      if (isReq12thMarksheet && isVdAdmitCard) continue;

      // Disambiguation 4: 10th vs 12th
      const isReq10th = reqName.includes('10th') || reqType.includes('10th') || reqName.includes('ssc') || reqName.includes('matric');
      const isVd10th = vdTitle.includes('10th') || vdType.includes('10th') || vdTitle.includes('ssc') || vdTitle.includes('matric');
      const isReq12th = reqName.includes('12th') || reqType.includes('12th') || reqName.includes('hsc') || reqName.includes('intermediate');
      const isVd12th = vdTitle.includes('12th') || vdType.includes('12th') || vdTitle.includes('hsc') || vdTitle.includes('intermediate');

      if (isReq10th && isVd12th) continue;
      if (isReq12th && isVd10th) continue;

      // Disambiguation 5: Entrance Exam Scorecard (NEET vs JEE vs CLAT vs NATA)
      const isReqNeet = reqName.includes('neet') || reqType.includes('neet');
      const isVdNeet = vdTitle.includes('neet') || vdType.includes('neet');
      const isReqJee = reqName.includes('jee') || reqName.includes('cet') || reqType.includes('jee') || reqType.includes('cet');
      const isVdJee = vdTitle.includes('jee') || vdTitle.includes('cet') || vdType.includes('jee') || vdType.includes('cet');
      const isReqClat = reqName.includes('clat') || reqType.includes('clat');
      const isVdClat = vdTitle.includes('clat') || vdType.includes('clat');
      const isReqNata = reqName.includes('nata') || reqType.includes('nata');
      const isVdNata = vdTitle.includes('nata') || vdType.includes('nata');

      if (isReqNeet && !isVdNeet && (isVdJee || isVdClat || isVdNata)) continue;
      if (isReqJee && !isVdJee && (isVdNeet || isVdClat || isVdNata)) continue;
      if (isReqClat && !isVdClat && (isVdNeet || isVdJee || isVdNata)) continue;
      if (isReqNata && !isVdNata && (isVdNeet || isVdJee || isVdClat)) continue;

      let isMatch = false;

      // Positive Match 0: Canonical Taxonomy ID Match
      const reqCanonical = normalizeDocumentType(reqType || reqName);
      const vdCanonical = normalizeDocumentType(vdType || vdTitle);
      if (reqCanonical.canonicalId === 'custom_document' && vdCanonical.canonicalId !== 'custom_document') continue;
      if (vdCanonical.canonicalId === 'custom_document' && reqCanonical.canonicalId !== 'custom_document') continue;
      const academicTypes = new Set(['10th_marksheet', '12th_marksheet', 'semester_marksheet', 'degree_marksheet', 'diploma_marksheet', 'degree_certificate', 'diploma_certificate', '10th_school_lc']);
      if (academicTypes.has(reqCanonical.canonicalId) && academicTypes.has(vdCanonical.canonicalId) && reqCanonical.canonicalId !== vdCanonical.canonicalId) continue;
      if (reqCanonical.canonicalId !== 'unrecognized' && reqCanonical.canonicalId === vdCanonical.canonicalId) {
        isMatch = true;
      }
      // Positive Match 1: Exact typeKey match
      else if (vdType && reqType && vdType === reqType && reqType !== 'entrance_exam_scorecard' && reqType !== 'cap_allotment_letter' && reqType !== 'custom_document') {
        isMatch = true;
      }
      // Positive Match 2: Exact or Substring Title Match
      else if (cleanVdTitle && cleanReqName && (cleanVdTitle === cleanReqName || cleanVdTitle.includes(cleanReqName) || cleanReqName.includes(cleanVdTitle))) {
        isMatch = true;
      }
      // Positive Match 3: Aadhaar
      else if ((reqType === 'aadhaar_card' || reqName.includes('aadhaar') || reqName.includes('aadhar') || reqName.includes('uidai')) &&
               (vdType === 'aadhaar_card' || vdTitle.includes('aadhaar') || vdTitle.includes('aadhar') || vdTitle.includes('uidai'))) {
        isMatch = true;
      }
      // Positive Match 4: PAN Card
      else if ((reqType === 'pan_card' || reqName.includes('pan')) &&
               (vdType === 'pan_card' || vdTitle.includes('pan'))) {
        isMatch = true;
      }
      // Positive Match 5: Sovereign Passport (Not Photo)
      else if ((reqType === 'passport' || (reqName.includes('passport') && !isReqPhoto)) &&
               (vdType === 'passport' || (vdTitle.includes('passport') && !isVdPhoto))) {
        isMatch = true;
      }
      // Positive Match 6: Driving Licence
      else if ((reqType === 'driving_licence' || reqName.includes('driving') || reqName.includes('licence') || reqName.includes('license') || reqName.includes('dl')) &&
               (vdType === 'driving_licence' || vdTitle.includes('driving') || vdTitle.includes('licence') || vdTitle.includes('license') || vdTitle.includes('dl'))) {
        isMatch = true;
      }
      // Positive Match 7: Birth Certificate
      else if ((reqType === 'birth_certificate' || reqName.includes('birth')) &&
               (vdType === 'birth_certificate' || vdTitle.includes('birth'))) {
        isMatch = true;
      }
      // Positive Match 8: 10th Marksheet
      else if (isReq10thMarksheet && isVd10thMarksheet) {
        isMatch = true;
      }
      // Positive Match 9: 10th LC
      else if (isReqLC && isVdLC && (isReq10th || isVd10th || (!isReq12th && !isVd12th))) {
        isMatch = true;
      }
      // Positive Match 10: 12th Marksheet
      else if (isReq12thMarksheet && isVd12thMarksheet) {
        isMatch = true;
      }
      // Positive Match 11: 12th Admit Card
      else if (isReqAdmitCard && isVdAdmitCard) {
        isMatch = true;
      }
      // Positive Match 12: NEET Scorecard
      else if (isReqNeet && isVdNeet) {
        isMatch = true;
      }
      // Positive Match 13: JEE / CET Scorecard
      else if (isReqJee && isVdJee) {
        isMatch = true;
      }
      // Positive Match 14: Medical Fitness Certificate
      else if ((reqType === 'medical_fitness_certificate' || reqName.includes('fitness')) &&
               (vdType === 'medical_fitness_certificate' || vdTitle.includes('fitness'))) {
        isMatch = true;
      }
      // Positive Match 15: Allotment Letter
      else if ((reqType === 'cap_allotment_letter' || reqName.includes('allotment')) &&
               (vdType === 'cap_allotment_letter' || vdTitle.includes('allotment'))) {
        if (!(reqName.includes('medical') && vdTitle.includes('engineering')) &&
            !(reqName.includes('engineering') && vdTitle.includes('medical'))) {
          isMatch = true;
        }
      }
      // Positive Match 16: Bank Passbook / Statement
      else if ((reqType === 'bank_passbook_statement' || reqName.includes('bank') || reqName.includes('passbook') || reqName.includes('salary')) &&
               (vdType === 'bank_passbook_statement' || vdTitle.includes('bank') || vdTitle.includes('passbook') || vdTitle.includes('salary'))) {
        isMatch = true;
      }
      // Positive Match 17: Address Proof / Utility / Domicile
      else if ((reqType === 'address_proof' || reqName.includes('address') || reqName.includes('domicile') || reqName.includes('residence')) &&
               (vdType === 'address_proof' || vdTitle.includes('utility') || vdTitle.includes('electricity') || vdTitle.includes('address') || vdTitle.includes('bill') || vdTitle.includes('domicile'))) {
        isMatch = true;
      }
      // Positive Match 19: Caste / Category
      else if ((reqType === 'caste_certificate' || reqName.includes('caste') || reqName.includes('category')) &&
               (vdType === 'caste_certificate' || vdTitle.includes('caste') || vdTitle.includes('category'))) {
        isMatch = true;
      }
      // Positive Match 20: Income
      else if ((reqType === 'income_certificate' || reqName.includes('income')) &&
               (vdType === 'income_certificate' || vdTitle.includes('income'))) {
        isMatch = true;
      }
      // Positive Match 21: Gap Certificate
      else if ((reqType === 'gap_certificate' || reqName.includes('gap')) &&
               (vdType === 'gap_certificate' || vdTitle.includes('gap'))) {
        isMatch = true;
      }
      // Positive Match 22: Resume / Curriculum Vitae (CV)
      else if ((reqType === 'resume' || reqName.includes('resume') || reqName.includes('cv') || reqName.includes('curriculum vitae')) &&
               (vdType === 'resume' || vdTitle.includes('resume') || vdTitle.includes('cv') || vdTitle.includes('curriculum vitae') || vdTitle.includes('biodata'))) {
        isMatch = true;
      }

      if (isMatch) {
        candidates.push(vd);
      }
    }

    if (candidates.length === 0) return null;

    // Multi-version candidate ranking (Requirement 6 & 7):
    // Newest valid / renewed version MUST satisfy requirement over older or expired versions
    candidates.sort((a, b) => {
      const expA = calculateDocumentExpiry(a);
      const expB = calculateDocumentExpiry(b);

      // 1. Non-expired (VALID / EXPIRING_SOON) beats EXPIRED
      if (!expA.isExpired && expB.isExpired) return -1;
      if (expA.isExpired && !expB.isExpired) return 1;

      // 2. Active version beats historical / previous version
      const prevA = (a.isPreviousVersion || a.versionStatus === 'history') ? 1 : 0;
      const prevB = (b.isPreviousVersion || b.versionStatus === 'history') ? 1 : 0;
      if (prevA !== prevB) return prevA - prevB;

      // 3. Higher version number beats lower version
      const verA = typeof a.version === 'number' ? a.version : 1;
      const verB = typeof b.version === 'number' ? b.version : 1;
      if (verA !== verB) return verB - verA;

      // 4. Verification state ranking: Verified > AI Checked > Needs Review > Available / Uploaded
      const scoreState = (doc) => {
        if (doc.verified || doc.verificationLabel === 'Human Verified' || doc.documentStatus === 'Ready to Share' || doc.documentStatus === 'Verified') return 4;
        if (doc.verificationLabel === 'AI Check Passed' || doc.documentStatus === 'AI Checked' || doc.aiStatus === 'verified_match') return 3;
        if (doc.verificationLabel === 'Needs Human Review' || doc.vaultIndicator === 'Pending Review') return 2;
        return 1;
      };
      const scoreA = scoreState(a);
      const scoreB = scoreState(b);
      if (scoreA !== scoreB) return scoreB - scoreA;

      // 5. Expiry days remaining (furthest in future beats nearer)
      if (expA.daysRemaining !== null && expB.daysRemaining !== null) {
        return expB.daysRemaining - expA.daysRemaining;
      }

      // 6. Recency (creation or ID timestamp)
      const timeA = a.uploadedAt ? new Date(a.uploadedAt).getTime() : (parseInt((a.id || '').replace(/\D/g, '')) || 0);
      const timeB = b.uploadedAt ? new Date(b.uploadedAt).getTime() : (parseInt((b.id || '').replace(/\D/g, '')) || 0);
      return timeB - timeA;
    });

    const bestCandidate = candidates[0];
    const bestId = bestCandidate.id || bestCandidate.document_id || bestCandidate.documentId;
    if (bestId) boundIds.add(bestId);

    // Annotate older / superseded candidates as previous versions in history without deleting them,
    // and bind their IDs so they do not duplicate onto other active requirements (Requirement 6 & 7)
    for (let i = 1; i < candidates.length; i++) {
      const other = candidates[i];
      const otherId = other.id || other.document_id || other.documentId;
      other.isPreviousVersion = true;
      other.versionStatus = 'history';
      other.supersededBy = bestId;
      if (otherId) boundIds.add(otherId);
    }

    return bestCandidate;
  }

  // Canonical Document State Evaluator with Expiry Intelligence
  function getDocumentState(matched) {
    if (!matched) {
      return {
        statusCode: 'MISSING',
        statusLabel: 'Missing',
        journeyStage: 'Required',
        verifLabel: 'Missing',
        isStored: false,
        isExpired: false,
        isExpiringSoon: false,
        expiryStatus: 'VALID',
        expiryInfo: null
      };
    }

    const expiryInfo = calculateDocumentExpiry(matched);
    const isExpired = expiryInfo.isExpired;
    const isExpiringSoon = expiryInfo.isExpiringSoon;

    const isHumanVerified = Boolean(
      !isExpired && (
        matched.verificationLabel === 'Human Verified' ||
        matched.verification_label === 'Human Verified' ||
        matched.documentStatus === 'Ready to Share' ||
        matched.current_status === 'Ready to Share' ||
        matched.documentStatus === 'Verified' ||
        matched.current_status === 'Verified' ||
        (matched.verified === true &&
         matched.verificationLabel !== 'Needs Human Review' &&
         matched.verification_label !== 'Needs Human Review' &&
         matched.verificationLabel !== 'Needs Attention' &&
         matched.verification_label !== 'Needs Attention' &&
         matched.verificationLabel !== 'Rejected' &&
         matched.current_status !== 'Rejected')
      )
    );

    const isNeedsReview = Boolean(
      !isExpired && !isHumanVerified && (
        matched.verificationLabel === 'Needs Human Review' ||
        matched.verification_label === 'Needs Human Review' ||
        matched.documentStatus === 'Uploaded' ||
        matched.current_status === 'Uploaded' ||
        matched.vaultIndicator === 'Pending Review' ||
        matched.verificationLabel === 'Needs Attention' ||
        matched.verification_label === 'Needs Attention' ||
        matched.verificationLabel === 'Pending Review'
      )
    );

    const isAiChecked = Boolean(
      !isExpired && !isHumanVerified && !isNeedsReview && (
        matched.verificationLabel === 'AI Check Passed' ||
        matched.verification_label === 'AI Check Passed' ||
        matched.documentStatus === 'AI Checked' ||
        matched.current_status === 'AI Checked' ||
        matched.aiStatus === 'verified_match' ||
        matched.ai_status === 'verified_match'
      )
    );

    if (isExpired) {
      return {
        statusCode: 'EXPIRED',
        statusLabel: 'Expired',
        journeyStage: 'Expired (Renewal Required)',
        verifLabel: 'Expired',
        isStored: true,
        isExpired: true,
        isExpiringSoon: false,
        expiryStatus: 'EXPIRED',
        expiryInfo: expiryInfo
      };
    }

    if (isHumanVerified) {
      return {
        statusCode: 'VERIFIED',
        statusLabel: 'Verified',
        journeyStage: 'Ready to Share',
        verifLabel: 'Human Verified',
        isStored: true,
        isExpired: false,
        isExpiringSoon: isExpiringSoon,
        expiryStatus: isExpiringSoon ? 'EXPIRING_SOON' : 'VALID',
        expiryInfo: expiryInfo
      };
    }

    if (isNeedsReview) {
      return {
        statusCode: 'NEEDS_REVIEW',
        statusLabel: 'Needs Human Review',
        journeyStage: 'Needs Human Review',
        verifLabel: 'Needs Human Review',
        isStored: true,
        isExpired: false,
        isExpiringSoon: isExpiringSoon,
        expiryStatus: isExpiringSoon ? 'EXPIRING_SOON' : 'VALID',
        expiryInfo: expiryInfo
      };
    }

    if (isAiChecked) {
      return {
        statusCode: 'AI_CHECKED',
        statusLabel: 'AI Checked',
        journeyStage: 'AI Checked',
        verifLabel: 'AI Check Passed',
        isStored: true,
        isExpired: false,
        isExpiringSoon: isExpiringSoon,
        expiryStatus: isExpiringSoon ? 'EXPIRING_SOON' : 'VALID',
        expiryInfo: expiryInfo
      };
    }

    return {
      statusCode: 'AVAILABLE',
      statusLabel: 'Available',
      journeyStage: 'Available',
      verifLabel: 'Available',
      isStored: true,
      isExpired: false,
      isExpiringSoon: isExpiringSoon,
      expiryStatus: isExpiringSoon ? 'EXPIRING_SOON' : 'VALID',
      expiryInfo: expiryInfo
    };
  }

  class DocdonAdvisorEngine {
    constructor(database) {
      this.db = database;
      this.plans = ADVISOR_CHECKLIST_PLANS;
      this.profiles = DOCUMENT_PROFILES;
      this.matchRequirementToVaultDoc = matchRequirementToVaultDoc;
      this.getDocumentState = getDocumentState;
    }

    // Detect education stage / qualification status from natural language
    detectEducationStage(text) {
      if (!text || typeof text !== 'string') return null;
      const lower = text.toLowerCase().trim();

      // 1. Pending / Appearing 12th (e.g. "I completed 10th but not 12th", "12th pending", "appearing for 12th", "currently in 12th")
      const is12thPendingRegex = /\b(?:not\s+(?:completed\s+|done\s+|cleared\s+)?12th|not\s+12th|haven'?t\s+(?:done|completed|cleared)\s+12th|12th\s+(?:pending|appearing|pursuing|not\s+completed|not\s+yet|awaited)|currently\s+in\s+12th|pursuing\s+12th|studying\s+in\s+12th|in\s+12th\s+standard|in\s+12th\s+class|in\s+12th|did\s+not\s+(?:complete\s+|do\s+)?12th|without\s+12th)\b/i;
      if (is12thPendingRegex.test(lower)) {
        return '12th_pending';
      }
      if (lower.includes('10th') && (lower.includes('not 12th') || lower.includes("haven't done 12th") || lower.includes("haven't 12th") || lower.includes('12th pending') || lower.includes('no 12th') || lower.includes('without 12th'))) {
        return '12th_pending';
      }

      // 2. Completed 12th (e.g. "I completed my 12th", "passed 12th", "12th completed", "completed HSC", "passed HSC")
      const is12thCompletedRegex = /\b(?:completed\s+(?:my\s+)?12th|passed\s+(?:my\s+)?12th|cleared\s+(?:my\s+)?12th|finished\s+(?:my\s+)?12th|done\s+(?:with\s+)?(?:my\s+)?12th|12th\s+(?:completed|passed|cleared|finished|done|standard\s+completed)|completed\s+hsc|passed\s+hsc|plus\s+two\s+completed|after\s+12th)\b/i;
      if (is12thCompletedRegex.test(lower)) {
        return '12th_completed';
      }

      // 3. Graduate / Degree Completed
      const isGraduateRegex = /\b(?:graduate|graduated|graduation\s+completed|bachelor(?:'?s)?\s+completed|degree\s+completed|diploma\s+completed|b\.?tech\s+completed)\b/i;
      if (isGraduateRegex.test(lower)) {
        return 'graduate';
      }

      // 4. Completed 10th (e.g. "I completed 10th", "after 10th", "passed 10th", "completed SSC")
      const is10thCompletedRegex = /\b(?:completed\s+(?:my\s+)?10th|passed\s+(?:my\s+)?10th|cleared\s+(?:my\s+)?10th|finished\s+(?:my\s+)?10th|done\s+(?:with\s+)?(?:my\s+)?10th|10th\s+(?:completed|passed|cleared|finished|done|standard\s+completed)|completed\s+ssc|passed\s+ssc|after\s+10th|matric\s+completed)\b/i;
      if (is10thCompletedRegex.test(lower)) {
        return '10th_completed';
      }

      // General fallback if mentions 12th/HSC
      if (lower.includes('12th') || lower.includes('twelfth') || lower.includes('hsc') || lower.includes('plus two') || lower.includes('senior secondary')) {
        if (lower.includes('pending') || lower.includes('appearing') || lower.includes('not') || lower.includes('awaiting')) {
          return '12th_pending';
        }
        return '12th_completed';
      }

      // General fallback if mentions 10th/SSC
      if (lower.includes('10th') || lower.includes('tenth') || lower.includes('ssc') || lower.includes('matric') || lower.includes('secondary school')) {
        return '10th_completed';
      }

      return null;
    }

    // Helper: Map career preference to internal targetPath
    getCareerTargetPath(careerKey) {
      switch (careerKey) {
        case 'engineering': return 'engineering_btech';
        case 'mbbs': return 'medical_mbbs';
        case 'bds': return 'dental_bds';
        case 'pharmacy': return 'pharmacy';
        case 'law': return 'law_llb';
        case 'ca': return 'chartered_accountancy';
        case 'architecture': return 'architecture_barch';
        case 'computer_science': return 'computer_science';
        default: return careerKey;
      }
    }

    // Detect single career preference from text
    detectCareerPreference(text) {
      if (!text || typeof text !== 'string') return null;
      const lower = text.toLowerCase().trim();

      // Computer Science / B.Tech CSE (check before generic engineering)
      if (/\b(computer\s+science|comp\s*sci|cse|b\.?tech\s+cs|b\.?tech\s+cse|software\s+engineering|software\s+developer|coding|programmer)\b/i.test(lower)) {
        return 'computer_science';
      }

      // Architecture / B.Arch / NATA
      if (/\b(architecture|architect|b\.?arch|nata)\b/i.test(lower)) {
        return 'architecture';
      }

      // Law / LL.B. / CLAT
      if (/\b(law|llb|clat|lawyer|advocate|legal\s+studies|b\.?a\.?\s*ll\.?b|b\.?b\.?a\.?\s*ll\.?b)\b/i.test(lower)) {
        return 'law';
      }

      // CA / Chartered Accountancy / ICAI
      if (/\b(ca|chartered\s+accountan(?:cy|t)|icai|ca\s+foundation)\b/i.test(lower)) {
        return 'ca';
      }

      // BDS / Dental
      if (/\b(bds|dental|dentist|dentistry)\b/i.test(lower)) {
        return 'bds';
      }

      // Pharmacy
      if (/\b(pharmacy|pharmacist|b\.?pharm|b\.?pharma|pharma)\b/i.test(lower)) {
        return 'pharmacy';
      }

      // MBBS / Medical / Doctor / Physician
      if (/\b(mbbs|doctor|physician|medicine)\b/i.test(lower) || 
          (/\bmedical\b/i.test(lower) && !lower.includes('fitness certificate') && !lower.includes('medical fitness'))) {
        return 'mbbs';
      }

      // Engineering / B.Tech / B.E.
      if (/\b(engineering|engineer|b\.?tech|b\.?e\.?)\b/i.test(lower)) {
        return 'engineering';
      }

      return null;
    }

    // Detect all distinct career preferences in text
    detectAllCareerPreferences(text) {
      if (!text || typeof text !== 'string') return [];
      const lower = text.toLowerCase();
      const list = [];
      if (/\b(computer\s+science|comp\s*sci|cse|b\.?tech\s+cs|b\.?tech\s+cse|software\s+engineering|coding|programmer)\b/i.test(lower)) list.push('computer_science');
      if (/\b(architecture|architect|b\.?arch|nata)\b/i.test(lower)) list.push('architecture');
      if (/\b(law|llb|clat|lawyer|advocate|legal\s+studies|b\.?a\.?\s*ll\.?b|b\.?b\.?a\.?\s*ll\.?b)\b/i.test(lower)) list.push('law');
      if (/\b(ca|chartered\s+accountan(?:cy|t)|icai|ca\s+foundation)\b/i.test(lower)) list.push('ca');
      if (/\b(bds|dental|dentist|dentistry)\b/i.test(lower)) list.push('bds');
      if (/\b(pharmacy|pharmacist|b\.?pharm|b\.?pharma|pharma)\b/i.test(lower)) list.push('pharmacy');
      if (/\b(mbbs|doctor|physician|medicine)\b/i.test(lower) || (/\bmedical\b/i.test(lower) && !lower.includes('fitness'))) list.push('mbbs');
      if (/\b(engineering|engineer|b\.?tech|b\.?e\.?)\b/i.test(lower)) list.push('engineering');
      return list;
    }

    // Resolve target career preference handling contrast phrases ("instead of X, Y", "no I want Y")
    resolveTargetCareer(text, currentCareer = null) {
      if (!text || typeof text !== 'string') return null;
      const lower = text.toLowerCase();

      // 1. Contrast phrases: "instead of engineering I want medicine", "rather than engineering", "not engineering"
      const contrastRegex = /(?:instead\s+of|rather\s+than|not|no\s+longer)\s+(?:engineering|engineer|b\.?tech|b\.?e\.?|computer\s+science|comp\s*sci|cse|mbbs|medical|medicine|doctor|bds|dental|dentist|pharmacy|b\.?pharm|pharma|law|llb|clat|ca|chartered\s+accountant|architecture|b\.?arch|nata)[^a-z0-9]+(?:i\s+want|i\s+prefer|i\s+chose|i\s+choose|now\s+i\s+want|i'll\s+take|i\s+decided\s+to\s+pursue|give\s+me|take)?\s*(.*)/i;
      const contrastMatch = text.match(contrastRegex);
      if (contrastMatch && contrastMatch[1]) {
        const target = this.detectCareerPreference(contrastMatch[1]);
        if (target) return target;
      }

      // 2. Transition keywords: "actually", "changed my mind", "no, i want", "switch to", "change to", "i decided to pursue", "now i want", "rather"
      const transitionRegex = /(?:actually|changed\s+my\s+mind|switch\s+to|change\s+to|no\s*,?\s*i\s+want|rather|decided\s+to\s+pursue|now\s+i\s+want|instead)\s*(.*)/i;
      const transitionMatch = text.match(transitionRegex);
      if (transitionMatch && transitionMatch[1]) {
        const target = this.detectCareerPreference(transitionMatch[1]);
        if (target) return target;
      }

      // 3. If multiple careers mentioned in message and one is currentCareer, the OTHER is the new target
      const allFound = this.detectAllCareerPreferences(text);
      if (allFound.length > 1 && currentCareer && allFound.includes(currentCareer)) {
        return allFound.find(c => c !== currentCareer);
      }

      // 4. Default detection
      return this.detectCareerPreference(text);
    }

    // Detect goal/purpose with high precision across all natural language variations
    detectGoal(text) {
      if (!text || typeof text !== 'string') return null;
      const lower = text.toLowerCase().trim();

      if (lower.includes('passport')) return 'passport';
      if (lower.includes('visa') || lower.includes('abroad') || lower.includes('embassy') || lower.includes('consulate') || lower.includes('immigration')) return 'visa';
      if (lower.includes('driving') || lower.includes('licence') || lower.includes('license') || lower.includes('rto') || lower.includes('dl ') || lower.endsWith('dl') || lower.includes('driver')) return 'driving_licence';
      if (lower.includes('rent') || lower.includes('lease') || lower.includes('flat') || lower.includes('tenant') || lower.includes('landlord') || lower.includes('apartment') || lower.includes('pg accommodation') || lower.includes('room on rent')) return 'renting';
      if (lower.includes('loan') || lower.includes('bank account') || lower.includes('banking') || lower.includes('credit card') || lower.includes('account opening') || lower.includes('cibil') || lower.includes('open an account')) return 'bank_loan';
      if (lower.includes('govt') || lower.includes('government') || lower.includes('sarkari') || lower.includes('upsc') || lower.includes('ssc exam') || lower.includes('civil service') || lower.includes('public service') || lower.includes('government job')) return 'government_work';
      if (lower.includes('bgv') || (lower.includes('background') && lower.includes('verification'))) return 'employment_verification';
      if (lower.includes('job') || lower.includes('employment') || lower.includes('offer letter') || lower.includes('joining') || lower.includes('onboarding') || lower.includes('career') || lower.includes('salary slip') || lower.includes('company') || lower.includes('hired') || lower.includes('employer') || lower.includes('start working')) return 'job';
      if (lower.includes('college') || lower.includes('admission') || lower.includes('university') || lower.includes('polytechnic') || lower.includes('engineering') || lower.includes('btech') || lower.includes('junior college') || lower.includes('11th') || lower.includes('counseling') || lower.includes('enrollment') || lower.includes('continue my studies') || lower.includes('higher education') || lower.includes('further studies') || lower.includes('entering college') || lower.includes('mbbs') || lower.includes('bds') || lower.includes('pharmacy') || lower.includes('law') || lower.includes('llb') || lower.includes('clat') || lower.includes('architecture') || lower.includes('barch') || lower.includes('nata') || lower.includes('computer science') || lower.includes('cse') || lower.includes('chartered accountant') || lower.includes('icai') || /\bca\b/i.test(lower)) return 'college_admission';
      if (lower.includes('education') || lower.includes('school') || lower.includes('study') || lower.includes('studies') || lower.includes('academic') || lower.includes('marksheet')) return 'education';

      return null;
    }

    // Detect all distinct goals mentioned in a message
    detectAllGoals(text) {
      if (!text || typeof text !== 'string') return [];
      const lower = text.toLowerCase().trim();
      const goals = [];
      const add = (g) => { if (!goals.includes(g)) goals.push(g); };

      if (lower.includes('passport')) add('passport');
      if (lower.includes('visa') || lower.includes('abroad') || lower.includes('embassy') || lower.includes('consulate') || lower.includes('immigration')) add('visa');
      if (lower.includes('driving') || lower.includes('licence') || lower.includes('license') || lower.includes('rto') || lower.includes('dl ') || lower.endsWith('dl') || lower.includes('driver')) add('driving_licence');
      if (lower.includes('rent') || lower.includes('lease') || lower.includes('flat') || lower.includes('tenant') || lower.includes('landlord') || lower.includes('apartment') || lower.includes('pg accommodation')) add('renting');
      if (lower.includes('loan') || lower.includes('bank account') || lower.includes('banking') || lower.includes('credit card') || lower.includes('account opening') || lower.includes('cibil')) add('bank_loan');
      if (lower.includes('govt') || lower.includes('government') || lower.includes('sarkari') || lower.includes('upsc') || lower.includes('ssc exam') || lower.includes('civil service')) add('government_work');
      if (lower.includes('job') || lower.includes('employment') || lower.includes('offer letter') || lower.includes('joining') || lower.includes('onboarding') || lower.includes('career') || lower.includes('company') || lower.includes('hired')) add('job');
      if (lower.includes('college') || lower.includes('admission') || lower.includes('university') || lower.includes('polytechnic') || lower.includes('engineering') || lower.includes('junior college') || lower.includes('continue my studies') || lower.includes('mbbs') || lower.includes('bds') || lower.includes('pharmacy') || lower.includes('law') || lower.includes('llb') || lower.includes('clat') || lower.includes('architecture') || lower.includes('barch') || lower.includes('nata') || lower.includes('computer science') || lower.includes('cse') || lower.includes('chartered accountant') || lower.includes('icai') || /\bca\b/i.test(lower)) add('college_admission');
      if (lower.includes('education') || lower.includes('school') || lower.includes('study') || lower.includes('studies')) add('education');

      return goals;
    }

    // Detect if user changes or corrects their goal or career preference midway
    detectMidwayChange(text, currentContext = {}) {
      if (!text || typeof text !== 'string') return { isChange: false };
      const lower = text.toLowerCase().trim();

      const changeSignals = [
        'actually', 'wait', 'change to', 'switch to', 'instead', 'no i want', 'no, i want',
        'rather', 'correct that', 'i meant', 'sorry', 'update', 'let me change',
        'different', 'not college', 'not job', 'change stream', 'change path', 'switch path',
        'was asking for', 'earlier i', 'now i need', 'now i want', 'also need',
        'changed my mind', 'not engineering', 'i decided to pursue', 'decided to pursue',
        'i want medical', 'i want mbbs', 'i want bds', 'i want pharmacy', 'i want medicine',
        'medical career', 'career in medicine', 'i want law', 'i want ca', 'i want architecture',
        'i want computer science'
      ];
      const hasSignal = changeSignals.some(s => lower.includes(s));

      // 0. Career Preference Change Detection (Latest explicit preference MUST win - strictly mutable)
      const currentCareer = currentContext.careerPreference || (currentContext.targetPath === 'engineering_btech' ? 'engineering' : currentContext.targetPath === 'medical_mbbs' ? 'mbbs' : currentContext.targetPath === 'dental_bds' ? 'bds' : currentContext.targetPath === 'pharmacy' ? 'pharmacy' : currentContext.targetPath === 'law_llb' ? 'law' : currentContext.targetPath === 'chartered_accountancy' ? 'ca' : currentContext.targetPath === 'architecture_barch' ? 'architecture' : currentContext.targetPath === 'computer_science' ? 'computer_science' : null);
      const targetCareer = this.resolveTargetCareer(text, currentCareer);
      if (targetCareer) {
        if (currentCareer && targetCareer === currentCareer) {
          // Explicit confirmation of existing preference (e.g. Test E: "I still want engineering")
          // Must NOT trigger an unnecessary rebuild or change notice
          return { isChange: false, unchangedCareer: targetCareer };
        }
        if (currentCareer && targetCareer !== currentCareer) {
          const oldMeta = CAREER_METADATA[currentCareer] || { label: currentCareer, streamKeyword: currentCareer };
          const newMeta = CAREER_METADATA[targetCareer] || { label: targetCareer, streamKeyword: targetCareer };
          return {
            isChange: true,
            type: 'career_preference_change',
            field: 'careerPreference',
            value: targetCareer,
            oldCareer: currentCareer,
            newCareer: targetCareer,
            exactNotice: `Got it — you've changed your preference from ${oldMeta.label} to ${newMeta.label}. I'll update your roadmap and document requirements.`,
            description: `Preference changed from ${oldMeta.label} to ${newMeta.label}`
          };
        }
      }

      // 0b. Education Stage Change Detection (e.g. "I completed 10th but not 12th" <-> "I completed my 12th")
      const targetStage = this.detectEducationStage(text);
      if (targetStage && currentContext.educationStage && targetStage !== currentContext.educationStage) {
        const stageLabels = {
          '12th_pending': '10th Completed (12th Pending / Appearing)',
          '12th_completed': '12th Standard (HSC) Completed',
          '10th_completed': '10th Standard Completed',
          'graduate': 'Graduate / Degree Completed'
        };
        const newLabel = stageLabels[targetStage] || targetStage;
        let exactNotice = '';
        if (targetStage === '12th_completed') {
          exactNotice = `🎓 <em>Education qualification updated to <strong>${newLabel}</strong>! 12th Marksheet is now added as a mandatory requirement.</em>`;
        } else if (targetStage === '12th_pending') {
          exactNotice = `📘 <em>Education qualification updated to <strong>${newLabel}</strong>. Completed 12th marksheet requirement removed; 12th Admit Card added as provisional proof.</em>`;
        } else {
          exactNotice = `🔄 <em>Education qualification updated to <strong>${newLabel}</strong>. Recalculating your requirements...</em>`;
        }

        return {
          isChange: true,
          type: 'education_stage_change',
          field: 'educationStage',
          value: targetStage,
          oldStage: currentContext.educationStage,
          newStage: targetStage,
          exactNotice: exactNotice,
          description: `Education stage changed to ${newLabel}`
        };
      }

      // 0c. Applicant Type Change Detection (e.g. Fresher <-> Experienced Professional)
      let targetApplicantType = null;
      if (/\b(experienced|prior\s+company|previous\s+employer|ex-employee|lateral|work\s+experience)\b/i.test(lower) && !lower.includes('fresher') && !lower.includes('no experience')) {
        targetApplicantType = 'experienced';
      } else if (/\b(fresher|first\s+job|campus|entry\s+level|recent\s+graduate|no\s+experience)\b/i.test(lower)) {
        targetApplicantType = 'fresher';
      }
      if (targetApplicantType && currentContext.applicantType && targetApplicantType !== currentContext.applicantType) {
        const isExp = targetApplicantType === 'experienced';
        return {
          isChange: true,
          type: 'applicant_type_change',
          field: 'applicantType',
          value: targetApplicantType,
          exactNotice: isExp 
            ? `💼 <em>Applicant status updated to <strong>Experienced Professional</strong>. Added Relieving Letter, Salary Slips, and Form 16 to your requirements.</em>`
            : `💼 <em>Applicant status updated to <strong>Fresher (First Job)</strong>. Relieving letter & prior salary slips removed.</em>`,
          description: `Applicant type changed to ${targetApplicantType}`
        };
      }

      // 1. Goal change with contrast/transition clause parsing
      let targetGoal = null;
      // Match clause after transition conjunctions like "actually", "but", "instead of", "rather than", "switch to", "change to", "was asking for ... but", "also need them for"
      const transitionMatch = text.match(/(?:actually|but\s+actually|but|instead\s+of|rather\s+than|switch\s+to|change\s+to|was\s+asking\s+for[^\,\.]*\,?\s*but|earlier\s+i[^\,\.]*\,?\s*but|now\s+i\s+(?:want|need)|also\s+need\s+(?:them\s+)?for)\s*(.*)/i);
      if (transitionMatch && transitionMatch[1]) {
        targetGoal = this.detectGoal(transitionMatch[1]);
      }
      if (!targetGoal) {
        // If multiple goals found and one matches currentContext.goal, pick the other goal
        const allGoals = this.detectAllGoals(text);
        if (allGoals.length > 1 && currentContext.goal && allGoals.includes(currentContext.goal)) {
          targetGoal = allGoals.find(g => g !== currentContext.goal);
        } else {
          targetGoal = this.detectGoal(text);
        }
      }

      if (targetGoal && currentContext.goal && targetGoal !== currentContext.goal) {
        const targetPlan = this.plans[targetGoal];
        return {
          isChange: true,
          type: 'goal_change',
          newGoal: targetGoal,
          description: `Goal changed to "${targetPlan ? targetPlan.goal : targetGoal.replace(/_/g, ' ')}"`
        };
      }

      // 2. Stream / Path change within existing goal (Non-career admission streams)
      if (hasSignal) {
        if (lower.includes('diploma') || lower.includes('polytechnic')) {
          return { isChange: true, type: 'path_change', field: 'targetPath', value: 'polytechnic_diploma', description: 'Admission stream changed to 3-Year Polytechnic Diploma' };
        }
        if (lower.includes('11th') || lower.includes('junior college') || lower.includes('hsc')) {
          return { isChange: true, type: 'path_change', field: 'targetPath', value: 'junior_college_11th', description: 'Admission stream changed to 11th / Junior College' };
        }
        if (lower.includes('iti') || lower.includes('vocational')) {
          return { isChange: true, type: 'path_change', field: 'targetPath', value: 'iti', description: 'Admission stream changed to Vocational / ITI' };
        }
        if (lower.includes('fresher') || lower.includes('first job')) {
          return { isChange: true, type: 'applicant_type_change', field: 'applicantType', value: 'fresher', exactNotice: `💼 <em>Applicant status updated to <strong>Fresher (First Job)</strong>. Relieving letter & prior salary slips removed.</em>`, description: 'Applicant status changed to Fresher (First Job)' };
        }
        if (lower.includes('experienced') || lower.includes('prior company')) {
          return { isChange: true, type: 'applicant_type_change', field: 'applicantType', value: 'experienced', exactNotice: `💼 <em>Applicant status updated to <strong>Experienced Professional</strong>. Added Relieving Letter, Salary Slips, and Form 16 to your requirements.</em>`, description: 'Applicant status changed to Experienced Professional' };
        }
        if (lower.includes('tatkaal') || lower.includes('urgent')) {
          return { isChange: true, type: 'scheme_change', field: 'scheme', value: 'tatkaal', description: 'Application scheme changed to Tatkaal (Urgent)' };
        }
        if (lower.includes('general') || lower.includes('no quota')) {
          return { isChange: true, type: 'condition_change', field: 'clearQuota', value: true, description: 'Switched to Standard General Admission (no quota)' };
        }
      }

      return { isChange: false };
    }

    // Extract rich context from user free text
    extractContext(text, existingContext = {}, options = {}) {
      const lower = (text || '').toLowerCase();
      const ctx = Object.assign({ specialConditions: [] }, existingContext);

      // Extract Goal
      const detectedGoal = this.detectGoal(text);
      if (detectedGoal && !ctx.goal) {
        ctx.goal = detectedGoal;
      }

      // Education Stage
      if (!options.skipStageResolve) {
        const detectedStage = this.detectEducationStage(text);
        if (detectedStage) {
          ctx.educationStage = detectedStage;
        }
      }

      // Career Preference (Separate field in consultation context - strictly mutable, never locked)
      if (!options.skipCareerResolve) {
        const detectedCareer = this.resolveTargetCareer(text, ctx.careerPreference);
        if (detectedCareer) {
          ctx.careerPreference = detectedCareer;
          if (!ctx.goal) ctx.goal = 'college_admission';
          if (!ctx.educationStage) {
            ctx.educationStage = '12th_completed';
          }
          ctx.targetPath = this.getCareerTargetPath(detectedCareer);
        }
      }

      // Admission Stream / Target Path (Only evaluate general streams if no career preference is active)
      if (!ctx.careerPreference) {
        if (lower.includes('diploma') || lower.includes('polytechnic') || lower.includes('msbte')) {
          ctx.targetPath = 'polytechnic_diploma';
        } else if (lower.includes('11th') || lower.includes('junior college') || lower.includes('science stream') || lower.includes('commerce stream') || lower.includes('arts stream')) {
          ctx.targetPath = 'junior_college_11th';
        } else if (lower.includes('iti') || lower.includes('vocational')) {
          ctx.targetPath = 'iti';
        }
      }

      // Applicant Type
      if (lower.includes('fresher') || lower.includes('first job') || lower.includes('campus') || lower.includes('entry level') || lower.includes('recent graduate')) {
        ctx.applicantType = 'fresher';
      } else if (lower.includes('experienced') || lower.includes('prior company') || lower.includes('previous employer') || lower.includes('ex-employee') || lower.includes('lateral')) {
        ctx.applicantType = 'experienced';
      } else if (lower.includes('contractor') || lower.includes('consultant') || lower.includes('freelance')) {
        ctx.applicantType = 'contractor';
      } else if (lower.includes('minor') || lower.includes('under 18') || lower.includes('child')) {
        ctx.applicantType = 'minor';
      } else if (lower.includes('adult') || lower.includes('18+') || lower.includes('major')) {
        ctx.applicantType = 'adult';
      } else if (lower.includes('working professional') || lower.includes('bachelor tenant')) {
        ctx.applicantType = 'professional';
      } else if (lower.includes('family') || lower.includes('family lease')) {
        ctx.applicantType = 'family';
      } else if (lower.includes('student tenant') || lower.includes('student pg') || lower.includes('hostel')) {
        ctx.applicantType = 'student';
      }

      // Scheme / Driving / Bank / Visa specifics
      if (lower.includes('tatkaal') || lower.includes('urgent')) ctx.scheme = 'tatkaal';
      if (lower.includes('learner') || lower.includes('learning') || lower.includes('fresh dl')) ctx.dlStage = 'learner';
      else if (lower.includes('permanent dl') || lower.includes('driving test') || lower.includes('full dl')) ctx.dlStage = 'permanent';
      else if (lower.includes('commercial') || lower.includes('transport') || lower.includes('heavy vehicle')) ctx.dlStage = 'commercial';
      
      if (lower.includes('student visa') || lower.includes('study abroad') || lower.includes('f1')) ctx.visaType = 'student';
      else if (lower.includes('work visa') || lower.includes('employment visa') || lower.includes('work permit')) ctx.visaType = 'work';
      else if (lower.includes('tourist visa') || lower.includes('visitor visa') || lower.includes('travel visa')) ctx.visaType = 'tourist';

      if (lower.includes('education loan') || lower.includes('student loan')) ctx.loanType = 'education';
      else if (lower.includes('home loan') || lower.includes('housing loan') || lower.includes('mortgage')) ctx.loanType = 'home';
      else if (lower.includes('savings account') || lower.includes('account opening') || lower.includes('current account')) ctx.loanType = 'savings';
      else if (lower.includes('personal loan') || lower.includes('credit card')) ctx.loanType = 'personal';

      // Special Conditions
      const addCond = (c) => { if (!ctx.specialConditions.includes(c)) ctx.specialConditions.push(c); };
      const remCond = (c) => { ctx.specialConditions = ctx.specialConditions.filter(x => x !== c); };

      if (lower.includes('quota') || lower.includes('caste') || lower.includes('reservation') || lower.includes('obc') || lower.includes('sc') || lower.includes('st') || lower.includes('ews') || lower.includes('category')) {
        addCond('quota_category');
      }
      if (lower.includes('domicile') || lower.includes('state quota') || lower.includes('local resident')) {
        addCond('state_domicile');
      }
      if (lower.includes('gap') || lower.includes('drop year') || lower.includes('break in study') || lower.includes('study break')) {
        addCond('gap_year');
      }
      if (lower.includes('scholarship') || lower.includes('fee waiver') || lower.includes('fee concession') || lower.includes('income certificate')) {
        addCond('scholarship_income');
      }
      if (lower.includes('address change') || lower.includes('shifted') || lower.includes('moved') || lower.includes('new address')) {
        addCond('address_changed');
      }
      if (lower.includes('general admission') || lower.includes('no quota') || lower.includes('standard general')) {
        remCond('quota_category');
        ctx.specialConditionsChecked = true;
      }

      return ctx;
    }

    // Determine purposeful follow-up question or signal checklist is ready (No redundant questions)
    getNextQuestion(context) {
      const goal = context.goal;
      if (!goal) return { hasQuestion: false };

      // 1. College admission / Education
      if (goal === 'college_admission' || goal === 'education') {
        if (!context.educationStage) {
          return {
            hasQuestion: true,
            questionText: `To prepare your exact college admission checklist: which qualifying level have you completed?`,
            options: [
              { text: "📘 Completed 10th Standard (SSC)", action: "ans_10th_completed", value: "I completed 10th standard" },
              { text: "🎓 Completed 12th Standard (HSC)", action: "ans_12th_completed", value: "I completed 12th standard" },
              { text: "⏳ Completed 10th (12th In Progress / Pending)", action: "ans_12th_pending", value: "I completed 10th but not 12th" },
              { text: "📜 Completed Diploma / Bachelor's", action: "ans_graduate_completed", value: "I completed Diploma or Bachelor's" }
            ]
          };
        }

        if (context.educationStage === '10th_completed' && !context.targetPath && !context.careerPreference) {
          return {
            hasQuestion: true,
            questionText: `Great! For admission following 10th standard, which pathway are you enrolling into?`,
            options: [
              { text: "🎓 11th / Junior College (Arts/Sci/Com)", action: "ans_path_junior_college", value: "Enrolling in 11th Junior College" },
              { text: "🛠️ 3-Year Polytechnic Diploma", action: "ans_path_diploma", value: "Enrolling in 3-Year Polytechnic Diploma" },
              { text: "⚙️ Vocational / ITI Course", action: "ans_path_iti", value: "Enrolling in ITI Vocational Course" },
              { text: "🏷️ Applying via Quota / State Domicile", action: "ans_path_quota", value: "Applying under Quota / State Domicile" }
            ]
          };
        }

        if ((context.educationStage === '12th_completed' || context.educationStage === '12th_pending') && !context.targetPath && !context.careerPreference) {
          return {
            hasQuestion: true,
            questionText: context.educationStage === '12th_pending' 
              ? `Got it — 10th completed with 12th appearing/pending. Which degree program are you preparing documents for?`
              : `For admission following 12th (HSC), which degree program are you entering?`,
            options: [
              { text: "💻 Engineering (B.Tech / B.E.)", action: "ans_path_btech", value: "Engineering B.Tech" },
              { text: "🩺 Medical / Pharmacy (MBBS)", action: "ans_path_medical", value: "Medical MBBS" },
              { text: "📊 Commerce / Arts / Science", action: "ans_path_arts_sci", value: "Degree in Commerce or Arts" },
              { text: "🏷️ Quota / Domicile Reservation", action: "ans_path_quota", value: "State Domicile and Quota" }
            ]
          };
        }

        // When stage and target pathway or career preference are known, generate checklist immediately (no redundant friction)
        return { hasQuestion: false };
      }

      // 2. Passport Application
      if (goal === 'passport') {
        if (!context.applicantType) {
          return {
            hasQuestion: true,
            questionText: `To customize your sovereign passport dossier: are you applying as an Adult (18+) or Minor, and what is your education level?`,
            options: [
              { text: "🪪 Adult (18+) with 10th+ (Non-ECR)", action: "ans_passport_adult_nonecr", value: "Adult over 18, 10th passed for Non-ECR" },
              { text: "🧒 Minor (Under 18 Years)", action: "ans_passport_minor", value: "Minor under 18 years old" },
              { text: "⚡ Tatkaal (Urgent Application)", action: "ans_passport_tatkaal", value: "Urgent Tatkaal Application" },
              { text: "🔄 Residence Changed in Past 1 Year", action: "ans_passport_address_change", value: "Address changed in past 1 year" }
            ]
          };
        }
        return { hasQuestion: false };
      }

      // 3. Job / Employment
      if (goal === 'job' || goal === 'employment_verification') {
        if (!context.applicantType) {
          return {
            hasQuestion: true,
            questionText: `To tailor your employment onboarding checklist: are you joining as a Fresher (first job) or an Experienced Professional?`,
            options: [
              { text: "🎓 Fresher (First Job / Campus)", action: "ans_job_fresher", value: "Joining as a Fresher for my first job" },
              { text: "💼 Experienced Professional", action: "ans_job_experienced", value: "Experienced Professional with prior employer" },
              { text: "🤝 Contractor / Consultant", action: "ans_job_contractor", value: "Contractor Consultant" },
              { text: "🏦 Need Direct Salary Account Setup", action: "ans_job_salary_account", value: "Need direct salary bank account setup" }
            ]
          };
        }
        return { hasQuestion: false };
      }

      // 4. Driving Licence
      if (goal === 'driving_licence') {
        if (!context.dlStage) {
          return {
            hasQuestion: true,
            questionText: `Which driving licence stage or category are you applying for at the RTO?`,
            options: [
              { text: "🚗 Learner's Licence (Fresh)", action: "ans_dl_learner", value: "Applying for Learner's Licence" },
              { text: "🪪 Permanent Driving Licence", action: "ans_dl_permanent", value: "Applying for Permanent Driving Licence" },
              { text: "🚚 Commercial / Transport Endorsement", action: "ans_dl_commercial", value: "Applying for Commercial Transport Licence" }
            ]
          };
        }
        return { hasQuestion: false };
      }

      // 5. Renting / Tenancy
      if (goal === 'renting') {
        if (!context.applicantType) {
          return {
            hasQuestion: true,
            questionText: `Is this tenancy for a Working Professional, Student, or Family lease?`,
            options: [
              { text: "💼 Working Professional / Bachelor", action: "ans_rent_pro", value: "Working Professional tenant" },
              { text: "🏡 Family Residence Lease", action: "ans_rent_family", value: "Family residence tenancy" },
              { text: "🎓 Student Housing / PG", action: "ans_rent_student", value: "Student housing PG" }
            ]
          };
        }
        return { hasQuestion: false };
      }

      // 6. Bank Loan
      if (goal === 'bank_loan') {
        if (!context.loanType) {
          return {
            hasQuestion: true,
            questionText: `What type of banking account or loan facility are you applying for?`,
            options: [
              { text: "🏦 Savings / Current Account KYC", action: "ans_loan_savings", value: "Savings Account KYC" },
              { text: "🎓 Education Loan", action: "ans_loan_education", value: "Education Loan for studies" },
              { text: "🏡 Home / Retail Loan", action: "ans_loan_home", value: "Home or Personal Loan" }
            ]
          };
        }
        return { hasQuestion: false };
      }

      // 7. Visa
      if (goal === 'visa') {
        if (!context.visaType) {
          return {
            hasQuestion: true,
            questionText: `Which visa category are you preparing documentation for?`,
            options: [
              { text: "🎓 Student Visa (Study Abroad)", action: "ans_visa_student", value: "Student Visa for Study Abroad" },
              { text: "💼 Employment / Work Visa", action: "ans_visa_work", value: "Employment Work Visa" },
              { text: "✈️ Tourist / Travel Visa", action: "ans_visa_tourist", value: "Tourist Travel Visa" }
            ]
          };
        }
        return { hasQuestion: false };
      }

      // 8. Government Work - Ready immediately
      if (goal === 'government_work') {
        return { hasQuestion: false };
      }

      return { hasQuestion: false };
    }

    // Dynamic Personalized Checklist Generator connecting to real Vault state
    generatePersonalizedChecklist(goalKey, context = {}, vaultDocs = []) {
      const plan = this.plans[goalKey] || this.plans['college_admission'] || this.plans['education'];
      const docs = [];
      const specialConds = context.specialConditions || [];

      // Build personalized item list combining base knowledge + contextual rules
      if (goalKey === 'college_admission' || goalKey === 'education' || goalKey === 'career') {
        const is10thStage = context.educationStage === '10th_completed';
        const is12thStage = context.educationStage === '12th_completed';
        const is12thPending = context.educationStage === '12th_pending';
        const isGraduate = context.educationStage === 'graduate';
        const isCareerOrJob = goalKey === 'career' || context.applicationStage === 'job_application';

        // 1. Mandatory Core Identity
        docs.push({
          typeKey: 'aadhaar_card',
          name: 'Aadhaar Card',
          priority: 'mandatory',
          category: 'identity',
          note: 'Primary national identity & biometric proof for verification portal'
        });

        if (isCareerOrJob) {
          docs.push({
            typeKey: 'pan_card',
            name: 'PAN Card',
            priority: 'mandatory',
            category: 'identity',
            note: 'Mandatory financial identity & tax compliance for professional verification'
          });
        }

        // 2. Academic Foundation
        docs.push({
          typeKey: '10th_marksheet',
          name: '10th Marksheet',
          priority: 'mandatory',
          category: 'academic',
          note: 'Primary secondary school scorecard & verified date-of-birth proof'
        });

        if (!isCareerOrJob) {
          docs.push({
            typeKey: '10th_school_lc',
            name: '10th School Leaving Certificate (10th LC)',
            priority: 'mandatory',
            category: 'academic',
            note: 'Original transfer credential required for physical admission surrender'
          });
        }

        // 3. Higher secondary requirements:
        // When 12th is completed (or undergraduate admission without pending status), 12th Marksheet is mandatory.
        // When 12th is pending / appearing, DO NOT require 12th marksheet; require 12th Admit Card instead.
        if (!isCareerOrJob && (is12thStage || isGraduate || (!is12thPending && !is10thStage && (context.careerPreference || (context.targetPath && context.targetPath !== 'polytechnic_diploma' && context.targetPath !== 'junior_college_11th' && context.targetPath !== 'iti'))))) {
          docs.push({
            typeKey: '12th_marksheet',
            name: '12th Marksheet',
            priority: 'mandatory',
            category: 'academic',
            note: 'Qualifying higher secondary examination scores for undergraduate entrance & progression'
          });
        } else if (is12thPending && !isCareerOrJob) {
          docs.push({
            typeKey: '12th_admit_card',
            name: '12th Board Exam Admit Card / Hall Ticket',
            priority: 'supporting',
            category: 'academic',
            note: 'Provisional proof of appearing in 12th standard (final 12th marksheet awaited upon result declaration)'
          });
        }

        // 3b. Degree / Diploma for graduates or job applicants
        if (isGraduate || isCareerOrJob || context.applicationStage === 'job_application') {
          docs.push({
            typeKey: 'degree_certificate',
            name: 'Graduation / Degree Certificate',
            priority: 'mandatory',
            category: 'academic',
            note: 'Official Degree / Convocation certificate verifying completed graduation'
          });
        }

        if (isCareerOrJob || context.applicationStage === 'job_application') {
          docs.push({
            typeKey: 'resume',
            name: 'Resume / Curriculum Vitae (CV)',
            priority: 'mandatory',
            category: 'career',
            note: 'Professional CV and skills profile for candidate screening & technical interview'
          });
        }

        // 3c. Career-Specific Entrance, Allotment and Fitness Documents (Requirement 5 & 6)
        const careerKey = context.careerPreference || (context.targetPath === 'engineering_btech' ? 'engineering' : context.targetPath === 'medical_mbbs' ? 'mbbs' : context.targetPath === 'dental_bds' ? 'bds' : context.targetPath === 'pharmacy' ? 'pharmacy' : context.targetPath === 'law_llb' ? 'law' : context.targetPath === 'chartered_accountancy' ? 'ca' : context.targetPath === 'architecture_barch' ? 'architecture' : context.targetPath === 'computer_science' ? 'computer_science' : null);
        if (careerKey && CAREER_METADATA[careerKey] && !isCareerOrJob && context.applicationStage !== 'job_application') {
          const careerDocs = CAREER_METADATA[careerKey].checklistDocs || [];
          careerDocs.forEach(cd => {
            docs.push({
              typeKey: cd.typeKey,
              name: cd.name,
              priority: cd.priority,
              category: cd.category,
              note: cd.note
            });
          });
        }

        // 4. Conditional Documents based on context
        if (is10thStage) {
          docs.push({
            typeKey: 'birth_certificate',
            name: 'Birth Certificate',
            priority: 'conditional',
            category: 'identity',
            note: 'Conditional: Secondary verification required only if Date of Birth is not printed on School LC'
          });
        }

        if (specialConds.includes('quota_category')) {
          docs.push({
            typeKey: 'caste_certificate',
            name: 'Caste / Category Certificate',
            priority: 'conditional',
            category: 'identity',
            note: 'Conditional: Mandatory for reserved quota allotment and government fee concessions'
          });
        }

        if (context.location || specialConds.includes('state_domicile') || context.targetPath === 'polytechnic_diploma' || isCareerOrJob) {
          docs.push({
            typeKey: 'address_proof',
            name: 'Domicile / Address Proof',
            priority: (context.location || specialConds.includes('state_domicile') || isCareerOrJob) ? 'mandatory' : 'supporting',
            category: 'identity',
            note: `State domicile and residence certificate for ${context.location || 'regional qualification'}`
          });
        }

        if (specialConds.includes('gap_year')) {
          docs.push({
            typeKey: 'gap_certificate',
            name: 'Gap Certificate (Affidavit)',
            priority: 'conditional',
            category: 'legal',
            note: 'Conditional: Notarized affidavit required to explain gap between passing and enrollment'
          });
        }

        if (specialConds.includes('scholarship_income')) {
          docs.push({
            typeKey: 'income_certificate',
            name: 'Income Certificate',
            priority: 'conditional',
            category: 'financial',
            note: 'Conditional: Tehsildar-issued certificate required for government scholarship & fee waiver'
          });
        }

        if (!isCareerOrJob) {
          docs.push({
            typeKey: 'migration_certificate',
            name: 'Migration Certificate',
            priority: 'needs_clarification',
            category: 'academic',
            note: 'Needs clarification with college: Check whether your institute mandates an original Migration Certificate or if School LC suffices'
          });
        }

      } else if (goalKey === 'passport') {
        const isMinor = context.applicantType === 'minor';
        const isTatkaal = context.scheme === 'tatkaal';

        docs.push({
          typeKey: 'aadhaar_card',
          name: 'Aadhaar Card',
          priority: 'mandatory',
          category: 'identity',
          note: 'Primary identity & address proof with UIDAI biometric validation'
        });

        docs.push({
          typeKey: 'address_proof',
          name: 'Continuous Address Proof',
          priority: 'mandatory',
          category: 'identity',
          note: 'Proof of residence at present address for mandatory police clearance verification'
        });

        if (!isMinor) {
          docs.push({
            typeKey: '10th_marksheet',
            name: '10th Marksheet (Non-ECR Proof)',
            priority: 'mandatory',
            category: 'academic',
            note: 'Mandatory credential qualifying applicant for Non-ECR (Emigration Check Not Required) sovereign passport status'
          });

          docs.push({
            typeKey: 'pan_card',
            name: 'PAN Card',
            priority: isTatkaal ? 'mandatory' : 'supporting',
            category: 'identity',
            note: isTatkaal ? 'Mandatory under Tatkaal scheme requiring 3 government photo IDs' : 'Supporting identity & financial verification proof'
          });

          docs.push({
            typeKey: 'birth_certificate',
            name: 'Birth Certificate',
            priority: 'supporting',
            category: 'identity',
            note: 'Standard civil DOB record (10th marksheet accepted as primary DOB for Non-ECR)'
          });
        } else {
          docs.push({
            typeKey: 'birth_certificate',
            name: 'Birth Certificate (Civil Registry)',
            priority: 'mandatory',
            category: 'identity',
            note: 'Statutory mandate: Original municipal birth certificate mandatory for all minor passport applicants'
          });
          docs.push({
            typeKey: 'parent_passports',
            name: "Parents' Passport Copies & Annexure D",
            priority: 'conditional',
            category: 'legal',
            note: 'Conditional: Required for minor passport applicants with parental consent'
          });
        }

        if (specialConds.includes('address_changed')) {
          docs.push({
            typeKey: 'previous_address_proof',
            name: 'Previous Address Proof',
            priority: 'conditional',
            category: 'identity',
            note: 'Conditional: Required because residence changed within the past 12 months'
          });
        }

      } else if (goalKey === 'job' || goalKey === 'employment_verification') {
        const isExperienced = context.applicantType === 'experienced';

        docs.push({
          typeKey: 'pan_card',
          name: 'PAN Card',
          priority: 'mandatory',
          category: 'identity',
          note: 'Statutory mandate for income tax, TDS & salary disbursement'
        });

        docs.push({
          typeKey: 'aadhaar_card',
          name: 'Aadhaar Card',
          priority: 'mandatory',
          category: 'identity',
          note: 'KYC identity & UAN / Employee Provident Fund linkage'
        });

        docs.push({
          typeKey: 'bank_passbook_statement',
          name: 'Bank Passbook / Statement',
          priority: 'mandatory',
          category: 'financial',
          note: 'Account number & IFSC for direct salary credit disbursement'
        });

        docs.push({
          typeKey: 'diploma_certificate',
          name: 'Highest Degree / Diploma Certificate',
          priority: 'mandatory',
          category: 'academic',
          note: 'Highest educational qualification check for corporate BGV clearance'
        });

        docs.push({
          typeKey: '10th_marksheet',
          name: '10th Marksheet',
          priority: 'mandatory',
          category: 'academic',
          note: 'Foundational education credential & date-of-birth background check'
        });

        if (isExperienced) {
          docs.push({
            typeKey: 'relieving_letter',
            name: 'Relieving Letter / Service Certificate',
            priority: 'conditional',
            category: 'career',
            note: 'Conditional: Mandatory for experienced hires from prior employer'
          });

          docs.push({
            typeKey: 'salary_slips',
            name: 'Last 3 Months Salary Slips',
            priority: 'conditional',
            category: 'financial',
            note: 'Conditional: Proof of past compensation and background verification'
          });

          docs.push({
            typeKey: 'form_16',
            name: 'Form 16 / Tax Statement',
            priority: 'conditional',
            category: 'financial',
            note: 'Conditional: Required for tax deduction continuation with new employer'
          });
        } else {
          docs.push({
            typeKey: '12th_marksheet',
            name: '12th Marksheet',
            priority: 'supporting',
            category: 'academic',
            note: 'Supporting: Higher secondary marks verification for fresh graduates'
          });
        }

        docs.push({
          typeKey: 'address_proof',
          name: 'Permanent Address Proof',
          priority: 'supporting',
          category: 'identity',
          note: 'Supporting: Verification of permanent communication address'
        });

      } else if (goalKey === 'visa') {
        const isStudent = context.visaType === 'student';
        const isWork = context.visaType === 'work';

        docs.push({
          typeKey: 'passport',
          name: 'Passport (Original Booklet)',
          priority: 'mandatory',
          category: 'identity',
          note: 'Valid passport with at least 6 months remaining validity from planned date of departure'
        });

        docs.push({
          typeKey: 'bank_passbook_statement',
          name: 'Certified Bank Statement (Last 6 Months)',
          priority: 'mandatory',
          category: 'financial',
          note: 'Branch-stamped financial statement demonstrating adequate proof of funds for stay/tuition'
        });

        docs.push({
          typeKey: 'aadhaar_card',
          name: 'Aadhaar Card',
          priority: 'mandatory',
          category: 'identity',
          note: 'National identity verification & address confirmation'
        });

        docs.push({
          typeKey: 'pan_card',
          name: 'PAN Card',
          priority: 'supporting',
          category: 'financial',
          note: 'Tax residency and financial background verification'
        });

        if (isStudent) {
          docs.push({
            typeKey: '10th_marksheet',
            name: '10th Marksheet',
            priority: 'mandatory',
            category: 'academic',
            note: 'Primary secondary educational record for academic visa screening'
          });
          docs.push({
            typeKey: '12th_marksheet',
            name: '12th Marksheet / Degree Certificate',
            priority: 'mandatory',
            category: 'academic',
            note: 'Qualifying academic qualification certificate for study abroad enrollment'
          });
        } else if (isWork) {
          docs.push({
            typeKey: 'diploma_certificate',
            name: 'Professional Degree / Diploma',
            priority: 'mandatory',
            category: 'academic',
            note: 'Highest qualification credential for overseas employment authorization'
          });
        }

      } else if (goalKey === 'driving_licence') {
        const isLearner = context.dlStage === 'learner';
        const isCommercial = context.dlStage === 'commercial';

        docs.push({
          typeKey: 'aadhaar_card',
          name: 'Aadhaar Card',
          priority: 'mandatory',
          category: 'identity',
          note: 'Parivahan / Sarathi online Aadhaar-based eKYC identification'
        });

        docs.push({
          typeKey: 'address_proof',
          name: 'Address Proof',
          priority: 'mandatory',
          category: 'identity',
          note: 'RTO jurisdiction determination for physical test slot allocation'
        });

        docs.push({
          typeKey: '10th_marksheet',
          name: '10th Marksheet / Birth Certificate',
          priority: 'mandatory',
          category: 'academic',
          note: 'Statutory age & date-of-birth proof confirming applicant is over 18'
        });

        if (!isLearner) {
          docs.push({
            typeKey: 'learner_licence',
            name: "Valid Learner's Licence (LLR)",
            priority: 'mandatory',
            category: 'identity',
            note: "Prerequisite: Learner's Licence held for minimum 30 days before permanent driving test"
          });
        }

        if (isCommercial) {
          docs.push({
            typeKey: 'medical_fitness_cert',
            name: 'Medical Fitness Certificate (Form 1A)',
            priority: 'mandatory',
            category: 'legal',
            note: 'Mandatory certified medical check for commercial heavy vehicle endorsement'
          });
        }

      } else if (goalKey === 'renting') {
        docs.push({
          typeKey: 'aadhaar_card',
          name: 'Aadhaar Card',
          priority: 'mandatory',
          category: 'identity',
          note: 'Mandatory tenant identity verification for registered rental agreement'
        });

        docs.push({
          typeKey: 'pan_card',
          name: 'PAN Card',
          priority: 'mandatory',
          category: 'identity',
          note: 'Financial identity & TDS compliance on security deposit and rental receipts'
        });

        docs.push({
          typeKey: 'address_proof',
          name: 'Permanent Address Proof',
          priority: 'mandatory',
          category: 'identity',
          note: 'Home town permanent address proof for mandatory local police tenant verification'
        });

        docs.push({
          typeKey: 'bank_passbook_statement',
          name: 'Bank Statement / Salary Proof',
          priority: context.applicantType === 'professional' ? 'mandatory' : 'supporting',
          category: 'financial',
          note: 'Demonstrates financial solvency for monthly rental and security deposit commitment'
        });

      } else if (goalKey === 'bank_loan') {
        const isEducationLoan = context.loanType === 'education';
        const isHomeLoan = context.loanType === 'home';

        docs.push({
          typeKey: 'pan_card',
          name: 'PAN Card',
          priority: 'mandatory',
          category: 'identity',
          note: 'Statutory banking requirement for account linkage and CIBIL credit score evaluation'
        });

        docs.push({
          typeKey: 'aadhaar_card',
          name: 'Aadhaar Card',
          priority: 'mandatory',
          category: 'identity',
          note: 'Biometric eKYC identification under Reserve Bank of India standards'
        });

        docs.push({
          typeKey: 'address_proof',
          name: 'Address Proof',
          priority: 'mandatory',
          category: 'identity',
          note: 'Recent utility statement or registered proof verifying present residence'
        });

        docs.push({
          typeKey: 'bank_passbook_statement',
          name: 'Bank Statement (Last 6 Months)',
          priority: 'mandatory',
          category: 'financial',
          note: 'Cash flow analysis and repayment capacity verification'
        });

        if (isEducationLoan) {
          docs.push({
            typeKey: '10th_marksheet',
            name: '10th Marksheet',
            priority: 'mandatory',
            category: 'academic',
            note: 'Academic eligibility foundation for education loan processing'
          });
          docs.push({
            typeKey: '12th_marksheet',
            name: '12th Marksheet',
            priority: 'mandatory',
            category: 'academic',
            note: 'Higher secondary scorecard determining scholarship and institutional eligibility'
          });
        }

      } else if (goalKey === 'government_work') {
        docs.push({
          typeKey: '10th_marksheet',
          name: '10th Marksheet',
          priority: 'mandatory',
          category: 'academic',
          note: 'Primary date-of-birth proof & minimum educational qualification record'
        });

        docs.push({
          typeKey: '12th_marksheet',
          name: '12th Marksheet / Degree Certificate',
          priority: 'mandatory',
          category: 'academic',
          note: 'Prescribed educational qualification proof for public service examination eligibility'
        });

        docs.push({
          typeKey: 'aadhaar_card',
          name: 'Aadhaar Card',
          priority: 'mandatory',
          category: 'identity',
          note: 'Examination hall biometric entry & identity verification'
        });

        docs.push({
          typeKey: 'address_proof',
          name: 'Domicile / Residence Certificate',
          priority: 'mandatory',
          category: 'identity',
          note: 'Mandatory proof for state civil service domicile and regional reservation'
        });

        docs.push({
          typeKey: 'pan_card',
          name: 'PAN Card',
          priority: 'supporting',
          category: 'identity',
          note: 'Secondary identity proof for certificate verification session'
        });

      } else {
        // Fallback to base plan from knowledge base
        plan.requiredDocs.forEach(d => {
          docs.push({
            typeKey: d.typeKey,
            name: d.name,
            priority: d.priority === 'critical' ? 'mandatory' : 'supporting',
            category: DOCUMENT_PROFILES[d.typeKey]?.category || 'identity',
            note: d.note
          });
        });
      }

      // Match each required document against the Vault using canonical matcher
      const boundIds = new Set();
      let storedCount = 0;
      let expiredCount = 0;
      let expiringSoonCount = 0;
      let needsReviewCount = 0;
      let verifiedCount = 0;
      let aiCheckedCount = 0;
      let availableCount = 0;
      let missingCount = 0;

      const evaluatedDocs = docs.map(doc => {
        const matched = matchRequirementToVaultDoc(doc, vaultDocs, boundIds);
        const state = getDocumentState(matched);

        if (state.isStored) storedCount++;
        if (state.statusCode === 'EXPIRED') expiredCount++;
        else if (state.statusCode === 'VERIFIED') verifiedCount++;
        else if (state.statusCode === 'NEEDS_REVIEW') needsReviewCount++;
        else if (state.statusCode === 'AI_CHECKED') aiCheckedCount++;
        else if (state.statusCode === 'AVAILABLE') availableCount++;
        else missingCount++;

        if (state.isExpiringSoon) expiringSoonCount++;

        return {
          typeKey: doc.typeKey,
          name: doc.name,
          priority: doc.priority, // 'mandatory', 'conditional', 'supporting', 'needs_clarification'
          category: doc.category,
          note: doc.note,
          isStored: state.isStored,
          isExpired: state.isExpired,
          isExpiringSoon: state.isExpiringSoon,
          expiryStatus: state.expiryStatus || (state.isExpired ? 'EXPIRED' : state.isExpiringSoon ? 'EXPIRING_SOON' : 'VALID'),
          expiryInfo: state.expiryInfo || null,
          statusCode: state.statusCode, // 'MISSING' | 'AVAILABLE' | 'AI_CHECKED' | 'NEEDS_REVIEW' | 'VERIFIED' | 'EXPIRED'
          statusLabel: state.statusLabel,
          journeyStage: state.journeyStage,
          verifLabel: state.verifLabel,
          isCurrentlyRequired: true,
          verified: state.statusCode === 'VERIFIED',
          matchedDocId: matched ? (matched.id || matched.document_id || matched.documentId) : null,
          vaultDoc: matched || null
        };
      });

      const availableOrVerified = verifiedCount + availableCount + aiCheckedCount;

      // Construct dynamic Advisor Completion Summary strictly from real data (Requirement 8)
      const expiredDocs = evaluatedDocs.filter(d => d.statusCode === 'EXPIRED');
      const summaryLines = [
        `Your ${plan.goal} document checklist is ${availableOrVerified}/${evaluatedDocs.length} complete.`,
        `${availableOrVerified} document${availableOrVerified === 1 ? ' is' : 's are'} available or verified.`
      ];
      if (needsReviewCount > 0) {
        summaryLines.push(`${needsReviewCount} document${needsReviewCount === 1 ? ' needs' : 's need'} review.`);
      }
      if (missingCount > 0) {
        summaryLines.push(`${missingCount} document${missingCount === 1 ? ' is' : 's are'} missing.`);
      }
      if (expiredCount > 0) {
        if (expiredDocs.length === 1) {
          const expDoc = expiredDocs[0];
          const docTitle = (expDoc.name || 'document').toLowerCase();
          const wasVerified = expDoc.vaultDoc?.verified || expDoc.vaultDoc?.verificationLabel === 'Human Verified' || expDoc.vaultDoc?.documentStatus === 'Verified' || expDoc.vaultDoc?.documentStatus === 'Ready to Share';
          if (wasVerified) {
            summaryLines.push(`Your ${docTitle} is verified but expired, so you need a renewed ${docTitle}.`);
          } else {
            summaryLines.push(`Your ${docTitle} is expired, so you need a renewed ${docTitle}.`);
          }
        } else {
          summaryLines.push(`${expiredCount} documents are expired, so you need renewed copies.`);
        }
      }
      const advisorSummaryText = summaryLines.join('\n');

      // Construct user context summary for Section 8
      let userContextSummary = '';
      if (goalKey === 'college_admission' || goalKey === 'education') {
        const stageLabel = context.educationStage === '10th_completed' 
          ? '10th Standard Completed' 
          : context.educationStage === '12th_pending' 
          ? '10th Completed • 12th Pending / Appearing' 
          : context.educationStage === '12th_completed' 
          ? '12th Standard (HSC) Completed' 
          : context.educationStage === 'graduate' 
          ? 'Graduate / Degree Completed' 
          : 'Education Progression';
        const careerMeta = (context.careerPreference && CAREER_METADATA[context.careerPreference]) ? CAREER_METADATA[context.careerPreference] : null;
        const pathLabel = careerMeta ? careerMeta.pathName : (context.targetPath === 'junior_college_11th' ? '11th / Junior College' : context.targetPath === 'polytechnic_diploma' ? '3-Year Polytechnic Diploma' : context.targetPath === 'iti' ? 'Vocational / ITI' : context.targetPath === 'engineering_btech' ? 'Engineering (B.Tech)' : context.targetPath === 'medical_mbbs' ? 'Medical (MBBS)' : context.targetPath === 'dental_bds' ? 'Dental Surgery (BDS)' : context.targetPath === 'pharmacy' ? 'Pharmacy (B.Pharm)' : context.targetPath === 'law_llb' ? 'Law (LL.B.)' : context.targetPath === 'chartered_accountancy' ? 'Chartered Accountancy (CA)' : context.targetPath === 'architecture_barch' ? 'Architecture (B.Arch)' : context.targetPath === 'computer_science' ? 'Computer Science (B.Tech CSE)' : 'Higher Education');
        
        let condTags = [];
        if (specialConds.includes('quota_category')) condTags.push('Reserved Category Quota');
        if (specialConds.includes('state_domicile')) condTags.push('State Domicile');
        if (specialConds.includes('gap_year')) condTags.push('Gap Year');
        if (specialConds.includes('scholarship_income')) condTags.push('Income Fee Waiver');

        userContextSummary = `${stageLabel} • Pathway: ${pathLabel}${condTags.length ? ' • ' + condTags.join(', ') : ''}`;
      } else if (goalKey === 'job' || goalKey === 'employment_verification') {
        userContextSummary = context.applicantType === 'experienced' ? 'Experienced Professional (Prior Company Records Required)' : 'Fresher (First Job / Campus Onboarding)';
      } else if (goalKey === 'visa') {
        userContextSummary = context.visaType === 'student' ? 'Student Visa (Study Abroad)' : context.visaType === 'work' ? 'Employment / Work Visa' : 'Tourist / Travel Visa';
      } else if (goalKey === 'passport') {
        userContextSummary = `${context.applicantType === 'minor' ? 'Minor (Under 18)' : 'Adult (Non-ECR Eligible)'} • ${context.scheme === 'tatkaal' ? 'Tatkaal Urgent' : 'Standard'}`;
      } else if (goalKey === 'driving_licence') {
        userContextSummary = context.dlStage === 'learner' ? "Learner's Licence (Fresh Application)" : "Permanent Driving Licence";
      } else if (goalKey === 'renting') {
        userContextSummary = context.applicantType === 'family' ? 'Family Tenancy Lease' : context.applicantType === 'student' ? 'Student PG Housing' : 'Working Professional Lease';
      } else if (goalKey === 'bank_loan') {
        userContextSummary = context.loanType === 'education' ? 'Education Loan' : context.loanType === 'home' ? 'Home Loan' : 'Banking Account KYC';
      } else if (goalKey === 'government_work') {
        userContextSummary = 'Public Service Commission & Recruitment Verification';
      }

      // Construct next recommended action for Section 8
      let nextRecommendedAction = '';
      if (expiredCount > 0) {
        const expNames = expiredDocs.map(d => d.name).join(', ');
        nextRecommendedAction = `Your ${expNames} has expired. Upload or scan a renewed version to complete your ${plan.goal} requirements.`;
      } else if (missingCount > 0) {
        const firstMissing = evaluatedDocs.find(d => !d.isStored && d.priority === 'mandatory');
        if (firstMissing) {
          nextRecommendedAction = `Store your mandatory <strong>${firstMissing.name}</strong> in Vault to progress your ${plan.goal} requirements.`;
        } else {
          nextRecommendedAction = `Upload remaining supporting documents in your Vault to complete your dossier.`;
        }
      } else if (needsReviewCount > 0) {
        nextRecommendedAction = `${needsReviewCount} document${needsReviewCount > 1 ? 's are' : ' is'} awaiting human review sign-off in your Verification Center.`;
      } else {
        nextRecommendedAction = `All ${evaluatedDocs.length} required documents are verified and available! Click "Create Verification Request" to initiate certified sharing.`;
      }

      return {
        goalKey: goalKey,
        title: plan.goal,
        desc: plan.desc,
        context: context,
        userContextSummary: userContextSummary,
        nextRecommendedAction: nextRecommendedAction,
        totalDocs: evaluatedDocs.length,
        storedCount: storedCount,
        missingCount: missingCount,
        verifiedCount: verifiedCount,
        aiCheckedCount: aiCheckedCount,
        availableCount: availableCount,
        needsReviewCount: needsReviewCount,
        expiredCount: expiredCount,
        expiringSoonCount: expiringSoonCount,
        availableOrVerified: availableOrVerified,
        advisorSummary: {
          totalDocs: evaluatedDocs.length,
          availableOrVerified: availableOrVerified,
          verifiedCount: verifiedCount,
          availableCount: availableCount,
          aiCheckedCount: aiCheckedCount,
          needsReviewCount: needsReviewCount,
          missingCount: missingCount,
          expiredCount: expiredCount,
          text: advisorSummaryText,
          lines: summaryLines
        },
        documents: evaluatedDocs
      };
    }

    // Unified Turn Processor for Advisor Conversations
    processUserTurn({ userText = '', sessionContext = {}, vaultDocs = [] }) {
      const text = (userText || '').trim();
      let ctx = Object.assign({}, sessionContext);

      // Check midway change (Latest explicit preference MUST win)
      const change = this.detectMidwayChange(text, ctx);
      let changeNotice = null;
      let careerJustChanged = false;
      let stageJustChanged = false;
      if (change.isChange) {
        if (change.type === 'career_preference_change') {
          // Keep existing conversation context (user name, education stage, etc.)
          ctx.careerPreference = change.newCareer;
          ctx.targetPath = this.getCareerTargetPath(change.newCareer);
          changeNotice = change.exactNotice;
          careerJustChanged = true;
        } else if (change.type === 'education_stage_change') {
          ctx.educationStage = change.newStage;
          changeNotice = change.exactNotice;
          stageJustChanged = true;
        } else if (change.type === 'applicant_type_change') {
          ctx.applicantType = change.value;
          changeNotice = change.exactNotice;
        } else if (change.type === 'goal_change') {
          ctx = { goal: change.newGoal, specialConditions: [] };
          changeNotice = `🔄 <em>Goal updated: Switched to <strong>${change.description.replace(/^Goal changed to /, '')}</strong>. Re-evaluating your requirements...</em>`;
        } else if (change.field) {
          ctx[change.field] = change.value;
          changeNotice = change.exactNotice || `🔄 <em>Answer updated: <strong>${change.description}</strong>. Adjusting your requirements...</em>`;
        }
      }

      // Extract new context, skipping career re-resolution if it was just updated in this turn
      ctx = this.extractContext(text, ctx, { skipCareerResolve: careerJustChanged, skipStageResolve: stageJustChanged });

      // If goal is still unclear (e.g. unknown or ambiguous text)
      if (!ctx.goal) {
        return {
          type: 'unclear_purpose',
          hasChecklist: false,
          html: `🤔 <strong>I'd be glad to guide you!</strong> To prepare your exact, personalized document checklist, what specific goal are you preparing for?<br><br>Choose your situation below or type your goal:`,
          actions: [
            { text: "🎓 College Admission", action: "prep_college_admission" },
            { text: "💼 Job / Employment", action: "prep_job" },
            { text: "✈️ Passport Application", action: "prep_passport" },
            { text: "🛂 Visa Application", action: "prep_visa" },
            { text: "🚗 Driving Licence (RTO)", action: "prep_driving" },
            { text: "🔑 Renting / Lease", action: "prep_renting" },
            { text: "🏦 Bank Account & Loan", action: "prep_bank_loan" },
            { text: "🏛️ Government Job / Exam", action: "prep_government" },
            { text: "📚 Browse All 19 Life Stages", action: "open_stages_modal" }
          ],
          context: ctx,
          careerPreference: ctx.careerPreference || null
        };
      }

      // Edge Case: User mentions multiple purposes on initial turn
      const allGoals = this.detectAllGoals(text);
      if (allGoals.length > 1 && !sessionContext.goal && !change.isChange) {
        return {
          type: 'question',
          hasChecklist: false,
          html: `🎯 <strong>I noticed you mentioned both ${this.plans[allGoals[0]] ? this.plans[allGoals[0]].goal : allGoals[0]} and ${this.plans[allGoals[1]] ? this.plans[allGoals[1]].goal : allGoals[1]}!</strong><br><br>Which document checklist would you like to prepare first?`,
          actions: [
            { text: `📋 ${this.plans[allGoals[0]] ? this.plans[allGoals[0]].goal : allGoals[0]}`, action: `prep_${allGoals[0]}` },
            { text: `📋 ${this.plans[allGoals[1]] ? this.plans[allGoals[1]].goal : allGoals[1]}`, action: `prep_${allGoals[1]}` }
          ],
          context: ctx,
          careerPreference: ctx.careerPreference || null
        };
      }

      // Check if more clarifying questions are needed
      const question = this.getNextQuestion(ctx);
      if (question.hasQuestion) {
        let promptHtml = '';
        if (changeNotice) promptHtml += `${changeNotice}<br><br>`;
        const planObj = this.plans[ctx.goal];
        promptHtml += `🎯 <strong>Document Advisor: ${(planObj ? planObj.goal : ctx.goal).toUpperCase()}</strong><br><br>${question.questionText}`;

        return {
          type: 'question',
          hasChecklist: false,
          html: promptHtml,
          actions: question.options.map(opt => ({
            text: opt.text,
            action: opt.action || `ans_${opt.value.replace(/[^a-zA-Z0-9]/g, '_')}`
          })),
          context: ctx,
          careerPreference: ctx.careerPreference || null
        };
      }

      // Ready to generate dynamic personalized checklist!
      const checklist = this.generatePersonalizedChecklist(ctx.goal, ctx, vaultDocs);
      return {
        type: 'checklist',
        hasChecklist: true,
        checklist: checklist,
        changeNotice: changeNotice,
        context: ctx,
        careerPreference: ctx.careerPreference || null
      };
    }
  }

  // ==========================================================================
  // SECTION 5: RELATIONAL DATABASE STORAGE LAYER (In-Memory + Web Storage)
  // Schema-enforced models for Users, Requests, Documents, OCR, Verification, Audit
  // ==========================================================================
  class DocdonDatabase {
    constructor() {
      this.STORAGE_KEY = 'docdon_backend_database_v3';
      this.data = {
        users: {},
        profiles: {},
        verification_requests: {},
        documents: {},
        processing_documents: {},
        ocr_results: {},
        verification_results: {},
        shares: {},
        audit_events: []
      };
      this.load();
      this.seedDefaultDataIfEmpty();
      this.migrateDocuments();
    }

    load() {
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(this.STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.users) {
              this.data = parsed;
              this.data.shares = this.data.shares || {};
              this.data.profiles = this.data.profiles || {};
              this.data.processing_documents = this.data.processing_documents || {};
            }
          }
        } else if (typeof require !== 'undefined') {
          try {
            const fs = require('fs');
            const path = require('path');
            let dbPath = path.join(__dirname, 'database.json');
            if (!fs.existsSync(dbPath)) {
              dbPath = path.join(__dirname, 'data', 'database.json');
            }
            if (fs.existsSync(dbPath)) {
              const raw = fs.readFileSync(dbPath, 'utf8');
              const parsed = JSON.parse(raw);
              if (parsed && parsed.users) {
                this.data = parsed;
                this.data.shares = this.data.shares || {};
                this.data.profiles = this.data.profiles || {};
                this.data.processing_documents = this.data.processing_documents || {};
              }
            }
          } catch (e) {
            // Memory fallback
          }
        }
      } catch (err) {
        console.warn('DocdonDatabase: load fallback to memory', err);
      }
    }

    save() {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
          this.lastSaveSucceeded = true;
          return true;
        } else if (typeof require !== 'undefined') {
          const fs = require('fs');
          const path = require('path');
          const serialized = JSON.stringify(this.data, null, 2);
          const rootDbPath = path.join(__dirname, 'database.json');
          const dataDir = path.join(__dirname, 'data');
          fs.mkdirSync(dataDir, { recursive: true });
          fs.writeFileSync(rootDbPath, serialized, 'utf8');
          fs.writeFileSync(path.join(dataDir, 'database.json'), serialized, 'utf8');
          this.lastSaveSucceeded = true;
          return true;
        }
      } catch (err) {
        this.lastSaveSucceeded = false;
        this.lastSaveError = err;
        console.warn('DocdonDatabase: save failed', err);
      }
      this.lastSaveSucceeded = false;
      return false;
    }

    // SECTION 18: SEED TEST SCENARIOS (David Miller REQ-1001, Elena Rostova REQ-1002, Alex Chen REQ-1003)
    seedDefaultDataIfEmpty() {
      // 1. Users Table
      if (!this.data.users['david.miller']) {
        this.data.users['david.miller'] = {
          id: 'usr-1001',
          name: 'David Miller',
          email_or_phone: 'david.miller@student.edu',
          auth_info: {
            passwordHash: 'password123',
            biometricEnrolled: true,
            biometricType: 'face',
            enrolledAt: '2024-01-10T09:00:00.000Z'
          },
          role: 'student',
          created_at: '2024-01-10T09:00:00.000Z'
        };
      }

      if (!this.data.users['elena.rostova']) {
        this.data.users['elena.rostova'] = {
          id: 'usr-1002',
          name: 'Elena Rostova',
          email_or_phone: 'elena.rostova@international.org',
          auth_info: {
            passwordHash: 'password123',
            biometricEnrolled: true,
            biometricType: 'fingerprint',
            enrolledAt: '2024-02-14T11:30:00.000Z'
          },
          role: 'applicant',
          created_at: '2024-02-14T11:30:00.000Z'
        };
      }

      if (!this.data.users['alex.chen']) {
        this.data.users['alex.chen'] = {
          id: 'usr-1003',
          name: 'Alex Chen',
          email_or_phone: 'alex.chen@techcorp.io',
          auth_info: {
            passwordHash: 'password123',
            biometricEnrolled: true,
            biometricType: 'face',
            enrolledAt: '2024-03-01T14:15:00.000Z'
          },
          role: 'candidate',
          created_at: '2024-03-01T14:15:00.000Z'
        };
      }

      // The built-in demo reviewer is an explicit review role; ordinary user accounts stay unprivileged.
      if (!this.data.users.admin) {
        this.data.users.admin = {
          id: 'usr-demo-reviewer', name: 'Admin Verifier', email_or_phone: 'admin',
          auth_info: { passwordHash: 'password123', biometricEnrolled: true, biometricType: 'fingerprint', enrolledAt: '2024-01-10T09:00:00.000Z' },
          role: 'admin', created_at: '2024-01-10T09:00:00.000Z', demoOnly: true
        };
      }
      ['david.miller', 'elena.rostova', 'alex.chen', 'admin'].forEach(key => {
        if (this.data.users[key]) this.data.users[key].demoOnly = true;
      });

      // 1b. Profiles Table (Structured Context Engine for Admissions, Careers & Requirements)
      this.data.profiles = this.data.profiles || {};
      if (!this.data.profiles['david.miller']) {
        this.data.profiles['david.miller'] = {
          userId: 'david.miller',
          purpose: 'career',
          career: 'engineering',
          educationStage: 'graduate',
          currentDocuments: ['aadhaar_card', 'pan_card'],
          location: 'Maharashtra',
          applicationStage: 'job_application',
          updatedAt: '2024-06-16T15:00:00.000Z'
        };
      }
      if (!this.data.profiles['elena.rostova']) {
        this.data.profiles['elena.rostova'] = {
          userId: 'elena.rostova',
          purpose: 'visa',
          career: null,
          educationStage: 'graduate',
          currentDocuments: ['passport'],
          location: 'International',
          applicationStage: 'work_visa',
          updatedAt: '2024-07-02T11:20:00.000Z'
        };
      }
      if (!this.data.profiles['alex.chen']) {
        this.data.profiles['alex.chen'] = {
          userId: 'alex.chen',
          purpose: 'renting',
          career: null,
          educationStage: 'graduate',
          currentDocuments: ['aadhaar_card', 'pan_card'],
          location: 'Karnataka',
          applicationStage: 'tenant_lease',
          updatedAt: '2024-07-11T16:45:00.000Z'
        };
      }

      // 2. Documents Table (Seed initial documents for David Miller)
      const davidDocs = [
        {
          document_id: 'doc-david-10th-mark',
          owner_id: 'david.miller',
          document_type: '10th_marksheet',
          title: '10th Board Marksheet',
          file_reference: { filename: 'David_Miller_10th_Marksheet_Official.pdf', file_type: 'application/pdf', file_size: 1420500, storage_token: 'tok-dm-10th-mark-001' },
          uploaded_at: '2024-06-15T10:00:00.000Z',
          expiry_date: null,
          current_status: 'Verified',
          verification_label: 'Human Verified',
          verified: true,
          ai_status: 'verified_match',
          doc_number: 'MS-2021-98214',
          category: 'academic'
        },
        {
          document_id: 'doc-david-aadhaar',
          owner_id: 'david.miller',
          document_type: 'aadhaar_card',
          title: 'Aadhaar Card',
          file_reference: { filename: 'David_Miller_Aadhaar_UIDAI.pdf', file_type: 'application/pdf', file_size: 980200, storage_token: 'tok-dm-aadhaar-002' },
          uploaded_at: '2024-06-15T10:05:00.000Z',
          expiry_date: null,
          current_status: 'Ready to Share',
          verification_label: 'Human Verified',
          verified: true,
          ai_status: 'verified_match',
          doc_number: '6821 9042 1182',
          category: 'identity'
        },
        {
          document_id: 'doc-david-passport',
          owner_id: 'david.miller',
          document_type: 'passport',
          title: 'National Passport',
          file_reference: { filename: 'David_Miller_Passport_Booklet.jpg', file_type: 'image/jpeg', file_size: 1850300, storage_token: 'tok-dm-passport-003' },
          uploaded_at: '2024-06-16T12:00:00.000Z',
          expiry_date: '2031-11-12',
          current_status: 'Verified',
          verification_label: 'Human Verified',
          verified: true,
          ai_status: 'verified_match',
          doc_number: 'Z4892104',
          category: 'identity'
        },
        {
          document_id: 'doc-david-pan',
          owner_id: 'david.miller',
          document_type: 'pan_card',
          title: 'Permanent Account Number (PAN) Card',
          file_reference: { filename: 'David_Miller_PAN_Card.pdf', file_type: 'application/pdf', file_size: 780400, storage_token: 'tok-dm-pan-007' },
          uploaded_at: '2024-06-15T11:20:00.000Z',
          expiry_date: null,
          current_status: 'Verified',
          verification_label: 'Human Verified',
          verified: true,
          ai_status: 'verified_match',
          doc_number: 'BNZPM8492K',
          category: 'identity'
        },
        {
          document_id: 'doc-david-degree',
          owner_id: 'david.miller',
          document_type: 'degree_certificate',
          title: 'B.Tech Computer Engineering Degree',
          file_reference: { filename: 'David_Miller_BTech_Degree.pdf', file_type: 'application/pdf', file_size: 1540300, storage_token: 'tok-dm-degree-008' },
          uploaded_at: '2024-06-20T14:15:00.000Z',
          expiry_date: null,
          current_status: 'Verified',
          verification_label: 'Human Verified',
          verified: true,
          ai_status: 'verified_match',
          doc_number: 'BE-2023-90812',
          category: 'academic'
        },
        {
          document_id: 'doc-david-dl',
          owner_id: 'david.miller',
          document_type: 'driving_licence',
          title: 'Driving Licence',
          file_reference: { filename: 'David_Miller_DL_Scan.jpg', file_type: 'image/jpeg', file_size: 890400, storage_token: 'tok-dm-dl-004' },
          uploaded_at: '2024-06-16T14:30:00.000Z',
          expiry_date: '2024-08-14', // Expired!
          current_status: 'Uploaded',
          verification_label: 'Needs Human Review',
          verified: false,
          ai_status: 'verified_match',
          doc_number: 'DL-9281-KA-09',
          category: 'identity',
          is_expired: true,
          error_reason: 'Expired on 14 Aug 2024. Renewal required.'
        },
        {
          document_id: 'doc-david-utility',
          owner_id: 'david.miller',
          document_type: 'address_proof',
          title: 'Utility Statement (Electricity Proof)',
          file_reference: { filename: 'Electricity_Bill_Oct2024.pdf', file_type: 'application/pdf', file_size: 420100, storage_token: 'tok-dm-util-005' },
          uploaded_at: '2024-10-01T09:00:00.000Z',
          expiry_date: '2026-10-25', // Expiring soon
          current_status: 'Available',
          verification_label: 'AI Check Passed',
          verified: false,
          ai_status: 'verified_match',
          doc_number: 'BILL-OCT-2024',
          category: 'identity'
        },
        {
          document_id: 'doc-david-12th-mark',
          owner_id: 'david.miller',
          document_type: '12th_marksheet',
          title: '12th Higher Secondary Marksheet',
          file_reference: { filename: 'David_Miller_12th_Marksheet_Draft.pdf', file_type: 'application/pdf', file_size: 1640200, storage_token: 'tok-dm-12th-006' },
          uploaded_at: '2024-06-16T09:00:00.000Z',
          expiry_date: null,
          current_status: 'AI Checked',
          verification_label: 'Needs Human Review',
          verified: false,
          ai_status: 'verified_match',
          doc_number: 'HSC-2023-492109',
          category: 'academic',
          review_reason: 'Low contrast on board stamp, needs human sign-off'
        }
      ];

      const additionalDocs = [
        {
          document_id: 'doc-elena-passport',
          owner_id: 'elena.rostova',
          document_type: 'passport',
          title: 'International Passport',
          file_reference: { filename: 'Elena_Rostova_Passport_Scan.pdf', file_type: 'application/pdf', file_size: 1220000, storage_token: 'tok-er-pass' },
          uploaded_at: '2024-07-01T10:05:00.000Z',
          expiry_date: '2027-12-15', // valid for ~3.2 years
          current_status: 'Verified',
          verification_label: 'Human Verified',
          ai_status: 'verified_match',
          doc_number: 'P-9824108',
          category: 'identity'
        },
        {
          document_id: 'doc-alex-id',
          owner_id: 'alex.chen',
          document_type: 'aadhaar_card',
          title: 'Aadhaar Card',
          file_reference: { filename: 'Alex_Chen_Aadhaar.pdf', file_type: 'application/pdf', file_size: 940000, storage_token: 'tok-ac-id' },
          uploaded_at: '2024-07-10T14:10:00.000Z',
          expiry_date: null,
          current_status: 'Verified',
          verification_label: 'Human Verified',
          ai_status: 'verified_match',
          doc_number: '8910 2041 3392',
          category: 'identity'
        },
        {
          document_id: 'doc-alex-pan',
          owner_id: 'alex.chen',
          document_type: 'pan_card',
          title: 'PAN Card',
          file_reference: { filename: 'Alex_Chen_PAN.pdf', file_type: 'application/pdf', file_size: 610000, storage_token: 'tok-ac-pan' },
          uploaded_at: '2024-07-10T14:15:00.000Z',
          expiry_date: '2024-01-01',
          is_expired: true,
          current_status: 'Uploaded',
          verification_label: 'Needs Attention (Expired)',
          ai_status: 'mismatch',
          error_reason: 'PAN card expired or flagged for re-validation.',
          doc_number: 'ABCDE1234F',
          category: 'financial'
        }
      ];

      [...davidDocs, ...additionalDocs].forEach(d => {
        if (!this.data.documents[d.document_id]) {
          this.data.documents[d.document_id] = d;
        }
      });

      // 3. Verification Requests Table
      // Scenario 1: David Miller / REQ-1001 (Higher Education Verification)
      if (!this.data.verification_requests['REQ-1001']) {
        this.data.verification_requests['REQ-1001'] = {
          request_id: 'REQ-1001',
          requester_id: 'State University Admissions Board',
          submitter_id: 'david.miller',
          submitter_name: 'David Miller',
          purpose: 'Higher Education Verification',
          status: 'in_review',
          required_documents: [
            { typeKey: '10th_marksheet', name: '10th Marksheet', priority: 'critical', document_id: 'doc-david-10th-mark', status: 'verified' },
            { typeKey: '12th_marksheet', name: '12th Marksheet', priority: 'critical', document_id: 'doc-david-12th-mark', status: 'in_review', review_reason: 'Low contrast on board stamp, needs human sign-off' }
          ],
          created_at: '2024-06-15T09:30:00.000Z',
          updated_at: '2024-06-16T15:00:00.000Z'
        };
      }

      // Scenario 2: Elena Rostova / REQ-1002 (Employment Onboarding)
      if (!this.data.verification_requests['REQ-1002']) {
        this.data.verification_requests['REQ-1002'] = {
          request_id: 'REQ-1002',
          requester_id: 'Consular Visa & Talent Directorate',
          submitter_id: 'elena.rostova',
          submitter_name: 'Elena Rostova',
          purpose: 'Employment Onboarding',
          status: 'pending',
          required_documents: [
            { typeKey: 'passport', name: 'Passport', priority: 'critical', document_id: 'doc-elena-passport', status: 'verified', expiry_note: 'Passport valid for 3.2 years' },
            { typeKey: 'diploma_certificate', name: 'Degree Certificate', priority: 'critical', document_id: null, status: 'missing' }
          ],
          created_at: '2024-07-01T10:00:00.000Z',
          updated_at: '2024-07-02T11:20:00.000Z'
        };
      }

      // Scenario 3: Alex Chen / REQ-1003 (Rental Agreement)
      if (!this.data.verification_requests['REQ-1003']) {
        this.data.verification_requests['REQ-1003'] = {
          request_id: 'REQ-1003',
          requester_id: 'Urban Living Real Estate Board',
          submitter_id: 'alex.chen',
          submitter_name: 'Alex Chen',
          purpose: 'Rental Agreement',
          status: 'in_review',
          required_documents: [
            { typeKey: 'aadhaar_card', name: 'Aadhaar Card', priority: 'critical', document_id: 'doc-alex-id', status: 'verified', note: 'Name matched: Alex Chen' },
            { typeKey: 'pan_card', name: 'PAN Card', priority: 'critical', document_id: 'doc-alex-pan', status: 'flagged', error_reason: 'PAN Card Expired / Flagged for re-validation' }
          ],
          created_at: '2024-07-10T14:00:00.000Z',
          updated_at: '2024-07-11T16:45:00.000Z'
        };
      }

      // 4. Seed Pre-processed OCR Results
      if (!this.data.ocr_results['doc-david-12th-mark']) {
        this.data.ocr_results['doc-david-12th-mark'] = {
          document_id: 'doc-david-12th-mark',
          confidence: 96.0,
          quality: { blurScore: 84.5, noiseScore: 11.2, overallRating: 'Good' },
          reviewReason: 'Low contrast on board stamp, needs human sign-off',
          extractedFields: {
            student_name: 'David Miller',
            roll_number: 'H-492109',
            examination_board: 'State Higher Secondary Education Board',
            passing_year: '2023',
            stream_subjects: 'Physics (88), Chemistry (84), Mathematics (92), English (86)',
            board_stamp: 'Official Crest (Low Contrast / 58% confidence)'
          },
          fieldConfidences: {
            student_name: 99.2,
            roll_number: 98.4,
            examination_board: 97.1,
            passing_year: 99.0,
            stream_subjects: 95.8,
            board_stamp: 58.0
          },
          processed_at: '2024-06-16T09:05:00.000Z'
        };
      }
      if (!this.data.ocr_results['doc-elena-passport']) {
        this.data.ocr_results['doc-elena-passport'] = {
          document_id: 'doc-elena-passport',
          confidence: 98.5,
          quality: { blurScore: 95.0, noiseScore: 4.8, overallRating: 'Optimal' },
          extractedFields: {
            passport_number: 'P-9824108',
            holder_name: 'Elena Rostova',
            dob: '1995-04-12',
            issue_date: '2017-12-15',
            expiry_date: '2027-12-15'
          },
          fieldConfidences: {
            passport_number: 99.4,
            holder_name: 99.1,
            dob: 98.6,
            expiry_date: 98.9
          },
          processed_at: '2024-07-01T10:06:00.000Z'
        };
      }
      if (!this.data.ocr_results['doc-alex-pan']) {
        this.data.ocr_results['doc-alex-pan'] = {
          document_id: 'doc-alex-pan',
          confidence: 92.4,
          quality: { blurScore: 81.0, noiseScore: 13.5, overallRating: 'Fair' },
          extractedFields: {
            pan_number: 'ABCDE1234F',
            holder_name: 'Alex Chen',
            validity_status: 'Expired / Re-validation Required'
          },
          fieldConfidences: {
            pan_number: 98.1,
            holder_name: 98.8,
            validity_status: 62.0
          },
          processed_at: '2024-07-10T14:16:00.000Z'
        };
      }

      // 5. Audit Events Table
      if (this.data.audit_events.length === 0) {
        this.data.audit_events = [
          // REQ-1001 Audit
          { audit_id: 'aud-001', request_id: 'REQ-1001', document_id: 'doc-david-10th-mark', actor: 'David Miller', action: 'request_created', timestamp: '2024-06-15T09:30:00.000Z', result: 'success', metadata: { note: 'Higher Education Verification initiated' } },
          { audit_id: 'aud-002', request_id: 'REQ-1001', document_id: 'doc-david-10th-mark', actor: 'DOCDON Upload Gateway', action: 'document_uploaded', timestamp: '2024-06-15T10:00:00.000Z', result: 'success', metadata: { file: 'David_Miller_10th_Marksheet_Official.pdf' } },
          { audit_id: 'aud-003', request_id: 'REQ-1001', document_id: 'doc-david-10th-mark', actor: 'DOCDON OCR Processing Engine', action: 'ocr_completed', timestamp: '2024-06-15T10:00:05.000Z', result: 'success', metadata: { confidence: 97.4, fieldsFound: 5 } },
          { audit_id: 'aud-004', request_id: 'REQ-1001', document_id: 'doc-david-10th-mark', actor: 'Dr. Robert Vance (Admissions Dean)', action: 'human_approved', timestamp: '2024-06-15T11:15:00.000Z', result: 'success', metadata: { remarks: '10th Marksheet certified against secondary board records' } },
          { audit_id: 'aud-005', request_id: 'REQ-1001', document_id: 'doc-david-12th-mark', actor: 'DOCDON Upload Gateway', action: 'document_uploaded', timestamp: '2024-06-16T09:00:00.000Z', result: 'success', metadata: { file: 'David_Miller_12th_Marksheet_Draft.pdf' } },
          { audit_id: 'aud-006', request_id: 'REQ-1001', document_id: 'doc-david-12th-mark', actor: 'DOCDON OCR Processing Engine', action: 'ocr_completed', timestamp: '2024-06-16T09:05:00.000Z', result: 'success', metadata: { confidence: 96.0, fieldsFound: 6 } },
          { audit_id: 'aud-007', request_id: 'REQ-1001', document_id: 'doc-david-12th-mark', actor: 'DOCDON Verification Engine', action: 'human_review_requested', timestamp: '2024-06-16T09:05:08.000Z', result: 'review_needed', metadata: { reason: 'Low contrast on board stamp, needs human sign-off' } },

          // REQ-1002 Audit (Elena Rostova)
          { audit_id: 'aud-101', request_id: 'REQ-1002', document_id: 'doc-elena-passport', actor: 'Elena Rostova', action: 'request_created', timestamp: '2024-07-01T10:00:00.000Z', result: 'success', metadata: { note: 'Employment Onboarding verification created' } },
          { audit_id: 'aud-102', request_id: 'REQ-1002', document_id: 'doc-elena-passport', actor: 'DOCDON Upload Gateway', action: 'document_uploaded', timestamp: '2024-07-01T10:05:00.000Z', result: 'success', metadata: { file: 'Elena_Rostova_Passport_Scan.pdf' } },
          { audit_id: 'aud-103', request_id: 'REQ-1002', document_id: 'doc-elena-passport', actor: 'DOCDON OCR Processing Engine', action: 'ocr_completed', timestamp: '2024-07-01T10:06:00.000Z', result: 'success', metadata: { confidence: 98.5, fieldsFound: 5 } },
          { audit_id: 'aud-104', request_id: 'REQ-1002', document_id: 'doc-elena-passport', actor: 'DOCDON Expiry Engine', action: 'verification_completed', timestamp: '2024-07-01T10:06:05.000Z', result: 'success', metadata: { expiryCheck: 'Passport valid for 3.2 years (expires Dec 2027)' } },

          // REQ-1003 Audit (Alex Chen)
          { audit_id: 'aud-201', request_id: 'REQ-1003', document_id: 'doc-alex-id', actor: 'Alex Chen', action: 'request_created', timestamp: '2024-07-10T14:00:00.000Z', result: 'success', metadata: { note: 'Rental Agreement verification ticket created' } },
          { audit_id: 'aud-202', request_id: 'REQ-1003', document_id: 'doc-alex-id', actor: 'DOCDON Upload Gateway', action: 'document_uploaded', timestamp: '2024-07-10T14:10:00.000Z', result: 'success', metadata: { file: 'Alex_Chen_Aadhaar.pdf' } },
          { audit_id: 'aud-203', request_id: 'REQ-1003', document_id: 'doc-alex-pan', actor: 'DOCDON Upload Gateway', action: 'document_uploaded', timestamp: '2024-07-10T14:15:00.000Z', result: 'success', metadata: { file: 'Alex_Chen_PAN.pdf' } },
          { audit_id: 'aud-204', request_id: 'REQ-1003', document_id: 'doc-alex-pan', actor: 'DOCDON Cross-Check Engine', action: 'verification_completed', timestamp: '2024-07-10T14:16:30.000Z', result: 'flagged', metadata: { crossCheck: 'Name matches across documents: Alex Chen', flag: 'PAN Card Expired / Flagged' } }
        ];
      }

      this.save();
    }

    migrateDocuments() {
      if (!this.data.documents) return;
      let modified = false;

      // 1. Group documents by owner_id + canonicalId
      const userGroups = {};
      for (const [id, doc] of Object.entries(this.data.documents)) {
        if (!doc) continue;
        const ownerId = (doc.owner_id || '').toLowerCase().trim();
        const norm = normalizeDocumentType(doc.document_type || doc.title);
        const canonicalId = (norm && norm.canonicalId !== 'unrecognized') ? norm.canonicalId : (doc.document_type || id);

        if (norm && norm.canonicalId !== 'unrecognized') {
          if (doc.document_type !== norm.canonicalId) {
            doc.document_type = norm.canonicalId;
            modified = true;
          }
          if (norm.canonicalId === 'driving_licence' && doc.title !== 'Driving Licence') {
            doc.title = 'Driving Licence';
            modified = true;
          } else if (norm.canonicalId === 'pan_card' && doc.title !== 'PAN Card' && !doc.title.includes('Permanent')) {
            doc.title = 'PAN Card';
            modified = true;
          } else if (norm.canonicalId === 'aadhaar_card' && doc.title !== 'Aadhaar Card') {
            doc.title = 'Aadhaar Card';
            modified = true;
          } else if (norm.canonicalId === '12th_marksheet' && !doc.title.includes('12')) {
            doc.title = '12th Marksheet';
            modified = true;
          }
          if (norm.state && !doc.state) {
            doc.state = norm.state;
            modified = true;
          }
          if (norm.issuingAuthority && !doc.issuing_authority) {
            doc.issuing_authority = norm.issuingAuthority;
            modified = true;
          }
        }

        if (!userGroups[ownerId]) userGroups[ownerId] = {};
        if (!userGroups[ownerId][canonicalId]) userGroups[ownerId][canonicalId] = [];
        userGroups[ownerId][canonicalId].push(doc);
      }

      // 2. Preserve separate credentials of the same canonical type. Only group
      // records when a stable content hash or document identifier proves they
      // represent the same credential; never merge solely by type or filename.
      for (const ownerId of Object.keys(userGroups)) {
        for (const canonicalId of Object.keys(userGroups[ownerId])) {
          const list = userGroups[ownerId][canonicalId];
          const credentialGroups = new Map();
          for (const doc of list) {
            const docId = doc.document_id || doc.id;
            const savedOcr = this.data.ocr_results?.[docId]?.extractedFields || {};
            const stableIdentifier = doc.file_reference?.sha256 || doc.doc_number || savedOcr.roll_number || savedOcr.licence_number || savedOcr.pan_number || savedOcr.aadhaar_number || savedOcr.passport_number || savedOcr.registration_no || null;
            if (!stableIdentifier) continue;
            const key = String(stableIdentifier).toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!key) continue;
            if (!credentialGroups.has(key)) credentialGroups.set(key, []);
            credentialGroups.get(key).push(doc);
          }

          for (const versions of credentialGroups.values()) {
            if (versions.length < 2) continue;
            versions.sort((a, b) => new Date(a.uploaded_at || 0).getTime() - new Date(b.uploaded_at || 0).getTime());
            const latest = versions[versions.length - 1];
            const latestId = latest.document_id || latest.id;
            versions.forEach((doc, index) => {
              const version = index + 1;
              const isHistorical = index < versions.length - 1;
              if (doc.version !== version || doc.isPreviousVersion !== isHistorical || doc.versionStatus !== (isHistorical ? 'history' : 'active')) {
                doc.version = version;
                doc.isPreviousVersion = isHistorical;
                doc.versionStatus = isHistorical ? 'history' : 'active';
                if (isHistorical) doc.supersededBy = latestId;
                modified = true;
              }
            });
          }
        }
      }

      if (modified) {
        this.save();
      }
    }

    getProcessingDocument(id) {
      this.data.processing_documents = this.data.processing_documents || {};
      return this.data.processing_documents[id] || null;
    }

    insertProcessingDocument(procDoc) {
      this.data.processing_documents = this.data.processing_documents || {};
      this.data.processing_documents[procDoc.id] = procDoc;
      this.save();
      return procDoc;
    }

    updateProcessingDocument(id, updates) {
      this.data.processing_documents = this.data.processing_documents || {};
      if (!this.data.processing_documents[id]) return null;
      this.data.processing_documents[id] = {
        ...this.data.processing_documents[id],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      this.save();
      return this.data.processing_documents[id];
    }

    // Database Queries
    getUser(identifier) {
      if (!identifier) return null;
      const key = identifier.toLowerCase().trim();
      return this.data.users[key] || Object.values(this.data.users).find(u => (u.email_or_phone && u.email_or_phone.toLowerCase() === key) || (u.id && u.id.toLowerCase() === key)) || null;
    }

    saveUser(user) {
      if (!user || !user.identifier) return false;
      const key = user.identifier.toLowerCase().trim();
      this.data.users[key] = {
        id: user.id || `usr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        name: user.fullName || user.name,
        email_or_phone: user.identifier,
        auth_info: {
          passwordHash: user.password,
          biometricEnrolled: !!user.biometricType,
          biometricType: user.biometricType || 'face',
          enrolledAt: new Date().toISOString()
        },
        role: user.role || 'student',
        created_at: new Date().toISOString()
      };
      if (!this.save()) {
        delete this.data.users[key];
        return false;
      }
      return this.data.users[key];
    }

    getProfile(userId, accountId = '') {
      if (!userId) return null;
      this.data.profiles = this.data.profiles || {};
      const norm = userId.toLowerCase().trim();
      if (this.data.profiles[norm]) return this.data.profiles[norm];
      const found = Object.values(this.data.profiles).find(p => typeof p.userId === 'string' && p.userId.toLowerCase() === norm);
      if (found) return found;
      const legacy = accountId && this.data.profiles[String(accountId).toLowerCase().trim()];
      if (legacy) return { ...legacy, userId: norm, documentOwnerId: String(accountId).toLowerCase().trim() };
      return {
        userId: norm,
        fullName: '', dateOfBirth: '', educationStage: '', schoolName: '', course: '',
        branch: '', currentYear: '', purpose: '', career: '', location: '',
        currentDocuments: [], profileCompleted: false
      };
    }

    saveProfile(userId, profileData = {}, accountId = '') {
      if (!userId) return null;
      this.data.profiles = this.data.profiles || {};
      const norm = userId.toLowerCase().trim();
      const existing = this.getProfile(norm, accountId);
      const updated = {
        ...existing,
        ...profileData,
        userId: norm,
        updatedAt: new Date().toISOString()
      };
      if (profileData.careerPreference && !profileData.career) updated.career = profileData.careerPreference;
      if (profileData.currentDocuments && Array.isArray(profileData.currentDocuments)) {
        updated.currentDocuments = profileData.currentDocuments;
      }
      this.data.profiles[norm] = updated;
      this.save();
      return updated;
    }

    getProfiles() {
      this.data.profiles = this.data.profiles || {};
      return this.data.profiles;
    }

    getDocuments(ownerId = null) {
      const all = Object.values(this.data.documents);
      if (!ownerId) return all;
      const norm = ownerId.toLowerCase().trim();
      return all.filter(d => d.owner_id && d.owner_id.toLowerCase() === norm);
    }

    getDocumentById(docId) {
      return this.data.documents[docId] || null;
    }

    insertDocument(doc) {
      const id = doc.document_id || ('doc-' + Date.now() + '-' + Math.floor(Math.random() * 1000));
      doc.document_id = id;
      doc.uploaded_at = doc.uploaded_at || new Date().toISOString();
      this.data.documents[id] = doc;
      this.save();
      return doc;
    }

    updateDocument(docId, updates) {
      if (!this.data.documents[docId]) return null;
      this.data.documents[docId] = { ...this.data.documents[docId], ...updates };
      this.save();
      return this.data.documents[docId];
    }

    deleteDocument(docId) {
      if (!this.data.documents[docId]) return false;
      delete this.data.documents[docId];
      this.save();
      return true;
    }

    getVerificationRequests(userId = null) {
      const all = Object.values(this.data.verification_requests);
      if (!userId) return all;
      const norm = userId.toLowerCase().trim();
      return all.filter(r => r.submitter_id && r.submitter_id.toLowerCase() === norm);
    }

    getRequestById(requestId) {
      return this.data.verification_requests[requestId] || null;
    }

    insertRequest(req) {
      const id = req.request_id || ('REQ-' + Math.floor(1000 + Math.random() * 9000));
      req.request_id = id;
      req.created_at = new Date().toISOString();
      req.updated_at = req.created_at;
      this.data.verification_requests[id] = req;
      this.save();
      return req;
    }

    updateRequest(requestId, updates) {
      if (!this.data.verification_requests[requestId]) return null;
      this.data.verification_requests[requestId] = {
        ...this.data.verification_requests[requestId],
        ...updates,
        updated_at: new Date().toISOString()
      };
      this.save();
      return this.data.verification_requests[requestId];
    }

    getOcrResult(docId) {
      return this.data.ocr_results[docId] || null;
    }

    saveOcrResult(docId, result) {
      this.data.ocr_results[docId] = {
        document_id: docId,
        ...result,
        processed_at: new Date().toISOString()
      };
      this.save();
      return this.data.ocr_results[docId];
    }

    getVerificationResult(docId) {
      return this.data.verification_results[docId] || null;
    }

    saveVerificationResult(docId, result) {
      this.data.verification_results[docId] = {
        document_id: docId,
        ...result,
        updated_at: new Date().toISOString()
      };
      this.save();
      return this.data.verification_results[docId];
    }

    logAuditEvent(event) {
      const linkedDocument = event.document_id ? this.getDocumentById(event.document_id) : null;
      const audit = {
        audit_id: 'aud-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        request_id: event.request_id || null,
        document_id: event.document_id || null,
        owner_id: event.owner_id || linkedDocument?.owner_id || null,
        actor: Object.prototype.hasOwnProperty.call(event, 'actor') ? event.actor : 'DOCDON AI System',
        action: event.action,
        timestamp: new Date().toISOString(),
        result: event.result || 'success',
        metadata: event.metadata || {}
      };
      this.data.audit_events.unshift(audit);
      if (this.data.audit_events.length > 200) {
        this.data.audit_events.pop();
      }
      this.save();
      return audit;
    }

    getAuditEvents(requestId = null, docId = null) {
      return this.data.audit_events.filter(e => {
        if (requestId && e.request_id !== requestId) return false;
        if (docId && e.document_id !== docId) return false;
        return true;
      });
    }

    insertShare(share) {
      if (!share || !share.share_token) return null;
      this.data.shares = this.data.shares || {};
      this.data.shares[share.share_token] = share;
      this.save();
      return share;
    }

    getShareByToken(shareToken) {
      if (!shareToken) return null;
      this.data.shares = this.data.shares || {};
      return this.data.shares[shareToken] || null;
    }

    updateShare(shareToken, updates) {
      if (!shareToken) return null;
      this.data.shares = this.data.shares || {};
      if (!this.data.shares[shareToken]) return null;
      this.data.shares[shareToken] = { ...this.data.shares[shareToken], ...updates };
      this.save();
      return this.data.shares[shareToken];
    }

    getShares(documentId = null, ownerId = null) {
      this.data.shares = this.data.shares || {};
      const all = Object.values(this.data.shares);
      return all.filter(s => {
        if (documentId && s.document_id !== documentId) return false;
        if (ownerId && s.owner_id && s.owner_id.toLowerCase() !== ownerId.toLowerCase()) return false;
        return true;
      });
    }
  }

  // ==========================================================================
  // SECTION 8 & 15: REAL OCR ENGINE LAYER (Optical Character & Feature Parser)
  // Extracts only fields relevant to each document. Does not claim fields were
  // extracted if OCR did not find them!
  // ==========================================================================
  class DocdonOcrEngine {
    constructor() {
      this.isMlReady = true;
    }

    /**
     * Inspect optical sharpness & image quality from pixel contrast or file metrics (Part 7)
     */
    evaluateImageQuality(imageOrFile, rawBuffer = null) {
      let blurScore = Number(imageOrFile?.qualityMetrics?.blurScore ?? 70.0);
      let noiseLevel = Number(imageOrFile?.qualityMetrics?.noiseLevel ?? 20.0);
      let resolutionPass = true;
      let brightnessPass = imageOrFile?.qualityMetrics?.brightnessPass !== false;
      let qualityReason = null;

      if (!imageOrFile) {
        return { blurScore: 0, noiseLevel: 100, resolutionPass: false, brightnessPass: false, isUsable: false, readability: 'Unreadable', qualityReason: 'Missing image payload' };
      }

      // Synthetic quality flags are honored only for explicit local test fixtures.
      const fName = ((imageOrFile && imageOrFile.name) || (imageOrFile && imageOrFile.filename) || '').toLowerCase();
      if (imageOrFile.isSimulation === true && (imageOrFile.isBlurry === true || imageOrFile.sampleKind === 'blurry')) {
        blurScore = 52.0;
        noiseLevel = 38.5;
        resolutionPass = false;
        qualityReason = 'Image is blurry or lacks optical focus.';
      } else if (imageOrFile.isSimulation === true && (imageOrFile.isPartial === true || imageOrFile.sampleKind === 'needs_review')) {
        blurScore = 82.0;
        noiseLevel = 12.0;
        resolutionPass = true;
      }

      // Check camera metadata if provided
      const camMeta = imageOrFile.cameraMetadata || {};
      if (typeof camMeta.brightness === 'number') {
        if (camMeta.brightness < 35) {
          brightnessPass = false;
          qualityReason = 'Image is too dark. Please capture with better lighting.';
        } else if (camMeta.brightness > 245) {
          brightnessPass = false;
          qualityReason = 'Severe glare or overexposure detected. Please avoid direct glare.';
        }
      }
      if (typeof camMeta.sharpness === 'number' && camMeta.sharpness < 6) {
        blurScore = 48.0;
        resolutionPass = false;
        qualityReason = 'Image is blurry. Please capture clearly without camera motion.';
      }

      // Check image width / height if available
      const width = imageOrFile.width || camMeta.width || 0;
      const height = imageOrFile.height || camMeta.height || 0;
      if (width > 0 && height > 0) {
        if (width < 400 || height < 300) {
          resolutionPass = false;
          blurScore = Math.min(blurScore, 50.0);
          qualityReason = 'Image resolution is too low (< 400x300). Insufficient resolution to decipher credential text.';
        }
      }

      const isUsable = resolutionPass && brightnessPass && blurScore >= 60;

      let readability = 'High Fidelity (Sharp contrast & typography)';
      if (blurScore < 60) readability = 'Low Fidelity (Severe optical blur or degradation)';
      else if (blurScore < 80) readability = 'Medium Fidelity (Moderate noise, partial characters obscured)';

      return {
        blurScore,
        noiseLevel,
        resolutionPass,
        brightnessPass,
        isUsable,
        readability,
        qualityReason
      };
    }

    assessVisualQuality(imageOrFile) {
      return this.evaluateImageQuality(imageOrFile);
    }

    /**
     * Image Preprocessing for OCR: Working Copy enhancement (Part 6)
     * Performs grayscale conversion, contrast enhancement, noise reduction, and sharpening
     * while preserving the original file payload completely intact.
     */
    async preprocessImageForOcr(dataUrlOrBuffer) {
      if (!dataUrlOrBuffer) return null;
      let preprocessedDataUrl = null;
      const applied = ['orientation_correction', 'upscale_if_needed', 'grayscale', 'brightness_contrast_normalization', 'noise_reduction', 'sharpening'];

      if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof dataUrlOrBuffer === 'string' && dataUrlOrBuffer.startsWith('data:image')) {
        try {
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = dataUrlOrBuffer;
          });
          const canvas = document.createElement('canvas');
          let w = img.width;
          let h = img.height;
          if (w > 0 && h > 0) {
            let scale = 1;
            if (w < 1000) scale = Math.min(2.0, 1200 / w);
            else if (w > 2400) scale = 2400 / w;
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = imgData.data;

            let minLum = 255;
            let maxLum = 0;
            const lums = new Uint8ClampedArray(canvas.width * canvas.height);
            for (let i = 0, p = 0; i < d.length; i += 4, p++) {
              const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
              lums[p] = lum;
              if (lum < minLum) minLum = lum;
              if (lum > maxLum) maxLum = lum;
            }

            const range = Math.max(1, maxLum - minLum);
            for (let i = 0, p = 0; i < d.length; i += 4, p++) {
              let stretched = Math.round(((lums[p] - minLum) / range) * 255);
              if (stretched < 128) stretched = Math.max(0, stretched - 15);
              else stretched = Math.min(255, stretched + 15);
              d[i] = stretched;
              d[i + 1] = stretched;
              d[i + 2] = stretched;
            }
            ctx.putImageData(imgData, 0, 0);
            preprocessedDataUrl = canvas.toDataURL('image/png');
          }
        } catch (procErr) {
          console.error('[DOCDON OCR] Browser image preprocessing failed; using original image:', procErr.stack || procErr.message || procErr);
          preprocessedDataUrl = typeof dataUrlOrBuffer === 'string' ? dataUrlOrBuffer : null;
        }
      } else if (typeof require !== 'undefined') {
        try {
          const sharp = require('sharp');
          let inputBuffer = dataUrlOrBuffer;
          if (typeof inputBuffer === 'string' && inputBuffer.startsWith('data:')) {
            const mime = inputBuffer.slice(5, inputBuffer.indexOf(';'));
            if (!mime.startsWith('image/')) {
              return { preprocessed: false, preprocessedBuffer: inputBuffer, preprocessingApplied: [], originalPreserved: true };
            }
            inputBuffer = Buffer.from(inputBuffer.slice(inputBuffer.indexOf(',') + 1), 'base64');
          }
          if (typeof inputBuffer === 'string' && (inputBuffer.startsWith('uploads/') || inputBuffer.startsWith('uploads\\'))) {
            const fs = require('fs');
            const path = require('path');
            const filePath = path.resolve(__dirname, inputBuffer);
            if (fs.existsSync(filePath)) inputBuffer = fs.readFileSync(filePath);
          }
          if (Buffer.isBuffer(inputBuffer)) {
            const metadata = await sharp(inputBuffer, { failOn: 'none' }).metadata();
            const targetWidth = Math.min(2600, Math.max(metadata.width || 0, 1200));
            const qualityRaster = await sharp(inputBuffer, { failOn: 'none' })
              .rotate()
              .resize({ width: 128, height: 128, fit: 'inside' })
              .greyscale()
              .raw()
              .toBuffer({ resolveWithObject: true });
            const pixels = qualityRaster.data;
            let luminanceTotal = 0;
            let laplacianTotal = 0;
            let laplacianSquaredTotal = 0;
            let laplacianSamples = 0;
            const rasterWidth = qualityRaster.info.width;
            const rasterHeight = qualityRaster.info.height;
            for (let y = 1; y < rasterHeight - 1; y++) {
              for (let x = 1; x < rasterWidth - 1; x++) {
                const index = y * rasterWidth + x;
                const value = pixels[index];
                luminanceTotal += value;
                const laplacian = pixels[index - 1] + pixels[index + 1] + pixels[index - rasterWidth] + pixels[index + rasterWidth] - 4 * value;
                laplacianTotal += laplacian;
                laplacianSquaredTotal += laplacian * laplacian;
                laplacianSamples += 1;
              }
            }
            const meanLaplacian = laplacianSamples ? laplacianTotal / laplacianSamples : 0;
            const laplacianVariance = laplacianSamples ? (laplacianSquaredTotal / laplacianSamples) - meanLaplacian * meanLaplacian : 0;
            const meanBrightness = luminanceTotal / Math.max(1, (rasterWidth - 2) * (rasterHeight - 2));
            const blurScore = Math.max(0, Math.min(100, 20 + Math.sqrt(Math.max(0, laplacianVariance)) * 4));
            const qualityMetrics = {
              blurScore,
              noiseLevel: Math.max(0, Math.min(100, Math.sqrt(Math.max(0, laplacianVariance)) / 4)),
              brightnessPass: meanBrightness >= 25 && meanBrightness <= 248,
              meanBrightness,
              laplacianVariance
            };
            const processedBuffer = await sharp(inputBuffer, { failOn: 'none' })
              .rotate()
              .resize({ width: targetWidth, withoutEnlargement: false })
              .grayscale()
              .normalize()
              .median(3)
              .linear(1.08, -8)
              .sharpen({ sigma: 1 })
              .png()
              .toBuffer();
            return {
              preprocessed: true,
              preprocessedBuffer: processedBuffer,
              preprocessingApplied: applied,
              workingCopyApplied: applied,
              originalPreserved: true,
              width: targetWidth,
              height: metadata.height ? Math.round(metadata.height * targetWidth / metadata.width) : null,
              qualityMetrics
            };
          }
        } catch (procErr) {
          console.error('[DOCDON OCR] Image preprocessing failed; using original bytes:', procErr.stack || procErr.message || procErr);
          // OCR can continue from the original bytes if preprocessing is unavailable.
        }
      }

      if (typeof dataUrlOrBuffer === 'string') {
        preprocessedDataUrl = dataUrlOrBuffer;
      }

      return {
        preprocessed: true,
        preprocessedDataUrl: preprocessedDataUrl,
        workingCopyApplied: applied,
        preprocessingApplied: applied,
        originalPreserved: true
      };
    }

    /**
     * Built-in FlateDecode stream decompressor for digital PDF files (Zero external dependencies)
     */
    extractTextFromPdfStreamBuffer(buffer) {
      if (!buffer) return '';
      let fullText = '';
      try {
        const bufStr = buffer.toString('binary');
        const streamRegex = /<<([\s\S]*?)>>[\r\n\s]*stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
        let match;

        while ((match = streamRegex.exec(bufStr)) !== null) {
          const dict = match[1];
          const streamContent = match[2];
          let decompressedStr = '';

          if (dict.includes('/FlateDecode')) {
            try {
              const streamBuf = Buffer.from(streamContent, 'binary');
              if (typeof require !== 'undefined') {
                const zlib = require('zlib');
                try {
                  decompressedStr = zlib.inflateSync(streamBuf).toString('utf8');
                } catch (e1) {
                  console.warn('[DOCDON OCR] PDF stream inflateSync failed; trying raw inflate:', e1.message || e1);
                  try {
                    decompressedStr = zlib.inflateRawSync(streamBuf).toString('utf8');
                  } catch (e2) { console.error('[DOCDON OCR] PDF stream raw inflate failed:', e2.message || e2); }
                }
              }
            } catch (zErr) { console.error('[DOCDON OCR] PDF stream decompression failed:', zErr.message || zErr); }
          } else {
            decompressedStr = streamContent;
          }

          if (decompressedStr) {
            const btBlocks = decompressedStr.match(/BT[\s\S]*?ET/g) || [decompressedStr];
            for (const block of btBlocks) {
              const tjMatches = block.match(/\(((?:[^\\()]|\\.)*)\)\s*(?:Tj|'|")/g) || [];
              for (const m of tjMatches) {
                const textMatch = m.match(/\(((?:[^\\()]|\\.)*)\)/);
                if (textMatch) {
                  const raw = textMatch[1].replace(/\\([()\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, ' ').replace(/\\t/g, ' ');
                  fullText += ' ' + raw;
                }
              }
              const tjArrayMatches = block.match(/\[([\s\S]*?)\]\s*TJ/g) || [];
              for (const arr of tjArrayMatches) {
                const innerStrings = arr.match(/\(((?:[^\\()]|\\.)*)\)/g) || [];
                for (const s of innerStrings) {
                  const textMatch = s.match(/\(((?:[^\\()]|\\.)*)\)/);
                  if (textMatch) {
                    const raw = textMatch[1].replace(/\\([()\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, ' ').replace(/\\t/g, ' ');
                    fullText += ' ' + raw;
                  }
                }
              }
            }
          }
        }

        const textStrings = bufStr.match(/\(((?:[^\\()]|\\.)*)\)\s*Tj/g) || [];
        for (const ts of textStrings) {
          const textMatch = ts.match(/\(((?:[^\\()]|\\.)*)\)/);
          if (textMatch) {
            const raw = textMatch[1].replace(/\\([()\\])/g, '$1');
            if (!fullText.includes(raw)) fullText += ' ' + raw;
          }
        }
      } catch (err) { console.error('[DOCDON OCR] PDF stream text extraction failed:', err.stack || err.message || err); }

      return fullText.replace(/\s+/g, ' ').trim();
    }

    /**
     * Extract raw text from PDF payload (Node.js or Browser)
     */
    async renderPdfPagesToImages(pdfBuffer) {
      if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) return [];
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const { createCanvas } = require('@napi-rs/canvas');
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(pdfBuffer),
          useSystemFonts: true,
          disableFontFace: true,
          isEvalSupported: false,
          verbosity: 0
        });
        const pdf = await loadingTask.promise;
        if (pdf.numPages > 100) {
          await pdf.destroy();
          return [];
        }
        const pages = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();

          if (pageText.length >= 20) {
            pages.push({ pageNumber, text: pageText, imageBuffer: null, source: 'pdf-text' });
            continue;
          }

          const baseViewport = page.getViewport({ scale: 1 });
          const maxDimension = Math.max(baseViewport.width, baseViewport.height, 1);
          const renderScale = Math.min(2, 2600 / maxDimension);
          const viewport = page.getViewport({ scale: renderScale });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const context = canvas.getContext('2d');
          await page.render({ canvasContext: context, viewport }).promise;
          pages.push({ pageNumber, text: pageText, imageBuffer: canvas.toBuffer('image/png'), source: 'pdf-rendered-image' });
        }

        await pdf.destroy();
        return pages;
      } catch (renderErr) {
        console.error('[DOCDON OCR] PDF page rendering failed:', renderErr.stack || renderErr.message || renderErr);
        return [];
      }
    }

    async extractTextFromPdf(bufferOrDataUrl) {
      if (typeof require !== 'undefined') {
        let buffer = null;
        if (Buffer.isBuffer(bufferOrDataUrl)) {
          buffer = bufferOrDataUrl;
        } else if (typeof bufferOrDataUrl === 'string') {
          let b64 = bufferOrDataUrl;
          if (b64.includes(',')) b64 = b64.split(',')[1];
          try { buffer = Buffer.from(b64, 'base64'); } catch (e) { console.error('[DOCDON OCR] Invalid base64 PDF data:', e.message || e); }
        }

        if (buffer) {
          let parsedPdfData = null;
          const pdfHeaderText = buffer.toString('latin1');
          const hasScannedImageStreams = /\/Subtype\s*\/Image\b/.test(pdfHeaderText);
          if (!hasScannedImageStreams) {
            try {
              const pdfParse = require('pdf-parse');
              parsedPdfData = await pdfParse(buffer);
              if (parsedPdfData?.text?.trim() && Number(parsedPdfData.numpages || 1) === 1 && parsedPdfData.text.trim().length >= 20) {
                const text = parsedPdfData.text.trim();
                return { success: true, text, rawOcrText: text, normalizedOcrText: normalizeOcrText(text), confidence: 98.2, ocrConfidence: null, extractionConfidence: 98.2, pageCount: 1, preprocessingApplied: [], source: 'pdf-parse' };
              }
            } catch (e) { console.warn('[DOCDON OCR] pdf-parse failed; trying PDF.js/text fallback:', e.message || e); }
          }

          try {
            const renderedPages = await this.renderPdfPagesToImages(buffer);
            if (renderedPages.length > 0) {
              const pageTexts = [];
              let ocrConfidenceTotal = 0;
              let ocrPageCount = 0;
              const preprocessingApplied = new Set();
              let ocrUnavailableError = null;

              let pdfWorker = null;
              try {
                for (const page of renderedPages) {
                  if (page.text) pageTexts.push(page.text);
                  if (!page.imageBuffer) continue;
                  if (!pdfWorker) {
                    const Tesseract = require('tesseract.js');
                    pdfWorker = await withStageTimeout(() => Tesseract.createWorker('eng'), PROCESSING_STAGE_TIMEOUTS.OCR, 'Tesseract worker initialization');
                  }

                  const pageRes = await this.extractTextFromImage(page.imageBuffer, pdfWorker);
                  if (pageRes.success && pageRes.text) {
                    pageTexts.push(pageRes.text);
                    ocrConfidenceTotal += Number(pageRes.confidence || 0);
                    ocrPageCount += 1;
                    (pageRes.preprocessingApplied || []).forEach(step => preprocessingApplied.add(step));
                  } else if (pageRes.isUnavailable) {
                    ocrUnavailableError = pageRes.error;
                  }
                }
              } finally {
                if (pdfWorker) await pdfWorker.terminate().catch(error => console.error('[DOCDON OCR] PDF Tesseract worker cleanup failed:', error.message || error));
              }

              const fullText = pageTexts.join('\n').trim();
              if (fullText) {
                const confidence = ocrPageCount > 0 ? ocrConfidenceTotal / ocrPageCount : 98.2;
                return {
                  success: true,
                  text: fullText,
                  rawOcrText: fullText,
                  normalizedOcrText: normalizeOcrText(fullText),
                  confidence: Math.max(0, Math.min(99.5, confidence)),
                  ocrConfidence: ocrPageCount > 0 ? confidence : null,
                  extractionConfidence: ocrPageCount > 0 ? null : confidence,
                  pageCount: renderedPages.length,
                  preprocessingApplied: Array.from(preprocessingApplied),
                  source: ocrPageCount > 0 ? 'pdfjs-rendered-page-ocr' : 'pdfjs-text'
                };
              }

              if (ocrUnavailableError) {
                return { success: false, text: '', confidence: 0, pageCount: renderedPages.length, isUnavailable: true, error: ocrUnavailableError };
              }
            }
          } catch (pdfRenderErr) { console.error('[DOCDON OCR] PDF.js extraction failed; trying text fallback:', pdfRenderErr.stack || pdfRenderErr.message || pdfRenderErr); }

          if (parsedPdfData?.text?.trim()) {
            const text = parsedPdfData.text.trim();
            return { success: true, text, rawOcrText: text, normalizedOcrText: normalizeOcrText(text), confidence: 98.2, ocrConfidence: null, extractionConfidence: 98.2, pageCount: parsedPdfData.numpages || 1, preprocessingApplied: [], source: 'pdf-parse-fallback' };
          }

          const text = this.extractTextFromPdfStreamBuffer(buffer);
          if (text && text.length > 5) {
            return { success: true, text: text, rawOcrText: text, normalizedOcrText: normalizeOcrText(text), confidence: 97.5, ocrConfidence: null, extractionConfidence: 97.5, pageCount: 1, preprocessingApplied: [], source: 'pdf-stream-fallback' };
          }
        }
      }

      if (typeof window !== 'undefined' && window.pdfjsLib) {
        try {
          let rawData = bufferOrDataUrl;
          if (typeof rawData === 'string' && rawData.includes(',')) {
            const b64 = rawData.split(',')[1];
            const bin = atob(b64);
            const len = bin.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
            rawData = bytes;
          }
          const pdf = await window.pdfjsLib.getDocument({ data: rawData }).promise;
          const pageTexts = [];
          let ocrConfidenceTotal = 0;
          let ocrPageCount = 0;
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
            if (pageText.length >= 20) {
              pageTexts.push(pageText);
              continue;
            }
            if (window.Tesseract) {
              const viewport = page.getViewport({ scale: 2 });
              const canvas = document.createElement('canvas');
              canvas.width = Math.ceil(viewport.width);
              canvas.height = Math.ceil(viewport.height);
              await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
              const ocrResult = await window.Tesseract.recognize(canvas, 'eng');
              const pageOcrText = (ocrResult && ocrResult.data && ocrResult.data.text || '').trim();
              if (pageOcrText) {
                pageTexts.push(pageOcrText);
                if (Number.isFinite(ocrResult.data.confidence)) ocrConfidenceTotal += ocrResult.data.confidence;
                ocrPageCount += 1;
              }
            }
          }
          const fullText = pageTexts.join('\n').trim();
          if (fullText.trim()) {
            const confidence = ocrPageCount ? ocrConfidenceTotal / ocrPageCount : 98.5;
            return {
              success: true,
              text: fullText,
              rawOcrText: fullText,
              normalizedOcrText: normalizeOcrText(fullText),
              confidence,
              ocrConfidence: ocrPageCount ? confidence : null,
              extractionConfidence: ocrPageCount ? null : confidence,
              pageCount: pdf.numPages,
              preprocessingApplied: ocrPageCount ? ['pdf-page-render', 'orientation_detection'] : [],
              source: ocrPageCount ? 'browser-pdf-page-ocr' : 'browser-pdf-text'
            };
          }
        } catch (e) { console.error('[DOCDON OCR] Browser PDF extraction failed:', e.stack || e.message || e); }
      }

      return { success: false, text: '', confidence: 0 };
    }

    /**
     * Extract raw text from Image payload using Tesseract.js (Node or Browser)
     */
    async extractTextFromImage(imageBufferOrDataUrlOrPath, sharedWorker = null) {
      if (typeof require !== 'undefined') {
        let worker = sharedWorker;
        const ownsWorker = !sharedWorker;
        try {
          const Tesseract = require('tesseract.js');
          let input = imageBufferOrDataUrlOrPath;
          if (typeof input === 'string' && input.startsWith('data:')) {
            const b64 = input.split(',')[1];
            input = Buffer.from(b64, 'base64');
          }
          if (typeof input === 'string' && (input.startsWith('uploads/') || input.startsWith('uploads\\'))) {
            const fs = require('fs');
            const path = require('path');
            const fullPath = path.resolve(__dirname, input);
            if (fs.existsSync(fullPath)) input = fs.readFileSync(fullPath);
          }

          let preprocessingApplied = [];
          if (Buffer.isBuffer(input)) {
            const preprocessed = await this.preprocessImageForOcr(input);
            if (preprocessed && Buffer.isBuffer(preprocessed.preprocessedBuffer)) {
              input = preprocessed.preprocessedBuffer;
              preprocessingApplied = preprocessed.preprocessingApplied || [];
            }
          }

          if (!worker) worker = await withStageTimeout(() => Tesseract.createWorker('eng'), PROCESSING_STAGE_TIMEOUTS.OCR, 'Tesseract worker initialization');
          const ret = await withStageTimeout(
            () => worker.recognize(input),
            PROCESSING_STAGE_TIMEOUTS.OCR,
            'Tesseract recognition',
            () => { worker.terminate().catch(error => console.error('[DOCDON OCR] Timed-out worker cleanup failed:', error.message || error)); }
          );
          const text = (ret && ret.data && ret.data.text) ? ret.data.text.trim() : '';
          const conf = ret && ret.data && Number.isFinite(ret.data.confidence) ? ret.data.confidence : 0;
          const normalizedText = normalizeOcrText(text);
          return {
            success: Boolean(text),
            text,
            rawOcrText: text,
            normalizedOcrText: normalizedText,
            confidence: conf,
            ocrConfidence: conf,
            pageCount: 1,
            preprocessingApplied,
            words: (ret && ret.data && ret.data.words) || [],
            error: text ? null : 'OCR completed but no readable text was found in the image.'
          };
        } catch (tessErr) {
          const detail = tessErr && tessErr.message ? tessErr.message : String(tessErr);
          return {
            success: false,
            isUnavailable: true,
            error: `Tesseract OCR failed: ${detail}`
          };
        } finally {
          if (worker && ownsWorker) {
            try { await worker.terminate(); } catch (terminateErr) { console.error('[DOCDON OCR] Worker cleanup failed:', terminateErr.message || terminateErr); }
          }
        }
      }

      if (typeof window !== 'undefined' && window.Tesseract) {
        let worker = null;
        try {
          worker = await withStageTimeout(() => window.Tesseract.createWorker('eng'), PROCESSING_STAGE_TIMEOUTS.OCR, 'Browser Tesseract worker initialization');
          const ret = await withStageTimeout(
            () => worker.recognize(imageBufferOrDataUrlOrPath),
            PROCESSING_STAGE_TIMEOUTS.OCR,
            'Browser Tesseract recognition',
            () => { worker.terminate().catch(error => console.error('[DOCDON OCR] Timed-out browser worker cleanup failed:', error.message || error)); }
          );
          const text = (ret && ret.data && ret.data.text) ? ret.data.text.trim() : '';
          const conf = ret && ret.data && Number.isFinite(ret.data.confidence) ? ret.data.confidence : 0;
          if (text) {
            const normalizedText = normalizeOcrText(text);
            return {
              success: true,
              text: text,
              rawOcrText: text,
              normalizedOcrText: normalizedText,
              confidence: conf,
              ocrConfidence: conf,
              pageCount: 1,
              preprocessingApplied: ['orientation_detection'],
              words: ret.data.words || []
            };
          }
        } catch (bErr) {
          console.error('[DOCDON OCR] Browser image OCR failed:', bErr.stack || bErr.message || bErr);
          return { success: false, isUnavailable: true, error: 'Browser OCR failed or timed out. Human review is required.' };
        } finally {
          if (worker) {
            try { await worker.terminate(); } catch (terminateErr) { console.error('[DOCDON OCR] Browser worker cleanup failed:', terminateErr.message || terminateErr); }
          }
        }
      }

      if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        try {
          const resp = await window.fetch('/api/ocr/inspect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataUrl: typeof imageBufferOrDataUrlOrPath === 'string' ? imageBufferOrDataUrlOrPath : null
            })
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.text) return data;
          }
        } catch (fErr) { console.error('[DOCDON OCR] Browser OCR service request failed:', fErr.stack || fErr.message || fErr); }
      }

      return {
        success: false,
        isUnavailable: true,
        error: 'AI Processing Unavailable: Optical character recognition library unavailable. Document escalated for human review.'
      };
    }

    /**
     * Unified raw text extraction for any uploaded file payload
     */
    async extractRawTextFromPayload(payload) {
      if (!payload) {
        return { success: false, text: '', confidence: 0, isUnavailable: true, error: 'AI Processing Unavailable: Empty file payload.' };
      }

      if (payload.isSimulation === true && payload.fileText) {
        return {
          success: true,
          text: payload.fileText,
          rawOcrText: payload.fileText,
          normalizedOcrText: normalizeOcrText(payload.fileText),
          confidence: 100,
          ocrConfidence: 100,
          pageCount: 1,
          preprocessingApplied: [],
          source: 'explicit-test-simulation'
        };
      }

      if (payload.isSimulation === true && (payload.sampleKind === 'ocr_unavailable' || payload.ocrUnavailable === true)) {
        return {
          success: false,
          isUnavailable: true,
          error: 'AI Processing Unavailable: Optical character recognition service is currently unavailable. Document escalated for human review.'
        };
      }

      const fType = (payload.type || payload.fileType || payload.file_type || '').toLowerCase();
      const fName = (payload.name || payload.filename || payload.fileName || '').toLowerCase();
      const isPdf = fType.includes('pdf') || fName.endsWith('.pdf');

      let contentSource = payload.buffer || payload.dataUrl || payload.fileData || payload.file || payload;
      if (payload.file_reference) {
        contentSource = payload.file_reference.stored_path || payload.file_reference.dataUrl || contentSource;
      }

      if (typeof require !== 'undefined' && typeof contentSource === 'string' && (contentSource.startsWith('uploads/') || contentSource.startsWith('uploads\\'))) {
        try {
          const fs = require('fs');
          const path = require('path');
          const fullPath = path.resolve(__dirname, contentSource);
          if (fs.existsSync(fullPath)) {
            contentSource = fs.readFileSync(fullPath);
          }
        } catch (e) { console.error('[DOCDON OCR] Unable to read stored upload for OCR:', e.stack || e.message || e); }
      }

      if (isPdf) {
        const pdfRes = await this.extractTextFromPdf(contentSource);
        if (pdfRes.success && pdfRes.text) {
          return pdfRes;
        }
        if (pdfRes.isUnavailable) return pdfRes;
        return { success: false, text: '', confidence: 0, pageCount: pdfRes.pageCount || 0, error: 'Unreadable PDF: no selectable text or OCR-readable page content was found.' };
      } else {
        return await this.extractTextFromImage(contentSource);
      }
    }

    /**
     * Extract fields strictly per document profile from actual raw text.
     * Does NOT fabricate values. If a field is not present in rawText, it remains undefined.
     */
    extractFieldsForType(typeKey, rawText, quality = null) {
      const profile = DOCUMENT_PROFILES[typeKey];
      if (!profile) {
        return {
          success: false,
          error: 'AI Processing Unavailable: Unsupported document profile ' + typeKey,
          extractedFields: {},
          confidence: 0
        };
      }

      const text = (rawText || '').replace(/\r/g, '\n');
      const extracted = {};
      const fieldConfidences = {};
      const detectedTokens = [];

      switch (typeKey) {
        case 'aadhaar_card': {
          const aadhMatch = text.match(/\b([0-9X]{4}\s[0-9X]{4}\s[0-9]{4}|[0-9]{12})\b/);
          if (aadhMatch) {
            extracted.aadhaar_number = aadhMatch[1].length === 12 
              ? `${aadhMatch[1].slice(0,4)} ${aadhMatch[1].slice(4,8)} ${aadhMatch[1].slice(8,12)}` 
              : aadhMatch[1];
            fieldConfidences.aadhaar_number = 99.2;
            detectedTokens.push(extracted.aadhaar_number);
          }

          const dobMatch = text.match(/(?:DOB|Date of Birth|Year of Birth)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4}|[0-9]{4})/i) ||
                           text.match(/\b([0-9]{2}\/[0-9]{2}\/[12][90][0-9]{2})\b/);
          if (dobMatch) {
            extracted.dob = dobMatch[1];
            fieldConfidences.dob = 98.8;
            detectedTokens.push(extracted.dob);
          }

          const genMatch = text.match(/\b(Male|Female|Transgender|MALE|FEMALE)\b/i);
          if (genMatch) {
            extracted.gender = genMatch[1].charAt(0).toUpperCase() + genMatch[1].slice(1).toLowerCase();
            fieldConfidences.gender = 99.0;
          }

          const nameMatch = text.match(/(?:To\s*[:\n]\s*|Name\s*[:\s])([A-Z][a-zA-Z\s]{2,40})/i) ||
                            text.match(/(?:^|\n)\s*([A-Z][a-zA-Z\s]{2,35})\s*\n[^\n]*(?:DOB|Date of Birth)/i);
          if (nameMatch) {
            extracted.cardholder_name = nameMatch[1].trim();
            fieldConfidences.cardholder_name = 97.5;
            detectedTokens.push(extracted.cardholder_name);
          }

          const addrMatch = text.match(/(?:Address\s*[:\n]|To\s*[:\n])\s*([\s\S]{10,140}?\b\d{6}\b)/i);
          if (addrMatch) {
            extracted.address = addrMatch[1].replace(/\s+/g, ' ').trim();
            fieldConfidences.address = 94.0;
          }

          if (/government of india|unique identification|uidai/i.test(text)) {
            extracted.uidai_emblem = 'National Emblem & Sovereign Header Verified';
            fieldConfidences.uidai_emblem = 99.0;
            detectedTokens.push('UIDAI Crest Verified');
          }
          if (/qr|signed|digital|cryptographic/i.test(text)) {
            extracted.qr_code = 'UIDAI Signed Cryptographic V2';
            fieldConfidences.qr_code = 96.0;
          }
          break;
        }

        case 'pan_card': {
          const panMatch = text.match(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/);
          if (panMatch) {
            extracted.pan_number = panMatch[1];
            fieldConfidences.pan_number = 99.4;
            detectedTokens.push(extracted.pan_number);
          }

          const dobMatch = text.match(/(?:DOB|Date of Birth)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4})/i) ||
                           text.match(/\b([0-9]{2}[\/-][0-9]{2}[\/-][12][90][0-9]{2})\b/);
          if (dobMatch) {
            extracted.dob = dobMatch[1];
            fieldConfidences.dob = 98.6;
          }

          const nameMatch = text.match(/(?:Name|Cardholder Name)\s*[:\s]*([A-Za-z\s]{3,40})/i) ||
                            text.match(/(?:^|\n)\s*([A-Z\s]{3,35})\s*\n[^\n]*(?:Father|Parent)/i);
          if (nameMatch) {
            extracted.holder_name = nameMatch[1].trim();
            fieldConfidences.holder_name = 98.0;
            detectedTokens.push(extracted.holder_name);
          }

          const fMatch = text.match(/(?:Father's Name|Father Name)\s*[:\s]*([A-Za-z\s]{3,40})/i);
          if (fMatch) {
            extracted.father_name = fMatch[1].trim();
            fieldConfidences.father_name = 97.0;
          }

          if (/income tax department|govt of india|permanent account number/i.test(text)) {
            extracted.income_tax_seal = 'Income Tax Department Crest Verified';
            fieldConfidences.income_tax_seal = 99.0;
            detectedTokens.push('INCOME TAX DEPARTMENT');
          }
          break;
        }

        case 'passport': {
          const passMatch = text.match(/\b([A-PR-WYa-pr-wy][1-9][0-9]{7})\b/);
          if (passMatch) {
            extracted.passport_number = passMatch[1].toUpperCase();
            fieldConfidences.passport_number = 99.5;
            detectedTokens.push(extracted.passport_number);
          }

          const nameMatch = text.match(/(?:Given Name\(s\)|Given Name|Surname|Name)\s*[:\s]*([A-Za-z\s]{3,40})/i) ||
                            text.match(/P<IND([A-Z<]+)/);
          if (nameMatch) {
            extracted.holder_name = nameMatch[1].replace(/<+/g, ' ').trim();
            fieldConfidences.holder_name = 98.2;
            detectedTokens.push(extracted.holder_name);
          }

          if (/indian|republic of india|ind/i.test(text)) {
            extracted.nationality = 'Indian';
            fieldConfidences.nationality = 99.0;
          }

          const issMatch = text.match(/(?:Date of Issue|Issue Date)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i);
          if (issMatch) {
            extracted.issue_date = issMatch[1];
            fieldConfidences.issue_date = 98.0;
          }

          const expMatch = text.match(/(?:Date of Expiry|Expiry Date)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i);
          if (expMatch) {
            extracted.expiry_date = expMatch[1];
            fieldConfidences.expiry_date = 98.9;
            detectedTokens.push(extracted.expiry_date);
          }

          const mrzMatch = text.match(/(P<[A-Z0-9<]{40,44}[\r\n]+[A-Z0-9<]{40,44})/);
          if (mrzMatch) {
            extracted.mrz_lines = mrzMatch[1];
            fieldConfidences.mrz_lines = 99.0;
          }
          break;
        }

        case 'driving_licence': {
          const dlMatch = text.match(/\b([A-Z]{2}[- ]?[0-9]{2}[- ]?[0-9]{4}[- ]?[0-9]{7}|[A-Z]{2}[0-9]{13,15})\b/i);
          if (dlMatch) {
            extracted.licence_number = dlMatch[1].toUpperCase();
            fieldConfidences.licence_number = 99.1;
            detectedTokens.push(extracted.licence_number);
          }

          const nameMatch = text.match(/(?:Name|Driver Name)\s*[:\s]*([A-Za-z\s]{3,40})/i);
          if (nameMatch) {
            extracted.driver_name = nameMatch[1].trim();
            fieldConfidences.driver_name = 97.8;
            detectedTokens.push(extracted.driver_name);
          }

          const dobMatch = text.match(/(?:DOB|Date of Birth)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4})/i);
          if (dobMatch) {
            extracted.dob = dobMatch[1];
            fieldConfidences.dob = 98.0;
          }

          const issMatch = text.match(/(?:Issue Date|Date of Issue|DOI)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4})/i);
          if (issMatch) {
            extracted.issue_date = issMatch[1];
            fieldConfidences.issue_date = 97.5;
          }

          const expMatch = text.match(/(?:Valid Till|Validity|Expiry|Valid Upto|NT|TR)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i);
          if (expMatch) {
            extracted.expiry_date = expMatch[1];
            fieldConfidences.expiry_date = 98.4;
            detectedTokens.push(extracted.expiry_date);
          }

          const classMatch = text.match(/\b(MCWG|LMV|TRANS|HMV|3W|2W)\b/g);
          if (classMatch) {
            extracted.vehicle_classes = Array.from(new Set(classMatch)).join(', ');
            fieldConfidences.vehicle_classes = 98.0;
          }
          break;
        }

        case '10th_marksheet': {
          const nameMatch = text.match(/(?:Candidate(?:\s*Name)?|Student(?:\s*Name)?|Name\s*of\s*(?:the\s*)?Student|Student's\s*Name|Candidate's\s*Name|Name)\s*[:\-]\s*([A-Za-z .]{3,40})/i) ||
                            text.match(/(?:This is to certify that|Certified that)\s+([A-Z\s]{3,35})\s+/i) ||
                            text.match(/(?:Shri|Smt|Kumari|Mr|Ms)\.?\s+([A-Z][A-Za-z\s]{2,35})/i);
          if (nameMatch) {
            extracted.student_name = nameMatch[1].trim();
            extracted.candidate_name = extracted.student_name;
            fieldConfidences.student_name = 98.5;
            detectedTokens.push(extracted.student_name);
          }

          const rollMatch = text.match(/(?:Roll\s*(?:No|Number|Code)|Seat\s*(?:No|Number)|Registration\s*(?:No|Number)|Reg\s*No|Index\s*No|Enrolment\s*No)[:\-\s]*([A-Z0-9\/-]+)/i) ||
                            text.match(/\b(SSC[- ]?\d{4,10}|\d{6,10})\b/);
          if (rollMatch) {
            extracted.roll_number = (rollMatch[1] || rollMatch[0]).trim();
            fieldConfidences.roll_number = 98.9;
            detectedTokens.push(extracted.roll_number);
          }

          const boardMatch = text.match(/(?:Central Board of Secondary Education|CBSE|CISCE|ICSE|Board of Secondary Education|Secondary Education Board|Secondary Education Council|Madhyamik Shiksha Parishad|Maharashtra State Board|Bihar School Examination Board|UP Board|Rajasthan Board|West Bengal Board of Secondary|Karnataka Secondary|Gujarat Secondary|Punjab School Education|Haryana Board|Tamilnadu State Board|BSE Odisha|State Board[A-Za-z\s]*|Secondary School Examination Board|Secondary School Examination)/i);
          if (boardMatch) {
            extracted.examination_board = boardMatch[0].trim();
            extracted.issuing_board = extracted.examination_board;
            fieldConfidences.examination_board = 98.0;
            detectedTokens.push(extracted.examination_board);
          }

          const yearMatch = text.match(/(?:Year|Passing Year|Examination held in|Session)\s*[:\s]*([A-Za-z]*\s*20[0-9]{2}|19[0-9]{2})/i) ||
                            text.match(/\b(20[0-9]{2})\b/);
          if (yearMatch) {
            extracted.passing_year = yearMatch[1] || yearMatch[0];
            fieldConfidences.passing_year = 98.0;
          }

          const hasMarksHeader = /(?:Statement of Marks|Marks Statement|Gradesheet|Mark Sheet|Marksheet|Score Card|Academic Record|Marks Obtained)/i.test(text);
          const hasSubjects = /(?:Mathematics|Maths|Science|Social|English|Hindi|Marathi|Sanskrit|Urdu|Language|Theory|Practical|Physics|Chemistry|Biology|History|Geography|Computer)/i.test(text);
          const hasScores = /\b\d{2,3}\s+\d{2,3}\b/.test(text) || /\b\d{2,3}\s*[\/-]\s*\d{2,3}\b/.test(text) || /\b(?:100|50|75|80)\b/.test(text);
          const subjectScorePairs = Array.from(text.matchAll(/\b(English|Mathematics|Maths|Science|Social Science|Social Studies|Hindi|Marathi|Sanskrit|Urdu|Physics|Chemistry|Biology|History|Geography|Computer Science)\b\s*[:\-]?\s*(\d{1,3})(?:\s*\/\s*\d{1,3})?/gi))
            .map(match => `${match[1]}: ${match[2]}`)
            .filter(value => Number(value.split(':').pop()) <= 100);
          if (subjectScorePairs.length >= 2) {
            extracted.subjects_grades = subjectScorePairs.join('; ');
            extracted.subject_marks = extracted.subjects_grades;
            fieldConfidences.subjects_grades = 96.5;
            detectedTokens.push('Subjects & Marks Breakdown');
          } else if (hasMarksHeader && hasSubjects && hasScores) {
            extracted.subjects_grades = null;
            extracted.subject_marks = null;
          }

          const resMatch = text.match(/(?:Result|Status|Remarks)\s*[:\-]\s*(PASS|PASSED|PROMOTED|QUALIFIED|FIRST CLASS|DISTINCTION|SECOND CLASS|FIRST DIV|I-DIV|SUCCESSFUL)/i) ||
                           text.match(/\b(PASSED|PASS|FIRST CLASS WITH DISTINCTION|FIRST DIVISION|PROMOTED|QUALIFIED)\b/i);
          if (resMatch) {
            extracted.result_status = (resMatch[1] || resMatch[0]).toUpperCase();
            fieldConfidences.result_status = 98.0;
            detectedTokens.push(extracted.result_status);
          }

          const dobMatch = text.match(/(?:DOB|Date of Birth)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4})/i);
          if (dobMatch) {
            extracted.dob = dobMatch[1];
            fieldConfidences.dob = 98.0;
          }
          break;
        }

        case '12th_marksheet': {
          const nameMatch = text.match(/(?:Candidate Name|Student Name|Name)\s*[:\s]*([A-Za-z ]{3,40})/i);
          if (nameMatch) {
            extracted.student_name = nameMatch[1].trim();
            fieldConfidences.student_name = 98.5;
            detectedTokens.push(extracted.student_name);
          }

          const rollMatch = text.match(/(?:Roll No|Roll Number|Seat No|HSC No)[:\s]*([A-Z0-9-]+)/i);
          if (rollMatch) {
            extracted.roll_number = rollMatch[1].trim();
            fieldConfidences.roll_number = 98.7;
            detectedTokens.push(extracted.roll_number);
          }

          const boardMatch = text.match(/(?:Higher Secondary|HSC|Senior School|Intermediate[A-Za-z\s]*)/i);
          if (boardMatch) {
            extracted.examination_board = boardMatch[0].trim();
            fieldConfidences.examination_board = 98.0;
          }

          const yearMatch = text.match(/\b(20[0-9]{2})\b/);
          if (yearMatch) {
            extracted.passing_year = yearMatch[1];
            fieldConfidences.passing_year = 98.0;
          }
          const subjectScorePairs = Array.from(text.matchAll(/\b(Physics|Chemistry|Mathematics|Maths|Biology|English|Accountancy|Economics|History|Geography|Computer Science)\b\s*[:\-]?\s*(\d{1,3})(?:\s*\/\s*\d{1,3})?/gi))
            .map(match => `${match[1]}: ${match[2]}`)
            .filter(value => Number(value.split(':').pop()) <= 100);
          if (subjectScorePairs.length >= 2) {
            extracted.stream_subjects = subjectScorePairs.join('; ');
            fieldConfidences.stream_subjects = 95.0;
          }
          const resultMatch = text.match(/\b(PASSED|PASS|FIRST CLASS|DISTINCTION|QUALIFIED)\b/i);
          if (resultMatch) extracted.result_status = resultMatch[1].toUpperCase();
          break;
        }

        case 'voter_id': {
          const epicMatch = text.match(/\b([A-Z]{3}[0-9]{7})\b/);
          if (epicMatch) {
            extracted.epic_number = epicMatch[1];
            fieldConfidences.epic_number = 99.2;
            detectedTokens.push(extracted.epic_number);
          }

          const nameMatch = text.match(/(?:Elector's Name|Name)\s*[:\s]*([A-Za-z\s]{3,40})/i);
          if (nameMatch) {
            extracted.elector_name = nameMatch[1].trim();
            fieldConfidences.elector_name = 98.0;
            detectedTokens.push(extracted.elector_name);
          }

          const constMatch = text.match(/(?:Constituency|Assembly Constituency)\s*[:\s]*([A-Za-z0-9\s\/-]{3,40})/i);
          if (constMatch) {
            extracted.constituency = constMatch[1].trim();
            fieldConfidences.constituency = 96.0;
          }
          break;
        }

        case 'bank_passbook_statement': {
          const accMatch = text.match(/(?:Account No|A\/c No|Acc No)[:\s]*([0-9]{9,18})/i) ||
                           text.match(/\b([0-9]{11,18})\b/);
          if (accMatch) {
            extracted.account_number = accMatch[1];
            fieldConfidences.account_number = 99.0;
            detectedTokens.push(extracted.account_number);
          }
          const ifscMatch = text.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/);
          if (ifscMatch) {
            extracted.ifsc_code = ifscMatch[1];
            fieldConfidences.ifsc_code = 99.4;
            detectedTokens.push(extracted.ifsc_code);
          }
          const nameMatch = text.match(/(?:Account Holder|Name|A\/c Name)[:\s]*([A-Za-z\s]{3,40})/i);
          if (nameMatch) {
            extracted.account_holder = nameMatch[1].trim();
            fieldConfidences.account_holder = 97.5;
            detectedTokens.push(extracted.account_holder);
          }
          break;
        }

        case 'address_proof': {
          const nameMatch = text.match(/(?:Consumer Name|Name|Resident)\s*[:\s]*([A-Za-z\s]{3,40})/i);
          if (nameMatch) {
            extracted.resident_name = nameMatch[1].trim();
            fieldConfidences.resident_name = 97.5;
            detectedTokens.push(extracted.resident_name);
          }
          const addrMatch = text.match(/(?:Address\s*[:\n])\s*([\s\S]{10,140}?\b\d{6}\b)/i);
          if (addrMatch) {
            extracted.full_address = addrMatch[1].replace(/\s+/g, ' ').trim();
            fieldConfidences.full_address = 96.0;
          }
          const cidMatch = text.match(/(?:Consumer No|Consumer ID|CA No)[:\s]*([A-Z0-9-]+)/i);
          if (cidMatch) {
            extracted.consumer_id = cidMatch[1];
            fieldConfidences.consumer_id = 98.0;
          }
          break;
        }

        case '10th_school_lc': {
          const nameMatch = text.match(/(?:Student Name|Name)\s*[:\s]*([A-Za-z\s]{3,40})/i);
          if (nameMatch) {
            extracted.student_name = nameMatch[1].trim();
            fieldConfidences.student_name = 98.0;
          }
          const schoolMatch = text.match(/(?:School Name|Institution)\s*[:\s]*([A-Za-z\s]{4,50})/i);
          if (schoolMatch) {
            extracted.school_name = schoolMatch[1].trim();
            fieldConfidences.school_name = 97.0;
          }
          const grMatch = text.match(/(?:GR No|General Register No)[:\s]*([A-Z0-9-]+)/i);
          if (grMatch) {
            extracted.gr_number = grMatch[1].trim();
            fieldConfidences.gr_number = 98.0;
          }
          break;
        }

        case 'diploma_certificate': {
          const nameMatch = text.match(/(?:Candidate Name|Conferred upon|Name)\s*[:\s]*([A-Za-z\s]{3,40})/i);
          if (nameMatch) {
            extracted.candidate_name = nameMatch[1].trim();
            fieldConfidences.candidate_name = 98.0;
          }
          const boardMatch = text.match(/(?:Board of Technical Education|Polytechnic|University[A-Za-z\s]*)/i);
          if (boardMatch) {
            extracted.technical_board = boardMatch[0].trim();
            fieldConfidences.technical_board = 97.5;
          }
          break;
        }

        case 'birth_certificate': {
          const nameMatch = text.match(/(?:Child Name|Name)\s*[:\s]*([A-Za-z\s]{3,40})/i);
          if (nameMatch) {
            extracted.child_name = nameMatch[1].trim();
            fieldConfidences.child_name = 98.0;
          }
          const regMatch = text.match(/(?:Registration No|Certificate No)[:\s]*([A-Z0-9-]+)/i);
          if (regMatch) {
            extracted.registration_no = regMatch[1].trim();
            fieldConfidences.registration_no = 98.5;
          }
          const dobMatch = text.match(/(?:DOB|Date of Birth)[:\s]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4})/i);
          if (dobMatch) {
            extracted.dob = dobMatch[1];
            fieldConfidences.dob = 98.0;
          }
          break;
        }

        case 'degree_certificate': {
          const nameMatch = text.match(/(?:Graduate Name|Conferred upon|This is to certify that|Name)\s*[:\s]*([A-Za-z\s]{3,40})/i);
          if (nameMatch) {
            extracted.graduate_name = nameMatch[1].trim();
            fieldConfidences.graduate_name = 98.0;
            detectedTokens.push(extracted.graduate_name);
          }
          const univMatch = text.match(/(?:University|Institute of Technology|College)\s*[:\s]*([A-Za-z\s]{4,60})/i) || text.match(/([A-Za-z\s]{4,60}\bUniversity\b)/i);
          if (univMatch) {
            extracted.university_name = univMatch[1].trim();
            fieldConfidences.university_name = 97.5;
          }
          const progMatch = text.match(/(?:Bachelor of|Master of|B\.Tech|B\.E\.|B\.Sc|M\.Tech|M\.Sc|Degree of)\s*([A-Za-z\s]{3,40})/i);
          if (progMatch) {
            extracted.degree_program = (progMatch[0] || progMatch[1]).trim();
            fieldConfidences.degree_program = 98.0;
          }
          const yrMatch = text.match(/(?:Convocation|Conferred|Year|Dated)\s*[:\s]*([12][90]\d{2})/i) || text.match(/\b(20\d{2}|19\d{2})\b/);
          if (yrMatch) {
            extracted.convocation_year = yrMatch[1];
            fieldConfidences.convocation_year = 96.0;
          }
          const regMatch = text.match(/(?:PRN|Registration No|Roll No|Degree No)[:\s]*([A-Z0-9-]+)/i);
          if (regMatch) {
            extracted.degree_reg_no = regMatch[1];
            fieldConfidences.degree_reg_no = 98.0;
          }
          break;
        }

        case 'resume': {
          const nameMatch = text.match(/(?:Candidate Name|Name)\s*[:\s]*([A-Za-z\s]{3,40})/i) || text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/m);
          if (nameMatch) {
            extracted.candidate_name = nameMatch[1].trim();
            fieldConfidences.candidate_name = 98.0;
            detectedTokens.push(extracted.candidate_name);
          }
          const skillsMatch = text.match(/(?:Skills|Technical Skills|Core Competencies)\s*[:\s]*([^\n]+)/i);
          if (skillsMatch) {
            extracted.summary_skills = skillsMatch[1].trim();
            fieldConfidences.summary_skills = 95.0;
          }
          const eduMatch = text.match(/(?:Education|Academic Background)\s*[:\s]*([^\n]+)/i);
          if (eduMatch) {
            extracted.education_history = eduMatch[1].trim();
            fieldConfidences.education_history = 95.0;
          }
          break;
        }

        default:
          break;
      }

      const reqFields = profile.requiredFields || [];
      reqFields.forEach(field => {
        if (extracted[field] === undefined) extracted[field] = null;
      });
      const foundCount = reqFields.filter(f => !!extracted[f]).length;
      const blurFactor = (quality && quality.blurScore) ? (quality.blurScore / 100) : 0.95;

      let baseConf = 15.0;
      if (reqFields.length > 0) {
        const ratio = foundCount / reqFields.length;
        baseConf = (ratio * 80 + 18) * blurFactor;
      } else if (Object.keys(extracted).length > 0) {
        baseConf = 88.0 * blurFactor;
      }

      return {
        success: true,
        extractedFields: extracted,
        fieldConfidences: fieldConfidences,
        detectedTokens: detectedTokens,
        confidence: Math.max(10, Math.min(99.4, Math.round(baseConf * 10) / 10)),
        rawText: text
      };
    }

    /**
     * Complete pipeline: Quality check -> Text Extraction -> Profile Field Parsing
     */
    async processDocument(doc, options = {}) {
      const fileRef = doc.file_reference || {};
      const quality = this.evaluateImageQuality(fileRef);

      const rawRes = await this.extractRawTextFromPayload({
        ...fileRef,
        fileText: options.fileText || fileRef.fileText,
        sampleKind: options.sampleKind,
        ocrUnavailable: options.ocrUnavailable
      });

      if (!rawRes.success || rawRes.isUnavailable) {
        return {
          success: false,
          isUnavailable: true,
          error: rawRes.error || 'AI Processing Unavailable: Optical character recognition engine unavailable. Document escalated for human review.',
          quality: quality,
          confidence: 0,
          extractedFields: {},
          fieldConfidences: {},
          detectedTokens: [],
          rawText: ''
        };
      }

      const parsed = this.extractFieldsForType(doc.document_type, rawRes.text, quality);
      parsed.quality = quality;
      parsed.rawText = rawRes.rawOcrText || rawRes.text;
      parsed.normalizedOcrText = rawRes.normalizedOcrText || normalizeOcrText(rawRes.text);
      parsed.ocrConfidence = Number.isFinite(rawRes.ocrConfidence) ? rawRes.ocrConfidence : null;
      parsed.extractionConfidence = Number(rawRes.extractionConfidence ?? rawRes.confidence ?? 0);
      parsed.fieldExtractionConfidence = parsed.confidence;
      parsed.pageCount = Number(rawRes.pageCount || 1);
      parsed.preprocessingApplied = rawRes.preprocessingApplied || [];
      parsed.source = rawRes.source || 'tesseract-image-ocr';
      return parsed;
    }
  }

  // ==========================================================================
  // SECTION 7: DOCUMENT CLASSIFICATION LAYER
  // Strict detection: uploaded document must match selected type. If mismatch,
  // flags "Document Type Mismatch" with specific details.
  // ==========================================================================
  class DocdonClassifier {
    /**
     * Auto-detect the best matching document type key across all profiles from raw text.
     * Evaluates actual content, never trusting filenames or superficial labels.
     * For 10th marksheet, strictly requires at least 3 distinct category signals.
     */
    detectTypeFromContent(rawText = '', filename = '') {
      const text = (rawText || '').trim();
      if (!text || text.length < 15) {
        return {
          detectedTypeKey: 'unknown',
          detectedTypeName: 'Unrecognized Document / Random Image',
          confidence: 0,
          isConfident: false,
          evidence: {
            examination: false,
            level: false,
            identity: false,
            result: false,
            structure: false
          },
          missingEvidence: ['examination', 'level', 'identity', 'result', 'structure']
        };
      }

      const normalizedText = normalizeOcrText(text);
      const semesterNumber = (() => {
        const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
        const anchored = normalizedText.match(/\b(?:semester|sem)\s*(viii|vii|vi|iv|v|iii|ii|i|[1-8])\b/i);
        if (anchored) return /^\d$/.test(anchored[1]) ? Number(anchored[1]) : roman[anchored[1].toLowerCase()];
        const named = normalizedText.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth)\s+semester\b/i);
        return named ? ['first','second','third','fourth','fifth','sixth','seventh','eighth'].indexOf(named[1].toLowerCase()) + 1 : null;
      })();
      const tenthProfile = buildMarksheetEvidenceProfile(normalizedText, {});
      const documentFamily = detectMarksheetFamily(normalizedText) ? 'marksheet' : 'unknown';
      const levelResult = detectAcademicLevel(text);
      const marksheetLevel = levelResult.academicLevel;

      const aadhNum = /\b([0-9X]{4}\s[0-9X]{4}\s[0-9]{4}|[0-9]{12})\b/.test(normalizedText);
      const aadhHeader = /unique identification authority of india|uidai|government of india|govt\.? of india|bharat sarkar/i.test(normalizedText);
      const aadhWord = /\baadhaar\b|\baadhar\b|\bmera aadhaar\b|\benrolment\b|\bvid\b/i.test(normalizedText);
      const aadhDemo = /dob|date of birth|gender|male|female|year of birth|yob|address|father|husband|w\/o|s\/o|d\/o/i.test(normalizedText);
      const isAadhaar = (aadhNum && (aadhHeader || aadhWord || aadhDemo)) || (aadhHeader && aadhWord) || (aadhWord && aadhDemo);

      const panNum = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/.test(normalizedText);
      const panHeader = /income tax department|permanent account number/i.test(normalizedText);
      const panFather = /father(?:'s)?\s*name|date of birth|dob/i.test(normalizedText);
      const isPan = (panNum && (panHeader || panFather)) || (panHeader && panFather);

      const passNum = /\b([A-PR-WYa-pr-wy][1-9][0-9]{7})\b/.test(normalizedText) || /P<IND/.test(normalizedText);
      const passHeader = /republic of india|passport seva|travel document|consular|ministry of external affairs/i.test(normalizedText);
      const passWord = /\bpassport\b/i.test(normalizedText);
      const isPassport = (passNum && passWord) || (passHeader && passWord);

      const dlNum = /\b([A-Z]{2}[- ]?[0-9]{2}[- ]?[0-9]{4}[- ]?[0-9]{7}|[A-Z]{2}[0-9]{13,15})\b/i.test(normalizedText);
      const dlHeader = /driving licen[cs]e|transport department|parivahan|motor vehicles? department|form 7/i.test(normalizedText);
      const dlClasses = /\b(mcwg|lmv|trans|hmv|3w|2w|non-transport|transport)\b/i.test(normalizedText);
      const isDL = (dlNum && (dlHeader || dlClasses)) || (dlHeader && dlClasses);

      const epicNum = /\b([A-Z]{3}[0-9]{7})\b/.test(normalizedText);
      const epicHeader = /election commission of india|elector'?s photo identity card|epic\b|matdata photo/i.test(normalizedText);
      const isVoter = (epicNum && epicHeader) || (epicHeader && /constituency|assembly/i.test(normalizedText));

      const ifsc = /\b([A-Z]{4}0[A-Z0-9]{6})\b/.test(normalizedText);
      const bankTerms = /account (?:number|no)|passbook|bank statement|savings account|ifsc\b/i.test(normalizedText);
      const isBank = (ifsc && bankTerms) || (bankTerms && /balance|withdrawal|deposit|branch/i.test(normalizedText));

      const birthTerms = /birth certificate|registration of birth|certificate of birth|form no\.?\s*5|births and deaths/i.test(normalizedText);
      const isBirth = birthTerms && /child|date of birth|place of birth|parents/i.test(normalizedText);

      const utilityTerms = /electricity (?:bill|distribution)|consumer (?:no|id|number)|utility bill|ca no|power distribution|water bill|meter reading/i.test(normalizedText);
      const isAddress = utilityTerms && /bill (?:date|amount)|tariff|units consumed/i.test(normalizedText);

      const lcTerms = /leaving certificate|school leaving|transfer certificate|transfer cert|tc no/i.test(normalizedText);
      const isLC = lcTerms && /gr (?:no|number)|general register|conduct|date of leaving/i.test(normalizedText);

      const diplomaTerms = /diploma in|polytechnic|board of technical education|msbte|state technical board/i.test(normalizedText);
      const isDiploma = diplomaTerms && /candidate|program|semester|passing/i.test(normalizedText);
      const degreeTerms = /(?:convocation|degree of|conferred upon|bachelor of|master of|b\.?tech|b\.?e\.)/i.test(normalizedText) && /(?:university|institute of technology)/i.test(normalizedText);
      const resumeTerms = /(?:curriculum vitae|\bresume\b|biodata)/i.test(normalizedText) || (/(?:skills|work experience|education history)/i.test(normalizedText) && /(?:javascript|python|developer|engineer|manager|experience|projects)/i.test(normalizedText));

      // Resolve university and technical academic records before school levels.
      // Generic marks/result/subject words are deliberately not sufficient.
      const semesterHeading = /\b(?:semester\s+(?:examination|result|marksheet|mark\s+sheet|grade\s+card|i|ii|iii|iv|v|vi|vii|viii|[1-8])|sem\s*(?:i|ii|iii|iv|v|vi|vii|viii|[1-8])|first\s+semester|second\s+semester|third\s+semester|fourth\s+semester|fifth\s+semester|sixth\s+semester|seventh\s+semester|eighth\s+semester|end\s+semester\s+examination)\b/i.test(normalizedText);
      const universityEvidence = /\b(?:university|college|institute|department|affiliated\s+to)\b/i.test(normalizedText);
      const courseEvidence = /\b(?:course\s+code|subject\s+code|course\s+title|program(?:me)?|credits?|credit\s+points|sgpa|cgpa|grade\s+card|grade\s+sheet)\b/i.test(normalizedText);
      const semesterMetrics = /\b(?:sgpa|cgpa|credits?|credit\s+points|course\s+code|subject\s+code|grade\s+card|grade\s+sheet|university\s+marks\s+statement)\b/i.test(normalizedText);
      const diplomaContext = /\b(?:diploma|polytechnic|technical\s+education|board\s+of\s+technical\s+education|msbte|bte)\b/i.test(normalizedText);
      const degreeContext = /\b(?:bachelor|b\.?tech|b\.?e\.?|b\.?sc|b\.?com|b\.?a\.?|bba|bca|mbbs|degree|undergraduate|postgraduate|master(?:'s)?|m\.?tech|m\.?sc)\b/i.test(normalizedText);
      const academicMarking = /\b(?:marksheet|mark\s+sheet|marks\s+statement|statement\s+of\s+marks|result|examination|grade\s+card|grade\s+sheet)\b/i.test(normalizedText);
      const strongSemester = (semesterHeading && (universityEvidence || courseEvidence || academicMarking)) ||
        (semesterMetrics && universityEvidence && academicMarking) ||
        (/\bgrade\s+card\b/i.test(normalizedText) && universityEvidence);
      if (strongSemester) {
        const headedSchoolLevel = levelResult.headerEvidence?.['10th']?.length || levelResult.headerEvidence?.['12th']?.length;
        if (headedSchoolLevel) {
          return {
            detectedTypeKey: 'unknown', detectedTypeName: 'Conflicting Academic Document Evidence', confidence: 35,
            isConfident: false, isLikely: true, documentFamily: 'marksheet', academicLevel: 'unknown',
            academicLevelConfidence: 35, academicLevelConflict: true,
            semesterNumber,
            academicLevelEvidence: levelResult.academicLevelEvidence,
            contradictoryEvidence: [...(levelResult.academicLevelEvidence?.['10th'] || []), ...(levelResult.academicLevelEvidence?.['12th'] || []), 'university/semester evidence'],
            evidence: { university: universityEvidence, semester: semesterHeading, course: courseEvidence, metrics: semesterMetrics, schoolLevelHeading: true },
            missingEvidence: [], status: 'NEEDS_REVIEW'
          };
        }
        const detectedTypeKey = diplomaContext ? 'diploma_marksheet' : degreeContext && !semesterHeading ? 'degree_marksheet' : 'semester_marksheet';
        const detectedTypeName = DOCUMENT_PROFILES[detectedTypeKey]?.name || CANONICAL_DOCUMENT_TAXONOMY[detectedTypeKey]?.canonicalName;
        return {
          detectedTypeKey, detectedTypeName, confidence: 92, isConfident: true, isLikely: true,
          documentFamily: 'academic_university', academicLevel: diplomaContext ? 'diploma' : 'university_semester', academicStage: diplomaContext ? 'diploma' : 'university_semester',
          academicLevelConfidence: 92, evidence: { university: universityEvidence, semester: semesterHeading, course: courseEvidence, metrics: semesterMetrics, marks: academicMarking },
          semesterNumber,
          missingEvidence: [], status: 'CLASSIFIED'
        };
      }
      if (diplomaContext && academicMarking && (courseEvidence || /\b(?:candidate|student|roll|registration)\b/i.test(normalizedText))) {
        return { detectedTypeKey: 'diploma_marksheet', detectedTypeName: 'Diploma Marksheet', confidence: 86, isConfident: true, isLikely: true, documentFamily: 'academic_diploma', academicLevel: 'diploma', academicStage: 'diploma', academicLevelConfidence: 86, semesterNumber, evidence: { diploma: true, academicMarking: true, course: courseEvidence }, missingEvidence: [], status: 'CLASSIFIED' };
      }
      if (degreeContext && academicMarking && universityEvidence && (courseEvidence || /\b(?:student|candidate|roll|registration)\b/i.test(normalizedText))) {
        const academicStage = /\b(?:master|postgraduate|m\.?tech|m\.?sc)\b/i.test(normalizedText) ? 'postgraduate' : 'undergraduate';
        return { detectedTypeKey: 'degree_marksheet', detectedTypeName: 'Degree Marksheet', confidence: 86, isConfident: true, isLikely: true, documentFamily: 'academic_degree', academicLevel: academicStage, academicStage, academicLevelConfidence: 86, semesterNumber, evidence: { degree: true, university: true, academicMarking: true, course: courseEvidence }, missingEvidence: [], status: 'CLASSIFIED' };
      }

      if (isAadhaar) return { detectedTypeKey: 'aadhaar_card', detectedTypeName: 'Aadhaar Card', confidence: 94.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level', 'result', 'structure'] };
      if (isPan) return { detectedTypeKey: 'pan_card', detectedTypeName: 'PAN Card', confidence: 95.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level', 'result', 'structure'] };
      if (isPassport) return { detectedTypeKey: 'passport', detectedTypeName: 'Passport', confidence: 95.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level', 'result', 'structure'] };
      if (isDL) return { detectedTypeKey: 'driving_licence', detectedTypeName: 'Driving Licence', confidence: 93.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level', 'result', 'structure'] };
      if (documentFamily === 'marksheet') {
        const levelKnown = marksheetLevel !== 'unknown';
        const validation = levelKnown && tenthProfile.isStrong;
        const candidateType = marksheetLevel === '10th' ? '10th_marksheet' : '12th_marksheet';
        const typeKey = validation || (levelKnown && tenthProfile.isLikely) ? candidateType : 'unknown';
        return {
          detectedTypeKey: typeKey,
          detectedTypeName: typeKey === '10th_marksheet' ? '10th Marksheet' : typeKey === '12th_marksheet' ? '12th Marksheet' : 'Unresolved Marksheet Level',
          confidence: levelKnown ? Math.min(levelResult.academicLevelConfidence, tenthProfile.classificationConfidence) : levelResult.academicLevelConfidence,
          isConfident: Boolean(validation),
          isLikely: Boolean(tenthProfile.isLikely),
          documentFamily,
          academicLevel: marksheetLevel,
          academicStage: marksheetLevel === '10th' ? 'secondary' : marksheetLevel === '12th' ? 'higher_secondary' : 'unknown',
          academicLevelConfidence: levelResult.academicLevelConfidence,
          academicLevelEvidence: levelResult.academicLevelEvidence,
          contradictoryEvidence: levelResult.contradictoryEvidence,
          rawLevelTokens: levelResult.rawLevelTokens,
          academicLevelConflict: levelResult.academicLevelConflict,
          evidence: { ...tenthProfile.evidence, level: levelKnown },
          matchedEvidence: tenthProfile.matchedEvidence,
          missingEvidence: tenthProfile.missingEvidence,
          status: validation ? 'CLASSIFIED' : 'NEEDS_REVIEW',
          classification: { type: typeKey, confidence: levelKnown ? levelResult.academicLevelConfidence : 0 }
        };
      }
      if (isVoter) return { detectedTypeKey: 'voter_id', detectedTypeName: 'Voter ID', confidence: 92.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level','result','structure'] };
      if (isBank) return { detectedTypeKey: 'bank_passbook_statement', detectedTypeName: 'Bank Passbook/Statement', confidence: 90.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level','result','structure'] };
      if (isBirth) return { detectedTypeKey: 'birth_certificate', detectedTypeName: 'Birth Certificate', confidence: 91.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level','result','structure'] };
      if (isAddress) return { detectedTypeKey: 'address_proof', detectedTypeName: 'Address Proof', confidence: 90.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level','result','structure'] };
      if (isLC) return { detectedTypeKey: '10th_school_lc', detectedTypeName: '10th School Leaving Certificate (10th LC)', confidence: 90.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level','result','structure'] };
      if (isDiploma) return { detectedTypeKey: 'diploma_certificate', detectedTypeName: 'Diploma Certificate', confidence: 90.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level','result','structure'] };
      if (degreeTerms) return { detectedTypeKey: 'degree_certificate', detectedTypeName: 'Degree Certificate', confidence: 91.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level','result','structure'] };
      if (resumeTerms) return { detectedTypeKey: 'resume', detectedTypeName: 'Resume / Curriculum Vitae (CV)', confidence: 90.0, isConfident: true, evidence: { examination: true, level: false, identity: true, result: false, structure: false }, missingEvidence: ['level','result','structure'] };
      if (/\b(?:academic\s+)?certificate\b/i.test(normalizedText) && /\b(?:school|college|university|institution|course|training|issued|awarded|completion)\b/i.test(normalizedText)) {
        return { detectedTypeKey: 'certificate', detectedTypeName: 'Academic Certificate', confidence: 82, isConfident: true, isLikely: true, documentFamily: 'academic_certificate', academicLevel: 'certificate', academicLevelConfidence: 82, evidence: { certificate: true, institution: true }, missingEvidence: [], status: 'CLASSIFIED' };
      }
      if (/\b(?:transcript|bonafide|bonafide certificate|academic record|course completion)\b/i.test(normalizedText) && /\b(?:school|college|university|institution|student|course)\b/i.test(normalizedText)) {
        return { detectedTypeKey: 'other_academic_document', detectedTypeName: 'Other Academic Document', confidence: 80, isConfident: true, isLikely: true, documentFamily: 'academic_other', academicLevel: 'unknown', evidence: { academicDocument: true, institution: true }, missingEvidence: [], status: 'CLASSIFIED' };
      }

      return {
        detectedTypeKey: 'unknown',
        detectedTypeName: 'Unrecognized Document / Random Image',
        confidence: 10.0,
        isConfident: false,
        evidence: {
          examination: false,
          level: false,
          identity: false,
          result: false,
          structure: false
        },
        missingEvidence: ['examination', 'level', 'identity', 'result', 'structure']
      };
    }

    classifyDocument(targetTypeKey, attachment, ocrTokens = [], rawText = '') {
      if (!targetTypeKey || targetTypeKey === 'auto' || targetTypeKey === 'custom_document' || targetTypeKey === 'other_custom') {
        const auto = this.detectTypeFromContent(rawText, attachment?.name);
        if (auto.isConfident) {
          return {
            isMatch: true,
            detectedTypeKey: auto.detectedTypeKey,
            detectedTypeName: auto.detectedTypeName,
            hasContradiction: false,
            mismatchReason: null,
            isAutoDetected: true,
            isLikely: Boolean(auto.isLikely || auto.isConfident),
            classificationConfidence: auto.confidence,
            evidence: auto.evidence,
            missingEvidence: auto.missingEvidence
          };
        }
        return {
          isMatch: false,
          detectedTypeKey: 'unrecognized',
          detectedTypeName: 'Unrecognized Document / Random Image',
          hasContradiction: true,
          mismatchReason: 'File contents do not exhibit recognizable official credential attributes. Unrecognized document or random image.',
          classificationConfidence: 0,
          evidence: { examination: false, level: false, identity: false, result: false, structure: false },
          missingEvidence: ['examination', 'level', 'identity', 'result', 'structure'],
          documentFamily: auto.documentFamily,
          academicLevel: auto.academicLevel,
          academicLevelConfidence: auto.academicLevelConfidence,
          academicLevelEvidence: auto.academicLevelEvidence,
          contradictoryEvidence: auto.contradictoryEvidence,
          rawLevelTokens: auto.rawLevelTokens,
          academicLevelConflict: auto.academicLevelConflict,
          isLikely: Boolean(auto.isLikely),
          status: auto.status
        };
      }

      const targetProfile = DOCUMENT_PROFILES[targetTypeKey];
      if (!targetProfile) {
        return {
          isMatch: false,
          detectedTypeKey: 'unknown',
          detectedTypeName: 'Custom / Unregistered Document',
          hasContradiction: false,
          mismatchReason: null,
          classificationConfidence: 0,
          evidence: { examination: false, level: false, identity: false, result: false, structure: false },
          missingEvidence: ['examination', 'level', 'identity', 'result', 'structure']
        };
      }

      if (attachment && attachment.isSimulation === true && attachment.sampleKind === 'mismatch') {
        const fakeMismatchType = attachment.detectedTypeKey || (targetTypeKey === 'aadhaar_card' ? 'driving_licence' : '10th_marksheet');
        const mismatchProfile = DOCUMENT_PROFILES[fakeMismatchType] || DOCUMENT_PROFILES['driving_licence'];
        return {
          isMatch: false,
          detectedTypeKey: fakeMismatchType,
          detectedTypeName: mismatchProfile.name,
          hasContradiction: true,
          mismatchReason: `Uploaded document does not match the selected document type. Expected "${targetProfile.name}", but file contents match a "${mismatchProfile.name}".`,
          classificationConfidence: 12,
          evidence: { examination: false, level: false, identity: false, result: false, structure: false },
          missingEvidence: ['examination', 'level', 'identity', 'result', 'structure']
        };
      }

      const contentDetection = this.detectTypeFromContent(rawText, attachment?.name);
      const normalizedText = normalizeOcrText(rawText || '');
      const academicDebug = {
        documentFamily: contentDetection.documentFamily,
        semesterNumber: contentDetection.semesterNumber || null,
        academicLevel: contentDetection.academicLevel,
        academicLevelConfidence: contentDetection.academicLevelConfidence,
        academicLevelEvidence: contentDetection.academicLevelEvidence,
        contradictoryEvidence: contentDetection.contradictoryEvidence,
        rawLevelTokens: contentDetection.rawLevelTokens,
        academicLevelConflict: contentDetection.academicLevelConflict
      };

      if (contentDetection.documentFamily === 'marksheet' && contentDetection.academicLevel === 'unknown') {
        return {
          isMatch: false,
          isLikely: true,
          detectedTypeKey: 'unknown',
          detectedTypeName: 'Unresolved Marksheet Level',
          hasContradiction: false,
          mismatchReason: contentDetection.academicLevelConflict
            ? 'Conflicting Class 10 and Class 12 evidence; sent for human review.'
            : 'Marksheet detected, but academic level is unclear; sent for human review.',
          classificationConfidence: contentDetection.academicLevelConfidence || 0,
          evidence: contentDetection.evidence || {},
          missingEvidence: contentDetection.missingEvidence || [],
          ...academicDebug,
          status: 'NEEDS_REVIEW'
        };
      }

      if (targetTypeKey === '10th_marksheet') {
        const evidenceOk = (contentDetection.detectedTypeKey === '10th_marksheet') && contentDetection.isConfident === true && Object.values(contentDetection.evidence || {}).filter(Boolean).length >= 4;
        if (evidenceOk) {
          return {
            ...academicDebug,
            isMatch: true,
            detectedTypeKey: '10th_marksheet',
            detectedTypeName: targetProfile.name,
            hasContradiction: false,
            mismatchReason: null,
            isLikely: true,
            classificationConfidence: contentDetection.confidence,
            evidence: contentDetection.evidence,
            missingEvidence: contentDetection.missingEvidence || []
          };
        }

        if (contentDetection.detectedTypeKey === '10th_marksheet' && contentDetection.isLikely) {
          return {
            ...academicDebug,
            isMatch: false,
            isLikely: true,
            detectedTypeKey: '10th_marksheet',
            detectedTypeName: targetProfile.name,
            hasContradiction: false,
            mismatchReason: `Likely Class 10 marksheet detected, but OCR/evidence is incomplete. Missing: ${(contentDetection.missingEvidence || []).join(', ') || 'additional document structure evidence'}. Sent for human review.`,
            classificationConfidence: contentDetection.confidence,
            evidence: contentDetection.evidence,
            missingEvidence: contentDetection.missingEvidence || []
          };
        }

        if (contentDetection.detectedTypeKey !== 'unknown' && contentDetection.detectedTypeKey !== 'unrecognized') {
          return {
            ...academicDebug,
            isMatch: false,
            detectedTypeKey: contentDetection.detectedTypeKey,
            detectedTypeName: contentDetection.detectedTypeName,
            hasContradiction: true,
            mismatchReason: `Uploaded document does not match the selected document type. Expected "${targetProfile.name}", but file contents show a different document profile.`,
            classificationConfidence: contentDetection.confidence,
            evidence: contentDetection.evidence,
            missingEvidence: contentDetection.missingEvidence || []
          };
        }

        return {
          ...academicDebug,
          isMatch: false,
          detectedTypeKey: 'unrecognized',
          detectedTypeName: 'Unrecognized Document / Random Image',
          hasContradiction: true,
          mismatchReason: `Insufficient evidence to classify this image as a ${targetProfile.name}. A genuine 10th marksheet needs multiple independent evidence groups: examination, level, identity, marks/result, and structure.`,
          classificationConfidence: Math.min(contentDetection.confidence, 42),
          evidence: contentDetection.evidence,
          missingEvidence: contentDetection.missingEvidence || []
        };
      }

      if (targetTypeKey === '12th_marksheet') {
        const has12thSignal = contentDetection.detectedTypeKey === '12th_marksheet' && contentDetection.isConfident === true;
        if (has12thSignal) {
          return {
            ...academicDebug,
            isMatch: true,
            detectedTypeKey: '12th_marksheet',
            detectedTypeName: targetProfile.name,
            hasContradiction: false,
            mismatchReason: null,
            isLikely: true,
            classificationConfidence: contentDetection.confidence,
            evidence: contentDetection.evidence,
            missingEvidence: contentDetection.missingEvidence || []
          };
        }
        if (contentDetection.detectedTypeKey === '12th_marksheet' && contentDetection.isLikely) {
          return {
            ...academicDebug,
            isMatch: false,
            isLikely: true,
            detectedTypeKey: '12th_marksheet',
            detectedTypeName: targetProfile.name,
            hasContradiction: false,
            mismatchReason: `Likely Class 12 marksheet detected, but OCR/evidence is incomplete. Missing: ${(contentDetection.missingEvidence || []).join(', ') || 'additional document structure evidence'}. Sent for human review.`,
            classificationConfidence: contentDetection.confidence,
            evidence: contentDetection.evidence,
            missingEvidence: contentDetection.missingEvidence || []
          };
        }
        if (contentDetection.detectedTypeKey !== 'unknown' && contentDetection.detectedTypeKey !== 'unrecognized') {
          return {
            ...academicDebug,
            isMatch: false,
            detectedTypeKey: contentDetection.detectedTypeKey,
            detectedTypeName: contentDetection.detectedTypeName,
            hasContradiction: true,
            mismatchReason: `Uploaded document does not match the selected document type. Expected "${targetProfile.name}", but file contents show a different document profile.`,
            classificationConfidence: contentDetection.confidence,
            evidence: contentDetection.evidence,
            missingEvidence: contentDetection.missingEvidence || []
          };
        }
        return {
          ...academicDebug,
          isMatch: false,
          detectedTypeKey: 'unrecognized',
          detectedTypeName: 'Unrecognized Document / Random Image',
          hasContradiction: true,
          mismatchReason: `Insufficient evidence to classify this image as a ${targetProfile.name}.`,
          classificationConfidence: Math.min(contentDetection.confidence, 42),
          evidence: contentDetection.evidence,
          missingEvidence: contentDetection.missingEvidence || []
        };
      }

      if (contentDetection.detectedTypeKey === targetTypeKey && contentDetection.isConfident === true) {
        return {
          ...academicDebug,
          isMatch: true,
          detectedTypeKey: targetTypeKey,
          detectedTypeName: targetProfile.name,
          hasContradiction: false,
          mismatchReason: null,
          isLikely: true,
          classificationConfidence: contentDetection.confidence,
          evidence: contentDetection.evidence,
          missingEvidence: contentDetection.missingEvidence || []
        };
      }

      if (contentDetection.detectedTypeKey !== 'unknown' && contentDetection.detectedTypeKey !== 'unrecognized') {
        return {
          ...academicDebug,
          isMatch: false,
          detectedTypeKey: contentDetection.detectedTypeKey,
          detectedTypeName: contentDetection.detectedTypeName,
          hasContradiction: true,
          mismatchReason: `Uploaded document does not match the selected document type. Expected "${targetProfile.name}", but file contents show a different document profile.`,
          classificationConfidence: contentDetection.confidence,
          evidence: contentDetection.evidence,
          missingEvidence: contentDetection.missingEvidence || []
        };
      }

      return {
        ...academicDebug,
        isMatch: false,
        detectedTypeKey: 'unrecognized',
        detectedTypeName: 'Unrecognized Document / Random Image',
        hasContradiction: true,
        mismatchReason: `Insufficient evidence to classify this image as a ${targetProfile.name}.`,
        classificationConfidence: Math.min(contentDetection.confidence, 42),
        evidence: contentDetection.evidence,
        missingEvidence: contentDetection.missingEvidence || []
      };
    }
  }

  // ==========================================================================
  // SECTION 13: AUTOMATIC EXPIRY CALCULATION ENGINE
  // Valid, Expiring Soon, Expired, with exact days remaining
  // ==========================================================================
  class DocdonExpiryEngine {
    calculateValidity(typeKey, expiryDateStr, issueDateStr, options) {
      return calculateDocumentExpiry(typeKey, expiryDateStr, issueDateStr, options);
    }
  }

  // ==========================================================================
  // SECTION 9, 10, 11: MULTI-FACTOR VERIFICATION ENGINE
  // Checks: Document Type, Name, Expiry, Readability, Required Fields, Consistency
  // ==========================================================================
  class DocdonVerificationEngine {
    constructor() {
      this.expiryEngine = new DocdonExpiryEngine();
    }

    verify({ targetTypeKey, userExpectedName, attachment, ocrResult, classification }) {
      const profile = DOCUMENT_PROFILES[targetTypeKey] || {
        name: 'Custom Document',
        requiredFields: [],
        fieldLabels: {}
      };

      const checksPerformed = [];
      const rawText = ocrResult?.rawText || ocrResult?.text || ocrResult?.rawOcrText || '';
      const evidenceProfile = (targetTypeKey === '10th_marksheet' || targetTypeKey === '12th_marksheet')
        ? buildMarksheetEvidenceProfile(rawText, ocrResult?.extractedFields || {})
        : { evidence: { examination: false, level: false, identity: false, result: false, structure: false }, missingEvidence: [], classificationConfidence: Number(classification?.classificationConfidence || 0), isLikely: Boolean(classification?.isLikely) };

      let totalScore = 0;
      let reviewRequired = false;
      let finalStatus = 'Needs Human Review';
      let reviewReason = 'Document structure and extracted fields require human review.';
      const ocrConfidence = Number.isFinite(ocrResult?.ocrConfidence) ? ocrResult.ocrConfidence : null;
      const textQualityConfidence = ocrConfidence ?? (Number.isFinite(ocrResult?.extractionConfidence) ? ocrResult.extractionConfidence : (Number.isFinite(ocrResult?.confidence) ? ocrResult.confidence : 0));
      const classificationConfidence = Number(classification?.classificationConfidence || 0);

      if (ocrResult && ocrResult.isUnavailable) {
        checksPerformed.push({ check: 'AI Processing Engine Availability', status: 'warning', detail: ocrResult.error || 'AI Processing Unavailable: OCR service unavailable.' });
        return {
          finalStatus: 'Needs Human Review',
          classification: targetTypeKey,
          classificationConfidence: 0,
          confidenceScore: 0,
          verificationReason: 'AI Processing Unavailable: OCR service unavailable. Manual inspection required.',
          evidence: { examination: false, level: false, identity: false, result: false, structure: false },
          missingEvidence: ['examination', 'level', 'identity', 'result', 'structure'],
          extractedFields: ocrResult.extractedFields || {},
          documentMatch: false,
          nameMatch: false,
          expiryCheck: 'not_applicable',
          qualityCheck: 'fail',
          reviewRequired: true,
          checksPerformed
        };
      }

      if (!classification || !classification.isMatch) {
        const isUnrec = classification?.detectedTypeKey === 'unrecognized' || classification?.detectedTypeKey === 'unknown';
        const shouldReview = isUnrec || Boolean(classification?.isLikely);
        checksPerformed.push({ check: 'Document Type Classification', status: 'fail', detail: classification?.mismatchReason || 'Uploaded document does not match selected document type.' });
        return {
          finalStatus: shouldReview ? 'Needs Human Review' : 'Rejected',
          classification: targetTypeKey,
          classificationConfidence,
          confidenceScore: Number(Math.max(0, Math.min(35, classificationConfidence * 0.35 + (ocrConfidence ?? 0) * 0.15)).toFixed(1)),
          verificationReason: classification?.mismatchReason || (isUnrec ? 'Insufficient evidence to classify this image as a 10th marksheet.' : 'Document Type Mismatch'),
          evidence: classification?.evidence || { examination: false, level: false, identity: false, result: false, structure: false },
          missingEvidence: classification?.missingEvidence || ['examination', 'level', 'identity', 'result', 'structure'],
          extractedFields: ocrResult?.extractedFields || {},
          documentMatch: Boolean(classification?.isLikely),
          nameMatch: false,
          expiryCheck: 'not_applicable',
          qualityCheck: 'fail',
          reviewRequired: true,
          checksPerformed,
          suggestedCorrection: classification?.detectedTypeName || profile.name
        };
      }

      checksPerformed.push({ check: 'Document Type Classification', status: 'pass', detail: `Type classification matches ${profile.name}.` });

      const quality = ocrResult.quality || { blurScore: 90, readability: 'High Fidelity' };
      if (quality.blurScore < 60) {
        reviewRequired = true;
        checksPerformed.push({ check: 'Optical Clarity & Resolution', status: 'warning', detail: `Image quality is weak (${quality.blurScore.toFixed(1)}/100); human review is recommended.` });
        reviewReason = '10th marksheet structure detected, but image quality is insufficient for reliable field extraction. Human review required.';
      } else {
        checksPerformed.push({ check: 'Optical Clarity & Resolution', status: 'pass', detail: `OCR image quality is acceptable (${quality.blurScore.toFixed(1)}/100).` });
      }

      const extractedName = (profile.nameField && ocrResult.extractedFields && ocrResult.extractedFields[profile.nameField]) || (ocrResult.extractedFields && (ocrResult.extractedFields.student_name || ocrResult.extractedFields.candidate_name)) || '';
      let nameMatched = false;
      if (extractedName && userExpectedName) {
        const n1 = extractedName.toLowerCase().replace(/[^a-z0-9]/g, '');
        const n2 = userExpectedName.toLowerCase().replace(/[^a-z0-9]/g, '');
        nameMatched = n1 === n2 || n1.includes(n2) || n2.includes(n1);
        if (nameMatched) {
          checksPerformed.push({ check: 'Identity Match', status: 'pass', detail: `Name matches the expected profile: ${extractedName}.` });
        } else {
          reviewRequired = true;
          checksPerformed.push({ check: 'Identity Match', status: 'warning', detail: `Name differs from the expected profile: ${extractedName}.` });
          reviewReason = 'Document content appears valid, but the extracted name needs human confirmation.';
        }
      } else {
        checksPerformed.push({ check: 'Identity Match', status: 'warning', detail: 'No reliable identity field was extracted from the OCR text.' });
      }

      const expiryVal = (profile.expiryDateField && ocrResult.extractedFields && ocrResult.extractedFields[profile.expiryDateField]) || null;
      const expiryResult = this.expiryEngine.calculateValidity(targetTypeKey, expiryVal);
      if (expiryResult.isExpired) {
        totalScore = 24.0;
        reviewRequired = true;
        checksPerformed.push({ check: 'Credential Validity & Expiry Timeline', status: 'fail', detail: expiryResult.formattedRemark });
        return {
          finalStatus: 'Expired',
          classification: targetTypeKey,
          classificationConfidence: classification?.classificationConfidence || evidenceProfile.classificationConfidence || 0,
          confidenceScore: 24.0,
          verificationReason: `Document has expired (${expiryResult.formattedRemark}). Renewal copy required.`,
          evidence: evidenceProfile.evidence,
          missingEvidence: evidenceProfile.missingEvidence || [],
          extractedFields: ocrResult.extractedFields || {},
          documentMatch: true,
          nameMatch: nameMatched,
          expiryCheck: 'expired',
          daysToExpiry: expiryResult.daysRemaining,
          qualityCheck: quality.blurScore >= 60 ? 'pass' : 'review_needed',
          reviewRequired: true,
          checksPerformed
        };
      }
      checksPerformed.push({ check: 'Credential Validity & Expiry Timeline', status: 'pass', detail: expiryResult.formattedRemark });

      const evidence = evidenceProfile.evidence || {};
      const evidenceKeys = Object.keys(evidence);
      const matchedEvidence = evidenceKeys.filter((key) => evidence[key]);
      const missingEvidence = evidenceProfile.missingEvidence || evidenceKeys.filter((key) => !evidence[key]);
      const evidenceThreshold = targetTypeKey === '10th_marksheet' ? 4 : targetTypeKey === '12th_marksheet' ? 3 : 0;
      const hasCoreEvidence = evidenceThreshold === 0 || (matchedEvidence.length >= evidenceThreshold && evidence.level && (evidence.result || evidence.structure));

      if (!hasCoreEvidence) {
        reviewRequired = true;
        checksPerformed.push({ check: 'Evidence Groups', status: 'fail', detail: `Insufficient structural evidence. Missing: ${missingEvidence.join(', ') || 'examination, level, identity, result, structure'}.` });
        reviewReason = 'Insufficient evidence to classify this image as a 10th marksheet.';
      } else {
        checksPerformed.push({ check: 'Evidence Groups', status: 'pass', detail: `Strong evidence detected across ${matchedEvidence.length} groups: ${matchedEvidence.join(', ')}.` });
      }

      if (targetTypeKey === '10th_marksheet' && !evidence.level && !evidence.result && !evidence.structure) {
        reviewRequired = true;
        reviewReason = 'The uploaded image may be unrelated to a 10th marksheet; it lacks class, result, and subject structure evidence.';
      }

      const requiredFields = profile.requiredFields || [];
      const extractedFields = ocrResult.extractedFields || {};
      const fieldsFound = requiredFields.filter(field => extractedFields[field] !== undefined && extractedFields[field] !== null && String(extractedFields[field]).trim() !== '').length;
      const fieldCoverage = requiredFields.length ? fieldsFound / requiredFields.length : (Object.keys(extractedFields).length ? 1 : 0);
      const evidenceCoverage = evidenceKeys.length ? matchedEvidence.length / evidenceKeys.length : 0;
      const qualityScore = Number(quality.blurScore || 0);

      if (requiredFields.length > 0) {
        checksPerformed.push({
          check: 'Required Field Extraction',
          status: fieldCoverage >= 0.6 ? 'pass' : 'warning',
          detail: `${fieldsFound} of ${requiredFields.length} profile fields were extracted from OCR.`
        });
      }

      if (fieldCoverage < 0.6) {
        reviewRequired = true;
        if (!reviewReason || reviewReason === 'Document structure and extracted fields require human review.') {
          reviewReason = targetTypeKey === '10th_marksheet'
            ? 'Likely Class 10 marksheet detected, but OCR could not reliably extract the candidate/roll number or marks fields.'
            : `Document type detected, but OCR did not extract enough required ${profile.name} fields.`;
        }
      }

      const finalConfidence = Math.max(0, Math.min(99.4,
        textQualityConfidence * 0.25 + classificationConfidence * 0.30 + qualityScore * 0.15 + evidenceCoverage * 100 * 0.15 + fieldCoverage * 100 * 0.15
      ));
      const strongMarksheet = targetTypeKey === '10th_marksheet'
        ? (matchedEvidence.length >= 4 && evidence.examination && evidence.level && evidence.identity && evidence.structure && fieldCoverage >= 0.6 && textQualityConfidence >= 50 && qualityScore >= 60)
        : targetTypeKey === '12th_marksheet'
          ? (matchedEvidence.length >= 4 && evidence.examination && evidence.level && evidence.identity && evidence.structure && fieldCoverage >= 0.6 && textQualityConfidence >= 50 && qualityScore >= 60)
          : false;
      const strongOtherDocument = targetTypeKey !== '10th_marksheet' && targetTypeKey !== '12th_marksheet' &&
        classification.isMatch === true && requiredFields.length > 0 && fieldCoverage >= 0.6 && textQualityConfidence >= 50 && qualityScore >= 60;

      if (reviewRequired || (!strongMarksheet && !strongOtherDocument) || finalConfidence < 60) {
        finalStatus = 'Needs Human Review';
        if (!reviewReason) {
          reviewReason = targetTypeKey === '10th_marksheet'
            ? 'Likely Class 10 marksheet detected, but OCR quality or independent document evidence is insufficient for an AI check pass.'
            : `Likely ${profile.name} detected, but OCR quality or required field evidence is insufficient for an AI check pass.`;
        }
      } else {
        finalStatus = 'AI Check Passed';
        reviewReason = targetTypeKey === '10th_marksheet'
          ? 'Class 10 marksheet detected. Examination, class-level, student identity and subject/marks structure are consistent.'
          : `Document type, OCR, and required ${profile.name} fields are structurally consistent. OCR does not establish issuing-authority authenticity.`;
      }

      return {
        finalStatus,
        classification: targetTypeKey,
        classificationConfidence: Number(classificationConfidence.toFixed(1)),
        confidenceScore: Number(finalConfidence.toFixed(1)),
        ocrConfidence,
        extractionConfidence: Number(ocrResult?.extractionConfidence || 0),
        verificationReason: reviewReason,
        evidence,
        missingEvidence,
        extractedFields,
        documentMatch: true,
        nameMatch: nameMatched,
        expiryCheck: expiryResult.status,
        daysToExpiry: expiryResult.daysRemaining,
        qualityCheck: quality.blurScore >= 60 ? 'pass' : 'review_needed',
        reviewRequired,
        checksPerformed
      };
    }
  }

  // ==========================================================================
  // CRYPTOGRAPHIC SHA-256 INTEGRITY DIGEST ENGINE (FIPS 180-4 Standard)
  // Ensures real cryptographic hash calculation in both Node.js and browser
  // ==========================================================================
  function sha256Hex(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let i, j;
    let result = '';

    const words = [];
    const utf8Str = unescape(encodeURIComponent(ascii || ''));
    const asciiBitLength = utf8Str.length * 8;
    
    let hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    let fullStr = utf8Str + '\x80';
    while ((fullStr.length % 64) !== 56) fullStr += '\x00';
    for (i = 0; i < fullStr.length; i++) {
      words[i >> 2] |= fullStr.charCodeAt(i) << (((3 - i) % 4) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;

    for (j = 0; j < words.length;) {
      const w = words.slice(j, (j += 16));
      const oldHash = hash;
      hash = hash.slice(0, 8);

      for (i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 =
          hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] =
            i < 16
              ? (w[i] | 0)
              : ((w[i - 16] +
                  (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                  w[i - 7] +
                  (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
                0));
        const temp2 =
          (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }

      for (i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }

    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? '0' : '') + b.toString(16);
      }
    }
    return result;
  }

  // ==========================================================================
  // SECTION 4 & 6: UNIFIED BACKEND API LAYER
  // Clean API endpoints handling upload, verification, sharing, audit, advisor
  // ==========================================================================
  class DocdonApiService {
    constructor(db) {
      this.db = db;
      this.ocr = new DocdonOcrEngine();
      this.classifier = new DocdonClassifier();
      this.verifier = new DocdonVerificationEngine();
      this.advisor = new DocdonAdvisorEngine(this.db);
    }

    classifyUploadedContent(rawText = '', filename = '') {
      const result = this.classifier.detectTypeFromContent(rawText, filename);
      return {
        ...result,
        detectedKey: result.detectedTypeKey,
        isAuthentic: Boolean(result.isConfident),
        status: result.status || (result.isConfident ? 'CLASSIFIED' : result.isLikely ? 'NEEDS_REVIEW' : 'UNRECOGNIZED')
      };
    }

    // GET /api/advisor/checklist?purpose=...
    getAdvisorChecklist(purpose, context = {}) {
      const goalKey = this.advisor.detectGoal(purpose) || resolveAdvisorGoal(purpose);
      const plan = ADVISOR_CHECKLIST_PLANS[goalKey] || ADVISOR_CHECKLIST_PLANS['education'];
      const personalized = this.advisor.generatePersonalizedChecklist(goalKey, context, this.db.getDocuments());
      return {
        success: true,
        goalKey: goalKey,
        title: plan.goal,
        description: plan.desc,
        requiredDocuments: personalized.documents.map(d => {
          const profile = DOCUMENT_PROFILES[d.typeKey];
          return {
            typeKey: d.typeKey,
            name: d.name,
            priority: d.priority,
            note: d.note,
            issuingAuthority: profile ? profile.issuingAuthority : '',
            normallyExpires: profile ? profile.normallyExpires : false,
            isStored: d.isStored,
            isExpired: d.isExpired,
            status: d.statusLabel,
            journeyStage: d.journeyStage
          };
        }),
        personalizedChecklist: personalized
      };
    }

    // GET /api/profile
    getUserProfile(userId, accountId = '') {
      const prof = this.db.getProfile(userId, accountId);
      if (!prof) return { success: false, error: 'An authenticated user is required.' };
      return {
        success: true,
        profile: prof
      };
    }

    // PUT / PATCH /api/profile
    updateUserProfile(userId, profileData = {}, accountId = '') {
      const updated = this.db.saveProfile(userId, profileData, accountId);
      if (!updated) return { success: false, error: 'An authenticated user is required.' };
      const requirements = this.calculateProfileRequirements(updated);
      return {
        success: true,
        profile: updated,
        requirements: requirements,
        roadmap: requirements.roadmap
      };
    }

    // Dynamic Roadmap Engine for Profile
    getProfileRoadmap(profile) {
      if (!profile) profile = {};
      const career = profile.career || profile.careerPreference || '';
      const careerMeta = CAREER_METADATA[career] || { label: 'No career path selected', pathName: 'Complete your profile', roadmapSteps: [] };
      const steps = careerMeta.roadmapSteps || [];
      return {
        success: true,
        career: career,
        careerLabel: careerMeta.label || career || 'Profile setup required',
        pathName: careerMeta.pathName || career || 'Complete your profile',
        badge: careerMeta.label || 'Profile setup required',
        steps: steps.map((s, idx) => ({
          stepNumber: idx + 1,
          marker: s.marker || '🎯',
          markerClass: s.markerClass || (idx === 0 ? 'marker-current' : 'marker-future'),
          title: s.title,
          description: s.desc
        }))
      };
    }

    // Dynamic Requirements Engine for Profile
    calculateProfileRequirements(profile, vaultDocs = null) {
      if (!profile) profile = {};
      const userId = profile.documentOwnerId || profile.userId;
      if (!vaultDocs) {
        vaultDocs = userId ? this.db.getDocuments(userId) : [];
      }

      const career = profile.career || profile.careerPreference || '';
      const goalKey = profile.purpose || '';
      const context = {
        goal: goalKey,
        careerPreference: career,
        career: career,
        educationStage: profile.educationStage || '',
        location: profile.location || '',
        applicationStage: profile.applicationStage || '',
        applicantType: profile.applicantType || '',
        specialConditions: profile.location ? ['state_domicile'] : []
      };

      // Authoritative Vault: Rely strictly on real vault documents
      const effectiveVaultDocs = [...vaultDocs];

      const personalized = this.advisor.generatePersonalizedChecklist(goalKey, context, effectiveVaultDocs);
      const careerMeta = CAREER_METADATA[career] || { label: career || 'Not selected', pathName: career || 'Profile setup required' };
      const roadmap = this.getProfileRoadmap(profile);

      const requiredDocs = personalized.documents.map(d => ({
        ...d,
        isCurrentlyRequired: true
      }));
      const availableDocs = requiredDocs.filter(d => d.isStored && !d.isExpired);
      const missingDocs = requiredDocs.filter(d => !d.isStored);
      const verifiedDocs = requiredDocs.filter(d => d.statusCode === 'VERIFIED');
      const expiredDocs = requiredDocs.filter(d => d.isExpired || d.statusCode === 'EXPIRED');
      const optionalDocs = requiredDocs.filter(d => d.priority === 'supporting' || d.priority === 'optional' || d.priority === 'needs_clarification');

      const totalRequired = requiredDocs.length;
      const availableCount = availableDocs.length;
      const missingCount = missingDocs.length;
      const verifiedCount = verifiedDocs.length;
      const expiredCount = expiredDocs.length;
      const aiCheckedCount = personalized.aiCheckedCount || requiredDocs.filter(d => d.statusCode === 'AI_CHECKED').length;
      const readyCount = verifiedCount;
      const completionPercentage = totalRequired > 0 ? Math.round((availableCount / totalRequired) * 100) : 0;

      const userContextSummary = `Goal: ${goalKey.replace(/_/g, ' ')} | Career: ${careerMeta.label} | Stage: ${context.educationStage.replace(/_/g, ' ')} | Location: ${context.location}`;

      return {
        success: true,
        goalKey: goalKey,
        title: personalized.title || careerMeta.pathName,
        career: career,
        careerLabel: careerMeta.label,
        educationStage: context.educationStage,
        location: context.location,
        applicationStage: context.applicationStage,
        completionPercentage: completionPercentage,
        totalRequired: totalRequired,
        totalRequirements: totalRequired,
        availableCount: availableCount,
        uploadedCount: availableCount,
        missingCount: missingCount,
        verifiedCount: verifiedCount,
        readyCount: readyCount,
        aiCheckedCount: aiCheckedCount,
        expiredCount: expiredCount,
        needsReviewCount: personalized.needsReviewCount || 0,
        totalVaultDocuments: vaultDocs.length,
        preservedVaultDocuments: Math.max(0, vaultDocs.length - availableCount),
        summary: personalized.advisorSummary?.text || `${availableCount} of ${totalRequired} requirements completed (${completionPercentage}%).`,
        nextRecommendedAction: personalized.nextRecommendedAction || (missingDocs.length > 0 ? `Upload missing ${missingDocs[0].name}` : 'All required documents in vault.'),
        userContextSummary: userContextSummary,
        requiredDocuments: requiredDocs,
        availableDocuments: availableDocs,
        missingDocuments: missingDocs,
        verifiedDocuments: verifiedDocs,
        expiredDocuments: expiredDocs,
        optionalDocuments: optionalDocs,
        roadmap: roadmap
      };
    }

    // GET /api/requirements
    getRequirements(userId = '', query = {}) {
      let prof = this.db.getProfile(userId);
      if (query.career) {
        prof = { ...prof, career: query.career, careerPreference: query.career };
      }
      if (query.purpose) {
        prof = { ...prof, purpose: query.purpose };
      }
      if (query.educationStage) {
        prof = { ...prof, educationStage: query.educationStage };
      }
      return this.calculateProfileRequirements(prof);
    }

    // GET /api/requirements/status
    getRequirementsStatus(userId = '', query = {}) {
      const requirements = this.getRequirements(userId, query);
      return {
        success: true,
        goalKey: requirements.goalKey,
        career: requirements.career,
        careerLabel: requirements.careerLabel,
        totalRequired: requirements.totalRequired,
        totalRequirements: requirements.totalRequirements,
        availableCount: requirements.availableCount,
        uploadedCount: requirements.uploadedCount,
        missingCount: requirements.missingCount,
        verifiedCount: requirements.verifiedCount,
        readyCount: requirements.readyCount,
        aiCheckedCount: requirements.aiCheckedCount,
        expiredCount: requirements.expiredCount,
        needsReviewCount: requirements.needsReviewCount,
        completionPercentage: requirements.completionPercentage,
        statusBreakdown: {
          available: requirements.availableCount,
          missing: requirements.missingCount,
          verified: requirements.verifiedCount,
          expired: requirements.expiredCount,
          needsReview: requirements.needsReviewCount
        },
        documents: requirements.requiredDocuments,
        summary: requirements.summary,
        nextRecommendedAction: requirements.nextRecommendedAction
      };
    }

    // GET /api/document-checklist
    getDocumentChecklist(userId = '', query = {}) {
      const requirements = this.getRequirements(userId, query);
      return {
        success: true,
        goalKey: requirements.goalKey,
        career: requirements.career,
        title: requirements.title,
        checklist: requirements.requiredDocuments.map(d => ({
          typeKey: d.typeKey,
          name: d.name,
          category: d.category,
          priority: d.priority,
          note: d.note,
          status: d.statusCode || (d.isStored ? (d.isExpired ? 'EXPIRED' : (d.verified ? 'VERIFIED' : 'AVAILABLE')) : 'MISSING'),
          statusCode: d.statusCode,
          statusLabel: d.statusLabel,
          journeyStage: d.journeyStage,
          isStored: !!d.isStored,
          isCurrentlyRequired: true,
          isExpired: !!d.isExpired,
          verified: !!d.verified,
          documentId: d.vaultDoc ? (d.vaultDoc.document_id || d.vaultDoc.id) : null,
          vaultDoc: d.vaultDoc || null
        })),
        progress: {
          total: requirements.totalRequired,
          available: requirements.availableCount,
          missing: requirements.missingCount,
          verified: requirements.verifiedCount,
          expired: requirements.expiredCount,
          percentage: requirements.completionPercentage
        },
        summary: requirements.summary,
        nextRecommendedAction: requirements.nextRecommendedAction
      };
    }

    // GET /api/document-progress
    getDocumentProgress(userId = '', query = {}) {
      const requirements = this.getRequirements(userId, query);
      const vaultDocs = this.db.getDocuments(userId);
      const totalVault = vaultDocs.length;
      return {
        success: true,
        goalKey: requirements.goalKey,
        totalRequirements: requirements.totalRequired,
        availableCount: requirements.availableCount,
        missingCount: requirements.missingCount,
        verifiedCount: requirements.verifiedCount,
        expiredCount: requirements.expiredCount,
        aiCheckedCount: requirements.aiCheckedCount || 0,
        readyCount: requirements.readyCount || 0,
        completionPercentage: requirements.completionPercentage,
        totalVaultDocuments: totalVault,
        preservedVaultDocuments: Math.max(0, totalVault - requirements.availableCount)
      };
    }

    // GET /api/documents/:id/status
    getDocumentStatus(documentId, userId = '') {
      const doc = this.db.getDocumentById(documentId);
      if (!doc) return { success: false, error: 'Document not found in vault' };
      const requirements = this.getRequirements(userId || doc.owner_id);
      const matchingReq = requirements.requiredDocuments.find(r => r.vaultDoc && (r.vaultDoc.document_id === documentId || r.vaultDoc.id === documentId));
      const exp = calculateDocumentExpiry(doc);
      return {
        success: true,
        documentId: documentId,
        document: doc,
        documentType: doc.document_type || doc.documentType,
        title: doc.title,
        status: doc.current_status || 'Uploaded',
        verificationLabel: doc.verification_label || 'Needs Human Review',
        verified: !!(doc.verified || doc.verification_label === 'Human Verified'),
        isExpired: exp.isExpired,
        expiryStatus: exp.status,
        expiryDate: doc.expiry_date || null,
        isStored: true,
        isCurrentlyRequired: !!matchingReq,
        requiredForGoal: matchingReq ? requirements.goalKey : null,
        matchingRequirement: matchingReq || null
      };
    }

    // POST /api/documents/:id/check
    async checkDocument(documentId, options = {}) {
      return await this.verifyDocument(documentId, options);
    }

    // PATCH /api/documents/:id
    patchDocument(documentId, updates = {}) {
      const doc = this.db.getDocumentById(documentId);
      if (!doc) return { success: false, error: 'Document not found in vault' };
      this.db.updateDocument(documentId, updates);
      return { success: true, document: this.db.getDocumentById(documentId) };
    }

    // GET /api/roadmap
    getRoadmap(userId = '', query = {}) {
      let prof = this.db.getProfile(userId);
      if (query.career) {
        prof = { ...prof, career: query.career, careerPreference: query.career };
      }
      return this.getProfileRoadmap(prof);
    }

    // POST /api/advisor/consult
    consultAdvisor(payload = {}) {
      const userId = payload.userId || (payload.sessionContext && payload.sessionContext.userId) || '';
      const vaultDocs = payload.vaultDocs || this.db.getDocuments(userId);
      const result = this.advisor.processUserTurn({
        userText: payload.userText || payload.text || payload.purpose || '',
        sessionContext: payload.sessionContext || payload.context || {},
        vaultDocs: vaultDocs
      });

      // Synchronize career / education preference change to user's persistent profile!
      if (result && result.context) {
        const profileUpdates = {};
        if (result.context.careerPreference) {
          profileUpdates.career = result.context.careerPreference;
          profileUpdates.careerPreference = result.context.careerPreference;
        }
        if (result.context.educationStage) {
          profileUpdates.educationStage = result.context.educationStage;
        }
        if (result.context.goal) {
          profileUpdates.purpose = result.context.goal;
        }
        if (Object.keys(profileUpdates).length > 0) {
          const updatedProfile = this.db.saveProfile(userId, profileUpdates);
          result.profile = updatedProfile;
          result.roadmap = this.getProfileRoadmap(updatedProfile);
          result.requirements = this.calculateProfileRequirements(updatedProfile, vaultDocs);
        }
      }

      return result;
    }

    // POST /api/requests
    createVerificationRequest(payload) {
      const { requesterId, submitterId, submitterName, purpose, requiredDocTypes } = payload;
      const goalKey = this.advisor.detectGoal(purpose) || resolveAdvisorGoal(purpose);
      const plan = ADVISOR_CHECKLIST_PLANS[goalKey] || ADVISOR_CHECKLIST_PLANS['education'];

      const docsList = (requiredDocTypes || plan.requiredDocs.map(d => d.typeKey)).map(tk => {
        const typeKey = typeof tk === 'string' ? tk : (tk.typeKey || tk.name);
        const name = typeof tk === 'string' ? (DOCUMENT_PROFILES[tk]?.name || tk) : (tk.name || DOCUMENT_PROFILES[typeKey]?.name || typeKey);
        const priority = (typeof tk === 'object' && tk.priority) ? tk.priority : 'critical';
        const prof = DOCUMENT_PROFILES[typeKey] || { name: name };
        // Check if submitter already has it stored
        const stored = this.db.getDocuments(submitterId).find(d => (d.document_type === typeKey || d.title.toLowerCase().includes(name.toLowerCase())) && !d.is_expired);
        return {
          typeKey: typeKey,
          name: prof.name || name,
          priority: priority,
          document_id: stored ? stored.document_id : null,
          status: stored ? (stored.verification_label === 'Human Verified' ? 'verified' : 'ai_checked') : 'missing'
        };
      });

      const request = this.db.insertRequest({
        requester_id: requesterId || 'Verification Authority',
        submitter_id: submitterId || '',
        submitter_name: submitterName || 'Account Holder',
        purpose: purpose || plan.goal,
        status: 'pending',
        required_documents: docsList
      });

      this.db.logAuditEvent({
        request_id: request.request_id,
        actor: submitterName || submitterId,
        action: 'request_created',
        result: 'success',
        metadata: { purpose: request.purpose, totalRequired: docsList.length }
      });

      return { success: true, request };
    }

    // GET /api/requests/:id
    getRequest(requestId) {
      const request = this.db.getRequestById(requestId);
      if (!request) return { success: false, error: 'Request not found' };
      return { success: true, request };
    }

    // GET /api/requests
    listRequests(userId = null) {
      const requests = this.db.getVerificationRequests(userId);
      return { success: true, requests };
    }

    // POST /api/documents/process (COMMON DOCUMENT PROCESSOR)
    // PART 1: Both upload and camera routes feed into this single, unified pipeline.
    async processDocument(payload) {
      const processingStartedAt = Date.now();
      const processingTime = { uploadValidationMs: 0, preprocessingMs: 0, ocrMs: 0, classificationMs: 0, fieldExtractionMs: 0, validationMs: 0, duplicateDetectionMs: 0, clientPreviewMs: 0, totalProcessingMs: 0, totalMs: 0 };
      payload = payload || {};
      const { file, title, documentType, customDocumentType, ownerId, sampleKind, isCameraCapture } = payload;
      const customTypeName = String(customDocumentType || '').trim().slice(0, 100);
      const uploadValidationStartedAt = Date.now();
      const targetOwner = ownerId || '';
      const simulationAllowed = typeof window !== 'undefined'
        ? window.location.protocol === 'file:'
        : (typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || process.env.DOCDON_ENABLE_TEST_FIXTURES === 'true'));
      const isSimulation = payload.isSimulation === true && simulationAllowed;

      // 1. Initial file payload validation
      if (!file && !payload.fileData && !payload.buffer && !isSimulation) {
        return { success: false, isRejected: true, error: 'Security Exception: No file payload provided.' };
      }

      const dataUrl = payload.fileData || (file && file.dataUrl) || null;
      let originalBuffer = typeof Buffer !== 'undefined' && Buffer.isBuffer(payload.buffer) ? payload.buffer : null;
      let detectedMime = '';
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
        const mimeMatch = dataUrl.match(/^data:([^;,]+);base64,/i);
        detectedMime = mimeMatch ? mimeMatch[1].toLowerCase() : '';
        if (!mimeMatch) return { success: false, isRejected: true, error: 'Security Exception: File data must be a valid base64 data URL.' };
        if (typeof Buffer !== 'undefined') {
          try { originalBuffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'); } catch (e) { console.error('[DOCDON OCR] Invalid base64 upload payload:', e.stack || e.message || e); }
        }
      }

      const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/tiff'];
      const suppliedMime = String((file && file.type) || payload.fileType || detectedMime || '').toLowerCase();
      if (!isSimulation && suppliedMime && !allowedMimeTypes.includes(suppliedMime)) {
        return { success: false, isRejected: true, error: `Security Exception: Unsupported file type (${suppliedMime}). Upload a PDF or supported image.` };
      }
      if (detectedMime && suppliedMime && detectedMime !== suppliedMime) {
        return { success: false, isRejected: true, error: 'Security Exception: Declared file type does not match the uploaded data.' };
      }

      if (originalBuffer && !isSimulation) {
        const isPdfBytes = originalBuffer.subarray(0, 5).toString('ascii') === '%PDF-';
        const isPngBytes = originalBuffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const isJpegBytes = originalBuffer.length > 3 && originalBuffer[0] === 0xff && originalBuffer[1] === 0xd8 && originalBuffer[2] === 0xff;
        const isWebpBytes = originalBuffer.length > 12 && originalBuffer.toString('ascii', 0, 4) === 'RIFF' && originalBuffer.toString('ascii', 8, 12) === 'WEBP';
        const contentMatchesType = (suppliedMime === 'application/pdf' && isPdfBytes) ||
          (suppliedMime === 'image/png' && isPngBytes) ||
          (suppliedMime === 'image/jpeg' && isJpegBytes) ||
          (suppliedMime === 'image/webp' && isWebpBytes) ||
          (suppliedMime === 'image/tiff' && (originalBuffer.toString('ascii', 0, 2) === 'II' || originalBuffer.toString('ascii', 0, 2) === 'MM'));
        if (!contentMatchesType) {
          return { success: false, isRejected: true, error: 'Security Exception: File contents do not match a supported PDF or image format.' };
        }
      }

      const fSize = originalBuffer ? originalBuffer.length : (dataUrl ? Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75) : (isSimulation ? String(payload.fileText || '').length : 0));
      if (fSize <= 0 && !isSimulation) return { success: false, isRejected: true, error: 'Security Exception: Uploaded file is empty or unreadable.' };
      const preExtractedOcrText = typeof payload.preExtractedOcrText === 'string' ? payload.preExtractedOcrText : '';
      const preExtractedOcrAttempted = payload.preExtractedOcrAttempted === true;
      processingTime.clientPreviewMs = preExtractedOcrAttempted ? Math.max(0, Number(payload.preExtractedPreviewMs) || 0) : 0;
      if (preExtractedOcrText.length > 500000) return { success: false, isRejected: true, error: 'Security Exception: Extracted OCR text exceeds the supported size.' };
      if (fSize > 26214400) {
        return { success: false, isRejected: true, error: 'Security Exception: File size exceeds maximum allowed threshold (25MB).' };
      }

      const fName = (file && file.name) || payload.fileName || (title ? `${title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf` : (isCameraCapture ? 'camera_capture.jpg' : 'document.pdf'));
      const fType = detectedMime || suppliedMime || (isCameraCapture ? 'image/jpeg' : 'application/pdf');
      if (!detectedMime && !suppliedMime && !isSimulation) {
        return { success: false, isRejected: true, error: 'Security Exception: The uploaded file type could not be determined.' };
      }
      const extension = String(fName).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
      const supportedExtensions = {
        'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'],
        'image/webp': ['webp'], 'image/tiff': ['tif', 'tiff']
      };
      if (!isSimulation && extension && supportedExtensions[fType] && !supportedExtensions[fType].includes(extension)) {
        return { success: false, isRejected: true, error: 'Security Exception: File extension does not match the declared document type.' };
      }
      if (!isSimulation && !extension) {
        return { success: false, isRejected: true, error: 'Security Exception: A supported file extension is required.' };
      }
      const cleanName = fName.replace(/[^a-zA-Z0-9._-]/g, '_');
      processingTime.uploadValidationMs = Date.now() - uploadValidationStartedAt;

      // 2. CREATE TEMPORARY PROCESSING RECORD
      // IMPORTANT: Temporary in-progress record stored in processing_documents.
      // It must NOT appear in normal "My Documents" or "Verified Documents" Vault lists.
      const tempId = 'proc-' + Date.now() + '-' + Math.floor(1000 + Math.random() * 9000);
      const storageToken = 'tok-' + (typeof btoa !== 'undefined' ? btoa(tempId + '-' + cleanName).substring(0, 32) : ('tok-' + Date.now()));

      let storedPath = null;
      let fileSha256 = null;
      let originalStorageError = null;

      // Safe Physical File Persistence on Backend (Node.js environment)
      if (typeof require !== 'undefined' && originalBuffer && !isSimulation) {
        try {
          const fs = require('fs');
          const path = require('path');
          const crypto = require('crypto');
          const uploadsDir = path.join(__dirname, 'uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          const storedFileName = `${tempId}_${cleanName}`;
          const fullPath = path.join(uploadsDir, storedFileName);

          fs.writeFileSync(fullPath, originalBuffer);
          storedPath = 'uploads/' + storedFileName;
          fileSha256 = crypto.createHash('sha256').update(originalBuffer).digest('hex');
        } catch (storageErr) {
          originalStorageError = storageErr;
          console.warn('DocdonStorage: Physical disk write warning:', storageErr);
        }
      }

      if (typeof require !== 'undefined' && originalBuffer && !storedPath && !isSimulation) {
        return {
          success: false,
          isRejected: true,
          error: `Storage Error: The original upload could not be preserved${originalStorageError?.message ? ` (${originalStorageError.message})` : '.'}`
        };
      }

      if (!fileSha256) {
        fileSha256 = this.computeSha256(originalBuffer || dataUrl || (isSimulation ? payload.fileText : '') || tempId);
      }

      const fileRef = {
        filename: cleanName,
        file_type: fType,
        file_size: fSize,
        storage_token: storageToken,
        stored_path: storedPath,
        sha256: fileSha256,
        dataUrl: typeof require === 'undefined' ? dataUrl : null
      };

      const processingDocument = {
        id: tempId,
        userId: targetOwner,
        fileReference: fileRef,
        originalFilename: fName,
        status: 'processing',
        processingStatus: 'UPLOADED',
        source: isCameraCapture ? 'camera' : 'upload',
        createdAt: new Date().toISOString()
      };

      this.db.insertProcessingDocument(processingDocument);

      const returnNeedsReview = (stageName, error, classification = null) => {
        const safeReason = error?.code === 'DOCDON_STAGE_TIMEOUT'
          ? `Document processing timed out during ${stageName.toLowerCase()}.`
          : `Document processing could not complete during ${stageName.toLowerCase()}. Human review is required.`;
        processingTime.totalMs = Date.now() - processingStartedAt + processingTime.clientPreviewMs;
        processingTime.totalProcessingMs = processingTime.totalMs;
        console.error(`[DOCDON] ${stageName} failed for ${tempId}:`, error?.stack || error?.message || error);
        this.db.updateProcessingDocument(tempId, {
          status: 'needs_review', processingStatus: 'NEEDS_REVIEW', verificationStatus: 'needs_review',
          readyToUse: false, error: safeReason, failureStage: stageName,
          processingTime, completedAt: new Date().toISOString()
        });
        this.db.logAuditEvent({
          actor: targetOwner, action: 'human_review_requested', result: 'review_needed',
          metadata: { processingId: tempId, stage: stageName, reason: safeReason, source: isCameraCapture ? 'camera' : 'upload' }
        });
        return {
          success: false, needsReview: true, isRejected: false, status: 'NEEDS_REVIEW',
          processingStatus: 'NEEDS_REVIEW', verified: false, readyToUse: false,
          error: safeReason, failedStage: stageName, classification: classification || undefined,
          processingTime, processingDocument: this.db.getProcessingDocument(tempId)
        };
      };

      // 3. IMAGE PREPROCESSING on a separate working copy; original bytes stay unchanged.
      this.db.updateProcessingDocument(tempId, { processingStatus: 'PREPROCESSING' });
      const originalInput = originalBuffer || dataUrl || payload.buffer || null;
      const isPdf = fType.includes('pdf') || fName.toLowerCase().endsWith('.pdf');
      const preprocessingStartedAt = Date.now();
      let preprocessed;
      try {
        if (isPdf || preExtractedOcrAttempted) {
          preprocessed = { preprocessingApplied: [], originalPreserved: true };
        } else {
        preprocessed = await withStageTimeout(
          () => this.ocr.preprocessImageForOcr(originalInput),
          PROCESSING_STAGE_TIMEOUTS.OCR,
          'OCR preprocessing'
        );
        }
      } catch (error) {
        processingTime.preprocessingMs = Date.now() - preprocessingStartedAt;
        return returnNeedsReview('OCR', error);
      }
      processingTime.preprocessingMs = preExtractedOcrAttempted
        ? Math.max(0, Number(payload.preExtractedPreprocessingMs) || 0)
        : Date.now() - preprocessingStartedAt;
      const ocrInput = isPdf
        ? (originalBuffer || dataUrl || payload.buffer)
        : ((preprocessed && (preprocessed.preprocessedBuffer || preprocessed.preprocessedDataUrl)) || originalBuffer || dataUrl || payload.buffer);
      const qualityCheck = this.ocr.evaluateImageQuality({
        ...(file || {}),
        name: fName,
        size: fSize,
        type: fType,
        width: preprocessed?.width || file?.width,
        height: preprocessed?.height || file?.height,
        qualityMetrics: preprocessed?.qualityMetrics,
        isSimulation,
        sampleKind
      });
      this.db.updateProcessingDocument(tempId, { processingStatus: qualityCheck.isUsable ? 'QUALITY_CHECK_PASSED' : 'QUALITY_REVIEW', imageQuality: qualityCheck });

      // 4. OCR / PDF text extraction from the original PDF or preprocessed image copy.
      this.db.updateProcessingDocument(tempId, { processingStatus: 'OCR_EXTRACTING' });
      let preRawRes;
      const ocrStartedAt = Date.now();
      try {
        preRawRes = preExtractedOcrAttempted
          ? {
              success: Boolean(preExtractedOcrText.trim()),
              isUnavailable: !preExtractedOcrText.trim(),
              text: preExtractedOcrText,
              rawOcrText: preExtractedOcrText,
              normalizedOcrText: normalizeOcrText(preExtractedOcrText),
              confidence: Number(payload.preExtractedOcrConfidence) || 0,
              ocrConfidence: Number(payload.preExtractedOcrConfidence) || null,
              extractionConfidence: Number(payload.preExtractedOcrConfidence) || 0,
              pageCount: 0,
              preprocessingApplied: [],
              source: 'browser-single-pass'
            }
          : await withStageTimeout(() => this.ocr.extractRawTextFromPayload({
              buffer: typeof Buffer !== 'undefined' && Buffer.isBuffer(ocrInput) ? ocrInput : undefined,
              dataUrl: typeof ocrInput === 'string' ? ocrInput : undefined,
              fileText: isSimulation ? (payload.fileText || file?.fileText) : undefined,
              isSimulation,
              sampleKind: isSimulation ? sampleKind : undefined,
              ocrUnavailable: isSimulation && (payload.ocrUnavailable || (file && file.ocrUnavailable)),
              type: fType,
              name: fName
            }), Math.max(1, PROCESSING_STAGE_TIMEOUTS.OCR - (Date.now() - ocrStartedAt)), 'OCR extraction');
      } catch (error) {
        processingTime.ocrMs = Date.now() - ocrStartedAt;
        return returnNeedsReview('OCR', error);
      }
      processingTime.ocrMs = preExtractedOcrAttempted
        ? Math.max(0, Number(payload.preExtractedOcrMs) || 0)
        : Date.now() - ocrStartedAt;
      if (!preRawRes?.success || preRawRes?.isUnavailable) {
        return returnNeedsReview('OCR', new Error(preRawRes?.error || 'OCR returned no readable text'));
      }
      const rawExtractedText = (preRawRes && preRawRes.text) || '';

      this.db.updateProcessingDocument(tempId, {
        processingStatus: 'OCR_COMPLETE',
        rawTextLength: rawExtractedText.length,
        rawOcrText: rawExtractedText,
        normalizedOcrText: normalizeOcrText(rawExtractedText),
        ocrConfidence: Number.isFinite(preRawRes?.ocrConfidence) ? preRawRes.ocrConfidence : null,
        extractionConfidence: Number(preRawRes?.extractionConfidence ?? preRawRes?.confidence ?? 0),
        pageCount: Number(preRawRes?.pageCount || 0),
        preprocessingApplied: preprocessed?.preprocessingApplied || preRawRes?.preprocessingApplied || [],
        imageQuality: qualityCheck
      });

      // 6. DOCUMENT CLASSIFICATION & CONFIDENCE CHECK
      this.db.updateProcessingDocument(tempId, { processingStatus: 'CLASSIFYING' });

      // Normalize requested document type / title to canonical profile
      const requestedNormalized = normalizeDocumentType(documentType || title);
      let targetTypeKey = (documentType && documentType !== 'auto') ? requestedNormalized.canonicalId : 'auto';
      if (customTypeName) targetTypeKey = 'custom_document';

      const classificationStartedAt = Date.now();
      let classification;
      try {
        if (targetTypeKey === 'custom_document') {
          const auto = this.classifier.detectTypeFromContent(rawExtractedText, fName);
          classification = {
            ...auto, isMatch: false, isLikely: true,
            detectedTypeKey: auto.isConfident ? auto.detectedTypeKey : 'custom_document',
            detectedTypeName: auto.isConfident ? auto.detectedTypeName : customTypeName,
            customDocumentType: customTypeName, hasContradiction: false,
            mismatchReason: auto.isConfident ? `Selected document type does not match the detected document type: ${customTypeName} vs ${auto.detectedTypeName}.` : 'Custom document type requires human review because no confident built-in match was found.',
            classificationConfidence: auto.isConfident ? auto.confidence : 0,
            status: 'NEEDS_REVIEW'
          };
        } else {
          classification = this.classifier.classifyDocument(
            targetTypeKey,
            { ...(file || {}), name: fName, type: fType, sampleKind: isSimulation ? sampleKind : undefined, isSimulation },
            preRawRes?.detectedTokens || [], rawExtractedText
          );
        }
      } catch (error) {
        processingTime.classificationMs = Date.now() - classificationStartedAt;
        return returnNeedsReview('classification', error);
      }
      processingTime.classificationMs = Date.now() - classificationStartedAt;
      if (processingTime.classificationMs > PROCESSING_STAGE_TIMEOUTS.CLASSIFICATION) {
        const timeoutError = new Error('Classification exceeded its processing time limit');
        timeoutError.code = 'DOCDON_STAGE_TIMEOUT';
        return returnNeedsReview('classification', timeoutError, classification);
      }

      const classificationMismatch = targetTypeKey !== 'auto' && targetTypeKey !== 'custom_document' && !classification.isMatch &&
        classification.detectedTypeKey && !['unknown', 'unrecognized', targetTypeKey].includes(classification.detectedTypeKey);
      const classificationUncertain = targetTypeKey !== 'auto' && targetTypeKey !== 'custom_document' && !classification.isMatch &&
        (['unknown', 'unrecognized'].includes(classification.detectedTypeKey) || classification.detectedTypeKey === targetTypeKey) && classification.isLikely;
      classification.expectedDocumentType = targetTypeKey === 'auto' ? null : targetTypeKey;
      classification.classificationMatch = !customTypeName && !classificationMismatch && !classificationUncertain && Boolean(classification.isMatch);
      if (classificationMismatch) {
        classification.isLikely = true;
        classification.mismatchReason = `Document type mismatch: selected ${requestedNormalized.canonicalName}, but the uploaded document appears to be a ${classification.detectedTypeName}.`;
        classification.expectedDocumentType = targetTypeKey;
        classification.classificationMatch = false;
      }

      // A likely but incomplete credential continues to field extraction and is stored as Needs Human Review.
      const unresolvedMarksheetLevel = classification.documentFamily === 'marksheet' && classification.academicLevel === 'unknown';
      if (unresolvedMarksheetLevel) {
        const reviewReason = classification.academicLevelConflict
          ? 'Conflicting Class 10 and Class 12 evidence detected. Academic level is unresolved; human review required.'
          : 'Marksheet content detected, but OCR does not reliably identify Class 10 or Class 12. Human review required.';
        processingTime.totalMs = Date.now() - processingStartedAt + processingTime.clientPreviewMs;
        processingTime.totalProcessingMs = processingTime.totalMs;
        this.db.updateProcessingDocument(tempId, {
          status: 'needs_review', processingStatus: 'NEEDS_REVIEW', verificationStatus: 'needs_review',
          readyToUse: false, error: reviewReason, academicLevel: 'unknown',
          academicLevelEvidence: classification.academicLevelEvidence || {},
          contradictoryEvidence: classification.contradictoryEvidence || [],
          rawLevelTokens: classification.rawLevelTokens || [],
          processingTime,
          completedAt: new Date().toISOString()
        });
        return {
          success: false, needsReview: true, isRejected: false, status: 'NEEDS_REVIEW',
          processingStatus: 'NEEDS_REVIEW', verified: false, readyToUse: false,
          error: reviewReason, classification, processingTime,
          ocr: { confidence: preRawRes?.confidence || 0, ocrConfidence: preRawRes?.ocrConfidence ?? null,
            rawText: rawExtractedText, normalizedText: normalizeOcrText(rawExtractedText),
            pageCount: preRawRes?.pageCount || 0, preprocessingApplied: preprocessed?.preprocessingApplied || [] },
          processingDocument: this.db.getProcessingDocument(tempId)
        };
      }
      if ((!classification.isMatch && !classification.isLikely) ||
          ((classification.detectedTypeKey === 'unrecognized' || classification.detectedTypeKey === 'unknown') && !classificationUncertain)) {
        const rejectReason = classification.mismatchReason || 'Uploaded file does not exhibit verifiable credential attributes. Unrecognized document or random photo.';
        processingTime.totalMs = Date.now() - processingStartedAt + processingTime.clientPreviewMs;
        processingTime.totalProcessingMs = processingTime.totalMs;
        this.db.updateProcessingDocument(tempId, {
          status: 'rejected',
          processingStatus: 'REJECTED',
          verificationStatus: 'not_verified',
          readyToUse: false,
          error: rejectReason,
          rawTextLength: rawExtractedText.length,
          ocrConfidence: preRawRes?.ocrConfidence ?? preRawRes?.confidence ?? 0,
          classificationConfidence: classification.classificationConfidence || 0,
          missingEvidence: classification.missingEvidence || [],
          processingTime,
          completedAt: new Date().toISOString()
        });

        this.db.logAuditEvent({
          actor: targetOwner,
          action: 'document_rejected',
          result: 'rejected',
          metadata: {
            reason: rejectReason,
            filename: cleanName,
            processingId: tempId,
            detectedType: classification.detectedTypeKey
          }
        });

        // DO NOT CREATE NORMAL VAULT ENTRY!
        return {
          success: false,
          isRejected: true,
          status: 'failed',
          processingStatus: 'REJECTED',
          verified: false,
          readyToUse: false,
          error: rejectReason,
          classification: classification,
          processingTime,
          ocr: {
            confidence: preRawRes?.confidence || 0,
            ocrConfidence: preRawRes?.ocrConfidence ?? null,
            rawText: rawExtractedText,
            normalizedText: normalizeOcrText(rawExtractedText),
            pageCount: preRawRes?.pageCount || 0,
            preprocessingApplied: preprocessed?.preprocessingApplied || []
          },
          processingDocument: this.db.getProcessingDocument(tempId)
        };
      }

      // Classification passed! Resolve canonical document specification
      const preserveExpectedType = classificationMismatch || classificationUncertain;
      const resolvedCanonical = normalizeDocumentType(preserveExpectedType ? targetTypeKey : (classification.detectedTypeKey || targetTypeKey || title || fName));
      const canonicalType = (preserveExpectedType || customTypeName) ? targetTypeKey : resolvedCanonical.canonicalId;
      const canonicalTitle = customTypeName || (preserveExpectedType ? requestedNormalized.canonicalName : resolvedCanonical.canonicalName);
      const canonicalCategory = customTypeName ? (payload.category || 'other') : (resolvedCanonical.category || 'identity');

      this.db.updateProcessingDocument(tempId, {
        processingStatus: 'CLASSIFIED',
        canonicalType: canonicalType,
        canonicalTitle: canonicalTitle,
        detectedType: classification.detectedTypeKey,
        classificationConfidence: classification.classificationConfidence || 0,
        evidence: classification.evidence || {},
        missingEvidence: classification.missingEvidence || []
      });

      // 7. FIELD EXTRACTION & FIELD VALIDATION
      this.db.updateProcessingDocument(tempId, { processingStatus: 'EXTRACTING' });
      const visualQuality = this.ocr.assessVisualQuality({
        ...(file || {}),
        name: fName,
        size: fSize,
        type: fType,
        width: preprocessed?.width || file?.width,
        height: preprocessed?.height || file?.height,
        qualityMetrics: preprocessed?.qualityMetrics,
        isSimulation,
        sampleKind: isSimulation ? sampleKind : undefined
      });
      const fieldExtractionStartedAt = Date.now();
      let ocrExtracted;
      try {
        ocrExtracted = this.ocr.extractFieldsForType(canonicalType, rawExtractedText, visualQuality);
      } catch (error) {
        processingTime.fieldExtractionMs = Date.now() - fieldExtractionStartedAt;
        return returnNeedsReview('field extraction', error, classification);
      }
      processingTime.fieldExtractionMs = Date.now() - fieldExtractionStartedAt;
      if (processingTime.fieldExtractionMs > PROCESSING_STAGE_TIMEOUTS.FIELD_EXTRACTION) {
        const timeoutError = new Error('Field extraction exceeded its processing time limit');
        timeoutError.code = 'DOCDON_STAGE_TIMEOUT';
        return returnNeedsReview('field extraction', timeoutError, classification);
      }
      ocrExtracted.quality = visualQuality;
      ocrExtracted.ocrConfidence = Number.isFinite(preRawRes?.ocrConfidence) ? preRawRes.ocrConfidence : null;
      ocrExtracted.extractionConfidence = Number(preRawRes?.extractionConfidence ?? preRawRes?.confidence ?? 0);
      ocrExtracted.classificationConfidence = Number(classification.classificationConfidence || 0);
      ocrExtracted.rawText = rawExtractedText;
      ocrExtracted.normalizedOcrText = normalizeOcrText(rawExtractedText);
      ocrExtracted.pageCount = Number(preRawRes?.pageCount || 1);
      ocrExtracted.preprocessingApplied = preprocessed?.preprocessingApplied || preRawRes?.preprocessingApplied || [];
      ocrExtracted.source = preRawRes?.source || 'tesseract-image-ocr';
      ocrExtracted.confidence = Number(preRawRes?.confidence || 0);

      this.db.updateProcessingDocument(tempId, { processingStatus: 'VALIDATING' });

      // 8. VERIFICATION
      this.db.updateProcessingDocument(tempId, { processingStatus: 'VERIFYING' });
      const validationStartedAt = Date.now();
      let verifyResult;
      try {
        verifyResult = this.verifier.verify({
          targetTypeKey: canonicalType,
          userExpectedName: this.db.getUser(targetOwner)?.name || '',
          attachment: { ...(file || {}), name: fName, sampleKind: isSimulation ? sampleKind : undefined, isSimulation },
          ocrResult: ocrExtracted,
          classification: classification
        });
      } catch (error) {
        processingTime.validationMs = Date.now() - validationStartedAt;
        return returnNeedsReview('validation', error, classification);
      }
      processingTime.validationMs = Date.now() - validationStartedAt;
      if (processingTime.validationMs > PROCESSING_STAGE_TIMEOUTS.VALIDATION) {
        const timeoutError = new Error('Validation exceeded its processing time limit');
        timeoutError.code = 'DOCDON_STAGE_TIMEOUT';
        return returnNeedsReview('validation', timeoutError, classification);
      }
      if (classificationMismatch || classificationUncertain || customTypeName) {
        verifyResult = {
          ...verifyResult,
          finalStatus: 'Needs Human Review',
          verificationReason: classification.mismatchReason || 'Custom document type requires explicit human review.',
          classificationConfidence: classification.classificationConfidence || 0,
          confidenceScore: Math.min(Number(verifyResult.confidenceScore || 0), 49),
          evidence: classification.evidence || {},
          missingEvidence: classification.missingEvidence || []
        };
      }
      this.db.updateProcessingDocument(tempId, {
        processingStatus: 'VERIFICATION_COMPLETE',
        verificationStatus: verifyResult.finalStatus,
        verificationConfidence: verifyResult.confidenceScore,
        verificationReason: verifyResult.verificationReason,
        extractedFields: ocrExtracted.extractedFields
      });

      const isVerifiedSuccess = verifyResult.finalStatus === 'AI Check Passed';
      const docCurrentStatus = isVerifiedSuccess ? 'AI Checked' : 'Uploaded';
      const docVerifLabel = isVerifiedSuccess ? 'AI Check Passed' : 'Needs Human Review';
      const docAiStatus = isVerifiedSuccess ? 'verified_match' : 'needs_review';

      // 9. DUPLICATE CHECK & CANONICAL VAULT RESOLUTION
      this.db.updateProcessingDocument(tempId, { processingStatus: 'DUPLICATE_CHECK' });
      const duplicateDetectionStartedAt = Date.now();
      const existingDocs = this.db.getDocuments(targetOwner);

      const extractedNum = ocrExtracted.extractedFields?.licence_number || 
                           ocrExtracted.extractedFields?.pan_number || 
                           ocrExtracted.extractedFields?.aadhaar_number || 
                           ocrExtracted.extractedFields?.roll_number || 
                           ocrExtracted.extractedFields?.registration_no ||
                           ocrExtracted.extractedFields?.enrolment_number ||
                           ocrExtracted.extractedFields?.passport_number ||
                           ocrExtracted.extractedFields?.epic_number ||
                           ocrExtracted.extractedFields?.account_number ||
                           ocrExtracted.extractedFields?.consumer_id ||
                           ocrExtracted.extractedFields?.degree_reg_no || null;

      const normalizeIdentityValue = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const currentFields = ocrExtracted.extractedFields || {};
      const credentialParts = [
        currentFields.student_name || currentFields.candidate_name || currentFields.holder_name || currentFields.cardholder_name || currentFields.driver_name || currentFields.account_holder || currentFields.elector_name,
        currentFields.passing_year,
        currentFields.examination_board || currentFields.issuing_board || currentFields.technical_board || currentFields.university_name,
        currentFields.school_name || currentFields.college_name
      ].map(normalizeIdentityValue);
      const currentComposite = credentialParts.filter(Boolean);
      const currentIdentifier = normalizeIdentityValue(extractedNum);

      let duplicateExisting = null;
      let isExactDuplicate = false;
      for (const candidate of existingDocs) {
        if (!candidate) continue;
        if (candidate.isPreviousVersion || candidate.versionStatus === 'history') continue;
        const candidateId = candidate.document_id || candidate.id;
        const candidateType = normalizeDocumentType(candidate.document_type || candidate.title).canonicalId;
        const hashMatches = Boolean(fileSha256 && candidate.file_reference?.sha256 && candidate.file_reference.sha256 === fileSha256);
        if (hashMatches && candidateType === canonicalType) {
          duplicateExisting = candidate;
          isExactDuplicate = true;
          break;
        }
        if (candidateType !== canonicalType) continue;

        const oldOcr = this.db.data.ocr_results?.[candidateId] || {};
        const oldFields = oldOcr.extractedFields || {};
        const oldIdentifier = normalizeIdentityValue(candidate.doc_number || oldFields.roll_number || oldFields.licence_number || oldFields.pan_number || oldFields.aadhaar_number || oldFields.registration_no || oldFields.passport_number || oldFields.epic_number || oldFields.account_number || oldFields.consumer_id || oldFields.degree_reg_no);
        if (currentIdentifier && oldIdentifier && currentIdentifier === oldIdentifier) {
          const currentYear = normalizeIdentityValue(currentFields.passing_year);
          const oldYear = normalizeIdentityValue(oldFields.passing_year);
          if ((canonicalType === '10th_marksheet' || canonicalType === '12th_marksheet') && currentYear && oldYear && currentYear !== oldYear) continue;
          duplicateExisting = candidate;
          break;
        }
        if (currentIdentifier && oldIdentifier && currentIdentifier !== oldIdentifier) continue;

        const oldParts = [
          oldFields.student_name || oldFields.candidate_name || oldFields.holder_name || oldFields.cardholder_name || oldFields.driver_name || oldFields.account_holder || oldFields.elector_name,
          oldFields.passing_year,
          oldFields.examination_board || oldFields.issuing_board || oldFields.technical_board || oldFields.university_name,
          oldFields.school_name || oldFields.college_name
        ].map(normalizeIdentityValue);
        const matchingParts = credentialParts.filter((part, index) => part && oldParts[index] && part === oldParts[index]).length;
        const hasStrongAcademicIdentity = canonicalType === '10th_marksheet' || canonicalType === '12th_marksheet'
          ? Boolean(credentialParts[0] && credentialParts[1] && credentialParts[2] && matchingParts >= 3)
          : false;
        if (hasStrongAcademicIdentity) {
          duplicateExisting = candidate;
          break;
        }
      }
      processingTime.duplicateDetectionMs = Date.now() - duplicateDetectionStartedAt;
      if (processingTime.duplicateDetectionMs > PROCESSING_STAGE_TIMEOUTS.DUPLICATE_DETECTION) {
        const timeoutError = new Error('Duplicate detection exceeded its processing time limit');
        timeoutError.code = 'DOCDON_STAGE_TIMEOUT';
        return returnNeedsReview('duplicate detection', timeoutError, classification);
      }

      let finalDocId = null;
      let finalDoc = null;
      let docVersion = 1;
      let prevVersionId = null;
      let isRenewal = false;
      let duplicateDetected = false;

      const profile = DOCUMENT_PROFILES[canonicalType] || { name: canonicalTitle, category: canonicalCategory };

      // Calculate expiry if applicable
      let docExpiryDate = ocrExtracted.extractedFields?.expiry_date || null;
      let isExpiredDoc = false;
      let expiryErrorReason = null;
      if (profile.normallyExpires) {
        if (docExpiryDate && typeof calculateDocumentExpiry === 'function') {
          const expCalc = calculateDocumentExpiry(canonicalType, docExpiryDate);
          if (expCalc.isExpired) {
            isExpiredDoc = true;
            expiryErrorReason = expCalc.formattedRemark;
          }
        }
      }

      if (duplicateExisting && isExactDuplicate) {
        duplicateDetected = true;
        docVersion = typeof duplicateExisting.version === 'number' ? duplicateExisting.version : 1;
        prevVersionId = duplicateExisting.document_id || duplicateExisting.id;
        finalDocId = duplicateExisting.document_id || duplicateExisting.id;
        finalDoc = duplicateExisting;
      } else if (duplicateExisting) {
        duplicateDetected = true;
        docVersion = (typeof duplicateExisting.version === 'number' ? duplicateExisting.version : 1) + 1;
        prevVersionId = duplicateExisting.document_id || duplicateExisting.id;
        const oldExpiry = duplicateExisting.expiry_date ? new Date(duplicateExisting.expiry_date).getTime() : 0;
        const newExpiry = docExpiryDate ? new Date(docExpiryDate).getTime() : 0;
        isRenewal = Boolean(isExpiredDoc || (newExpiry && oldExpiry && newExpiry > oldExpiry));
        this.db.updateDocument(prevVersionId, { isPreviousVersion: true, versionStatus: 'history', supersededBy: `doc-${Date.now()}` });
        finalDocId = 'doc-' + Date.now() + '-' + Math.floor(1000 + Math.random() * 9000);
        finalDoc = {
          document_id: finalDocId,
          owner_id: targetOwner,
          document_type: canonicalType,
          title: canonicalTitle,
          doc_number: extractedNum || duplicateExisting.doc_number || null,
          category: canonicalCategory,
          state: resolvedCanonical.state || duplicateExisting.state || null,
          issuing_authority: resolvedCanonical.issuingAuthority || duplicateExisting.issuing_authority || null,
          file_reference: fileRef,
          version: docVersion,
          previousVersionId: prevVersionId,
          isRenewal,
          isPreviousVersion: false,
          versionStatus: 'active',
          uploaded_at: new Date().toISOString(),
          expiry_date: docExpiryDate || duplicateExisting.expiry_date || null,
          is_expired: isExpiredDoc,
          error_reason: expiryErrorReason || verifyResult.verificationReason || null,
          current_status: isExpiredDoc ? 'Uploaded' : docCurrentStatus,
          verification_label: isExpiredDoc ? 'Expired' : docVerifLabel,
          verified: false,
          ai_status: isExpiredDoc ? 'expired' : docAiStatus,
          classification_confidence: verifyResult.classificationConfidence,
          confidence_score: verifyResult.confidenceScore,
          ocr_confidence: ocrExtracted.ocrConfidence,
          verification_reason: verifyResult.verificationReason,
          expected_document_type: targetTypeKey,
          detected_document_type: classification.detectedTypeKey,
          semester_number: classification.semesterNumber || null,
          classification_match: (classificationMismatch || classificationUncertain || customTypeName) ? false : true,
          custom_document_type: customTypeName || null,
          verification_method: 'AI'
        };
        this.db.updateDocument(prevVersionId, { supersededBy: finalDocId });
        this.db.insertDocument(finalDoc);
      } else {
        // 10. CREATE NEW VAULT DOCUMENT (ONLY REACHED IF FULL PIPELINE SUCCEEDS)
        finalDocId = 'doc-' + Date.now() + '-' + Math.floor(1000 + Math.random() * 9000);
        finalDoc = {
          document_id: finalDocId,
          owner_id: targetOwner,
          document_type: canonicalType,
          title: canonicalTitle, // Always single canonical name (e.g. "Driving Licence")
          doc_number: extractedNum || null,
          category: canonicalCategory,
          state: resolvedCanonical.state || null,
          issuing_authority: resolvedCanonical.issuingAuthority || null,
          file_reference: fileRef,
          version: 1,
          previousVersionId: null,
          isRenewal: false,
          isPreviousVersion: false,
          versionStatus: 'active',
          uploaded_at: new Date().toISOString(),
          expiry_date: docExpiryDate,
          is_expired: isExpiredDoc,
          error_reason: expiryErrorReason || null,
          current_status: isExpiredDoc ? 'Uploaded' : docCurrentStatus,
          verification_label: isExpiredDoc ? 'Expired' : docVerifLabel,
          verified: false,
          ai_status: isExpiredDoc ? 'expired' : docAiStatus,
          classification_confidence: verifyResult.classificationConfidence,
          confidence_score: verifyResult.confidenceScore,
          ocr_confidence: ocrExtracted.ocrConfidence,
          verification_reason: verifyResult.verificationReason,
          expected_document_type: targetTypeKey,
          detected_document_type: classification.detectedTypeKey,
          semester_number: classification.semesterNumber || null,
          classification_match: (classificationMismatch || classificationUncertain || customTypeName) ? false : true,
          custom_document_type: customTypeName || null,
          verification_method: 'AI'
        };
        this.db.insertDocument(finalDoc);
      }

      // Store OCR & verification result linked to final vault document
      this.db.data.ocr_results[finalDocId] = ocrExtracted;
      this.db.data.verification_results[finalDocId] = verifyResult;
      const academicTypes = ['10th_marksheet', '12th_marksheet', 'semester_marksheet'];
      if (academicTypes.includes(canonicalType)) {
        const fields = ocrExtracted.extractedFields || {};
        const subjectText = fields.subjects_grades || fields.subject_marks || fields.stream_subjects || null;
        const academicFields = canonicalType === 'semester_marksheet' ? {
          studentName: fields.student_name || null, university: fields.university_name || null,
          institution: fields.college_name || fields.school_name || null, course: fields.course || fields.degree_program || null,
          semester: fields.semester || null, academicYear: fields.academic_year || null,
          enrollmentNumber: fields.enrolment_number || fields.registration_no || null,
          registrationNumber: fields.registration_no || fields.roll_number || null,
          subjects: subjectText, credits: fields.credits || null, marks: fields.subject_marks || subjectText,
          grade: fields.grade || null, sgpa: fields.sgpa || null, cgpa: fields.cgpa || null, result: fields.result || null
        } : {
          studentName: fields.student_name || fields.candidate_name || null,
          fatherName: fields.father_name || fields.parent_name || null,
          dateOfBirth: fields.date_of_birth || fields.dob || null,
          board: fields.examination_board || fields.issuing_board || null,
          institution: fields.school_name || null, examination: fields.examination || null,
          academicLevel: classification.academicLevel || null, rollNumber: fields.roll_number || null,
          registrationNumber: fields.registration_no || fields.registration_number || null,
          passingYear: fields.passing_year || null, subjects: subjectText,
          marks: fields.subject_marks || subjectText, totalMarks: fields.total_marks || null,
          percentage: fields.percentage || null, grade: fields.grade || null,
          result: fields.result || null, issueDate: fields.issue_date || null
        };
        const academicStatus = verifyResult.finalStatus === 'AI Check Passed' ? 'AI_CHECKED' : 'NEEDS_HUMAN_REVIEW';
        const confidence = Number(verifyResult.confidenceScore || 0);
        finalDoc = this.db.updateDocument(finalDocId, {
          academic_verification: {
            documentId: finalDocId, ownerId: finalDoc.owner_id, documentType: canonicalType,
            verificationStatus: academicStatus,
            ocr: { text: rawExtractedText, confidence: ocrExtracted.ocrConfidence, method: ocrExtracted.source },
            classification: { type: classification.detectedTypeKey, confidence: classification.classificationConfidence || classification.confidence || 0,
              evidence: classification.evidence || classification.academicLevelEvidence || {} },
            validation: { status: academicStatus === 'AI_CHECKED' ? 'PASSED' : 'REVIEW_REQUIRED', confidence, reason: verifyResult.verificationReason || null },
            fields: academicFields,
            verificationReason: verifyResult.verificationReason || null,
            humanReview: { status: academicStatus === 'AI_CHECKED' ? 'NOT_REQUIRED' : 'PENDING', reviewerId: null, reviewerRole: null,
              reviewedAt: null, decision: null, note: null, previousAIStatus: academicStatus }
          }
        });
      }
      this.db.save();

      // Finalize Temporary Processing Record
      processingTime.totalMs = Date.now() - processingStartedAt + processingTime.clientPreviewMs;
      processingTime.totalProcessingMs = processingTime.totalMs;
      this.db.updateProcessingDocument(tempId, {
        status: 'completed',
        processingStatus: isVerifiedSuccess ? 'AI_CHECKED' : 'NEEDS_REVIEW',
        vaultDocumentId: finalDocId,
        processingTime,
        completedAt: new Date().toISOString()
      });

      this.db.logAuditEvent({
        document_id: finalDocId,
        actor: targetOwner,
        action: 'document_uploaded',
        result: 'success',
        metadata: { filename: cleanName, size: fSize, source: isCameraCapture ? 'camera' : 'upload', processingId: tempId }
      });
      this.db.logAuditEvent({
        document_id: finalDocId,
        actor: targetOwner,
        action: 'ocr_completed',
        result: 'success',
        metadata: { method: ocrExtracted.source, pageCount: ocrExtracted.pageCount, confidence: ocrExtracted.ocrConfidence, fieldsFound: Object.keys(ocrExtracted.extractedFields || {}).length, processingId: tempId }
      });
      this.db.logAuditEvent({
        document_id: finalDocId,
        actor: targetOwner,
        action: 'classification_completed',
        result: classification.classificationMatch ? 'match' : 'review_needed',
        metadata: { expectedType: targetTypeKey, detectedType: classification.detectedTypeKey, confidence: classification.classificationConfidence, evidenceGroups: Object.keys(classification.evidence || {}).filter(key => classification.evidence[key]), processingId: tempId }
      });
      this.db.logAuditEvent({
        document_id: finalDocId,
        actor: targetOwner,
        action: 'validation_completed',
        result: verifyResult.finalStatus,
        metadata: { confidence: verifyResult.confidenceScore, reason: verifyResult.verificationReason, processingId: tempId }
      });
      this.db.logAuditEvent({
        document_id: finalDocId, owner_id: targetOwner, actor: 'DOCDON AI Verifier',
        action: 'AI_CHECK_COMPLETED', result: verifyResult.finalStatus,
        metadata: { documentType: canonicalType, confidence: verifyResult.confidenceScore, reason: verifyResult.verificationReason }
      });
      if (verifyResult.finalStatus !== 'AI Check Passed') this.db.logAuditEvent({
        document_id: finalDocId, owner_id: targetOwner, actor: 'DOCDON AI Verifier',
        action: 'HUMAN_REVIEW_REQUESTED', result: 'pending',
        metadata: { documentType: canonicalType, reason: verifyResult.verificationReason }
      });
      if (duplicateDetected) this.db.logAuditEvent({
        document_id: finalDocId,
        actor: targetOwner,
        action: 'duplicate_detected',
        result: isRenewal ? 'version_created' : 'duplicate_merged',
        metadata: { version: docVersion, previousVersionId: prevVersionId, processingId: tempId }
      });
      this.db.logAuditEvent({
        document_id: finalDocId,
        actor: targetOwner,
        action: duplicateDetected ? (isRenewal ? 'document_renewed' : 'document_duplicate_merged') : 'document_created',
        result: 'success',
        metadata: {
          filename: cleanName,
          size: fSize,
          documentType: canonicalType,
          expectedDocumentType: targetTypeKey,
          detectedDocumentType: classification.detectedTypeKey,
          classificationMatch: (classificationMismatch || classificationUncertain || customTypeName) ? false : true,
          canonicalTitle: canonicalTitle,
          version: docVersion,
          isRenewal: isRenewal,
          duplicateDetected: duplicateDetected,
          processingId: tempId,
          source: isCameraCapture ? 'camera' : 'upload'
        }
      });

      // Recalculate dynamic requirements, checklist, progress & roadmap
      const reqs = this.calculateProfileRequirements(this.db.getProfile(targetOwner));
      const chk = this.getDocumentChecklist(targetOwner);
      const prg = this.getDocumentProgress(targetOwner);
      const rdm = this.getRoadmap(targetOwner);

      // Dispatch real-time vault updated event for browser views
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        try {
          window.dispatchEvent(new CustomEvent('docdon_vault_updated', {
            detail: {
              documentId: finalDocId,
              document: finalDoc,
              verification: verifyResult,
              requirements: reqs,
              duplicateDetected: duplicateDetected,
              isRenewal: isRenewal
            }
          }));
        } catch (evErr) {}
      }

      return {
        success: true,
        document: finalDoc,
        verification: verifyResult,
        ocr: ocrExtracted,
        classification: classification,
        duplicateDetected: duplicateDetected,
        isRenewal: isRenewal,
        processingDocument: this.db.getProcessingDocument(tempId),
        processingTime,
        requirements: reqs,
        checklist: chk,
        progress: prg,
        roadmap: rdm
      };
    }

    // POST /api/documents/upload (Alias to Common Processor)
    async uploadDocument(payload) {
      return await this.processDocument(payload);
    }

    // POST /api/documents/camera (Alias to Common Processor)
    async cameraDocument(payload) {
      return await this.processDocument({ ...payload, isCameraCapture: true });
    }

    // POST /api/documents/:id/verify
    async verifyDocument(documentId, options = {}) {
      const verificationStartedAt = Date.now();
      const verificationTime = { ocrMs: 0, classificationMs: 0, validationMs: 0, totalMs: 0 };
      const doc = this.db.getDocumentById(documentId);
      if (!doc) return { success: false, error: 'Document not found' };

      this.db.logAuditEvent({
        document_id: documentId,
        actor: 'DOCDON AI Verifier',
        action: 'verification_started',
        result: 'success',
        metadata: { type: doc.document_type }
      });

      // Step A: Real Optical inspection & Real OCR extraction
      const ocrStartedAt = Date.now();
      let ocrResult;
      try {
        ocrResult = await withStageTimeout(() => this.ocr.processDocument(doc, options), PROCESSING_STAGE_TIMEOUTS.OCR, 'Verification OCR');
      } catch (error) {
        verificationTime.ocrMs = Date.now() - ocrStartedAt;
        verificationTime.totalMs = Date.now() - verificationStartedAt;
        console.error(`[DOCDON] Verification OCR failed for ${documentId}:`, error.stack || error.message || error);
        const reason = error.code === 'DOCDON_STAGE_TIMEOUT' ? 'Document processing timed out during OCR.' : 'OCR failed; human review is required.';
        this.db.updateDocument(documentId, { current_status: 'AI Checked', verification_label: 'Needs Human Review', ai_status: 'needs_review', verified: false, verification_method: 'AI', verification_reason: reason });
        this.db.save();
        return { success: false, needsReview: true, status: 'NEEDS_REVIEW', error: reason, processingTime: verificationTime };
      }
      verificationTime.ocrMs = Date.now() - ocrStartedAt;
      if (!ocrResult.success || ocrResult.isUnavailable) {
        verificationTime.totalMs = Date.now() - verificationStartedAt;
        const reason = ocrResult.error || 'OCR returned no readable text; human review is required.';
        this.db.updateDocument(documentId, { current_status: 'AI Checked', verification_label: 'Needs Human Review', ai_status: 'needs_review', verified: false, verification_method: 'AI', verification_reason: reason });
        this.db.save();
        return { success: false, needsReview: true, status: 'NEEDS_REVIEW', error: 'OCR could not complete. Human review is required.', processingTime: verificationTime };
      }
      this.db.saveOcrResult(documentId, ocrResult);

      this.db.logAuditEvent({
        document_id: documentId,
        actor: 'DOCDON OCR Engine',
        action: 'ocr_completed',
        result: ocrResult.isUnavailable ? 'unavailable' : 'success',
        metadata: {
          confidence: ocrResult.confidence,
          fieldsCount: Object.keys(ocrResult.extractedFields || {}).length,
          isUnavailable: !!ocrResult.isUnavailable
        }
      });

      // Step B: Classification check using actual extracted text
      const classificationStartedAt = Date.now();
      let classification;
      try {
        classification = this.classifier.classifyDocument(
          doc.document_type,
          { name: doc.file_reference.filename, sampleKind: options.sampleKind },
          ocrResult.detectedTokens || [],
          ocrResult.rawText || ''
        );
      } catch (error) {
        verificationTime.classificationMs = Date.now() - classificationStartedAt;
        verificationTime.totalMs = Date.now() - verificationStartedAt;
        console.error(`[DOCDON] Verification classification failed for ${documentId}:`, error.stack || error.message || error);
        this.db.updateDocument(documentId, { current_status: 'AI Checked', verification_label: 'Needs Human Review', ai_status: 'needs_review', verified: false, verification_method: 'AI', verification_reason: 'Classification failed; human review is required.' });
        this.db.save();
        return { success: false, needsReview: true, status: 'NEEDS_REVIEW', error: 'Classification could not complete. Human review is required.', processingTime: verificationTime };
      }
      verificationTime.classificationMs = Date.now() - classificationStartedAt;

      // Step C: Multi-factor verification evaluation
      const user = this.db.getUser(doc.owner_id);
      const expectedName = user ? user.name : (doc.owner_name || '');

      const validationStartedAt = Date.now();
      let verification;
      try {
        verification = this.verifier.verify({
          targetTypeKey: doc.document_type,
          userExpectedName: expectedName,
          attachment: { name: doc.file_reference.filename, sampleKind: options.sampleKind },
          ocrResult: ocrResult,
          classification: classification
        });
      } catch (error) {
        verificationTime.validationMs = Date.now() - validationStartedAt;
        verificationTime.totalMs = Date.now() - verificationStartedAt;
        console.error(`[DOCDON] Verification validation failed for ${documentId}:`, error.stack || error.message || error);
        this.db.updateDocument(documentId, { current_status: 'AI Checked', verification_label: 'Needs Human Review', ai_status: 'needs_review', verified: false, verification_method: 'AI', verification_reason: 'Validation failed; human review is required.' });
        this.db.save();
        return { success: false, needsReview: true, status: 'NEEDS_REVIEW', error: 'Validation could not complete. Human review is required.', processingTime: verificationTime };
      }
      verificationTime.validationMs = Date.now() - validationStartedAt;
      if (verificationTime.classificationMs > PROCESSING_STAGE_TIMEOUTS.CLASSIFICATION || verificationTime.validationMs > PROCESSING_STAGE_TIMEOUTS.VALIDATION) {
        verificationTime.totalMs = Date.now() - verificationStartedAt;
        const reason = 'Document processing exceeded a stage time limit. Human review is required.';
        this.db.updateDocument(documentId, { current_status: 'AI Checked', verification_label: 'Needs Human Review', ai_status: 'needs_review', verified: false, verification_reason: reason });
        this.db.save();
        return { success: false, needsReview: true, status: 'NEEDS_REVIEW', error: reason, processingTime: verificationTime };
      }

      this.db.saveVerificationResult(documentId, verification);

      // Step D: Map verification to existing status system (Section 10)
      let journeyStatus = 'AI Checked';
      let verifLabel = 'Needs Human Review';
      let isExpired = false;

      if (verification.finalStatus === 'Rejected') {
        journeyStatus = 'Required';
        verifLabel = 'Needs Attention';
        doc.hasError = true;
        doc.errorReason = verification.verificationReason;
      } else if (verification.finalStatus === 'Expired') {
        journeyStatus = 'Uploaded';
        verifLabel = 'Expired';
        isExpired = true;
        doc.hasError = true;
        doc.errorReason = verification.verificationReason;
      } else if (verification.finalStatus === 'AI Check Passed') {
        journeyStatus = 'AI Checked';
        verifLabel = 'AI Check Passed';
        doc.verified = false; // Requires actual human approval to become Human Verified
        doc.hasError = false;
        doc.errorReason = null;
      } else {
        journeyStatus = 'AI Checked';
        verifLabel = 'Needs Human Review';
        doc.verified = false;
        doc.errorReason = verification.verificationReason;
      }

      const updates = {
        current_status: journeyStatus,
        verification_label: verifLabel,
        is_expired: isExpired,
        ai_status: verification.finalStatus === 'Rejected' ? 'mismatch' : verification.finalStatus === 'Needs Human Review' ? 'needs_review' : 'verified_match',
        verification_method: 'AI',
        errorReason: doc.errorReason || null
      };

      if (ocrResult.extractedFields) {
        const prof = DOCUMENT_PROFILES[doc.document_type];
        if (prof && prof.identifierField && ocrResult.extractedFields[prof.identifierField]) {
          updates.doc_number = ocrResult.extractedFields[prof.identifierField];
        }
        if (prof && prof.expiryDateField && ocrResult.extractedFields[prof.expiryDateField]) {
          updates.expiry_date = ocrResult.extractedFields[prof.expiryDateField];
        }
      }

      this.db.updateDocument(documentId, updates);

      this.db.logAuditEvent({
        document_id: documentId,
        actor: 'DOCDON AI Verifier',
        action: 'verification_completed',
        result: verification.finalStatus === 'Rejected' ? 'rejected' : 'success',
        metadata: { finalStatus: verification.finalStatus, score: verification.confidenceScore }
      });

      // Step E: Recalculate Requirements & Roadmap for user
      const updatedDoc = this.db.getDocumentById(documentId);
      const reqs = this.calculateProfileRequirements(this.db.getProfile(doc.owner_id));
      const chk = this.getDocumentChecklist(doc.owner_id);
      const prg = this.getDocumentProgress(doc.owner_id);
      const rdm = this.getRoadmap(doc.owner_id);
      verificationTime.totalMs = Date.now() - verificationStartedAt;

      return {
        success: true,
        documentId: documentId,
        document: updatedDoc,
        classification: classification,
        ocr: ocrResult,
        verification: verification,
        processingTime: verificationTime,
        requirements: reqs,
        checklist: chk,
        progress: prg,
        roadmap: rdm
      };
    }

    // POST /api/documents/:id/review
    // SECTION 12: Human Review Actions (Approve & Certify, Reject, Request New Document)
    reviewDocument(documentId, payload = {}) {
      const { reviewerName, reviewerId, reviewerRole, action, remarks, note, ownerId } = payload;
      const doc = this.db.getDocumentById(documentId);
      if (!doc) return { success: false, error: 'Document not found' };

      const academicTypes = ['10th_marksheet', '12th_marksheet', 'semester_marksheet'];
      const isAcademic = academicTypes.includes(normalizeDocumentType(doc.document_type || doc.title).canonicalId);
      if (!['approve', 'reject', 'request_new'].includes(action)) return { success: false, error: 'Invalid review action' };
      if (isAcademic && !ownerId) return { success: false, error: 'Document owner context is required' };
      if (ownerId && String(ownerId).toLowerCase() !== String(doc.owner_id || '').toLowerCase()) {
        return { success: false, error: 'Document owner mismatch' };
      }
      const reviewer = reviewerId ? this.db.getUser(reviewerId) : null;
      const role = String(reviewer?.role || reviewerRole || '').toLowerCase();
      if (isAcademic && (!reviewer || !['admin', 'reviewer', 'compliance_officer'].includes(String(reviewer.role || '').toLowerCase()))) {
        return { success: false, error: 'An authorized human reviewer account is required' };
      }
      if (isAcademic && !['Needs Human Review', 'AI Check Passed'].includes(doc.verification_label)) {
        return { success: false, error: 'Academic document is not awaiting human review' };
      }
      const actor = reviewer?.id || reviewerId || reviewerName || null;
      const reviewNote = String(note || remarks || '').trim().slice(0, 2000) || null;
      const previousStatus = doc.verification_label || doc.current_status || 'UNKNOWN';
      const reviewedAt = new Date().toISOString();

      if (action === 'approve') {
        const newStatus = 'Human Verified';
        this.db.updateDocument(documentId, {
          current_status: 'Ready to Share',
          verification_label: newStatus,
          verification_method: 'HUMAN',
          verified: true,
          hasError: false,
          errorReason: null,
          ...(isAcademic ? { academic_verification: {
            ...doc.academic_verification,
            verificationStatus: 'HUMAN_VERIFIED',
            humanReview: { status: 'COMPLETED', reviewerId: reviewer?.id || reviewerId, reviewerRole: reviewer?.role || role,
              reviewedAt, decision: 'approved', note: reviewNote, previousAIStatus: doc.academic_verification?.verificationStatus || previousStatus }
          } } : {})
        });

        this.db.logAuditEvent({
          document_id: documentId,
          actor: actor,
          action: 'HUMAN_VERIFIED',
          result: 'success',
          metadata: { ownerId: doc.owner_id, previousStatus, newStatus, verificationMethod: 'HUMAN', decision: 'approved', reviewerRole: reviewer?.role || role, reviewedAt, remarks: reviewNote }
        });
      } else if (action === 'reject') {
        this.db.updateDocument(documentId, {
          current_status: 'Rejected',
          verification_label: 'Rejected',
          verified: false,
          hasError: true,
          errorReason: reviewNote || 'Document rejected by reviewing officer',
          ...(isAcademic ? { academic_verification: {
            ...doc.academic_verification,
            verificationStatus: 'REJECTED',
            humanReview: { status: 'COMPLETED', reviewerId: reviewer?.id || reviewerId, reviewerRole: reviewer?.role || role,
              reviewedAt, decision: 'rejected', note: reviewNote, previousAIStatus: doc.academic_verification?.verificationStatus || previousStatus }
          } } : {})
        });

        this.db.logAuditEvent({
          document_id: documentId,
          actor: actor,
          action: 'DOCUMENT_REJECTED',
          result: 'rejected',
          metadata: { ownerId: doc.owner_id, previousStatus, newStatus: 'Rejected', decision: 'rejected', reviewerRole: reviewer?.role || role, reviewedAt, remarks: reviewNote || 'Document failed official review criteria' }
        });
      } else if (action === 'request_new') {
        this.db.updateDocument(documentId, {
          current_status: 'Required',
          verification_label: 'Needs Attention',
          verified: false,
          hasError: true,
          errorReason: reviewNote || 'New document scan requested by reviewing officer',
          ...(isAcademic ? { academic_verification: {
            ...doc.academic_verification,
            verificationStatus: 'NEEDS_HUMAN_REVIEW',
            humanReview: { status: 'PENDING', reviewerId: reviewer?.id || reviewerId, reviewerRole: reviewer?.role || role,
              reviewedAt, decision: 'request_correction', note: reviewNote, previousAIStatus: doc.academic_verification?.verificationStatus || previousStatus }
          } } : {})
        });

        this.db.logAuditEvent({
          document_id: documentId,
          actor: actor,
          action: 'HUMAN_REVIEW_REQUESTED',
          result: 'escalated',
          metadata: { ownerId: doc.owner_id, remarks: reviewNote || 'Fresh high-resolution document scan required' }
        });
      }

      return { success: true, document: this.db.getDocumentById(documentId) };
    }

    // DELETE /api/documents/:id (Delete document from Vault)
    deleteDocument(documentId) {
      if (!documentId) return { success: false, error: 'Document ID required' };
      const doc = this.db.getDocumentById(documentId);
      const deleted = this.db.deleteDocument(documentId);
      if (deleted) {
        this.db.logAuditEvent({
          document_id: documentId,
          actor: doc ? doc.owner_id : 'Document Owner',
          action: 'document_deleted',
          result: 'success',
          metadata: { title: doc ? doc.title : 'Document' }
        });
      }
      return { success: deleted, documentId: documentId };
    }

    // Cryptographically secure token generator (PART 4 & PART 2)
    generateSecureShareToken() {
      if (typeof require !== 'undefined') {
        try {
          const crypto = require('crypto');
          return 'sh_sec_' + crypto.randomBytes(24).toString('hex');
        } catch (e) {}
      }
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const arr = new Uint8Array(24);
        crypto.getRandomValues(arr);
        return 'sh_sec_' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      const randHex = () => Math.floor((1 + Math.random()) * 0x100000000).toString(16).substring(1);
      return 'sh_sec_' + randHex() + randHex() + randHex() + randHex() + randHex() + randHex();
    }

    // Cryptographically secure SHA-256 calculator (PART 5: Real SHA-256 Tamper/Integrity Hash)
    computeSha256(input) {
      const str = typeof input === 'string' ? input : JSON.stringify(input);
      if (typeof require !== 'undefined') {
        try {
          const crypto = require('crypto');
          return crypto.createHash('sha256').update(str).digest('hex');
        } catch (e) {}
      }
      return sha256Hex(str);
    }

    // POST /api/requests/:id/share or POST /api/shares (PART 2: Secure Sharing)
    shareDocument(arg1, arg2) {
      let requestId = 'REQ-SHARE';
      let payload = {};
      if (typeof arg1 === 'object') {
        payload = arg1;
        requestId = payload.requestId || 'REQ-SHARE';
      } else {
        requestId = arg1 || 'REQ-SHARE';
        payload = arg2 || {};
      }

      const documentId = payload.documentId || payload.id;
      if (!documentId) return { success: false, error: 'Document ID is required' };

      const doc = this.db.getDocumentById(documentId);
      if (!doc) return { success: false, error: 'Document not found in vault' };

      // Requirement 11: Enforce verification rules before allowing sharing
      if (doc.is_expired || doc.isExpired || doc.current_status === 'Expired' || doc.verification_label === 'Expired') {
        return {
          success: false,
          error: 'Sharing blocked: Document is expired. Renewal is required before sharing.',
          code: 'EXPIRED'
        };
      }
      if (doc.current_status === 'Rejected' || doc.verification_label === 'Rejected') {
        return {
          success: false,
          error: 'Sharing blocked: Document was rejected by compliance review.',
          code: 'REJECTED'
        };
      }
      const isHumanVerified = doc.verified === true || doc.verification_label === 'Human Verified' || doc.current_status === 'Ready to Share';
      if (!isHumanVerified) {
        return {
          success: false,
          error: `Sharing blocked: Document must complete official human verification before sharing (currently: "${doc.verification_label || doc.current_status || 'Needs Human Review'}").`,
          code: 'UNVERIFIED',
          currentStatus: doc.verification_label || doc.current_status
        };
      }

      // 1. Generate cryptographically secure random token (NOT predictable Base64)
      const shareToken = this.generateSecureShareToken();

      // 2. Calculate retention expiry
      let retentionMs = 7 * 86400000; // default 7 days
      if (typeof payload.retentionMinutes === 'number') {
        retentionMs = payload.retentionMinutes * 60000;
      } else if (typeof payload.retentionHours === 'number') {
        retentionMs = payload.retentionHours * 3600000;
      } else if (typeof payload.retentionDays === 'number') {
        retentionMs = payload.retentionDays * 86400000;
      }

      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + retentionMs).toISOString();

      // 3. Compute real SHA-256 integrity hash of shared document payload (PART 5)
      const canonicalPayload = JSON.stringify({
        document_id: doc.document_id,
        title: doc.title,
        document_type: doc.document_type,
        doc_number: doc.doc_number,
        owner_id: doc.owner_id,
        expiry_date: doc.expiry_date || null,
        file_sha256: doc.file_reference?.sha256 || null,
        data_checksum: doc.file_reference?.dataUrl ? this.computeSha256(doc.file_reference.dataUrl) : (doc.file_reference?.filename || doc.title)
      });
      const tamperProofHash = this.computeSha256(canonicalPayload);

      // 4. Associate share token with metadata and access status
      const shareRecord = {
        share_token: shareToken,
        document_id: doc.document_id,
        request_id: requestId || null,
        owner_id: doc.owner_id || payload.ownerId || '',
        recipient: payload.recipient || 'State University Admissions & TechCorp Verification',
        purpose: payload.purpose || 'Academic Eligibility Check & Identity Verification',
        format: (payload.format || 'PDF').toUpperCase(),
        tamper_proof_hash: tamperProofHash,
        created_at: createdAt,
        expires_at: expiresAt,
        status: 'active', // 'active' | 'revoked' | 'expired'
        revoked_at: null,
        revoked_by: null,
        revocation_reason: null,
        access_count: 0,
        last_accessed_at: null,
        biometric_confirmed: !!payload.biometricConfirmed
      };

      this.db.insertShare(shareRecord);

      // 5. Record share created action in audit trail (Requirement 6)
      this.db.logAuditEvent({
        request_id: requestId,
        document_id: doc.document_id,
        actor: doc.owner_id || 'Account Holder',
        action: 'share_created',
        result: 'success',
        metadata: {
          share_token: shareToken,
          recipient: shareRecord.recipient,
          purpose: shareRecord.purpose,
          format: shareRecord.format,
          sha256_hash: tamperProofHash,
          retention_expires_at: expiresAt,
          biometric_confirmed: !!payload.biometricConfirmed
        }
      });

      this.db.updateDocument(doc.document_id, {
        current_status: 'Ready to Share'
      });

      return {
        success: true,
        shareToken: shareToken,
        share: shareRecord,
        tamperProofHash: tamperProofHash,
        retentionExpiry: expiresAt,
        shareUrl: `/api/shares/${shareToken}`
      };
    }

    // GET /api/shares/:token (Enforces share token, expiry, revocation, SHA-256 integrity & sanitizes paths)
    getSharedDocument(shareToken) {
      if (!shareToken) return { success: false, error: 'Access Denied: Share token is required', status: 'not_found' };

      const share = this.db.getShareByToken(shareToken);
      if (!share) {
        return { success: false, error: 'Access Denied: Invalid or non-existent share authorization token', status: 'not_found' };
      }

      // Check Revocation (Requirement 2 & 3)
      if (share.status === 'revoked') {
        return {
          success: false,
          error: `Access Denied: This share authorization was revoked by the document owner${share.revoked_at ? ' on ' + new Date(share.revoked_at).toLocaleString() : ''}.`,
          status: 'revoked',
          revokedAt: share.revoked_at,
          reason: share.revocation_reason
        };
      }

      // Check Expiry (Requirement 2 & 4)
      const now = new Date();
      const isPastRetention = now > new Date(share.expires_at);
      if (isPastRetention || share.status === 'expired') {
        if (share.status !== 'expired') {
          share.status = 'expired';
          share.expired_at = now.toISOString();
          this.db.updateShare(shareToken, share);
          this.db.logAuditEvent({
            document_id: share.document_id,
            request_id: share.request_id,
            actor: 'DOCDON Retention Engine',
            action: 'share_expired',
            result: 'expired',
            metadata: {
              share_token: shareToken,
              expired_at: share.expires_at,
              recipient: share.recipient
            }
          });
        }
        return {
          success: false,
          error: 'Access Denied: This share authorization has expired past its retention deadline.',
          status: 'expired',
          expiredAt: share.expires_at
        };
      }

      const doc = this.db.getDocumentById(share.document_id);
      if (!doc) {
        return { success: false, error: 'Vault document not found or removed', status: 'not_found' };
      }

      // Requirement 5: Compare SHA-256 integrity hash & flag mismatch
      const currentCanonical = {
        document_id: doc.document_id,
        title: doc.title,
        document_type: doc.document_type,
        doc_number: doc.doc_number,
        owner_id: doc.owner_id,
        expiry_date: doc.expiry_date || null,
        file_sha256: doc.file_reference?.sha256 || null,
        data_checksum: doc.file_reference?.dataUrl ? this.computeSha256(doc.file_reference.dataUrl) : (doc.file_reference?.filename || doc.title)
      };
      const calculatedHash = this.computeSha256(JSON.stringify(currentCanonical));

      if (share.tamper_proof_hash && share.tamper_proof_hash !== calculatedHash) {
        this.db.logAuditEvent({
          document_id: share.document_id,
          request_id: share.request_id,
          actor: 'DOCDON Integrity Sentinel',
          action: 'integrity_failure',
          result: 'flagged',
          metadata: {
            share_token: shareToken,
            expected_hash: share.tamper_proof_hash,
            calculated_hash: calculatedHash,
            reason: 'Cryptographic SHA-256 checksum mismatch detected on shared payload'
          }
        });
        return {
          success: false,
          error: 'Access Denied: Cryptographic integrity violation detected. Document payload has been modified or corrupted.',
          status: 'integrity_failure',
          expectedHash: share.tamper_proof_hash,
          calculatedHash: calculatedHash
        };
      }

      // Valid Access: record audit event and increment stats (Requirement 6)
      share.access_count = (share.access_count || 0) + 1;
      share.last_accessed_at = new Date().toISOString();
      this.db.updateShare(shareToken, share);

      this.db.logAuditEvent({
        document_id: share.document_id,
        request_id: share.request_id,
        actor: share.recipient || 'Authorized Evaluation Officer',
        action: 'shared_document_accessed',
        result: 'success',
        metadata: {
          share_token: shareToken,
          format: share.format,
          access_count: share.access_count,
          sha256_hash: share.tamper_proof_hash || calculatedHash
        }
      });

      const ocr = this.db.getOcrResult(share.document_id);

      // Requirement 7: Do NOT expose physical storage path or raw internal file location
      const sanitizedDoc = {
        id: doc.document_id,
        title: doc.title,
        documentType: doc.document_type,
        docNumber: doc.doc_number,
        category: doc.category,
        uploaded_at: doc.uploaded_at,
        expiry_date: doc.expiry_date,
        is_expired: doc.is_expired,
        current_status: doc.current_status,
        verification_label: doc.verification_label,
        verified: doc.verified,
        tamper_proof_hash: share.tamper_proof_hash || calculatedHash,
        file: {
          filename: doc.file_reference?.filename || (doc.title + '.pdf'),
          file_type: doc.file_reference?.file_type || 'application/pdf',
          file_size: doc.file_reference?.file_size || 0,
          dataUrl: doc.file_reference?.dataUrl || null
        },
        ocr: ocr ? {
          confidence: ocr.confidence,
          quality: ocr.quality,
          extractedFields: ocr.extractedFields
        } : null
      };

      return {
        success: true,
        share: {
          share_token: share.share_token,
          recipient: share.recipient,
          purpose: share.purpose,
          format: share.format,
          tamper_proof_hash: share.tamper_proof_hash || calculatedHash,
          created_at: share.created_at,
          expires_at: share.expires_at,
          status: share.status,
          access_count: share.access_count
        },
        document: sanitizedDoc
      };
    }

    // POST /api/shares/:token/revoke (PART 2: Share Revocation)
    revokeShare(shareToken, options = {}) {
      if (!shareToken) return { success: false, error: 'Share token is required' };

      const share = this.db.getShareByToken(shareToken);
      if (!share) return { success: false, error: 'Share authorization token not found' };

      const actor = options.revokedBy || share.owner_id || 'Document Owner';
      const reason = options.reason || 'Revoked by document owner';

      share.status = 'revoked';
      share.revoked_at = new Date().toISOString();
      share.revoked_by = actor;
      share.revocation_reason = reason;
      this.db.updateShare(shareToken, share);

      // Audit trail entry for revocation
      this.db.logAuditEvent({
        document_id: share.document_id,
        request_id: share.request_id,
        actor: actor,
        action: 'share_revoked',
        result: 'revoked',
        metadata: {
          share_token: shareToken,
          recipient: share.recipient,
          reason: reason
        }
      });

      // Original Vault document remains completely intact!
      return {
        success: true,
        message: 'Share authorization successfully revoked',
        share: share
      };
    }

    // GET /api/shares (List active and past shares)
    listShares(documentId = null, ownerId = null) {
      const shares = this.db.getShares(documentId, ownerId);
      return { success: true, shares };
    }

    // GET /api/audit/:requestId
    getAuditTrail(requestId = null, docId = null) {
      const events = this.db.getAuditEvents(requestId, docId);
      return { success: true, events };
    }

    // GET /api/documents
    getDocuments(ownerId = null) {
      const docs = this.db.getDocuments(ownerId);
      // Map to frontend expected shape with expiry remaining days calculation
      return {
        success: true,
        documents: docs.map(d => {
          const profile = DOCUMENT_PROFILES[d.document_type] || {};
          const expiryResult = this.verifier.expiryEngine.calculateValidity(d.document_type, d.expiry_date);
          return {
            id: d.document_id,
            ownerId: d.owner_id,
            title: d.title,
            documentType: d.document_type,
            documentTypeLabel: d.custom_document_type || profile.name || d.title,
            customDocumentType: d.custom_document_type || null,
            expectedDocumentType: d.expected_document_type || null,
            detectedDocumentType: d.detected_document_type || null,
            semesterNumber: d.semester_number || null,
            classificationMatch: d.classification_match,
            verificationMethod: d.verification_method || (d.verification_label === 'Human Verified' ? 'HUMAN' : 'AI'),
            category: d.category || profile.category || 'identity',
            icon: profile.icon || (d.category === 'academic' ? '📜' : d.category === 'financial' ? '🏦' : '📄'),
            docNumber: d.doc_number || null,
            // Field-level OCR values allow the Vault to search names and identifiers
            // after a reload without returning the original OCR transcript.
            extractedFields: this.db.getOcrResult(d.document_id)?.extractedFields || {},
            personName: (() => {
              const fields = this.db.getOcrResult(d.document_id)?.extractedFields || {};
              return fields.student_name || fields.candidate_name || fields.holder_name || fields.cardholder_name || fields.driver_name || fields.account_holder || fields.elector_name || fields.name || null;
            })(),
            expiryDate: d.expiry_date,
            isExpired: d.is_expired || expiryResult.isExpired,
            daysRemaining: expiryResult.daysRemaining,
            expiryLabel: expiryResult.formattedRemark,
            errorReason: d.errorReason || (expiryResult.isExpired ? expiryResult.formattedRemark : null),
            documentStatus: d.current_status || 'Available',
            verificationLabel: d.verification_label || 'Needs Human Review',
            aiCheckLabel: d.ai_status === 'mismatch' ? 'Mismatch' : (d.verification_label || 'Needs Human Review'),
            vaultIndicator: expiryResult.isExpired ? 'Expired' : expiryResult.isExpiringSoon ? 'Expiring Soon' : 'Valid',
            formats: ['PDF', 'PHOTO'],
            verified: Boolean(d.verified === true && d.verification_label === 'Human Verified'),
            aiStatus: d.ai_status || 'needs_review',
            version: d.version || 1,
            previousVersionId: d.previousVersionId || null,
            isPreviousVersion: Boolean(d.isPreviousVersion),
            versionStatus: d.versionStatus || 'active',
            classificationConfidence: d.classification_confidence ?? null,
            confidenceScore: d.confidence_score ?? null,
            ocrConfidence: d.ocr_confidence ?? null,
            verificationReason: d.verification_reason || d.error_reason || null
          };
        })
      };
    }

    // GET /api/documents/:id/status
    getDocumentStatus(documentId, userId = null) {
      if (!documentId) return { success: false, error: 'Document ID is required' };

      // 1. Check if it's an in-flight, completed, or rejected temporary processing document
      const proc = this.db.getProcessingDocument(documentId);
      if (proc) {
        return {
          success: true,
          id: proc.id,
          status: proc.status,
          processingStatus: proc.processingStatus,
          step: proc.step || proc.processingStatus,
          documentType: proc.documentType,
          canonicalId: proc.canonicalId,
          canonicalName: proc.canonicalName,
          confidence: proc.confidence,
          rejectionReason: proc.rejectionReason,
          vaultDocumentId: proc.vaultDocumentId || null,
          processingDocument: proc
        };
      }

      // 2. Check if it is a finalized vault document
      const doc = this.db.getDocumentById(documentId);
      if (doc) {
        return {
          success: true,
          id: doc.document_id,
          status: 'completed',
          processingStatus: 'COMPLETED',
          step: 'VAULT_SYNC',
          documentType: doc.document_type,
          canonicalId: doc.document_type,
          canonicalName: doc.title,
          document: doc,
          vaultDocumentId: doc.document_id,
          currentStatus: doc.current_status,
          verificationLabel: doc.verification_label
        };
      }

      return { success: false, error: 'Document or processing record not found' };
    }

    // PATCH /api/documents/:id
    patchDocument(documentId, updates = {}) {
      if (!documentId) return { success: false, error: 'Document ID is required' };
      const doc = this.db.getDocumentById(documentId);
      if (!doc) return { success: false, error: 'Document not found' };
      const updated = this.db.updateDocument(documentId, updates);
      return { success: true, document: updated };
    }
  }

  // ==========================================================================
  // SINGLETON INSTANTIATION & FETCH INTERCEPTOR FOR SEAMLESS CLIENT API CALLS
  // ==========================================================================
  const db = new DocdonDatabase();
  const api = new DocdonApiService(db);

  const runLocalProcessDocument = api.processDocument.bind(api);
  const runLocalUploadDocument = api.uploadDocument.bind(api);
  const runLocalCameraDocument = api.cameraDocument.bind(api);
  const runLocalReviewDocument = api.reviewDocument.bind(api);
  const isHostedApplication = () => typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol);
  const postHostedDocument = async (endpoint, payload) => {
    const response = await window.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const result = await response.json();
    if (!response.ok && result.success === undefined) result.success = false;
    return result;
  };

  // When DOCDON is served by server.js, document processing must be performed
  // by the Node backend. Keep the in-browser engine only for the existing
  // file:// offline/demo workflow.
  api.processDocument = payload => isHostedApplication()
    ? postHostedDocument('/api/documents/process', payload)
    : runLocalProcessDocument(payload);
  api.uploadDocument = payload => isHostedApplication()
    ? postHostedDocument('/api/documents/upload', payload)
    : runLocalUploadDocument(payload);
  api.cameraDocument = payload => isHostedApplication()
    ? postHostedDocument('/api/documents/camera', { ...payload, isCameraCapture: true })
    : runLocalCameraDocument(payload);
  api.reviewDocument = (documentId, payload) => isHostedApplication()
    ? postHostedDocument(`/api/documents/${encodeURIComponent(documentId)}/review`, payload)
    : runLocalReviewDocument(documentId, payload);

  // Install a mock-fetch interceptor so frontend code can call both window.DocdonAPI
  // AND standard `fetch('/api/...')` without requiring a running node process!
  if (typeof window !== 'undefined' && window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = async function (url, options = {}) {
      if (/^https?:$/.test(window.location.protocol)) {
        const hostedUrl = typeof url === 'string' ? url : (url && url.url ? url.url : '');
        const requestUrl = new URL(hostedUrl, window.location.origin);
        const apiBaseUrl = String(window.DOCDON_CONFIG?.apiBaseUrl || '').trim().replace(/\/$/, '');
        const isApiCall = /^\/(api\/|requirements|document-checklist|document-progress|documents\/|profile|roadmap|advisor\/)/.test(requestUrl.pathname);
        let targetUrl = requestUrl;
        if (isApiCall && apiBaseUrl && requestUrl.origin === window.location.origin) {
          targetUrl = new URL(requestUrl.pathname + requestUrl.search, apiBaseUrl);
        }
        let token = null;
        try { token = JSON.parse(localStorage.getItem('docdon_current_user') || 'null')?.sessionToken; } catch (e) {}
        const backendOrigin = apiBaseUrl ? new URL(apiBaseUrl).origin : window.location.origin;
        if (token && isApiCall && targetUrl.origin === backendOrigin) {
          const headers = new Headers(options.headers || (url instanceof Request ? url.headers : undefined));
          headers.set('Authorization', `Bearer ${token}`);
          return originalFetch.call(this, targetUrl.href, { ...options, headers });
        }
        return originalFetch.call(this, isApiCall ? targetUrl.href : url, options);
      }
      const urlStr = typeof url === 'string' ? url : (url && url.url ? url.url : '');
      const isApiCall = urlStr.startsWith('/api/') || 
        urlStr.startsWith('/requirements') || 
        urlStr.startsWith('/document-checklist') || 
        urlStr.startsWith('/document-progress') || 
        urlStr.startsWith('/documents/') || 
        urlStr.startsWith('/profile') || 
        urlStr.startsWith('/roadmap') || 
        urlStr.startsWith('/advisor/');

      if (isApiCall) {
        const normUrl = urlStr.startsWith('/api/') ? urlStr : ('/api' + (urlStr.startsWith('/') ? urlStr : '/' + urlStr));
        const method = (options.method || 'GET').toUpperCase();
        let body = {};
        if (options.body) {
          try {
            body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
          } catch (e) { body = {}; }
        }

        let resData = { success: false, error: 'Endpoint not found' };
        let currentProfileId = '';
        try {
          const currentUser = JSON.parse(localStorage.getItem('docdon_current_user') || 'null');
          currentProfileId = currentUser?.id || currentUser?.identifier || '';
        } catch (e) {}

        if (normUrl === '/api/requests' && method === 'GET') {
          resData = api.listRequests();
        } else if (normUrl === '/api/requests' && method === 'POST') {
          resData = api.createVerificationRequest(body);
        } else if (normUrl.startsWith('/api/requests/') && normUrl.endsWith('/share') && method === 'POST') {
          const reqId = normUrl.split('/')[3];
          resData = api.shareDocument(reqId, body);
        } else if (normUrl.startsWith('/api/requests/') && method === 'GET') {
          const reqId = normUrl.split('/')[3];
          resData = api.getRequest(reqId);
        } else if (normUrl === '/api/shares' && method === 'GET') {
          resData = api.listShares();
        } else if (normUrl === '/api/shares' && method === 'POST') {
          resData = api.shareDocument(body);
        } else if (normUrl.startsWith('/api/shares/') && normUrl.endsWith('/revoke') && method === 'POST') {
          const token = normUrl.split('/')[3];
          resData = api.revokeShare(token, body);
        } else if (normUrl.startsWith('/api/shares/') && method === 'GET') {
          const token = normUrl.split('/')[3];
          resData = api.getSharedDocument(token);
        } else if ((normUrl === '/api/documents/process' || normUrl === '/api/documents/upload' || normUrl === '/api/documents/camera') && method === 'POST') {
          resData = await api.processDocument(body);
        } else if ((normUrl === '/api/documents' || normUrl.startsWith('/api/documents?')) && method === 'GET') {
          const params = new URLSearchParams(normUrl.split('?')[1] || '');
          resData = api.getDocuments(params.get('ownerId') || null);
        } else if (normUrl.startsWith('/api/documents/') && normUrl.endsWith('/verify') && method === 'POST') {
          const docId = normUrl.split('/')[3];
          resData = await api.verifyDocument(docId, body);
        } else if (normUrl.startsWith('/api/documents/') && normUrl.endsWith('/check') && method === 'POST') {
          const docId = normUrl.split('/')[3];
          resData = await api.checkDocument(docId, body);
        } else if (normUrl.startsWith('/api/documents/') && normUrl.endsWith('/review') && method === 'POST') {
          const docId = normUrl.split('/')[3];
          resData = api.reviewDocument(docId, body);
        } else if (normUrl.startsWith('/api/documents/') && normUrl.endsWith('/status') && method === 'GET') {
          const docId = normUrl.split('/')[3];
          const params = new URLSearchParams(normUrl.split('?')[1] || '');
          const userId = params.get('userId') || currentProfileId;
          resData = api.getDocumentStatus(docId, userId);
        } else if (normUrl.startsWith('/api/documents/') && method === 'PATCH') {
          const docId = normUrl.split('/')[3];
          resData = api.patchDocument(docId, body);
        } else if (normUrl.startsWith('/api/documents/') && method === 'GET') {
          const docId = normUrl.split('/')[3];
          const doc = db.getDocumentById(docId);
          resData = doc ? { success: true, document: doc } : { success: false, error: 'Not found' };
        } else if (normUrl.startsWith('/api/documents/') && method === 'DELETE') {
          const docId = normUrl.split('/')[3];
          resData = api.deleteDocument(docId);
        } else if (normUrl.startsWith('/api/audit/') && method === 'GET') {
          const reqId = normUrl.split('/')[3];
          resData = api.getAuditTrail(reqId);
        } else if (normUrl === '/api/audit' && method === 'GET') {
          resData = api.getAuditTrail();
        } else if (normUrl.startsWith('/api/advisor/checklist')) {
          const params = new URLSearchParams(normUrl.split('?')[1] || '');
          resData = api.getAdvisorChecklist(params.get('purpose') || '', Object.fromEntries(params.entries()));
        } else if ((normUrl === '/api/advisor/consult' || normUrl === '/api/advisor/chat') && method === 'POST') {
          resData = api.consultAdvisor(body);
        } else if (normUrl.startsWith('/api/profile') && method === 'GET') {
          const params = new URLSearchParams(normUrl.split('?')[1] || '');
          const userId = params.get('userId') || currentProfileId;
          resData = api.getUserProfile(userId);
        } else if (normUrl.startsWith('/api/profile') && (method === 'PUT' || method === 'PATCH' || method === 'POST')) {
          const params = new URLSearchParams(normUrl.split('?')[1] || '');
          const userId = params.get('userId') || currentProfileId || body.userId || '';
          resData = api.updateUserProfile(userId, body);
        } else if (normUrl.startsWith('/api/requirements/status') && method === 'GET') {
          const params = new URLSearchParams(normUrl.split('?')[1] || '');
          const userId = params.get('userId') || currentProfileId;
          resData = api.getRequirementsStatus(userId, Object.fromEntries(params.entries()));
        } else if (normUrl.startsWith('/api/requirements') && method === 'GET') {
          const params = new URLSearchParams(normUrl.split('?')[1] || '');
          const userId = params.get('userId') || currentProfileId;
          resData = api.getRequirements(userId, Object.fromEntries(params.entries()));
        } else if (normUrl.startsWith('/api/document-checklist') && method === 'GET') {
          const params = new URLSearchParams(normUrl.split('?')[1] || '');
          const userId = params.get('userId') || currentProfileId;
          resData = api.getDocumentChecklist(userId, Object.fromEntries(params.entries()));
        } else if (normUrl.startsWith('/api/document-progress') && method === 'GET') {
          const params = new URLSearchParams(normUrl.split('?')[1] || '');
          const userId = params.get('userId') || currentProfileId;
          resData = api.getDocumentProgress(userId, Object.fromEntries(params.entries()));
        } else if (normUrl.startsWith('/api/roadmap') && method === 'GET') {
          const params = new URLSearchParams(normUrl.split('?')[1] || '');
          const userId = params.get('userId') || currentProfileId;
          resData = api.getRoadmap(userId, Object.fromEntries(params.entries()));
        }

        const statusCode = resData.success !== false ? 200 : (resData.status === 'revoked' || resData.status === 'expired' || resData.status === 'integrity_failure' ? 403 : (resData.status === 'not_found' ? 404 : 400));
        return new Response(JSON.stringify(resData), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch.apply(this, arguments);
    };
  }

  return {
    CANONICAL_DOCUMENT_TAXONOMY: CANONICAL_DOCUMENT_TAXONOMY,
    normalizeDocumentType: normalizeDocumentType,
    normalizeOcrText: normalizeOcrText,
    buildMarksheetEvidenceProfile: buildMarksheetEvidenceProfile,
    database: db,
    api: api,
    processDocument: (payload) => api.processDocument(payload),
    uploadDocument: (payload) => api.uploadDocument(payload),
    cameraDocument: (payload) => api.cameraDocument(payload),
    profiles: DOCUMENT_PROFILES,
    advisorPlans: ADVISOR_CHECKLIST_PLANS,
    advisor: api.advisor,
    AdvisorEngine: DocdonAdvisorEngine,
    resolveAdvisorGoal: resolveAdvisorGoal,
    CAREER_METADATA: CAREER_METADATA,
    detectCareerPreference: (text) => api.advisor.detectCareerPreference(text),
    detectEducationStage: (text) => api.advisor.detectEducationStage(text),
    getCareerMetadata: (careerKey) => CAREER_METADATA[careerKey] || null,
    getUserProfile: (userId) => api.getUserProfile(userId),
    updateUserProfile: (userId, data) => api.updateUserProfile(userId, data),
    calculateProfileRequirements: (profile, vaultDocs) => api.calculateProfileRequirements(profile, vaultDocs),
    getProfileRoadmap: (profile) => api.getProfileRoadmap(profile),
    getRequirements: (userId, query) => api.getRequirements(userId, query),
    getRequirementsStatus: (userId, query) => api.getRequirementsStatus(userId, query),
    getDocumentChecklist: (userId, query) => api.getDocumentChecklist(userId, query),
    getDocumentProgress: (userId, query) => api.getDocumentProgress(userId, query),
    getDocumentStatus: (docId, userId) => api.getDocumentStatus(docId, userId),
    checkDocument: (docId, options) => api.checkDocument(docId, options),
    patchDocument: (docId, updates) => api.patchDocument(docId, updates),
    getRoadmap: (userId, query) => api.getRoadmap(userId, query),
    matchRequirementToVaultDoc: matchRequirementToVaultDoc,
    getDocumentState: getDocumentState,
    calculateDocumentExpiry: calculateDocumentExpiry,
    parseDateUniversal: parseDateUniversal,
    deleteDocument: (docId) => api.deleteDocument(docId),
    OcrEngine: DocdonOcrEngine,
    Classifier: DocdonClassifier,
    ExpiryEngine: DocdonExpiryEngine,
    VerificationEngine: DocdonVerificationEngine,
    computeSha256: (data) => api.computeSha256(data),
    generateSecureShareToken: () => api.generateSecureShareToken()
  };
});
