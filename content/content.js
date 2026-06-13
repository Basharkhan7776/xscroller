/**
 * XScroller - Content Script Orchestrator
 * The main brain that ties together XDetector, XScroller, and XReplier.
 * Manages the extension lifecycle, message handling, and UI indicator.
 *
 * Load order: storage.js → persona.js → detector.js → scroller.js → replier.js → content.js
 * Exposes: window.XContent
 */
(function () {
  'use strict';

  /* ================================================================== */
  /*  CONSTANTS & STATE                                                  */
  /* ================================================================== */

  const LOG_PREFIX = '[XScroller]';

  /** Default settings if storage has nothing yet */
  const DEFAULT_SETTINGS = {
    enabled: false,
    mode: 'auto',           // 'auto' | 'review' | 'scroll-only'
    scrollSpeed: 5,
    targeting: {
      keywords: [],
      avoidKeywords: [],
      minFollowers: 0,
      minEngagement: 0,
    },
    safety: {
      dailyLimit: 50,
      delayMin: 5,
      delayMax: 10,
      blacklistedUsers: [],
    },
    stats: {
      repliesToday: 0,
      totalReplies: 0,
      tweetsScanned: 0,
      lastResetDate: new Date().toISOString().slice(0, 10),
    },
  };

  /** Internal runtime state */
  const state = {
    enabled: false,
    mode: 'auto',
    scrollSpeed: 5,
    targeting: { ...DEFAULT_SETTINGS.targeting },
    safety: { ...DEFAULT_SETTINGS.safety },
    stats: { ...DEFAULT_SETTINGS.stats },
    observer: null,           // MutationObserver instance
    processedTweets: new Set(), // IDs we've already handled
    indicatorEl: null,        // The floating status pill element
    styleEl: null,            // Injected <style> element
    currentTweet: null,       // Tweet currently being processed
    processing: false,        // Lock to serialise tweet processing
  };

  /* ================================================================== */
  /*  FLOATING STATUS INDICATOR                                          */
  /* ================================================================== */

  function injectStyles() {
    if (state.styleEl) return;

    const css = `
      #xscroller-indicator {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        border-radius: 24px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        background: rgba(30, 30, 30, 0.85);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
        transition: background 0.3s ease, opacity 0.3s ease;
        user-select: none;
        cursor: default;
        opacity: 0.9;
      }
      #xscroller-indicator:hover {
        opacity: 1;
      }
      #xscroller-indicator .xs-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        transition: background 0.3s ease;
      }
      #xscroller-indicator .xs-dot.off      { background: #6b7280; }
      #xscroller-indicator .xs-dot.active    { background: #22c55e; animation: xs-pulse 1.5s infinite; }
      #xscroller-indicator .xs-dot.paused    { background: #eab308; }
      #xscroller-indicator .xs-dot.replying  { background: #3b82f6; animation: xs-pulse 1s infinite; }
      #xscroller-indicator .xs-close {
        margin-left: 4px;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        opacity: 0.6;
        transition: opacity 0.2s;
      }
      #xscroller-indicator .xs-close:hover { opacity: 1; }
      @keyframes xs-pulse {
        0%, 100% { opacity: 1; }
        50%      { opacity: 0.4; }
      }
    `;

    state.styleEl = document.createElement('style');
    state.styleEl.textContent = css;
    document.head.appendChild(state.styleEl);
  }

  function createIndicator() {
    injectStyles();

    if (state.indicatorEl) return;

    const el = document.createElement('div');
    el.id = 'xscroller-indicator';
    el.innerHTML = `
      <span class="xs-dot off"></span>
      <span class="xs-label">XS: OFF</span>
      <span class="xs-close" title="Hide indicator">&#x2715;</span>
    `;

    // Close button hides the indicator
    el.querySelector('.xs-close').addEventListener('click', (e) => {
      e.stopPropagation();
      el.style.display = 'none';
    });

    document.body.appendChild(el);
    state.indicatorEl = el;
  }

  function updateIndicator() {
    const el = state.indicatorEl;
    if (!el || el.style.display === 'none') return;

    const dot = el.querySelector('.xs-dot');
    const label = el.querySelector('.xs-label');

    if (!state.enabled) {
      dot.className = 'xs-dot off';
      label.textContent = 'XS: OFF';
    } else if (window.XReplier && window.XReplier.isReplying) {
      dot.className = 'xs-dot replying';
      label.textContent = 'XS: Replying\u2026';
    } else if (window.XScroller && window.XScroller.isPaused) {
      dot.className = 'xs-dot paused';
      label.textContent = 'XS: Paused';
    } else if (window.XScroller && window.XScroller.isScrolling) {
      dot.className = 'xs-dot active';
      label.textContent = 'XS: Scrolling\u2026';
    } else {
      dot.className = 'xs-dot paused';
      label.textContent = 'XS: Idle';
    }
  }

  /* ================================================================== */
  /*  STORAGE HELPERS                                                     */
  /* ================================================================== */

  async function loadSettings() {
    try {
      if (!window.XStorage) {
        console.warn(LOG_PREFIX, 'XStorage not available, using defaults.');
        return;
      }

      const [enabled, mode, speed, targeting, safety, stats] = await Promise.all([
        window.XStorage.get('xscroller_enabled'),
        window.XStorage.get('xscroller_mode'),
        window.XStorage.get('xscroller_scroll_speed'),
        window.XStorage.get('xscroller_targeting'),
        window.XStorage.get('xscroller_safety'),
        window.XStorage.get('xscroller_stats'),
      ]);

      state.enabled = enabled ?? DEFAULT_SETTINGS.enabled;
      state.mode = mode ?? DEFAULT_SETTINGS.mode;
      state.scrollSpeed = speed ?? DEFAULT_SETTINGS.scrollSpeed;
      state.targeting = targeting ? { ...DEFAULT_SETTINGS.targeting, ...targeting } : { ...DEFAULT_SETTINGS.targeting };
      state.safety = safety ? { ...DEFAULT_SETTINGS.safety, ...safety } : { ...DEFAULT_SETTINGS.safety };
      state.stats = stats ? { ...DEFAULT_SETTINGS.stats, ...stats } : { ...DEFAULT_SETTINGS.stats };

      // Reset daily counter if it's a new day
      const today = new Date().toISOString().slice(0, 10);
      if (state.stats.lastResetDate !== today) {
        state.stats.repliesToday = 0;
        state.stats.lastResetDate = today;
        await saveStats();
      }

      console.log(LOG_PREFIX, 'Settings loaded:', {
        enabled: state.enabled,
        mode: state.mode,
        speed: state.scrollSpeed,
      });
    } catch (err) {
      console.error(LOG_PREFIX, 'Failed to load settings:', err);
    }
  }

  async function saveStats() {
    try {
      if (window.XStorage) {
        await window.XStorage.set('xscroller_stats', state.stats);
      }
    } catch (err) {
      console.warn(LOG_PREFIX, 'Failed to save stats:', err);
    }
  }

  /* ================================================================== */
  /*  STATUS REPORTING                                                    */
  /* ================================================================== */

  function getStatus() {
    return {
      scrolling: window.XScroller ? window.XScroller.isScrolling : false,
      replying: window.XReplier ? window.XReplier.isReplying : false,
      paused: window.XScroller ? window.XScroller.isPaused : false,
      enabled: state.enabled,
      mode: state.mode,
      speed: state.scrollSpeed,
      currentTweet: state.currentTweet
        ? { id: state.currentTweet.id, author: state.currentTweet.author }
        : null,
      stats: { ...state.stats },
    };
  }

  function broadcastStatus() {
    try {
      chrome.runtime.sendMessage({
        type: 'STATUS_UPDATE',
        status: getStatus(),
      });
    } catch (_) {
      // Extension context may be invalidated - ignore
    }
    updateIndicator();
  }

  /* ================================================================== */
  /*  TWEET PROCESSING PIPELINE                                           */
  /* ================================================================== */

  /**
   * Process a single tweet article element through the pipeline:
   * extract -> check duplicates -> check targeting -> generate reply -> send/queue
   */
  async function processTweet(articleElement) {
    // Prevent concurrent processing
    if (state.processing) return;
    state.processing = true;

    try {
      // 1. Extract tweet data
      const tweet = window.XDetector.extractTweet(articleElement);
      if (!tweet) {
        console.log(LOG_PREFIX, 'Could not extract tweet data, skipping.');
        return;
      }

      // 2. Check if already processed
      if (state.processedTweets.has(tweet.id)) return;
      state.processedTweets.add(tweet.id);

      // 3. Increment scanned counter
      state.stats.tweetsScanned++;
      await saveStats();

      // 3.5 Skip if contains a video
      if (tweet.hasVideo) {
        console.log(LOG_PREFIX, 'Skipping tweet ' + tweet.id + ' because it contains a video.');
        return;
      }

      // 4. Check blacklisted users
      const handle = (tweet.authorHandle || '').toLowerCase().replace('@', '');
      const blacklisted = state.safety.blacklistedUsers.map(function (u) {
        return u.toLowerCase().replace('@', '');
      });
      if (blacklisted.includes(handle)) {
        console.log(LOG_PREFIX, 'Skipping blacklisted user: @' + handle);
        return;
      }

      // 5. Check if already replied (via XStorage)
      if (window.XStorage && typeof window.XStorage.isReplied === 'function') {
        const alreadyReplied = await window.XStorage.isReplied(tweet.id);
        if (alreadyReplied) {
          console.log(LOG_PREFIX, 'Already replied to tweet ' + tweet.id + ', skipping.');
          return;
        }
      }

      // 6. Check targeting criteria
      if (!window.XDetector.matchesTargeting(tweet, state.targeting)) {
        console.log(LOG_PREFIX, 'Tweet ' + tweet.id + ' does not match targeting, skipping.');
        return;
      }

      // 7. In scroll-only mode, we just scan - no replies
      if (state.mode === 'scroll-only') {
        console.log(LOG_PREFIX, 'Scroll-only mode - scanned tweet ' + tweet.id + '.');
        return;
      }

      // 8. Check daily limit
      if (state.stats.repliesToday >= state.safety.dailyLimit) {
        console.log(LOG_PREFIX, 'Daily limit reached (' + state.safety.dailyLimit + '). Skipping reply.');
        return;
      }

      // 9. Pause scrolling while we handle this tweet
      state.currentTweet = tweet;
      broadcastStatus();

      if (window.XScroller && window.XScroller.isScrolling) {
        window.XScroller.pause();
      }
      updateIndicator();

      // 10. Open the reply dialog FIRST so the DOM node is fresh and Twitter knows exactly which tweet we are replying to.
      // If we wait for the AI first, Twitter might recycle the DOM node and open a generic "New Post" modal instead!
      console.log(LOG_PREFIX, 'Opening reply box for tweet ' + tweet.id + '\u2026');
      var replyBox = null;
      
      if (state.mode === 'auto') {
        replyBox = await window.XReplier.openReplyBox(tweet.element);
        if (!replyBox) {
          console.warn(LOG_PREFIX, 'Could not open reply box, resuming scroll.');
          resumeAfterProcessing();
          return;
        }
      }

      // 11. Request AI-generated reply from background
      console.log(LOG_PREFIX, 'Generating reply for tweet ' + tweet.id + ' by ' + tweet.authorHandle + '\u2026');
      var replyText = null;

      try {
        var response = await chrome.runtime.sendMessage({
          type: 'GENERATE_REPLY',
          tweet: {
            id: tweet.id,
            text: tweet.text,
            author: tweet.author,
            authorHandle: tweet.authorHandle,
            metrics: tweet.metrics,
          },
        });

        if (response && response.reply) {
          replyText = response.reply;
        } else if (response && response.stopScrolling) {
          console.error(LOG_PREFIX, 'Background requested scroll stop. Error:', response.error);
          alert('XScroller stopped: ' + (response.error || 'All API keys failed.'));
          stopMainLoop();
          if (replyBox) await window.XReplier.closeReplyBox();
          return;
        } else {
          console.warn(LOG_PREFIX, 'No reply generated by background:', response);
        }
      } catch (err) {
        console.error(LOG_PREFIX, 'GENERATE_REPLY message failed:', err);
      }

      if (!replyText) {
        console.log(LOG_PREFIX, 'No reply text available, closing box and resuming scroll.');
        if (replyBox) await window.XReplier.closeReplyBox();
        resumeAfterProcessing();
        return;
      }

      // 12. Handle based on mode
      if (state.mode === 'auto') {
        console.log(LOG_PREFIX, 'Auto-replying to tweet ' + tweet.id + '\u2026');
        updateIndicator();

        // Check if reply dialog is still open
        var dialogOpen = document.querySelector('[data-testid="tweetTextarea_0"]') || 
                         document.querySelector('[role="textbox"][contenteditable="true"]');
        
        if (!dialogOpen) {
           console.warn(LOG_PREFIX, 'Reply dialog closed unexpectedly while generating reply.');
           resumeAfterProcessing();
           return;
        }

        // We already opened it, so just type and submit
        var result = await window.XReplier.sendReplyAlreadyOpen(replyBox, replyText);

        if (result.success) {
          console.log(LOG_PREFIX, 'Successfully replied to tweet ' + tweet.id + '.');
          state.stats.repliesToday++;
          state.stats.totalReplies++;
          await saveStats();

          if (window.XStorage && typeof window.XStorage.markReplied === 'function') {
            await window.XStorage.markReplied(tweet.id);
          }

          logActivity('reply_sent', tweet, replyText);
        } else {
          console.warn(LOG_PREFIX, 'Reply failed for tweet ' + tweet.id + ':', result.error);
          await window.XReplier.closeReplyBox();
        }
      } else if (state.mode === 'review') {
        console.log(LOG_PREFIX, 'Queuing reply for review - tweet ' + tweet.id + '.');
        try {
          chrome.runtime.sendMessage({
            type: 'QUEUE_REPLY',
            reply: {
              id: 'reply_' + tweet.id + '_' + Date.now(),
              tweetId: tweet.id,
              tweetText: tweet.text,
              tweetAuthor: tweet.authorHandle,
              replyText: replyText,
              timestamp: Date.now(),
            },
          });
        } catch (err) {
          console.error(LOG_PREFIX, 'QUEUE_REPLY message failed:', err);
        }
      }

      // 13. Safety delay before resuming
      var delayMs = randomBetween(
        (state.safety.delayMin || 30) * 1000,
        (state.safety.delayMax || 90) * 1000
      );
      console.log(LOG_PREFIX, 'Waiting ' + Math.round(delayMs / 1000) + 's before resuming\u2026');
      await new Promise(function (r) { setTimeout(r, delayMs); });

      resumeAfterProcessing();
    } catch (err) {
      console.error(LOG_PREFIX, 'processTweet error:', err);
      resumeAfterProcessing();
    } finally {
      state.processing = false;
      state.currentTweet = null;
      broadcastStatus();
    }
  }

  function resumeAfterProcessing() {
    if (state.enabled && window.XScroller && window.XScroller.isScrolling) {
      window.XScroller.resume();
    }
    updateIndicator();
  }

  function logActivity(type, tweet, replyText) {
    try {
      if (window.XStorage && typeof window.XStorage.addActivity === 'function') {
        window.XStorage.addActivity({
          type: type,
          tweetId: tweet.id,
          author: tweet.authorHandle,
          text: tweet.text.slice(0, 140),
          replyText: replyText ? replyText.slice(0, 280) : null,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      console.warn(LOG_PREFIX, 'Failed to log activity:', err);
    }
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min) + min);
  }

  /* ================================================================== */
  /*  MAIN LOOP CONTROL                                                   */
  /* ================================================================== */

  function startMainLoop() {
    console.log(LOG_PREFIX, 'Starting main loop\u2026');
    state.enabled = true;

    // Start scrolling
    if (window.XScroller) {
      window.XScroller.start(state.scrollSpeed);
    }

    // Set up tweet observer
    if (window.XDetector && !state.observer) {
      state.observer = window.XDetector.observe(function (articleElement) {
        if (!state.enabled) return;
        processTweet(articleElement);
      });
    }

    broadcastStatus();
    console.log(LOG_PREFIX, 'Main loop started.');
  }

  function stopMainLoop() {
    console.log(LOG_PREFIX, 'Stopping main loop\u2026');
    state.enabled = false;

    // Stop scrolling
    if (window.XScroller) {
      window.XScroller.stop();
    }

    // Disconnect observer
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    broadcastStatus();
    console.log(LOG_PREFIX, 'Main loop stopped.');
  }

  /* ================================================================== */
  /*  MESSAGE HANDLING                                                    */
  /* ================================================================== */

  function setupMessageListener() {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      console.log(LOG_PREFIX, 'Received message:', message.type);

      switch (message.type) {
        case 'TOGGLE_EXTENSION': {
          if (message.enabled) {
            loadSettings().then(function () { startMainLoop(); });
          } else {
            stopMainLoop();
          }
          sendResponse({ success: true });
          break;
        }

        case 'UPDATE_SPEED': {
          state.scrollSpeed = message.speed;
          if (window.XScroller) {
            window.XScroller.setSpeed(message.speed);
          }
          if (window.XStorage) {
            window.XStorage.set('xscroller_scroll_speed', message.speed);
          }
          sendResponse({ success: true });
          break;
        }

        case 'UPDATE_MODE': {
          state.mode = message.mode;
          if (window.XStorage) {
            window.XStorage.set('xscroller_mode', message.mode);
          }
          console.log(LOG_PREFIX, 'Mode changed to: ' + message.mode);
          sendResponse({ success: true });
          break;
        }

        case 'APPROVE_REPLY': {
          handleApproveReply(message.replyId)
            .then(function (result) { sendResponse(result); })
            .catch(function (err) { sendResponse({ success: false, error: err.message }); });
          return true; // Keep message channel open for async response
        }

        case 'REJECT_REPLY': {
          state.processedTweets.delete(message.replyId);
          console.log(LOG_PREFIX, 'Rejected reply: ' + message.replyId);
          sendResponse({ success: true });
          break;
        }

        case 'GET_STATUS': {
          sendResponse(getStatus());
          break;
        }

        default:
          console.log(LOG_PREFIX, 'Unknown message type: ' + message.type);
          sendResponse({ error: 'Unknown message type' });
      }
    });
  }

  /**
   * Handle an approved reply. Finds the tweet element (if still visible)
   * and sends the reply.
   */
  async function handleApproveReply(replyId) {
    try {
      // replyId format: reply_{tweetId}_{timestamp}
      var parts = replyId.split('_');
      var tweetId = parts[1];

      if (!tweetId) {
        return { success: false, error: 'Invalid reply ID format' };
      }

      // Try to find the tweet element still in the DOM
      var articles = document.querySelectorAll('article[data-testid="tweet"]');
      var targetArticle = null;

      for (var i = 0; i < articles.length; i++) {
        var article = articles[i];
        var links = article.querySelectorAll('a[href*="/status/"]');
        for (var j = 0; j < links.length; j++) {
          var href = links[j].getAttribute('href') || '';
          if (href.includes('/status/' + tweetId)) {
            targetArticle = article;
            break;
          }
        }
        if (targetArticle) break;
      }

      if (!targetArticle) {
        return { success: false, error: 'Tweet no longer visible on page. Scroll back to find it.' };
      }

      // Get the queued reply text from background
      var replyText = null;
      try {
        var response = await chrome.runtime.sendMessage({
          type: 'GET_QUEUED_REPLY',
          replyId: replyId,
        });
        if (response && response.replyText) {
          replyText = response.replyText;
        }
      } catch (_) {
        // Fallback: check local replier queue
      }

      // Check XReplier's local queue
      if (!replyText && window.XReplier) {
        var idx = window.XReplier.replyQueue.findIndex(function (r) { return r.id === replyId; });
        if (idx !== -1) {
          replyText = window.XReplier.replyQueue[idx].replyText;
          window.XReplier.replyQueue.splice(idx, 1);
        }
      }

      if (!replyText) {
        return { success: false, error: 'Reply text not found' };
      }

      // Send the reply
      var result = await window.XReplier.sendReply(targetArticle, replyText);

      if (result.success) {
        state.stats.repliesToday++;
        state.stats.totalReplies++;
        await saveStats();

        if (window.XStorage && typeof window.XStorage.markReplied === 'function') {
          await window.XStorage.markReplied(tweetId);
        }

        logActivity('reply_approved', { id: tweetId, authorHandle: '', text: '' }, replyText);
      }

      return result;
    } catch (err) {
      console.error(LOG_PREFIX, 'handleApproveReply error:', err);
      return { success: false, error: err.message };
    }
  }

  /* ================================================================== */
  /*  PERIODIC UI UPDATE                                                  */
  /* ================================================================== */

  function startIndicatorUpdater() {
    // Update indicator every 2 seconds to reflect live state
    setInterval(function () {
      updateIndicator();
    }, 2000);
  }

  /* ================================================================== */
  /*  INITIALIZATION                                                      */
  /* ================================================================== */

  async function init() {
    console.log(LOG_PREFIX, 'Initializing content script orchestrator\u2026');

    // Create the floating indicator
    createIndicator();

    // Load settings from storage
    await loadSettings();

    // Set up message listener
    setupMessageListener();

    // Start the periodic indicator updater
    startIndicatorUpdater();

    // If extension was left enabled, auto-start
    if (state.enabled) {
      console.log(LOG_PREFIX, 'Extension was enabled - auto-starting main loop.');
      startMainLoop();
    }

    updateIndicator();
    console.log(LOG_PREFIX, 'Content script orchestrator ready.');
  }

  /* ================================================================== */
  /*  EXPOSE PUBLIC API                                                   */
  /* ================================================================== */

  window.XContent = {
    /** Start the extension main loop */
    start: function () {
      state.enabled = true;
      if (window.XStorage) {
        window.XStorage.set('xscroller_enabled', true);
      }
      startMainLoop();
    },

    /** Stop the extension main loop */
    stop: function () {
      state.enabled = false;
      if (window.XStorage) {
        window.XStorage.set('xscroller_enabled', false);
      }
      stopMainLoop();
    },

    /** Get current status */
    getStatus: getStatus,

    /** Get internal state (for debugging) */
    getState: function () {
      return { ...state, observer: !!state.observer };
    },

    /** Manually process visible tweets (for testing) */
    processVisible: async function () {
      var tweets = window.XDetector.getVisibleTweets();
      console.log(LOG_PREFIX, 'Processing ' + tweets.length + ' visible tweets\u2026');
      for (var i = 0; i < tweets.length; i++) {
        await processTweet(tweets[i]);
      }
    },

    /** Show the floating indicator if it was hidden */
    showIndicator: function () {
      if (state.indicatorEl) {
        state.indicatorEl.style.display = 'flex';
        updateIndicator();
      }
    },
  };

  /* ================================================================== */
  /*  BOOT                                                                */
  /* ================================================================== */

  // Wait for DOM to be ready, then initialise
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log(LOG_PREFIX, 'Content module loaded.');
})();
