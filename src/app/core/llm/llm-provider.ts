import { ChatRequest, ChatResponse } from '../../shared/types/chat.types';

export interface LlmProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
}
