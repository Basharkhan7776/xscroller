/**
 * XScroller - Chrome Storage Utility
 * ===================================
 * IIFE pattern exposing window.XStorage for content script contexts.
 * Wraps chrome.storage.local with typed keys, defaults, and helper methods.
 */
(function () {
  'use strict';

  // ─── Storage Key Constants ─────────────────────────────────────────
  const KEYS = {
    ENABLED:        'xscroller_enabled',
    MODE:           'xscroller_mode',
    SCROLL_SPEED:   'xscroller_scroll_speed',
    API_KEY:        'xscroller_api_key',
    PERSONA:        'xscroller_persona',
    OPENLABS:       'xscroller_openlabs',
    TARGETING:      'xscroller_targeting',
    SAFETY:         'xscroller_safety',
    STATS:          'xscroller_stats',
    REPLY_QUEUE:    'xscroller_reply_queue',
    ACTIVITY_LOG:   'xscroller_activity_log',
    REPLIED_TWEETS: 'xscroller_replied_tweets',
  };

  // ─── Default Values ───────────────────────────────────────────────
  const DEFAULTS = {
    [KEYS.ENABLED]: false,

    [KEYS.MODE]: 'review', // 'auto' | 'review' | 'scroll-only'

    [KEYS.SCROLL_SPEED]: 5, // 1-10

    [KEYS.API_KEY]: '',

    [KEYS.PERSONA]: {
      name: 'Bashar',
      title: 'Founder',
      company: 'OpenLabs',
      description: 'We build cutting-edge developer tools and web solutions',
      tone: 'witty',
      expertise: ['web development', 'AI', 'SaaS', 'startups'],
      customPrompt: '',
    },

    [KEYS.OPENLABS]: {
      url: 'https://openlabs.dev',
      tagline: 'Building the future of developer tools',
      features: [
        'AI-powered development',
        'Modern web solutions',
        'Developer-first approach',
      ],
      promotionFrequency: 30, // percentage of replies that mention OpenLabs
    },

    [KEYS.TARGETING]: {
      keywords: [
        'web dev', 'javascript', 'react', 'nextjs', 'AI',
        'startup', 'SaaS', 'open source', 'developer tools',
        'coding', 'programming', 'tech',
      ],
      avoidKeywords: ['politics', 'nsfw', 'controversy'],
      minFollowers: 0,
      minEngagement: 0,
    },

    [KEYS.SAFETY]: {
      dailyLimit: 20,
      delayMin: 5,   // seconds between actions
      delayMax: 10,
      blacklistedUsers: [],
    },

    [KEYS.STATS]: {
      repliesToday: 0,
      totalReplies: 0,
      tweetsScanned: 0,
      lastResetDate: new Date().toISOString().split('T')[0], // 'YYYY-MM-DD'
    },

    [KEYS.REPLY_QUEUE]: [],

    [KEYS.ACTIVITY_LOG]: [],

    [KEYS.REPLIED_TWEETS]: [],
  };

  // Maximum number of activity log entries to retain
  const MAX_LOG_ENTRIES = 500;

  // ─── Core Helpers ──────────────────────────────────────────────────

  /**
   * Get a single value from chrome.storage.local, falling back to its default.
   * @param {string} key - One of KEYS.*
   * @returns {Promise<*>}
   */
  async function get(key) {
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] !== undefined ? result[key] : DEFAULTS[key];
    } catch (err) {
      console.error(`[XStorage] get("${key}") failed:`, err);
      return DEFAULTS[key];
    }
  }

  /**
   * Set a single value in chrome.storage.local.
   * @param {string} key   - One of KEYS.*
   * @param {*}      value - Value to persist
   */
  async function set(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (err) {
      console.error(`[XStorage] set("${key}") failed:`, err);
    }
  }

  /**
   * Retrieve all stored settings, filling in defaults for any missing keys.
   * @returns {Promise<Object>}
   */
  async function getAll() {
    try {
      const keys = Object.values(KEYS);
      const result = await chrome.storage.local.get(keys);
      const merged = {};
      for (const key of keys) {
        merged[key] = result[key] !== undefined ? result[key] : DEFAULTS[key];
      }
      return merged;
    } catch (err) {
      console.error('[XStorage] getAll() failed:', err);
      return { ...DEFAULTS };
    }
  }

  // ─── Stats Helpers ─────────────────────────────────────────────────

  /**
   * Reset daily statistics (repliesToday and tweetsScanned).
   * Called automatically when a new calendar day is detected.
   */
  async function resetStats() {
    try {
      const stats = await get(KEYS.STATS);
      stats.repliesToday = 0;
      stats.tweetsScanned = 0;
      stats.lastResetDate = new Date().toISOString().split('T')[0];
      await set(KEYS.STATS, stats);
      return stats;
    } catch (err) {
      console.error('[XStorage] resetStats() failed:', err);
    }
  }

  /**
   * Increment a named counter inside the stats object.
   * @param {string} statName - e.g. 'repliesToday', 'totalReplies', 'tweetsScanned'
   */
  async function incrementStat(statName) {
    try {
      const stats = await get(KEYS.STATS);
      if (typeof stats[statName] === 'number') {
        stats[statName] += 1;
      } else {
        stats[statName] = 1;
      }
      await set(KEYS.STATS, stats);
      return stats;
    } catch (err) {
      console.error(`[XStorage] incrementStat("${statName}") failed:`, err);
    }
  }

  // ─── Activity Log ──────────────────────────────────────────────────

  /**
   * Append a log entry with an automatic timestamp.
   * Caps the log at MAX_LOG_ENTRIES oldest entries are removed first.
   * @param {Object} entry - Arbitrary log data (type, message, tweetId, etc.)
   */
  async function addToLog(entry) {
    try {
      const log = await get(KEYS.ACTIVITY_LOG);
      log.push({
        ...entry,
        timestamp: Date.now(),
      });
      // Trim to cap
      if (log.length > MAX_LOG_ENTRIES) {
        log.splice(0, log.length - MAX_LOG_ENTRIES);
      }
      await set(KEYS.ACTIVITY_LOG, log);
    } catch (err) {
      console.error('[XStorage] addToLog() failed:', err);
    }
  }

  // ─── Replied Tweet Tracking ────────────────────────────────────────

  /**
   * Record a tweet ID as already replied-to.
   * @param {string} tweetId
   */
  async function addRepliedTweet(tweetId) {
    try {
      const replied = await get(KEYS.REPLIED_TWEETS);
      if (!replied.includes(tweetId)) {
        replied.push(tweetId);
        await set(KEYS.REPLIED_TWEETS, replied);
      }
    } catch (err) {
      console.error('[XStorage] addRepliedTweet() failed:', err);
    }
  }

  /**
   * Check whether a tweet has already been replied to.
   * @param {string} tweetId
   * @returns {Promise<boolean>}
   */
  async function isReplied(tweetId) {
    try {
      const replied = await get(KEYS.REPLIED_TWEETS);
      return replied.includes(tweetId);
    } catch (err) {
      console.error('[XStorage] isReplied() failed:', err);
      return false;
    }
  }

  // ─── Reply Queue Management ────────────────────────────────────────

  /**
   * Add a reply object to the pending queue.
   * @param {Object} reply - { id, tweetId, tweetText, tweetAuthor, replyText, timestamp }
   */
  async function addToQueue(reply) {
    try {
      const queue = await get(KEYS.REPLY_QUEUE);
      queue.push(reply);
      await set(KEYS.REPLY_QUEUE, queue);
    } catch (err) {
      console.error('[XStorage] addToQueue() failed:', err);
    }
  }

  /**
   * Remove a reply from the queue by its unique ID.
   * @param {string} replyId
   */
  async function removeFromQueue(replyId) {
    try {
      let queue = await get(KEYS.REPLY_QUEUE);
      queue = queue.filter((r) => r.id !== replyId);
      await set(KEYS.REPLY_QUEUE, queue);
    } catch (err) {
      console.error('[XStorage] removeFromQueue() failed:', err);
    }
  }

  /**
   * Return the current reply queue.
   * @returns {Promise<Array>}
   */
  async function getQueue() {
    return get(KEYS.REPLY_QUEUE);
  }

  // ─── Public API ────────────────────────────────────────────────────
  window.XStorage = {
    KEYS,
    DEFAULTS,
    get,
    set,
    getAll,
    resetStats,
    incrementStat,
    addToLog,
    addRepliedTweet,
    isReplied,
    addToQueue,
    removeFromQueue,
    getQueue,
  };
})();
