export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  roomId: string;
  role: Role;
  senderId: string;
  content: string;
  createdAt: number;
}

export interface ChatRequest {
  model: string;
  messages: Array<Pick<ChatMessage, 'role' | 'content'>>;
  temperature?: number;
}

export interface ChatResponse {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface Relation {
  closeness: number;
  trust: number;
}

export interface CharacterModelConfig {
  provider: string;
  model: string;
  temperature: number;
}

export interface Character {
  id: string;
  name: string;
  personality: string;
  background: string;
  promptMode: 'auto' | 'advanced';
  systemPrompt?: string;
  model: CharacterModelConfig;
  relations: Record<string, Relation>;
  /** System characters (like Haiku scheduler) don't produce visible chat messages. */
  isSystem?: boolean;
}

export interface Room {
  id: string;
  name: string;
  characterIds: string[];
}

export interface MemoryRecord {
  id: string;
  scope: 'room' | 'character';
  targetId?: string;
  content: string;
  importance: number;
  createdAt: number;
}

export type Action =
  | {
      type: 'call_model';
      characterId: string;
      provider: string;
      model: string;
      messages: Array<Pick<ChatMessage, 'role' | 'content'>>;
      temperature?: number;
    }
  | {
      type: 'write_memory';
      scope: 'room' | 'character';
      targetId?: string;
      content: string;
      importance: number;
    }
  | {
      type: 'trigger_discussion';
      round: number;
      speakers: string[];
      userContent?: string;
      userName?: string;
      userLocation?: string;
      userBackground?: string;
    }
  | {
      type: 'web_search';
      query: string;
      storeAsMemory?: boolean;
    }
  | {
      type: 'ui_event';
      event: 'typing' | 'stop_typing' | 'end_turn';
    }
  | {
      type: 'system_message';
      content: string;
    };

export interface ExecutionPlan {
  roomId: string;
  actions: Action[];
}

export interface AppStorageState {
  rooms: Record<string, Room>;
  characters: Record<string, Character>;
  messages: Record<string, ChatMessage[]>;
  memories: {
    room: Record<string, MemoryRecord[]>;
    character: Record<string, MemoryRecord[]>;
  };
  user: {
    name: string;
    location: string;
    background: string;
    profile: Record<string, unknown>;
    preferences: Record<string, unknown>;
  };
  /** User→Character affinity scores (0~1), judged by Haiku. */
  userAffinity: Record<string, number>;
}

export type AppEvent =
  | {
      type: 'user_message';
      roomId: string;
      content: string;
    }
  | {
      type: 'ai_message';
      message: ChatMessage;
    }
  | {
      type: 'ui_event';
      event: 'typing' | 'stop_typing' | 'end_turn';
    };
