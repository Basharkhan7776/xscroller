/**
 * XScroller - Persona Management
 * ================================
 * IIFE pattern exposing window.XPersona for content script contexts.
 * Handles persona loading, updating, promotion gating, and prompt formatting.
 * Depends on window.XStorage (loaded before this script in the manifest).
 */
(function () {
  'use strict';

  // ─── Persona Retrieval ─────────────────────────────────────────────

  /**
   * Load the current persona from storage.
   * Always returns a fully-populated object (missing fields filled from defaults).
   * @returns {Promise<Object>}
   */
  async function getPersona() {
    const persona = await window.XStorage.get(window.XStorage.KEYS.PERSONA);
    const defaults = window.XStorage.DEFAULTS[window.XStorage.KEYS.PERSONA];
    // Merge defaults under the stored values so new keys are always present
    return { ...defaults, ...persona };
  }

  // ─── Persona Update ────────────────────────────────────────────────

  /**
   * Partially update the stored persona. Only the provided keys are overwritten;
   * all other fields remain unchanged.
   * @param {Object} updates - Subset of persona fields to update
   * @returns {Promise<Object>} The updated persona
   */
  async function updatePersona(updates) {
    const current = await getPersona();
    const updated = { ...current, ...updates };
    await window.XStorage.set(window.XStorage.KEYS.PERSONA, updated);
    return updated;
  }

  // ─── Promotion Gate ────────────────────────────────────────────────

  /**
   * Randomly decide whether a reply should include an OpenLabs mention
   * based on the configured promotion frequency percentage.
   *
   * @param {number} frequency - Percentage (0-100) chance of promoting
   * @returns {boolean}
   */
  function shouldPromoteThisTime(frequency) {
    if (typeof frequency !== 'number' || frequency <= 0) return false;
    if (frequency >= 100) return true;
    return Math.random() * 100 < frequency;
  }

  // ─── Prompt Formatting ─────────────────────────────────────────────

  /**
   * Format a persona object into a concise human-readable string
   * suitable for injecting into an AI prompt or displaying in the UI.
   *
   * @param {Object} persona
   * @returns {string}
   */
  function formatPersonaForPrompt(persona) {
    const expertise = Array.isArray(persona.expertise)
      ? persona.expertise.join(', ')
      : persona.expertise || 'general topics';

    const parts = [
      `Name: ${persona.name || 'Anonymous'}`,
      `Role: ${persona.title || 'Member'} at ${persona.company || 'N/A'}`,
      `About: ${persona.description || 'No description provided.'}`,
      `Tone: ${persona.tone || 'professional'}`,
      `Expertise: ${expertise}`,
    ];

    if (persona.customPrompt && persona.customPrompt.trim()) {
      parts.push(`Custom Instructions: ${persona.customPrompt.trim()}`);
    }

    return parts.join('\n');
  }

  // ─── Public API ────────────────────────────────────────────────────
  window.XPersona = {
    getPersona,
    updatePersona,
    shouldPromoteThisTime,
    formatPersonaForPrompt,
  };
})();
