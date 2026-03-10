const X_ARTICLE_URL = "https://x.com/compose/articles";

const publishState = {
  currentTask: null,
  currentTabId: null,
  sentForUrl: null,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "start-publish") {
    startPublish(message.markdown)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message?.type === "fetch-image") {
    fetchImageAsBase64(message.url)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function startPublish(markdown) {
  const clean = String(markdown || "").trim();
  if (!clean) throw new Error("Empty markdown");

  publishState.currentTask = {
    id: `x_${Date.now()}`,
    markdown: clean,
    startedAt: Date.now(),
  };

  const tabs = await chrome.tabs.query({ url: "*://x.com/compose/articles*" });
  let targetTab = tabs[0] || null;

  if (targetTab?.id) {
    await chrome.tabs.update(targetTab.id, { active: true });
  } else {
    targetTab = await chrome.tabs.create({ url: X_ARTICLE_URL, active: true });
  }

  publishState.currentTabId = targetTab.id;
  publishState.sentForUrl = null;
  await waitForContentScriptReady(targetTab.id);
}

async function waitForContentScriptReady(tabId) {
  const maxAttempts = 30;
  let attempts = 0;

  const timer = setInterval(async () => {
    attempts += 1;
    try {
      await chrome.tabs.sendMessage(tabId, { type: "ping" });
      clearInterval(timer);

      const task = publishState.currentTask;
      if (!task) return;

      const tab = await chrome.tabs.get(tabId);
      const tabUrl = tab?.url || "";
      if (publishState.sentForUrl === tabUrl && tabUrl) return;
      publishState.sentForUrl = tabUrl;

      await chrome.tabs.sendMessage(tabId, {
        type: "distribution-active",
        distributionId: task.id,
        markdown: task.markdown,
        platform: "x",
      });
    } catch (_) {
      if (attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }
  }, 500);
}

async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const blob = await response.blob();
    const mimeType = blob.type || "image/png";

    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

    return {
      success: true,
      base64: btoa(binary),
      mimeType,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
