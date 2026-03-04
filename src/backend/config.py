from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://wayne:wayne@localhost:5432/wayne"
    test_database_url: str = "postgresql+asyncpg://wayne:wayne@localhost:5432/wayne_test"

    openai_api_key: str = ""
    anthropic_api_key: str = ""
    openrouter_api_key: str = ""
    tavily_api_key: str = ""

    lightweight_model: str = "gpt-5-nano"

    summary_threshold: float = 0.80
    summary_budget: float = 0.50

    tavily_score_threshold: float = 0.75
    tavily_date_threshold_days: int = 365
    tavily_domain_blacklist: list[str] = []
    search_max_retries: int = 2

    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
