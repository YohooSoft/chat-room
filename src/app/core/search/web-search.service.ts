import { Injectable } from '@angular/core';

interface DuckDuckGoResponse {
  AbstractText?: string;
  AbstractSource?: string;
  AbstractURL?: string;
  Results?: Array<{ Text: string; FirstURL: string }>;
  RelatedTopics?: Array<
    { Text: string; FirstURL: string } | { Name: string; Topics: Array<{ Text: string; FirstURL: string }> }
  >;
  Answer?: string;
  AnswerType?: string;
  Definition?: string;
  DefinitionSource?: string;
  DefinitionURL?: string;
}

export interface WebSearchResult {
  query: string;
  formatted: string;
  error?: string;
}

const SEARCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 300_000; // 5 minutes
const MAX_RESULT_CHARS = 1200;

@Injectable({ providedIn: 'root' })
export class WebSearchService {
  /** Cache keyed by roomId. Auto-expires after CACHE_TTL_MS. */
  private readonly cache = new Map<string, { result: WebSearchResult; timestamp: number }>();

  /**
   * Perform a web search via DuckDuckGo Instant Answer API.
   * Results are cached per roomId for subsequent consumption.
   */
  async search(roomId: string, query: string): Promise<WebSearchResult> {
    // Check cache first
    const cached = this.cache.get(roomId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.info(`[WebSearch] 使用缓存结果 (${roomId}): "${query}"`);
      return cached.result;
    }

    console.info(`[WebSearch] 搜索 (${roomId}): "${query}"`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        const result: WebSearchResult = { query, formatted: '', error: `HTTP ${response.status}` };
        this.cache.set(roomId, { result, timestamp: Date.now() });
        return result;
      }

      const data: DuckDuckGoResponse = await response.json();
      const formatted = this.formatResults(data, query);
      const result: WebSearchResult = { query, formatted };

      if (!formatted) {
        result.error = '无搜索结果';
      }

      this.cache.set(roomId, { result, timestamp: Date.now() });
      console.info(`[WebSearch] 搜索完成 (${roomId}): ${formatted.length} 字符`);
      return result;
    } catch (err) {
      clearTimeout(timeout);
      const message = err instanceof DOMException && err.name === 'AbortError'
        ? '搜索超时'
        : err instanceof TypeError
          ? '网络请求失败'
          : err instanceof Error
            ? err.message
            : '搜索失败';
      console.warn(`[WebSearch] 搜索失败 (${roomId}): ${message}`);
      const result: WebSearchResult = { query, formatted: '', error: message };
      this.cache.set(roomId, { result, timestamp: Date.now() });
      return result;
    }
  }

  /**
   * Consume (read-and-clear) cached search results for a room.
   * Returns results only once — subsequent calls return null until a new search is performed.
   */
  consumeResults(roomId: string): WebSearchResult | null {
    const cached = this.cache.get(roomId);
    if (!cached) return null;

    // Only return if still fresh
    if (Date.now() - cached.timestamp >= CACHE_TTL_MS) {
      this.cache.delete(roomId);
      return null;
    }

    // Don't clear — allow multiple characters in the same discussion to read
    // Results are cleared at the end of the discussion round
    return cached.result;
  }

  /** Clear cached results for a room (called after discussion round ends). */
  clearResults(roomId: string): void {
    this.cache.delete(roomId);
  }

  // ── Private helpers ──────────────────────────────────────────────

  private formatResults(data: DuckDuckGoResponse, query: string): string {
    const parts: string[] = [];
    parts.push(`[网络搜索结果]\n查询: "${query}"`);

    // Direct answer (highest priority — e.g. weather, calculations, facts)
    if (data.Answer) {
      parts.push(`直接回答: ${data.Answer}`);
    }

    // Abstract (Wikipedia-style summary)
    if (data.AbstractText) {
      const abstract = data.AbstractText.length > 500
        ? data.AbstractText.slice(0, 500) + '...'
        : data.AbstractText;
      parts.push(`摘要: ${abstract}`);
      if (data.AbstractURL) {
        parts.push(`来源: ${data.AbstractURL}`);
      }
    }

    // Results (top 3)
    const results = (data.Results ?? []).slice(0, 3);
    if (results.length) {
      parts.push('---');
      parts.push('相关结果:');
      results.forEach((r, i) => {
        const text = r.Text.length > 200 ? r.Text.slice(0, 200) + '...' : r.Text;
        parts.push(`${i + 1}. ${text}`);
        parts.push(`   链接: ${r.FirstURL}`);
      });
    }

    // Definition (fallback)
    if (!data.AbstractText && data.Definition) {
      parts.push(`定义: ${data.Definition}`);
      if (data.DefinitionURL) {
        parts.push(`来源: ${data.DefinitionURL}`);
      }
    }

    // Related topics (flatten nested structure, top 5)
    const topics = this.flattenTopics(data.RelatedTopics ?? []).slice(0, 5);
    if (topics.length && !results.length) {
      parts.push('---');
      parts.push('相关话题:');
      topics.forEach((t) => {
        const text = t.Text.length > 120 ? t.Text.slice(0, 120) + '...' : t.Text;
        parts.push(`- ${text} (${t.FirstURL})`);
      });
    }

    parts.push('[搜索结束]');

    const full = parts.join('\n');
    // Enforce max length
    return full.length > MAX_RESULT_CHARS
      ? full.slice(0, MAX_RESULT_CHARS) + '\n...(已截断)'
      : full;
  }

  private flattenTopics(
    topics: Array<{ Text: string; FirstURL: string } | { Name: string; Topics: Array<{ Text: string; FirstURL: string }> }>
  ): Array<{ Text: string; FirstURL: string }> {
    const flat: Array<{ Text: string; FirstURL: string }> = [];
    for (const topic of topics) {
      if ('Topics' in topic) {
        flat.push(...topic.Topics);
      } else {
        flat.push(topic);
      }
    }
    return flat;
  }
}
