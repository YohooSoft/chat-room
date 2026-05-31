import { Injectable } from '@angular/core';

import { ChatRequest, ChatResponse } from '../../shared/types/chat.types';
import { StorageService } from '../storage/storage.service';
import { LlmProvider } from './llm-provider';

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  'openai-compatible': ''
};

class MockProvider implements LlmProvider {
  constructor(private readonly providerName: string) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const latest = request.messages.at(-1)?.content ?? '';
    return {
      content: `[${this.providerName}/${request.model}] ${latest.slice(0, 160)}`
    };
  }

  async *chatStream(request: ChatRequest): AsyncGenerator<string, ChatResponse> {
    const latest = request.messages.at(-1)?.content ?? '';
    const full = `[${this.providerName}/${request.model}] ${latest.slice(0, 160)}`;

    const words = full.split(/(\s+)/);
    for (const word of words) {
      yield word;
      await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 40));
    }

    return { content: full };
  }
}

/**
 * OpenAI-compatible real API provider using fetch.
 * Supports both chat and streaming via Server-Sent Events.
 */
class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const endpoint = `${this.baseUrl}/chat/completions`;
    const body = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${await res.text().catch(() => 'unknown')}`);
    }

    const data = await res.json();
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens
      }
    };
  }

  async *chatStream(request: ChatRequest): AsyncGenerator<string, ChatResponse> {
    const endpoint = `${this.baseUrl}/chat/completions`;
    const body = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      stream: true
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${await res.text().catch(() => 'unknown')}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            yield delta;
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }

    return { content: fullContent };
  }
}

/**
 * Google Gemini (GenAI) real API provider.
 * Uses the Gemini-specific generateContent endpoint with API key as query parameter.
 */
class GeminiProvider implements LlmProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = request.model || 'gemini-2.0-flash';
    const endpoint = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

    // Convert OpenAI-format messages to Gemini contents
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    // System prompt as systemInstruction
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.7
      }
    };

    if (systemMessages.length) {
      body['systemInstruction'] = {
        parts: systemMessages.map((m) => ({ text: m.content }))
      };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Gemini API error ${res.status}: ${await res.text().catch(() => 'unknown')}`);
    }

    const data = await res.json();
    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    };
  }

  async *chatStream(request: ChatRequest): AsyncGenerator<string, ChatResponse> {
    const model = request.model || 'gemini-2.0-flash';
    const endpoint = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.7
      }
    };

    if (systemMessages.length) {
      body['systemInstruction'] = {
        parts: systemMessages.map((m) => ({ text: m.content }))
      };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Gemini API error ${res.status}: ${await res.text().catch(() => 'unknown')}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullContent += text;
            yield text;
          }
        } catch {
          // Skip malformed SSE
        }
      }
    }

    return { content: fullContent };
  }
}

@Injectable({ providedIn: 'root' })
export class LlmService {
  private readonly mockProviders = new Map<string, MockProvider>([
    ['openai', new MockProvider('openai')],
    ['claude', new MockProvider('claude')],
    ['gemini', new MockProvider('gemini')],
    ['openai-compatible', new MockProvider('openai-compatible')]
  ]);

  constructor(private readonly storageService: StorageService) {}

  /**
   * Resolve the provider for a given name.
   * If an API key is configured in user preferences, a real API provider is returned.
   * Otherwise, falls back to the mock provider.
   */
  /**
   * Resolve the provider for a given name.
   *
   * Priority:
   * 1. Model-specific API key from custom models list
   * 2. Mock provider (fallback)
   */
  private resolveProvider(providerName: string, modelName?: string): LlmProvider {
    const state = this.storageService.state();
    const preferences = state.user.preferences as Record<string, unknown>;
    const customModels = preferences?.['customModels'] as
      | Array<{ provider: string; model: string; apiKey?: string; baseUrl?: string; isGenAI?: boolean }>
      | undefined;

    // Check model-specific API key from custom models
    if (modelName && customModels?.length) {
      const modelConfig = customModels.find(
        (m) => m.provider === providerName && m.model === modelName && m.apiKey
      );
      if (modelConfig?.apiKey) {
        const baseUrl = modelConfig.baseUrl || DEFAULT_BASE_URLS[providerName] || '';
        if (baseUrl) {
          console.info(`[LlmService] 使用 Model API: ${providerName}/${modelName} @ ${baseUrl}`);
          if (modelConfig.isGenAI) {
            return new GeminiProvider(baseUrl, modelConfig.apiKey);
          }
          return new OpenAiCompatibleProvider(baseUrl, modelConfig.apiKey);
        }
      }
    }

    // Fallback to mock
    const mock = this.mockProviders.get(providerName);
    if (mock) return mock;

    const genericMock = new MockProvider(providerName);
    this.mockProviders.set(providerName, genericMock);
    return genericMock;
  }

  private createRealProvider(providerName: string, baseUrl: string, apiKey: string): LlmProvider {
    if (providerName === 'gemini') {
      return new GeminiProvider(baseUrl, apiKey);
    }
    return new OpenAiCompatibleProvider(baseUrl, apiKey);
  }

  async chat(providerName: string, request: ChatRequest): Promise<ChatResponse> {
    return this.resolveProvider(providerName, request.model).chat(request);
  }

  async *chatStream(
    providerName: string,
    request: ChatRequest
  ): AsyncGenerator<string, ChatResponse> {
    const provider = this.resolveProvider(providerName, request.model);
    if (provider.chatStream) {
      return yield* provider.chatStream(request);
    }
    const response = await provider.chat(request);
    yield response.content;
    return response;
  }
}
