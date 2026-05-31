import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Lightweight Markdown-to-HTML pipe.
 *
 * Supports:
 * - Bold: **text** or __text__
 * - Italic: *text* or _text_
 * - Inline code: `code`
 * - Fenced code blocks: ```lang ... ```
 * - Headers: # H1, ## H2 … ###### H6
 * - Unordered lists: - item / * item
 * - Ordered lists: 1. item
 * - Links: [text](url)
 * - Line breaks preserved as <br>
 * - Paragraphs separated by blank lines
 */
@Pipe({ name: 'markdown', standalone: true })
export class MarkdownPipe implements PipeTransform {
  constructor(private readonly sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';
    const html = this.render(value);
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private render(md: string): string {
    // 1. Extract and protect fenced code blocks
    const codeBlocks: string[] = [];
    let text = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(
        `<pre><code${lang ? ` class="language-${lang}"` : ''}>${this.escapeHtml(code.trimEnd())}</code></pre>`
      );
      return `\n<!--CODEBLOCK_${idx}-->\n`;
    });

    // 2. Inline code (backticks)
    text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${this.escapeHtml(code)}</code>`);

    // 3. Bold & Italic (run bold first so ** wins over *)
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/_(.+?)_/g, '<em>$1</em>');

    // 4. Links [text](url)
    text = text.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );

    // 5. Split into lines for block processing
    const lines = text.split('\n');
    const result: string[] = [];
    let inList: 'ul' | 'ol' | null = null;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      let line = raw.trim();

      // Empty line → close any open list & paragraph break
      if (!line) {
        if (inList) {
          result.push(inList === 'ul' ? '</ul>' : '</ol>');
          inList = null;
        }
        result.push('<br>');
        continue;
      }

      // Restore code blocks
      const codeBlockMatch = line.match(/<!--CODEBLOCK_(\d+)-->/);
      if (codeBlockMatch) {
        if (inList) {
          result.push(inList === 'ul' ? '</ul>' : '</ol>');
          inList = null;
        }
        result.push(codeBlocks[Number(codeBlockMatch[1])]);
        continue;
      }

      // Headers
      const headerMatch = line.match(/^(#{1,6})\s+(.+)/);
      if (headerMatch) {
        if (inList) {
          result.push(inList === 'ul' ? '</ul>' : '</ol>');
          inList = null;
        }
        const level = headerMatch[1].length;
        result.push(`<h${level}>${headerMatch[2]}</h${level}>`);
        continue;
      }

      // Unordered list
      const ulMatch = line.match(/^[-*]\s+(.+)/);
      if (ulMatch) {
        if (inList !== 'ul') {
          if (inList) result.push(inList === 'ol' ? '</ol>' : '</ul>');
          result.push('<ul>');
          inList = 'ul';
        }
        result.push(`<li>${ulMatch[1]}</li>`);
        continue;
      }

      // Ordered list
      const olMatch = line.match(/^\d+[.)]\s+(.+)/);
      if (olMatch) {
        if (inList !== 'ol') {
          if (inList) result.push(inList === 'ul' ? '</ul>' : '</ol>');
          result.push('<ol>');
          inList = 'ol';
        }
        result.push(`<li>${olMatch[1]}</li>`);
        continue;
      }

      // Regular paragraph line
      if (inList) {
        result.push(inList === 'ul' ? '</ul>' : '</ol>');
        inList = null;
      }
      result.push(`<p>${line}</p>`);
    }

    // Close any remaining open list
    if (inList) {
      result.push(inList === 'ul' ? '</ul>' : '</ol>');
    }

    return result.join('\n');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
