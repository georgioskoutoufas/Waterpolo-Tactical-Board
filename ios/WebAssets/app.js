/**
 * Water Polo Tactical Board Pro
 * High Performance Interactive Coaching Board
 */

(function () {
  'use strict';

  // --- Safe Cross-Platform Storage (Android Native SharedPreferences + Apple WKWebView + localStorage) ---
  function safeGetItem(key) {
    try {
      if (window.AndroidApp && typeof window.AndroidApp.getPref === 'function') {
        const val = window.AndroidApp.getPref(key);
        if (val !== null && val !== undefined && val !== '') {
          return val;
        }
      }
      if (window.__APPLE_PREFS__ && window.__APPLE_PREFS__[key]) {
        return window.__APPLE_PREFS__[key];
      }
    } catch (e) {}
    try {
      if (window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch (e) {}
    return null;
  }

  function safeSetItem(key, value) {
    try {
      if (window.AndroidApp && typeof window.AndroidApp.setPref === 'function') {
        window.AndroidApp.setPref(key, String(value));
      }
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.wptb) {
        window.__APPLE_PREFS__ = window.__APPLE_PREFS__ || {};
        window.__APPLE_PREFS__[key] = String(value);
        window.webkit.messageHandlers.wptb.postMessage({
          action: 'setPref',
          key: key,
          value: String(value)
        });
      }
    } catch (e) {}
    try {
      if (window.localStorage) {
        window.localStorage.setItem(key, String(value));
      }
    } catch (e) {}
  }

  // --- State Management ---
  const state = {
    lang: safeGetItem('wptb_lang') || 'en',
    view: 'half', // 'half' or 'full'
    mode: 'select', // 'select', 'draw', 'arrow', 'pass', 'eraser', 'angle'
    shootingShooterId: null,
    activeBlockerIds: [],
    currentColor: '#ffffff',
    strokeWidth: 4,
    teams: {
      attack: { color: safeGetItem('wptb_team_attack_color') || 'blue' },
      defense: { color: safeGetItem('wptb_team_defense_color') || 'white' }
    },
    currentTeamTab: 'white', // 'white' or 'blue'
    currentFrameIndex: 0,
    isPlaying: false,
    isLooping: true,
    isFullscreen: false,
    autoFullscreenFromPlay: false,
    animSpeed: 1, // multiplier
    draggedToken: null,
    dragOffset: { x: 0, y: 0 },
    dragStartPos: { x: 0, y: 0 },
    didMoveToken: false,
    dragOutToBench: false,
    selectedCapId: null,
    selectedBenchCapId: null,
    longPressTimer: null,
    tokens: [], // List of active tokens on board { id, type: 'cap'|'ball', team: 'white'|'blue', number: 1..13, x: %, y: % }
    frames: [], // Array of frames: { id, name, tokenPositions: { tokenId: {x, y} }, drawings: [] }
    drawingPaths: [], // Paths for the current frame
    activePath: null, // Temporary path currently being drawn
    animationTimer: null,
    currentTacticTitle: '',
    customTactics: [], // Saved custom tactics in localStorage
    selectedCustomTacticId: null,
    sidebarCollapsed: false,
    bottomBarCollapsed: false,
    settings: {
      theme: 'dark', // 'dark' | 'light'
      capSize: 'normal', // 'normal' | 'large'
      waterStyle: 'deep', // 'deep' | 'aqua'
      show2mBox: true,
      show5m6m: true,
        whistleSound: true,
      hapticFeedback: true,
    },
  };

  // --- Translation (i18n) Helper ---
  function t(key, params = {}) {
    const lang = state.lang || 'el';
    const dict = (window.TRANSLATIONS && window.TRANSLATIONS[lang]) || {};
    const fallbackDict = (window.TRANSLATIONS && (window.TRANSLATIONS['en'] || window.TRANSLATIONS['el'])) || {};
    let text = dict[key] || fallbackDict[key] || (window.TRANSLATIONS && window.TRANSLATIONS['el'] && window.TRANSLATIONS['el'][key]) || key;
    Object.keys(params).forEach(p => {
      text = text.replace(new RegExp(`\\{${p}\\}`, 'g'), params[p]);
    });
    return text;
  }
  window.t = t;

  function setLanguage(lang) {
    if (!window.TRANSLATIONS || !window.TRANSLATIONS[lang]) lang = 'en';
    state.lang = lang;
    safeSetItem('wptb_lang', lang);
    if (el.langSelect) el.langSelect.value = lang;

    // Update all elements with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(elem => {
      const key = elem.getAttribute('data-i18n');
      const val = t(key);
      if (typeof val === 'string' && val.includes('<')) {
        elem.innerHTML = val;
      } else {
        elem.textContent = val;
      }
    });

    // Update all elements with data-i18n-title (buttons, tooltips)
    document.querySelectorAll('[data-i18n-title]').forEach(elem => {
      const key = elem.getAttribute('data-i18n-title');
      elem.title = t(key);
    });

    // Update all elements with data-i18n-placeholder (input fields)
    document.querySelectorAll('[data-i18n-placeholder]').forEach(elem => {
      const key = elem.getAttribute('data-i18n-placeholder');
      elem.placeholder = t(key);
    });

    // Update all elements with data-i18n-label (optgroups)
    document.querySelectorAll('[data-i18n-label]').forEach(elem => {
      const key = elem.getAttribute('data-i18n-label');
      elem.label = t(key);
    });

    // Update play button text
    if (el.playText) {
      el.playText.textContent = state.isPlaying ? t('pause_btn') : t('play_btn');
    }

    renderPitchSvg();
    renderTimeline();
    renderTray();
    updateBallsPaletteUI();
    renderCustomTacticsDropdown(state.selectedCustomTacticId);
    updateTeamColorsUI();
    if (state.mode === 'angle') {
      renderShootingAnalysis();
    }
    updateModeButtonsForView();
    if (el.tutorialModal && !el.tutorialModal.classList.contains('hidden') && typeof window.renderTutorialStep === 'function') {
      window.renderTutorialStep(window.currentTutorialStep || 0);
    }
  }

  // --- SVG Dimensions (Internal Coordinate Space) ---
  const PITCH_CONFIG = {
    full: {
      width: 1000,
      height: 650,
      goalWidth: 35,
      goalHeight: 120,
      margin: 40,
    },
    half: {
      width: 1000,
      height: 680,
      goalWidth: 140,
      goalHeight: 35,
      margin: 40,
    }
  };

  // --- DOM Elements ---
  const el = {
    poolBoard: document.getElementById('poolBoard'),
    svgPitch: document.getElementById('poolPitchSvg'),
    svgPitchContent: document.getElementById('svgPitchContent'),
    canvas: document.getElementById('drawingCanvas'),
    tokensLayer: document.getElementById('tokensLayer'),
    capsTray: document.getElementById('capsTray'),
    timelineContainer: document.getElementById('timelineContainer'),
    timelineFrames: document.getElementById('timelineFrames'),
    toast: document.getElementById('boardToast'),
    langSelect: document.getElementById('langSelect'),
    // Buttons
    viewHalfBtn: document.getElementById('viewHalfBtn'),
    viewFullBtn: document.getElementById('viewFullBtn'),
    modeBtns: document.querySelectorAll('.mode-btn'),
    colorSwatches: document.querySelectorAll('.color-swatch'),
    strokeSize: document.getElementById('strokeSize'),
    strokeSizeVal: document.getElementById('strokeSizeVal'),
    undoDrawBtn: document.getElementById('undoDrawBtn'),
    clearDrawBtn: document.getElementById('clearDrawBtn'),
    tabTeamWhite: document.getElementById('tabTeamWhite'),
    tabTeamBlue: document.getElementById('tabTeamBlue'),
    addCapBtn: document.getElementById('addCapBtn'),
    removeCapBtn: document.getElementById('removeCapBtn'),
    bringAllCapsBtn: document.getElementById('bringAllCapsBtn'),
    benchAllCapsBtn: document.getElementById('benchAllCapsBtn'),
    playBtn: document.getElementById('playBtn'),
    playIcon: document.getElementById('playIcon'),
    playText: document.getElementById('playText'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),
    fullscreenIcon: document.getElementById('fullscreenIcon'),
    fullscreenText: document.getElementById('fullscreenText'),
    exitFullscreenOverlayBtn: document.getElementById('exitFullscreenOverlayBtn'),
    animSpeedSelect: document.getElementById('animSpeedSelect'),
    addFrameBtn: document.getElementById('addFrameBtn'),
    duplicateFrameBtn: document.getElementById('duplicateFrameBtn'),
    deleteFrameBtn: document.getElementById('deleteFrameBtn'),
    resetPositionsBtn: document.getElementById('resetPositionsBtn'),
    fileMenuBtn: document.getElementById('fileMenuBtn'),
    fileModal: document.getElementById('fileModal'),
    closeFileModalBtn: document.getElementById('closeFileModalBtn'),
    saveTacticBtn: document.getElementById('saveTacticBtn'),
    loadTacticBtn: document.getElementById('loadTacticBtn'),
    shareTacticBtn: document.getElementById('shareTacticBtn'),
    tacticFileInput: document.getElementById('tacticFileInput'),
    presetSelect: document.getElementById('presetSelect'),
    customTacticsGroup: document.getElementById('customTacticsGroup'),
    addCustomPresetBtn: document.getElementById('addCustomPresetBtn'),
    deleteCustomPresetBtn: document.getElementById('deleteCustomPresetBtn'),
    sidebarLeft: document.getElementById('sidebarLeft'),
    toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
    closeSidebarBtn: document.getElementById('closeSidebarBtn'),
    floatingOpenSidebarBtn: document.getElementById('floatingOpenSidebarBtn'),
    closeBottomBarBtn: document.getElementById('closeBottomBarBtn'),
    floatingOpenBottomBtn: document.getElementById('floatingOpenBottomBtn'),
    aboutBtn: document.getElementById('aboutBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    quickTeamsBtn: document.getElementById('quickTeamsBtn'),
    topBarTeamsPill: document.getElementById('topBarTeamsPill'),
    attackCapPreview: document.getElementById('attackCapPreview'),
    defenseCapPreview: document.getElementById('defenseCapPreview'),
    attackColorSwatches: document.getElementById('attackColorSwatches'),
    defenseColorSwatches: document.getElementById('defenseColorSwatches'),
    swapTeamsBtn: document.getElementById('swapTeamsBtn'),
    aboutTrigger: document.getElementById('aboutTrigger'),
    aboutModal: document.getElementById('settingsModal') || document.getElementById('aboutModal'),
    settingsModal: document.getElementById('settingsModal'),
    closeAboutModalBtn: document.getElementById('closeAboutModalBtn') || document.getElementById('closeSettingsModalBtn'),
    closeSettingsModalBtn: document.getElementById('closeSettingsModalBtn'),
    okAboutModalBtn: document.getElementById('okAboutModalBtn') || document.getElementById('okSettingsModalBtn'),
    okSettingsModalBtn: document.getElementById('okSettingsModalBtn'),
    themeDarkBtn: document.getElementById('themeDarkBtn'),
    themeLightBtn: document.getElementById('themeLightBtn'),
    capSizeNormalBtn: document.getElementById('capSizeNormalBtn'),
    capSizeLargeBtn: document.getElementById('capSizeLargeBtn'),
    waterDeepBtn: document.getElementById('waterDeepBtn'),
    waterAquaBtn: document.getElementById('waterAquaBtn'),
    toggle2mBox: document.getElementById('toggle2mBox'),
    toggle5m6m: document.getElementById('toggle5m6m'),
    toggleWhistle: document.getElementById('toggleWhistle'),
    toggleHaptics: document.getElementById('toggleHaptics'),
    shootingAngleSvg: document.getElementById('shootingAngleSvg'),
    shootingAnalysisHud: document.getElementById('shootingAnalysisHud'),
    angleHudHeader: document.getElementById('angleHudHeader'),
    minimizeAngleHudBtn: document.getElementById('minimizeAngleHudBtn'),
    angleHudMiniSummary: document.getElementById('angleHudMiniSummary'),
    closeAngleHudBtn: document.getElementById('closeAngleHudBtn'),
    angleShooterName: document.getElementById('angleShooterName'),
    angleBlockerName: document.getElementById('angleBlockerName'),
    angleDistanceVal: document.getElementById('angleDistanceVal'),
    angleOpenVal: document.getElementById('angleOpenVal'),
    angleCoveredVal: document.getElementById('angleCoveredVal'),
    angleRuleBadge: document.getElementById('angleRuleBadge'),
    tutorialModal: document.getElementById('tutorialModal'),
    closeTutorialBtn: document.getElementById('closeTutorialBtn'),
    tutorialStepIndicator: document.getElementById('tutorialStepIndicator'),
    tutorialHeroIcon: document.getElementById('tutorialHeroIcon'),
    tutorialStepTitle: document.getElementById('tutorialStepTitle'),
    tutorialStepDesc: document.getElementById('tutorialStepDesc'),
    tutorialVisualCard: document.getElementById('tutorialVisualCard'),
    tutorialDots: document.getElementById('tutorialDots'),
    tutorialPrevBtn: document.getElementById('tutorialPrevBtn'),
    tutorialSkipBtn: document.getElementById('tutorialSkipBtn'),
    tutorialNextBtn: document.getElementById('tutorialNextBtn'),
    replayTutorialBtn: document.getElementById('replayTutorialBtn'),
  };

  const ctx = el.canvas.getContext('2d');

  // --- Helper: Toast Notification ---
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(el.toast._timer);
    el.toast._timer = setTimeout(() => {
      el.toast.classList.remove('show');
    }, 2200);
  }
  window.showToast = showToast;

  // --- Settings & Audio Synthesizer ---

const DEFAULT_SETTINGS = {
    theme: 'dark',
    capSize: 'normal',
    waterStyle: 'deep',
    show2mBox: true,
    show5m6m: true,
    whistleSound: true,
    hapticFeedback: true,
  };

  function loadSettings() {
    const raw = safeGetItem('wptb_settings');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        state.settings = Object.assign({}, DEFAULT_SETTINGS, parsed);
      } catch (e) {
        state.settings = Object.assign({}, DEFAULT_SETTINGS);
      }
    } else {
      state.settings = Object.assign({}, DEFAULT_SETTINGS);
    }
    applyAllSettings();

    // Restore Sidebar Collapsed state
    const savedSidebar = safeGetItem('wptb_sidebar_collapsed');
    if (savedSidebar === '1') {
      setSidebarCollapsed(true, true);
    }

    // Restore Bottom Bar Collapsed state
    const savedBottom = safeGetItem('wptb_bottom_collapsed');
    if (savedBottom === '1') {
      setBottomBarCollapsed(true, true);
    }
  }

  function saveSettings() {
    safeSetItem('wptb_settings', JSON.stringify(state.settings));
  }

  function applyAllSettings() {
    // 1. Theme
    if (state.settings.theme === 'light') {
      document.body.classList.add('light-theme');
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.body.classList.remove('light-theme');
      document.documentElement.setAttribute('data-theme', 'dark');
    }

    // 2. Cap size
    if (state.settings.capSize === 'large') {
      document.body.classList.add('cap-size-large');
    } else {
      document.body.classList.remove('cap-size-large');
    }

    updateSettingsUI();
  }

  function updateSettingsUI() {
    if (el.themeDarkBtn && el.themeLightBtn) {
      el.themeDarkBtn.classList.toggle('active', state.settings.theme === 'dark');
      el.themeLightBtn.classList.toggle('active', state.settings.theme === 'light');
    }
    if (el.capSizeNormalBtn && el.capSizeLargeBtn) {
      el.capSizeNormalBtn.classList.toggle('active', state.settings.capSize === 'normal');
      el.capSizeLargeBtn.classList.toggle('active', state.settings.capSize === 'large');
    }
    if (el.waterDeepBtn && el.waterAquaBtn) {
      el.waterDeepBtn.classList.toggle('active', state.settings.waterStyle === 'deep');
      el.waterAquaBtn.classList.toggle('active', state.settings.waterStyle === 'aqua');
    }
    if (el.toggle2mBox) el.toggle2mBox.checked = !!state.settings.show2mBox;
    if (el.toggle5m6m) el.toggle5m6m.checked = !!state.settings.show5m6m;
    if (el.toggleWhistle) el.toggleWhistle.checked = !!state.settings.whistleSound;
    if (el.toggleHaptics) el.toggleHaptics.checked = !!state.settings.hapticFeedback;
    updateTeamColorsUI();
  }

  function triggerHaptic(ms = 40) {
    if (!state.settings || !state.settings.hapticFeedback) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

  function playWhistleSound() {
    if (!state.settings || !state.settings.whistleSound) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const actx = new AudioCtx();
      const now = actx.currentTime;

      const osc1 = actx.createOscillator();
      const osc2 = actx.createOscillator();
      const gain = actx.createGain();

      const mod = actx.createOscillator();
      const modGain = actx.createGain();
      mod.type = 'sine';
      mod.frequency.value = 25;
      modGain.gain.value = 140;

      mod.connect(osc1.frequency);
      mod.connect(osc2.frequency);

      osc1.type = 'sine';
      osc1.frequency.value = 2650;
      osc2.type = 'sine';
      osc2.frequency.value = 2950;

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(actx.destination);

      mod.start(now);
      osc1.start(now);
      osc2.start(now);

      mod.stop(now + 0.36);
      osc1.stop(now + 0.36);
      osc2.stop(now + 0.36);
    } catch (e) {}
  }

  // --- Pitch SVG Rendering ---
  function renderPitchSvg() {
    const isHalf = state.view === 'half';
    const cfg = isHalf ? PITCH_CONFIG.half : PITCH_CONFIG.full;
    el.svgPitch.setAttribute('viewBox', `0 0 ${cfg.width} ${cfg.height}`);

    if (isHalf) {
      el.poolBoard.classList.add('half-view');
    } else {
      el.poolBoard.classList.remove('half-view');
    }

    let svg = '';

    // 1. Pool Water Background with Tiles & Realistic Highlights
    const waterFill = (state.settings && state.settings.waterStyle === 'aqua') ? 'url(#waterGlowAqua)' : 'url(#waterGlow)';
    svg += `
      <rect width="${cfg.width}" height="${cfg.height}" fill="${waterFill}" />
      <rect width="${cfg.width}" height="${cfg.height}" fill="url(#poolTiles)" />
      <ellipse cx="${cfg.width * 0.4}" cy="${cfg.height * 0.3}" rx="${cfg.width * 0.5}" ry="${cfg.height * 0.4}" fill="url(#caustic)" />
    `;

    const m = cfg.margin;
    const poolW = cfg.width - (m * 2);
    const poolH = cfg.height - (m * 2);
    const topY = m;
    const bottomY = cfg.height - m;
    const leftX = m;
    const rightX = cfg.width - m;




    if (!isHalf) {
      // ================= FULL COURT (30m Pool) =================
      const goalLineLeft = leftX + 40;
      const goalLineRight = rightX - 40;
      const courtW = goalLineRight - goalLineLeft;
      const centerX = goalLineLeft + courtW / 2;

      // Meter markers in ratio (assuming 30m length)
      // 2m line: (2/30) * courtW
      const m2 = (2 / 30) * courtW;
      // 5m line: (5/30) * courtW
      const m5 = (5 / 30) * courtW;
      // 6m line: (6/30) * courtW
      const m6 = (6 / 30) * courtW;

      // Red Zones (0 to 2m) subtle tint
      svg += `
        <rect x="${goalLineLeft}" y="${topY}" width="${m2}" height="${poolH}" fill="rgba(239, 68, 68, 0.08)" />
        <rect x="${goalLineRight - m2}" y="${topY}" width="${m2}" height="${poolH}" fill="rgba(239, 68, 68, 0.08)" />
      `;

      // Yellow Zones (2m to 5m) & Green Zones (5m to 6m)
      if (!state.settings || state.settings.show5m6m) {
        svg += `
          <rect x="${goalLineLeft + m2}" y="${topY}" width="${m5 - m2}" height="${poolH}" fill="rgba(234, 179, 8, 0.08)" />
          <rect x="${goalLineLeft + m5}" y="${topY}" width="${m6 - m5}" height="${poolH}" fill="rgba(16, 185, 129, 0.08)" />
          <rect x="${goalLineRight - m5}" y="${topY}" width="${m5 - m2}" height="${poolH}" fill="rgba(234, 179, 8, 0.08)" />
          <rect x="${goalLineRight - m6}" y="${topY}" width="${m6 - m5}" height="${poolH}" fill="rgba(16, 185, 129, 0.08)" />
        `;
      }

      // Pool Boundary Box
      svg += `<rect x="${leftX}" y="${topY}" width="${poolW}" height="${poolH}" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="3" rx="4" />`;

      // Center Line (White)
      svg += `
        <line x1="${centerX}" y1="${topY}" x2="${centerX}" y2="${bottomY}" stroke="#ffffff" stroke-width="2.5" />
        <circle cx="${centerX}" cy="${topY + poolH / 2}" r="24" fill="none" stroke="#ffffff" stroke-width="2" />
        <circle cx="${centerX}" cy="${topY + poolH / 2}" r="3" fill="#ffffff" />
      `;

      // 2m Lines (Red dashed) - Labeled top and bottom
      svg += `
        <line x1="${goalLineLeft + m2}" y1="${topY}" x2="${goalLineLeft + m2}" y2="${bottomY}" stroke="#ef4444" stroke-width="2" stroke-dasharray="6,4" />
        <text x="${goalLineLeft + m2}" y="${topY - 10}" fill="#ef4444" font-size="10.5" font-weight="800" text-anchor="middle">2m</text>
        <text x="${goalLineLeft + m2}" y="${bottomY + 18}" fill="#ef4444" font-size="10.5" font-weight="800" text-anchor="middle">2m</text>
        <line x1="${goalLineRight - m2}" y1="${topY}" x2="${goalLineRight - m2}" y2="${bottomY}" stroke="#ef4444" stroke-width="2" stroke-dasharray="6,4" />
        <text x="${goalLineRight - m2}" y="${topY - 10}" fill="#ef4444" font-size="10.5" font-weight="800" text-anchor="middle">2m</text>
        <text x="${goalLineRight - m2}" y="${bottomY + 18}" fill="#ef4444" font-size="10.5" font-weight="800" text-anchor="middle">2m</text>
      `;

      // 5m and 6m Lines
      if (!state.settings || state.settings.show5m6m) {
        // 5m Lines (Yellow dashed) - Labeled top and bottom
        svg += `
          <line x1="${goalLineLeft + m5}" y1="${topY}" x2="${goalLineLeft + m5}" y2="${bottomY}" stroke="#eab308" stroke-width="1.8" stroke-dasharray="4,4" />
          <text x="${goalLineLeft + m5}" y="${topY - 10}" fill="#eab308" font-size="10.5" font-weight="800" text-anchor="middle">5m</text>
          <text x="${goalLineLeft + m5}" y="${bottomY + 18}" fill="#eab308" font-size="10.5" font-weight="800" text-anchor="middle">5m</text>
          <line x1="${goalLineRight - m5}" y1="${topY}" x2="${goalLineRight - m5}" y2="${bottomY}" stroke="#eab308" stroke-width="1.8" stroke-dasharray="4,4" />
          <text x="${goalLineRight - m5}" y="${topY - 10}" fill="#eab308" font-size="10.5" font-weight="800" text-anchor="middle">5m</text>
          <text x="${goalLineRight - m5}" y="${bottomY + 18}" fill="#eab308" font-size="10.5" font-weight="800" text-anchor="middle">5m</text>
        `;

        // 6m Lines (Green solid) - Labeled top and bottom
        svg += `
          <line x1="${goalLineLeft + m6}" y1="${topY}" x2="${goalLineLeft + m6}" y2="${bottomY}" stroke="#10b981" stroke-width="2" />
          <text x="${goalLineLeft + m6}" y="${topY - 10}" fill="#10b981" font-size="10.5" font-weight="800" text-anchor="middle">6m</text>
          <text x="${goalLineLeft + m6}" y="${bottomY + 18}" fill="#10b981" font-size="10.5" font-weight="800" text-anchor="middle">6m</text>
          <line x1="${goalLineRight - m6}" y1="${topY}" x2="${goalLineRight - m6}" y2="${bottomY}" stroke="#10b981" stroke-width="2" />
          <text x="${goalLineRight - m6}" y="${topY - 10}" fill="#10b981" font-size="10.5" font-weight="800" text-anchor="middle">6m</text>
          <text x="${goalLineRight - m6}" y="${bottomY + 18}" fill="#10b981" font-size="10.5" font-weight="800" text-anchor="middle">6m</text>
        `;
      }

      // Goal Lines (White)
      svg += `
        <line x1="${goalLineLeft}" y1="${topY}" x2="${goalLineLeft}" y2="${bottomY}" stroke="#ffffff" stroke-width="3" />
        <line x1="${goalLineRight}" y1="${topY}" x2="${goalLineRight}" y2="${bottomY}" stroke="#ffffff" stroke-width="3" />
      `;

      // 2m Offside Boxes (World Aquatics Goal Area) for Both Goals
      // According to official World Aquatics rules: Goal Area extends 2.00m outside each goal post and 2.00m into the pool
      const goalY = topY + (poolH - cfg.goalHeight) / 2;
      const ext2m = Math.round((2 / 3) * cfg.goalHeight); // Exact 2.00m extension based on 3.00m goal
      const boxY = goalY - ext2m;
      const boxH = cfg.goalHeight + (ext2m * 2);
      if (!state.settings || state.settings.show2mBox) {
        svg += `
          <!-- Left Goal 2m Offside Area -->
          <g id="leftOffsideBox">
            <!-- 2m Area Rectangle (2m into pool, extending 2.00m outside each post) -->
            <rect x="${goalLineLeft}" y="${boxY}" width="${m2}" height="${boxH}" fill="rgba(239, 68, 68, 0.16)" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="6,4" />
            <!-- 2.00m Red Goal Line Markers flanking the posts -->
            <line x1="${goalLineLeft}" y1="${boxY}" x2="${goalLineLeft}" y2="${goalY}" stroke="#ef4444" stroke-width="4.5" />
            <line x1="${goalLineLeft}" y1="${goalY + cfg.goalHeight}" x2="${goalLineLeft}" y2="${boxY + boxH}" stroke="#ef4444" stroke-width="4.5" />
            <!-- End ticks at 2.00m boundaries -->
            <line x1="${goalLineLeft - 4}" y1="${boxY}" x2="${goalLineLeft + 4}" y2="${boxY}" stroke="#ef4444" stroke-width="2.5" />
            <line x1="${goalLineLeft - 4}" y1="${boxY + boxH}" x2="${goalLineLeft + 4}" y2="${boxY + boxH}" stroke="#ef4444" stroke-width="2.5" />
          </g>
          <!-- Right Goal 2m Offside Area -->
          <g id="rightOffsideBox">
            <!-- 2m Area Rectangle (2m into pool, extending 2.00m outside each post) -->
            <rect x="${goalLineRight - m2}" y="${boxY}" width="${m2}" height="${boxH}" fill="rgba(239, 68, 68, 0.16)" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="6,4" />
            <!-- 2.00m Red Goal Line Markers flanking the posts -->
            <line x1="${goalLineRight}" y1="${boxY}" x2="${goalLineRight}" y2="${goalY}" stroke="#ef4444" stroke-width="4.5" />
            <line x1="${goalLineRight}" y1="${goalY + cfg.goalHeight}" x2="${goalLineRight}" y2="${boxY + boxH}" stroke="#ef4444" stroke-width="4.5" />
            <!-- End ticks at 2.00m boundaries -->
            <line x1="${goalLineRight - 4}" y1="${boxY}" x2="${goalLineRight + 4}" y2="${boxY}" stroke="#ef4444" stroke-width="2.5" />
            <line x1="${goalLineRight - 4}" y1="${boxY + boxH}" x2="${goalLineRight + 4}" y2="${boxY + boxH}" stroke="#ef4444" stroke-width="2.5" />
          </g>
        `;
      }

      // Left Goal Net & Frame
      svg += `
        <g id="leftGoal">
          <rect x="${goalLineLeft - cfg.goalWidth}" y="${goalY}" width="${cfg.goalWidth}" height="${cfg.goalHeight}" fill="rgba(255,255,255,0.12)" stroke="#ffffff" stroke-width="3" />
          <!-- Net mesh -->
          <line x1="${goalLineLeft - cfg.goalWidth * 0.5}" y1="${goalY}" x2="${goalLineLeft - cfg.goalWidth * 0.5}" y2="${goalY + cfg.goalHeight}" stroke="rgba(255,255,255,0.3)" stroke-width="1" />
          <line x1="${goalLineLeft - cfg.goalWidth}" y1="${goalY + cfg.goalHeight * 0.33}" x2="${goalLineLeft}" y2="${goalY + cfg.goalHeight * 0.33}" stroke="rgba(255,255,255,0.3)" stroke-width="1" />
          <line x1="${goalLineLeft - cfg.goalWidth}" y1="${goalY + cfg.goalHeight * 0.66}" x2="${goalLineLeft}" y2="${goalY + cfg.goalHeight * 0.66}" stroke="rgba(255,255,255,0.3)" stroke-width="1" />
        </g>
      `;

      // Right Goal Net & Frame
      svg += `
        <g id="rightGoal">
          <rect x="${goalLineRight}" y="${goalY}" width="${cfg.goalWidth}" height="${cfg.goalHeight}" fill="rgba(255,255,255,0.12)" stroke="#ffffff" stroke-width="3" />
          <line x1="${goalLineRight + cfg.goalWidth * 0.5}" y1="${goalY}" x2="${goalLineRight + cfg.goalWidth * 0.5}" y2="${goalY + cfg.goalHeight}" stroke="rgba(255,255,255,0.3)" stroke-width="1" />
          <line x1="${goalLineRight}" y1="${goalY + cfg.goalHeight * 0.33}" x2="${goalLineRight + cfg.goalWidth}" y2="${goalY + cfg.goalHeight * 0.33}" stroke="rgba(255,255,255,0.3)" stroke-width="1" />
          <line x1="${goalLineRight}" y1="${goalY + cfg.goalHeight * 0.66}" x2="${goalLineRight + cfg.goalWidth}" y2="${goalY + cfg.goalHeight * 0.66}" stroke="rgba(255,255,255,0.3)" stroke-width="1" />
        </g>
      `;

      // Exclusion Boxes (Re-entry areas: Red boxes behind goal lines at bottom corners, outside playing area)
      const expW = 28;
      const expH = 28;
      const leftExpX = goalLineLeft - expW;
      const rightExpX = goalLineRight;
      const expY = bottomY - expH;
      svg += `
        <rect x="${leftExpX}" y="${expY}" width="${expW}" height="${expH}" fill="rgba(239, 68, 68, 0.28)" stroke="#ef4444" stroke-width="2.5" />
        <text x="${leftExpX + expW / 2}" y="${expY + expH * 0.65}" fill="#ef4444" font-size="9" font-weight="700" text-anchor="middle">${t('box_exp')}</text>
        <rect x="${rightExpX}" y="${expY}" width="${expW}" height="${expH}" fill="rgba(239, 68, 68, 0.28)" stroke="#ef4444" stroke-width="2.5" />
        <text x="${rightExpX + expW / 2}" y="${expY + expH * 0.65}" fill="#ef4444" font-size="9" font-weight="700" text-anchor="middle">${t('box_exp')}</text>
      `;



      // Buoys / Lane Cones along top & bottom edges (Visual representation of official water polo cones)
      svg += renderConesFull(topY, goalLineLeft, m2, m5, m6, centerX, goalLineRight);
      svg += renderConesFull(bottomY, goalLineLeft, m2, m5, m6, centerX, goalLineRight);

    } else {
      // ================= HALF COURT (Widescreen Horizontal View with Goal at Top) =================
      // Goal at Top Center, Center / Half-Court line at the Bottom (FTC-Telekom / World Aquatics style)
      const poolW = 900;
      const leftX = (cfg.width - poolW) / 2; // 50
      const rightX = leftX + poolW; // 950
      const topY = 60; // Goal line at top
      const bottomY = cfg.height - 40; // Center line at bottom (640)
      const courtH = bottomY - topY; // 580 (depth of half court)

      // Meter ratios based on official ~14.0m half-court depth
      const m2 = (2 / 14) * courtH;
      const m5 = (5 / 14) * courtH;
      const m6 = (6 / 14) * courtH;
      const y2m = topY + m2;
      const y5m = topY + m5;
      const y6m = topY + m6;

      // 2m Zone Tint
      svg += `<rect x="${leftX}" y="${topY}" width="${poolW}" height="${m2}" fill="rgba(239, 68, 68, 0.08)" />`;

      // 5m-6m Zone Tint (if enabled)
      if (!state.settings || state.settings.show5m6m) {
        svg += `
          <rect x="${leftX}" y="${y2m}" width="${poolW}" height="${m5 - m2}" fill="rgba(234, 179, 8, 0.07)" />
          <rect x="${leftX}" y="${y5m}" width="${poolW}" height="${m6 - m5}" fill="rgba(16, 185, 129, 0.07)" />
        `;
      }

      // Pool Boundary Box (Outer border of half court)
      svg += `<rect x="${leftX}" y="${topY}" width="${poolW}" height="${courtH}" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="3" rx="4" />`;

      // Half Court / Center Line (Bottom Edge, White)
      const centerX = (leftX + rightX) / 2;
      svg += `
        <line x1="${leftX}" y1="${bottomY}" x2="${rightX}" y2="${bottomY}" stroke="#ffffff" stroke-width="3.5" />
        <!-- Center circle arc facing upwards into the pool -->
        <path d="M ${centerX - 50} ${bottomY} A 50 50 0 0 1 ${centerX + 50} ${bottomY}" fill="none" stroke="#ffffff" stroke-width="2.5" />
        <circle cx="${centerX}" cy="${bottomY}" r="3.5" fill="#ffffff" />
      `;

      // 2m Line (Red dashed) - Labeled on left and right sidelines
      svg += `
        <line x1="${leftX}" y1="${y2m}" x2="${rightX}" y2="${y2m}" stroke="#ef4444" stroke-width="2.2" stroke-dasharray="8,5" />
        <text x="${leftX - 8}" y="${y2m + 4}" fill="#ef4444" font-size="11" font-weight="800" text-anchor="end">2m</text>
        <text x="${rightX + 8}" y="${y2m + 4}" fill="#ef4444" font-size="11" font-weight="800" text-anchor="start">2m</text>
      `;

      // 5m and 6m Lines (if enabled)
      if (!state.settings || state.settings.show5m6m) {
        svg += `
          <!-- 5m Line (Yellow dashed) - Labeled left and right -->
          <line x1="${leftX}" y1="${y5m}" x2="${rightX}" y2="${y5m}" stroke="#eab308" stroke-width="2" stroke-dasharray="5,5" />
          <text x="${leftX - 8}" y="${y5m + 4}" fill="#eab308" font-size="11" font-weight="800" text-anchor="end">5m</text>
          <text x="${rightX + 8}" y="${y5m + 4}" fill="#eab308" font-size="11" font-weight="800" text-anchor="start">5m</text>

          <!-- 6m Line (Green dashed as in photo) - Labeled left and right -->
          <line x1="${leftX}" y1="${y6m}" x2="${rightX}" y2="${y6m}" stroke="#10b981" stroke-width="2.5" stroke-dasharray="8,5" />
          <text x="${leftX - 8}" y="${y6m + 4}" fill="#10b981" font-size="11" font-weight="800" text-anchor="end">6m</text>
          <text x="${rightX + 8}" y="${y6m + 4}" fill="#10b981" font-size="11" font-weight="800" text-anchor="start">6m</text>
        `;
      }

      // Goal Line (Top, White)
      svg += `
        <line x1="${leftX}" y1="${topY}" x2="${rightX}" y2="${topY}" stroke="#ffffff" stroke-width="3.5" />
      `;

      // Goal Frame at Top Center (Width 140, Height 35)
      const goalW = cfg.goalWidth || 140;
      const goalH = cfg.goalHeight || 35;
      const goalX = centerX - goalW / 2;
      const goalY = topY - goalH;

      // 2m Offside Box (World Aquatics Goal Area)
      // Extends 2.00m outside each post and 2.00m into pool
      const ext2m = Math.round((2 / 3) * goalW); // 2.00m lateral extension based on 3.00m goal
      const boxX = goalX - ext2m;
      const boxW = goalW + (ext2m * 2);
      if (!state.settings || state.settings.show2mBox) {
        svg += `
          <!-- 2m Offside Area (Goal Area) -->
          <g id="halfOffsideBox">
            <rect x="${boxX}" y="${topY}" width="${boxW}" height="${m2}" fill="rgba(239, 68, 68, 0.16)" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="6,4" />
            <!-- Red Goal Line Markers flanking posts -->
            <line x1="${boxX}" y1="${topY}" x2="${goalX}" y2="${topY}" stroke="#ef4444" stroke-width="5" />
            <line x1="${goalX + goalW}" y1="${topY}" x2="${boxX + boxW}" y2="${topY}" stroke="#ef4444" stroke-width="5" />
            <!-- End ticks at 2.00m boundaries -->
            <line x1="${boxX}" y1="${topY - 5}" x2="${boxX}" y2="${topY + 5}" stroke="#ef4444" stroke-width="2.5" />
            <line x1="${boxX + boxW}" y1="${topY - 5}" x2="${boxX + boxW}" y2="${topY + 5}" stroke="#ef4444" stroke-width="2.5" />
          </g>
        `;
      }

      // Goal Net & Frame (Top Center)
      svg += `
        <g id="mainGoalTop">
          <rect x="${goalX}" y="${goalY}" width="${goalW}" height="${goalH}" fill="rgba(255,255,255,0.15)" stroke="#ffffff" stroke-width="3.5" />
          <!-- Net mesh grid -->
          <line x1="${goalX}" y1="${goalY + goalH * 0.5}" x2="${goalX + goalW}" y2="${goalY + goalH * 0.5}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" />
          <line x1="${goalX + goalW * 0.2}" y1="${goalY}" x2="${goalX + goalW * 0.2}" y2="${topY}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" />
          <line x1="${goalX + goalW * 0.4}" y1="${goalY}" x2="${goalX + goalW * 0.4}" y2="${topY}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" />
          <line x1="${goalX + goalW * 0.6}" y1="${goalY}" x2="${goalX + goalW * 0.6}" y2="${topY}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" />
          <line x1="${goalX + goalW * 0.8}" y1="${goalY}" x2="${goalX + goalW * 0.8}" y2="${topY}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5" />
        </g>
      `;

      // Exclusion Box (Above goal line, outside the field of play at Top-Left)
      const expBoxW = 36;
      const expBoxH = 30;
      const expBoxX = leftX;
      const expBoxY = topY - expBoxH;
      svg += `
        <rect x="${expBoxX}" y="${expBoxY}" width="${expBoxW}" height="${expBoxH}" fill="rgba(239, 68, 68, 0.28)" stroke="#ef4444" stroke-width="2.5" />
        <text x="${expBoxX + expBoxW / 2}" y="${expBoxY + expBoxH * 0.65}" fill="#ef4444" font-size="9.5" font-weight="700" text-anchor="middle">${t('box_exp')}</text>
      `;



      // Lateral Lane Cones (Official color buoys along left & right sidelines)
      svg += renderConesHalfVertical(leftX, topY, y2m, y5m, y6m, bottomY);
      svg += renderConesHalfVertical(rightX, topY, y2m, y5m, y6m, bottomY);
    }

    el.svgPitchContent.innerHTML = svg;
    resizeCanvas();
  }

  // Float cones along the pool lane lines (Official colored buoys)
  function renderConesFull(y, gl, m2, m5, m6, cx, gr) {
    let out = '';
    const addCone = (x, color) => {
      out += `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#000000" stroke-width="0.8" />`;
    };
    addCone(gl, '#ffffff');
    addCone(gl + m2, '#ef4444');
    addCone(gl + m5, '#eab308');
    addCone(gl + m6, '#10b981');
    addCone(cx, '#ffffff');
    addCone(gr - m6, '#10b981');
    addCone(gr - m5, '#eab308');
    addCone(gr - m2, '#ef4444');
    addCone(gr, '#ffffff');
    return out;
  }

  function renderConesHalfVertical(x, topY, y2m, y5m, y6m, bottomY) {
    let out = '';
    const addCone = (y, color) => {
      out += `<circle cx="${x}" cy="${y}" r="4.5" fill="${color}" stroke="#000000" stroke-width="0.8" />`;
    };
    addCone(topY, '#ffffff');
    addCone(y2m, '#ef4444');
    addCone(y5m, '#eab308');
    addCone(y6m, '#10b981');
    addCone(bottomY, '#ffffff');
    return out;
  }

  // --- Cap Colors Configuration & SVG Generation ---
  const CAP_COLORS = {
    white: {
      id: 'white',
      nameKey: 'color_white',
      capColor: '#f8fafc',
      textColor: '#0f172a',
      earGuardColor: '#ffffff',
      borderStroke: '#cbd5e1',
      badgeBg: '#ffffff',
      badgeText: '#0f172a',
      badgeBorder: '#94a3b8',
      emoji: '⚪'
    },
    blue: {
      id: 'blue',
      nameKey: 'color_blue',
      capColor: '#1d4ed8',
      textColor: '#ffffff',
      earGuardColor: '#1d4ed8',
      borderStroke: '#172554',
      badgeBg: '#1d4ed8',
      badgeText: '#ffffff',
      badgeBorder: '#ffffff',
      emoji: '🔵'
    },
    green: {
      id: 'green',
      nameKey: 'color_green',
      capColor: '#16a34a',
      textColor: '#ffffff',
      earGuardColor: '#16a34a',
      borderStroke: '#14532d',
      badgeBg: '#16a34a',
      badgeText: '#ffffff',
      badgeBorder: '#ffffff',
      emoji: '🟢'
    },
    red: {
      id: 'red',
      nameKey: 'color_red',
      capColor: '#dc2626',
      textColor: '#ffffff',
      earGuardColor: '#ffffff', // For red team, white ear guards make the red GK stand out
      borderStroke: '#7f1d1d',
      badgeBg: '#991b1b',
      badgeText: '#ffffff',
      badgeBorder: '#ffffff',
      emoji: '🔴'
    },
    yellow: {
      id: 'yellow',
      nameKey: 'color_yellow',
      capColor: '#eab308',
      textColor: '#0f172a',
      earGuardColor: '#eab308',
      borderStroke: '#854d0e',
      badgeBg: '#eab308',
      badgeText: '#0f172a',
      badgeBorder: '#854d0e',
      emoji: '🟡'
    },
    black: {
      id: 'black',
      nameKey: 'color_black',
      capColor: '#18181b',
      textColor: '#ffffff', // White numbers as explicitly requested
      earGuardColor: '#18181b',
      borderStroke: '#09090b',
      badgeBg: '#18181b',
      badgeText: '#ffffff',
      badgeBorder: '#52525b',
      emoji: '⚫'
    }
  };

  function resolveTeamColor(team) {
    if (team === 'attack' || team === 'blue') {
      return (state.teams && state.teams.attack && state.teams.attack.color) || 'blue';
    }
    if (team === 'defense' || team === 'white') {
      return (state.teams && state.teams.defense && state.teams.defense.color) || 'white';
    }
    if (CAP_COLORS[team]) return team;
    return 'white';
  }

  function isAttackPlayer(token) {
    return !!(token && token.type === 'cap' && (token.team === 'blue' || token.team === 'attack'));
  }

  function isDefensePlayer(token) {
    return !!(token && token.type === 'cap' && (token.team === 'white' || token.team === 'defense'));
  }

  function getCapSvg(team, number, isGK = false) {
    const isGoalie = !!(isGK || number === 1);
    const colorKey = resolveTeamColor(team);
    const c = CAP_COLORS[colorKey] || CAP_COLORS.white;

    let capColor = c.capColor;
    let textColor = c.textColor;
    let earGuardColor = c.earGuardColor;
    let borderStroke = c.borderStroke;
    let chinStrapColor = earGuardColor;
    let gkBadge = '';

    if (isGoalie) {
      capColor = '#dc2626'; // Official World Aquatics Red dome
      textColor = '#ffffff';
      earGuardColor = c.id === 'red' ? '#ffffff' : c.earGuardColor;
      chinStrapColor = earGuardColor;
      borderStroke = c.id === 'white' ? '#cbd5e1' : '#172554';
      gkBadge = `
        <!-- GK Team Identification Badge -->
        <g transform="translate(50, 21)">
          <rect x="-14" y="-7" width="28" height="14" rx="4" fill="${c.badgeBg}" stroke="${c.badgeBorder}" stroke-width="1.2" />
          <text x="0" y="3.5" fill="${c.badgeText}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="9" text-anchor="middle">GK</text>
        </g>
      `;
    }

    return `
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" filter="url(#capShadow)">
        <defs>
          <radialGradient id="capGrad_${colorKey}_${team}_${number}" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.25" />
          </radialGradient>
        </defs>

        <!-- Ear Guards in Team Official Color -->
        <circle cx="15" cy="52" r="13" fill="${earGuardColor}" stroke="${borderStroke}" stroke-width="${isGoalie ? '3' : '2.5'}" />
        <circle cx="15" cy="52" r="7" fill="rgba(0,0,0,0.18)" />
        <circle cx="85" cy="52" r="13" fill="${earGuardColor}" stroke="${borderStroke}" stroke-width="${isGoalie ? '3' : '2.5'}" />
        <circle cx="85" cy="52" r="7" fill="rgba(0,0,0,0.18)" />

        <!-- Chin Strap -->
        <path d="M 24 64 Q 50 88 76 64" fill="none" stroke="${chinStrapColor}" stroke-width="3.5" stroke-linecap="round" />

        <!-- Cap Dome -->
        <ellipse cx="50" cy="48" rx="36" ry="34" fill="${capColor}" stroke="${borderStroke}" stroke-width="2.5" />
        <ellipse cx="50" cy="48" rx="36" ry="34" fill="url(#capGrad_${colorKey}_${team}_${number})" />

        <!-- Cap Number -->
        <text x="50" y="${isGoalie ? 59 : 56}" fill="${textColor}" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="${isGoalie ? 26 : 28}" text-anchor="middle" dominant-baseline="middle">
          ${number}
        </text>

        ${gkBadge}
      </svg>
    `;
  }

  const BALL_COLORS = {
    yellow: {
      key: 'ball_yellow',
      name: 'Κίτρινη',
      stop0: '#fff566',
      stop60: '#eab308',
      stop100: '#ca8a04',
      stroke: '#854d0e',
      seamColor: '#1d4ed8', // Mikasa classic royal blue seams
      centerPin: '#0f172a'
    },
    orange: {
      key: 'ball_orange',
      name: 'Πορτοκαλί',
      stop0: '#fed7aa',
      stop60: '#f97316',
      stop100: '#c2410c',
      stroke: '#7c2d12',
      seamColor: '#0f172a', // Dark black/navy seams
      centerPin: '#0f172a'
    },
    green: {
      key: 'ball_green',
      name: 'Πράσινη',
      stop0: '#dcfce7',
      stop60: '#22c55e',
      stop100: '#15803d',
      stroke: '#14532d',
      seamColor: '#1e3a8a', // Deep navy seams
      centerPin: '#0f172a'
    },
    blue: {
      key: 'ball_blue',
      name: 'Μπλε',
      stop0: '#e0f2fe',
      stop60: '#0ea5e9',
      stop100: '#0284c7',
      stroke: '#0369a1',
      seamColor: '#ffffff', // Crisp white seams
      centerPin: '#ffffff'
    },
    pink: {
      key: 'ball_pink',
      name: 'Ροζ',
      stop0: '#fce7f3',
      stop60: '#ec4899',
      stop100: '#be185d',
      stroke: '#831843',
      seamColor: '#312e81', // Dark indigo seams
      centerPin: '#312e81'
    }
  };

  function getBallSvg(color = 'yellow') {
    const c = BALL_COLORS[color] || BALL_COLORS.yellow;
    const gradId = `ballShine_${color}`;
    return `
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" filter="url(#ballShadow)">
        <defs>
          <radialGradient id="${gradId}" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stop-color="${c.stop0}" />
            <stop offset="60%" stop-color="${c.stop60}" />
            <stop offset="100%" stop-color="${c.stop100}" />
          </radialGradient>
        </defs>
        
        <!-- Ball Base Sphere -->
        <circle cx="50" cy="50" r="44" fill="url(#${gradId})" stroke="${c.stroke}" stroke-width="2.5" />
        
        <!-- Official Water Polo Wave Seams -->
        <path d="M 20 22 C 38 35, 62 35, 80 22" fill="none" stroke="${c.seamColor}" stroke-width="5.5" stroke-linecap="round" />
        <path d="M 20 78 C 38 65, 62 65, 80 78" fill="none" stroke="${c.seamColor}" stroke-width="5.5" stroke-linecap="round" />
        <path d="M 50 6 C 50 35, 50 65, 50 94" fill="none" stroke="${c.centerPin}" stroke-width="2.5" stroke-linecap="round" />
        <circle cx="50" cy="50" r="4" fill="${c.centerPin}" />
      </svg>
    `;
  }

  // --- Dynamic Team Roles & Colors UI Management ---
  function updateTeamColorsUI() {
    const attackColor = resolveTeamColor('attack');
    const defenseColor = resolveTeamColor('defense');
    const cAttack = CAP_COLORS[attackColor] || CAP_COLORS.blue;
    const cDefense = CAP_COLORS[defenseColor] || CAP_COLORS.white;

    // 1. Top bar Quick Pill
    if (el.topBarTeamsPill) {
      el.topBarTeamsPill.innerHTML = `⚔️ ${cAttack.emoji} <span style="opacity:0.65;font-size:0.75rem;margin:0 2px;">vs</span> 🛡️ ${cDefense.emoji}`;
    }
    if (el.quickTeamsBtn) {
      el.quickTeamsBtn.title = `${t('team_attack')}: ${t(cAttack.nameKey)} | ${t('team_defense')}: ${t(cDefense.nameKey)}`;
    }

    // 2. Mini previews in Settings modal
    if (el.attackCapPreview) {
      el.attackCapPreview.innerHTML = getCapSvg('blue', 4);
    }
    if (el.defenseCapPreview) {
      el.defenseCapPreview.innerHTML = getCapSvg('white', 3);
    }

    // 3. Active Swatches in Settings modal
    if (el.attackColorSwatches) {
      el.attackColorSwatches.querySelectorAll('.team-color-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.color === attackColor);
      });
    }
    if (el.defenseColorSwatches) {
      el.defenseColorSwatches.querySelectorAll('.team-color-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.color === defenseColor);
      });
    }

    // 4. Sidebar Roster Tabs
    if (el.tabTeamBlue) {
      el.tabTeamBlue.innerHTML = `⚔️ ${cAttack.emoji} ${t(cAttack.nameKey)}`;
    }
    if (el.tabTeamWhite) {
      el.tabTeamWhite.innerHTML = `🛡️ ${cDefense.emoji} ${t(cDefense.nameKey)}`;
    }

    // 5. Re-render pool tokens & bench tray
    renderTokens();
    renderTray();

    // 6. If in Angle mode, refresh HUD
    if (state.mode === 'angle') {
      renderShootingAnalysis();
    }

    // 7. If tutorial modal is open, re-render current step to match team colors
    if (el.tutorialModal && !el.tutorialModal.classList.contains('hidden') && typeof window.renderTutorialStep === 'function') {
      window.renderTutorialStep(window.currentTutorialStep || 0);
    }
  }

  // --- Initial Setup of Tokens (Players + Ball) ---
  function initDefaultTokens() {
    state.tokens = [];
    if (el && el.tokensLayer) {
      el.tokensLayer.innerHTML = '';
    }

    const isFull = state.view === 'full';

    // Primary Ball (Yellow) attached initially to attacker #4 (Point / Center)
    state.tokens.push({
      id: 'ball',
      type: 'ball',
      color: 'yellow',
      attachedTo: 'blue_4',
      x: isFull ? 56.5 : 53.2,
      y: isFull ? 50 : 53.2,
      inPool: true,
    });

    if (isFull) {
      // ================= FULL COURT INITIAL SETUP: ΣΕΝΤΡΑ ΜΕΤΑ ΑΠΟ ΓΚΟΛ =================
      // Official water polo restart formation across the halfway line:
      // White Team: Defends Left Goal (#1 in goal, #7 support, #2-6 aligned at center)
      state.tokens.push({
        id: 'white_1',
        type: 'cap',
        team: 'white',
        number: 1,
        isGK: true,
        x: 10,
        y: 50,
        inPool: true,
      });

      const whiteStartingFull = [
        { num: 2, x: 42, y: 18 },  // Wing
        { num: 3, x: 42, y: 34 },  // Flat
        { num: 4, x: 46, y: 50 },  // Center
        { num: 5, x: 42, y: 66 },  // Flat
        { num: 6, x: 42, y: 82 },  // Wing
        { num: 7, x: 32, y: 50 },  // Deep Support
      ];

      whiteStartingFull.forEach(p => {
        state.tokens.push({
          id: `white_${p.num}`,
          type: 'cap',
          team: 'white',
          number: p.num,
          isGK: false,
          x: p.x,
          y: p.y,
          inPool: true,
        });
      });

      // White Reserves (8-13)
      for (let i = 8; i <= 13; i++) {
        state.tokens.push({
          id: `white_${i}`,
          type: 'cap',
          team: 'white',
          number: i,
          isGK: i === 13,
          x: 0,
          y: 0,
          inPool: false,
        });
      }

      // Blue Team: Defends Right Goal (#1 in goal, #7 support, #4 takes center restart with ball)
      state.tokens.push({
        id: 'blue_1',
        type: 'cap',
        team: 'blue',
        number: 1,
        isGK: true,
        x: 90,
        y: 50,
        inPool: true,
      });

      const blueStartingFull = [
        { num: 2, x: 58, y: 18 },  // Wing
        { num: 3, x: 58, y: 34 },  // Flat
        { num: 4, x: 54, y: 50 },  // Center (Restart with ball)
        { num: 5, x: 58, y: 66 },  // Flat
        { num: 6, x: 58, y: 82 },  // Wing
        { num: 7, x: 68, y: 50 },  // Deep Support
      ];

      blueStartingFull.forEach(p => {
        state.tokens.push({
          id: `blue_${p.num}`,
          type: 'cap',
          team: 'blue',
          number: p.num,
          isGK: false,
          x: p.x,
          y: p.y,
          inPool: true,
        });
      });

      // Blue Reserves (8-13)
      for (let i = 8; i <= 13; i++) {
        state.tokens.push({
          id: `blue_${i}`,
          type: 'cap',
          team: 'blue',
          number: i,
          isGK: i === 13,
          x: 0,
          y: 0,
          inPool: false,
        });
      }

    } else {
      // ================= HALF COURT INITIAL SETUP =================
      // White Team (1 to 13) - Defending team with White 1 GK in top goal
      const whiteStarting = [
        { num: 1, x: 50, y: 9, isGK: true },  // GK in top goal
        { num: 7, x: 50, y: 19 },             // Hole Guard marking Blue 6
        { num: 2, x: 20, y: 22 },             // Marking Blue 2
        { num: 6, x: 80, y: 22 },             // Marking Blue 4
        { num: 3, x: 32, y: 40 },             // Marking Blue 3
        { num: 5, x: 68, y: 40 },             // Marking Blue 5
        { num: 4, x: 50, y: 48 },             // Marking Blue 7
      ];

      whiteStarting.forEach(p => {
        state.tokens.push({
          id: `white_${p.num}`,
          type: 'cap',
          team: 'white',
          number: p.num,
          isGK: !!p.isGK,
          x: p.x,
          y: p.y,
          inPool: true,
        });
      });

      // White Reserves (8-13)
      for (let i = 8; i <= 13; i++) {
        state.tokens.push({
          id: `white_${i}`,
          type: 'cap',
          team: 'white',
          number: i,
          isGK: i === 13,
          x: 0,
          y: 0,
          inPool: false,
        });
      }

      // Blue Team (1 to 13) - Attacking team towards top goal
      state.tokens.push({
        id: 'blue_1',
        type: 'cap',
        team: 'blue',
        number: 1,
        isGK: true,
        x: 0,
        y: 0,
        inPool: false,
      });

      const blueStarting = [
        { num: 2, x: 16, y: 23 }, // Wing Left at 2m line
        { num: 6, x: 50, y: 23 }, // Hole set (Φουνταριστός) at 2m line
        { num: 4, x: 84, y: 23 }, // Wing Right at 2m line
        { num: 3, x: 30, y: 46 }, // Flat Left (~5-6m)
        { num: 5, x: 70, y: 46 }, // Flat Right (~5-6m)
        { num: 7, x: 50, y: 55 }, // Point / Center perimeter with ball
      ];

      blueStarting.forEach(p => {
        state.tokens.push({
          id: `blue_${p.num}`,
          type: 'cap',
          team: 'blue',
          number: p.num,
          isGK: !!p.isGK,
          x: p.x,
          y: p.y,
          inPool: true,
        });
      });

      // Blue Reserves (8-13)
      for (let i = 8; i <= 13; i++) {
        state.tokens.push({
          id: `blue_${i}`,
          type: 'cap',
          team: 'blue',
          number: i,
          isGK: i === 13,
          x: 0,
          y: 0,
          inPool: false,
        });
      }
    }

    // Initialize initial Frame
    state.frames = [
      {
        id: 'frame_1',
        name: `${t('frame_label')} 1`,
        tokenPositions: captureCurrentTokenPositions(),
        drawings: [],
        view: state.view
      }
    ];
    state.currentFrameIndex = 0;
  }

  function captureCurrentTokenPositions() {
    const pos = {};
    state.tokens.forEach(t => {
      pos[t.id] = {
        x: t.x,
        y: t.y,
        inPool: t.inPool,
        color: t.color,
        type: t.type,
        attachedTo: t.attachedTo !== undefined ? t.attachedTo : null
      };
    });
    return pos;
  }

  // --- Bench & Removal Helpers ---
  function benchCap(token) {
    const liveToken = (token && token.id) ? (state.tokens.find(t => t.id === token.id) || token) : token;
    if (!liveToken || liveToken.type !== 'cap') return;
    liveToken.inPool = false;
    if (state.selectedCapId === liveToken.id) state.selectedCapId = null;

    // Detach ball if this player was holding it
    const attachedBall = state.tokens.find(t => t.type === 'ball' && t.attachedTo === liveToken.id);
    if (attachedBall) {
      attachedBall.attachedTo = null;
      const ballDiv = document.getElementById(`token_${attachedBall.id}`);
      if (ballDiv) ballDiv.classList.remove('is-attached');
    }

    const tokenEl = document.getElementById(`token_${liveToken.id}`);
    if (tokenEl) tokenEl.classList.remove('is-drag-out', 'selected');
    renderTokens();
    renderTray();
    updateCurrentFramePositions();
    if (state.mode === 'angle') renderShootingAnalysis();
    showToast(t('toast_cap_benched', { num: liveToken.number }));
  }

  function benchAllTeamCaps(team) {
    let count = 0;
    state.tokens.forEach(t => {
      if (t.type === 'cap' && t.team === team && t.inPool) {
        t.inPool = false;
        count++;
      }
      if (t.type === 'ball' && t.attachedTo && t.attachedTo.startsWith(team)) {
        t.attachedTo = null;
        const ballDiv = document.getElementById(`token_${t.id}`);
        if (ballDiv) ballDiv.classList.remove('is-attached');
      }
    });
    state.selectedCapId = null;
    renderTokens();
    renderTray();
    updateCurrentFramePositions();
    if (state.mode === 'angle') renderShootingAnalysis();
    showToast(t('toast_team_benched'));
  }

  function deleteCapCompletely(tokenId) {
    const token = state.tokens.find(t => t.id === tokenId);
    if (!token) return;
    const num = token.number;
    const tokenEl = document.getElementById(`token_${tokenId}`);
    if (tokenEl) tokenEl.remove();

    // Detach ball if this player was holding it
    const attachedBall = state.tokens.find(t => t.type === 'ball' && t.attachedTo === tokenId);
    if (attachedBall) {
      attachedBall.attachedTo = null;
      const ballDiv = document.getElementById(`token_${attachedBall.id}`);
      if (ballDiv) ballDiv.classList.remove('is-attached');
    }

    state.tokens = state.tokens.filter(t => t.id !== tokenId);
    state.frames.forEach(f => {
      if (f.tokenPositions && f.tokenPositions[tokenId]) {
        delete f.tokenPositions[tokenId];
      }
    });
    if (state.selectedCapId === tokenId) state.selectedCapId = null;
    renderTokens();
    renderTray();
    updateCurrentFramePositions();
    if (state.mode === 'angle') renderShootingAnalysis();
    showToast(t('toast_cap_deleted', { num }));
  }

  // --- Render Tokens onto the Pool Board (with smooth CSS transitions for animations) ---
  function renderTokens(isAnimating = false) {
    state.tokens.forEach(token => {
      let tokenDiv = document.getElementById(`token_${token.id}`);

      if (!token.inPool) {
        if (tokenDiv) tokenDiv.style.display = 'none';
        return;
      }

      if (!tokenDiv) {
        tokenDiv = document.createElement('div');
        tokenDiv.id = `token_${token.id}`;
        tokenDiv.className = `token ${token.type === 'ball' ? 'ball-token' : 'cap-token'}`;
        if (token.type === 'ball') {
          tokenDiv.innerHTML = getBallSvg(token.color || 'yellow');
          tokenDiv.dataset.color = token.color || 'yellow';
        } else {
          tokenDiv.innerHTML = getCapSvg(token.team, token.number, token.isGK);
          tokenDiv.dataset.teamColor = resolveTeamColor(token.team);
        }

        // Attach Drag & Drop Events
        tokenDiv.addEventListener('mousedown', (e) => onTokenPointerDown(e, token));
        tokenDiv.addEventListener('touchstart', (e) => onTokenPointerDown(e, token), { passive: false });

        // Right click to send to bench / remove
        tokenDiv.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (token.type === 'cap') {
            benchCap(token);
          } else if (token.type === 'ball') {
            const activeBalls = state.tokens.filter(tok => tok.type === 'ball' && tok.inPool);
            if (activeBalls.length > 1 || token.id !== 'ball') {
              token.inPool = false;
              renderTokens();
              updateBallsPaletteUI();
              updateCurrentFramePositions();
              const cKey = BALL_COLORS[token.color || 'yellow']?.key || 'ball_yellow';
              showToast(t('toast_ball_removed', { color: t(cKey) }));
            }
          }
        });

        el.tokensLayer.appendChild(tokenDiv);
      } else if (token.type === 'ball') {
        const curColor = token.color || 'yellow';
        if (tokenDiv.dataset.color !== curColor) {
          tokenDiv.innerHTML = getBallSvg(curColor);
          tokenDiv.dataset.color = curColor;
        }
      } else if (token.type === 'cap') {
        const curTeamColor = resolveTeamColor(token.team);
        if (tokenDiv.dataset.teamColor !== curTeamColor) {
          tokenDiv.innerHTML = getCapSvg(token.team, token.number, token.isGK);
          tokenDiv.dataset.teamColor = curTeamColor;
        }
      }

      if (token.type === 'ball') {
        tokenDiv.classList.toggle('is-attached', !!token.attachedTo);
      }

      tokenDiv.style.display = 'flex';

      // Selection state and floating remove badge on selected cap
      let removeBtn = tokenDiv.querySelector('.token-remove-btn');
      if (state.selectedCapId === token.id && token.type === 'cap') {
        tokenDiv.classList.add('selected');
        if (!removeBtn) {
          removeBtn = document.createElement('button');
          removeBtn.className = 'token-remove-btn';
          removeBtn.innerHTML = '&times;';
          removeBtn.title = t('tooltip_bench_cap');
          const onRemove = (e) => {
            e.preventDefault();
            e.stopPropagation();
            benchCap(token);
          };
          removeBtn.addEventListener('click', onRemove);
          removeBtn.addEventListener('touchend', onRemove);
          tokenDiv.appendChild(removeBtn);
        }
      } else {
        tokenDiv.classList.remove('selected');
        if (removeBtn) removeBtn.remove();
      }

      if (isAnimating) {
        tokenDiv.classList.add('is-animating');
      } else {
        tokenDiv.classList.remove('is-animating');
      }

      if (state.mode === 'angle' && token.type === 'cap') {
        tokenDiv.classList.toggle('is-shooter', token.id === state.shootingShooterId);
        tokenDiv.classList.toggle('is-blocker', (state.activeBlockerIds || []).includes(token.id));
      } else {
        tokenDiv.classList.remove('is-shooter', 'is-blocker');
      }

      tokenDiv.style.left = `${token.x}%`;
      tokenDiv.style.top = `${token.y}%`;
      if (!isAnimating) {
        void tokenDiv.offsetWidth;
      }
    });
  }

  function applyPositionsFromFrame(frame, isAnimating = false) {
    if (!frame || !frame.tokenPositions) return;

    // Restore any extra balls stored in frame that are missing in state.tokens
    Object.keys(frame.tokenPositions).forEach(tokenId => {
      if (tokenId.startsWith('ball') && !state.tokens.some(t => t.id === tokenId)) {
        const p = frame.tokenPositions[tokenId];
        const ballColor = p.color || (tokenId === 'ball' ? 'yellow' : tokenId.replace('ball_', ''));
        state.tokens.push({
          id: tokenId,
          type: 'ball',
          color: ballColor,
          x: p.x,
          y: p.y,
          inPool: p.inPool,
          attachedTo: p.attachedTo || null
        });
      }
    });

    state.tokens.forEach(t => {
      if (frame.tokenPositions[t.id]) {
        t.x = frame.tokenPositions[t.id].x;
        t.y = frame.tokenPositions[t.id].y;
        t.inPool = frame.tokenPositions[t.id].inPool;
        if (frame.tokenPositions[t.id].color) {
          t.color = frame.tokenPositions[t.id].color;
        }
        if (frame.tokenPositions[t.id].attachedTo !== undefined) {
          t.attachedTo = frame.tokenPositions[t.id].attachedTo;
        }
      }
    });
    renderTokens(isAnimating);
    renderTray();
    updateBallsPaletteUI();
    state.drawingPaths = frame.drawings ? JSON.parse(JSON.stringify(frame.drawings)) : [];
    redrawCanvas();
    if (state.mode === 'angle') renderShootingAnalysis();
  }

  // --- Balls Palette Management ---
  function updateBallsPaletteUI() {
    const badge = document.getElementById('ballsCountBadge');
    const activeBalls = state.tokens.filter(t => t.type === 'ball' && t.inPool);
    const count = activeBalls.length;
    if (badge) {
      badge.textContent = count === 1 ? t('balls_in_pool_one') : t('balls_in_pool_many', { count });
    }

    const buttons = document.querySelectorAll('.btn-ball-toggle');
    buttons.forEach(btn => {
      const color = btn.dataset.ballColor;
      const isPresent = state.tokens.some(t => t.type === 'ball' && t.inPool && (t.color === color || (!t.color && color === 'yellow')));
      btn.classList.toggle('active', isPresent);
      const cKey = BALL_COLORS[color]?.key || 'ball_yellow';
      btn.title = t(cKey);
    });
  }

  function toggleBallColor(color) {
    let ball = state.tokens.find(t => t.type === 'ball' && (t.color === color || (!t.color && color === 'yellow')));

    if (ball && ball.inPool) {
      // Trying to remove this ball from pool
      const activeBalls = state.tokens.filter(t => t.type === 'ball' && t.inPool);
      if (activeBalls.length <= 1) {
        showToast(t('toast_at_least_one_ball'));
        return;
      }
      ball.inPool = false;
      renderTokens();
      updateBallsPaletteUI();
      updateCurrentFramePositions();
      const cKey = BALL_COLORS[color]?.key || 'ball_yellow';
      showToast(t('toast_ball_removed', { color: t(cKey) }));
    } else {
      // Adding this ball into pool
      if (!ball) {
        const offsetMultiplier = state.tokens.filter(t => t.type === 'ball').length;
        const isFull = state.view === 'full';
        const baseCenterX = isFull ? 50 : 49;
        const baseCenterY = isFull ? 50 : 50.5;

        ball = {
          id: color === 'yellow' ? 'ball' : `ball_${color}`,
          type: 'ball',
          color: color,
          inPool: true,
          x: Math.max(12, Math.min(88, baseCenterX + (offsetMultiplier % 2 === 1 ? offsetMultiplier * 3.5 : -offsetMultiplier * 3.5))),
          y: Math.max(16, Math.min(84, baseCenterY + (offsetMultiplier % 2 === 1 ? 5 : -5))),
        };
        state.tokens.push(ball);
      } else {
        ball.inPool = true;
        if (ball.x <= 0 || ball.y <= 0) {
          ball.x = state.view === 'full' ? 50 : 49;
          ball.y = 50;
        }
      }
      renderTokens();
      updateBallsPaletteUI();
      updateCurrentFramePositions();
      const cKey = BALL_COLORS[color]?.key || 'ball_yellow';
      showToast(t('toast_ball_added', { color: t(cKey) }));
    }
  }

  // --- Render Bench / Roster Tray ---
  function renderTray() {
    el.capsTray.innerHTML = '';
    const team = state.currentTeamTab;

    const benchCaps = state.tokens.filter(t => t.type === 'cap' && t.team === team && !t.inPool);

    if (benchCaps.length === 0) {
      el.capsTray.innerHTML = `<span style="font-size: 0.72rem; color: #64748b; padding: 4px;">${t('bench_empty')}</span>`;
      return;
    }

    benchCaps.forEach(token => {
      const item = document.createElement('div');
      item.className = 'tray-cap-item' + (state.selectedBenchCapId === token.id ? ' selected' : '');
      const cColor = CAP_COLORS[resolveTeamColor(token.team)] || CAP_COLORS.white;
      const roleName = token.team === 'blue' ? t('group_attack') : t('group_defense');
      item.title = `#${token.number} (${roleName} - ${t(cColor.nameKey)})`;
      item.innerHTML = `<div class="tray-cap-svg">${getCapSvg(token.team, token.number, token.isGK)}</div>`;

      item.addEventListener('click', (e) => {
        // If already selected, second tap directly puts it into pool as quick shortcut
        if (state.selectedBenchCapId === token.id) {
          token.inPool = true;
          token.x = 45 + (Math.random() * 8 - 4);
          token.y = 45 + (Math.random() * 8 - 4);
          state.selectedBenchCapId = null;
          renderTokens();
          renderTray();
          updateCurrentFramePositions();
          if (state.mode === 'angle') renderShootingAnalysis();
          triggerHaptic(20);
          showToast(t('toast_cap_entered', { num: token.number }));
        } else {
          state.selectedBenchCapId = token.id;
          triggerHaptic(15);
          renderTray();
        }
      });

      el.capsTray.appendChild(item);
    });
  }

  // --- Drag and Drop Logic (Pixel-Perfect Cursor Alignment) ---
  function onTokenPointerDown(e, token) {
    if (state.mode !== 'select' && state.mode !== 'angle') return; // Allow drag in select and angle mode
    e.preventDefault();
    e.stopPropagation();

    // If an animation was running, stop it and remove animation classes
    if (state.isPlaying) stopPlayback();
    document.querySelectorAll('.token.is-animating').forEach(t => t.classList.remove('is-animating'));

    // Always resolve live token from state.tokens by ID to prevent stale closure references
    const liveToken = (token && token.id) ? (state.tokens.find(t => t.id === token.id) || token) : token;
    if (!liveToken) return;

    state.draggedToken = liveToken;
    const tokenEl = document.getElementById(`token_${liveToken.id}`);
    if (!tokenEl) return;
    tokenEl.classList.add('is-dragging');

    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);

    state.dragStartPos = { x: clientX, y: clientY };
    state.didMoveToken = false;
    state.dragOutToBench = false;

    // Start long-press detection on touch / mouse (450ms sends to bench)
    clearTimeout(state.longPressTimer);
    if (liveToken.type === 'cap') {
      state.longPressTimer = setTimeout(() => {
        if (state.draggedToken === liveToken && !state.didMoveToken) {
          if (navigator.vibrate) {
            try { navigator.vibrate(50); } catch (err) {}
          }
          state.draggedToken = null;
          if (tokenEl) tokenEl.classList.remove('is-dragging', 'is-drag-out');
          benchCap(liveToken);
        }
      }, 450);
    }

    // Get current visual center of token in screen viewport pixels
    const tokenRect = tokenEl.getBoundingClientRect();
    const tokenCenterX = tokenRect.left + tokenRect.width / 2;
    const tokenCenterY = tokenRect.top + tokenRect.height / 2;

    // Offset between click point and the token's visual center
    state.dragOffset = {
      x: clientX - tokenCenterX,
      y: clientY - tokenCenterY
    };

    window.addEventListener('mousemove', onTokenPointerMove, { passive: false });
    window.addEventListener('mouseup', onTokenPointerUp);
    window.addEventListener('touchmove', onTokenPointerMove, { passive: false });
    window.addEventListener('touchend', onTokenPointerUp);
  }

  function onTokenPointerMove(e) {
    if (!state.draggedToken) return;
    if (e.preventDefault) e.preventDefault();

    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);

    if (state.dragStartPos && Math.hypot(clientX - state.dragStartPos.x, clientY - state.dragStartPos.y) > 8) {
      state.didMoveToken = true;
      clearTimeout(state.longPressTimer);
    }

    // Target visual center in screen viewport coordinates
    const targetCenterX = clientX - state.dragOffset.x;
    const targetCenterY = clientY - state.dragOffset.y;

    const layerRect = el.tokensLayer.getBoundingClientRect();
    const pxX = targetCenterX - layerRect.left;
    const pxY = targetCenterY - layerRect.top;

    // Check if dragged outside the pool boundaries (left, right, top, bottom)
    const isOffBoard = (pxX < -15 || pxX > layerRect.width + 15 || pxY < -15 || pxY > layerRect.height + 15);
    state.dragOutToBench = (state.draggedToken.type === 'cap' && isOffBoard);

    // Convert to percentage with bounds clamping inside the pool
    let pctX = Math.max(2, Math.min(98, (pxX / layerRect.width) * 100));
    let pctY = Math.max(3, Math.min(97, (pxY / layerRect.height) * 100));

    state.draggedToken.x = pctX;
    state.draggedToken.y = pctY;

    // If an attack player with the ball is being moved, synchronize the attached ball!
    if (state.draggedToken.type === 'cap') {
      const attachedBall = state.tokens.find(t => t.type === 'ball' && t.inPool && t.attachedTo === state.draggedToken.id);
      if (attachedBall) {
        attachedBall.x = pctX + 3.2;
        attachedBall.y = pctY - 1.8;
        const ballEl = document.getElementById(`token_${attachedBall.id}`);
        if (ballEl) {
          ballEl.style.left = `${attachedBall.x}%`;
          ballEl.style.top = `${attachedBall.y}%`;
        }
      }
    }

    const tokenEl = document.getElementById(`token_${state.draggedToken.id}`);
    if (tokenEl) {
      tokenEl.style.left = `${pctX}%`;
      tokenEl.style.top = `${pctY}%`;
      if (state.dragOutToBench) {
        tokenEl.classList.add('is-drag-out');
      } else {
        tokenEl.classList.remove('is-drag-out');
      }
    }

    if (state.mode === 'angle') {
      renderShootingAnalysis();
    }
  }

  function onTokenPointerUp(e) {
    clearTimeout(state.longPressTimer);
    if (!state.draggedToken) return;

    const token = state.draggedToken;
    const tokenEl = document.getElementById(`token_${token.id}`);
    if (tokenEl) {
      tokenEl.classList.remove('is-dragging', 'is-drag-out');
    }

    state.draggedToken = null;
    window.removeEventListener('mousemove', onTokenPointerMove);
    window.removeEventListener('mouseup', onTokenPointerUp);
    window.removeEventListener('touchmove', onTokenPointerMove);
    window.removeEventListener('touchend', onTokenPointerUp);

    // Ball drag release: check snap/attach to nearest attack player!
    if (token.type === 'ball') {
      const SNAP_RADIUS = 7.0; // percent of pool
      let targetAttacker = null;
      let minDist = Infinity;

      for (const t of state.tokens) {
        if (isAttackPlayer(t) && t.inPool) {
          const d = Math.hypot(token.x - t.x, token.y - t.y);
          if (d < SNAP_RADIUS && d < minDist) {
            minDist = d;
            targetAttacker = t;
          }
        }
      }

      if (targetAttacker) {
        token.attachedTo = targetAttacker.id;
        token.x = targetAttacker.x + 3.2;
        token.y = targetAttacker.y - 1.8;
        if (tokenEl) {
          tokenEl.style.left = `${token.x}%`;
          tokenEl.style.top = `${token.y}%`;
          tokenEl.classList.add('is-attached');
        }
        triggerHaptic(40);
        showToast(`${t('toast_ball_attached')} #${targetAttacker.number}`);
      } else {
        token.attachedTo = null;
        if (tokenEl) tokenEl.classList.remove('is-attached');
      }

      updateCurrentFramePositions();
      if (state.mode === 'angle') {
        renderShootingAnalysis();
      }
      return;
    }

    // Double-tap, drag-to-bench or tap-select for caps
    const now = Date.now();
    if (token.type === 'cap') {
      if (state.dragOutToBench) {
        benchCap(token);
        return;
      }
      if (!state.didMoveToken) {
        if (token._lastTapTime && (now - token._lastTapTime < 350)) {
          token._lastTapTime = 0;
          benchCap(token);
          return;
        }
        token._lastTapTime = now;

        // If an attack player was tapped, pass the ball to them!
        if (isAttackPlayer(token)) {
          const activeBall = state.tokens.find(t => t.type === 'ball' && t.inPool);
          if (activeBall && activeBall.attachedTo !== token.id) {
            activeBall.attachedTo = token.id;
            activeBall.x = token.x + 3.2;
            activeBall.y = token.y - 1.8;
            const ballEl = document.getElementById(`token_${activeBall.id}`);
            if (ballEl) {
              ballEl.style.left = `${activeBall.x}%`;
              ballEl.style.top = `${activeBall.y}%`;
              ballEl.classList.add('is-attached');
            }
            triggerHaptic(30);
            showToast(`${t('toast_ball_attached')} #${token.number}`);
          }
        }

        // Toggle selection on single tap to show the red remove badge
        state.selectedCapId = (state.selectedCapId === token.id ? null : token.id);
        renderTokens();
        if (state.mode === 'angle') {
          renderShootingAnalysis();
        }
        updateCurrentFramePositions();
        return;
      } else {
        // If moved, clear selection
        state.selectedCapId = null;
        renderTokens();
      }
    }

    // Save position into current active frame
    updateCurrentFramePositions();
  }

  function updateCurrentFramePositions() {
    saveCurrentFrameState();
  }

  // --- Tactical Shooting Angles & Defender/Goalkeeper Blocks Analysis ---
  function renderShootingAnalysis() {
    if (!el.shootingAngleSvg || state.mode !== 'angle' || state.view === 'full') return;

    const isFull = state.view === 'full';
    const cfg = isFull ? PITCH_CONFIG.full : PITCH_CONFIG.half;

    el.shootingAngleSvg.setAttribute('viewBox', `0 0 ${cfg.width} ${cfg.height}`);

    // Resolve Shooter: Whichever attack player has the ball attached!
    let shooter = null;
    const ball = state.tokens.find(t => t.type === 'ball' && t.inPool);

    if (ball && ball.attachedTo) {
      shooter = state.tokens.find(t => t.id === ball.attachedTo && t.inPool && isAttackPlayer(t));
    }

    if (!shooter) {
      // If ball has no attachment yet, attach it to nearest attacker or default attacker
      const attackCaps = state.tokens.filter(t => isAttackPlayer(t) && t.inPool);
      if (attackCaps.length) {
        if (ball) {
          let minDist = Infinity;
          attackCaps.forEach(c => {
            const d = Math.hypot(c.x - ball.x, c.y - ball.y);
            if (d < minDist) {
              minDist = d;
              shooter = c;
            }
          });
        }
        if (!shooter) {
          shooter = attackCaps.find(c => c.number === 4) || attackCaps.find(c => c.number === 7) || attackCaps[0];
        }
        if (shooter && ball) {
          ball.attachedTo = shooter.id;
          ball.x = shooter.x + 3.2;
          ball.y = shooter.y - 1.8;
          const ballEl = document.getElementById(`token_${ball.id}`);
          if (ballEl) {
            ballEl.style.left = `${ball.x}%`;
            ballEl.style.top = `${ball.y}%`;
            ballEl.classList.add('is-attached');
          }
        }
      }
    }

    state.shootingShooterId = shooter ? shooter.id : null;

    // Highlight shooter token
    document.querySelectorAll('.token.is-shooter').forEach(t => t.classList.remove('is-shooter'));
    if (shooter) {
      const shooterDiv = document.getElementById(`token_${shooter.id}`);
      if (shooterDiv) shooterDiv.classList.add('is-shooter');
    }

    if (!shooter) {
      el.shootingAngleSvg.innerHTML = '';
      return;
    }

    const sx = (shooter.x / 100) * cfg.width;
    const sy = (shooter.y / 100) * cfg.height;

    // Defending team is ALWAYS the Defense team (with GK in goal)
    const defenders = state.tokens.filter(t => isDefensePlayer(t) && t.inPool);
    const gk = defenders.find(t => t.isGK || t.number === 1);

    let svg = '';

    if (!isFull) {
      // Half Court: Attack towards top goal at Y = 40
      const goalY = 40;
      const goalW = cfg.goalWidth || 140;
      const postL = 500 - goalW / 2; // 430
      const postR = 500 + goalW / 2; // 570
      const goalCenter = 500;
      const courtH = 640 - 40; // 600px = 14m
      const pxPerMeter = courtH / 14;

      const dy = Math.max(1, sy - goalY);
      const distMeters = Math.max(0, dy / pxPerMeter);

      svg += `
        <defs>
          <linearGradient id="openConeGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stop-color="#22c55e" stop-opacity="0.45" />
            <stop offset="60%" stop-color="#22c55e" stop-opacity="0.18" />
            <stop offset="100%" stop-color="#22c55e" stop-opacity="0.04" />
          </linearGradient>
          <linearGradient id="defBlockGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stop-color="#ef4444" stop-opacity="0.65" />
            <stop offset="60%" stop-color="#ef4444" stop-opacity="0.3" />
            <stop offset="100%" stop-color="#ef4444" stop-opacity="0.08" />
          </linearGradient>
          <linearGradient id="gkBlockGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stop-color="#f97316" stop-opacity="0.65" />
            <stop offset="60%" stop-color="#f97316" stop-opacity="0.28" />
            <stop offset="100%" stop-color="#f97316" stop-opacity="0.08" />
          </linearGradient>
        </defs>
      `;

      // 1. Full Open Shooting Cone
      svg += `
        <polygon points="${sx},${sy} ${postL},${goalY} ${postR},${goalY}" fill="url(#openConeGrad)" stroke="rgba(34, 197, 94, 0.75)" stroke-width="2" stroke-dasharray="6,4" />
      `;

      // 2. Goalkeeper Shadow Cone
      let gkLeft = null, gkRight = null;
      if (gk) {
        const gkx = (gk.x / 100) * cfg.width;
        const gky = (gk.y / 100) * cfg.height;
        if (gky < sy) {
          const reach = 35; // ~1.6m arm-span coverage
          const projL = sx + ((gkx - reach) - sx) * ((goalY - sy) / (gky - sy));
          const projR = sx + ((gkx + reach) - sx) * ((goalY - sy) / (gky - sy));
          gkLeft = Math.max(postL, Math.min(postR, Math.min(projL, projR)));
          gkRight = Math.max(postL, Math.min(postR, Math.max(projL, projR)));

          if (gkRight > gkLeft) {
            svg += `
              <polygon points="${sx},${sy} ${gkLeft},${goalY} ${gkRight},${goalY}" fill="url(#gkBlockGrad)" stroke="rgba(249, 115, 22, 0.75)" stroke-width="1.5" />
            `;
          }
        }
      }

      // 3. Field Defenders Block Coverage
      // Any White defender in front of shooter (dyVal < sy) whose blocking projection reaches the goal mouth turns RED!
      const fieldDefenders = defenders.filter(d => !gk || d.id !== gk.id);
      const activeBlockers = [];
      const defenderIntervals = [];
      const blockerReach = 28; // standard average blocking reach (~1.3m)

      fieldDefenders.forEach(d => {
        const dx = (d.x / 100) * cfg.width;
        const dyVal = (d.y / 100) * cfg.height;
        // Must be in front of shooter towards top goal
        if (dyVal < sy && dyVal > goalY) {
          const projL = sx + ((dx - blockerReach) - sx) * ((goalY - sy) / (dyVal - sy));
          const projR = sx + ((dx + blockerReach) - sx) * ((goalY - sy) / (dyVal - sy));
          const pMin = Math.min(projL, projR);
          const pMax = Math.max(projL, projR);

          // Overlap with goal mouth [postL, postR]
          const goalBlockL = Math.max(postL, pMin);
          const goalBlockR = Math.min(postR, pMax);

          if (goalBlockR > goalBlockL) {
            activeBlockers.push(d);
            defenderIntervals.push([goalBlockL, goalBlockR]);

            // Draw red block shadow cone from shooter through the defender to the goal line
            svg += `
              <!-- Defender #${d.number} Block Shadow Cone -->
              <polygon points="${sx},${sy} ${pMin},${goalY} ${pMax},${goalY}" fill="url(#defBlockGrad)" stroke="rgba(239, 68, 68, 0.9)" stroke-width="2" />
              <!-- Raised hand badge over defender & Blocker Label -->
              <g transform="translate(${dx}, ${dyVal - 16})">
                <circle r="11" fill="#ef4444" stroke="#ffffff" stroke-width="1.8" />
                <text x="0" y="4" font-size="11" text-anchor="middle" fill="#ffffff">🖐️</text>
              </g>
              <text x="${dx}" y="${dyVal + 28}" fill="#ef4444" font-size="10.5" font-weight="800" text-anchor="middle">🛡️ ${t('angle_blocker_badge')}</text>
            `;
          }
        }
      });

      // Update state and highlight all active blocking defenders with pulsing red aura
      state.activeBlockerIds = activeBlockers.map(b => b.id);
      document.querySelectorAll('.token.is-blocker').forEach(t => t.classList.remove('is-blocker'));
      state.activeBlockerIds.forEach(id => {
        const blockerDiv = document.getElementById(`token_${id}`);
        if (blockerDiv) blockerDiv.classList.add('is-blocker');
      });

      // 4. Merge Intervals & Calculate %
      const intervals = [];
      if (gkLeft !== null && gkRight > gkLeft) intervals.push([gkLeft, gkRight]);
      defenderIntervals.forEach(iv => intervals.push(iv));
      intervals.sort((a, b) => a[0] - b[0]);

      const merged = [];
      intervals.forEach(cur => {
        if (!merged.length) {
          merged.push([...cur]);
        } else {
          const prev = merged[merged.length - 1];
          if (cur[0] <= prev[1]) {
            prev[1] = Math.max(prev[1], cur[1]);
          } else {
            merged.push([...cur]);
          }
        }
      });

      let blockedWidth = 0;
      merged.forEach(iv => { blockedWidth += (iv[1] - iv[0]); });
      const openWidth = Math.max(0, goalW - blockedWidth);
      const openPct = Math.round((openWidth / goalW) * 100);
      const coveredPct = 100 - openPct;

      // 5. Goal Line Bars
      svg += `
        <rect x="${postL}" y="${goalY - 5}" width="${goalW}" height="10" rx="5" fill="#22c55e" stroke="#15803d" stroke-width="1.5" />
      `;
      merged.forEach(iv => {
        const w = iv[1] - iv[0];
        if (w > 1) {
          svg += `
            <rect x="${iv[0]}" y="${goalY - 5}" width="${w}" height="10" rx="3" fill="#ef4444" stroke="#991b1b" stroke-width="1.5" />
          `;
        }
      });

      svg += `
        <circle cx="${postL}" cy="${goalY}" r="5" fill="#ffffff" stroke="#ef4444" stroke-width="2" />
        <circle cx="${postR}" cy="${goalY}" r="5" fill="#ffffff" stroke="#ef4444" stroke-width="2" />
      `;

      // 6. Aim Line & Distance Badge
      const midX = (sx + goalCenter) / 2;
      const midY = (sy + goalY) / 2;
      svg += `
        <line x1="${sx}" y1="${sy}" x2="${goalCenter}" y2="${goalY}" stroke="#38bdf8" stroke-width="2" stroke-dasharray="5,4" />
        <g transform="translate(${midX}, ${midY})">
          <rect x="-42" y="-13" width="84" height="24" rx="6" fill="#090d16" stroke="#38bdf8" stroke-width="1.5" />
          <text x="0" y="3.5" fill="#38bdf8" font-size="11" font-weight="800" text-anchor="middle">📏 ${distMeters.toFixed(1)}m</text>
        </g>
      `;

      // 7. Shooter Reticle
      svg += `
        <g transform="translate(${sx}, ${sy})">
          <circle r="26" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-dasharray="6,4" />
          <circle r="5" fill="#22c55e" />
          <text x="0" y="-32" fill="#22c55e" font-size="10.5" font-weight="800" text-anchor="middle">🎯 ${t('angle_shooter_badge')}</text>
        </g>
      `;

      // Update HUD
      const attackColor = resolveTeamColor('attack');
      const defenseColor = resolveTeamColor('defense');
      const cAttack = CAP_COLORS[attackColor] || CAP_COLORS.blue;
      const cDefense = CAP_COLORS[defenseColor] || CAP_COLORS.white;

      if (el.angleShooterName) {
        el.angleShooterName.textContent = `#${shooter.number} (${t(cAttack.nameKey)})`;
      }
      if (el.angleBlockerName) {
        if (activeBlockers.length === 0) {
          el.angleBlockerName.textContent = t('angle_no_blocker');
          el.angleBlockerName.className = 'angle-stat-val angle-val-open';
        } else {
          const names = activeBlockers.map(b => `#${b.number}`).join(', ') + ` (${t(cDefense.nameKey)})`;
          el.angleBlockerName.textContent = names;
          el.angleBlockerName.className = 'angle-stat-val angle-val-covered';
        }
      }
      if (el.angleDistanceVal) el.angleDistanceVal.textContent = `${distMeters.toFixed(1)}m`;
      if (el.angleOpenVal) el.angleOpenVal.textContent = `${openPct}%`;
      if (el.angleCoveredVal) el.angleCoveredVal.textContent = `${coveredPct}%`;
      if (el.angleHudMiniSummary) el.angleHudMiniSummary.textContent = `${distMeters.toFixed(1)}m • ${openPct}%`;
      if (el.angleRuleBadge) {
        if (distMeters > 6.0) {
          el.angleRuleBadge.className = 'angle-rule-badge';
          el.angleRuleBadge.textContent = t('angle_eligible');
        } else if (distMeters <= 2.0) {
          el.angleRuleBadge.className = 'angle-rule-badge offside-2m';
          el.angleRuleBadge.textContent = t('angle_offside');
        } else {
          el.angleRuleBadge.className = 'angle-rule-badge inside-6m';
          el.angleRuleBadge.textContent = t('angle_inside_6m');
        }
      }

    } else {
      // Full court analysis: Blue always attacks towards goalX (e.g. right goal at 960 if sx < 500, or left goal at 40)
      const targetRight = (sx < cfg.width / 2);
      const goalX = targetRight ? 960 : 40;
      const postTop = 265;
      const postBottom = 385;
      const goalH = 120;
      const goalCenter = 325;
      const pxPerMeter = 920 / 30;

      const dxDist = Math.abs(goalX - sx);
      const distMeters = Math.max(0, dxDist / pxPerMeter);

      svg += `
        <defs>
          <linearGradient id="openConeFull" x1="${targetRight ? 0 : 1}" y1="0" x2="${targetRight ? 1 : 0}" y2="0">
            <stop offset="0%" stop-color="#22c55e" stop-opacity="0.45" />
            <stop offset="60%" stop-color="#22c55e" stop-opacity="0.18" />
            <stop offset="100%" stop-color="#22c55e" stop-opacity="0.04" />
          </linearGradient>
        </defs>
        <polygon points="${sx},${sy} ${goalX},${postTop} ${goalX},${postBottom}" fill="url(#openConeFull)" stroke="rgba(34, 197, 94, 0.75)" stroke-width="2" stroke-dasharray="6,4" />
        <rect x="${goalX - 4}" y="${postTop}" width="8" height="${goalH}" rx="4" fill="#22c55e" />
        <line x1="${sx}" y1="${sy}" x2="${goalX}" y2="${goalCenter}" stroke="#38bdf8" stroke-width="2" stroke-dasharray="5,4" />
        <g transform="translate(${(sx + goalX)/2}, ${(sy + goalCenter)/2})">
          <rect x="-42" y="-13" width="84" height="24" rx="6" fill="#090d16" stroke="#38bdf8" stroke-width="1.5" />
          <text x="0" y="3.5" fill="#38bdf8" font-size="11" font-weight="800" text-anchor="middle">📏 ${distMeters.toFixed(1)}m</text>
        </g>
        <g transform="translate(${sx}, ${sy})">
          <circle r="26" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-dasharray="6,4" />
          <circle r="5" fill="#22c55e" />
          <text x="0" y="-32" fill="#22c55e" font-size="10.5" font-weight="800" text-anchor="middle">🎯 ${t('angle_shooter_badge')}</text>
        </g>
      `;

      // Full Court Blockers
      const fieldDefenders = defenders.filter(d => !gk || d.id !== gk.id);
      const activeBlockers = [];
      const blockerReach = 20;

      fieldDefenders.forEach(d => {
        const dx = (d.x / 100) * cfg.width;
        const dyVal = (d.y / 100) * cfg.height;
        const inFront = targetRight ? (dx > sx && dx < goalX) : (dx < sx && dx > goalX);
        if (inFront) {
          const projT = sy + ((dyVal - blockerReach) - sy) * ((goalX - sx) / (dx - sx));
          const projB = sy + ((dyVal + blockerReach) - sy) * ((goalX - sx) / (dx - sx));
          const pMin = Math.min(projT, projB);
          const pMax = Math.max(projT, projB);

          const goalBlockT = Math.max(postTop, pMin);
          const goalBlockB = Math.min(postBottom, pMax);

          if (goalBlockB > goalBlockT) {
            activeBlockers.push(d);
            svg += `
              <polygon points="${sx},${sy} ${goalX},${pMin} ${goalX},${pMax}" fill="url(#openConeFull)" fill-opacity="0.6" stroke="rgba(239, 68, 68, 0.9)" stroke-width="2" />
              <g transform="translate(${dx}, ${dyVal - 16})">
                <circle r="11" fill="#ef4444" stroke="#ffffff" stroke-width="1.8" />
                <text x="0" y="4" font-size="11" text-anchor="middle" fill="#ffffff">🖐️</text>
              </g>
              <text x="${dx}" y="${dyVal + 28}" fill="#ef4444" font-size="10.5" font-weight="800" text-anchor="middle">🛡️ ${t('angle_blocker_badge')}</text>
            `;
          }
        }
      });

      state.activeBlockerIds = activeBlockers.map(b => b.id);
      document.querySelectorAll('.token.is-blocker').forEach(t => t.classList.remove('is-blocker'));
      state.activeBlockerIds.forEach(id => {
        const blockerDiv = document.getElementById(`token_${id}`);
        if (blockerDiv) blockerDiv.classList.add('is-blocker');
      });

      const attackColor = resolveTeamColor('attack');
      const defenseColor = resolveTeamColor('defense');
      const cAttack = CAP_COLORS[attackColor] || CAP_COLORS.blue;
      const cDefense = CAP_COLORS[defenseColor] || CAP_COLORS.white;

      if (el.angleShooterName) {
        el.angleShooterName.textContent = `#${shooter.number} (${t(cAttack.nameKey)})`;
      }
      if (el.angleBlockerName) {
        if (activeBlockers.length === 0) {
          el.angleBlockerName.textContent = t('angle_no_blocker');
          el.angleBlockerName.className = 'angle-stat-val angle-val-open';
        } else {
          const names = activeBlockers.map(b => `#${b.number}`).join(', ') + ` (${t(cDefense.nameKey)})`;
          el.angleBlockerName.textContent = names;
          el.angleBlockerName.className = 'angle-stat-val angle-val-covered';
        }
      }
      if (el.angleDistanceVal) el.angleDistanceVal.textContent = `${distMeters.toFixed(1)}m`;
      const fullOpenPct = activeBlockers.length > 0 ? 60 : 85;
      if (el.angleOpenVal) el.angleOpenVal.textContent = `${fullOpenPct}%`;
      if (el.angleCoveredVal) el.angleCoveredVal.textContent = activeBlockers.length > 0 ? '40%' : '15%';
      if (el.angleHudMiniSummary) el.angleHudMiniSummary.textContent = `${distMeters.toFixed(1)}m • ${fullOpenPct}%`;
      if (el.angleRuleBadge) {
        if (distMeters > 6.0) {
          el.angleRuleBadge.className = 'angle-rule-badge';
          el.angleRuleBadge.textContent = t('angle_eligible');
        } else if (distMeters <= 2.0) {
          el.angleRuleBadge.className = 'angle-rule-badge offside-2m';
          el.angleRuleBadge.textContent = t('angle_offside');
        } else {
          el.angleRuleBadge.className = 'angle-rule-badge inside-6m';
          el.angleRuleBadge.textContent = t('angle_inside_6m');
        }
      }
    }

    el.shootingAngleSvg.innerHTML = svg;
  }

  // --- Canvas Drawing Logic ---
  function resizeCanvas() {
    const rect = el.poolBoard.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    el.canvas.width = rect.width * dpr;
    el.canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawCanvas();
  }

  function redrawCanvas() {
    const rect = el.poolBoard.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Draw all stored paths for this frame
    state.drawingPaths.forEach(path => drawPath(path, rect));

    // Draw active drawing path
    if (state.activePath) {
      drawPath(state.activePath, rect);
    }
  }

  function drawPath(path, rect) {
    if (!path.points || path.points.length === 0) return;

    ctx.save();
    ctx.strokeStyle = path.color || '#ffffff';
    ctx.lineWidth = path.width || 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (path.type === 'pass') {
      ctx.setLineDash([8, 6]); // Dashed line for ball passes
    } else {
      ctx.setLineDash([]);
    }

    if (path.type === 'draw') {
      // Smooth Freehand Line
      ctx.beginPath();
      const p0 = toPixel(path.points[0], rect);
      ctx.moveTo(p0.x, p0.y);

      for (let i = 1; i < path.points.length; i++) {
        const pt = toPixel(path.points[i], rect);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();

    } else if (path.type === 'arrow' || path.type === 'pass') {
      // Arrow Line
      const pStart = toPixel(path.points[0], rect);
      const pEnd = toPixel(path.points[path.points.length - 1], rect);

      ctx.beginPath();
      ctx.moveTo(pStart.x, pStart.y);
      ctx.lineTo(pEnd.x, pEnd.y);
      ctx.stroke();

      // Draw arrowhead at end
      drawArrowHead(ctx, pStart.x, pStart.y, pEnd.x, pEnd.y, path.width);
    }

    ctx.restore();
  }

  function drawArrowHead(context, fromX, fromY, toX, toY, strokeWidth) {
    const headLength = Math.max(12, strokeWidth * 3.5);
    const angle = Math.atan2(toY - fromY, toX - fromX);

    context.save();
    context.setLineDash([]);
    context.fillStyle = context.strokeStyle;
    context.beginPath();
    context.moveTo(toX, toY);
    context.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6)
    );
    context.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6)
    );
    context.closePath();
    context.fill();
    context.restore();
  }

  function toPixel(ptPct, rect) {
    return {
      x: (ptPct.x / 100) * rect.width,
      y: (ptPct.y / 100) * rect.height,
    };
  }

  function toPercent(pxX, pxY, rect) {
    return {
      x: (pxX / rect.width) * 100,
      y: (pxY / rect.height) * 100,
    };
  }

  // --- Drawing Events ---
  function onCanvasPointerDown(e) {
    if (state.mode === 'select') return;
    const rect = el.poolBoard.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);

    const pxX = clientX - rect.left;
    const pxY = clientY - rect.top;

    if (state.mode === 'eraser') {
      eraseAtPoint(pxX, pxY, rect);
      return;
    }

    const ptPct = toPercent(pxX, pxY, rect);
    state.activePath = {
      type: state.mode, // 'draw', 'arrow', 'pass'
      color: state.currentColor,
      width: state.strokeWidth,
      points: [ptPct],
    };

    window.addEventListener('mousemove', onCanvasPointerMove);
    window.addEventListener('mouseup', onCanvasPointerUp);
    window.addEventListener('touchmove', onCanvasPointerMove, { passive: false });
    window.addEventListener('touchend', onCanvasPointerUp);
  }

  function onCanvasPointerMove(e) {
    if (!state.activePath) return;
    if (e.preventDefault) e.preventDefault();

    const rect = el.poolBoard.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0].clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0].clientY);

    const pxX = clientX - rect.left;
    const pxY = clientY - rect.top;

    if (state.mode === 'eraser') {
      eraseAtPoint(pxX, pxY, rect);
      return;
    }

    const ptPct = toPercent(pxX, pxY, rect);

    if (state.activePath.type === 'draw') {
      state.activePath.points.push(ptPct);
    } else {
      // Arrow & Pass only keep start and end
      if (state.activePath.points.length === 1) {
        state.activePath.points.push(ptPct);
      } else {
        state.activePath.points[1] = ptPct;
      }
    }

    redrawCanvas();
  }

  function onCanvasPointerUp() {
    if (state.activePath && state.activePath.points.length > 1) {
      state.drawingPaths.push(state.activePath);
      // Save drawings to active frame
      if (state.frames[state.currentFrameIndex]) {
        state.frames[state.currentFrameIndex].drawings = JSON.parse(JSON.stringify(state.drawingPaths));
      }
    }
    state.activePath = null;
    redrawCanvas();

    window.removeEventListener('mousemove', onCanvasPointerMove);
    window.removeEventListener('mouseup', onCanvasPointerUp);
    window.removeEventListener('touchmove', onCanvasPointerMove);
    window.removeEventListener('touchend', onCanvasPointerUp);
  }

  function eraseAtPoint(pxX, pxY, rect) {
    // Erase any path within radius
    const threshold = 18;
    const remaining = state.drawingPaths.filter(path => {
      return !path.points.some(pt => {
        const pPx = toPixel(pt, rect);
        const dist = Math.hypot(pPx.x - pxX, pPx.y - pxY);
        return dist < threshold;
      });
    });

    if (remaining.length !== state.drawingPaths.length) {
      state.drawingPaths = remaining;
      if (state.frames[state.currentFrameIndex]) {
        state.frames[state.currentFrameIndex].drawings = JSON.parse(JSON.stringify(remaining));
      }
      redrawCanvas();
    }
  }

  // --- Save / Restore Frame State ---
  function saveCurrentFrameState() {
    if (state.currentFrameIndex >= 0 && state.frames[state.currentFrameIndex]) {
      const cur = state.frames[state.currentFrameIndex];
      cur.tokenPositions = captureCurrentTokenPositions();
      cur.drawings = JSON.parse(JSON.stringify(state.drawingPaths || []));
      cur.view = state.view;
    }
  }

  // --- Animation System (Timeline & Keyframes) ---
  function renderTimeline() {
    const container = el.timelineContainer || el.timelineFrames.parentElement;
    const prevScroll = container ? container.scrollLeft : 0;

    el.timelineFrames.innerHTML = '';

    let activeNode = null;
    state.frames.forEach((frame, idx) => {
      const node = document.createElement('div');
      const isActive = idx === state.currentFrameIndex;
      node.className = `frame-node ${isActive ? 'active' : ''}`;
      node.innerHTML = `
        <span>${t('frame_label')} ${idx + 1}</span>
        <span class="frame-num">${t('step_label')} ${idx + 1}</span>
      `;

      node.addEventListener('click', () => {
        if (state.isPlaying) stopPlayback();
        selectFrame(idx);
      });

      el.timelineFrames.appendChild(node);
      if (isActive) activeNode = node;
    });

    if (container) {
      container.scrollLeft = prevScroll;
      if (activeNode) {
        requestAnimationFrame(() => {
          const cLeft = container.scrollLeft;
          const cWidth = container.clientWidth;
          const nLeft = activeNode.offsetLeft - el.timelineFrames.offsetLeft;
          const nWidth = activeNode.offsetWidth;

          if (nLeft + nWidth > cLeft + cWidth - 8) {
            container.scrollLeft = nLeft + nWidth - cWidth + 16;
          } else if (nLeft < cLeft + 8) {
            container.scrollLeft = Math.max(0, nLeft - 16);
          }
        });
      }
    }
  }

  function selectFrame(index, skipSave = false) {
    if (index < 0 || index >= state.frames.length) return;

    // 1. Save current frame state FIRST before switching away!
    if (!state.isPlaying && !skipSave) {
      saveCurrentFrameState();
    }

    // 2. Switch active index
    state.currentFrameIndex = index;
    renderTimeline();

    // 3. Load target frame data
    const targetFrame = state.frames[index];
    if (targetFrame) {
      applyPositionsFromFrame(targetFrame, false);
    }
  }

  function addFrame() {
    // 1. Save current frame FIRST so all moves & drawings in current phase are persisted!
    saveCurrentFrameState();

    const newIndex = state.frames.length;
    // The new step inherits the current positions of all players & ball!
    const currentPositions = captureCurrentTokenPositions();
    // Inherit drawings into the new step so nothing vanishes unexpectedly
    const currentDrawings = JSON.parse(JSON.stringify(state.drawingPaths || []));

    const newFrame = {
      id: `frame_${Date.now()}_${newIndex}`,
      name: `${t('frame_label')} ${newIndex + 1}`,
      tokenPositions: currentPositions,
      drawings: currentDrawings,
      view: state.view
    };

    state.frames.push(newFrame);
    selectFrame(newIndex, true);
    showToast(t('toast_frame_added', { num: newIndex + 1 }));
  }

  function duplicateCurrentFrame() {
    saveCurrentFrameState();
    const cur = state.frames[state.currentFrameIndex];
    if (!cur) return;

    const dup = {
      id: `frame_${Date.now()}_dup`,
      name: `${cur.name || t('frame_label')} (2)`,
      tokenPositions: JSON.parse(JSON.stringify(cur.tokenPositions)),
      drawings: JSON.parse(JSON.stringify(cur.drawings || [])),
      view: cur.view || state.view
    };

    state.frames.splice(state.currentFrameIndex + 1, 0, dup);
    selectFrame(state.currentFrameIndex + 1, true);
    showToast(t('toast_frame_dup'));
  }

  function deleteCurrentFrame() {
    if (state.frames.length <= 1) {
      showToast(t('toast_min_1_frame'));
      return;
    }
    state.frames.splice(state.currentFrameIndex, 1);
    const newIdx = Math.max(0, state.currentFrameIndex - 1);
    state.currentFrameIndex = newIdx;
    renderTimeline();
    applyPositionsFromFrame(state.frames[newIdx], false);
    showToast(t('toast_frame_del'));
  }

  // --- Full Screen Presentation Mode ---
  function setBoardFullscreen(enable, fromPlay = false) {
    state.isFullscreen = !!enable;
    if (enable) {
      if (fromPlay) {
        state.autoFullscreenFromPlay = true;
      }
      document.body.classList.add('is-fullscreen-mode');
      if (el.fullscreenBtn) el.fullscreenBtn.classList.add('active');
      if (el.exitFullscreenOverlayBtn) el.exitFullscreenOverlayBtn.classList.remove('hidden');
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } catch (e) {}
    } else {
      state.autoFullscreenFromPlay = false;
      document.body.classList.remove('is-fullscreen-mode');
      if (el.fullscreenBtn) el.fullscreenBtn.classList.remove('active');
      if (el.exitFullscreenOverlayBtn) el.exitFullscreenOverlayBtn.classList.add('hidden');
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      } catch (e) {}
    }

    if (el.poolBoard) {
      void el.poolBoard.offsetWidth;
    }
    resizeCanvas();
    requestAnimationFrame(() => resizeCanvas());
    setTimeout(() => resizeCanvas(), 150);
  }

  function toggleBoardFullscreen() {
    if (state.isFullscreen) {
      setBoardFullscreen(false);
    } else {
      state.autoFullscreenFromPlay = false;
      setBoardFullscreen(true, false);
    }
  }

  // --- Sidebar Collapse / Expand Toggle ---
  function setSidebarCollapsed(collapsed, skipAnimation = false) {
    state.sidebarCollapsed = !!collapsed;
    document.body.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    if (el.toggleSidebarBtn) {
      el.toggleSidebarBtn.classList.toggle('active', !state.sidebarCollapsed);
      el.toggleSidebarBtn.setAttribute('aria-expanded', String(!state.sidebarCollapsed));
    }
    safeSetItem('wptb_sidebar_collapsed', state.sidebarCollapsed ? '1' : '0');

    // Trigger canvas & board resize immediately and after CSS transition
    resizeCanvas();
    if (!skipAnimation) {
      setTimeout(() => resizeCanvas(), 120);
      setTimeout(() => resizeCanvas(), 240);
    }
  }

  function toggleSidebar() {
    setSidebarCollapsed(!state.sidebarCollapsed);
    triggerHaptic(25);
  }

  // --- Bottom Animation Bar Collapse / Expand Toggle ---
  function setBottomBarCollapsed(collapsed, skipAnimation = false) {
    state.bottomBarCollapsed = !!collapsed;
    document.body.classList.toggle('bottom-bar-collapsed', state.bottomBarCollapsed);
    if (el.closeBottomBarBtn) {
      el.closeBottomBarBtn.setAttribute('aria-expanded', String(!state.bottomBarCollapsed));
    }
    safeSetItem('wptb_bottom_collapsed', state.bottomBarCollapsed ? '1' : '0');

    // Trigger canvas & board resize immediately and after CSS transition
    resizeCanvas();
    if (!skipAnimation) {
      setTimeout(() => {
        resizeCanvas();
        renderPitchSvg();
      }, 120);
      setTimeout(() => {
        resizeCanvas();
        renderPitchSvg();
      }, 240);
    }
  }

  function toggleBottomBar() {
    setBottomBarCollapsed(!state.bottomBarCollapsed);
    triggerHaptic(25);
  }

  // Smooth Animation Playback
  function togglePlayback() {
    if (state.isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }

  function startPlayback() {
    if (state.frames.length <= 1) {
      showToast(t('toast_need_2_frames'));
      return;
    }

    playWhistleSound();
    triggerHaptic(60);

    // Save current frame before starting playback
    saveCurrentFrameState();

    // Automatically enter Full Screen Mode on Play
    if (!state.isFullscreen) {
      setBoardFullscreen(true, true);
    }

    state.isPlaying = true;
    el.playBtn.classList.add('playing');
    el.playIcon.textContent = '⏸️';
    el.playText.textContent = t('pause_btn');

    const cssDurationMs = Math.round(800 / state.animSpeed);
    if (el.tokensLayer) {
      el.tokensLayer.style.setProperty('--anim-duration', `${cssDurationMs}ms`);
    }

    // If currently at the last phase, snap to Phase 1 first, hold briefly, then animate 1 -> 2 -> 3 -> 4...
    if (state.currentFrameIndex >= state.frames.length - 1) {
      state.currentFrameIndex = 0;
      renderTimeline();
      applyPositionsFromFrame(state.frames[0], false);
      const startHoldMs = Math.round(400 / state.animSpeed);
      state.animationTimer = setTimeout(() => {
        if (!state.isPlaying) return;
        stepAnimation(1);
      }, startHoldMs);
    } else {
      stepAnimation(state.currentFrameIndex + 1);
    }
  }

  function stopPlayback() {
    state.isPlaying = false;
    clearTimeout(state.animationTimer);
    el.playBtn.classList.remove('playing');
    el.playIcon.textContent = '▶️';
    el.playText.textContent = t('play_btn');
    document.querySelectorAll('.token.is-animating').forEach(t => t.classList.remove('is-animating'));

    if (state.isFullscreen && state.autoFullscreenFromPlay) {
      setBoardFullscreen(false);
    }
  }

  function stepAnimation(targetFrameIndex) {
    if (!state.isPlaying) return;
    if (targetFrameIndex < 0 || targetFrameIndex >= state.frames.length) {
      stopPlayback();
      return;
    }

    const cssDurationMs = Math.round(800 / state.animSpeed);
    if (el.tokensLayer) {
      el.tokensLayer.style.setProperty('--anim-duration', `${cssDurationMs}ms`);
    }

    state.currentFrameIndex = targetFrameIndex;
    renderTimeline();

    // Trigger smooth transition to target frame
    const targetFrame = state.frames[targetFrameIndex];
    if (targetFrame) {
      applyPositionsFromFrame(targetFrame, true);
    }

    const duration = Math.round(1050 / state.animSpeed);

    state.animationTimer = setTimeout(() => {
      if (!state.isPlaying) return;

      const isLast = targetFrameIndex >= state.frames.length - 1;
      if (isLast) {
        if (!state.isLooping) {
          stopPlayback();
          return;
        }
        // Loop back: snap cleanly to Phase 1, hold briefly, then animate 1 -> 2 -> 3 -> 4...
        state.currentFrameIndex = 0;
        renderTimeline();
        applyPositionsFromFrame(state.frames[0], false);
        const loopHoldMs = Math.round(450 / state.animSpeed);
        state.animationTimer = setTimeout(() => {
          if (!state.isPlaying) return;
          if (state.frames.length > 1) {
            stepAnimation(1);
          } else {
            stopPlayback();
          }
        }, loopHoldMs);
        return;
      }

      stepAnimation(targetFrameIndex + 1);
    }, duration);
  }

  // --- Water Polo Preset Tactics ---
  // Blue is ALWAYS the attacking team, White is ALWAYS the defending team (with White 1 GK defending left goal).
  const PRESET_TACTICS = {
    'attack-6on5-33': {
      view: 'half',
      i18nKey: 'tactic_6on5_33',
      name: 'Παίκτης Παραπάνω (6on5 - 3:3)',
      apply: () => {
        // Blue attacking 6-on-5 in 3:3 formation towards top goal
        // Pos 1 (Wing Left), Pos 2 (Flat Left), Pos 3 (Point), Pos 4 (Flat Right), Pos 5 (Wing Right), Pos 6 (Post at 2m)
        const bluePos = {
          blue_1: { x: 0, y: 0, inPool: false },    // GK on bench
          blue_2: { x: 15, y: 23, inPool: true },   // Pos 1 (Wing Left at 2m)
          blue_3: { x: 28, y: 44, inPool: true },   // Pos 2 (Flat Left)
          blue_4: { x: 50, y: 55, inPool: true },   // Pos 3 (Point / Κορυφή)
          blue_5: { x: 72, y: 44, inPool: true },   // Pos 4 (Flat Right)
          blue_6: { x: 85, y: 23, inPool: true },   // Pos 5 (Wing Right at 2m)
          blue_7: { x: 50, y: 20, inPool: true },   // Pos 6 (Post at 2m)
        };
        // White defending in 5-man box/triangle (White 7 excluded in EXP box at top-left)
        const whitePos = {
          white_1: { x: 50, y: 9, inPool: true },   // GK in top goal
          white_2: { x: 30, y: 22, inPool: true },  // Def Left Post/Wing
          white_3: { x: 38, y: 38, inPool: true },  // Def Perimeter Left
          white_4: { x: 50, y: 16, inPool: true },  // Blocker center in front of goal
          white_5: { x: 62, y: 38, inPool: true },  // Def Perimeter Right
          white_6: { x: 70, y: 22, inPool: true },  // Def Right Post/Wing
          white_7: { x: 6.8, y: 6.5, inPool: true }, // Excluded player in EXP box above goal line
        };
        return { whitePos, bluePos, ball: { x: 50, y: 55 } };
      }
    },

    'attack-6on5-42': {
      view: 'half',
      i18nKey: 'tactic_6on5_42',
      name: 'Παίκτης Παραπάνω (6on5 - 4:2)',
      apply: () => {
        // Blue attacking 6-on-5 in 4:2 formation (4 on 2m line, 2 on perimeter at 5m line)
        const bluePos = {
          blue_1: { x: 0, y: 0, inPool: false },    // GK on bench
          blue_2: { x: 12, y: 22, inPool: true },   // Wing Left at 2m
          blue_3: { x: 38, y: 20, inPool: true },   // Post Left at 2m
          blue_6: { x: 62, y: 20, inPool: true },   // Post Right at 2m
          blue_4: { x: 88, y: 22, inPool: true },   // Wing Right at 2m
          blue_7: { x: 35, y: 46, inPool: true },   // Flat Left at 5m
          blue_5: { x: 65, y: 46, inPool: true },   // Flat Right at 5m with Ball
        };
        // White defending in 5-man (White 7 excluded in EXP box)
        const whitePos = {
          white_1: { x: 50, y: 9, inPool: true },   // GK
          white_2: { x: 25, y: 21, inPool: true },  // Between Blue 2 and Blue 3
          white_3: { x: 36, y: 36, inPool: true },  // Marking Flat Left
          white_4: { x: 50, y: 16, inPool: true },  // Center blocker between posts
          white_5: { x: 64, y: 36, inPool: true },  // Marking Flat Right
          white_6: { x: 75, y: 21, inPool: true },  // Between Blue 6 and Blue 4
          white_7: { x: 6.8, y: 6.5, inPool: true }, // Inside EXP box above goal line
        };
        return { whitePos, bluePos, ball: { x: 65, y: 49 } };
      }
    },

    'attack-even-set': {
      view: 'half',
      i18nKey: 'tactic_even_set',
      name: 'Ίσα (Επίθεση με Φουνταριστό)',
      apply: () => {
        // Blue Attackers: 3 on 2m line (Blue 2, Blue 6, Blue 4) and 3 on perimeter (Blue 3, Blue 7, Blue 5)
        const bluePos = {
          blue_1: { x: 0, y: 0, inPool: false },
          blue_2: { x: 15, y: 23, inPool: true }, // Wing Left at 2m
          blue_6: { x: 50, y: 22, inPool: true }, // Hole set at 2m
          blue_4: { x: 85, y: 23, inPool: true }, // Wing Right at 2m
          blue_3: { x: 30, y: 46, inPool: true }, // Flat Left
          blue_7: { x: 50, y: 54, inPool: true }, // Point / Center with Ball
          blue_5: { x: 70, y: 46, inPool: true }, // Flat Right
        };
        // White Defenders: Man-to-man tight press
        const whitePos = {
          white_1: { x: 50, y: 9, inPool: true },  // GK in top goal
          white_2: { x: 19, y: 22, inPool: true }, // Marking Blue 2
          white_7: { x: 50, y: 18, inPool: true }, // Hole guard marking Blue 6
          white_6: { x: 81, y: 22, inPool: true }, // Marking Blue 4
          white_3: { x: 33, y: 41, inPool: true }, // Marking Blue 3
          white_4: { x: 50, y: 47, inPool: true }, // Marking Blue 7
          white_5: { x: 67, y: 41, inPool: true }, // Marking Blue 5
        };
        return { whitePos, bluePos, ball: { x: 50, y: 57 } };
      }
    },

    'defense-zone-m': {
      view: 'half',
      i18nKey: 'tactic_zone_m',
      name: 'Ζώνη M-Drop',
      apply: () => {
        const bluePos = {
          blue_1: { x: 0, y: 0, inPool: false },
          blue_2: { x: 15, y: 23, inPool: true },
          blue_6: { x: 50, y: 22, inPool: true },
          blue_4: { x: 85, y: 23, inPool: true },
          blue_3: { x: 30, y: 46, inPool: true },
          blue_7: { x: 50, y: 54, inPool: true },
          blue_5: { x: 70, y: 46, inPool: true },
        };
        // White Defenders: M-Drop Zone (White 3 and White 5 drop back to help hole guard White 7)
        const whitePos = {
          white_1: { x: 50, y: 9, inPool: true },  // GK
          white_7: { x: 50, y: 18, inPool: true }, // Hole guard
          white_2: { x: 20, y: 22, inPool: true }, // Wing Left defender
          white_6: { x: 80, y: 22, inPool: true }, // Wing Right defender
          white_3: { x: 40, y: 32, inPool: true }, // Drop #1 helping on hole set
          white_5: { x: 60, y: 32, inPool: true }, // Drop #2 helping on hole set
          white_4: { x: 50, y: 46, inPool: true }, // Point defender
        };
        return { whitePos, bluePos, ball: { x: 50, y: 57 } };
      }
    },

    'defense-press': {
      view: 'half',
      i18nKey: 'tactic_press',
      name: 'Πιεστική Άμυνα (Pressing)',
      apply: () => {
        const bluePos = {
          blue_1: { x: 0, y: 0, inPool: false },
          blue_2: { x: 15, y: 23, inPool: true },
          blue_6: { x: 50, y: 22, inPool: true },
          blue_4: { x: 85, y: 23, inPool: true },
          blue_3: { x: 30, y: 46, inPool: true },
          blue_7: { x: 50, y: 54, inPool: true },
          blue_5: { x: 70, y: 46, inPool: true },
        };
        // White Defenders: aggressive man-to-man body press
        const whitePos = {
          white_1: { x: 50, y: 9, inPool: true },
          white_2: { x: 17, y: 22, inPool: true },
          white_7: { x: 50, y: 18, inPool: true },
          white_6: { x: 83, y: 22, inPool: true },
          white_3: { x: 31, y: 43, inPool: true },
          white_4: { x: 50, y: 49, inPool: true },
          white_5: { x: 69, y: 43, inPool: true },
        };
        return { whitePos, bluePos, ball: { x: 50, y: 57 } };
      }
    },

    'counter-1on0': {
      view: 'full',
      i18nKey: 'tactic_counter_1on0',
      name: 'Αντεπίθεση (1-on-0)',
      apply: () => {
        const bluePos = {
          blue_1: { x: 88, y: 50, inPool: true }, // GK Right
          blue_2: { x: 25, y: 50, inPool: true }, // Solo breakaway attacker heading for 1v1
          blue_3: { x: 44, y: 32, inPool: true }, // Trailing attacker
          blue_4: { x: 46, y: 68, inPool: true }, // Trailing attacker
          blue_5: { x: 58, y: 38, inPool: true }, // Trailing attacker
          blue_6: { x: 58, y: 62, inPool: true }, // Trailing attacker
          blue_7: { x: 68, y: 50, inPool: true }, // Trailing attacker
        };
        const whitePos = {
          white_1: { x: 17, y: 50, inPool: true }, // GK coming out of goal
          white_2: { x: 33, y: 50, inPool: true }, // Chasing defender sprinting behind
          white_3: { x: 48, y: 36, inPool: true },
          white_4: { x: 50, y: 64, inPool: true },
          white_5: { x: 62, y: 40, inPool: true },
          white_6: { x: 62, y: 60, inPool: true },
          white_7: { x: 72, y: 50, inPool: true },
        };
        return { whitePos, bluePos, ball: { x: 24, y: 50 } };
      }
    },

    'counter-2on1': {
      view: 'full',
      i18nKey: 'tactic_counter_2on1',
      name: 'Αντεπίθεση (2-on-1)',
      apply: () => {
        const bluePos = {
          blue_1: { x: 88, y: 50, inPool: true }, // GK Right
          blue_2: { x: 26, y: 35, inPool: true }, // Leading right wing
          blue_3: { x: 26, y: 65, inPool: true }, // Leading left wing with ball
          blue_4: { x: 46, y: 50, inPool: true }, // Trailing support
          blue_5: { x: 58, y: 36, inPool: true },
          blue_6: { x: 58, y: 64, inPool: true },
          blue_7: { x: 68, y: 50, inPool: true },
        };
        const whitePos = {
          white_1: { x: 14.5, y: 50, inPool: true }, // GK Left
          white_2: { x: 23, y: 50, inPool: true },   // Single defender split in middle
          white_3: { x: 36, y: 40, inPool: true },   // Chasing defender
          white_4: { x: 36, y: 60, inPool: true },   // Chasing defender
          white_5: { x: 52, y: 45, inPool: true },
          white_6: { x: 62, y: 38, inPool: true },
          white_7: { x: 62, y: 62, inPool: true },
        };
        return { whitePos, bluePos, ball: { x: 25, y: 64 } };
      }
    },

    'counter-3on2': {
      view: 'full',
      i18nKey: 'tactic_counter_3on2',
      name: 'Αντεπίθεση (3-on-2)',
      apply: () => {
        const bluePos = {
          blue_1: { x: 88, y: 50, inPool: true }, // GK Right
          blue_2: { x: 28, y: 26, inPool: true }, // Leading wing right
          blue_3: { x: 32, y: 50, inPool: true }, // Leading center driver with ball
          blue_4: { x: 28, y: 74, inPool: true }, // Leading wing left
          blue_5: { x: 52, y: 38, inPool: true }, // Trailing support
          blue_6: { x: 52, y: 62, inPool: true }, // Trailing support
          blue_7: { x: 65, y: 50, inPool: true },
        };
        const whitePos = {
          white_1: { x: 14.5, y: 50, inPool: true }, // GK Left
          white_2: { x: 25, y: 38, inPool: true },   // Defender 1 split right
          white_3: { x: 25, y: 62, inPool: true },   // Defender 2 split left
          white_4: { x: 38, y: 50, inPool: true },   // Chasing defender
          white_5: { x: 56, y: 36, inPool: true },
          white_6: { x: 56, y: 64, inPool: true },
          white_7: { x: 68, y: 50, inPool: true },
        };
        return { whitePos, bluePos, ball: { x: 31, y: 50 } };
      }
    },

    'counter-attack': {
      view: 'full',
      i18nKey: 'tactic_counter_3on2',
      name: 'Αντεπίθεση (3-on-2)',
      apply: () => {
        const bluePos = {
          blue_1: { x: 88, y: 50, inPool: true },
          blue_2: { x: 28, y: 26, inPool: true },
          blue_3: { x: 32, y: 50, inPool: true },
          blue_4: { x: 28, y: 74, inPool: true },
          blue_5: { x: 52, y: 38, inPool: true },
          blue_6: { x: 52, y: 62, inPool: true },
          blue_7: { x: 65, y: 50, inPool: true },
        };
        const whitePos = {
          white_1: { x: 14.5, y: 50, inPool: true },
          white_2: { x: 25, y: 38, inPool: true },
          white_3: { x: 25, y: 62, inPool: true },
          white_4: { x: 38, y: 50, inPool: true },
          white_5: { x: 56, y: 36, inPool: true },
          white_6: { x: 56, y: 64, inPool: true },
          white_7: { x: 68, y: 50, inPool: true },
        };
        return { whitePos, bluePos, ball: { x: 31, y: 50 } };
      }
    },

    'counter-4on3': {
      view: 'full',
      i18nKey: 'tactic_counter_4on3',
      name: 'Αντεπίθεση (4-on-3)',
      apply: () => {
        const bluePos = {
          blue_1: { x: 88, y: 50, inPool: true }, // GK Right
          blue_2: { x: 24, y: 22, inPool: true }, // Leading wing right
          blue_3: { x: 33, y: 38, inPool: true }, // Leading flat right with ball
          blue_4: { x: 33, y: 62, inPool: true }, // Leading flat left
          blue_5: { x: 24, y: 78, inPool: true }, // Leading wing left
          blue_6: { x: 54, y: 44, inPool: true }, // Trailing support
          blue_7: { x: 54, y: 56, inPool: true },
        };
        const whitePos = {
          white_1: { x: 14.5, y: 50, inPool: true }, // GK Left
          white_2: { x: 22, y: 32, inPool: true },   // Defender 1 low right
          white_3: { x: 27, y: 50, inPool: true },   // Defender 2 top center
          white_4: { x: 22, y: 68, inPool: true },   // Defender 3 low left
          white_5: { x: 40, y: 38, inPool: true },   // Chasing defender
          white_6: { x: 40, y: 62, inPool: true },   // Chasing defender
          white_7: { x: 60, y: 50, inPool: true },
        };
        return { whitePos, bluePos, ball: { x: 32, y: 38 } };
      }
    },

    'counter-5on4': {
      view: 'full',
      i18nKey: 'tactic_counter_5on4',
      name: 'Αντεπίθεση (5-on-4)',
      apply: () => {
        const bluePos = {
          blue_1: { x: 88, y: 50, inPool: true }, // GK Right
          blue_2: { x: 23, y: 20, inPool: true }, // Wing right
          blue_3: { x: 34, y: 34, inPool: true }, // Flat right
          blue_4: { x: 38, y: 50, inPool: true }, // Point / center with ball
          blue_5: { x: 34, y: 66, inPool: true }, // Flat left
          blue_6: { x: 23, y: 80, inPool: true }, // Wing left
          blue_7: { x: 56, y: 50, inPool: true }, // Trailing attacker
        };
        const whitePos = {
          white_1: { x: 14.5, y: 50, inPool: true }, // GK Left
          white_2: { x: 22, y: 30, inPool: true },   // Box defense low right
          white_3: { x: 30, y: 38, inPool: true },   // Box defense high right
          white_4: { x: 30, y: 62, inPool: true },   // Box defense high left
          white_5: { x: 22, y: 70, inPool: true },   // Box defense low left
          white_6: { x: 44, y: 50, inPool: true },   // Chasing defender
          white_7: { x: 60, y: 50, inPool: true },
        };
        return { whitePos, bluePos, ball: { x: 37, y: 50 } };
      }
    },

    'counter-6on5': {
      view: 'full',
      i18nKey: 'tactic_counter_6on5',
      name: 'Αντεπίθεση (6-on-5)',
      apply: () => {
        const bluePos = {
          blue_1: { x: 88, y: 50, inPool: true }, // GK Right
          blue_2: { x: 23, y: 20, inPool: true }, // Wing right at 2m
          blue_3: { x: 35, y: 32, inPool: true }, // Flat right
          blue_4: { x: 40, y: 50, inPool: true }, // Point with ball
          blue_5: { x: 35, y: 68, inPool: true }, // Flat left
          blue_6: { x: 23, y: 80, inPool: true }, // Wing left at 2m
          blue_7: { x: 21, y: 50, inPool: true }, // Post at 2m
        };
        const whitePos = {
          white_1: { x: 14.5, y: 50, inPool: true }, // GK Left
          white_2: { x: 23, y: 28, inPool: true },   // Defending wing right
          white_3: { x: 31, y: 38, inPool: true },   // Defending flat right
          white_4: { x: 19, y: 50, inPool: true },   // Hole guard on blue 7
          white_5: { x: 31, y: 62, inPool: true },   // Defending flat left
          white_6: { x: 23, y: 72, inPool: true },   // Defending wing left
          white_7: { x: 52, y: 50, inPool: true },   // 6th defender trailing behind
        };
        return { whitePos, bluePos, ball: { x: 39, y: 50 } };
      }
    },

    'defense-mandown': {
      view: 'half',
      i18nKey: 'tactic_mandown',
      name: 'Παίκτης Λιγότερο (Άμυνα 5)',
      apply: () => {
        // Blue attacking 6-on-5 towards top goal
        const bluePos = {
          blue_1: { x: 0, y: 0, inPool: false },
          blue_2: { x: 15, y: 23, inPool: true },
          blue_3: { x: 28, y: 44, inPool: true },
          blue_4: { x: 50, y: 55, inPool: true },
          blue_5: { x: 72, y: 44, inPool: true },
          blue_6: { x: 85, y: 23, inPool: true },
          blue_7: { x: 50, y: 20, inPool: true },
        };
        // White defending in 5-man box/triangle (White 7 excluded in EXP box at top-left)
        const whitePos = {
          white_1: { x: 50, y: 9, inPool: true },   // GK
          white_2: { x: 30, y: 22, inPool: true },  // Def 1
          white_3: { x: 38, y: 38, inPool: true },  // Def 2
          white_4: { x: 50, y: 16, inPool: true },  // Center blocker in front of goal
          white_5: { x: 62, y: 38, inPool: true },  // Def 4
          white_6: { x: 70, y: 22, inPool: true },  // Def 5
          white_7: { x: 6.8, y: 6.5, inPool: true }, // Excluded player in EXP box above goal line
        };
        return { whitePos, bluePos, ball: { x: 28, y: 44 } };
      }
    }
  };

  function applyPreset(presetKey) {
    if (state.isPlaying) stopPlayback();
    const preset = PRESET_TACTICS[presetKey];
    if (!preset) return;

    state.selectedCustomTacticId = null;
    if (el.deleteCustomPresetBtn) el.deleteCustomPresetBtn.classList.add('hidden');

    setView(preset.view, true);

    const res = preset.apply();

    // Apply White positions
    Object.keys(res.whitePos).forEach(id => {
      const t = state.tokens.find(tok => tok.id === id);
      if (t) {
        t.x = res.whitePos[id].x;
        t.y = res.whitePos[id].y;
        t.inPool = res.whitePos[id].inPool;
      }
    });

    // Apply Blue positions
    Object.keys(res.bluePos).forEach(id => {
      const t = state.tokens.find(tok => tok.id === id);
      if (t) {
        t.x = res.bluePos[id].x;
        t.y = res.bluePos[id].y;
        t.inPool = res.bluePos[id].inPool;
      }
    });

    // Apply Ball and snap/attach to nearest attacker
    const b = state.tokens.find(tok => tok.id === 'ball');
    if (b && res.ball) {
      b.x = res.ball.x;
      b.y = res.ball.y;
      b.inPool = true;
      let nearestAttacker = null;
      let minD = Infinity;
      state.tokens.forEach(tok => {
        if (isAttackPlayer(tok) && tok.inPool) {
          const d = Math.hypot(tok.x - b.x, tok.y - b.y);
          if (d < minD) {
            minD = d;
            nearestAttacker = tok;
          }
        }
      });
      if (nearestAttacker && minD < 12) {
        b.attachedTo = nearestAttacker.id;
        b.x = nearestAttacker.x + 3.2;
        b.y = nearestAttacker.y - 1.8;
      }
    }

    // Reset drawings for clean tactical diagram
    state.drawingPaths = [];
    redrawCanvas();

    renderTokens(false);
    renderTray();

    // Reset timeline to a clean 1st frame with this preset's view & positions!
    state.currentFrameIndex = 0;
    state.frames = [
      {
        id: 'frame_1',
        name: `${t('frame_label')} 1`,
        tokenPositions: captureCurrentTokenPositions(),
        drawings: [],
        view: preset.view
      }
    ];
    renderTimeline();

    showToast(t('toast_applied', { name: t(preset.i18nKey) }));
  }

  // --- Custom Tactics Dropdown Management (localStorage) ---
  const CUSTOM_TACTICS_STORAGE_KEY = 'wptb_custom_tactics_v1';

  function loadCustomTacticsFromStorage() {
    try {
      const raw = safeGetItem(CUSTOM_TACTICS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          state.customTactics = parsed;
        }
      }
    } catch (e) {
      state.customTactics = [];
    }
    renderCustomTacticsDropdown(state.selectedCustomTacticId);
  }

  function saveCustomTacticsToStorage() {
    try {
      safeSetItem(CUSTOM_TACTICS_STORAGE_KEY, JSON.stringify(state.customTactics));
    } catch (e) {}
  }

  function renderCustomTacticsDropdown(selectedId = null) {
    if (!el.customTacticsGroup || !el.presetSelect) return;
    el.customTacticsGroup.innerHTML = '';
    el.customTacticsGroup.label = t('group_custom');

    if (!state.customTactics || state.customTactics.length === 0) {
      el.customTacticsGroup.style.display = 'none';
      if (el.customTacticsGroup.parentNode) {
        el.customTacticsGroup.parentNode.removeChild(el.customTacticsGroup);
      }
      state.selectedCustomTacticId = null;
      if (el.deleteCustomPresetBtn) el.deleteCustomPresetBtn.classList.add('hidden');
      return;
    }

    if (!el.customTacticsGroup.parentNode) {
      const firstGroup = el.presetSelect.querySelector('optgroup');
      if (firstGroup) {
        el.presetSelect.insertBefore(el.customTacticsGroup, firstGroup);
      } else {
        el.presetSelect.appendChild(el.customTacticsGroup);
      }
    }
    el.customTacticsGroup.style.display = '';
    state.customTactics.forEach(item => {
      const opt = document.createElement('option');
      opt.value = `custom:${item.id}`;
      const framesCount = (item.frames && item.frames.length) || 1;
      const viewTag = item.view === 'full' ? '🏟️' : '📐';
      opt.textContent = `${viewTag} ${item.title} (${framesCount} ${t('frame_label')})`;
      el.customTacticsGroup.appendChild(opt);
    });

    if (selectedId && state.customTactics.some(c => c.id === selectedId)) {
      state.selectedCustomTacticId = selectedId;
      el.presetSelect.value = `custom:${selectedId}`;
      if (el.deleteCustomPresetBtn) el.deleteCustomPresetBtn.classList.remove('hidden');
    } else {
      state.selectedCustomTacticId = null;
      if (el.deleteCustomPresetBtn) el.deleteCustomPresetBtn.classList.add('hidden');
    }
  }

  function upsertCustomTactic(title, view, frames) {
    const cleanTitle = (title || 'Custom Τακτική').trim();
    const clonedFrames = JSON.parse(JSON.stringify(frames || []));
    const existing = state.customTactics.find(
      c => c.title.toLowerCase() === cleanTitle.toLowerCase()
    );

    let targetId;
    let targetItem;
    const currentTeams = state.teams ? JSON.parse(JSON.stringify(state.teams)) : null;
    if (existing) {
      existing.title = cleanTitle;
      existing.view = view || state.view;
      existing.frames = clonedFrames;
      existing.teams = currentTeams;
      existing.date = new Date().toISOString();
      targetId = existing.id;
      targetItem = existing;
    } else {
      targetId = `custom_${Date.now()}`;
      targetItem = {
        id: targetId,
        title: cleanTitle,
        view: view || state.view,
        frames: clonedFrames,
        teams: currentTeams,
        date: new Date().toISOString()
      };
      state.customTactics.unshift(targetItem);
    }

    saveCustomTacticsToStorage();
    renderCustomTacticsDropdown(targetId);

    // Sync to Cloud Firestore if connected
    if (window.CloudSync && typeof window.CloudSync.saveTactic === 'function') {
      window.CloudSync.saveTactic(targetItem);
    }

    return targetId;
  }

  function applyCustomTactic(customId) {
    const item = state.customTactics.find(c => c.id === customId);
    if (!item || !item.frames || item.frames.length === 0) return;

    if (state.isPlaying) stopPlayback();

    const targetView = item.view || item.frames[0].view || 'half';
    state.frames = JSON.parse(JSON.stringify(item.frames));
    state.currentTacticTitle = item.title;
    state.selectedCustomTacticId = item.id;

    if (item.teams) {
      state.teams = JSON.parse(JSON.stringify(item.teams));
      if (state.teams.attack && state.teams.attack.color) {
        safeSetItem('wptb_team_attack_color', state.teams.attack.color);
      }
      if (state.teams.defense && state.teams.defense.color) {
        safeSetItem('wptb_team_defense_color', state.teams.defense.color);
      }
      updateTeamColorsUI();
    }

    setView(targetView, true);
    selectFrame(0, true);
    renderCustomTacticsDropdown(item.id);

    showToast(t('toast_applied', { name: item.title }));
  }

  function saveCurrentAsCustomPreset() {
    if (state.isPlaying) stopPlayback();
    saveCurrentFrameState();

    const defaultName = state.currentTacticTitle || `Τακτική ${state.customTactics.length + 1}`;
    const inputName = prompt(t('prompt_tactic_name'), defaultName);
    if (!inputName || !inputName.trim()) return;

    const cleanTitle = inputName.trim();
    state.currentTacticTitle = cleanTitle;

    upsertCustomTactic(cleanTitle, state.view, state.frames);
    showToast(t('toast_custom_saved', { name: cleanTitle }));
  }

  function deleteSelectedCustomPreset() {
    if (!state.selectedCustomTacticId) return;
    const item = state.customTactics.find(c => c.id === state.selectedCustomTacticId);
    if (!item) return;

    if (!confirm(t('confirm_delete_custom', { name: item.title }))) return;

    const delId = state.selectedCustomTacticId;
    state.customTactics = state.customTactics.filter(c => c.id !== state.selectedCustomTacticId);
    state.selectedCustomTacticId = null;
    saveCustomTacticsToStorage();
    renderCustomTacticsDropdown(null);
    el.presetSelect.value = '';
    showToast(t('toast_custom_deleted'));

    // Remove from Cloud Firestore if connected
    if (window.CloudSync && typeof window.CloudSync.deleteTactic === 'function') {
      window.CloudSync.deleteTactic(delId);
    }
  }

  // --- View Switcher (Half vs Full) ---
  function updateModeButtonsForView() {
    const isFull = state.view === 'full';
    const angleBtn = document.getElementById('modeAngleBtn');
    if (angleBtn) {
      angleBtn.classList.toggle('disabled', isFull);
      if (isFull) {
        angleBtn.setAttribute('aria-disabled', 'true');
        angleBtn.title = t('toast_angle_half_only');
      } else {
        angleBtn.removeAttribute('aria-disabled');
        angleBtn.title = t('mode_angle');
      }
    }
  }

  function setView(viewMode, skipSaveFrame = false) {
    if (state.view === viewMode && !skipSaveFrame) return;
    const oldView = state.view;
    state.view = viewMode;
    el.viewHalfBtn.classList.toggle('active', viewMode === 'half');
    el.viewFullBtn.classList.toggle('active', viewMode === 'full');

    // In Full Pool, Shot Analysis is disabled: switch back to Select/Move mode automatically!
    if (viewMode === 'full' && state.mode === 'angle') {
      state.mode = 'select';
      el.modeBtns.forEach(b => {
        b.classList.toggle('active', b.dataset.mode === 'select');
      });
      el.poolBoard.classList.remove('is-drawing-mode');
      if (el.shootingAnalysisHud) el.shootingAnalysisHud.classList.add('hidden');
      if (el.shootingAngleSvg) el.shootingAngleSvg.innerHTML = '';
      document.querySelectorAll('.token.is-shooter, .token.is-blocker').forEach(t => t.classList.remove('is-shooter', 'is-blocker'));
    }
    updateModeButtonsForView();

    // If user clicked to change view, reposition all players to the standard setup for that view!
    if (!skipSaveFrame && oldView !== viewMode) {
      state.drawingPaths = [];
      state.currentTacticTitle = '';
      state.selectedCustomTacticId = null;
      if (el.presetSelect) el.presetSelect.value = '';
      if (el.deleteCustomPresetBtn) el.deleteCustomPresetBtn.classList.add('hidden');
      initDefaultTokens();
      renderPitchSvg();
      renderTokens(false);
      renderTray();
      updateBallsPaletteUI();
      renderTimeline();
      redrawCanvas();
      if (state.mode === 'angle') renderShootingAnalysis();
      showToast(viewMode === 'full' ? t('view_full') : t('view_half'));
      return;
    }

    // Synchronize ALL frames with the chosen view mode (used when applying presets or loading tactics)
    state.frames.forEach(f => {
      f.view = viewMode;
    });

    renderPitchSvg();
    renderTokens(false);
    renderTray();
    if (state.mode === 'angle') renderShootingAnalysis();
    if (!skipSaveFrame) {
      updateCurrentFramePositions();
    }
  }

  // --- PNG Metadata Injection & Extraction for Smart Image Save/Load ---
  const CRC_TABLE = (function() {
    const table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function computeCrc32(uint8Array) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < uint8Array.length; i++) {
      crc = CRC_TABLE[(crc ^ uint8Array[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function injectTacticMetadataToPng(pngDataUrl, tacticData) {
    try {
      const base64Str = pngDataUrl.split(',')[1];
      const binaryStr = atob(base64Str);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) {
        return pngDataUrl;
      }

      let iendIndex = -1;
      for (let i = bytes.length - 12; i >= 8; i--) {
        if (bytes[i] === 0x49 && bytes[i+1] === 0x45 && bytes[i+2] === 0x4E && bytes[i+3] === 0x44) {
          iendIndex = i - 4;
          break;
        }
      }
      if (iendIndex === -1) iendIndex = bytes.length - 12;

      const keyword = "WPTB_TACTIC\0";
      const jsonStr = JSON.stringify(tacticData);
      const encoder = new TextEncoder();
      const keywordBytes = encoder.encode(keyword);
      const jsonBytes = encoder.encode(jsonStr);

      const payload = new Uint8Array(keywordBytes.length + jsonBytes.length);
      payload.set(keywordBytes, 0);
      payload.set(jsonBytes, keywordBytes.length);

      const chunkType = new Uint8Array([0x74, 0x45, 0x58, 0x74]); // 'tEXt'
      const crcBuffer = new Uint8Array(4 + payload.length);
      crcBuffer.set(chunkType, 0);
      crcBuffer.set(payload, 4);
      const crc = computeCrc32(crcBuffer);

      const chunkLen = payload.length;
      const newPng = new Uint8Array(bytes.length + 12 + chunkLen);
      newPng.set(bytes.subarray(0, iendIndex), 0);

      let p = iendIndex;
      newPng[p++] = (chunkLen >>> 24) & 0xFF;
      newPng[p++] = (chunkLen >>> 16) & 0xFF;
      newPng[p++] = (chunkLen >>> 8) & 0xFF;
      newPng[p++] = chunkLen & 0xFF;

      newPng.set(chunkType, p); p += 4;
      newPng.set(payload, p); p += payload.length;

      newPng[p++] = (crc >>> 24) & 0xFF;
      newPng[p++] = (crc >>> 16) & 0xFF;
      newPng[p++] = (crc >>> 8) & 0xFF;
      newPng[p++] = crc & 0xFF;

      newPng.set(bytes.subarray(iendIndex), p);

      let binary = '';
      const step = 8192;
      for (let i = 0; i < newPng.length; i += step) {
        binary += String.fromCharCode.apply(null, newPng.subarray(i, i + step));
      }
      return 'data:image/png;base64,' + btoa(binary);
    } catch (err) {
      console.warn('PNG metadata injection error:', err);
      return pngDataUrl;
    }
  }

  function extractTacticFromPngBuffer(arrayBuffer) {
    try {
      const bytes = new Uint8Array(arrayBuffer);
      if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) {
        return null;
      }

      let pos = 8;
      const decoder = new TextDecoder('utf-8');
      while (pos < bytes.length - 12) {
        const len = (bytes[pos] << 24) | (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3];
        const type = String.fromCharCode(bytes[pos+4], bytes[pos+5], bytes[pos+6], bytes[pos+7]);

        if (type === 'tEXt') {
          const data = bytes.subarray(pos + 8, pos + 8 + len);
          const str = decoder.decode(data);
          if (str.startsWith("WPTB_TACTIC\0")) {
            const jsonPart = str.substring("WPTB_TACTIC\0".length);
            return JSON.parse(jsonPart);
          }
        }
        pos += 12 + len;
      }

      const fullText = decoder.decode(bytes);
      const markerIdx = fullText.indexOf("WPTB_TACTIC\0");
      if (markerIdx !== -1) {
        const jsonPart = fullText.substring(markerIdx + "WPTB_TACTIC\0".length);
        const lastBrace = jsonPart.lastIndexOf('}');
        if (lastBrace !== -1) {
          return JSON.parse(jsonPart.substring(0, lastBrace + 1));
        }
      }
    } catch (e) {
      console.warn('Error extracting tactic from PNG:', e);
    }
    return null;
  }

  // --- Export to PNG High Resolution ---
  function exportBoardAsImage() {
    showToast(t('toast_exporting'));

    const rect = el.poolBoard.getBoundingClientRect();
    const exportCanvas = document.createElement('canvas');
    const scale = 2; // High-res 2x
    exportCanvas.width = rect.width * scale;
    exportCanvas.height = rect.height * scale;
    const eCtx = exportCanvas.getContext('2d');
    eCtx.scale(scale, scale);

    // 1. Draw SVG Pitch to canvas
    const svgXml = new XMLSerializer().serializeToString(el.svgPitch);
    const svgBlob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
    const URL = window.URL || window.webkitURL || window;
    const blobUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      eCtx.drawImage(img, 0, 0, rect.width, rect.height);
      URL.revokeObjectURL(blobUrl);

      // 2. Draw user drawings
      eCtx.drawImage(el.canvas, 0, 0, rect.width, rect.height);

      // 3. Draw Tokens (Players & Ball)
      const tokenPromises = [];
      state.tokens.forEach(tok => {
        if (!tok.inPool) return;
        const p = new Promise(resolve => {
          const tSvg = tok.type === 'ball' ? getBallSvg(tok.color || 'yellow') : getCapSvg(tok.team, tok.number, tok.isGK);
          const tBlob = new Blob([tSvg], { type: 'image/svg+xml;charset=utf-8' });
          const tUrl = URL.createObjectURL(tBlob);
          const tImg = new Image();
          tImg.onload = () => {
            const baseCapSize = (state.settings && state.settings.capSize === 'large') ? 54 : 44;
            const size = tok.type === 'ball' ? Math.round(baseCapSize / 2) : baseCapSize;
            const x = (tok.x / 100) * rect.width - size / 2;
            const y = (tok.y / 100) * rect.height - size / 2;
            eCtx.drawImage(tImg, x, y, size, size);
            URL.revokeObjectURL(tUrl);
            resolve();
          };
          tImg.src = tUrl;
        });
        tokenPromises.push(p);
      });

      Promise.all(tokenPromises).then(async () => {
        const dateStr = new Date().toISOString().slice(0, 10);
        const defaultName = state.currentTacticTitle || `Τακτική_${dateStr}`;
        const inputName = prompt(t('prompt_image_name'), defaultName);
        if (!inputName || !inputName.trim()) {
          return; // User cancelled
        }
        const cleanTitle = inputName.trim();
        let fileName = cleanTitle;
        if (!fileName.toLowerCase().endsWith('.png')) {
          fileName += '.png';
        }

        // Download Image
        let dataUrl = exportCanvas.toDataURL('image/png');

        // Embed the current tactical data inside the PNG metadata
        const currentTacticData = {
          version: '1.2',
          title: cleanTitle,
          date: new Date().toISOString(),
          view: state.view,
          frames: state.frames,
          teams: state.teams ? JSON.parse(JSON.stringify(state.teams)) : null,
        };
        dataUrl = injectTacticMetadataToPng(dataUrl, currentTacticData);

        // Android App
        if (window.AndroidApp && typeof window.AndroidApp.saveImage === 'function') {
          window.AndroidApp.saveImage(dataUrl, fileName);
          return;
        }

        // Apple iOS / macOS Native App (WKWebView)
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.wptb) {
          window.webkit.messageHandlers.wptb.postMessage({
            action: 'saveImage',
            dataUrl: dataUrl,
            fileName: fileName
          });
          return;
        }

        // Windows / Desktop / Web with File System Access API
        if (window.showSaveFilePicker) {
          try {
            const base64Str = dataUrl.split(',')[1];
            const binaryStr = atob(base64Str);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            const blob = new Blob([bytes], { type: 'image/png' });

            const handle = await window.showSaveFilePicker({
              suggestedName: fileName,
              types: [{
                description: 'Εικόνα Τακτικής Πόλο (*.png)',
                accept: { 'image/png': ['.png'] }
              }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            showToast(t('toast_exported') + ` (${handle.name})`);
            return;
          } catch (err) {
            if (err.name === 'AbortError') return; // User cancelled
          }
        }

        // Fallback standard browser download
        const link = document.createElement('a');
        link.download = fileName;
        link.href = dataUrl;
        link.click();
        showToast(t('toast_exported') + ` (${fileName})`);
      });
    };
    img.src = blobUrl;
  }

  // --- Save / Load Tactic Data (JSON & PNG Smart Load) ---
  async function saveTacticToFile() {
    if (state.isPlaying) stopPlayback();
    saveCurrentFrameState();

    const dateStr = new Date().toISOString().slice(0, 10);
    const defaultName = state.currentTacticTitle || `Τακτική_${dateStr}`;
    const inputName = prompt(t('prompt_tactic_name'), defaultName);
    if (!inputName || !inputName.trim()) {
      return; // User cancelled
    }
    const cleanTitle = inputName.trim();
    state.currentTacticTitle = cleanTitle;

    // Also add/update this custom tactic in the dropdown list!
    upsertCustomTactic(cleanTitle, state.view, state.frames);

    let fileName = cleanTitle;
    if (!fileName.toLowerCase().endsWith('.json')) {
      fileName += '.json';
    }

    const tacticData = {
      version: '1.2',
      title: cleanTitle,
      date: new Date().toISOString(),
      view: state.view,
      frames: state.frames,
      teams: state.teams ? JSON.parse(JSON.stringify(state.teams)) : null,
    };

    const jsonString = JSON.stringify(tacticData, null, 2);

    // If running in Android App
    if (window.AndroidApp && typeof window.AndroidApp.saveJson === 'function') {
      window.AndroidApp.saveJson(jsonString, fileName);
      return;
    }

    // If running in Apple iOS / macOS Native App (WKWebView)
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.wptb) {
      window.webkit.messageHandlers.wptb.postMessage({
        action: 'saveJson',
        jsonContent: jsonString,
        fileName: fileName
      });
      return;
    }

    // Windows Desktop / Browser with File System Access API
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'Αρχείο Τακτικής Πόλο (*.json)',
            accept: { 'application/json': ['.json'] }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(jsonString);
        await writable.close();
        showToast(t('toast_saved') + ` (${handle.name})`);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // User closed picker
      }
    }

    // Fallback standard browser download
    const blob = new Blob([jsonString], { type: 'application/json' });
    const blobUrl = URL.createObjectURL(blob);
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', blobUrl);
    dlAnchor.setAttribute('download', fileName);
    dlAnchor.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    showToast(t('toast_saved') + ` (${fileName})`);
  }

  // --- Share Tactic via Android Native Share Sheet or Web Share ---
  async function shareCurrentTactic() {
    if (state.isPlaying) stopPlayback();
    saveCurrentFrameState();

    const dateStr = new Date().toISOString().slice(0, 10);
    const defaultName = state.currentTacticTitle || `Τακτική_${dateStr}`;
    const inputName = prompt(t('prompt_share_name') || t('prompt_tactic_name'), defaultName);
    if (!inputName || !inputName.trim()) {
      return; // User cancelled
    }
    const cleanTitle = inputName.trim();
    state.currentTacticTitle = cleanTitle;

    upsertCustomTactic(cleanTitle, state.view, state.frames);

    let fileName = cleanTitle;
    if (!fileName.toLowerCase().endsWith('.json')) {
      fileName += '.json';
    }

    const tacticData = {
      version: '1.2',
      title: cleanTitle,
      date: new Date().toISOString(),
      view: state.view,
      frames: state.frames,
      teams: state.teams ? JSON.parse(JSON.stringify(state.teams)) : null,
    };

    const jsonString = JSON.stringify(tacticData, null, 2);

    // If running in Android App (calls native Android Share Sheet)
    if (window.AndroidApp && typeof window.AndroidApp.shareTactic === 'function') {
      window.AndroidApp.shareTactic(jsonString, fileName, cleanTitle);
      showToast(t('toast_sharing') || 'Άνοιγμα κοινοποίησης...');
      return;
    }

    // Modern Web Share API fallback
    if (navigator.share) {
      try {
        const file = new File([jsonString], fileName, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: cleanTitle,
            text: `Τακτική Πόλο: ${cleanTitle}`,
            files: [file]
          });
          return;
        } else {
          await navigator.share({
            title: cleanTitle,
            text: `Τακτική Πόλο: ${cleanTitle}\n\n${jsonString}`
          });
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    // Fallback if sharing not available: save file
    saveTacticToFile();
  }

  function loadTacticFromFile(file) {
    if (!file) return;
    if (state.isPlaying) stopPlayback();

    // Check if user selected an image file
    const isImage = file.type && (file.type.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(file.name));

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const tacticData = extractTacticFromPngBuffer(e.target.result);
        if (tacticData && tacticData.frames && tacticData.frames.length > 0) {
          const data = tacticData;
          const targetView = data.view || data.frames[0].view || 'half';
          const loadedTitle = data.title || file.name.replace(/\.[^/.]+$/, '');
          state.frames = JSON.parse(JSON.stringify(data.frames));
          state.currentTacticTitle = loadedTitle;
          const loadedTeams = data.teams || data.customTeams;
          if (loadedTeams) {
            state.teams = JSON.parse(JSON.stringify(loadedTeams));
            if (state.teams.attack && state.teams.attack.color) {
              safeSetItem('wptb_team_attack_color', state.teams.attack.color);
            }
            if (state.teams.defense && state.teams.defense.color) {
              safeSetItem('wptb_team_defense_color', state.teams.defense.color);
            }
            updateTeamColorsUI();
          }
          setView(targetView, true);
          selectFrame(0, true);
          upsertCustomTactic(loadedTitle, targetView, state.frames);
          showToast(t('toast_loaded'));
        } else {
          // It's a plain image / screenshot without tactic metadata
          alert(
            "ℹ️ Το αρχείο που επιλέξατε είναι απλή φωτογραφία (" + file.name + ") και δεν περιέχει αποθηκευμένα δεδομένα τακτικής.\n\n" +
            "💡 Πώς να αποθηκεύσετε & να φορτώσετε συστήματα:\n" +
            "1. Χρησιμοποιήστε το κουμπί «💾 Αποθήκευση» για να σώσετε την τακτική σε αρχείο .json.\n" +
            "2. Ή χρησιμοποιήστε εικόνες PNG που έχετε αποθηκεύσει από αυτή την εφαρμογή με το «📸 Αποθήκευση Εικόνας»."
          );
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // Otherwise try parsing as JSON tactic file
    const textReader = new FileReader();
    textReader.onload = (e) => {
      try {
        const text = e.target.result;
        // In case an image was loaded as text:
        if (text.startsWith('\x89PNG') || text.startsWith('GIF8') || text.includes('\u0000')) {
          alert(
            "ℹ️ Το αρχείο αυτό είναι απλή εικόνα και δεν περιέχει δεδομένα τακτικής.\n\n" +
            "👉 Παρακαλούμε επιλέξτε το αρχείο τακτικής (.json) που αποθηκεύσατε με το κουμπί «💾 Αποθήκευση»."
          );
          return;
        }

        const data = JSON.parse(text);
        if (data.frames && data.frames.length > 0) {
          const targetView = data.view || data.frames[0].view || 'half';
          const loadedTitle = data.title || file.name.replace(/\.[^/.]+$/, '');
          state.frames = JSON.parse(JSON.stringify(data.frames));
          state.currentTacticTitle = loadedTitle;
          const loadedTeams = data.teams || data.customTeams;
          if (loadedTeams) {
            state.teams = JSON.parse(JSON.stringify(loadedTeams));
            if (state.teams.attack && state.teams.attack.color) {
              safeSetItem('wptb_team_attack_color', state.teams.attack.color);
            }
            if (state.teams.defense && state.teams.defense.color) {
              safeSetItem('wptb_team_defense_color', state.teams.defense.color);
            }
            updateTeamColorsUI();
          }
          setView(targetView, true);
          selectFrame(0, true);
          upsertCustomTactic(loadedTitle, targetView, state.frames);
          showToast(t('toast_loaded'));
        } else {
          throw new Error('No frames');
        }
      } catch (err) {
        alert(
          "⚠️ Δεν ήταν δυνατή η ανάγνωση του αρχείου τακτικής.\n\n" +
          "Βεβαιωθείτε ότι επιλέξατε ένα έγκυρο αρχείο τακτικής (.json) που αποθηκεύσατε από το κουμπί «💾 Αποθήκευση»."
        );
      }
    };
    textReader.readAsText(file);
  }

  // --- Event Listeners Initialization ---
  function initEvents() {
    // Sidebar Collapse / Expand Controls
    if (el.toggleSidebarBtn) {
      el.toggleSidebarBtn.addEventListener('click', toggleSidebar);
    }
    if (el.closeSidebarBtn) {
      el.closeSidebarBtn.addEventListener('click', () => {
        setSidebarCollapsed(true);
        triggerHaptic(25);
      });
    }
    if (el.floatingOpenSidebarBtn) {
      el.floatingOpenSidebarBtn.addEventListener('click', () => {
        setSidebarCollapsed(false);
        triggerHaptic(25);
      });
    }

    // Bottom Animation Bar Collapse / Expand Controls
    if (el.closeBottomBarBtn) {
      el.closeBottomBarBtn.addEventListener('click', () => {
        setBottomBarCollapsed(true);
        triggerHaptic(25);
      });
    }
    if (el.floatingOpenBottomBtn) {
      el.floatingOpenBottomBtn.addEventListener('click', () => {
        setBottomBarCollapsed(false);
        triggerHaptic(25);
      });
    }

    // Auto-Resize Canvas on board container dimension changes
    if (window.ResizeObserver && el.poolBoard) {
      const poolObserver = new ResizeObserver(() => {
        resizeCanvas();
      });
      poolObserver.observe(el.poolBoard);
    }

    // Collapsible Sidebar Sections (Accordion with Arrow)
    document.querySelectorAll('.tool-section.collapsible').forEach(sec => {
      const header = sec.querySelector('.tool-section-header');
      if (header) {
        header.addEventListener('click', () => {
          sec.classList.toggle('collapsed');
          triggerHaptic(20);
        });
      }
    });

    // View Switchers
    el.viewHalfBtn.addEventListener('click', () => setView('half'));
    el.viewFullBtn.addEventListener('click', () => setView('full'));

    // Modes (Select vs Draw vs Arrows vs Angle)
    el.modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === 'angle' && state.view === 'full') {
          showToast(t('toast_angle_half_only'));
          return;
        }
        el.modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.mode;

        const isDrawing = (state.mode !== 'select' && state.mode !== 'angle');
        el.poolBoard.classList.toggle('is-drawing-mode', isDrawing);

        // Automatically expand Drawing Options when entering drawing modes
        if (isDrawing) {
          const drawOpt = document.getElementById('drawingOptions');
          if (drawOpt && drawOpt.classList.contains('collapsed')) {
            drawOpt.classList.remove('collapsed');
          }
        }

        if (state.mode === 'angle') {
          if (el.shootingAnalysisHud) el.shootingAnalysisHud.classList.remove('hidden');
          renderShootingAnalysis();
        } else {
          if (el.shootingAnalysisHud) el.shootingAnalysisHud.classList.add('hidden');
          if (el.shootingAngleSvg) el.shootingAngleSvg.innerHTML = '';
          document.querySelectorAll('.token.is-shooter, .token.is-blocker').forEach(t => t.classList.remove('is-shooter', 'is-blocker'));
        }
      });
    });

    if (el.closeAngleHudBtn) {
      el.closeAngleHudBtn.addEventListener('click', () => {
        const selectBtn = document.querySelector('.mode-btn[data-mode="select"]');
        if (selectBtn) selectBtn.click();
      });
    }

    if (el.minimizeAngleHudBtn && el.shootingAnalysisHud) {
      el.minimizeAngleHudBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isMin = el.shootingAnalysisHud.classList.toggle('is-minimized');
        el.minimizeAngleHudBtn.textContent = isMin ? '▲' : '—';
        el.minimizeAngleHudBtn.title = isMin ? 'Ανάπτυξη' : 'Ελαχιστοποίηση';
      });
    }

    // Draggable Shooting Analysis HUD
    let isDraggingHud = false;
    let hudStartX = 0, hudStartY = 0, hudInitialLeft = 0, hudInitialTop = 0;

    if (el.angleHudHeader && el.shootingAnalysisHud && el.poolBoard) {
      const onHudPointerDown = (e) => {
        if (e.target.closest('.angle-hud-btn')) return;
        isDraggingHud = true;
        const boardRect = el.poolBoard.getBoundingClientRect();
        const hudRect = el.shootingAnalysisHud.getBoundingClientRect();
        
        hudStartX = e.clientX;
        hudStartY = e.clientY;
        hudInitialLeft = hudRect.left - boardRect.left;
        hudInitialTop = hudRect.top - boardRect.top;
        
        el.shootingAnalysisHud.style.bottom = 'auto';
        el.shootingAnalysisHud.style.right = 'auto';
        el.shootingAnalysisHud.style.left = `${hudInitialLeft}px`;
        el.shootingAnalysisHud.style.top = `${hudInitialTop}px`;
        
        try { el.angleHudHeader.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      };
      
      const onHudPointerMove = (e) => {
        if (!isDraggingHud) return;
        const dx = e.clientX - hudStartX;
        const dy = e.clientY - hudStartY;
        
        const boardRect = el.poolBoard.getBoundingClientRect();
        const hudRect = el.shootingAnalysisHud.getBoundingClientRect();
        
        let newLeft = hudInitialLeft + dx;
        let newTop = hudInitialTop + dy;
        
        newLeft = Math.max(4, Math.min(boardRect.width - hudRect.width - 4, newLeft));
        newTop = Math.max(4, Math.min(boardRect.height - hudRect.height - 4, newTop));
        
        el.shootingAnalysisHud.style.left = `${newLeft}px`;
        el.shootingAnalysisHud.style.top = `${newTop}px`;
      };
      
      const onHudPointerUp = (e) => {
        if (isDraggingHud) {
          isDraggingHud = false;
          try { el.angleHudHeader.releasePointerCapture(e.pointerId); } catch (err) {}
        }
      };
      
      el.angleHudHeader.addEventListener('pointerdown', onHudPointerDown);
      el.angleHudHeader.addEventListener('pointermove', onHudPointerMove);
      el.angleHudHeader.addEventListener('pointerup', onHudPointerUp);
      el.angleHudHeader.addEventListener('pointercancel', onHudPointerUp);
    }

    // Color Swatches
    el.colorSwatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        el.colorSwatches.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        state.currentColor = swatch.dataset.color;
      });
    });

    // Stroke Size
    el.strokeSize.addEventListener('input', (e) => {
      state.strokeWidth = parseInt(e.target.value, 10);
      el.strokeSizeVal.textContent = `${state.strokeWidth}px`;
    });

    // Drawing Actions
    el.undoDrawBtn.addEventListener('click', () => {
      if (state.drawingPaths.length > 0) {
        state.drawingPaths.pop();
        if (state.frames[state.currentFrameIndex]) {
          state.frames[state.currentFrameIndex].drawings = JSON.parse(JSON.stringify(state.drawingPaths));
        }
        redrawCanvas();
        showToast(t('toast_undo'));
      }
    });

    el.clearDrawBtn.addEventListener('click', () => {
      if (confirm(t('confirm_clear_drawings'))) {
        state.drawingPaths = [];
        if (state.frames[state.currentFrameIndex]) {
          state.frames[state.currentFrameIndex].drawings = [];
        }
        redrawCanvas();
        showToast(t('toast_clear_draw'));
      }
    });

    // Language Selector Event
    if (el.langSelect) {
      el.langSelect.value = state.lang;
      el.langSelect.addEventListener('change', (e) => {
        setLanguage(e.target.value);
      });
    }

    // Bench / Roster Tabs
    el.tabTeamWhite.addEventListener('click', () => {
      el.tabTeamWhite.classList.add('active');
      el.tabTeamBlue.classList.remove('active');
      state.currentTeamTab = 'white';
      state.selectedBenchCapId = null;
      renderTray();
    });

    el.tabTeamBlue.addEventListener('click', () => {
      el.tabTeamBlue.classList.add('active');
      el.tabTeamWhite.classList.remove('active');
      state.currentTeamTab = 'blue';
      state.selectedBenchCapId = null;
      renderTray();
    });

    // Add selected benched cap into pool
    if (el.addCapBtn) {
      el.addCapBtn.addEventListener('click', () => {
        let tok = null;
        if (state.selectedBenchCapId) {
          tok = state.tokens.find(t => t.id === state.selectedBenchCapId && !t.inPool);
        }
        if (!tok) {
          const benchCaps = state.tokens.filter(t => t.type === 'cap' && t.team === state.currentTeamTab && !t.inPool);
          if (benchCaps.length === 1) {
            tok = benchCaps[0];
          }
        }
        if (tok) {
          tok.inPool = true;
          tok.x = 45 + (Math.random() * 8 - 4);
          tok.y = 45 + (Math.random() * 8 - 4);
          state.selectedBenchCapId = null;
          renderTokens();
          renderTray();
          updateCurrentFramePositions();
          if (state.mode === 'angle') renderShootingAnalysis();
          triggerHaptic(20);
          showToast(t('toast_cap_entered', { num: tok.number }));
        } else {
          showToast(t('toast_select_bench_cap'));
        }
      });
    }

    // Remove selected pool cap to bench
    if (el.removeCapBtn) {
      el.removeCapBtn.addEventListener('click', () => {
        let tok = null;
        if (state.selectedCapId) {
          tok = state.tokens.find(t => t.id === state.selectedCapId && t.inPool);
        }
        if (tok) {
          benchCap(tok);
          triggerHaptic(20);
        } else {
          showToast(t('toast_select_pool_cap'));
        }
      });
    }

    // Bring all caps into pool (if element present)
    if (el.bringAllCapsBtn) {
      el.bringAllCapsBtn.addEventListener('click', () => {
        state.tokens.forEach(t => {
          if (!t.inPool && t.type === 'cap' && t.team === state.currentTeamTab) {
            t.inPool = true;
            t.x = 20 + Math.random() * 60;
            t.y = 20 + Math.random() * 60;
          }
        });
        renderTokens();
        renderTray();
        updateCurrentFramePositions();
        showToast(t('toast_all_in'));
      });
    }

    // Bench all caps of team
    if (el.benchAllCapsBtn) {
      el.benchAllCapsBtn.addEventListener('click', () => {
        benchAllTeamCaps(state.currentTeamTab);
      });
    }

    // Deselect cap when clicking pool background
    if (el.poolBoard) {
      el.poolBoard.addEventListener('click', (e) => {
        if (!e.target.closest('.token') && !e.target.closest('.token-remove-btn')) {
          if (state.selectedCapId) {
            state.selectedCapId = null;
            renderTokens();
          }
        }
      });
    }

    // Keyboard shortcut (Delete / Backspace) to bench selected cap
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedCapId) {
        const activeTag = document.activeElement ? document.activeElement.tagName : '';
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
        const tok = state.tokens.find(t => t.id === state.selectedCapId);
        if (tok) {
          benchCap(tok);
        }
      }
    });

    // Canvas Pointer Events for drawing
    el.canvas.addEventListener('mousedown', onCanvasPointerDown);
    el.canvas.addEventListener('touchstart', onCanvasPointerDown, { passive: false });

    // Animation Timeline Events
    el.playBtn.addEventListener('click', togglePlayback);
    if (el.fullscreenBtn) {
      el.fullscreenBtn.addEventListener('click', toggleBoardFullscreen);
    }
    if (el.exitFullscreenOverlayBtn) {
      el.exitFullscreenOverlayBtn.addEventListener('click', () => setBoardFullscreen(false));
    }
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && state.isFullscreen) {
        setBoardFullscreen(false);
      } else {
        resizeCanvas();
      }
    });
    el.animSpeedSelect.addEventListener('change', (e) => {
      state.animSpeed = parseFloat(e.target.value);
    });
    el.addFrameBtn.addEventListener('click', addFrame);
    if (el.duplicateFrameBtn) el.duplicateFrameBtn.addEventListener('click', duplicateCurrentFrame);
    el.deleteFrameBtn.addEventListener('click', deleteCurrentFrame);

    // Reset Initial Positions
    el.resetPositionsBtn.addEventListener('click', () => {
      if (confirm(t('confirm_reset_positions'))) {
        if (state.isPlaying) stopPlayback();
        state.drawingPaths = [];
        state.currentTacticTitle = '';
        state.selectedCustomTacticId = null;
        if (el.presetSelect) el.presetSelect.value = '';
        if (el.deleteCustomPresetBtn) el.deleteCustomPresetBtn.classList.add('hidden');
        if (el.tokensLayer) el.tokensLayer.innerHTML = '';
        initDefaultTokens();
        renderTokens(false);
        renderTray();
        updateBallsPaletteUI();
        renderTimeline();
        redrawCanvas();
        showToast(t('toast_reset'));
      }
    });

    // File / Tactics Modal Controls
    const openFileModal = () => {
      if (el.fileModal) el.fileModal.classList.remove('hidden');
    };
    const closeFileModal = () => {
      if (el.fileModal) el.fileModal.classList.add('hidden');
    };

    if (el.fileMenuBtn) el.fileMenuBtn.addEventListener('click', openFileModal);
    if (el.closeFileModalBtn) el.closeFileModalBtn.addEventListener('click', closeFileModal);
    if (el.fileModal) {
      el.fileModal.addEventListener('click', (e) => {
        if (e.target === el.fileModal) closeFileModal();
      });
    }

    // Save, Load & Share (Auto-close modal on click)
    if (el.saveTacticBtn) {
      el.saveTacticBtn.addEventListener('click', () => {
        closeFileModal();
        saveTacticToFile();
      });
    }
    if (el.loadTacticBtn) {
      el.loadTacticBtn.addEventListener('click', () => {
        closeFileModal();
        if (el.tacticFileInput) el.tacticFileInput.click();
      });
    }
    if (el.shareTacticBtn) {
      el.shareTacticBtn.addEventListener('click', () => {
        closeFileModal();
        shareCurrentTactic();
      });
    }

    if (el.tacticFileInput) {
      el.tacticFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          loadTacticFromFile(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    // Presets & Custom Tactics (Instant apply on selection)
    el.presetSelect.addEventListener('change', () => {
      const val = el.presetSelect.value;
      if (!val) {
        state.selectedCustomTacticId = null;
        if (el.deleteCustomPresetBtn) el.deleteCustomPresetBtn.classList.add('hidden');
        return;
      }
      if (val.startsWith('custom:')) {
        const customId = val.replace('custom:', '');
        applyCustomTactic(customId);
      } else {
        applyPreset(val);
        el.presetSelect.value = '';
      }
    });

    if (el.addCustomPresetBtn) {
      el.addCustomPresetBtn.addEventListener('click', saveCurrentAsCustomPreset);
    }
    if (el.deleteCustomPresetBtn) {
      el.deleteCustomPresetBtn.addEventListener('click', deleteSelectedCustomPreset);
    }

    // Settings & About Modal
    const openSettingsModal = () => {
      updateSettingsUI();
      if (el.settingsModal) el.settingsModal.classList.remove('hidden');
    };
    const closeSettingsModal = () => {
      if (el.settingsModal) el.settingsModal.classList.add('hidden');
    };

    if (el.settingsBtn) el.settingsBtn.addEventListener('click', openSettingsModal);
    if (el.aboutBtn) el.aboutBtn.addEventListener('click', openSettingsModal);
    if (el.aboutTrigger) el.aboutTrigger.addEventListener('click', openSettingsModal);
    if (el.closeSettingsModalBtn) el.closeSettingsModalBtn.addEventListener('click', closeSettingsModal);
    if (el.okSettingsModalBtn) el.okSettingsModalBtn.addEventListener('click', closeSettingsModal);
    if (el.closeAboutModalBtn) el.closeAboutModalBtn.addEventListener('click', closeSettingsModal);
    if (el.okAboutModalBtn) el.okAboutModalBtn.addEventListener('click', closeSettingsModal);

    if (el.settingsModal) {
      el.settingsModal.addEventListener('click', (e) => {
        if (e.target === el.settingsModal) closeSettingsModal();
      });
    }

    // --- Interactive Onboarding & Tutorial Modal ---
    const TUTORIAL_STORAGE_KEY = 'wptb_tutorial_seen_v1';
    let currentTutorialStep = 0;
    const TOTAL_TUTORIAL_STEPS = 5;

    function renderTutorialStep(step) {
      window.currentTutorialStep = step;
      if (!el.tutorialModal) return;

      if (el.tutorialStepIndicator) {
        el.tutorialStepIndicator.textContent = t('tutorial_step_count', { cur: step + 1, total: TOTAL_TUTORIAL_STEPS });
      }

      // Dots
      if (el.tutorialDots) {
        const dots = el.tutorialDots.querySelectorAll('.tutorial-dot');
        dots.forEach((dot, idx) => {
          dot.classList.toggle('active', idx === step);
        });
      }

      // Prev / Next / Finish buttons
      if (el.tutorialPrevBtn) {
        el.tutorialPrevBtn.style.display = step > 0 ? '' : 'none';
        el.tutorialPrevBtn.textContent = t('tutorial_btn_prev');
      }
      if (el.tutorialNextBtn) {
        el.tutorialNextBtn.textContent = (step === TOTAL_TUTORIAL_STEPS - 1) ? t('tutorial_btn_finish') : t('tutorial_btn_next');
      }
      if (el.tutorialSkipBtn) {
        el.tutorialSkipBtn.textContent = t('tutorial_btn_skip');
      }

      // Dynamic team roles and colors
      const attackColor = resolveTeamColor('attack');
      const defenseColor = resolveTeamColor('defense');
      const cAttack = CAP_COLORS[attackColor] || CAP_COLORS.blue;
      const cDefense = CAP_COLORS[defenseColor] || CAP_COLORS.white;

      // Content per step
      const icons = [`${cAttack.emoji}${cDefense.emoji}`, '🖐️', '✏️', '🎯', '🎬'];
      if (el.tutorialHeroIcon) el.tutorialHeroIcon.textContent = icons[step] || '🤽‍♂️';

      const titleKey = `tutorial_step${step + 1}_title`;
      const descKey = `tutorial_step${step + 1}_desc`;
      const tParams = {
        attackEmoji: cAttack.emoji,
        attackName: t(cAttack.nameKey),
        defenseEmoji: cDefense.emoji,
        defenseName: t(cDefense.nameKey),
      };
      if (el.tutorialStepTitle) el.tutorialStepTitle.textContent = t(titleKey, tParams);
      if (el.tutorialStepDesc) el.tutorialStepDesc.innerHTML = t(descKey, tParams);

      // Visual graphic per step
      if (el.tutorialVisualCard) {
        if (step === 0) {
          // Step 1: Attack #7, Defense #4, Defense GK #1
          const attackLabel = `${cAttack.emoji} ${t('group_attack')} (${t(cAttack.nameKey)})`;
          const defenseLabel = `${cDefense.emoji} ${t('group_defense')} (${t(cDefense.nameKey)})`;
          el.tutorialVisualCard.innerHTML = `
            <div class="tut-vis-item">
              <div class="tut-vis-cap">${getCapSvg('blue', 7, false)}</div>
              <span class="tut-vis-label" style="color: #38bdf8; font-weight: 700;">${attackLabel}</span>
            </div>
            <div class="tut-vis-item">
              <div class="tut-vis-cap">${getCapSvg('white', 4, false)}</div>
              <span class="tut-vis-label" style="color: #e2e8f0; font-weight: 700;">${defenseLabel}</span>
            </div>
            <div class="tut-vis-item">
              <div class="tut-vis-cap">${getCapSvg('white', 1, true)}</div>
              <span class="tut-vis-label" style="color: #f87171; font-weight: 700;">🧤 GK</span>
            </div>
          `;
        } else if (step === 1) {
          // Step 2: Dragging, bench & double tap
          el.tutorialVisualCard.innerHTML = `
            <div class="tut-vis-badge">${t('tut_badge_drag')}</div>
            <div class="tut-vis-badge">${t('tut_badge_bench')}</div>
            <div class="tut-vis-badge">${t('tut_badge_edit')}</div>
          `;
        } else if (step === 2) {
          // Step 3: Drawing tools
          el.tutorialVisualCard.innerHTML = `
            <div class="tut-vis-badge">${t('tut_badge_lines')}</div>
            <div class="tut-vis-badge">${t('tut_badge_arrows')}</div>
            <div class="tut-vis-badge">${t('tut_badge_passes')}</div>
            <div class="tut-vis-badge">${t('tut_badge_colors')}</div>
          `;
        } else if (step === 3) {
          // Step 4: Shooting angles & blocks
          el.tutorialVisualCard.innerHTML = `
            <div class="tut-vis-item">
              <div class="tut-vis-cap">${getCapSvg('blue', 7, false)}</div>
              <span class="tut-vis-label" style="color: #4ade80;">🎯 ${t('angle_shooter_badge')}</span>
            </div>
            <div style="font-size: 20px; color: #38bdf8;">📏 ➔ 🛡️</div>
            <div class="tut-vis-item">
              <div class="tut-vis-cap" style="filter: drop-shadow(0 0 10px #ef4444);">${getCapSvg('white', 4, false)}</div>
              <span class="tut-vis-label" style="color: #ef4444;">🛡️ ${t('angle_blocker_badge')}</span>
            </div>
          `;
        } else if (step === 4) {
          // Step 5: Animation, Export & Cloud
          el.tutorialVisualCard.innerHTML = `
            <div class="tut-vis-badge">${t('tut_badge_frames')}</div>
            <div class="tut-vis-badge">${t('tut_badge_export')}</div>
            <div class="tut-vis-badge">${t('tut_badge_cloud')}</div>
          `;
        }
      }
    }

    const openTutorial = (step = 0) => {
      currentTutorialStep = Math.max(0, Math.min(TOTAL_TUTORIAL_STEPS - 1, step));
      renderTutorialStep(currentTutorialStep);
      if (el.tutorialModal) el.tutorialModal.classList.remove('hidden');
    };

    const closeTutorial = () => {
      if (el.tutorialModal) el.tutorialModal.classList.add('hidden');
      safeSetItem(TUTORIAL_STORAGE_KEY, 'true');
    };

    if (el.closeTutorialBtn) el.closeTutorialBtn.addEventListener('click', closeTutorial);
    if (el.tutorialSkipBtn) el.tutorialSkipBtn.addEventListener('click', closeTutorial);

    if (el.tutorialPrevBtn) {
      el.tutorialPrevBtn.addEventListener('click', () => {
        if (currentTutorialStep > 0) {
          currentTutorialStep--;
          renderTutorialStep(currentTutorialStep);
        }
      });
    }

    if (el.tutorialNextBtn) {
      el.tutorialNextBtn.addEventListener('click', () => {
        if (currentTutorialStep < TOTAL_TUTORIAL_STEPS - 1) {
          currentTutorialStep++;
          renderTutorialStep(currentTutorialStep);
        } else {
          closeTutorial();
        }
      });
    }

    if (el.tutorialDots) {
      const dots = el.tutorialDots.querySelectorAll('.tutorial-dot');
      dots.forEach((dot, idx) => {
        dot.addEventListener('click', () => {
          currentTutorialStep = idx;
          renderTutorialStep(currentTutorialStep);
        });
      });
    }

    if (el.tutorialModal) {
      el.tutorialModal.addEventListener('click', (e) => {
        if (e.target === el.tutorialModal) closeTutorial();
      });
    }

    if (el.replayTutorialBtn) {
      el.replayTutorialBtn.addEventListener('click', () => {
        closeSettingsModal();
        openTutorial(0);
      });
    }

    window.openTutorial = openTutorial;
    window.closeTutorial = closeTutorial;
    window.renderTutorialStep = renderTutorialStep;

    // Settings Controls
    if (el.themeDarkBtn) {
      el.themeDarkBtn.addEventListener('click', () => {
        state.settings.theme = 'dark';
        applyAllSettings();
        saveSettings();
        triggerHaptic(30);
      });
    }
    if (el.themeLightBtn) {
      el.themeLightBtn.addEventListener('click', () => {
        state.settings.theme = 'light';
        applyAllSettings();
        saveSettings();
        triggerHaptic(30);
      });
    }

    if (el.capSizeNormalBtn) {
      el.capSizeNormalBtn.addEventListener('click', () => {
        state.settings.capSize = 'normal';
        applyAllSettings();
        saveSettings();
        triggerHaptic(30);
      });
    }
    if (el.capSizeLargeBtn) {
      el.capSizeLargeBtn.addEventListener('click', () => {
        state.settings.capSize = 'large';
        applyAllSettings();
        saveSettings();
        triggerHaptic(30);
      });
    }

    if (el.waterDeepBtn) {
      el.waterDeepBtn.addEventListener('click', () => {
        state.settings.waterStyle = 'deep';
        saveSettings();
        updateSettingsUI();
        renderPitchSvg();
        triggerHaptic(30);
      });
    }
    if (el.waterAquaBtn) {
      el.waterAquaBtn.addEventListener('click', () => {
        state.settings.waterStyle = 'aqua';
        saveSettings();
        updateSettingsUI();
        renderPitchSvg();
        triggerHaptic(30);
      });
    }

    if (el.toggle2mBox) {
      el.toggle2mBox.addEventListener('change', (e) => {
        state.settings.show2mBox = e.target.checked;
        saveSettings();
        renderPitchSvg();
        triggerHaptic(20);
      });
    }
    if (el.toggle5m6m) {
      el.toggle5m6m.addEventListener('change', (e) => {
        state.settings.show5m6m = e.target.checked;
        saveSettings();
        renderPitchSvg();
        triggerHaptic(20);
      });
    }
    if (el.toggleWhistle) {
      el.toggleWhistle.addEventListener('change', (e) => {
        state.settings.whistleSound = e.target.checked;
        saveSettings();
        triggerHaptic(20);
        if (e.target.checked) playWhistleSound();
      });
    }
    if (el.toggleHaptics) {
      el.toggleHaptics.addEventListener('change', (e) => {
        state.settings.hapticFeedback = e.target.checked;
        saveSettings();
        if (e.target.checked) triggerHaptic(40);
      });
    }

    // Team Roles & Cap Colors Controls
    if (el.quickTeamsBtn) {
      el.quickTeamsBtn.addEventListener('click', () => {
        openSettingsModal();
        const teamsSec = el.settingsModal ? el.settingsModal.querySelector('#attackColorSwatches')?.closest('.settings-section') : null;
        if (teamsSec) {
          setTimeout(() => teamsSec.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
        }
      });
    }

    if (el.attackColorSwatches) {
      el.attackColorSwatches.addEventListener('click', (e) => {
        const btn = e.target.closest('.team-color-swatch');
        if (!btn || !btn.dataset.color) return;
        const color = btn.dataset.color;
        if (state.teams.attack.color === color) return;

        if (state.teams.defense.color === color) {
          const oldAttack = state.teams.attack.color;
          state.teams.attack.color = color;
          state.teams.defense.color = oldAttack;
        } else {
          state.teams.attack.color = color;
        }
        safeSetItem('wptb_team_attack_color', state.teams.attack.color);
        safeSetItem('wptb_team_defense_color', state.teams.defense.color);
        updateTeamColorsUI();
        triggerHaptic(25);
        showToast(`${t('settings_team_attack_label')}: ${t(CAP_COLORS[state.teams.attack.color].nameKey)}`);
      });
    }

    if (el.defenseColorSwatches) {
      el.defenseColorSwatches.addEventListener('click', (e) => {
        const btn = e.target.closest('.team-color-swatch');
        if (!btn || !btn.dataset.color) return;
        const color = btn.dataset.color;
        if (state.teams.defense.color === color) return;

        if (state.teams.attack.color === color) {
          const oldDefense = state.teams.defense.color;
          state.teams.defense.color = color;
          state.teams.attack.color = oldDefense;
        } else {
          state.teams.defense.color = color;
        }
        safeSetItem('wptb_team_attack_color', state.teams.attack.color);
        safeSetItem('wptb_team_defense_color', state.teams.defense.color);
        updateTeamColorsUI();
        triggerHaptic(25);
        showToast(`${t('settings_team_defense_label')}: ${t(CAP_COLORS[state.teams.defense.color].nameKey)}`);
      });
    }

    if (el.swapTeamsBtn) {
      el.swapTeamsBtn.addEventListener('click', () => {
        const temp = state.teams.attack.color;
        state.teams.attack.color = state.teams.defense.color;
        state.teams.defense.color = temp;
        safeSetItem('wptb_team_attack_color', state.teams.attack.color);
        safeSetItem('wptb_team_defense_color', state.teams.defense.color);
        updateTeamColorsUI();
        triggerHaptic(30);
        showToast(t('toast_teams_swapped'));
      });
    }



    // iOS Safari Auto-Install Guide
    const iosInstallModal = document.getElementById('iosInstallModal');
    const closeIosModalBtn = document.getElementById('closeIosModalBtn');
    const okIosModalBtn = document.getElementById('okIosModalBtn');
    const closeIosModal = () => {
      if (iosInstallModal) iosInstallModal.classList.add('hidden');
    };
    if (closeIosModalBtn) closeIosModalBtn.addEventListener('click', closeIosModal);
    if (okIosModalBtn) okIosModalBtn.addEventListener('click', closeIosModal);
    if (iosInstallModal) {
      iosInstallModal.addEventListener('click', (e) => {
        if (e.target === iosInstallModal) closeIosModal();
      });
    }

    const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandaloneApp = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    const isNativeWKWebView = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.wptb);

    if (isIosDevice && !isStandaloneApp && !isNativeWKWebView && iosInstallModal) {
      setTimeout(() => {
        iosInstallModal.classList.remove('hidden');
      }, 600);
    }

    // Handle Back Navigation (Android Back Arrow / Gesture & Keyboard Esc)
    window.handleAndroidBack = function() {
      // 1. Tutorial modal
      if (el.tutorialModal && !el.tutorialModal.classList.contains('hidden')) {
        closeTutorial();
        return 'HANDLED';
      }
      // 2. File / Tactics modal
      if (el.fileModal && !el.fileModal.classList.contains('hidden')) {
        closeFileModal();
        return 'HANDLED';
      }
      // 3. Settings / About modal
      if (el.settingsModal && !el.settingsModal.classList.contains('hidden')) {
        closeSettingsModal();
        return 'HANDLED';
      }
      // 4. iOS Install modal
      if (iosInstallModal && !iosInstallModal.classList.contains('hidden')) {
        closeIosModal();
        return 'HANDLED';
      }
      // 5. Cap Number / Player Edit modal
      const capModal = document.getElementById('capModal') || document.querySelector('.cap-edit-modal');
      if (capModal && !capModal.classList.contains('hidden')) {
        capModal.classList.add('hidden');
        return 'HANDLED';
      }
      // 6. Fullscreen Mode
      if (state.isFullscreen) {
        setBoardFullscreen(false);
        return 'HANDLED';
      }
      // 7. Shooting Angle Mode
      if (state.mode === 'angle') {
        setMode('select');
        return 'HANDLED';
      }
      // 8. Mobile Sidebar expanded
      if (window.innerWidth < 768 && !state.sidebarCollapsed) {
        setSidebarCollapsed(true);
        return 'HANDLED';
      }
      // 9. If Animation is Playing, stop playback
      if (state.isPlaying) {
        stopPlayback();
        return 'HANDLED';
      }
      // 10. If Drawing / Arrow / Pass / Eraser Mode is active, return to Move
      if (state.mode && state.mode !== 'select') {
        setMode('select');
        return 'HANDLED';
      }
      // Nothing open -> trigger exit confirmation dialog on Android or Browser
      const title = t('confirm_exit_title') || 'Έξοδος από την Εφαρμογή';
      const msg = t('confirm_exit_msg') || 'Είστε βέβαιοι ότι θέλετε να κλείσετε το Πινακάκι Τακτικής;';
      const exitBtn = t('btn_exit_app') || 'Έξοδος';
      const cancelBtn = t('btn_cancel_app') || 'Ακύρωση';

      if (window.AndroidApp && typeof window.AndroidApp.promptExitConfirm === 'function') {
        window.AndroidApp.promptExitConfirm(title, msg, exitBtn, cancelBtn);
        return 'HANDLED';
      }

      if (confirm(`${title}\n\n${msg}`)) {
        window.close();
      }
      return 'HANDLED';
    };

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (typeof window.handleAndroidBack === 'function') {
          window.handleAndroidBack();
        }
      }
    });

    // Window Resize & Orientation Change
    window.addEventListener('resize', () => {
      resizeCanvas();
    });

    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        resizeCanvas();
        renderPitchSvg();
      }, 180);
    });

    const tryLockOrientation = () => {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {});
      }
    };
    window.addEventListener('touchstart', tryLockOrientation, { once: true, passive: true });
    window.addEventListener('click', tryLockOrientation, { once: true });

    // Ball Toggles in Sidebar
    document.querySelectorAll('.btn-ball-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.ballColor;
        if (color) {
          toggleBallColor(color);
        }
      });
    });
  }

  // Remove any injected third-party host banners (e.g. tiiny.host watermark)
  function removeHostBanners() {
    try {
      const bannerLinks = document.querySelectorAll('a[href*="tiiny.host"], [id*="tiiny"], [class*="tiiny"]');
      bannerLinks.forEach(b => {
        let parent = b;
        while (parent && parent.parentElement && parent.parentElement !== document.body) {
          parent = parent.parentElement;
        }
        if (parent && parent !== document.body && !parent.classList.contains('app-container')) {
          parent.remove();
        } else {
          b.remove();
        }
      });
    } catch (e) {}
  }

  // --- Bootstrap App ---
  function start() {
    removeHostBanners();
    setInterval(removeHostBanners, 600);
    loadSettings();
    initDefaultTokens();
    loadCustomTacticsFromStorage();
    renderPitchSvg();
    renderTokens(false);
    renderTray();
    updateBallsPaletteUI();
    renderTimeline();
    initEvents();
    updateTeamColorsUI();
    el.poolBoard.classList.toggle('is-drawing-mode', state.mode !== 'select');
    setLanguage(state.lang);
    showToast(t('toast_ready'));

    // Auto-launch interactive onboarding tutorial on first visit!
    const tutorialSeen = safeGetItem('wptb_tutorial_seen_v1');
    if (!tutorialSeen) {
      setTimeout(() => {
        if (typeof window.openTutorial === 'function') {
          window.openTutorial(0);
        }
      }, 700);
    }

    // Cloud Sync Integration
    if (window.CloudSync && typeof window.CloudSync.onSync === 'function') {
      window.CloudSync.onSync((cloudTactics) => {
        if (!Array.isArray(cloudTactics)) return;
        let changed = false;

        cloudTactics.forEach((cloudItem) => {
          if (!cloudItem || !cloudItem.id) return;
          const localIdx = state.customTactics.findIndex(
            (c) => c.id === cloudItem.id || c.title.toLowerCase() === (cloudItem.title || '').toLowerCase()
          );
          if (localIdx >= 0) {
            const localDate = new Date(state.customTactics[localIdx].date || state.customTactics[localIdx].updatedAt || 0).getTime();
            const cloudDate = new Date(cloudItem.updatedAt || cloudItem.date || 0).getTime();
            if (cloudDate > localDate) {
              state.customTactics[localIdx] = cloudItem;
              changed = true;
            }
          } else {
            state.customTactics.unshift(cloudItem);
            changed = true;
          }
        });

        // Upload any local tactics not yet in cloud
        state.customTactics.forEach((localItem) => {
          const existsInCloud = cloudTactics.some((c) => c.id === localItem.id);
          if (!existsInCloud) {
            window.CloudSync.saveTactic(localItem);
          }
        });

        if (changed) {
          saveCustomTacticsToStorage();
          renderCustomTacticsDropdown(state.selectedCustomTacticId);
        }
      });
    }
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();
