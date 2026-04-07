import type {
  Conversation,
  ConversationDetail,
  Message,
  ModelCatalog,
  TokenCounts,
  VisibilityRecord,
} from "../mocks/types";

const BASE_URL = "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationWithMessages extends ConversationDetail {
  messages: Message[];
}

export function getConversations(): Promise<Conversation[]> {
  return request<Conversation[]>("/api/conversations");
}

export function createConversation(title?: string): Promise<Conversation> {
  return request<Conversation>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title: title ?? null }),
  });
}

export function getConversation(id: string): Promise<ConversationWithMessages> {
  return request<ConversationWithMessages>(`/api/conversations/${id}`);
}

export function updateConversation(
  id: string,
  title: string,
): Promise<Conversation> {
  return request<Conversation>(`/api/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteConversation(id: string): Promise<void> {
  return request<void>(`/api/conversations/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export function getModels(): Promise<ModelCatalog> {
  return request<ModelCatalog>("/api/models");
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export function getMessageVisibility(
  messageId: string,
): Promise<VisibilityRecord> {
  return request<VisibilityRecord>(`/api/messages/${messageId}/visibility`);
}

// ---------------------------------------------------------------------------
// Token Counts
// ---------------------------------------------------------------------------

export function getConversationTokenCounts(
  conversationId: string,
): Promise<TokenCounts> {
  return request<TokenCounts>(
    `/api/conversations/${conversationId}/token-counts`,
  );
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

export function createWebSocket(conversationId: string): WebSocket {
  const wsUrl = BASE_URL.replace(/^http/, "ws");
  return new WebSocket(`${wsUrl}/api/conversations/${conversationId}/ws`);
}
