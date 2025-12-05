export function markdownToHTML(text) {
  // 0) Remove <think>...</think>/<thinking>...</thinking> blocks
  // This regex will match an an opening <think> or <thinking> tag,
  // followed by any characters (non-greedy), until either a closing
  // </think> or </thinking> tag is found, OR the end of the string ($).
  text = text.replace(/<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/gi, '');

  // Normalize exotic spaces (narrow/non-breaking) to regular spaces for consistent rendering
  text = text.replace(/[\u00a0\u202f\u2007]/g, ' ');

  text = balanceStreamingCodeFence(text);

  const escapeHtml = (value = '') =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const escapeAttr = (value = '') =>
    escapeHtml(value)
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const applyInline = (source) => {
    const codeRuns = [];
    let tmp = source.replace(/`([^`]+?)`/g, (_, code) => {
      const idx = codeRuns.push(code) - 1;
      return `@@CODEINLINE${idx}@@`;
    });

    const strongRuns = [];
    tmp = tmp.replace(/\*\*([\s\S]+?)\*\*/g, (_, content) => {
      const idx = strongRuns.push(content) - 1;
      return `@@STRONG${idx}@@`;
    });

    const emphasisRuns = [];
    tmp = tmp.replace(/(?<!\*)\*([\s\S]+?)\*(?!\*)/g, (_, content) => {
      const idx = emphasisRuns.push(content) - 1;
      return `@@EM${idx}@@`;
    });

    return tmp
      .replace(/@@STRONG(\d+)@@/g, (_, idx) => `<b>${strongRuns[+idx]}</b>`)
      .replace(/@@EM(\d+)@@/g,      (_, idx) => `<i>${emphasisRuns[+idx]}</i>`)
      .replace(/@@CODEINLINE(\d+)@@/g, (_, idx) => `<code>${codeRuns[+idx]}</code>`);
  };

  // 1) Normalize line endings
  let tmp = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2) Extract code blocks and replace with placeholders (protect from all formatting)
  const codeblocks = [];
  const placeholder = idx => `@@CODEBLOCK${idx}@@`;
  tmp = tmp.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    // Strip trailing whitespace-only lines at the end of the block
    let cleaned = (code || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = cleaned.split('\n');
    while (lines.length > 0 && /^\s*$/.test(lines[lines.length - 1])) lines.pop();
    cleaned = lines.join('\n');
    codeblocks.push({ lang: (lang || '').trim(), code: cleaned });
    return placeholder(codeblocks.length - 1);
  });

  // 3) HTML-escape special characters (outside of code blocks)
  let escaped = escapeHtml(tmp);

  // 4) Headings
  escaped = escaped
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm,  "<h2>$1</h2>")
    .replace(/^# (.+)$/gm,   "<h1>$1</h1>");

  // 4.3) Blockquotes
  escaped = escaped.replace(
    /(^|\n)([ \t]*> .+(?:\n[ \t]*> .+)*)/g,
    (_, lead, blockquoteBlock) => {
      const lines = blockquoteBlock
        .split(/\n/)
        .map(line => line.replace(/^[ \t]*>\s*/, '').trim())
        .join('\n');
      return `${lead}<blockquote>${lines}</blockquote>`;
    }
  );

  // 4.5) Unordered lists
  escaped = escaped.replace(
    /(^|\n)([ \t]*[-*] .+(?:\n[ \t]*[-*] .+)*)/g,
    (_, lead, listBlock) => {
      const items = listBlock
        .split(/\n/)
        .map(line => line.replace(/^[ \t]*[-*]\s+/, '').trim())
        .map(item => `<li>${item}</li>`)
        .join('');
      return `${lead}<ul>${items}</ul>`;
    }
  );

  // 4.6) Markdown tables (GitHub-style). Strict: requires header, separator, ≥2 cols.
  const mdTableBlockRe =
    /(^\|[^\n]*\|?\s*\n\|\s*[:\-]+(?:\s*\|\s*[:\-]+)+\s*\|?\s*\n(?:\|[^\n]*\|?\s*(?:\n|$))*)/gm;

  escaped = escaped.replace(mdTableBlockRe, (block) => {
    const hadTrailingNewline = /\n$/.test(block);
    const lines = block.replace(/\n$/, '').split('\n');

    const split = (line) => line.replace(/^\||\|$/g, '').split('|').map(s => s.trim());

    const headers = split(lines[0]);
    const seps    = split(lines[1]);
    if (headers.length < 2 || seps.length < 2) return block;
    if (!seps.every(s => /^[ :\-]+$/.test(s) && /-/.test(s))) return block;

    const aligns = seps.map(seg => {
      const s = seg.replace(/\s+/g,'');
      const left = s.startsWith(':');
      const right = s.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      return 'left';
    });

    const bodyLines = lines.slice(2).filter(l => /^\|/.test(l.trim()));
    const alignClass = (i) => `md-align-${aligns[i] || 'left'}`;

    const ths = headers.map((h,i)=>`<th class="md-table__head-cell ${alignClass(i)}">${h}</th>`).join('');
    const rows = bodyLines.map(line => {
      const cells = split(line);
      const tds = cells.map((c,i)=>`<td class="md-table__cell ${alignClass(i)}">${c}</td>`).join('');
      return `<tr class="md-table__row">${tds}</tr>`;
    }).join('');

    const table = `<table class="md-table"><thead><tr class="md-table__row md-table__row--head">${ths}</tr></thead><tbody>${rows}</tbody></table>`;

    return table + (hadTrailingNewline ? '\n' : '');
  });

  // 4.75) Horizontal rules
  escaped = escaped.replace(/^---\s*$/gm, "<hr>");

  // 5) Bold, italic, inline code (inline code only; fenced were extracted)
  let html = applyInline(escaped);

  // 5.5) Links
  const safeLink = (hrefRaw) => {
    const href = (hrefRaw || '').trim();
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    if (/^mailto:/i.test(href) || /^tel:/i.test(href)) return href;
    if (href.startsWith('/') || href.startsWith('#')) return href;
    return '';
  };

  html = html.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, (_, label, href) => {
    const url = safeLink(href);
    const tooltip = escapeHtml(href || '');
    if (!url) return label;
    return `<a class="md-link md-link--external" href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener"><span class="md-link__label">${label}</span> <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" class="md-icon md-icon-external"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg><span class="md-link__tooltip">${tooltip}</span></a>`;
  });

  // 6) Convert line-breaks to <br> for NON-code content (code is still placeholdered)
  html = html.replace(/\n/g, "<br>");

  // 6.1) Light cleanup: collapse 3+ consecutive <br> into a double-break, keep intentional spacing otherwise
  html = html.replace(/(?:<br>[\s]*){3,}/g, "<br><br>");

  // 6.2) Normalize spacing around block elements:
  // - keep a single break before block elements when breaks exist
  // - after a block element, keep at most one break
  html = html
    .replace(/(<br>\s*)+(<(?:h[1-4]|hr|table|ul|ol|blockquote)\b[^>]*>)/g, "<br>$2")
    .replace(/(<\/(?:h[1-4]|table|ul|ol|blockquote)>\s*)(<br>\s*)+/g, "$1<br>");

  // 6.3) Trim stray breaks immediately after headings but leave at most one (tighter)
  html = html.replace(/(<\/h[1-4]>)(<br>\s*)+/g, "$1");
  // 6.4) Trim trailing breaks after lists; rely on CSS margins for spacing
  html = html.replace(/(<\/(?:ul|ol)>)(<br>\s*)+/g, "$1");
  // 7) Restore code blocks with title bar (language) + copy button (no inline handlers)
  html = html.replace(/@@CODEBLOCK(\d+)@@/g, (_, idx) => {
    const { lang, code } = codeblocks[+idx];
    const title = (lang && lang.trim()) ? lang.trim() : 'code';
    const titleLabel = escapeHtml(title);
    const languageClass = title.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'code';

    // Escape only for HTML rendering inside <code>; keep raw \n (no <br> here!)
    const escapedCode = escapeHtml(code);

    // Single-line header to avoid global <br> interference
    const encodedForCopy = encodeURIComponent(code);
    const head = `<div class="md-codeblock__header"><div class="md-codeblock__lang">${titleLabel}</div><button type="button" class="md-codeblock__copy" aria-label="Copy code" title="Copy code" data-copy-code="${escapeAttr(encodedForCopy)}"><svg class="md-icon md-icon-copy" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg></button></div>`;

    // Ensure wrapping inside container and preserve newlines for copy/paste
    const body = `<pre class="md-codeblock__pre"><code class="md-codeblock__code language-${languageClass}">${escapedCode}</code></pre>`;

    return `<div class="md-codeblock">${head}${body}</div>`;
  });

  // 8) Final cleanup around codeblocks specifically (remove stray <br> added next to placeholders)
  html = html
    .replace(/<br>\s*(?=<div class="md-codeblock"\b)/g, "")                              // <br> before opening
    .replace(/(<div class="md-codeblock"[^>]*>[\s\S]*?<\/div>)\s*<br>/g, "$1");          // <br> right after closing

  return html;
}

// Virtually close an unfinished fenced code block so it renders during streaming.
function balanceStreamingCodeFence(md) {
  // Split into lines; we only consider fences that start a line.
  const lines = md.split(/\r?\n/);

  // Track the last unmatched opening fence we see while scanning.
  // { fenceChar: '`' or '~', fenceLen: number }
  let open = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Opening fence?  ^\s*([`~]{3,})(.*)$
    if (!open) {
      const m = line.match(/^\s*([`~]{3,})([^\s]*)?.*$/);
      if (m) {
        // Treat as an opening fence
        open = { fenceChar: m[1][0], fenceLen: m[1].length };
        continue;
      }
    } else {
      // Closing fence: must match same char and length or longer
      const re = new RegExp(`^\\s*(${open.fenceChar}{${open.fenceLen},})\\s*$`);
      if (re.test(line)) {
        // Closed
        open = null;
        continue;
      }
      // Otherwise still inside the code block; keep scanning
    }
  }

  if (open) {
    // Virtually close with the same fence so the block renders now
    const virtual = `${open.fenceChar.repeat(open.fenceLen)}`;
    return md.endsWith('\n') ? md + virtual : md + '\n' + virtual;
  }

  return md;
}
