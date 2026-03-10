(function () {
  "use strict";

  const markdownInput = document.getElementById("markdownInput");
  const importBtn = document.getElementById("importBtn");
  const clearBtn = document.getElementById("clearBtn");
  const publishBtn = document.getElementById("publishBtn");
  const fileInput = document.getElementById("fileInput");
  const charCount = document.getElementById("charCount");
  const status = document.getElementById("status");

  chrome.storage.local.get(["xphDraft"], (result) => {
    const draft = result.xphDraft || "";
    markdownInput.value = draft;
    updateCount();
  });

  markdownInput.addEventListener("input", () => {
    updateCount();
    chrome.storage.local.set({ xphDraft: markdownInput.value });
  });

  importBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      markdownInput.value = String(reader.result || "");
      updateCount();
      chrome.storage.local.set({ xphDraft: markdownInput.value });
      setStatus(`Loaded ${file.name}`);
    };
    reader.readAsText(file);
  });

  clearBtn.addEventListener("click", () => {
    markdownInput.value = "";
    updateCount();
    chrome.storage.local.set({ xphDraft: "" });
    setStatus("Cleared.");
  });

  publishBtn.addEventListener("click", async () => {
    const markdown = markdownInput.value.trim();
    if (!markdown) {
      setStatus("Please paste markdown first.");
      return;
    }

    publishBtn.disabled = true;
    publishBtn.textContent = "Starting...";

    try {
      const result = await chrome.runtime.sendMessage({
        type: "start-publish",
        markdown,
      });

      if (!result?.success) {
        throw new Error(result?.error || "start failed");
      }

      setStatus("Opened X Articles. Auto-paste will run in the editor page.");
      publishBtn.textContent = "Open X and Publish";
      publishBtn.disabled = false;
      window.close();
    } catch (err) {
      setStatus(`Failed: ${err.message}`);
      publishBtn.textContent = "Open X and Publish";
      publishBtn.disabled = false;
    }
  });

  function updateCount() {
    charCount.textContent = `${markdownInput.value.length} chars`;
  }

  function setStatus(text) {
    status.textContent = text;
  }
})();
