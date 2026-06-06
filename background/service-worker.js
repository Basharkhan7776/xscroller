/**
 * XScroller - Background Service Worker (MV3)
 * =============================================
 * Orchestrates messaging between content scripts, popup, and options page.
 * Handles Gemini API calls, stats management, reply queue, and daily resets.
 */

// ─── Import Shared Modules ──────────────────────────────────────────
try {
  importScripts('/lib/gemini.js');
} catch (err) {
  console.error('[XScroller SW] Failed to import gemini.js:', err);
}

// ─── Storage Key Constants (duplicated here since storage.js uses window) ──
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

// ─── Default Values (mirrors lib/storage.js) ─────────────────────────
const DEFAULTS = {
  [KEYS.ENABLED]: false,
  [KEYS.MODE]: 'review',
  [KEYS.SCROLL_SPEED]: 5,
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
    features: ['AI-powered development', 'Modern web solutions', 'Developer-first approach'],
    promotionFrequency: 30,
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
    delayMin: 5,
    delayMax: 10,
    blacklistedUsers: [],
  },
  [KEYS.STATS]: {
    repliesToday: 0,
    totalReplies: 0,
    tweetsScanned: 0,
    lastResetDate: new Date().toISOString().split('T')[0],
  },
  [KEYS.REPLY_QUEUE]: [],
  [KEYS.ACTIVITY_LOG]: [],
  [KEYS.REPLIED_TWEETS]: [],
};

// ─── Storage Helpers (service-worker-safe, no window) ────────────────

/**
 * Get a single value from chrome.storage.local with default fallback.
 */
async function storageGet(key) {
  try {
    const result = await chrome.storage.local.get(key);
    return result[key] !== undefined ? result[key] : DEFAULTS[key];
  } catch (err) {
    console.error(`[SW Storage] get("${key}") failed:`, err);
    return DEFAULTS[key];
  }
}

/**
 * Set a single value in chrome.storage.local.
 */
async function storageSet(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    console.error(`[SW Storage] set("${key}") failed:`, err);
  }
}

// ─── Daily Stats Reset ──────────────────────────────────────────────

/**
 * Check if the current date differs from the last reset date;
 * if so, zero out daily counters.
 * @returns {Promise<Object>} The (possibly reset) stats object.
 */
async function checkAndResetDaily() {
  const stats = await storageGet(KEYS.STATS);
  const today = new Date().toISOString().split('T')[0];

  if (stats.lastResetDate !== today) {
    stats.repliesToday = 0;
    stats.tweetsScanned = 0;
    stats.lastResetDate = today;
    await storageSet(KEYS.STATS, stats);
    console.log('[XScroller SW] Daily stats reset for', today);
  }

  return stats;
}

/**
 * Increment a named counter inside the stats object.
 */
async function incrementStat(statName) {
  const stats = await storageGet(KEYS.STATS);
  stats[statName] = (typeof stats[statName] === 'number' ? stats[statName] : 0) + 1;
  await storageSet(KEYS.STATS, stats);
  return stats;
}

/**
 * Add an entry to the activity log (capped at 500).
 */
async function addToLog(entry) {
  const log = await storageGet(KEYS.ACTIVITY_LOG);
  log.push({ ...entry, timestamp: Date.now() });
  if (log.length > 500) {
    log.splice(0, log.length - 500);
  }
  await storageSet(KEYS.ACTIVITY_LOG, log);
}

// ─── Message Handler ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Every handler returns true to indicate async sendResponse usage
  if (!message || !message.type) return false;

  switch (message.type) {
    // ── Generate a reply using Gemini ──
    case 'GENERATE_REPLY':
      handleGenerateReply(message, sender)
        .then(sendResponse)
        .catch((err) => {
          console.error('[SW] GENERATE_REPLY error:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // async

    // ── Return current stats (reset if new day) ──
    case 'GET_STATS':
      checkAndResetDaily()
        .then((stats) => sendResponse({ success: true, stats }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    // ── Add a reply to the review queue ──
    case 'QUEUE_REPLY':
      handleQueueReply(message.reply)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    // ── Master toggle ──
    case 'TOGGLE_EXTENSION':
      handleToggle(message.enabled)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    // ── Settings changed — notify content scripts to re-read ──
    case 'UPDATE_SETTINGS':
      forwardToContentTabs(message);
      sendResponse({ success: true });
      return false;

    default:
      return false;
  }
});

// ─── Handler Implementations ─────────────────────────────────────────

/**
 * Generate an AI reply for a tweet using Gemini.
 */
async function handleGenerateReply(message) {
  const tweet = message.tweet;

  const [apiKey, persona, openlabs, safety, stats] = await Promise.all([
    storageGet(KEYS.API_KEY),
    storageGet(KEYS.PERSONA),
    storageGet(KEYS.OPENLABS),
    storageGet(KEYS.SAFETY),
    checkAndResetDaily(),
  ]);

  // Guard: API key required
  if (!apiKey) {
    return { success: false, error: 'No Gemini API key configured. Set one in the Options page.' };
  }

  // Guard: daily limit
  if (stats.repliesToday >= safety.dailyLimit) {
    return { success: false, error: `Daily reply limit reached (${safety.dailyLimit}).` };
  }

  // Decide promotion
  const shouldPromote = Math.random() * 100 < (openlabs.promotionFrequency || 0);

  // Call Gemini
  const result = await self.XGemini.generateReply(
    apiKey,
    tweet,
    persona,
    openlabs,
    shouldPromote,
  );

  if (result.success) {
    // Log the generation
    await addToLog({
      type: 'reply_generated',
      tweetId: tweet.id,
      tweetAuthor: tweet.authorHandle || tweet.author,
      replyPreview: result.reply.substring(0, 80),
      promoted: shouldPromote,
    });
  }

  return result;
}

/**
 * Add a reply to the pending review queue.
 */
async function handleQueueReply(reply) {
  if (!reply || !reply.id) {
    throw new Error('Invalid reply object (missing id).');
  }

  const queue = await storageGet(KEYS.REPLY_QUEUE);
  queue.push(reply);
  await storageSet(KEYS.REPLY_QUEUE, queue);

  await addToLog({
    type: 'reply_queued',
    replyId: reply.id,
    tweetId: reply.tweetId,
    tweetAuthor: reply.tweetAuthor,
  });
}

/**
 * Toggle the extension on/off and broadcast to all matching content tabs.
 */
async function handleToggle(enabled) {
  await storageSet(KEYS.ENABLED, !!enabled);

  await addToLog({
    type: 'toggle',
    enabled: !!enabled,
  });

  // Forward the toggle to all X/Twitter tabs
  await forwardToContentTabs({ type: 'TOGGLE_EXTENSION', enabled: !!enabled });
}

/**
 * Send a message to all tabs matching X/Twitter URLs.
 */
async function forwardToContentTabs(message) {
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://x.com/*', 'https://twitter.com/*'],
    });

    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch {
        // Tab may not have the content script loaded; ignore silently
      }
    }
  } catch (err) {
    console.error('[SW] forwardToContentTabs failed:', err);
  }
}

// ─── Alarms ──────────────────────────────────────────────────────────

// Set up a daily reset alarm
chrome.alarms.create('daily-reset', {
  // Fire every 60 minutes — the handler checks the actual date
  periodInMinutes: 60,
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'daily-reset') {
    await checkAndResetDaily();
  }
});

// ─── Extension Install / Update ──────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[XScroller] Extension installed — setting defaults.');

    // Write all defaults to storage
    const defaultData = {};
    for (const [key, value] of Object.entries(DEFAULTS)) {
      defaultData[key] = value;
    }
    await chrome.storage.local.set(defaultData);

    // Log the install event
    await addToLog({ type: 'install', version: chrome.runtime.getManifest().version });
  }

  if (details.reason === 'update') {
    console.log('[XScroller] Extension updated to', chrome.runtime.getManifest().version);
    await addToLog({ type: 'update', version: chrome.runtime.getManifest().version });
  }
});

console.log('[XScroller] Service worker loaded.');
