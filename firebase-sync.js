/**
 * Water Polo Tactical Board - Firebase Cloud Sync Module
 * Provides seamless Google Authentication and Cloud Firestore backup for custom tactics.
 * Fully offline-capable: falls back gracefully to localStorage when offline or signed out.
 */

(function () {
  'use strict';

  // Official Firebase Project Configuration
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyB26_MtXl9oG6UVVkRJwv0ustRstrsti64",
    authDomain: "waterpolo-tactic-board.firebaseapp.com",
    projectId: "waterpolo-tactic-board",
    storageBucket: "waterpolo-tactic-board.firebasestorage.app",
    messagingSenderId: "404299942200",
    appId: "1:404299942200:android:a76ac630c98d796a7259cd"
  };

  const CloudSync = {
    initialized: false,
    auth: null,
    db: null,
    currentUser: null,
    isSyncing: false,
    syncListeners: [],
    authListeners: [],

    init: function () {
      // Always bind button clicks first, so user clicks are never lost
      this.bindEvents();

      if (this.initialized) return;

      if (typeof window.firebase === 'undefined') {
        console.warn('Firebase SDK not loaded, running in pure offline mode.');
        return;
      }

      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(FIREBASE_CONFIG);
        }
        this.auth = firebase.auth();
        this.db = firebase.firestore();

        // Enable offline persistence in Firestore
        try {
          this.db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
            console.info('Firestore persistence note:', err.code);
          });
        } catch (e) {}

        this.initialized = true;

        // Listen for Auth state changes
        this.auth.onAuthStateChanged((user) => {
          this.currentUser = user;
          this.updateUI(user);
          this.notifyAuthListeners(user);

          if (user) {
            this.syncTactics();
          }
        });

        // Auto-sync when coming back online
        window.addEventListener('online', () => {
          if (this.currentUser) {
            this.syncTactics();
          }
        });
      } catch (err) {
        console.error('Firebase initialization error:', err);
      }
    },

    bindEvents: function () {
      const signInBtn = document.getElementById('cloudSignInBtn');
      const signUpBtn = document.getElementById('cloudSignUpBtn');
      const forgotBtn = document.getElementById('cloudForgotPassBtn');
      const signOutBtn = document.getElementById('googleSignOutBtn');
      const manualSyncBtn = document.getElementById('cloudManualSyncBtn');
      const emailInput = document.getElementById('cloudEmailInput');
      const passwordInput = document.getElementById('cloudPasswordInput');

      if (signInBtn && !signInBtn._isBound) {
        signInBtn._isBound = true;
        signInBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.handleEmailSignIn();
        });
      }

      if (signUpBtn && !signUpBtn._isBound) {
        signUpBtn._isBound = true;
        signUpBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.handleEmailSignUp();
        });
      }

      if (forgotBtn && !forgotBtn._isBound) {
        forgotBtn._isBound = true;
        forgotBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.handleForgotPassword();
        });
      }

      if (passwordInput && !passwordInput._isBound) {
        passwordInput._isBound = true;
        passwordInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.handleEmailSignIn();
          }
        });
      }

      if (signOutBtn && !signOutBtn._isBound) {
        signOutBtn._isBound = true;
        signOutBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.signOut();
        });
      }

      if (manualSyncBtn && !manualSyncBtn._isBound) {
        manualSyncBtn._isBound = true;
        manualSyncBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.syncTactics(true);
        });
      }
    },

    ensureInitialized: function () {
      if (!this.initialized) {
        this.init();
      }
      return this.initialized && this.auth;
    },

    handleEmailSignIn: async function () {
      if (!this.ensureInitialized()) {
        this.showToast('⚠️ Η υπηρεσία Cloud δεν είναι διαθέσιμη. Ελέγξτε τη σύνδεση.');
        return;
      }

      const emailInput = document.getElementById('cloudEmailInput');
      const passInput = document.getElementById('cloudPasswordInput');
      const btn = document.getElementById('cloudSignInBtn');

      const email = emailInput ? emailInput.value.trim() : '';
      const pass = passInput ? passInput.value : '';

      if (!email || !email.includes('@')) {
        alert('Παρακαλούμε εισάγετε ένα έγκυρο email.');
        if (emailInput) emailInput.focus();
        return;
      }
      if (!pass || pass.length < 6) {
        alert('Παρακαλούμε εισάγετε τον κωδικό πρόσβασης (τουλάχιστον 6 χαρακτήρες).');
        if (passInput) passInput.focus();
        return;
      }

      const origText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Σύνδεση...';
      }

      try {
        const cred = await this.auth.signInWithEmailAndPassword(email, pass);
        this.showToast(`Καλώς ήρθατε, ${cred.user.email}!`);
      } catch (err) {
        console.error('Sign in error:', err);
        let msg = 'Σφάλμα σύνδεσης: ';
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
          msg = 'Δεν βρέθηκε λογαριασμός με αυτό το email ή ο κωδικός είναι λάθος.\n\n👉 Αν είναι η πρώτη φορά, πατήστε το κουμπί «✨ Εγγραφή»!';
        } else if (err.code === 'auth/wrong-password') {
          msg = 'Λανθασμένος κωδικός πρόσβασης.';
        } else if (err.code === 'auth/invalid-email') {
          msg = 'Μη έγκυρη διεύθυνση email.';
        } else if (err.code === 'auth/network-request-failed') {
          msg = 'Αποτυχία σύνδεσης στο διαδίκτυο.';
        } else {
          msg += (err.message || err.code);
        }
        alert(msg);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origText;
        }
      }
    },

    handleEmailSignUp: async function () {
      if (!this.ensureInitialized()) {
        this.showToast('⚠️ Η υπηρεσία Cloud δεν είναι διαθέσιμη. Ελέγξτε τη σύνδεση.');
        return;
      }

      const emailInput = document.getElementById('cloudEmailInput');
      const passInput = document.getElementById('cloudPasswordInput');
      const btn = document.getElementById('cloudSignUpBtn');

      const email = emailInput ? emailInput.value.trim() : '';
      const pass = passInput ? passInput.value : '';

      if (!email || !email.includes('@')) {
        alert('Παρακαλούμε εισάγετε ένα έγκυρο email (π.χ. coach@gmail.com).');
        if (emailInput) emailInput.focus();
        return;
      }
      if (!pass || pass.length < 6) {
        alert('Ο κωδικός πρέπει να αποτελείται από τουλάχιστον 6 χαρακτήρες.');
        if (passInput) passInput.focus();
        return;
      }

      const origText = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Εγγραφή...';
      }

      try {
        const cred = await this.auth.createUserWithEmailAndPassword(email, pass);
        this.showToast(`Ο λογαριασμός σας δημιουργήθηκε επιτυχώς!`);
      } catch (err) {
        console.error('Sign up error:', err);
        let msg = 'Σφάλμα εγγραφής: ';
        if (err.code === 'auth/email-already-in-use') {
          msg = 'Αυτό το email είναι ήδη εγγεγραμμένο!\n\n👉 Πατήστε το κουμπί «🔑 Σύνδεση».';
        } else if (err.code === 'auth/weak-password') {
          msg = 'Ο κωδικός είναι αδύναμος. Βάλτε τουλάχιστον 6 χαρακτήρες.';
        } else if (err.code === 'auth/invalid-email') {
          msg = 'Μη έγκυρη διεύθυνση email.';
        } else {
          msg += (err.message || err.code);
        }
        alert(msg);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origText;
        }
      }
    },

    handleForgotPassword: async function () {
      if (!this.ensureInitialized()) {
        this.showToast('⚠️ Η υπηρεσία Cloud δεν είναι διαθέσιμη. Ελέγξτε τη σύνδεση.');
        return;
      }

      const emailInput = document.getElementById('cloudEmailInput');
      let email = emailInput ? emailInput.value.trim() : '';

      if (!email || !email.includes('@')) {
        email = prompt('Εισάγετε το email σας για να λάβετε σύνδεσμο επαναφοράς κωδικού:', email || '');
        if (!email) return;
        email = email.trim();
      }

      if (!email || !email.includes('@')) {
        alert('Παρακαλούμε εισάγετε ένα έγκυρο email.');
        return;
      }

      const forgotBtn = document.getElementById('cloudForgotPassBtn');
      const origText = forgotBtn ? forgotBtn.innerHTML : '';
      if (forgotBtn) {
        forgotBtn.disabled = true;
        forgotBtn.innerHTML = '⏳ Αποστολή...';
      }

      try {
        await this.auth.sendPasswordResetEmail(email);
        alert(`✉️ Στάλθηκε email επαναφοράς κωδικού στο:\n${email}\n\nΕλέγξτε τα εισερχόμενά σας (και τον φάκελο Ανεπιθύμητα / Spam)!`);
      } catch (err) {
        console.error('Password reset error:', err);
        let msg = 'Σφάλμα επαναφοράς κωδικού: ';
        if (err.code === 'auth/user-not-found') {
          msg = 'Δεν βρέθηκε λογαριασμός με αυτό το email.';
        } else if (err.code === 'auth/invalid-email') {
          msg = 'Μη έγκυρη διεύθυνση email.';
        } else if (err.code === 'auth/network-request-failed') {
          msg = 'Αποτυχία σύνδεσης στο διαδίκτυο.';
        } else {
          msg += (err.message || err.code);
        }
        alert(msg);
      } finally {
        if (forgotBtn) {
          forgotBtn.disabled = false;
          forgotBtn.innerHTML = origText;
        }
      }
    },

    signOut: async function () {
      if (!this.auth) return;
      try {
        await this.auth.signOut();
        this.showToast('Αποσυνδεθήκατε επιτυχώς.');
      } catch (err) {
        console.error('Sign out error:', err);
      }
    },

    updateUI: function (user) {
      const guestEl = document.getElementById('cloudSyncGuest');
      const userEl = document.getElementById('cloudSyncUser');
      const nameEl = document.getElementById('cloudUserName');
      const emailEl = document.getElementById('cloudUserEmail');
      const topBadge = document.getElementById('cloudStatusBadge');
      const passInput = document.getElementById('cloudPasswordInput');

      if (user) {
        if (guestEl) guestEl.classList.add('hidden');
        if (userEl) userEl.classList.remove('hidden');
        if (passInput) passInput.value = '';

        if (nameEl) {
          nameEl.textContent = user.displayName || user.email || 'Προπονητής';
        }
        if (emailEl) {
          emailEl.textContent = user.email || '';
        }
        if (topBadge) {
          topBadge.classList.add('active');
          topBadge.setAttribute('title', `Cloud Active: ${user.email}`);
        }
      } else {
        if (guestEl) guestEl.classList.remove('hidden');
        if (userEl) userEl.classList.add('hidden');
        if (topBadge) {
          topBadge.classList.remove('active');
          topBadge.setAttribute('title', 'Cloud Disconnected');
        }
      }
    },

    // Save or update a single custom tactic in Cloud Firestore
    saveTactic: async function (tactic) {
      if (!this.initialized || !this.db || !this.currentUser) return;
      if (!tactic || !tactic.id) return;

      try {
        const uid = this.currentUser.uid;
        const docRef = this.db.collection('users').doc(uid).collection('tactics').doc(tactic.id);
        
        // Deep copy clean object for Firestore
        const cleanTactic = JSON.parse(JSON.stringify(tactic));
        cleanTactic.updatedAt = new Date().toISOString();
        if (!cleanTactic.createdAt) {
          cleanTactic.createdAt = cleanTactic.date || cleanTactic.updatedAt;
        }

        await docRef.set(cleanTactic, { merge: true });
        this.updateSyncBadge(true);
      } catch (err) {
        console.error('Error saving tactic to Firestore:', err);
      }
    },

    // Delete a tactic from Cloud Firestore
    deleteTactic: async function (tacticId) {
      if (!this.initialized || !this.db || !this.currentUser) return;
      if (!tacticId) return;

      try {
        const uid = this.currentUser.uid;
        await this.db.collection('users').doc(uid).collection('tactics').doc(tacticId).delete();
      } catch (err) {
        console.error('Error deleting tactic from Firestore:', err);
      }
    },

    // Two-way non-destructive merge between local and Firestore tactics
    syncTactics: async function (showToastFeedback = false) {
      if (!this.initialized || !this.db || !this.currentUser) return;
      if (this.isSyncing) return;

      this.isSyncing = true;
      const syncBtn = document.getElementById('cloudManualSyncBtn');
      if (syncBtn) syncBtn.classList.add('spin');

      try {
        const uid = this.currentUser.uid;
        const colRef = this.db.collection('users').doc(uid).collection('tactics');
        const snapshot = await colRef.get();

        const cloudTactics = [];
        snapshot.forEach((doc) => {
          cloudTactics.push(doc.data());
        });

        // Notify app to merge with local storage
        this.notifySyncListeners(cloudTactics);

        this.updateSyncBadge(true);
        if (showToastFeedback) {
          this.showToast(`Συγχρονισμός ολοκληρώθηκε (${cloudTactics.length} τακτικές)`);
        }
      } catch (err) {
        console.error('Sync error:', err);
        if (showToastFeedback) {
          this.showToast('Σφάλμα συγχρονισμού: ' + (err.message || 'Αποτυχία δικτύου'));
        }
      } finally {
        this.isSyncing = false;
        if (syncBtn) syncBtn.classList.remove('spin');
      }
    },

    updateSyncBadge: function (isSynced) {
      const badge = document.getElementById('cloudSyncStatusText');
      if (badge) {
        badge.textContent = window.t
          ? window.t(isSynced ? 'cloud_all_synced' : 'cloud_sync_pending')
          : (isSynced ? 'All tactics synced' : 'Sync pending');
      }
    },

    onSync: function (cb) {
      if (typeof cb === 'function') {
        this.syncListeners.push(cb);
      }
    },

    notifySyncListeners: function (cloudTactics) {
      this.syncListeners.forEach((cb) => {
        try {
          cb(cloudTactics);
        } catch (e) {
          console.error('Sync listener error:', e);
        }
      });
    },

    onAuthStateChange: function (cb) {
      if (typeof cb === 'function') {
        this.authListeners.push(cb);
      }
    },

    notifyAuthListeners: function (user) {
      this.authListeners.forEach((cb) => {
        try {
          cb(user);
        } catch (e) {
          console.error('Auth listener error:', e);
        }
      });
    },

    showToast: function (msg) {
      if (typeof window.showToast === 'function') {
        window.showToast(msg);
      } else {
        console.log('[CloudSync]', msg);
      }
    }
  };

  window.CloudSync = CloudSync;

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CloudSync.init());
  } else {
    CloudSync.init();
  }
})();
