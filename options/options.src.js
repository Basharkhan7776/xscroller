(function () {
  "use strict";

  // State
  let currentSection = "api";

  // DOM Elements
  const navItems = document.querySelectorAll(".sidebar-nav-item");
  const sections = document.querySelectorAll(".content-section");
  const saveBtns = document.querySelectorAll(".btn-save");

  // API Section
  const apiKeysContainer = document.getElementById("api-keys-container");
  const addKeyBtn = document.getElementById("btn-add-key");
  const validateKeysBtn = document.getElementById("btn-validate-keys");
  let apiKeysList = [];

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

  // API Keys UI rendering
  function renderApiKeys() {
    apiKeysContainer.innerHTML = "";
    apiKeysList.forEach((key, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "password-wrapper";
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "8px";

      const input = document.createElement("input");
      input.type = "password";
      input.id = `api-key-${index}`;
      input.className = "form-input";
      input.placeholder = "AIzaSy...";
      input.value = key;
      input.style.flex = "1";
      // Update state when typing
      input.addEventListener("input", (e) => {
        apiKeysList[index] = e.target.value;
      });

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "toggle-password";
      toggleBtn.textContent = "👁️";
      toggleBtn.style.position = "static";
      toggleBtn.style.transform = "none";
      toggleBtn.addEventListener("click", () => {
        if (input.type === "password") {
          input.type = "text";
          toggleBtn.textContent = "🔒";
        } else {
          input.type = "password";
          toggleBtn.textContent = "👁️";
        }
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-secondary";
      removeBtn.textContent = "✕";
      removeBtn.style.padding = "0 10px";
      removeBtn.addEventListener("click", () => {
        apiKeysList.splice(index, 1);
        if (apiKeysList.length === 0) apiKeysList.push("");
        renderApiKeys();
      });

      const statusBadge = document.createElement("span");
      statusBadge.id = `api-status-${index}`;
      statusBadge.className = "status-badge unchecked";
      statusBadge.textContent = "Unchecked";
      statusBadge.style.minWidth = "85px";

      wrapper.appendChild(input);
      wrapper.appendChild(toggleBtn);
      wrapper.appendChild(removeBtn);
      wrapper.appendChild(statusBadge);

      apiKeysContainer.appendChild(wrapper);
    });
  }

  // Event Listeners
  function setupListeners() {
    // Add Key
    addKeyBtn.addEventListener("click", () => {
      apiKeysList.push("");
      renderApiKeys();
    });

    // Validate Keys
    validateKeysBtn.addEventListener("click", validateAllKeys);

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
        "xscroller_api_keys",
        "xscroller_persona",
        "xscroller_openlabs",
        "xscroller_targeting",
        "xscroller_safety",
      ]);

      // API
      apiKeysList = Array.isArray(data.xscroller_api_keys) ? data.xscroller_api_keys : [];
      if (typeof data.xscroller_api_key === 'string' && data.xscroller_api_key) {
        apiKeysList.push(data.xscroller_api_key); // migration
      }
      if (apiKeysList.length === 0) apiKeysList.push("");
      renderApiKeys();

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

  // Validate API Keys
  async function validateAllKeys() {
    for (let i = 0; i < apiKeysList.length; i++) {
      const key = apiKeysList[i].trim();
      const statusBadge = document.getElementById(`api-status-${i}`);
      
      if (!key) {
        if (statusBadge) {
          statusBadge.className = "status-badge unchecked";
          statusBadge.textContent = "Empty";
        }
        continue;
      }

      if (statusBadge) {
        statusBadge.className = "status-badge checking";
        statusBadge.textContent = "Checking...";
      }

      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "VALIDATE_API_KEY", apiKey: key }, resolve);
        });

        if (chrome.runtime.lastError || !response) {
          if (statusBadge) {
            statusBadge.className = "status-badge invalid";
            statusBadge.textContent = "Network Error";
          }
          continue;
        }

        if (response.valid) {
          if (statusBadge) {
            statusBadge.className = "status-badge valid";
            statusBadge.textContent = "Valid";
          }
        } else {
          if (statusBadge) {
            statusBadge.className = "status-badge invalid";
            statusBadge.textContent = "Invalid Key";
          }
        }
      } catch (e) {
        console.error(e);
        if (statusBadge) {
          statusBadge.className = "status-badge invalid";
          statusBadge.textContent = "Error";
        }
      }
    }
    // Auto-save the keys after validation
    saveSection("api");
  }

  // Save specific section
  async function saveSection(section) {
    try {
      let updates = {};

      if (section === "api") {
        updates["xscroller_api_keys"] = apiKeysList.map(k => k.trim()).filter(Boolean);
        // Refresh UI with cleaned array
        apiKeysList = [...updates["xscroller_api_keys"]];
        if (apiKeysList.length === 0) apiKeysList.push("");
        renderApiKeys();
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
