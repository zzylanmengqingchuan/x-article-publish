(function () {
  "use strict";

  let pendingMarkdown = null;
  let autoRunTimer = null;
  let isAutoRunning = false;

  function debug(...args) {
    console.log("[XPH]", ...args);
  }

  function showToast(message, type, existing) {
    let container = document.getElementById("xph-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "xph-toast-container";
      container.style.cssText = "position:fixed;top:22px;right:22px;z-index:999999;display:flex;flex-direction:column;gap:8px;";
      document.body.appendChild(container);
    }

    const palette = {
      progress: "linear-gradient(135deg,#0ea5e9,#22d3ee)",
      success: "linear-gradient(135deg,#10b981,#34d399)",
      warn: "linear-gradient(135deg,#f59e0b,#f97316)",
    };

    const toast = existing || document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = [
      "padding:10px 14px",
      "border-radius:10px",
      "font:600 13px/1.4 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
      "color:#fff",
      `background:${palette[type] || palette.progress}`,
      "box-shadow:0 10px 30px rgba(0,0,0,.22)",
      "max-width:360px",
    ].join(";");

    if (!existing) {
      container.appendChild(toast);
    }

    if (toast._hideTimer) {
      clearTimeout(toast._hideTimer);
      toast._hideTimer = null;
    }

    if (type !== "progress") {
      toast._hideTimer = setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 200);
      }, 2600);
    }

    return toast;
  }

  function detectXArticlePage() {
    return location.hostname === "x.com" && location.pathname.startsWith("/compose/articles");
  }

  function detectEditorReady() {
    if (!detectXArticlePage()) return false;
    const editor = document.querySelector("[contenteditable='true']");
    if (!editor) return false;
    if (editor.getAttribute("aria-hidden") === "true") return false;
    const rect = editor.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function queueAutoPaste(markdown) {
    pendingMarkdown = markdown;
    debug("queued markdown", { length: markdown?.length || 0, url: location.href });
    if (autoRunTimer) return;

    autoRunTimer = setInterval(async () => {
      if (!pendingMarkdown || isAutoRunning) return;
      if (!detectEditorReady()) return;

      isAutoRunning = true;
      const md = pendingMarkdown;
      pendingMarkdown = null;

      try {
        await runAutoPaste(md);
      } catch (err) {
        pendingMarkdown = md;
        debug("runAutoPaste failed", err?.message || err);
        showToast(`Auto publish failed: ${err.message}`, "warn");
      } finally {
        isAutoRunning = false;
      }
    }, 700);
  }

  function activate() {
    const handler = window.PlatformHandlers?.x;
    if (!handler) return;

    let isRetrigger = false;

    document.addEventListener(
      "keydown",
      async (e) => {
        if (!detectXArticlePage()) return;
        if (isRetrigger) return;
        if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "v") return;

        e.preventDefault();

        try {
          const text = await navigator.clipboard.readText();
          if (!text || !window.MarkdownConverter.isMarkdown(text)) {
            isRetrigger = true;
            document.execCommand("paste");
            isRetrigger = false;
            return;
          }

          const processed = handler.preprocessText ? handler.preprocessText(text) : text;
          const html = handler.getHtml(processed);

          const htmlBlob = new Blob([html], { type: "text/html" });
          const textBlob = new Blob([processed], { type: "text/plain" });
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": htmlBlob,
              "text/plain": textBlob,
            }),
          ]);

          isRetrigger = true;
          document.execCommand("paste");
          isRetrigger = false;

          if (handler.postPasteCleanup) {
            await sleep(500);
            handler.postPasteCleanup(showToast);
          }
        } catch (err) {
          debug("manual paste failed", err?.message || err);
          showToast(`Paste failed: ${err.message}`, "warn");
          isRetrigger = false;
        }
      },
      true,
    );
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "ping") {
      sendResponse({ ready: true });
      return true;
    }

    if (message?.type === "distribution-active") {
      queueAutoPaste(message.markdown);
    }
  });

  async function runAutoPaste(markdown) {
    if (!detectEditorReady()) {
      throw new Error('Editor not ready yet. Please click "Write" first.');
    }

    const handler = window.PlatformHandlers?.x;
    if (!handler) throw new Error("X handler missing");

    const processed = handler.preprocessText ? handler.preprocessText(markdown) : markdown;
    const html = handler.getHtml(processed);

    const htmlBlob = new Blob([html], { type: "text/html" });
    const textBlob = new Blob([processed], { type: "text/plain" });

    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": htmlBlob,
        "text/plain": textBlob,
      }),
    ]);

    await sleep(180);
    const editor = document.querySelector("[contenteditable='true']");
    if (editor) editor.focus();
    await sleep(80);

    document.execCommand("paste");
    debug("base markdown pasted");

    if (handler.postPasteCleanup) {
      await sleep(500);
      await handler.postPasteCleanup(showToast);
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  debug("content main loaded", location.href);
  activate();

  if (location.hostname === "x.com") {
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        debug("url changed", lastUrl);
      }

      if (pendingMarkdown && detectEditorReady() && !isAutoRunning) {
        const md = pendingMarkdown;
        pendingMarkdown = null;
        runAutoPaste(md).catch((err) => {
          pendingMarkdown = md;
          debug("retry runAutoPaste failed", err?.message || err);
          showToast(`Auto publish failed: ${err.message}`, "warn");
        });
      }
    }, 600);
  }
})();

