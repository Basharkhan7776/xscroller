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
    const expertiseList = Array.isArray(persona.expertise)
      ? persona.expertise.join(", ")
      : persona.expertise;

    // ── System instruction (persona definition + guardrails) ──
    let systemInstruction =
      `You are ${persona.name}, ${persona.title} at ${persona.company}. ` +
      `${persona.description}. ` +
      `Your tone is ${persona.tone}. ` +
      `You're an expert in ${expertiseList}.\n\n` +
      "Rules:\n" +
      "• Reply to tweets naturally — that everyone open your profile.\n" +
      "• Keep replies under 150 characters.\n" +
      "• Never use hashtags.\n" +
      "• Sound like a real person, not a bot.\n" +
      "• Be concise but make sure to cover everything important like intellectual.\n" +
      "• Match the energy / register of the original tweet.";

    if (shouldPromote) {
      systemInstruction +=
        `\n\n` +
        `Naturally weave in a mention of your work at ${persona.company} (${openlabsConfig.url}) — ` +
        `"${openlabsConfig.tagline}". ` +
        `Don't be salesy or forced; just mention it as relevant context when it fits the conversation.`;
    } else {
      systemInstruction +=
        "\n\nDo NOT mention OpenLabs, your company, or any product in this reply. Just be helpful.";
    }

    if (persona.customPrompt && persona.customPrompt.trim()) {
      systemInstruction += `\n\nAdditional instructions: ${persona.customPrompt.trim()}`;
    }

    const userPrompt =
      `Reply to this tweet by @${tweet.authorHandle || tweet.author}:\n` +
      `"${tweet.text}"`;

    return { systemInstruction, userPrompt };
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
          maxOutputTokens: 325,
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
