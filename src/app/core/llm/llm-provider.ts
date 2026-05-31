import { ChatRequest, ChatResponse } from '../../shared/types/chat.types';

export interface LlmProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Optional streaming support. Returns an async generator yielding content chunks. */
  chatStream?(request: ChatRequest): AsyncGenerator<string, ChatResponse>;
}
