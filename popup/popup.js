/* ============================================================
   XScroller Popup — Controller Logic
   ============================================================ */

(function () {
  'use strict';

  // ── Storage Keys ──
  const STORAGE_KEYS = {
    ENABLED:      'xscroller_enabled',
    MODE:         'xscroller_mode',
    SCROLL_SPEED: 'xscroller_scroll_speed',
    STATS:        'xscroller_stats',
  };

  // ── Default Values ──
  const DEFAULTS = {
    enabled:     false,
    mode:        'auto',
    scrollSpeed: 5,
    stats: {
      repliesToday:   0,
      totalReplies:   0,
      tweetsScanned:  0,
      lastResetDate:  new Date().toISOString().slice(0, 10),
    },
  };

  const DAILY_LIMIT = 50;
  let statusPollInterval = null;

  // ── DOM Elements ──
  const $ = (sel) => document.querySelector(sel);

  const els = {
    container:        $('#popup-container'),
    toggleInput:      $('#master-toggle-input'),
    toggleStateText:  $('#toggle-state-text'),
    statusDot:        $('#status-dot'),
    statusText:       $('#status-text'),
    repliesToday:     $('#replies-today-count'),
    repliesTodayLimit:$('#replies-today-limit'),
    totalReplies:     $('#total-replies-count'),
    tweetsScanned:    $('#tweets-scanned-count'),
    speedSlider:      $('#speed-slider'),
    speedDisplay:     $('#speed-value-display'),
    modeSelector:     $('#mode-selector'),
    modeBtns:         document.querySelectorAll('.mode-btn'),
    btnDashboard:     $('#btn-dashboard'),
    btnTwitter:       $('#btn-twitter'),
  };

  // ================================================================
  // CHROME STORAGE HELPERS
  // ================================================================

  /**
   * Safely read from chrome.storage.local.
   * Returns an object with the requested keys.
   */
  async function storageGet(keys) {
    try {
      return await chrome.storage.local.get(keys);
    } catch (err) {
      console.warn('[XScroller Popup] storageGet error:', err);
      return {};
    }
  }

  /**
   * Safely write to chrome.storage.local.
   */
  async function storageSet(data) {
    try {
      await chrome.storage.local.set(data);
    } catch (err) {
      console.warn('[XScroller Popup] storageSet error:', err);
    }
  }

  // ================================================================
  // MESSAGING HELPERS
  // ================================================================

  /**
   * Send a message to the extension's background / service worker.
   */
  function sendToBackground(message) {
    try {
      return chrome.runtime.sendMessage(message);
    } catch (err) {
      console.warn('[XScroller Popup] sendToBackground error:', err);
      return Promise.resolve(null);
    }
  }

  /**
   * Send a message to the active tab's content script.
   */
  async function sendToActiveTab(message) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        return chrome.tabs.sendMessage(tab.id, message);
      }
    } catch (err) {
      console.warn('[XScroller Popup] sendToActiveTab error:', err);
    }
    return null;
  }

  // ================================================================
  // UI UPDATERS
  // ================================================================

  /**
   * Animate a number from its current value to a target value.
   */
  function animateNumber(element, target) {
    const current = parseInt(element.textContent, 10) || 0;
    if (current === target) return;

    const diff = target - current;
    const steps = Math.min(Math.abs(diff), 20);
    const stepDuration = Math.max(15, 300 / steps);
    let step = 0;

    element.classList.add('animating');

    const interval = setInterval(() => {
      step++;
      const progress = step / steps;
      // Ease-out curve
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(current + diff * eased);
      element.textContent = formatNumber(value);

      if (step >= steps) {
        clearInterval(interval);
        element.textContent = formatNumber(target);
        element.classList.remove('animating');
      }
    }, stepDuration);
  }

  /**
   * Format a number with commas for display.
   */
  function formatNumber(n) {
    if (n == null || isNaN(n)) return '0';
    return n.toLocaleString('en-US');
  }

  /**
   * Update the toggle UI (text + container state).
   */
  function updateToggleUI(enabled) {
    els.toggleInput.checked = enabled;
    els.toggleStateText.textContent = enabled ? 'ON' : 'OFF';
    els.toggleStateText.className = 'toggle-state-text ' + (enabled ? 'on' : 'off');

    if (enabled) {
      els.container.classList.remove('disabled');
    } else {
      els.container.classList.add('disabled');
      updateStatus('off', 'OFF');
    }
  }

  /**
   * Update the status indicator dot + text.
   * @param {'active'|'scrolling'|'replying'|'paused'|'off'|'error'} state
   * @param {string} text
   */
  function updateStatus(state, text) {
    // Remove all state classes from dot
    els.statusDot.className = 'status-dot ' + state;
    els.statusText.textContent = text;
  }

  /**
   * Update stats display with animation.
   */
  function updateStats(stats) {
    const s = { ...DEFAULTS.stats, ...stats };
    animateNumber(els.repliesToday, s.repliesToday);
    els.repliesTodayLimit.textContent = DAILY_LIMIT;
    animateNumber(els.totalReplies, s.totalReplies);
    animateNumber(els.tweetsScanned, s.tweetsScanned);
  }

  /**
   * Update speed slider UI and CSS custom property for track fill.
   */
  function updateSpeedUI(value) {
    els.speedSlider.value = value;
    els.speedDisplay.textContent = value;
    const pct = ((value - 1) / 9) * 100;
    els.speedSlider.style.setProperty('--slider-progress', pct + '%');
  }

  /**
   * Update mode selector UI.
   */
  function updateModeUI(mode) {
    els.modeBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  // ================================================================
  // STATUS → human-readable mapping
  // ================================================================

  const STATUS_MAP = {
    scrolling:  { state: 'scrolling',  text: 'Scrolling...' },
    replying:   { state: 'replying',   text: 'Replying...' },
    paused:     { state: 'paused',     text: 'Paused' },
    idle:       { state: 'active',     text: 'Idle — Ready' },
    active:     { state: 'active',     text: 'Active' },
    off:        { state: 'off',        text: 'OFF' },
    error:      { state: 'error',      text: 'Error' },
  };

  function setStatusFromString(statusStr) {
    const mapped = STATUS_MAP[statusStr] || STATUS_MAP.off;
    updateStatus(mapped.state, mapped.text);
  }

  // ================================================================
  // EVENT HANDLERS
  // ================================================================

  /**
   * Master toggle change handler.
   */
  async function onToggleChange() {
    const enabled = els.toggleInput.checked;

    updateToggleUI(enabled);

    await storageSet({ [STORAGE_KEYS.ENABLED]: enabled });

    sendToBackground({ type: 'TOGGLE_EXTENSION', enabled });

    sendToActiveTab({ type: 'TOGGLE_EXTENSION', enabled });

    if (enabled) {
      updateStatus('active', 'Active');
      requestStats();
    }
  }

  /**
   * Speed slider input handler.
   */
  async function onSpeedChange() {
    const speed = parseInt(els.speedSlider.value, 10);
    updateSpeedUI(speed);

    await storageSet({ [STORAGE_KEYS.SCROLL_SPEED]: speed });

    sendToActiveTab({ type: 'UPDATE_SPEED', speed });
  }

  /**
   * Mode button click handler.
   */
  async function onModeSelect(e) {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;

    const mode = btn.dataset.mode;
    updateModeUI(mode);

    await storageSet({ [STORAGE_KEYS.MODE]: mode });

    sendToActiveTab({ type: 'UPDATE_MODE', mode });
  }

  /**
   * Dashboard button click handler.
   */
  function onDashboardClick() {
    try {
      chrome.runtime.openOptionsPage();
    } catch (err) {
      console.warn('[XScroller Popup] openOptionsPage error:', err);
    }
  }

  /**
   * Twitter button click handler.
   */
  function onTwitterClick() {
    try {
      chrome.tabs.create({ url: 'https://x.com' });
    } catch (err) {
      console.warn('[XScroller Popup] tabs.create error:', err);
    }
  }

  // ================================================================
  // DATA LOADING
  // ================================================================

  /**
   * Request stats from the background service worker.
   */
  async function requestStats() {
    try {
      const response = await sendToBackground({ type: 'GET_STATS' });
      if (response?.stats) {
        updateStats(response.stats);
      }
    } catch (err) {
      // Silently ignore — will retry on next poll
    }
  }

  /**
   * Load all saved settings from storage and apply them to the UI.
   */
  async function loadSettings() {
    const data = await storageGet([
      STORAGE_KEYS.ENABLED,
      STORAGE_KEYS.MODE,
      STORAGE_KEYS.SCROLL_SPEED,
      STORAGE_KEYS.STATS,
    ]);

    const enabled = data[STORAGE_KEYS.ENABLED] ?? DEFAULTS.enabled;
    const mode    = data[STORAGE_KEYS.MODE]    ?? DEFAULTS.mode;
    const speed   = data[STORAGE_KEYS.SCROLL_SPEED] ?? DEFAULTS.scrollSpeed;
    const stats   = data[STORAGE_KEYS.STATS]   ?? DEFAULTS.stats;

    updateToggleUI(enabled);
    updateModeUI(mode);
    updateSpeedUI(speed);
    updateStats(stats);

    if (enabled) {
      updateStatus('active', 'Active');
    } else {
      updateStatus('off', 'OFF');
    }
  }

  // ================================================================
  // MESSAGE LISTENER
  // ================================================================

  function setupMessageListener() {
    try {
      chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
        if (message.type === 'STATUS_UPDATE' && message.status) {
          setStatusFromString(message.status);
        }
        if (message.type === 'STATS_UPDATE' && message.stats) {
          updateStats(message.stats);
        }
      });
    } catch (err) {
      console.warn('[XScroller Popup] message listener error:', err);
    }
  }

  // ================================================================
  // POLLING
  // ================================================================

  function startStatusPolling() {
    // Poll every 2 seconds for fresh stats
    statusPollInterval = setInterval(() => {
      requestStats();
    }, 2000);
  }

  function stopStatusPolling() {
    if (statusPollInterval) {
      clearInterval(statusPollInterval);
      statusPollInterval = null;
    }
  }

  // ================================================================
  // INITIALIZATION
  // ================================================================

  async function init() {
    // 1. Load saved settings & update UI
    await loadSettings();

    // 2. Bind event listeners
    els.toggleInput.addEventListener('change', onToggleChange);
    els.speedSlider.addEventListener('input', onSpeedChange);
    els.modeSelector.addEventListener('click', onModeSelect);
    els.btnDashboard.addEventListener('click', onDashboardClick);
    els.btnTwitter.addEventListener('click', onTwitterClick);

    // 3. Request fresh stats from background
    requestStats();

    // 4. Set up incoming message listener
    setupMessageListener();

    // 5. Start status polling
    startStatusPolling();
  }

  // Clean up on popup close
  window.addEventListener('unload', () => {
    stopStatusPolling();
  });

  // ── Boot ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
