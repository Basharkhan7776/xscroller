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
          console.log('[XScroller] Clicked reply button, waiting for composer modal\u2026');

          // Wait specifically for the textbox INSIDE a dialog/modal so we don't accidentally grab the main "What is happening?!" box!
          var replyBox = await waitForElement(
            '[role="dialog"] [data-testid="tweetTextarea_0"], [role="dialog"] [role="textbox"][contenteditable="true"]'
          );

          // Fallback if it's an inline reply (e.g. on a status page directly)
          if (!replyBox) {
            var boxes = document.querySelectorAll('[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]');
            for (var i = 0; i < boxes.length; i++) {
               // Avoid the main composer
               if (!boxes[i].closest('[data-testid="createTweet"]')) {
                 replyBox = boxes[i];
                 break;
               }
            }
          }

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
          replyBox.focus();
          replyBox.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
          await self.randomDelay(100, 300);

          // Use DataTransfer to simulate a real paste. This wakes up Draft.js/Lexical.
          var dataTransfer = new DataTransfer();
          dataTransfer.setData('text/plain', text);
          var pasteEvent = new ClipboardEvent('paste', {
            clipboardData: dataTransfer,
            bubbles: true,
            cancelable: true
          });
          replyBox.dispatchEvent(pasteEvent);

          // Fallback: if paste didn't insert text into the DOM, use execCommand as backup
          await self.randomDelay(100, 200);
          if (replyBox.innerText.indexOf(text.substring(0, 5)) === -1) {
             document.execCommand('insertText', false, text);
             replyBox.dispatchEvent(new Event('input', { bubbles: true }));
          }

          console.log('[XScroller] Inserted text into reply box.');
        } catch (err) {
          console.error('[XScroller] typeReply error:', err);
        }
      })();
    },

    submitReply: function (replyBox) {
      var self = this;
      return (async function () {
        try {
          // Poll for the button to become enabled
          var submitBtn = null;
          var elapsed = 0;
          while (elapsed < 3000) {
            submitBtn = document.querySelector('[data-testid="tweetButtonInline"]') || 
                        document.querySelector('[data-testid="tweetButton"]');
            
            if (submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true') {
              break; 
            }
            await self.randomDelay(200, 300);
            elapsed += 250;
          }

          if (submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true') {
            submitBtn.click();
            console.log('[XScroller] Clicked submit button.');
            await self.randomDelay(500, 1000);
            return true;
          }

          // Fallback if button is still disabled: try Ctrl+Enter on the reply box itself
          if (replyBox) {
            console.log('[XScroller] Button still disabled. Trying Ctrl+Enter on reply box.');
            replyBox.dispatchEvent(new KeyboardEvent('keydown', {
              bubbles: true, cancelable: true,
              key: 'Enter', code: 'Enter', keyCode: 13,
              ctrlKey: true, metaKey: true
            }));
            await self.randomDelay(500, 1000);
            return true;
          }

          return false;
        } catch (err) {
          console.error('[XScroller] submitReply error:', err);
          return false;
        }
      })();
    },

    /**
     * Complete the reply flow when the reply box is ALREADY open.
     * @param {HTMLElement} replyBox - The already-open contenteditable box
     * @param {string} replyText - The text to reply with
     * @returns {Promise<{ success: boolean, error: string|null }>}
     */
    sendReplyAlreadyOpen: function (replyBox, replyText) {
      var self = this;
      self.isReplying = true;
      console.log('[XScroller] Starting already-open reply flow\u2026');

      return (async function () {
        try {
          if (!replyBox) return { success: false, error: 'Reply box is missing' };

          await self.randomDelay(500, 1000);
          await self.typeReply(replyBox, replyText);
          await self.randomDelay(500, 1000);
          
          var submitted = await self.submitReply(replyBox);
          await self.randomDelay(1000, 1500);

          // Verify if the dialog is still open
          var stillOpenBtn = document.querySelector('[data-testid="tweetButtonInline"]') || 
                             document.querySelector('[data-testid="tweetButton"]');
                             
          if (stillOpenBtn) {
            console.warn('[XScroller] Reply window STILL open. Trying to escape and discard.');
            await self.closeReplyBox();
            return { success: false, error: 'Reply stuck, escaped out.' };
          }

          return { success: submitted, error: submitted ? null : 'Could not submit reply' };
        } catch (err) {
          console.error('[XScroller] sendReplyAlreadyOpen error:', err);
          return { success: false, error: err.message || String(err) };
        } finally {
          self.isReplying = false;
        }
      })();
    },

    /**
     * Execute the full reply flow: open -> type -> submit.
     * (Used mostly by the review mode manual trigger)
     *
     * @param {HTMLElement} tweetArticle - The tweet's <article> element
     * @param {string} replyText - The text to reply with
     * @returns {Promise<{ success: boolean, error: string|null }>}
     */
    sendReply: function (tweetArticle, replyText) {
      var self = this;
      return (async function () {
         var replyBox = await self.openReplyBox(tweetArticle);
         if (!replyBox) return { success: false, error: 'Could not open reply box' };
         return await self.sendReplyAlreadyOpen(replyBox, replyText);
      })();
    },

    closeReplyBox: function () {
      var self = this;
      return (async function () {
        try {
          // 1. Try clicking the 'Close' button
          var closeBtn = document.querySelector('[aria-label="Close"]') || 
                         document.querySelector('[data-testid="app-bar-close"]');
                         
          if (closeBtn) {
            closeBtn.click();
            await self.randomDelay(300, 500);
            
            // 2. If a "Discard" confirmation appears, click "Discard"
            var discardBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
            if (discardBtn) {
              discardBtn.click();
              await self.randomDelay(300, 500);
            }
          } else {
             // 3. Fallback: synthetic Escape key
             document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
             document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
          }
          console.log('[XScroller] Forced reply box closed.');
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
