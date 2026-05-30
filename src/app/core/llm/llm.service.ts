import { Injectable } from '@angular/core';

import { ChatRequest, ChatResponse } from '../../shared/types/chat.types';
import { LlmProvider } from './llm-provider';

class MockProvider implements LlmProvider {
  constructor(private readonly providerName: string) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const latest = request.messages.at(-1)?.content ?? '';
    return Promise.resolve({
      content: `[${this.providerName}/${request.model}] ${latest.slice(0, 160)}`
    });
  }
}

@Injectable({ providedIn: 'root' })
export class LlmService {
  private readonly providers = new Map<string, LlmProvider>([
    ['openai', new MockProvider('openai')],
    ['claude', new MockProvider('claude')],
    ['gemini', new MockProvider('gemini')],
    ['openai-compatible', new MockProvider('openai-compatible')]
  ]);

  async chat(providerName: string, request: ChatRequest): Promise<ChatResponse> {
    const provider = this.providers.get(providerName) ?? this.providers.get('openai');
    if (!provider) {
      throw new Error('No LLM provider configured.');
    }

    return provider.chat(request);
  }
}
