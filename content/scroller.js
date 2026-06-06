/**
 * XScroller - Auto-Scroll Module
 * Handles smooth, human-like scrolling of the Twitter/X feed.
 *
 * Load order: storage.js -> persona.js -> detector.js -> scroller.js
 * Exposes: window.XScroller
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Constants                                                          */
  /* ------------------------------------------------------------------ */

  var SCROLL_INTERVAL_MS = 50; // Interval between scroll ticks

  /**
   * Maps speed (1-10) to base pixels per tick.
   * speed 1 = 1px, speed 5 = 3px, speed 10 = 8px
   * Linear interpolation: px = 1 + (speed - 1) * (7 / 9)
   */
  function speedToPixels(speed) {
    var clamped = Math.max(1, Math.min(10, speed));
    return 1 + (clamped - 1) * (7 / 9);
  }

  /* ------------------------------------------------------------------ */
  /*  Core API                                                           */
  /* ------------------------------------------------------------------ */

  window.XScroller = {

    /** Whether the scroller is actively running */
    isScrolling: false,

    /** Current speed setting (1-10) */
    speed: 5,

    /** ID of the running setInterval, or null */
    scrollInterval: null,

    /** Temporarily paused (interval still runs but scroll is skipped) */
    isPaused: false,

    /**
     * Start auto-scrolling at the given speed.
     * @param {number} [speed] - Speed 1-10 (defaults to current this.speed)
     */
    start: function (speed) {
      if (typeof speed === 'number') {
        this.speed = Math.max(1, Math.min(10, speed));
      }

      // Clear any existing interval to avoid doubles
      if (this.scrollInterval) {
        clearInterval(this.scrollInterval);
        this.scrollInterval = null;
      }

      var basePixels = speedToPixels(this.speed);
      var self = this;

      this.scrollInterval = setInterval(function () {
        if (self.isPaused) return;

        // Randomise scroll amount +/- 20% for human-like behaviour
        var jitter = 1 + (Math.random() * 0.4 - 0.2); // 0.8 - 1.2
        var px = Math.round(basePixels * jitter * 100) / 100;

        window.scrollBy({ top: px, behavior: 'instant' });
      }, SCROLL_INTERVAL_MS);

      this.isScrolling = true;
      this.isPaused = false;

      console.log(
        '[XScroller] Scrolling started - speed ' + this.speed +
        ' (' + basePixels.toFixed(1) + ' px/tick)'
      );
    },

    /**
     * Stop scrolling completely. Clears the interval.
     */
    stop: function () {
      if (this.scrollInterval) {
        clearInterval(this.scrollInterval);
        this.scrollInterval = null;
      }
      this.isScrolling = false;
      this.isPaused = false;
      console.log('[XScroller] Scrolling stopped.');
    },

    /**
     * Temporarily pause scrolling. The interval keeps running but
     * scroll calls are skipped, so resume is instant.
     */
    pause: function () {
      this.isPaused = true;
      console.log('[XScroller] Scrolling paused.');
    },

    /**
     * Resume after a pause.
     */
    resume: function () {
      this.isPaused = false;
      console.log('[XScroller] Scrolling resumed.');
    },

    /**
     * Update speed. If currently scrolling, restarts the interval
     * to apply the new speed.
     * @param {number} speed - New speed 1-10
     */
    setSpeed: function (speed) {
      this.speed = Math.max(1, Math.min(10, speed));
      if (this.isScrolling) {
        this.stop();
        this.start(this.speed);
      }
      console.log('[XScroller] Speed set to ' + this.speed + '.');
    },

    /**
     * Pause scrolling for a given duration then automatically resume.
     * Useful when processing a tweet (replying, etc.).
     * @param {number} ms - Milliseconds to pause
     * @returns {Promise<void>}
     */
    pauseFor: function (ms) {
      var self = this;
      self.pause();
      return new Promise(function (resolve) {
        setTimeout(function () {
          if (self.isScrolling) {
            self.resume();
          }
          resolve();
        }, ms);
      });
    },
  };

  console.log('[XScroller] Scroller module loaded.');
})();
