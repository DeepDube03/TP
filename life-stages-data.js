/**
 * DOCDON Life-Stage Document Engine
 * Catalog of documents required at each stage of life + verification/storage logic.
 * Doc format: [name, why it matters / info, required (1) or optional (0)]
 * Works offline (localStorage) and uses the same pluggable pattern as verification-service.js
 */
const LIFE_STAGES_KEY_PREFIX = 'docdon_life_stages_v2:';

const LIFE_STAGES = [
  { id: 'birth', icon: '👶', title: 'Birth & Infancy', age: '0 – 5 yrs',
    desc: 'The foundation of legal identity. Every other document later in life traces back to these.',
    docs: [
      ['Birth Certificate', 'Issued by the municipal corporation / registrar. Root proof of name, date and place of birth.', 1],
      ['Parents\' ID Proofs', 'Aadhaar / Passport of both parents, linked to the child\'s record.', 1],
      ['Immunisation (Vaccination) Card', 'Required for school admission and later for travel.', 1],
      ['Child Aadhaar (Bal Aadhaar)', 'Blue Aadhaar for children under 5, needed for schemes and school.', 1],
      ['Hospital Discharge / Birth Record', 'Supports the birth certificate if any correction is needed.', 0],
      ['Child Health Insurance', 'Cover for infant care and early treatment.', 0]
    ] },
  { id: 'child', icon: '🎒', title: 'Childhood & School', age: '6 – 12 yrs',
    desc: 'Primary and middle school records that prove education history and age.',
    docs: [
      ['School Admission / Bonafide Certificate', 'Proof of enrolment, used for scholarships and concessions.', 1],
      ['Transfer Certificate (TC)', 'Needed when changing schools. Keep every one.', 1],
      ['Report Cards (Std 1 – 8)', 'Annual academic progress record.', 1],
      ['Updated Aadhaar / Biometric Update', 'Mandatory biometric update at age 5 and again at 15.', 1],
      ['Student ID Card', 'Current school identity proof.', 0],
      ['Caste / Domicile Certificate', 'Only if applicable. Needed for reservations and state schemes.', 0],
      ['Medical & Vaccination Records', 'Booster doses and school health check-ups.', 0]
    ] },
  { id: 'teen', icon: '🎓', title: 'Teenage & Secondary', age: '13 – 17 yrs',
    desc: 'Board exam documents that unlock college admission, jobs and scholarships.',
    docs: [
      ['10th Marksheet', 'Board-issued marksheet. Also accepted as date-of-birth proof.', 1],
      ['10th Passing Certificate', 'Official proof of passing Secondary School Certificate.', 1],
      ['12th Marksheet', 'Needed for every college admission.', 1],
      ['12th Passing Certificate', 'Board-issued certificate of Higher Secondary pass.', 1],
      ['School Leaving Certificate', 'Issued on leaving school. Confirms conduct and last class.', 1],
      ['Entrance Exam Scorecard (JEE / NEET / CUET)', 'Required for counselling and admission rounds.', 0],
      ['Income / Domicile / Caste Certificate', 'For scholarships and quota admissions, if applicable.', 0],
      ['Minor Passport', 'Only if travelling abroad before 18.', 0]
    ] },
  { id: 'college', icon: '🏫', title: 'College & Higher Education', age: '18 – 24 yrs',
    desc: 'Adult identity documents begin here, along with degree and admission records.',
    docs: [
      ['College Admission Letter', 'Confirms seat, course and year of admission.', 1],
      ['Semester Marksheets', 'All semesters. Employers and universities ask for the full set.', 1],
      ['Degree / Provisional Certificate', 'Final proof of graduation.', 1],
      ['Migration Certificate', 'Needed to move to another university or abroad.', 1],
      ['PAN Card', 'Permanent tax identity. Needed for bank accounts, jobs and loans.', 1],
      ['Voter ID (18+)', 'Identity and address proof that gives voting rights.', 1],
      ['Driving Licence', 'Valid government photo ID. Available from age 18.', 0],
      ['Internship Certificates', 'Strengthen job and higher-study applications.', 0],
      ['Scholarship / Education Loan Papers', 'Sanction letters and repayment schedule.', 0],
      ['Character / Conduct Certificate', 'Often asked by employers and embassies.', 0]
    ] },
  { id: 'job', icon: '💼', title: 'Job & Career', age: '21+ yrs',
    desc: 'All identity, education and job documents stored together in one verified career folder.',
    docs: [
      ['Aadhaar Card', 'Primary identity and address proof for onboarding.', 1],
      ['PAN Card', 'Mandatory for salary and tax filing.', 1],
      ['Passport-size Photographs', 'For employee records and ID card.', 1],
      ['Education Certificates (10th, 12th, Degree)', 'Verified copies are required by HR in the background check.', 1],
      ['Offer Letter', 'Employer\'s written job offer with role and CTC.', 1],
      ['Appointment Letter', 'Formal terms of employment after joining.', 1],
      ['Previous Experience / Relieving Letters', 'Proof of earlier employment and clean exit.', 1],
      ['Last 3 Salary Slips', 'Requested by new employers, banks and visa offices.', 1],
      ['Bank Account Proof (Cancelled Cheque)', 'For salary credit.', 1],
      ['PF / UAN Details', 'Provident fund account, transferable between jobs.', 1],
      ['Background Verification (BGV) Report', 'Employer-run check of identity, education and past jobs.', 1],
      ['Form 16 / ITR Acknowledgement', 'Annual tax proof. Needed for loans and visas.', 0],
      ['Professional Licence / Certifications', 'Role-specific, e.g. CA, bar council, medical, AWS, PMP.', 0],
      ['Employee ID Card', 'Current employment proof.', 0],
      ['Non-Disclosure / Employment Agreement', 'Signed contract terms.', 0],
      ['Police Clearance Certificate (PCC)', 'Required by some employers and for jobs abroad.', 0]
    ] },
  { id: 'marriage', icon: '💍', title: 'Marriage', age: 'Adult',
    desc: 'Legal proof of marriage and the document updates that follow it.',
    docs: [
      ['Marriage Certificate (Registered)', 'Issued by the marriage registrar. Needed for spouse visas, insurance and name change.', 1],
      ['Age Proof of Both Partners', '10th marksheet, birth certificate or passport.', 1],
      ['Identity Proof of Both Partners', 'Aadhaar, PAN or Passport.', 1],
      ['Address Proof', 'Current address for both partners.', 1],
      ['Joint Wedding Photographs', 'Required with the registration application.', 1],
      ['Wedding Invitation Card', 'Supporting proof of the ceremony date.', 0],
      ['Name Change Gazette / Affidavit', 'Only if a surname or name changes after marriage.', 0],
      ['Divorce Decree / Spouse Death Certificate', 'Only if either partner was previously married.', 0],
      ['Joint Bank Account / Nominee Update', 'Adds spouse as nominee on accounts and policies.', 0]
    ] },
  { id: 'family', icon: '👨‍👩‍👧', title: 'Parenthood & Family', age: 'Adult',
    desc: 'Documents for your children, dependants and family protection.',
    docs: [
      ['Child\'s Birth Certificate', 'Register within 21 days of birth.', 1],
      ['Family Health Insurance Policy', 'Floater cover for spouse and children.', 1],
      ['Ration Card / Family Card Update', 'Add new members and update address.', 1],
      ['Life Insurance Policy', 'Financial protection with nominee details.', 1],
      ['Maternity / Delivery Records', 'Needed for maternity benefits and insurance claims.', 0],
      ['Adoption / Guardianship Papers', 'Only if applicable.', 0],
      ['Will & Nominee Details', 'Clear succession for assets.', 0],
      ['Dependent Parents\' Medical Records', 'For insurance claims and tax benefits.', 0]
    ] },
  { id: 'property', icon: '🏠', title: 'Home, Vehicle & Finance', age: 'Adult',
    desc: 'Ownership, loan and tax documents for your major assets.',
    docs: [
      ['Sale Deed / Registered Agreement', 'Legal proof of property ownership.', 1],
      ['Property Tax Receipts', 'Latest paid receipts. Needed for resale and loans.', 1],
      ['ITR (Last 3 Years)', 'Primary income proof for loans and visas.', 1],
      ['Vehicle Registration Certificate (RC)', 'Ownership proof for your vehicle.', 1],
      ['Vehicle Insurance & PUC', 'Valid insurance and pollution certificate.', 1],
      ['Home Loan Sanction & Statement', 'Loan terms, EMI schedule and closure letter.', 0],
      ['Encumbrance Certificate', 'Proves the property is free from legal dues.', 0],
      ['Investment Proofs (FD, MF, Shares)', 'Support tax saving and net-worth proof.', 0],
      ['Rent Agreement', 'If renting. Useful as address proof.', 0]
    ] },
  { id: 'travel', icon: '✈️', title: 'Travel, Visa & Migration', age: 'Any age',
    desc: 'Documents for overseas study, work or travel. Full AI visa checks run in the Visa Verification workspace.',
    link: 'verification.html', linkLabel: 'Open AI Visa Verification',
    docs: [
      ['Passport', 'Valid for at least 6 months beyond travel dates.', 1],
      ['Visa / Permit', 'Country-specific entry authorisation.', 1],
      ['Bank Statement (6 months)', 'Proof of funds for the visa officer.', 1],
      ['Travel Insurance', 'Mandatory for Schengen and many other countries.', 0],
      ['Police Clearance Certificate', 'Often required for work and residence visas.', 0],
      ['Vaccination / Medical Certificate', 'Required by some destinations.', 0],
      ['Return Ticket & Accommodation Proof', 'Shows intent to return.', 0]
    ] },
  { id: 'senior', icon: '🌅', title: 'Senior, Retirement & Legacy', age: '58+ yrs',
    desc: 'Retirement benefits, medical records and legal planning for the family.',
    docs: [
      ['Pension Payment Order (PPO)', 'Issued on retirement for monthly pension.', 1],
      ['Life Certificate (Jeevan Pramaan)', 'Annual proof for pension continuation.', 1],
      ['Senior Citizen Card', 'Concessions on travel, tax and banking.', 1],
      ['Health Insurance & Medical Records', 'Ongoing treatment and claim history.', 1],
      ['Gratuity / PF Settlement Papers', 'Final retirement benefits.', 0],
      ['Registered Will', 'Clear legal succession for your assets.', 0],
      ['Power of Attorney', 'Authorises a trusted person to act for you.', 0],
      ['Nominee Records (Bank, Policy, Demat)', 'Keeps accounts easily transferable.', 0]
    ] }
];

LIFE_STAGES.forEach(s => s.docs = s.docs.map((d, i) => ({ id: s.id + '_' + i, name: d[0], info: d[1], required: !!d[2] })));

const LifeStageEngine = (() => {
  const user = () => window.DocdonVerificationService.requireUser();
  const ownerKey = () => String(user().identifier || user().id).trim().toLowerCase();
  const key = () => LIFE_STAGES_KEY_PREFIX + encodeURIComponent(ownerKey());
  const load = () => { try { const x = JSON.parse(localStorage.getItem(key()) || 'null'); return x && x.ownerKey === ownerKey() ? x : { ownerKey: ownerKey(), records: {}, hidden: [] }; } catch (_) { return { ownerKey: ownerKey(), records: {}, hidden: [] }; } };
  const save = data => { data.ownerKey = ownerKey(); localStorage.setItem(key(), JSON.stringify(data)); };
  const isVerified = record => /^(verified|human verified|ai check passed|ready to share)$/i.test(String(record && record.status || '').trim());
  const fileToDataUrl = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = () => reject(new Error('Could not read the selected file.')); reader.readAsDataURL(file); });
  const mapType = name => {
    const n = name.toLowerCase();
    if (n.includes('birth certificate')) return ['birth_certificate', null];
    if (n.includes('aadhaar')) return ['aadhaar_card', null];
    if (n === 'pan card') return ['pan_card', null];
    if (n === 'passport' || n.includes('passport-size')) return ['passport', null];
    if (n.includes('10th') && n.includes('marksheet')) return ['10th_marksheet', null];
    if (n.includes('12th') && n.includes('marksheet')) return ['12th_marksheet', null];
    if (n.includes('driving licence')) return ['driving_license', null];
    return ['other_custom', name];
  };
  return {
    load() { return load().records; },
    get(docId) { return load().records[docId] || null; },
    async syncFromVault() { return load().records; },
    async verifyDocument(stage, doc, file) {
      if (!file) return { ok: false, reason: 'Choose a document file.' };
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) return { ok: false, reason: 'Unsupported file type. Use PDF, JPG or PNG.' };
      if (file.size > 10 * 1024 * 1024) return { ok: false, reason: 'File is larger than 10 MB.' };
      try {
        const [documentType, customDocumentType] = mapType(doc.name);
        const result = await window.DocdonAPI.processDocument({ fileData: await fileToDataUrl(file), fileName: file.name, fileType: file.type, fileSize: file.size,
          title: doc.name, documentType, ...(customDocumentType ? { customDocumentType } : {}) });
        if (!result || result.success !== true || !result.document) throw new Error(result && result.error || 'DOCDON could not process this document.');
        const item = result.document, record = { docId: doc.id, stageId: stage.id, name: doc.name, fileName: item.file_name || file.name,
          size: (file.size / 1024).toFixed(1) + ' KB', status: item.verification_label || item.current_status || 'Pending',
          reason: item.verification_reason || item.error_reason || '', vaultId: item.document_id || item.id, uploadedAt: item.uploaded_at || new Date().toISOString() };
        const data = load(); data.records[doc.id] = record; data.hidden = (data.hidden || []).filter(id => id !== doc.id); save(data);
        return { ok: true, record };
      } catch (error) { return { ok: false, reason: error.message || 'Document processing failed.' }; }
    },
    remove(docId) { const data = load(); delete data.records[docId]; data.hidden = [...new Set([...(data.hidden || []), docId])]; save(data); },
    stageProgress(stage) { const data = load().records, req = stage.docs.filter(d => d.required); return { verified: stage.docs.filter(d => isVerified(data[d.id])).length, total: stage.docs.length, reqDone: req.filter(d => isVerified(data[d.id])).length, reqTotal: req.length }; },
    overall() { let done = 0, total = 0; LIFE_STAGES.forEach(s => { const p = this.stageProgress(s); done += p.reqDone; total += p.reqTotal; }); return { done, total, pct: total ? Math.round(done / total * 100) : 0 }; },
    isVerified,
    folderSummary(stage, holder) { const data = load().records, lines = ['DOCDON FOLDER: ' + stage.title + ' (' + stage.age + ')', 'Holder: ' + holder, 'Generated: ' + new Date().toLocaleString(), '']; stage.docs.forEach(d => { const r = data[d.id]; lines.push((isVerified(r) ? '[VERIFIED] ' : r ? '[' + r.status.toUpperCase() + '] ' : '[PENDING]  ') + d.name + (d.required ? ' (required)' : ' (optional)') + (r ? ' | ' + r.fileName : '')); }); return lines.join('\n'); }
  };
})();

function stageByIdForEngine(id) { return LIFE_STAGES.find(stage => stage.id === id); }
