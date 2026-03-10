(function () {
  "use strict";

  let pendingItems = [];

  function log(...args) {
    console.log("[XPH]", ...args);
  }

  function preprocessMarkdown(text) {
    pendingItems = [];

    const matches = [];
    const codeRe = /```(\w*)\n([\s\S]*?)```/g;
    const imgRe = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    const tableRe = /((?:^|\n)\|.+\|\n\|[\s:|-]+\|\n(?:\|.+\|\n?)+)/g;

    let m;
    while ((m = codeRe.exec(text)) !== null) {
      matches.push({
        type: "code",
        start: m.index,
        end: m.index + m[0].length,
        lang: m[1] || "",
        code: m[2].trimEnd(),
      });
    }

    while ((m = imgRe.exec(text)) !== null) {
      const inCode = matches.some((x) => x.type === "code" && m.index >= x.start && m.index < x.end);
      if (inCode) continue;
      matches.push({
        type: "image",
        start: m.index,
        end: m.index + m[0].length,
        alt: m[1],
        url: m[2],
      });
    }

    while ((m = tableRe.exec(text)) !== null) {
      const tableText = m[1].trim();
      const start = m.index + (m[1].startsWith("\n") ? 1 : 0);
      const end = m.index + m[0].length;
      const inCode = matches.some((x) => x.type === "code" && start >= x.start && start < x.end);
      if (inCode) continue;
      matches.push({ type: "code", start, end, lang: "", code: tableText });
    }

    matches.sort((a, b) => a.start - b.start);
    for (let i = 0; i < matches.length; i++) {
      matches[i].marker = `[XPH-${i + 1}]`;
    }

    let processed = text;
    for (let i = matches.length - 1; i >= 0; i--) {
      const mt = matches[i];
      processed = processed.substring(0, mt.start) + `\n${mt.marker}\n` + processed.substring(mt.end);
    }

    pendingItems = matches.map((mt) =>
      mt.type === "code"
        ? { type: "code", marker: mt.marker, lang: mt.lang, code: mt.code }
        : { type: "image", marker: mt.marker, alt: mt.alt, url: mt.url },
    );

    processed = processed.replace(/<details>\s*\n\s*<summary>([\s\S]*?)<\/summary>\s*\n([\s\S]*?)\n\s*<\/details>/gi, (_, s, c) => `**${s.trim()}**\n\n${c.trim()}`);
    processed = processed.replace(/<details>\s*<summary>(.*?)<\/summary>([\s\S]*?)<\/details>/gi, (_, s, c) => `**${s.trim()}**\n\n${c.trim()}`);
    processed = processed.replace(/^(\s*)- \[ \] /gm, "$1- [ ] ");
    processed = processed.replace(/^(\s*)- \[x\] /gim, "$1- [x] ");
    processed = processed.replace(/\n{3,}/g, "\n\n");

    log("preprocess", { total: pendingItems.length, images: pendingItems.filter((x) => x.type === "image").length });
    return processed;
  }

  function getHtml(markdown) {
    return window.MarkdownConverter.toCleanHtml(markdown);
  }

  async function postPasteCleanup(showToast) {
    const items = [...pendingItems];
    pendingItems = [];
    if (!items.length) return;

    let toast = showToast ? showToast(`Preparing media... 0/${items.length}`, "progress") : null;

    const imageTasks = items
      .filter((it) => it.type === "image")
      .map(async (it) => {
        try {
          const result = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "fetch-image", url: it.url }, resolve);
          });
          if (!result || !result.success) throw new Error(result?.error || "download failed");

          const bin = atob(result.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          it._blob = new Blob([bytes], { type: result.mimeType || "image/png" });
          log("image fetched", it.url, it._blob.size);
        } catch (err) {
          it._blob = null;
          log("image fetch failed", it.url, err?.message || err);
        }
      });

    await Promise.all(imageTasks);
    await sleep(1200);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (toast) toast = showToast(`Processing ${i + 1}/${items.length}...`, "progress", toast);

      try {
        const markerInfo = findMarkerInEditor(item.marker);
        if (!markerInfo) {
          log("marker not found", item.marker);
          continue;
        }

        markerInfo.parentBlock.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(380);

        const range = document.createRange();
        range.setStart(markerInfo.node, markerInfo.offset);
        range.setEnd(markerInfo.node, markerInfo.offset + item.marker.length);
        const rect = range.getBoundingClientRect();
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        await sleep(100);

        document.execCommand("delete");
        await sleep(180);

        clickAtPosition(rect.left + 1, rect.top + rect.height / 2);
        await sleep(180);

        if (item.type === "code") {
          await processCodeBlock(item.code);
        } else {
          await processImageViaPaste(item);
        }

        await sleep(700);
      } catch (err) {
        log("item failed", item.marker, err?.message || err);
        pressEscape();
        await sleep(220);
      }
    }

    if (showToast) showToast("Done: content pasted and media uploaded.", "success", toast);
  }

  function findMarkerInEditor(marker) {
    const editor = document.querySelector("[data-contents='true']") || document.querySelector("[contenteditable='true']");
    if (!editor) return null;

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf(marker);
      if (idx !== -1) {
        const parentBlock = node.parentElement.closest("[data-block='true']") || node.parentElement;
        return { node, offset: idx, parentBlock };
      }
    }
    return null;
  }

  function clickAtPosition(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    el.dispatchEvent(new MouseEvent("mousedown", { clientX: x, clientY: y, bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { clientX: x, clientY: y, bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { clientX: x, clientY: y, bubbles: true }));
  }

  async function processCodeBlock(code) {
    if (!(await openInsertDialog("Code", "代码"))) return;

    let textarea = null;
    for (let i = 0; i < 15; i++) {
      textarea = document.querySelector("textarea");
      if (textarea) break;
      await sleep(180);
    }
    if (!textarea) {
      pressEscape();
      return;
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    nativeSetter.call(textarea, code);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(220);

    const submit = findDialogButton("Insert") || findDialogButton("插入");
    if (!submit) {
      pressEscape();
      return;
    }

    submit.click();
    await sleep(900);
  }

  async function processImageViaPaste(item) {
    if (!item._blob) {
      document.execCommand("insertText", false, `[Image download failed: ${item.alt || item.url}]`);
      return;
    }

    const fileName = item.url.split("/").pop().split("?")[0] || "image.png";
    const mimeType = item._blob.type || "image/png";
    const file = new File([item._blob], fileName, { type: mimeType });

    const editor = document.querySelector("[contenteditable='true']");
    if (!editor) return;

    editor.focus();
    await sleep(100);

    const dt = new DataTransfer();
    dt.items.add(file);

    const pasteEvent = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });

    log("dispatch image paste", fileName, file.size, file.type);
    editor.dispatchEvent(pasteEvent);
    await waitForImageInEditor(10000);
  }

  async function waitForImageInEditor(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(420);
      const uploading = document.querySelector("[data-testid='uploadProgress'], [role='progressbar']");
      if (!uploading) {
        await sleep(250);
        return;
      }
    }
  }

  async function openInsertDialog(...optionTexts) {
    const editor = document.querySelector("[contenteditable='true']");
    if (editor) editor.focus();
    await sleep(100);

    const insertBtn = findClickableByText("Insert") || findClickableByText("插入");
    if (!insertBtn) return false;
    insertBtn.click();
    await sleep(320);

    let option = null;
    for (const txt of optionTexts) {
      option = findClickableByText(txt);
      if (option) break;
    }
    if (!option) {
      pressEscape();
      return false;
    }

    option.click();
    await sleep(420);
    return true;
  }

  function findClickableByText(targetText) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      if ((node.textContent || "").trim() === targetText) {
        let el = node.parentElement;
        for (let i = 0; i < 6 && el; i++) {
          if (el.matches("button, [role='button'], [role='menuitem'], [role='option']")) return el;
          el = el.parentElement;
        }
        return node.parentElement;
      }
    }
    return null;
  }

  function findDialogButton(targetText) {
    const dialogs = document.querySelectorAll("[role='dialog'], [aria-modal='true']");
    for (const dialog of dialogs) {
      const btns = dialog.querySelectorAll("button, [role='button']");
      for (const btn of btns) {
        if ((btn.textContent || "").trim() === targetText) return btn;
      }
    }
    return null;
  }

  function pressEscape() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  log("platform x loaded", location.href);

  window.PlatformHandlers = window.PlatformHandlers || {};
  window.PlatformHandlers.x = {
    mode: "keydown-html",
    preprocessText: preprocessMarkdown,
    getHtml,
    postPasteCleanup,
  };
})();
