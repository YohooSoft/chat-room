import { Injectable } from '@angular/core';
import { StorageService } from '../storage/storage.service';

// ── Wikipedia API types ──────────────────────────────────────────
interface WikipediaSearchResult {
  ns: number;
  pageid: number;
  size: number;
  snippet: string;
  timestamp: string;
  title: string;
  wordcount: number;
}

interface WikipediaSearchResponse {
  query?: {
    search?: WikipediaSearchResult[];
  };
}

interface WikipediaExtractResponse {
  query?: {
    pages?: Record<string, { extract?: string; title?: string }>;
  };
}

// ── Brave Search types ───────────────────────────────────────────
interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

// ── Public types ─────────────────────────────────────────────────
export interface WebSearchResult {
  query: string;
  formatted: string;
  error?: string;
}

export type SearchEngine = 'wikipedia' | 'google' | 'brave' | 'custom';

const SEARCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 300_000; // 5 minutes
const MAX_RESULT_CHARS = 1200;

@Injectable({ providedIn: 'root' })
export class WebSearchService {
  private readonly cache = new Map<string, { result: WebSearchResult; timestamp: number }>();

  constructor(private readonly storageService: StorageService) {}

  async search(roomId: string, query: string): Promise<WebSearchResult> {
    // Check cache
    const cached = this.cache.get(roomId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.info(`[WebSearch] 使用缓存结果 (${roomId}): "${query}"`);
      return cached.result;
    }

    const { engine, apiKey, googleCx, customUrl } = this.getSearchConfig();
    console.info(`[WebSearch] 搜索 (${roomId}, engine=${engine}): "${query}"`);

    let result: WebSearchResult;
    switch (engine) {
      case 'google':
        result = await this.searchGoogle(query, apiKey, googleCx);
        break;
      case 'brave':
        result = await this.searchBrave(query, apiKey);
        break;
      case 'custom':
        result = await this.searchCustom(query, customUrl, apiKey);
        break;
      default:
        result = await this.searchWikipedia(query);
        break;
    }

    this.cache.set(roomId, { result, timestamp: Date.now() });
    return result;
  }

  consumeResults(roomId: string): WebSearchResult | null {
    const cached = this.cache.get(roomId);
    if (!cached || Date.now() - cached.timestamp >= CACHE_TTL_MS) {
      this.cache.delete(roomId);
      return null;
    }
    return cached.result;
  }

  clearResults(roomId: string): void {
    this.cache.delete(roomId);
  }

  // ── Engine implementations ────────────────────────────────────

  /** Wikipedia: search titles → fetch extracts of top results */
  private async searchWikipedia(query: string): Promise<WebSearchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      // Step 1: search for pages
      const searchUrl = `https://en.wikipedia.org/w/api.php?origin=*&action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json`;
      const searchResp = await fetch(searchUrl, { signal: controller.signal });
      if (!searchResp.ok) {
        return { query, formatted: '', error: `Wikipedia HTTP ${searchResp.status}` };
      }

      const searchData: WikipediaSearchResponse = await searchResp.json();
      const results = searchData.query?.search ?? [];
      console.log('[WebSearch] Wikipedia 原始搜索:', JSON.stringify(searchData, null, 2));

      if (!results.length) {
        return { query, formatted: '', error: '无搜索结果' };
      }

      // Step 2: fetch extracts for top pages
      const pageIds = results.slice(0, 3).map(r => r.pageid).join('|');
      const extractUrl = `https://en.wikipedia.org/w/api.php?origin=*&action=query&prop=extracts&exintro&explaintext&pageids=${pageIds}&format=json`;
      const extractResp = await fetch(extractUrl, { signal: controller.signal });

      let pages: Record<string, { extract?: string; title?: string }> = {};
      if (extractResp.ok) {
        const extractData: WikipediaExtractResponse = await extractResp.json();
        pages = extractData.query?.pages ?? {};
        console.log('[WebSearch] Wikipedia 原文提取:', JSON.stringify(extractData, null, 2));
      }

      const formatted = this.formatWikipediaResults(results, pages, query);

      clearTimeout(timeout);
      console.info(`[WebSearch] Wikipedia 搜索完成: ${formatted.length} 字符`);
      return { query, formatted, error: formatted ? undefined : '无搜索结果' };
    } catch (err) {
      clearTimeout(timeout);
      return this.handleSearchError(err, query);
    }
  }

  /** Google Custom Search JSON API (100 free queries/day) */
  private async searchGoogle(query: string, apiKey?: string, cx?: string): Promise<WebSearchResult> {
    if (!apiKey || !cx) {
      return { query, formatted: '', error: '未配置 Google Search API Key 和 Search Engine ID，请在设置中填写' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=5`;
      const resp = await fetch(url, { signal: controller.signal });

      if (!resp.ok) {
        const errMsg = resp.status === 429 ? 'Google Search 配额已用尽（100次/天）' : `Google HTTP ${resp.status}`;
        return { query, formatted: '', error: errMsg };
      }

      const data = await resp.json();
      console.log('[WebSearch] Google 原始返回:', JSON.stringify(data, null, 2));

      const items = (data.items ?? []) as Array<{ title: string; link: string; snippet: string }>;
      const parts: string[] = [];
      parts.push(`[网络搜索结果 - Google]\n查询: "${query}"`);

      if (!items.length) {
        parts.push('(无结果)');
      } else {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const snippet = (item.snippet ?? '').length > 250
            ? item.snippet.slice(0, 250) + '...'
            : item.snippet;
          parts.push(`${i + 1}. ${item.title}`);
          if (snippet) parts.push(`   ${snippet}`);
          parts.push(`   链接: ${item.link}`);
          if (i < items.length - 1) parts.push('');
        }
      }

      parts.push('[搜索结束]');
      const full = parts.join('\n');
      const formatted = full.length > MAX_RESULT_CHARS
        ? full.slice(0, MAX_RESULT_CHARS) + '\n...(已截断)'
        : full;

      clearTimeout(timeout);
      console.info(`[WebSearch] Google 搜索完成: ${formatted.length} 字符`);
      return { query, formatted, error: undefined };
    } catch (err) {
      clearTimeout(timeout);
      return this.handleSearchError(err, query);
    }
  }

  /** Brave Search API */
  private async searchBrave(query: string, apiKey?: string): Promise<WebSearchResult> {
    if (!apiKey) {
      return { query, formatted: '', error: '未配置 Brave Search API Key，请在设置中填写' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey
        }
      });

      if (!resp.ok) {
        const errMsg = resp.status === 429 ? 'Brave Search 配额已用尽' : `Brave HTTP ${resp.status}`;
        return { query, formatted: '', error: errMsg };
      }

      const data: BraveSearchResponse = await resp.json();
      console.log('[WebSearch] Brave 原始返回:', JSON.stringify(data, null, 2));

      const results = data.web?.results ?? [];
      const formatted = this.formatBraveResults(results, query);

      clearTimeout(timeout);
      console.info(`[WebSearch] Brave 搜索完成: ${formatted.length} 字符`);
      return { query, formatted, error: formatted ? undefined : '无搜索结果' };
    } catch (err) {
      clearTimeout(timeout);
      return this.handleSearchError(err, query);
    }
  }

  /** Custom search endpoint (user-provided) */
  private async searchCustom(query: string, customUrl?: string, apiKey?: string): Promise<WebSearchResult> {
    if (!customUrl) {
      return { query, formatted: '', error: '未配置自定义搜索地址' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

    try {
      const url = customUrl.replace('{query}', encodeURIComponent(query));
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const resp = await fetch(url, { signal: controller.signal, headers });

      if (!resp.ok) {
        return { query, formatted: '', error: `自定义搜索 HTTP ${resp.status}` };
      }

      const data = await resp.json();
      console.log('[WebSearch] 自定义搜索原始返回:', JSON.stringify(data, null, 2));

      // Try to normalize common response shapes
      const formatted = this.normalizeCustomResponse(data, query);

      clearTimeout(timeout);
      console.info(`[WebSearch] 自定义搜索完成: ${formatted.length} 字符`);
      return { query, formatted, error: formatted ? undefined : '无搜索结果' };
    } catch (err) {
      clearTimeout(timeout);
      return this.handleSearchError(err, query);
    }
  }

  // ── Result formatters ─────────────────────────────────────────

  private formatWikipediaResults(
    searchResults: WikipediaSearchResult[],
    pages: Record<string, { extract?: string; title?: string }>,
    query: string
  ): string {
    const parts: string[] = [];
    parts.push(`[网络搜索结果 - Wikipedia]\n查询: "${query}"`);

    // Show extracts from top pages (they contain the actual content)
    const pageValues = Object.values(pages);
    if (pageValues.length) {
      parts.push('');
      for (const page of pageValues) {
        if (page.extract) {
          const title = page.title ?? '';
          const extract = page.extract.length > 400
            ? page.extract.slice(0, 400) + '...'
            : page.extract;
          parts.push(title ? `## ${title}` : '');
          parts.push(extract);
          parts.push('');
        }
      }
    }

    // Show search snippet list for other results
    const remaining = searchResults.filter(r => !pages[r.pageid]);
    if (remaining.length) {
      parts.push('---');
      parts.push('其他相关条目:');
      for (const r of remaining.slice(0, 5)) {
        const snippet = r.snippet.replace(/<[^>]+>/g, ''); // strip HTML tags
        const clean = snippet.length > 200 ? snippet.slice(0, 200) + '...' : snippet;
        parts.push(`- ${r.title}: ${clean}`);
        parts.push(`  https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`);
      }
    }

    parts.push('[搜索结束]');
    const full = parts.join('\n');
    return full.length > MAX_RESULT_CHARS
      ? full.slice(0, MAX_RESULT_CHARS) + '\n...(已截断)'
      : full;
  }

  private formatBraveResults(results: BraveWebResult[], query: string): string {
    const parts: string[] = [];
    parts.push(`[网络搜索结果 - Brave]\n查询: "${query}"`);

    if (!results.length) {
      parts.push('(无结果)');
    } else {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const desc = r.description.length > 250
          ? r.description.slice(0, 250) + '...'
          : r.description;
        parts.push(`${i + 1}. ${r.title}`);
        parts.push(`   ${desc}`);
        parts.push(`   链接: ${r.url}`);
        if (i < results.length - 1) parts.push('');
      }
    }

    parts.push('[搜索结束]');
    const full = parts.join('\n');
    return full.length > MAX_RESULT_CHARS
      ? full.slice(0, MAX_RESULT_CHARS) + '\n...(已截断)'
      : full;
  }

  /** Try to normalize common custom API response shapes */
  private normalizeCustomResponse(data: unknown, query: string): string {
    const d = data as Record<string, unknown>;
    const parts: string[] = [];
    parts.push(`[网络搜索结果]\n查询: "${query}"`);

    // Try common response shapes
    const results = (d['results'] ?? d['data'] ?? d['items'] ?? d['response'] ?? []) as unknown[];
    if (Array.isArray(results) && results.length) {
      for (let i = 0; i < Math.min(results.length, 5); i++) {
        const item = results[i] as Record<string, unknown>;
        const title = String(item['title'] ?? item['name'] ?? '');
        const text = String(item['description'] ?? item['snippet'] ?? item['text'] ?? item['content'] ?? '');
        const url = String(item['url'] ?? item['link'] ?? item['href'] ?? '');
        const cleanText = text.length > 250 ? text.slice(0, 250) + '...' : text;
        if (title) parts.push(`${i + 1}. ${title}`);
        if (cleanText) parts.push(`   ${cleanText}`);
        if (url) parts.push(`   链接: ${url}`);
        if (i < results.length - 1) parts.push('');
      }
    } else if (typeof d['answer'] === 'string') {
      parts.push(`回答: ${d['answer']}`);
    } else {
      // Just dump the raw JSON as fallback (truncated)
      const raw = JSON.stringify(data, null, 2);
      parts.push(raw.length > 800 ? raw.slice(0, 800) + '...' : raw);
    }

    parts.push('[搜索结束]');
    const full = parts.join('\n');
    return full.length > MAX_RESULT_CHARS
      ? full.slice(0, MAX_RESULT_CHARS) + '\n...(已截断)'
      : full;
  }

  // ── Helpers ───────────────────────────────────────────────────

  private getSearchConfig(): { engine: SearchEngine; apiKey?: string; googleCx?: string; customUrl?: string } {
    const prefs = this.storageService.read().user.preferences as Record<string, unknown>;
    const engine = (prefs['searchEngine'] as SearchEngine) ?? 'wikipedia';
    const apiKey = (prefs['searchApiKey'] as string) ?? undefined;
    const googleCx = (prefs['searchGoogleCx'] as string) ?? undefined;
    const customUrl = (prefs['searchCustomUrl'] as string) ?? undefined;
    return { engine, apiKey, googleCx, customUrl };
  }

  private handleSearchError(err: unknown, query: string): WebSearchResult {
    let message: string;
    if (err instanceof DOMException && err.name === 'AbortError') {
      message = '搜索超时';
    } else if (err instanceof TypeError) {
      // In browsers, TypeError from fetch is almost always CORS
      message = '网络请求失败（可能是 CORS 跨域限制，请使用返回 JSON 的 API 端点，而非搜索引擎的 HTML 页面）';
    } else if (err instanceof Error) {
      message = err.message;
    } else {
      message = '搜索失败';
    }
    console.warn(`[WebSearch] 搜索失败: ${message}`);
    return { query, formatted: '', error: message };
  }
}
