import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * XScroller - Gemini API Client
 * ==============================
 * Runs inside the MV3 service worker context (no `window`).
 * Imported via `importScripts('lib/gemini.js')` in service-worker.js.
 * Exposes `self.XGemini`.
 */
(function () {
  "use strict";

  // ─── Prompt Builder ────────────────────────────────────────────────

  function buildPrompt(tweet, persona, openlabsConfig, shouldPromote) {
    const exp = Array.isArray(persona.expertise)
      ? persona.expertise.join(", ")
      : persona.expertise;
    let sys =
      `You are ${persona.name}, ${persona.title} @ ${persona.company}. Tone: ${persona.tone}. Expertise: ${exp}.\n` +
      `Rules: <150 chars, no hashtags, natural/intellectual, end with period(.).`;

    if (shouldPromote) {
      sys += ` Mention ${persona.company} contextually, no sales pitch.`;
    } else {
      sys += ` Do NOT mention your company.`;
    }

    if (persona.customPrompt && persona.customPrompt.trim()) {
      sys += ` ${persona.customPrompt.trim()}`;
    }

    return {
      systemInstruction: sys,
      userPrompt: `Reply to @${tweet.authorHandle || tweet.author}: "${tweet.text}"`,
    };
  }

  // ─── Generate Reply ────────────────────────────────────────────────

  async function generateReply(
    apiKey,
    tweet,
    persona,
    openlabsConfig,
    shouldPromote,
  ) {
    if (!apiKey) {
      return { success: false, reply: "", error: "No API key configured." };
    }
    if (!tweet || !tweet.text) {
      return { success: false, reply: "", error: "Invalid tweet data." };
    }

    const { systemInstruction, userPrompt } = buildPrompt(
      tweet,
      persona,
      openlabsConfig,
      shouldPromote,
    );

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-3-flash-preview",
        systemInstruction: systemInstruction,
      });

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.95,
          topK: 10,
          maxOutputTokens: 512,
        },
      });

      const response = await result.response;
      const replyText = response.text()?.trim() ?? "";

      if (!replyText) {
        return {
          success: false,
          reply: "",
          error: "Empty response from Gemini.",
        };
      }

      return { success: true, reply: replyText };
    } catch (err) {
      console.error("[XGemini] generateReply() failed:", err);
      return {
        success: false,
        reply: "",
        error: err.message || "Network error.",
      };
    }
  }

  // ─── API Key Validation ────────────────────────────────────────────

  async function validateApiKey(apiKey) {
    if (!apiKey || !apiKey.trim()) {
      return { valid: false, error: "API key is empty." };
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-3-flash-preview",
      });

      const result = await model.generateContent({
        contents: [
          { role: "user", parts: [{ text: 'Say "ok" in one word.' }] },
        ],
        generationConfig: { maxOutputTokens: 8 },
      });

      const response = await result.response;
      if (response && response.text()) {
        return { valid: true };
      }
      return { valid: false, error: "Empty response" };
    } catch (err) {
      return { valid: false, error: err.message || "Network error." };
    }
  }

  // ─── Public API ────────────────────────────────────────────────────
  self.XGemini = {
    buildPrompt,
    generateReply,
    validateApiKey,
  };
})();
