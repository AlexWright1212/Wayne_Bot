// Wayne mock data — static fake data for UI development and visual testing.
// Source of truth: docs/mock_data.md
//
// Migration path: when wiring up the real backend, replace each export with
// a fetch call or Zustand store selector. Component interfaces do not change.

import type {
  Conversation,
  ConversationDetail,
  Message,
  TokenCounts,
  ModelCatalog,
  VisibilityRecord,
} from "./types";

// ---------------------------------------------------------------------------
// 1. Sidebar — Conversation List
// ---------------------------------------------------------------------------

export const MOCK_CONVERSATIONS: Conversation[] = [
  {
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    title: "How LLMs Work",
    last_model_id: "gpt-5",
    last_provider: "openai",
    updated_at: "2026-03-29T14:42:00Z",
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440000",
    title: "Prompt Engineering Deep Dive",
    last_model_id: "claude-sonnet-4-6-20250514",
    last_provider: "anthropic",
    updated_at: "2026-03-28T09:15:00Z",
  },
  {
    id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    title: "Building a RAG System from Scratch",
    last_model_id: "deepseek/deepseek-r1",
    last_provider: "openrouter",
    updated_at: "2026-03-27T16:30:00Z",
  },
  {
    id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
    title: "AI Safety and Alignment",
    last_model_id: "claude-opus-4-6-20250130",
    last_provider: "anthropic",
    updated_at: "2026-03-25T11:00:00Z",
  },
  {
    id: "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
    title: "GPT vs Claude — Architecture Differences",
    last_model_id: "gpt-5",
    last_provider: "openai",
    updated_at: "2026-03-22T08:45:00Z",
  },
];

export const MOCK_ACTIVE_CONVERSATION_ID =
  "f47ac10b-58cc-4372-a567-0e02b2c3d479";

// ---------------------------------------------------------------------------
// 2. Active Conversation
// ---------------------------------------------------------------------------

export const MOCK_ACTIVE_CONVERSATION: ConversationDetail = {
  id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  title: "How LLMs Work",
  last_model_id: "gpt-5",
  last_provider: "openai",
  created_at: "2026-03-29T14:00:00Z",
  updated_at: "2026-03-29T14:42:00Z",
};

export const MOCK_MESSAGES: Message[] = [
  // --- Exchange 1: user asks, Wayne searches the web, Wayne answers ---
  {
    id: "msg-0001-user-llm-intro",
    role: "user",
    content:
      "How do large language models actually work? I want to understand the core mechanics.",
    model_id: null,
    provider: null,
    reasoning_level: null,
    tool_call_id: null,
    tool_name: null,
    tool_arguments: null,
    tool_result_call_id: null,
    tool_result_name: null,
    sequence: 1,
    created_at: "2026-03-29T14:05:00Z",
  },
  {
    id: "msg-0002-toolcall-websearch",
    role: "tool_call",
    content: null,
    model_id: "gpt-5",
    provider: "openai",
    reasoning_level: "none",
    tool_call_id: "call_abc123xyz",
    tool_name: "web_search",
    tool_arguments:
      '{"reason": "Need current information about LLM architecture and mechanics to give an accurate and up-to-date answer", "query": "how large language models work core mechanics transformer architecture 2026"}',
    tool_result_call_id: null,
    tool_result_name: null,
    sequence: 2,
    created_at: "2026-03-29T14:05:02Z",
  },
  {
    id: "msg-0003-toolresult-websearch",
    role: "tool_result",
    content:
      '[{"title": "How Large Language Models Work", "url": "https://arxiv.org/abs/2303.18223", "snippet": "LLMs are based on the transformer architecture, using self-attention to process sequences of tokens in parallel...", "score": 0.97}, {"title": "Transformers Explained", "url": "https://huggingface.co/blog/transformers-explained", "snippet": "The attention mechanism allows the model to weigh the importance of different tokens when generating each output token...", "score": 0.94}]',
    model_id: null,
    provider: null,
    reasoning_level: null,
    tool_call_id: null,
    tool_name: null,
    tool_arguments: null,
    tool_result_call_id: "call_abc123xyz",
    tool_result_name: "web_search",
    sequence: 3,
    created_at: "2026-03-29T14:05:08Z",
  },
  {
    id: "msg-0004-assistant-llm-intro",
    role: "assistant",
    content:
      'Large language models are built on the **transformer architecture**, introduced in the 2017 paper "Attention Is All You Need." Here\'s how they work at the core:\n\n## The Basic Flow\n\nText is broken into **tokens** — roughly 3–4 characters each. These tokens are converted into high-dimensional vectors called **embeddings**, which capture semantic meaning. The model then processes these embeddings through dozens of stacked transformer layers.\n\n## Attention Mechanism\n\nThe key innovation is **self-attention**: at each layer, every token can "attend" to every other token in the sequence. This lets the model understand context — "bank" means something different in "river bank" vs. "bank account." The attention weights are learned during training and determine how much influence each token has on others.\n\n## Training\n\nLLMs are trained through **next-token prediction**: given a sequence of tokens, predict what comes next. Done across trillions of tokens from the internet, books, and code, this teaches the model grammar, facts, reasoning patterns, and world knowledge — all from the statistical structure of language.\n\n## Inference\n\nWhen you send a message, the model runs a forward pass through all its layers and outputs a probability distribution over the vocabulary. It samples from this distribution to select the next token, then repeats — this is why LLM outputs are probabilistic, not deterministic.\n\nSources: [Arxiv: LLM Survey](https://arxiv.org/abs/2303.18223), [HuggingFace: Transformers Explained](https://huggingface.co/blog/transformers-explained)',
    model_id: "gpt-5",
    provider: "openai",
    reasoning_level: "none",
    tool_call_id: null,
    tool_name: null,
    tool_arguments: null,
    tool_result_call_id: null,
    tool_result_name: null,
    sequence: 4,
    created_at: "2026-03-29T14:05:15Z",
  },

  // --- Exchange 2: user asks about attention, Wayne thinks hard ---
  {
    id: "msg-0005-user-attention",
    role: "user",
    content:
      "Can you go deeper on the attention mechanism? I want to really understand how transformers process context — the math, the intuition, all of it.",
    model_id: null,
    provider: null,
    reasoning_level: null,
    tool_call_id: null,
    tool_name: null,
    tool_arguments: null,
    tool_result_call_id: null,
    tool_result_name: null,
    sequence: 5,
    created_at: "2026-03-29T14:12:00Z",
  },
  {
    id: "msg-0006-assistant-attention",
    role: "assistant",
    content:
      "The attention mechanism is elegant once you see the math behind it. Let me walk through it from first principles.\n\n## Queries, Keys, and Values\n\nFor each token, the model creates three vectors via learned weight matrices:\n- **Q (Query):** \"What am I looking for?\"\n- **K (Key):** \"What do I contain?\"\n- **V (Value):** \"What information do I carry?\"\n\nAttention scores are computed as:\n```\nAttention(Q, K, V) = softmax(QKᵀ / √d_k) · V\n```\n\n`QKᵀ` is a dot product measuring similarity between each query and every key. Dividing by `√d_k` (square root of key dimension) prevents the dot products from growing too large, keeping gradients stable. Softmax converts scores into probabilities that sum to 1.\n\n## What This Achieves\n\nEvery token produces a weighted sum of all value vectors, where the weights come from how similar its query is to each key. In \"The cat sat on the mat,\" when processing \"sat,\" the model attends strongly to \"cat\" (the subject) and \"mat\" (the object) — this is learned, not programmed.\n\n## Multi-Head Attention\n\nRather than doing this once, transformers run **multiple attention heads in parallel**, each with its own Q/K/V matrices. Different heads learn to attend to different relationships — one might track syntactic dependencies, another semantic similarity, another positional patterns. Their outputs are concatenated and projected back down.\n\n## Why Transformers Beat RNNs\n\nPrior architectures (RNNs, LSTMs) processed tokens sequentially — information from early tokens had to survive through many steps to influence late ones. Attention solves this with **direct connections**: any token can attend to any other in O(1) steps. The cost is O(n²) in sequence length, which is why context windows are expensive to extend.",
    model_id: "claude-sonnet-4-6-20250514",
    provider: "anthropic",
    reasoning_level: "high",
    tool_call_id: null,
    tool_name: null,
    tool_arguments: null,
    tool_result_call_id: null,
    tool_result_name: null,
    sequence: 6,
    created_at: "2026-03-29T14:12:45Z",
  },

  // --- Exchange 3: user asks about training, summary triggers ---
  {
    id: "msg-0007-user-training",
    role: "user",
    content:
      "What about the training process? How do you actually train a model like GPT or Claude from scratch — what are the stages and what's actually happening computationally?",
    model_id: null,
    provider: null,
    reasoning_level: null,
    tool_call_id: null,
    tool_name: null,
    tool_arguments: null,
    tool_result_call_id: null,
    tool_result_name: null,
    sequence: 7,
    created_at: "2026-03-29T14:28:00Z",
  },
  {
    id: "msg-0008-assistant-training",
    role: "assistant",
    content:
      "Training a frontier LLM happens in three distinct phases, each with different objectives and data.\n\n## Phase 1: Pre-Training\n\nThis is the bulk of the compute — weeks on thousands of GPUs. The model sees a massive corpus (web text, books, code, scientific papers) and is trained on **next-token prediction**: given the preceding context, predict the next token. Loss is cross-entropy between predicted probabilities and the actual next token.\n\nBackpropagation flows through all layers, updating billions of weights to minimize this loss. The model isn't taught anything explicitly — it learns grammar, facts, reasoning, and world knowledge purely from the statistical structure of text. At the end, you have a **base model**: extremely capable, but raw.\n\n## Phase 2: Supervised Fine-Tuning (SFT)\n\nThe base model is fine-tuned on curated **instruction-response pairs** written by humans — examples of good conversations, helpful answers, and appropriate behavior. This teaches the model to respond like an assistant rather than just continue text.\n\n## Phase 3: RLHF / RLAIF\n\nReinforcement Learning from Human (or AI) Feedback aligns the model with human preferences:\n1. Human raters compare pairs of model outputs and pick the better one\n2. A **reward model** is trained to predict human preferences\n3. The chat model is fine-tuned using PPO (or similar) to maximize reward model scores\n4. A KL-divergence penalty prevents the model from drifting too far from the SFT baseline\n\nThis is where safety behaviors, instruction-following quality, and conversational style are largely shaped.\n\n## Computationally\n\nPre-training a frontier model requires on the order of 10²³–10²⁴ FLOPS. A single forward pass for a 70B parameter model at FP16 is roughly 140 GFLOPS — multiply by trillions of tokens and backward pass cost (~2x forward) and you arrive at months of A100/H100 cluster time.",
    model_id: "gpt-5",
    provider: "openai",
    reasoning_level: "medium",
    tool_call_id: null,
    tool_name: null,
    tool_arguments: null,
    tool_result_call_id: null,
    tool_result_name: null,
    sequence: 8,
    created_at: "2026-03-29T14:42:00Z",
  },
];

// ---------------------------------------------------------------------------
// 3. Token Counts
// ---------------------------------------------------------------------------

export const MOCK_TOKEN_COUNTS: TokenCounts = {
  tokens_openai: 3847,
  tokens_anthropic: 3712,
  tokens_openrouter: 4021,
  output_tokens: 612,
  context_window_size: 400000,
  active_token_count: 3847,
  active_provider: "openai",
  model_id: "gpt-5",
  utilization: 0.00962,
};

// ---------------------------------------------------------------------------
// 4. Model Catalog
// ---------------------------------------------------------------------------

export const MOCK_MODEL_CATALOG: ModelCatalog = {
  providers: {
    openai: {
      provider: "openai",
      available: true,
      models: [
        {
          id: "gpt-5.2",
          name: "GPT-5.2",
          provider: "openai",
          context_window: 400000,
          max_output: 128000,
          supports_tools: true,
          supports_reasoning: true,
          reasoning_levels: ["none", "low", "medium", "high", "xhigh"],
        },
        {
          id: "gpt-5",
          name: "GPT-5",
          provider: "openai",
          context_window: 400000,
          max_output: 128000,
          supports_tools: true,
          supports_reasoning: true,
          reasoning_levels: ["none", "low", "medium", "high", "xhigh"],
        },
        {
          id: "gpt-5-mini",
          name: "GPT-5 mini",
          provider: "openai",
          context_window: 400000,
          max_output: 128000,
          supports_tools: true,
          supports_reasoning: true,
          reasoning_levels: ["none", "low", "medium", "high", "xhigh"],
        },
        {
          id: "gpt-5-nano",
          name: "GPT-5 nano",
          provider: "openai",
          context_window: 400000,
          max_output: 128000,
          supports_tools: true,
          supports_reasoning: true,
          reasoning_levels: ["none", "low", "medium", "high", "xhigh"],
        },
      ],
    },
    anthropic: {
      provider: "anthropic",
      available: true,
      models: [
        {
          id: "claude-opus-4-6-20250130",
          name: "Claude Opus 4.6",
          provider: "anthropic",
          context_window: 200000,
          max_output: 8192,
          supports_tools: true,
          supports_reasoning: true,
          reasoning_levels: ["off", "low", "medium", "high", "adaptive"],
        },
        {
          id: "claude-sonnet-4-6-20250514",
          name: "Claude Sonnet 4.6",
          provider: "anthropic",
          context_window: 200000,
          max_output: 8192,
          supports_tools: true,
          supports_reasoning: true,
          reasoning_levels: ["off", "low", "medium", "high", "adaptive"],
        },
        {
          id: "claude-haiku-4-5-20251001",
          name: "Claude Haiku 4.5",
          provider: "anthropic",
          context_window: 200000,
          max_output: 8192,
          supports_tools: true,
          supports_reasoning: true,
          reasoning_levels: ["off", "low", "medium", "high", "adaptive"],
        },
      ],
    },
    openrouter: {
      provider: "openrouter",
      available: true,
      models: [
        {
          id: "deepseek/deepseek-r1",
          name: "DeepSeek R1",
          provider: "openrouter",
          context_window: 128000,
          max_output: 4096,
          supports_tools: true,
          supports_reasoning: true,
          reasoning_levels: [],
        },
        {
          id: "deepseek/deepseek-v3.2",
          name: "DeepSeek V3.2",
          provider: "openrouter",
          context_window: 128000,
          max_output: 4096,
          supports_tools: true,
          supports_reasoning: false,
          reasoning_levels: [],
        },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// 5. Visibility Records
// ---------------------------------------------------------------------------

const WEB_SEARCH_TOOL_OPENAI = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search the web for current or factual information needed to answer the user's question. Use this when the question requires up-to-date information, specific facts, or knowledge you may not have.",
    parameters: {
      type: "object" as const,
      properties: {
        reason: { type: "string", description: "Brief explanation of why web search is needed" },
        query: { type: "string", description: "The information need described clearly for the search system" },
      },
      required: ["reason", "query"],
    },
  },
};

const WEB_SEARCH_TOOL_ANTHROPIC = {
  name: "web_search",
  description:
    "Search the web for current or factual information needed to answer the user's question.",
  input_schema: {
    type: "object" as const,
    properties: {
      reason: { type: "string", description: "Brief explanation of why web search is needed" },
      query: { type: "string", description: "The information need described clearly for the search system" },
    },
    required: ["reason", "query"],
  },
};

const SYSTEM_MESSAGE = {
  role: "system" as const,
  content:
    "You are Wayne, a personal AI assistant. Today's date is March 29, 2026.\n\nBe helpful, direct, and thorough. Prefer precision over hedging. When you don't know something, say so. Use markdown formatting where it aids readability.",
};

// Message 1 visibility: web search tool trace
const VISIBILITY_MSG_0004: VisibilityRecord = {
  message_id: "msg-0004-assistant-llm-intro",
  request_payload: {
    messages: [
      SYSTEM_MESSAGE,
      {
        role: "user",
        content:
          "How do large language models actually work? I want to understand the core mechanics.",
      },
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_abc123xyz",
            name: "web_search",
            arguments:
              '{"reason": "Need current information about LLM architecture and mechanics to give an accurate and up-to-date answer", "query": "how large language models work core mechanics transformer architecture 2026"}',
          },
        ],
      },
      {
        role: "tool_result",
        tool_call_id: "call_abc123xyz",
        tool_name: "web_search",
        content:
          '[{"title": "How Large Language Models Work", "url": "https://arxiv.org/abs/2303.18223", "snippet": "LLMs are based on the transformer architecture, using self-attention to process sequences of tokens in parallel...", "score": 0.97}, {"title": "Transformers Explained", "url": "https://huggingface.co/blog/transformers-explained", "snippet": "The attention mechanism allows the model to weigh the importance of different tokens when generating each output token...", "score": 0.94}]',
      },
    ],
    model_id: "gpt-5",
    provider: "openai",
    reasoning_level: "none",
    tools: [WEB_SEARCH_TOOL_OPENAI],
  },
  response_metadata: {
    finish_reason: "stop",
    usage: {
      prompt_tokens: 1284,
      completion_tokens: 342,
    },
    auto_title: {
      prompt:
        "User: How do large language models actually work? I want to understand the core mechanics.\nAssistant: Large language models are built on the transformer architecture...",
      response: "How LLMs Work",
    },
  },
  tokens_openai: 1284,
  tokens_anthropic: 1241,
  tokens_openrouter: 1342,
  output_tokens: 342,
  context_window_size: 400000,
  active_token_count: 1284,
  reasoning_content: null,
  summary_event: null,
  tool_trace: {
    tool_name: "web_search",
    tool_call_id: "call_abc123xyz",
    tool_arguments: {
      reason:
        "Need current information about LLM architecture and mechanics to give an accurate and up-to-date answer",
      query:
        "how large language models work core mechanics transformer architecture 2026",
    },
    steps: [
      {
        name: "query_generation",
        status: "complete",
        data: {
          ready_queries: [
            "how large language models work transformer architecture 2026",
            "LLM self-attention mechanism explained",
            "next token prediction training large language models",
          ],
          pending_queries: [
            {
              template: "{{dominant_architecture}} vs alternatives LLM architecture 2026",
              slot: "dominant_architecture",
            },
          ],
        },
        duration_ms: 740,
      },
      {
        name: "execute_queries",
        status: "complete",
        data: {
          queries: [
            "how large language models work transformer architecture 2026",
            "LLM self-attention mechanism explained",
            "next token prediction training large language models",
          ],
          result_count: 22,
          entities: {
            dominant_architecture: "Transformer",
          },
        },
        duration_ms: 2310,
      },
      {
        name: "round2_search",
        status: "complete",
        data: {
          filled_queries: ["Transformer vs alternatives LLM architecture 2026"],
          result_count: 8,
        },
        duration_ms: 1180,
      },
      {
        name: "filter_results",
        status: "complete",
        data: {
          kept: 14,
          removed: 16,
          removed_reasons: [
            { url: "https://medium.com/old-ml-post-2022/what-is-ai", reason: "too_old" },
            { url: "https://seo-bait.example.com/what-is-ai-explained", reason: "low_score" },
            { url: "https://news.ycombinator.com/item?id=38291847", reason: "duplicate" },
            { url: "https://clickbait-tech.example.com/ai-explained-simply", reason: "low_score" },
            { url: "https://old-textbook-site.example.com/ml-chapter-3", reason: "too_old" },
          ],
        },
        duration_ms: 8,
      },
      {
        name: "coverage_check",
        status: "complete",
        data: {
          sufficient: true,
          missing: [],
          confidence: 0.95,
        },
        duration_ms: 620,
      },
    ],
  },
};

// Message 2 visibility: extended thinking / reasoning trace
const VISIBILITY_MSG_0006: VisibilityRecord = {
  message_id: "msg-0006-assistant-attention",
  request_payload: {
    messages: [
      SYSTEM_MESSAGE,
      {
        role: "user",
        content:
          "How do large language models actually work? I want to understand the core mechanics.",
      },
      {
        role: "assistant",
        content:
          'Large language models are built on the transformer architecture, introduced in the 2017 paper "Attention Is All You Need"...',
      },
      {
        role: "user",
        content:
          "Can you go deeper on the attention mechanism? I want to really understand how transformers process context — the math, the intuition, all of it.",
      },
    ],
    model_id: "claude-sonnet-4-6-20250514",
    provider: "anthropic",
    reasoning_level: "high",
    tools: [WEB_SEARCH_TOOL_ANTHROPIC],
  },
  response_metadata: {
    finish_reason: "stop",
    usage: {
      prompt_tokens: 1891,
      completion_tokens: 524,
    },
  },
  tokens_openai: 1891,
  tokens_anthropic: 1847,
  tokens_openrouter: 1984,
  output_tokens: 524,
  context_window_size: 200000,
  active_token_count: 1847,
  reasoning_content:
    'The user wants a deep explanation of the attention mechanism — they explicitly said "the math, the intuition, all of it." This is a technical deep dive request, not a high-level overview.\n\nLet me think through what a genuinely thorough explanation requires:\n\n1. The fundamental intuition — why attention was invented, what problem it solves\n2. The QKV decomposition — where these three vectors come from, what they represent conceptually\n3. The actual math — Attention(Q,K,V) = softmax(QKᵀ / √d_k) · V — broken down step by step\n4. The scaling factor √d_k — why it matters, what happens without it (softmax saturation, vanishing gradients)\n5. Multi-head attention — why running multiple heads in parallel is better than one large attention\n6. The contrast with RNNs — why attention was a step change, not an incremental improvement\n\nI should be careful not to oversimplify the math. The user asked for it explicitly. At the same time I shouldn\'t dump a textbook chapter — I need to stay structured and build up the intuition before the formula.\n\nOne thing worth being precise about: the query/key/value analogy. Some explanations get fuzzy here. Q is the "search query" from the current token, K is the "index" of each token (what it can be found by), V is the actual content. The dot product QKᵀ measures how much each key matches the query. After softmax, we have a probability distribution over positions. Multiply by V to get a weighted blend of all values.\n\nThe scaling by √d_k: as d_k grows, dot products grow in magnitude proportional to d_k. Large magnitude inputs to softmax push outputs toward 0 or 1, collapsing gradients. Dividing by √d_k keeps the variance of the dot products at roughly 1 regardless of dimension size. This is a classic variance-stabilization trick.\n\nMulti-head: instead of one attention function in d_model dimensions, we run h heads each in d_model/h dimensions. Each head can specialize — syntactic relationships, coreference, semantic similarity, positional dependencies. The outputs are concatenated and linearly projected back to d_model. This is empirically much better than a single large head.\n\nI\'ll skip positional encoding detail — it would make the response too long and the user didn\'t specifically ask about it. I\'ll omit it entirely rather than mention it briefly and create a loose end.\n\nStructure plan:\n- QKV section with conceptual intuition first, then what the vectors actually are mechanically\n- The formula with step-by-step breakdown\n- Concrete example of what it achieves\n- Multi-head attention\n- Why this beats RNNs\n\nLength: this warrants a substantial response given the explicit request for depth. I\'ll aim for comprehensive but not exhaustive.',
  summary_event: null,
  tool_trace: null,
};

// Message 3 visibility: rolling summary event
const VISIBILITY_MSG_0008: VisibilityRecord = {
  message_id: "msg-0008-assistant-training",
  request_payload: {
    messages: [
      SYSTEM_MESSAGE,
      {
        role: "system",
        content:
          "[Conversation summary — generated by GPT-5 nano]\n\nThe user asked how large language models work. Wayne explained the transformer architecture, the token-embedding-attention pipeline, and how next-token prediction during pre-training instills world knowledge. The user then asked for a deeper explanation of the attention mechanism. Wayne covered the QKV decomposition, the attention formula (Attention(Q,K,V) = softmax(QKᵀ / √d_k) · V), the intuition behind the scaling factor, multi-head attention, and why attention outperforms RNNs by providing direct O(1) connections between any two tokens.",
      },
      {
        role: "user",
        content:
          "What about the training process? How do you actually train a model like GPT or Claude from scratch — what are the stages and what's actually happening computationally?",
      },
    ],
    model_id: "gpt-5",
    provider: "openai",
    reasoning_level: "medium",
    tools: [WEB_SEARCH_TOOL_OPENAI],
  },
  response_metadata: {
    finish_reason: "stop",
    usage: {
      prompt_tokens: 2847,
      completion_tokens: 612,
    },
  },
  tokens_openai: 2847,
  tokens_anthropic: 2712,
  tokens_openrouter: 3021,
  output_tokens: 612,
  context_window_size: 400000,
  active_token_count: 2847,
  reasoning_content: null,
  summary_event: {
    summary_text:
      "The user asked how large language models work. Wayne explained the transformer architecture, the token-embedding-attention pipeline, and how next-token prediction during pre-training instills world knowledge. The user then asked for a deeper explanation of the attention mechanism. Wayne covered the QKV decomposition, the attention formula (Attention(Q,K,V) = softmax(QKᵀ / √d_k) · V), the intuition behind the scaling factor, multi-head attention, and why attention outperforms RNNs by providing direct O(1) connections between any two tokens.",
    summarized_message_ids: [
      "msg-0001-user-llm-intro",
      "msg-0002-toolcall-websearch",
      "msg-0003-toolresult-websearch",
      "msg-0004-assistant-llm-intro",
      "msg-0005-user-attention",
      "msg-0006-assistant-attention",
    ],
    tokens_before: 162400,
    tokens_after: 81200,
    model_used: "gpt-5-nano",
  },
  tool_trace: null,
};

// Keyed by message_id — only the 3 assistant messages have visibility records.
export const MOCK_VISIBILITY: Record<string, VisibilityRecord> = {
  "msg-0004-assistant-llm-intro": VISIBILITY_MSG_0004,
  "msg-0006-assistant-attention": VISIBILITY_MSG_0006,
  "msg-0008-assistant-training": VISIBILITY_MSG_0008,
};
