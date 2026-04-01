# Wayne_Bot

A personalized LLM chatbot built from scratch, with memory, RAG, email management, subagent orchestration, and Obsidian vault integration.

## Startup

### Backend

```bash
poetry run uvicorn src.backend.main:app --reload
```

Runs at `http://127.0.0.1:8000`. API docs at `http://127.0.0.1:8000/docs`.

### Frontend

```bash
cd src/frontend
npm run dev
```

Runs at `http://localhost:5173`.
