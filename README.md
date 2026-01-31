# Markdown HTML Renderer

Small, dependency-free Markdown-to-HTML converter originally built for the
"Heimgeist" AI chat frontend. It focuses on predictable, chat-friendly rendering
and ships with a matching CSS theme.

## What it does

- Removes `<think>...</think>` and `<thinking>...</thinking>` blocks.
- Normalizes exotic spaces to regular spaces.
- Supports headings (`#` to `####`), horizontal rules, blockquotes, lists,
  GitHub-style tables, inline bold/italic/code, and fenced code blocks.
- Escapes HTML outside fenced code blocks for safety.
- Balances unfinished fenced code blocks for streaming output.
- Converts newlines to `<br>` and normalizes spacing around block elements.
- Adds a code-block header with language label and a copy button.
- Sanitizes links to allow only `http(s)`, `mailto:`, `tel:`, `/` and `#`.

## Files

- `markdown.js` — exports the renderer.
- `markdown-render.css` — styles for the generated HTML.

## Usage

```js
import { markdownToHTML } from './markdown.js';

const markdown = `
# Title

Here is **bold**, *italic*, and \`inline code\`.

> Blockquote

1. One
2. Two

| Col A | Col B |
|:-----|------:|
| left | right |

\`\`\`js
console.log('hello');
\`\`\`
`;

const html = markdownToHTML(markdown);

// Example: render into the DOM
document.querySelector('#output').innerHTML = html;
```

Include the CSS and optionally wrap the output:

```html
<link rel="stylesheet" href="markdown-render.css">
<div class="md-root" id="output"></div>
```

## Copy button behavior

Each fenced code block includes a button with a URL-encoded payload:

```html
<button data-copy-code="...">...</button>
```

You can wire it up like this:

```js
document.addEventListener('click', (event) => {
  const button = event.target.closest('.md-codeblock__copy');
  if (!button) return;
  const raw = button.getAttribute('data-copy-code') || '';
  const code = decodeURIComponent(raw);
  navigator.clipboard.writeText(code);
});
```

## Notes and limitations

- This is a regex-based renderer, not a full Markdown parser.
- Only fenced code blocks are supported (no indented code blocks).
- Nested lists and advanced Markdown extensions are not parsed.
- Link conversion is deliberately strict for safety.
- The link-matching regex is tailored to the current implementation in
  `markdown.js`; if you need standard `[label](url)` parsing, adjust it there.

## License

Unspecified. Add a license file if you plan to distribute this module.
