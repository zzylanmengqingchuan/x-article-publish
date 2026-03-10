(function () {
  "use strict";

  const md = window.markdownit({
    html: true,
    breaks: false,
    linkify: true,
    typographer: true,
    highlight: function (str, lang) {
      if (lang && typeof hljs !== "undefined" && hljs.getLanguage(lang)) {
        try {
          return '<pre><code class="hljs language-' + lang + '">' +
                 hljs.highlight(str, { language: lang }).value +
                 "</code></pre>";
        } catch (_) {}
      }
      return "<pre><code>" + md.utils.escapeHtml(str) + "</code></pre>";
    },
  });

  function isMarkdown(text) {
    if (!text || text.length < 10) return false;
    const patterns = [
      /^#{1,6}\s/m,
      /^```/m,
      /^\s*[-*+]\s/m,
      /^\s*\d+\.\s/m,
      /\[.+?\]\(.+?\)/,
      /!\[.*?\]\(.+?\)/,
      /^\|.+\|/m,
      /^>\s/m,
      /\*\*.+?\*\*/,
    ];
    return patterns.filter((p) => p.test(text)).length >= 2;
  }

  function toCleanHtml(markdown) {
    return md.render(markdown);
  }

  window.MarkdownConverter = {
    isMarkdown,
    toCleanHtml,
    md,
  };
})();
