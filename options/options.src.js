
(function () {
  "use strict";

  // State
  let currentSection = "api";

  // DOM Elements
  const navItems = document.querySelectorAll(".sidebar-nav-item");
  const sections = document.querySelectorAll(".content-section");
  const saveBtns = document.querySelectorAll(".btn-save");

  // API Section
  const apiKeyInput = document.getElementById("api-key");
  const toggleApiKeyBtn = document.getElementById("toggle-api-key");
  const validateKeyBtn = document.getElementById("btn-validate-key");
  const apiStatus = document.getElementById("api-status");

  // Persona Section
  const pName = document.getElementById("persona-name");
  const pTitle = document.getElementById("persona-title");
  const pCompany = document.getElementById("persona-company");
  const pDesc = document.getElementById("persona-desc");
  const pTone = document.getElementById("persona-tone");

  // OpenLabs Section
  const olUrl = document.getElementById("ol-url");
  const olTagline = document.getElementById("ol-tagline");
  const olFreq = document.getElementById("ol-freq");
  const olFreqVal = document.getElementById("ol-freq-val");

  // Targeting Section
  const tMinFollowers = document.getElementById("target-min-followers");
  const tMinEngagement = document.getElementById("target-min-engagement");

  // Safety Section
  const sLimit = document.getElementById("safety-limit");
  const sDelayMin = document.getElementById("safety-delay-min");
  const sDelayMax = document.getElementById("safety-delay-max");

  // Initialization
  async function init() {
    setupNavigation();
    setupListeners();
    await loadData();
  }

  // Navigation
  function setupNavigation() {
    navItems.forEach((item) => {
      item.addEventListener("click", () => {
        // Update active nav
        navItems.forEach((n) => n.classList.remove("active"));
        item.classList.add("active");

        // Show target section
        const targetId = item.getAttribute("data-target");
        sections.forEach((s) => s.classList.remove("active"));
        document.getElementById(`section-${targetId}`).classList.add("active");
        currentSection = targetId;
      });
    });
  }

  // Event Listeners
  function setupListeners() {
    // API key visibility toggle
    toggleApiKeyBtn.addEventListener("click", () => {
      if (apiKeyInput.type === "password") {
        apiKeyInput.type = "text";
        toggleApiKeyBtn.textContent = "🔒";
      } else {
        apiKeyInput.type = "password";
        toggleApiKeyBtn.textContent = "👁️";
      }
    });

    // Validate API Key
    validateKeyBtn.addEventListener("click", validateApiKey);

    // Slider value update
    olFreq.addEventListener("input", (e) => {
      olFreqVal.textContent = `${e.target.value}%`;
    });

    // Save buttons
    saveBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const section = btn.getAttribute("data-section");
        saveSection(section);
      });
    });
  }

  // Load data from storage
  async function loadData() {
    try {
      const data = await chrome.storage.local.get([
        "xscroller_api_key",
        "xscroller_persona",
        "xscroller_openlabs",
        "xscroller_targeting",
        "xscroller_safety",
      ]);

      // API
      if (data.xscroller_api_key) {
        apiKeyInput.value = data.xscroller_api_key;
        apiStatus.className = "status-badge unchecked";
        apiStatus.textContent = "Unchecked";
      }

      // Persona
      if (data.xscroller_persona) {
        const p = data.xscroller_persona;
        pName.value = p.name || "";
        pTitle.value = p.title || "";
        pCompany.value = p.company || "";
        pDesc.value = p.description || "";
        if (p.tone) pTone.value = p.tone;
      }

      // OpenLabs
      if (data.xscroller_openlabs) {
        const ol = data.xscroller_openlabs;
        olUrl.value = ol.url || "";
        olTagline.value = ol.tagline || "";
        olFreq.value = ol.promotionFrequency || 30;
        olFreqVal.textContent = `${olFreq.value}%`;
      }

      // Targeting
      if (data.xscroller_targeting) {
        const t = data.xscroller_targeting;
        tMinFollowers.value = t.minFollowers || 0;
        tMinEngagement.value = t.minEngagement || 0;
      }

      // Safety
      if (data.xscroller_safety) {
        const s = data.xscroller_safety;
        sLimit.value = s.dailyLimit || 20;
        sDelayMin.value = s.delayMin || 5;
        sDelayMax.value = s.delayMax || 10;
      }
    } catch (e) {
      console.error("Failed to load settings", e);
    }
  }

  // Validate API Key
  async function validateApiKey() {
    const key = apiKeyInput.value.trim();
    if (!key) return;

    apiStatus.className = "status-badge checking";
    apiStatus.textContent = "Checking...";

    try {
      chrome.runtime.sendMessage(
        { type: "VALIDATE_API_KEY", apiKey: key },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            apiStatus.className = "status-badge invalid";
            apiStatus.textContent = "Network Error";
            return;
          }

          if (response && response.valid) {
            apiStatus.className = "status-badge valid";
            apiStatus.textContent = "Valid";
            // Auto-save the key when valid
            saveSection("api");
          } else {
            apiStatus.className = "status-badge invalid";
            apiStatus.textContent = "Invalid Key";
          }
        }
      );
    } catch (e) {
      console.error(e);
      apiStatus.className = "status-badge invalid";
      apiStatus.textContent = "Network Error";
    }
  }

  // Save specific section
  async function saveSection(section) {
    try {
      let updates = {};

      if (section === "api") {
        updates["xscroller_api_key"] = apiKeyInput.value.trim();
      } else if (section === "persona") {
        updates["xscroller_persona"] = {
          name: pName.value.trim(),
          title: pTitle.value.trim(),
          company: pCompany.value.trim(),
          description: pDesc.value.trim(),
          tone: pTone.value,
          expertise: [], // simplified for now
          customPrompt: "",
        };
      } else if (section === "openlabs") {
        updates["xscroller_openlabs"] = {
          url: olUrl.value.trim(),
          tagline: olTagline.value.trim(),
          features: [],
          promotionFrequency: parseInt(olFreq.value, 10),
        };
      } else if (section === "targeting") {
        updates["xscroller_targeting"] = {
          keywords: [],
          avoidKeywords: [],
          minFollowers: parseInt(tMinFollowers.value, 10) || 0,
          minEngagement: parseInt(tMinEngagement.value, 10) || 0,
        };
      } else if (section === "safety") {
        updates["xscroller_safety"] = {
          dailyLimit: parseInt(sLimit.value, 10) || 20,
          delayMin: parseInt(sDelayMin.value, 10) || 30,
          delayMax: parseInt(sDelayMax.value, 10) || 120,
          blacklistedUsers: [],
        };
      }

      await chrome.storage.local.set(updates);

      // Try to notify background to reload settings
      try {
        chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS" });
      } catch (e) {
        // Ignore if background isn't listening yet
      }

      // Visual feedback on the save button
      const btn = document.querySelector(
        `.btn-save[data-section="${section}"]`,
      );
      if (btn) {
        const originalText = btn.textContent;
        btn.textContent = "Saved! ✅";
        btn.classList.replace("btn-primary", "btn-success");
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.replace("btn-success", "btn-primary");
        }, 2000);
      }
    } catch (e) {
      console.error(`Failed to save ${section}`, e);
      alert("Error saving settings");
    }
  }

  // Boot
  document.addEventListener("DOMContentLoaded", init);
})();
