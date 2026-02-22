# Wayne_Bot — Feature Brainstorming

A living doc for ideas, big and small. No filtering yet — capture everything.

---

## Foundation Layer (Build These First)

### 1. Core LLM Chat Loop
- Bare-bones chat interface (CLI first, UI later) backed by the Claude API
- Stream responses token-by-token for a real-time feel
- Switchable model backend (Sonnet for speed, Opus for depth)

### 2. Short-Term Conversation Memory
- Keep a rolling window of the last N messages as context
- Summarize older turns automatically when context gets long
- Let the model "remember" what was said 10 messages ago without blowing the context window

### 3. Long-Term Persistent Memory
- Vector-store backed memory (e.g. ChromaDB or Qdrant locally)
- Auto-extract facts from conversation: "User prefers X", "User's project is Y"
- Surface relevant memories at the start of each session: "Last time we talked about..."
- Manual memory commands: `remember this`, `forget that`

### 4. RAG (Retrieval-Augmented Generation)
- Index any folder of documents (PDFs, markdown, notes) into a local vector store
- On each query, retrieve the top-k relevant chunks and inject them into context
- Show sources: "I found this in `docs/architecture.md` line 42"
- Re-index on file change (watch mode)

---

## Productivity Integrations

### 5. Email Management (Gmail / Outlook)
- Read inbox: summarize unread emails, flag urgent ones
- Draft replies in your voice (trained on your past emails)
- Auto-label / auto-archive by rules you describe in natural language
- "What emails need my attention today?" as a daily briefing

### 6. Calendar Awareness
- Read upcoming events from Google Calendar
- Answer: "Am I free Thursday afternoon?" or "What's my week look like?"
- Suggest meeting times based on availability
- Morning briefing: "Today you have 3 meetings and 14 unread emails"

### 7. Task / To-Do Orchestration
- Sync with a task manager (Todoist, Notion, or a local markdown file)
- Break a big goal into subtasks automatically
- Daily standup: "What should I work on today?" (priority-ranked)
- Weekly review: what got done, what's stuck, what to focus on next

---

## Knowledge & Research

### 8. Obsidian Vault Explorer
- Index your Obsidian vault into a searchable knowledge base
- Answer questions grounded in your own notes: "What did I write about X?"
- Surface connections: "This reminds me of a note you wrote in March about Y"
- Vault-wide search with semantic similarity (not just keyword)

### 9. Obsidian Quiz Mode
- Pick a note or a tag and Wayne_Bot quizzes you on it
- Spaced repetition: track which concepts you've been quizzed on and when
- Formats: flashcard-style Q&A, fill-in-the-blank, or Socratic questioning
- Score tracking: "You got 8/10 on your Architecture notes"

### 10. Personalized Research Assistant
- Given a topic, autonomously search the web, read pages, and synthesize a briefing
- Save research sessions to the vault automatically
- Track what you've already researched so it doesn't repeat itself
- "What's new in [topic] since I last asked?"

### 11. "Explain It to Me" Mode
- Take any article, paper, or pasted text and explain it at the level you choose
- Levels: ELI5, casual, technical, expert
- Follow-up questions welcomed: drills deeper on whatever you found confusing

---

## Agent Orchestration

### 12. Subagent Spawning
- Wayne_Bot can spin up specialized subagents for long-running tasks
- Example subagents: ResearchAgent, EmailDraftAgent, CodeReviewAgent
- Subagents run in parallel and report back with results
- Wayne_Bot synthesizes the outputs and presents a unified answer

### 13. Tool Use Framework
- Pluggable tool registry: add new tools by dropping in a function + docstring
- Built-in tools: web search, file read/write, run Python snippet, shell command
- Wayne_Bot decides which tool(s) to call based on the query (ReAct loop)
- Tool call transparency: show what tools were invoked and why

### 14. Autonomous Task Execution
- Give Wayne_Bot a multi-step goal and let it plan + execute
- Example: "Research the top 5 vector databases, compare them, and write a recommendation doc"
- Checkpointing: pause and confirm before irreversible actions (send email, delete file)
- Execution log: what steps were taken, what succeeded, what failed

---

## Personalization & Voice

### 15. Writing Style Mirroring
- Analyze past writing samples (emails, notes, messages) to learn your voice
- When drafting anything, match your tone, vocabulary, and sentence structure
- Adjustable formality slider per use case

### 16. Daily Briefing Mode
- Every morning: weather, calendar, email summary, top tasks, news digest
- Personalized news feed based on topics you care about (tracked over time)
- "What should I know before I start my day?"

### 17. Mood / Energy Awareness
- Optional: brief check-in at session start ("How are you feeling? What's your energy?")
- Adjust response depth and length accordingly
- Low energy → short, actionable answers. High focus → deep dives welcome

---

## Meta / System

### 18. Session Continuity
- Auto-save session summaries so Wayne_Bot picks up where it left off
- "Last session we were debugging your RAG pipeline. Want to continue?"
- Tag sessions by project so context doesn't bleed across work areas

### 19. Self-Improvement Loop
- Let Wayne_Bot track which of its answers you found unhelpful (thumbs down / corrections)
- Build a feedback log that informs future system prompt tuning
- Periodic self-review: "Here's what I've been getting wrong lately"

### 20. Local-First Privacy Mode
- Option to run entirely offline using a local model (Ollama + Llama / Mistral)
- No data leaves the machine in this mode
- Graceful degradation: some features (web search) disabled, core chat still works

---

## Fun / Experimental

### 21. Debate Mode
- Present a position; Wayne_Bot argues the other side rigorously
- Great for stress-testing ideas and catching blind spots

### 22. Second Brain Sync
- Periodically review your Obsidian vault and proactively surface "you should revisit this"
- Connect dots between notes you wrote months apart
- "You wrote about X in January and Y last week — they're related, here's why"

### 23. Habit & Goal Tracker
- Check in weekly on your stated goals
- Celebrate wins, gently surface what's slipping
- No nagging — only surfaces when you ask or at the weekly review

---

*Last updated: initial brainstorm — add, edit, reprioritize freely.*
