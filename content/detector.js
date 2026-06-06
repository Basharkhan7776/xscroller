/**
 * XScroller - Tweet Detector Module
 * Extracts tweet data from Twitter/X DOM elements,
 * checks targeting criteria, and observes the timeline for new tweets.
 *
 * Load order: storage.js -> persona.js -> detector.js
 * Exposes: window.XDetector
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Safely parse a number from a string that may use compact notation
   * (e.g. "1.2K", "3.5M") or plain digits. Returns 0 on failure.
   */
  function parseMetricText(raw) {
    if (!raw) return 0;
    var text = raw.trim().replace(/,/g, '');
    var match = text.match(/([\d.]+)\s*([KkMmBb])?/);
    if (!match) return 0;
    var num = parseFloat(match[1]);
    if (isNaN(num)) return 0;
    var suffix = (match[2] || '').toUpperCase();
    if (suffix === 'K') num *= 1000;
    else if (suffix === 'M') num *= 1000000;
    else if (suffix === 'B') num *= 1000000000;
    return Math.round(num);
  }

  /**
   * Extract a metric value from a tweet action button.
   * Twitter stores the count either in the aria-label of the button's
   * container or in a child <span>. Handles both shapes.
   */
  function getMetric(article, testId) {
    try {
      // Twitter uses data-testid on the button wrapper
      var btn = article.querySelector('[data-testid="' + testId + '"]');
      if (!btn) return 0;

      // 1) Try aria-label on the button or an ancestor group
      var ariaEl = btn.closest('[aria-label]') || btn.querySelector('[aria-label]');
      if (ariaEl) {
        var label = ariaEl.getAttribute('aria-label') || '';
        // e.g. "245 Likes" or "Reply"
        var numMatch = label.match(/([\d,.]+[KkMmBb]?)/);
        if (numMatch) return parseMetricText(numMatch[1]);
      }

      // 2) Fallback: look for visible text inside the button
      var spans = btn.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        var t = spans[i].textContent.trim();
        if (t && /[\d]/.test(t)) return parseMetricText(t);
      }
    } catch (_) {
      /* swallow */
    }
    return 0;
  }

  /* ------------------------------------------------------------------ */
  /*  Core API                                                           */
  /* ------------------------------------------------------------------ */

  window.XDetector = {

    /**
     * Extract structured tweet data from an <article data-testid="tweet">
     * DOM element. Returns null if extraction fails.
     *
     * @param {HTMLElement} articleElement
     * @returns {{ id: string, text: string, author: string,
     *             authorHandle: string, metrics: { likes: number,
     *             retweets: number, replies: number },
     *             element: HTMLElement } | null}
     */
    extractTweet: function (articleElement) {
      try {
        if (!articleElement) return null;

        /* ---------- Tweet text ---------- */
        var tweetTextEl = articleElement.querySelector('[data-testid="tweetText"]');
        var text = tweetTextEl ? tweetTextEl.innerText : '';

        /* ---------- Author & handle ---------- */
        var author = '';
        var authorHandle = '';

        // Strategy 1: Look for the user-name test-id wrapper
        var userNameGroup = articleElement.querySelector('[data-testid="User-Name"]');
        if (userNameGroup) {
          // Display name is typically the first <span> with a non-@ text
          var spans = userNameGroup.querySelectorAll('span');
          for (var i = 0; i < spans.length; i++) {
            var t = (spans[i].textContent || '').trim();
            if (!t) continue;
            if (t.startsWith('@') && !authorHandle) {
              authorHandle = t;
            } else if (!author && t.length > 0 && !t.startsWith('@')) {
              // Skip separators, timestamps etc.
              if (t !== '\u00b7' && t !== '\u2026' && !/^\d+[hms]$/.test(t) && !/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(t)) {
                author = t;
              }
            }
          }
        }

        // Strategy 2: Fallback - look for links in the header
        if (!authorHandle) {
          var links = articleElement.querySelectorAll('a[role="link"]');
          for (var j = 0; j < links.length; j++) {
            var href = links[j].getAttribute('href') || '';
            // User profile links look like "/username" (no /status/)
            if (href.match(/^\/[A-Za-z0-9_]+$/) && href.indexOf('/status/') === -1) {
              authorHandle = '@' + href.slice(1);
              if (!author) {
                var span = links[j].querySelector('span');
                if (span) author = span.textContent.trim();
              }
              break;
            }
          }
        }

        // Normalise handle
        if (authorHandle && !authorHandle.startsWith('@')) {
          authorHandle = '@' + authorHandle;
        }

        /* ---------- Tweet ID ---------- */
        var id = '';
        var timeLinks = articleElement.querySelectorAll('a[href*="/status/"]');
        for (var k = 0; k < timeLinks.length; k++) {
          var linkHref = timeLinks[k].getAttribute('href') || '';
          var idMatch = linkHref.match(/\/([A-Za-z0-9_]+)\/status\/(\d+)/);
          if (idMatch) {
            id = idMatch[2];
            // Also grab handle from permalink if we don't have it
            if (!authorHandle) authorHandle = '@' + idMatch[1];
            break;
          }
        }

        if (!id) return null; // Can't track without an ID

        /* ---------- Metrics ---------- */
        var likes = getMetric(articleElement, 'like') || getMetric(articleElement, 'unlike');
        var retweets = getMetric(articleElement, 'retweet');
        var replies = getMetric(articleElement, 'reply');

        /* ---------- Video Check ---------- */
        var hasVideo = !!(articleElement.querySelector('video') || articleElement.querySelector('[data-testid="videoPlayer"]'));

        return {
          id: id,
          text: text,
          author: author,
          authorHandle: authorHandle,
          metrics: { likes: likes, retweets: retweets, replies: replies },
          hasVideo: hasVideo,
          element: articleElement,
        };
      } catch (err) {
        console.warn('[XScroller] extractTweet failed:', err);
        return null;
      }
    },

    /**
     * Check whether a tweet matches the user's targeting criteria.
     *
     * @param {{ text: string, metrics: { likes: number, retweets: number, replies: number } }} tweet
     * @param {{ keywords?: string[], avoidKeywords?: string[],
     *           minFollowers?: number, minEngagement?: number }} targeting
     * @returns {boolean}
     */
    matchesTargeting: function (tweet, targeting) {
      if (!targeting) return true;
      if (!tweet) return false;

      var lowerText = (tweet.text || '').toLowerCase();

      // Reject if tweet contains any avoid keywords
      var avoidKeywords = targeting.avoidKeywords || [];
      for (var i = 0; i < avoidKeywords.length; i++) {
        if (avoidKeywords[i] && lowerText.indexOf(avoidKeywords[i].toLowerCase()) !== -1) {
          return false;
        }
      }

      // If keywords are specified, at least one must be present
      var keywords = targeting.keywords || [];
      if (keywords.length > 0) {
        var hasMatch = false;
        for (var j = 0; j < keywords.length; j++) {
          if (keywords[j] && lowerText.indexOf(keywords[j].toLowerCase()) !== -1) {
            hasMatch = true;
            break;
          }
        }
        if (!hasMatch) return false;
      }

      // Engagement threshold (sum of likes + retweets + replies)
      if (targeting.minEngagement && targeting.minEngagement > 0) {
        var engagement =
          (tweet.metrics && tweet.metrics.likes || 0) +
          (tweet.metrics && tweet.metrics.retweets || 0) +
          (tweet.metrics && tweet.metrics.replies || 0);
        if (engagement < targeting.minEngagement) return false;
      }

      return true;
    },

    /**
     * Get all currently-visible tweet <article> elements.
     * @returns {NodeListOf<HTMLElement>}
     */
    getVisibleTweets: function () {
      return document.querySelectorAll('article[data-testid="tweet"]');
    },

    /**
     * Set up a MutationObserver that watches the timeline for new tweet
     * articles and invokes callback(articleElement) for each one.
     *
     * @param {function(HTMLElement): void} callback
     * @returns {MutationObserver} The observer (call .disconnect() to clean up)
     */
    observe: function (callback) {
      if (typeof callback !== 'function') {
        console.error('[XScroller] XDetector.observe() requires a callback function.');
        return null;
      }

      // Keep track of tweet IDs we've already reported
      var seenIds = new Set();
      var self = this;

      // Seed the set with tweets already on the page
      var existing = this.getVisibleTweets();
      for (var i = 0; i < existing.length; i++) {
        var tweet = this.extractTweet(existing[i]);
        if (tweet && tweet.id) seenIds.add(tweet.id);
      }

      var observer = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          var addedNodes = mutations[m].addedNodes;
          for (var n = 0; n < addedNodes.length; n++) {
            var node = addedNodes[n];
            if (!(node instanceof HTMLElement)) continue;

            // The node itself might be an article, or contain articles
            var articles;
            if (node.matches && node.matches('article[data-testid="tweet"]')) {
              articles = [node];
            } else if (node.querySelectorAll) {
              articles = node.querySelectorAll('article[data-testid="tweet"]');
            } else {
              articles = [];
            }

            for (var a = 0; a < articles.length; a++) {
              try {
                var tw = self.extractTweet(articles[a]);
                if (tw && tw.id && !seenIds.has(tw.id)) {
                  seenIds.add(tw.id);
                  callback(articles[a]);
                }
              } catch (err) {
                console.warn('[XScroller] Observer callback error:', err);
              }
            }
          }
        }
      });

      // Observe the main timeline container or fall back to <body>
      var timelineContainer =
        document.querySelector('[data-testid="primaryColumn"]') ||
        document.querySelector('main') ||
        document.body;

      observer.observe(timelineContainer, {
        childList: true,
        subtree: true,
      });

      console.log('[XScroller] Tweet observer started on:', timelineContainer.tagName);
      return observer;
    },
  };

  console.log('[XScroller] Detector module loaded.');
})();
