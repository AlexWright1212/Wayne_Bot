// Wayne frontend type definitions
// Derived from docs/frontend_surface_area.md — these interfaces mirror exact API response shapes.
// When wiring up the real backend, these types remain unchanged; only the data source swaps.

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface Conversation {
  id: string;
  title: string | null;
  last_model_id: string | null;
  last_provider: Provider | null;
  updated_at: string; // ISO 8601
}

export interface ConversationDetail {
  id: string;
  title: string | null;
  last_model_id: string | null;
  last_provider: Provider | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type Provider = "openai" | "anthropic" | "openrouter";

export type MessageRole =
  | "user"
  | "assistant"
  | "system"
  | "tool_call"
  | "tool_result"
  | "summary";

// OpenAI reasoning levels
export type OpenAIReasoningLevel = "none" | "low" | "medium" | "high" | "xhigh";
// Anthropic reasoning levels
export type AnthropicReasoningLevel = "off" | "low" | "medium" | "high" | "adaptive";
// Combined — actual value is provider-specific
export type ReasoningLevel = OpenAIReasoningLevel | AnthropicReasoningLevel | null;

export interface Message {
  id: string;
  role: MessageRole;
  content: string | null;
  model_id: string | null;
  provider: Provider | null;
  reasoning_level: ReasoningLevel;
  // tool_call fields (role === "tool_call")
  tool_call_id: string | null;
  tool_name: string | null;
  tool_arguments: string | null; // JSON string
  // tool_result fields (role === "tool_result")
  tool_result_call_id: string | null;
  tool_result_name: string | null;
  sequence: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Token Counts
// ---------------------------------------------------------------------------

export interface TokenCounts {
  tokens_openai: number | null;
  tokens_anthropic: number | null;
  tokens_openrouter: number | null;
  output_tokens: number;
  context_window_size: number;
  active_token_count: number;
  active_provider: Provider;
  model_id: string;
  utilization: number; // 0–1 fraction
}

// ---------------------------------------------------------------------------
// Model Catalog
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  name: string;
  provider: Provider;
  context_window: number;
  max_output: number;
  supports_tools: boolean;
  supports_reasoning: boolean;
  reasoning_levels: ReasoningLevel[];
}

export interface ProviderInfo {
  provider: Provider;
  available: boolean;
  models: ModelInfo[];
}

export interface ModelCatalog {
  providers: Record<Provider, ProviderInfo>;
}

// ---------------------------------------------------------------------------
// Visibility Records
// ---------------------------------------------------------------------------

// --- Request payload ---

interface SystemMessage {
  role: "system";
  content: string;
}

interface UserMessage {
  role: "user";
  content: string;
}

interface AssistantMessage {
  role: "assistant";
  content?: string;
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: string; // JSON string
  }>;
}

interface ToolResultMessage {
  role: "tool_result";
  tool_call_id: string;
  tool_name: string;
  content: string;
}

export type PayloadMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;

// OpenAI function-calling tool schema format
interface OpenAIToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string }>;
      required: string[];
    };
  };
}

// Anthropic tool schema format
interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

export type ToolSchema = OpenAIToolSchema | AnthropicToolSchema;

export interface RequestPayload {
  messages: PayloadMessage[];
  model_id: string;
  provider: Provider;
  reasoning_level: ReasoningLevel;
  tools: ToolSchema[] | null;
}

// --- Response metadata ---

export interface ResponseMetadata {
  finish_reason: "stop" | "tool_calls" | "length" | "error";
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  auto_title?: {
    prompt: string;
    response: string;
  };
}

// --- Tool trace ---

export type HarnessStepName =
  | "query_generation"
  | "execute_queries"
  | "round2_search"
  | "filter_results"
  | "coverage_check"
  | "coverage_retry_1"
  | "coverage_retry_2";

export type FilterReason = "low_score" | "too_old" | "blacklisted" | "duplicate";

interface QueryGenerationData {
  ready_queries: string[];
  pending_queries: Array<{ template: string; slot: string }>;
}

interface ExecuteQueriesData {
  queries: string[];
  result_count: number;
  entities?: Record<string, string>;
}

interface Round2SearchData {
  filled_queries: string[];
  result_count: number;
}

interface FilterResultsData {
  kept: number;
  removed: number;
  removed_reasons: Array<{ url: string; reason: FilterReason }>;
}

interface CoverageCheckData {
  sufficient: boolean;
  missing: string[];
  confidence: number;
}

interface CoverageRetryData {
  sufficient: boolean;
  missing: string[];
  confidence: number;
}

type HarnessStepData =
  | QueryGenerationData
  | ExecuteQueriesData
  | Round2SearchData
  | FilterResultsData
  | CoverageCheckData
  | CoverageRetryData;

export interface HarnessStep {
  name: HarnessStepName;
  status: "complete" | "running" | "error";
  data: HarnessStepData;
  duration_ms: number;
}

export interface ToolTrace {
  tool_name: string;
  tool_call_id: string;
  tool_arguments: Record<string, string>;
  steps: HarnessStep[];
}

// --- Summary event ---

export interface SummaryEvent {
  summary_text: string;
  summarized_message_ids: string[];
  tokens_before: number;
  tokens_after: number;
  model_used: string;
}

// --- Full visibility record ---

export interface VisibilityRecord {
  message_id: string;
  request_payload: RequestPayload;
  response_metadata: ResponseMetadata;
  tokens_openai: number | null;
  tokens_anthropic: number | null;
  tokens_openrouter: number | null;
  output_tokens: number;
  context_window_size: number;
  active_token_count: number;
  reasoning_content: string | null;
  summary_event: SummaryEvent | null;
  tool_trace: ToolTrace | null;
}
