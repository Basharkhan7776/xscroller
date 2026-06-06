/**
 * XScroller - Reply Automation Module
 * Handles opening Twitter's reply box, typing text with human-like
 * delays, and submitting replies.
 *
 * Load order: storage.js -> persona.js -> detector.js -> scroller.js -> replier.js
 * Exposes: window.XReplier
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Constants                                                          */
  /* ------------------------------------------------------------------ */

  /** Max time (ms) to wait for a DOM element to appear */
  var POLL_TIMEOUT = 5000;

  /** Polling interval when waiting for an element */
  var POLL_INTERVAL = 200;

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Wait for a selector to appear in the DOM, polling at intervals.
   * @param {string} selector
   * @param {number} [timeout]
   * @param {HTMLElement} [root]
   * @returns {Promise<HTMLElement|null>}
   */
  function waitForElement(selector, timeout, root) {
    timeout = timeout || POLL_TIMEOUT;
    root = root || document;

    return new Promise(function (resolve) {
      var existing = root.querySelector(selector);
      if (existing) return resolve(existing);

      var start = Date.now();
      var interval = setInterval(function () {
        var el = root.querySelector(selector);
        if (el) {
          clearInterval(interval);
          resolve(el);
        } else if (Date.now() - start > timeout) {
          clearInterval(interval);
          resolve(null);
        }
      }, POLL_INTERVAL);
    });
  }

  /**
   * Return a random integer between min and max (inclusive).
   */
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /* ------------------------------------------------------------------ */
  /*  Core API                                                           */
  /* ------------------------------------------------------------------ */

  window.XReplier = {

    /** Whether a reply is currently being sent */
    isReplying: false,

    /** Local queue of approved replies awaiting delivery */
    replyQueue: [],

    /**
     * Click the reply button on a tweet and wait for the reply
     * composer to appear.
     *
     * @param {HTMLElement} tweetArticle - The <article> element for the tweet
     * @returns {Promise<HTMLElement|null>} The contenteditable reply box, or null
     */
    openReplyBox: function (tweetArticle) {
      return (async function () {
        try {
          var replyBtn = tweetArticle.querySelector('[data-testid="reply"]');
          if (!replyBtn) {
            console.warn('[XScroller] Reply button not found on tweet.');
            return null;
          }

          // Click the reply button
          replyBtn.click();
          console.log('[XScroller] Clicked reply button, waiting for composer\u2026');

          // Twitter opens a modal or inline box with a contenteditable div
          // The reply box uses data-testid="tweetTextarea_0" (contenteditable)
          // or a <div role="textbox"> inside the modal
          var replyBox = await waitForElement(
            '[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]'
          );

          if (!replyBox) {
            console.warn('[XScroller] Reply composer did not appear in time.');
            return null;
          }

          console.log('[XScroller] Reply composer opened.');
          return replyBox;
        } catch (err) {
          console.error('[XScroller] openReplyBox error:', err);
          return null;
        }
      })();
    },

    typeReply: function (replyBox, text) {
      var self = this;
      return (async function () {
        if (!replyBox || !text) return;

        try {
          // Focus the element
          replyBox.focus();

          // Dispatch a focus event to make sure React picks it up
          replyBox.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

          // Small delay after focus
          await self.randomDelay(100, 300);

          // Insert text at once instead of char by char to prevent duplicating prefixes
          document.execCommand('insertText', false, text);
          
          // Force React to recognize the change
          replyBox.dispatchEvent(new Event('input', { bubbles: true }));
          replyBox.dispatchEvent(new Event('change', { bubbles: true }));

          console.log('[XScroller] Pasted ' + text.length + ' characters into reply box.');
        } catch (err) {
          console.error('[XScroller] typeReply error:', err);
        }
      })();
    },

    /**
     * Click the tweet/reply submit button or press Ctrl+Enter.
     * @returns {Promise<boolean>} true if the button was found and clicked
     */
    submitReply: function (replyBox) {
      var self = this;
      return (async function () {
        try {
          if (replyBox) {
            // First attempt: simulate Ctrl+Enter
            replyBox.dispatchEvent(new KeyboardEvent('keydown', {
              bubbles: true, cancelable: true,
              key: 'Enter', code: 'Enter', keyCode: 13,
              ctrlKey: true
            }));
            console.log('[XScroller] Dispatched Ctrl+Enter on reply box.');
            await self.randomDelay(300, 600);
          }

          // Second attempt: Fallback to clicking the button (wait for it to become enabled)
          var submitBtn = null;
          var elapsed = 0;
          while (elapsed < 3000) {
            submitBtn = document.querySelector('[data-testid="tweetButtonInline"]') || 
                        document.querySelector('[data-testid="tweetButton"]');
            
            if (submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true') {
              break; // Button is enabled!
            }
            await self.randomDelay(200, 300);
            elapsed += 250;
          }

          if (!submitBtn) {
            console.warn('[XScroller] Submit button not found (it may have already submitted via Ctrl+Enter).');
            return true; 
          }

          if (!submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true') {
            submitBtn.click();
            console.log('[XScroller] Reply submitted via button click.');
          } else {
            console.warn('[XScroller] Submit button still disabled after waiting. Forcing click anyway.');
            submitBtn.click();
          }

          // Brief pause to let Twitter process
          await self.randomDelay(500, 1000);
          return true;
        } catch (err) {
          console.error('[XScroller] submitReply error:', err);
          return false;
        }
      })();
    },

    /**
     * Execute the full reply flow: open -> type -> submit.
     *
     * @param {HTMLElement} tweetArticle - The tweet's <article> element
     * @param {string} replyText - The text to reply with
     * @returns {Promise<{ success: boolean, error: string|null }>}
     */
    sendReply: function (tweetArticle, replyText) {
      var self = this;
      self.isReplying = true;
      console.log('[XScroller] Starting reply flow\u2026');

      return (async function () {
        try {
          // 1. Open reply box
          var replyBox = await self.openReplyBox(tweetArticle);
          if (!replyBox) {
            return { success: false, error: 'Could not open reply box' };
          }

          // 2. Natural pause before typing
          await self.randomDelay(500, 1500);

          // 3. Type the reply
          await self.typeReply(replyBox, replyText);

          // 4. Pause before submitting (review moment)
          await self.randomDelay(300, 800);

          // 5. Submit
          var submitted = await self.submitReply(replyBox);

          // 6. Verify if it closed
          await self.randomDelay(800, 1200);

          // Check if the submit button or text area is still visible (meaning it didn't submit)
          var stillOpenBtn = document.querySelector('[data-testid="tweetButtonInline"]') || 
                             document.querySelector('[data-testid="tweetButton"]');
                             
          if (stillOpenBtn && !stillOpenBtn.disabled && stillOpenBtn.getAttribute('aria-disabled') !== 'true') {
            console.log('[XScroller] Reply window seems still open. Trying Ctrl+Enter again...');
            replyBox.dispatchEvent(new KeyboardEvent('keydown', {
              bubbles: true, cancelable: true,
              key: 'Enter', code: 'Enter', keyCode: 13,
              ctrlKey: true, metaKey: true
            }));
            
            await self.randomDelay(1000, 1500);
            
            // Check one last time
            stillOpenBtn = document.querySelector('[data-testid="tweetButtonInline"]') || 
                           document.querySelector('[data-testid="tweetButton"]');
            if (stillOpenBtn) {
              console.warn('[XScroller] Reply window STILL open. Pressing Escape to clear it so we can resume scrolling.');
              await self.closeReplyBox();
              return { success: false, error: 'Reply stuck, escaped out.' };
            }
          }

          return {
            success: submitted,
            error: submitted ? null : 'Could not submit reply',
          };
        } catch (err) {
          console.error('[XScroller] sendReply error:', err);
          return { success: false, error: err.message || String(err) };
        } finally {
          self.isReplying = false;
        }
      })();
    },

    /**
     * Close any open reply dialogs by pressing Escape.
     * @returns {Promise<void>}
     */
    closeReplyBox: function () {
      var self = this;
      return (async function () {
        try {
          document.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              code: 'Escape',
              keyCode: 27,
              bubbles: true,
              cancelable: true,
            })
          );
          await self.randomDelay(200, 400);
          console.log('[XScroller] Reply box closed.');
        } catch (err) {
          console.warn('[XScroller] closeReplyBox error:', err);
        }
      })();
    },

    /**
     * Return a promise that resolves after a random delay between
     * min and max milliseconds.
     * @param {number} min
     * @param {number} max
     * @returns {Promise<void>}
     */
    randomDelay: function (min, max) {
      var delay = randInt(min, max);
      return new Promise(function (r) { setTimeout(r, delay); });
    },
  };

  console.log('[XScroller] Replier module loaded.');
})();
