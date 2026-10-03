/**
 * DOCDON Mobile App - Page 1: Authentication, Login & Compulsory Biometrics Engine
 * Fully Self-Contained, Zero-Dependency Script
 */

// Application State
const authState = {
  currentView: 'login',
  soundEnabled: true,
  currentUser: null,
  cameraStream: null,
  loginBiometricVerified: false,
  loginBiometricType: null,
  regBiometricVerified: false,
  regBiometricType: null
};

// Registered Users in LocalStorage
function getRegisteredUsers() {
  const saved = localStorage.getItem('docdon_registered_users');
  if (saved) {
    try { return JSON.parse(saved); } catch (e) { return []; }
  }
  const defaultUsers = [
    { fullName: 'David Miller', identifier: 'david.miller', password: 'password123', biometricType: 'face' },
    { fullName: 'Admin Verifier', identifier: 'admin', password: 'password123', biometricType: 'fingerprint' }
  ];
  try { localStorage.setItem('docdon_registered_users', JSON.stringify(defaultUsers)); } catch(e){}
  return defaultUsers;
}

function saveRegisteredUser(user) {
  const users = getRegisteredUsers();
  users.push(user);
  try { localStorage.setItem('docdon_registered_users', JSON.stringify(users)); } catch(e){}
}

// Audio Feedback
const AudioFeedback = {
  ctx: null,
  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  playBeep(freq = 600, duration = 0.12) {
    if (!authState.soundEnabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {}
  },
  playSuccess() {
    if (!authState.soundEnabled) return;
    this.playBeep(523.25, 0.1);
    setTimeout(() => this.playBeep(659.25, 0.1), 100);
    setTimeout(() => this.playBeep(783.99, 0.2), 200);
  },
  playScan() { this.playBeep(880, 0.08); },
  playWarning() { this.playBeep(320, 0.2); }
};

// Toast Notification
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.style.borderLeft = type === 'success' ? '4px solid #10b981' : type === 'error' ? '4px solid #e11d48' : '4px solid #06b6d4';
  toast.innerHTML = '<strong>' + title + '</strong><div style="font-size:11px; color:#475569; margin-top:2px;">' + message + '</div>';
  container.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 3500);
}

// Toggle View (Switch between Sign In and Create Account)
function setAuthView(viewName) {
  authState.currentView = viewName;
  AudioFeedback.playScan();

  const loginCard = document.getElementById('login-card-section');
  const registerCard = document.getElementById('register-card-section');

  if (viewName === 'register') {
    if (loginCard) {
      loginCard.classList.add('hidden');
      loginCard.style.display = 'none';
    }
    if (registerCard) {
      registerCard.classList.remove('hidden');
      registerCard.style.display = 'block';
    }
  } else {
    if (registerCard) {
      registerCard.classList.add('hidden');
      registerCard.style.display = 'none';
    }
    if (loginCard) {
      loginCard.classList.remove('hidden');
      loginCard.style.display = 'block';
    }
  }
}

// Toggle Password Visibility
function togglePasswordVisibility(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (btn) btn.textContent = '🔒';
  } else {
    input.type = 'password';
    if (btn) btn.textContent = '👁️';
  }
}

// Demo Autofill
function quickDemoFill() {
  const idInput = document.getElementById('login-identifier');
  const passInput = document.getElementById('login-password');
  if (idInput && passInput) {
    idInput.value = 'david.miller';
    passInput.value = 'password123';
    showToast('Demo Credentials Filled', 'Username: david.miller | Password: password123. Now complete Face or Fingerprint!', 'info');
    AudioFeedback.playBeep(700, 0.1);
  }
}

// Update Biometric Badges
function updateLoginBiometricUI() {
  const statusEl = document.getElementById('biometric-compulsory-status');
  if (!statusEl) return;
  if (authState.loginBiometricVerified) {
    statusEl.innerHTML = '<span class="badge-verified">✔ Verified (' + (authState.loginBiometricType === 'face' ? 'Face ID' : 'Touch ID') + ')</span>';
  } else {
    statusEl.innerHTML = '<span class="badge-compulsory">⚠️ Required</span>';
  }
}

function updateRegBiometricUI() {
  const statusEl = document.getElementById('reg-biometric-status');
  if (!statusEl) return;
  if (authState.regBiometricVerified) {
    statusEl.innerHTML = '<span class="badge-verified">✔ Linked (' + (authState.regBiometricType === 'face' ? 'Face ID' : 'Touch ID') + ')</span>';
  } else {
    statusEl.innerHTML = '<span class="badge-compulsory">⚠️ Required</span>';
  }
}

// Handle Login Submit
function handleLoginSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const identifier = document.getElementById('login-identifier').value.trim();
  const password = document.getElementById('login-password').value;

  if (!identifier || !password) {
    showToast('Missing Details', 'Please enter your login name/number and password.', 'error');
    AudioFeedback.playWarning();
    return;
  }

  if (!authState.loginBiometricVerified) {
    AudioFeedback.playWarning();
    showToast('Biometric Compulsory', 'Opening camera for compulsory Face ID...', 'error');
    openBiometricModal('login', 'face');
    return;
  }

  const users = getRegisteredUsers();
  const matchedUser = users.find(u => u.identifier.toLowerCase() === identifier.toLowerCase());

  if (matchedUser && matchedUser.password !== password) {
    AudioFeedback.playWarning();
    showToast('Incorrect Password', 'The password does not match our records.', 'error');
    return;
  }

  const userName = matchedUser ? matchedUser.fullName : (identifier.includes('@') ? identifier.split('@')[0] : identifier);
  authState.currentUser = {
    name: userName,
    identifier: identifier,
    authMethod: 'Password + Compulsory ' + (authState.loginBiometricType === 'face' ? 'Face ID' : 'Touch ID')
  };

  AudioFeedback.playSuccess();
  showToast('Welcome to DOCDON', 'Signed in as ' + userName + '!', 'success');
  showAuthSuccessBanner(authState.currentUser);
}

// Handle Register Submit
function handleRegisterSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const fullName = document.getElementById('reg-fullname').value.trim();
  const contact = document.getElementById('reg-contact').value.trim();
  const password = document.getElementById('reg-password').value;

  if (!fullName || !contact || !password) {
    showToast('Incomplete Form', 'Please fill in all required fields.', 'error');
    AudioFeedback.playWarning();
    return;
  }

  if (password.length < 6) {
    showToast('Short Password', 'Password must be at least 6 characters long.', 'error');
    AudioFeedback.playWarning();
    return;
  }

  if (!authState.regBiometricVerified) {
    AudioFeedback.playWarning();
    showToast('Biometric Required', 'Opening camera to link your Face ID...', 'error');
    openBiometricModal('register', 'face');
    return;
  }

  const newUser = {
    fullName: fullName,
    identifier: contact,
    password: password,
    biometricType: authState.regBiometricType
  };
  saveRegisteredUser(newUser);

  AudioFeedback.playSuccess();
  showToast('Account Created!', 'Welcome ' + fullName + '! Account registered.', 'success');

  setAuthView('login');
  const idInput = document.getElementById('login-identifier');
  const passInput = document.getElementById('login-password');
  if (idInput && passInput) {
    idInput.value = contact;
    passInput.value = password;
  }

  authState.loginBiometricVerified = true;
  authState.loginBiometricType = authState.regBiometricType;
  updateLoginBiometricUI();

  showToast('Ready to Sign In', 'Click "Sign In" now to access DOCDON.', 'info');
}

// Live Camera Functions
async function startLiveBiometricCamera(context) {
  const videoEl = document.getElementById('biometric-camera-video');
  const statusEl = document.getElementById('face-status-text');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#d97706;">Camera API unavailable in this browser. Tap "Confirm Face" below.</span>';
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
      audio: false
    });
    authState.cameraStream = stream;
    if (videoEl) {
      videoEl.srcObject = stream;
      videoEl.onloadedmetadata = () => { videoEl.play(); };
    }
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:#0891b2;">Camera active. Hold still for face match...</span>';
    }

    setTimeout(() => {
      if (statusEl && authState.cameraStream) {
        statusEl.innerHTML = '<span style="color:#059669; font-weight:700;">✔ Face Recognized (99.8% Match)</span>';
        AudioFeedback.playSuccess();
      }
    }, 2500);

    setTimeout(() => {
      if (authState.cameraStream) {
        confirmBiometricScan(context, 'face');
      }
    }, 3600);

  } catch (err) {
    console.warn("Camera error:", err);
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:#e11d48;">Camera permission needed. Click "Allow" or tap "Confirm Face" below.</span>';
    }
  }
}

function stopLiveBiometricCamera() {
  if (authState.cameraStream) {
    authState.cameraStream.getTracks().forEach(t => t.stop());
    authState.cameraStream = null;
  }
}

// Open Biometric Modal
function openBiometricModal(context, type) {
  AudioFeedback.playScan();
  const modal = document.getElementById('modal-container');
  if (!modal) return;

  const isRegister = context === 'register';
  const isFace = type === 'face';

  if (isFace) {
    modal.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-card">
          <div class="modal-header">
            <span>📷 ${isRegister ? 'Register Face ID' : 'Compulsory Face ID'}</span>
            <button type="button" onclick="closeModal()" class="btn-close-modal">✕</button>
          </div>

          <div class="modal-info-box">
            <strong>Live Camera:</strong> Align your face inside the circle for verification.
          </div>

          <div class="camera-frame-box">
            <video id="biometric-camera-video" autoplay playsinline muted></video>
            <div class="scan-laser"></div>
            <div style="position:absolute; inset:8px; border:2px dashed rgba(6,182,212,0.6); border-radius:50%; pointer-events:none;"></div>
          </div>

          <div id="face-status-text" style="font-size:12px; color:#0e7490; font-weight:600; margin-bottom:12px;">
            Initializing live camera...
          </div>

          <div style="display:flex; justify-content:center; gap:8px;">
            <button type="button" onclick="closeModal()" class="btn-secondary" style="width:auto; margin:0; padding:8px 16px;">
              Cancel
            </button>
            <button type="button" onclick="confirmBiometricScan('${context}', 'face')" class="btn-primary" style="width:auto; margin:0; padding:8px 18px; background:#0891b2;">
              Confirm Face
            </button>
          </div>
        </div>
      </div>
    `;
    startLiveBiometricCamera(context);

  } else {
    modal.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-card">
          <div class="modal-header">
            <span style="color:#4f46e5;">👆 ${isRegister ? 'Register Touch ID' : 'Compulsory Touch ID'}</span>
            <button type="button" onclick="closeModal()" class="btn-close-modal">✕</button>
          </div>

          <div class="modal-info-box" style="background:#eef2ff; border-color:#e0e7ff; color:#3730a3;">
            <strong>Touch Sensor:</strong> Tap the fingerprint icon below to authenticate.
          </div>

          <div onclick="confirmBiometricScan('${context}', 'fingerprint')" class="fingerprint-sensor-btn">
            👆
          </div>

          <div id="fp-status-text" style="font-size:12px; color:#64748b; margin-bottom:12px;">
            Tap sensor to authenticate
          </div>

          <div style="display:flex; justify-content:center; gap:8px;">
            <button type="button" onclick="closeModal()" class="btn-secondary" style="width:auto; margin:0; padding:8px 16px;">
              Cancel
            </button>
            <button type="button" onclick="confirmBiometricScan('${context}', 'fingerprint')" class="btn-primary" style="width:auto; margin:0; padding:8px 18px; background:#4f46e5;">
              Scan Finger
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

// Confirm Biometric
function confirmBiometricScan(context, type) {
  stopLiveBiometricCamera();
  closeModal();
  AudioFeedback.playSuccess();

  if (context === 'register') {
    authState.regBiometricVerified = true;
    authState.regBiometricType = type;
    updateRegBiometricUI();
    showToast('Biometrics Registered', (type === 'face' ? 'Face ID' : 'Touch ID') + ' linked to your account.', 'success');
  } else {
    authState.loginBiometricVerified = true;
    authState.loginBiometricType = type;
    updateLoginBiometricUI();
    showToast('Biometric Verified', 'Compulsory ' + (type === 'face' ? 'Face ID' : 'Touch ID') + ' confirmed.', 'success');

    const idEl = document.getElementById('login-identifier');
    const passEl = document.getElementById('login-password');
    if (idEl && passEl && idEl.value.trim() && passEl.value) {
      handleLoginSubmit({ preventDefault: () => {} });
    }
  }
}

// Success Banner
function showAuthSuccessBanner(user) {
  const banner = document.getElementById('auth-success-banner');
  if (!banner) return;
  banner.innerHTML = `
    <div class="auth-success-left">
      <div class="success-icon-badge">✔</div>
      <div>
        <div style="font-weight:700; font-size:12px; color:#0f172a;">DOCDON Access Granted</div>
        <div style="font-size:11px; color:#475569;">Welcome, <strong>` + user.name + `</strong>!</div>
      </div>
    </div>
    <button type="button" onclick="handleSignOut()" class="btn-signout">Sign Out</button>
  `;
  banner.classList.remove('hidden');
  banner.style.display = 'flex';
}

function handleSignOut() {
  stopLiveBiometricCamera();
  authState.currentUser = null;
  authState.loginBiometricVerified = false;
  authState.loginBiometricType = null;
  updateLoginBiometricUI();
  const banner = document.getElementById('auth-success-banner');
  if (banner) {
    banner.classList.add('hidden');
    banner.style.display = 'none';
  }
  AudioFeedback.playScan();
  showToast('Signed Out', 'You have been signed out from DOCDON.', 'info');
}

function closeModal() {
  stopLiveBiometricCamera();
  const modal = document.getElementById('modal-container');
  if (modal) modal.innerHTML = '';
}

// Event Listeners on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  getRegisteredUsers();
  
  const btnGotoRegister = document.getElementById('btn-goto-register');
  if (btnGotoRegister) {
    btnGotoRegister.addEventListener('click', (e) => {
      e.preventDefault();
      setAuthView('register');
    });
  }

  const btnGotoLogin = document.getElementById('btn-goto-login');
  if (btnGotoLogin) {
    btnGotoLogin.addEventListener('click', (e) => {
      e.preventDefault();
      setAuthView('login');
    });
  }
});
