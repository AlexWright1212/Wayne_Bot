"""Central chat orchestrator.

handle_user_message() is an async generator that coordinates the full
chat flow: rolling summary → LLM streaming → tool call sub-loop →
visibility capture → auto-title.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncGenerator, Callable, Awaitable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.config import Settings
from src.backend.exceptions import ProviderError
from src.backend.models.message import MessageRole
from src.backend.providers.base import ChatMessage, CompletionResult, StreamEvent, ToolCallData
from src.backend.providers.registry import ProviderRegistry
from src.backend.services.auto_title import AutoTitleService
from src.backend.services.conversation import ConversationService
from src.backend.services.rolling_summary import RollingSummaryService, SummaryResult
from src.backend.services.system_prompt import SYSTEM_PROMPT
from src.backend.services.token_counter import TokenCounter
from src.backend.services.visibility import VisibilityService
from src.backend.tools.base import ToolContext, ToolStep
from src.backend.tools.framework import ToolFramework

logger = logging.getLogger(__name__)

# Sentinel and error marker for the tool call sub-loop queue
_SENTINEL = object()


@dataclass
class _ToolTaskError:
    exception: Exception


async def _run_tool_task(
    framework: ToolFramework,
    tool_name: str,
    arguments: dict,
    context: ToolContext,
    queue: asyncio.Queue,
) -> None:
    """Background task wrapper with guaranteed sentinel delivery.

    The try/finally ensures the sentinel ALWAYS reaches the drain loop,
    even if an exception is raised or the task is cancelled.
    """
    try:
        result = await framework.execute_tool_call(
            tool_name=tool_name,
            arguments=arguments,
            context=context,
            on_step=queue.put,
        )
        return result  # type: ignore[return-value]  # result is retrieved via task.result()
    except Exception as exc:
        await queue.put(_ToolTaskError(exc))  # error travels through the queue
    finally:
        await queue.put(_SENTINEL)  # ALWAYS pushed — success or failure


def _serialize_messages(messages: list[ChatMessage]) -> list[dict]:
    """Convert ChatMessage objects to JSON-serializable dicts for request_payload capture."""
    result = []
    for msg in messages:
        d: dict = {"role": msg.role}
        if msg.content is not None:
            d["content"] = msg.content
        if msg.tool_calls:
            d["tool_calls"] = [
                {"id": tc.id, "name": tc.name, "arguments": tc.arguments}
                for tc in msg.tool_calls
            ]
        if msg.tool_call_id is not None:
            d["tool_call_id"] = msg.tool_call_id
        if msg.tool_name is not None:
            d["tool_name"] = msg.tool_name
        result.append(d)
    return result


class ChatService:
    def __init__(
        self,
        provider_registry: ProviderRegistry,
        conversation_service: ConversationService,
        auto_title_service: AutoTitleService,
        rolling_summary_service: RollingSummaryService,
        tool_framework: ToolFramework,
        visibility_service: VisibilityService,
        token_counter: TokenCounter,
        settings: Settings,
    ) -> None:
        self._registry = provider_registry
        self._conv_service = conversation_service
        self._auto_title_service = auto_title_service
        self._rolling_summary_service = rolling_summary_service
        self._tool_framework = tool_framework
        self._visibility_service = visibility_service
        self._token_counter = token_counter
        self._settings = settings

    async def handle_user_message(
        self,
        conversation_id: uuid.UUID,
        content: str,
        model_id: str,
        provider_name: str,
        reasoning_level: str | None,
        db: AsyncSession,
        on_title_updated: Callable[[str], Awaitable[None]] | None = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """Process a user message and stream LLM response events.

        Integrates rolling summary (Unit S), tool framework (Unit T),
        and visibility capture (Unit V) into the chat flow.
        """
        # 1. Persist user message
        user_msg = await self._conv_service.add_message(
            conversation_id=conversation_id,
            role=MessageRole.user,
            content=content,
            db=db,
        )

        # 2. Assemble context: system prompt + full conversation history
        history = await self._conv_service.get_messages_as_chat(conversation_id, db)
        messages: list[ChatMessage] = [
            ChatMessage(role="system", content=SYSTEM_PROMPT),
            *history,
        ]

        # 3. Rolling summary check — pre-check threshold so we can yield
        #    summary_started BEFORE the blocking work begins.
        summary_result: SummaryResult | None = None
        try:
            token_count = await self._token_counter.count_for_provider(
                messages, provider_name, model_id
            )
            context_window = self._token_counter.get_context_window(model_id, provider_name)
            threshold = self._settings.summary_threshold * context_window

            if context_window > 0 and token_count >= threshold:
                yield StreamEvent(type="summary_started")
                try:
                    messages, summary_result = await self._rolling_summary_service.check_and_summarize(
                        conversation_id=conversation_id,
                        messages=messages,
                        model_id=model_id,
                        provider=provider_name,
                        db=db,
                    )
                except Exception:
                    logger.exception("Rolling summary failed — proceeding with full context")
                    summary_result = None
                yield StreamEvent(type="summary_complete")
        except Exception:
            logger.exception("Token pre-check failed — skipping rolling summary")

        # 4. Build the lightweight_complete closure (for tool harness)
        def _make_lightweight_complete() -> Callable:
            async def lightweight_complete(
                msgs: list[ChatMessage],
                response_format: dict | None = None,
            ) -> CompletionResult:
                openai_provider = self._registry.get("openai")
                return await openai_provider.complete(
                    messages=msgs,
                    model_id=self._settings.lightweight_model,
                    response_format=response_format,
                )
            return lightweight_complete

        lightweight_complete = _make_lightweight_complete()

        # 5. Accumulation state (shared across tool rounds)
        accumulated_content = ""
        accumulated_reasoning = ""
        tool_traces: list[ToolStep] = []
        provider = self._registry.get(provider_name)

        # Outer loop — one iteration per LLM pass (initial + after each tool round)
        tool_round = 0
        current_messages = messages

        while True:
            # 6. Determine tool schemas for this pass
            supports_tools = self._tool_framework.supports_tools(model_id, provider_name)
            tool_schemas: list[dict] | None = (
                self._tool_framework.get_schemas_for_provider(provider_name)
                if supports_tools and tool_round < 2
                else None
            )

            # 7. Capture request payload (before each LLM call)
            request_payload = {
                "messages": _serialize_messages(current_messages),
                "model_id": model_id,
                "provider": provider_name,
                "reasoning_level": reasoning_level,
                "tools": tool_schemas,
            }

            got_tool_call = False

            try:
                async for event in provider.stream_chat(
                    messages=current_messages,
                    model_id=model_id,
                    reasoning_level=reasoning_level,
                    tools=tool_schemas,
                ):
                    if event.type == "token":
                        accumulated_content += event.content
                        yield event

                    elif event.type == "reasoning":
                        accumulated_reasoning += event.content
                        yield event

                    elif event.type == "tool_call":
                        if tool_round >= 2:
                            logger.warning("Tool round cap reached, ignoring tool call")
                            continue

                        tc = event.tool_call
                        if tc is None:
                            logger.warning("tool_call event missing tool_call data, skipping")
                            continue

                        try:
                            arguments_dict = json.loads(tc.arguments) if tc.arguments else {}
                        except json.JSONDecodeError:
                            arguments_dict = {}

                        # Persist tool_call message
                        await self._conv_service.add_message(
                            conversation_id=conversation_id,
                            role=MessageRole.tool_call,
                            content=None,
                            db=db,
                            tool_call_id=tc.id,
                            tool_name=tc.name,
                            tool_arguments=arguments_dict,
                        )

                        # Yield tool_call_start event
                        yield StreamEvent(
                            type="tool_call_start",
                            tool_call=tc,
                        )

                        # Create queue, context, background task
                        queue: asyncio.Queue = asyncio.Queue()
                        tool_context = ToolContext(
                            user_message=content,
                            conversation_id=conversation_id,
                            lightweight_complete=lightweight_complete,
                        )
                        task = asyncio.create_task(
                            _run_tool_task(
                                framework=self._tool_framework,
                                tool_name=tc.name,
                                arguments=arguments_dict,
                                context=tool_context,
                                queue=queue,
                            )
                        )

                        # Yield task ref for WS handler disconnect cancellation
                        yield StreamEvent(type="_tool_task_ref", metadata={"task": task})

                        # Drain loop — reads step events until sentinel arrives
                        tool_error = False
                        step_index = 0
                        while True:
                            try:
                                item = await asyncio.wait_for(queue.get(), timeout=60.0)
                            except asyncio.TimeoutError:
                                logger.error("Tool task drain timed out, cancelling task")
                                task.cancel()
                                yield StreamEvent(
                                    type="error",
                                    error="Tool execution timed out",
                                    metadata={"recoverable": True},
                                )
                                tool_error = True
                                break

                            if item is _SENTINEL:
                                break
                            if isinstance(item, _ToolTaskError):
                                logger.error("Tool task error: %s", item.exception)
                                yield StreamEvent(
                                    type="error",
                                    error=str(item.exception),
                                    metadata={"recoverable": True},
                                )
                                tool_error = True
                                break
                            # item is a ToolStep — yield as tool_step event
                            yield StreamEvent(
                                type="tool_step",
                                metadata={"step": item, "index": step_index},
                            )
                            step_index += 1

                        # Post-drain: await task to surface any uncaught exceptions
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass
                        except Exception:
                            logger.exception("Uncaught exception in tool task wrapper")

                        if tool_error:
                            return

                        # Collect ToolResult from the task
                        tool_result = task.result()
                        if tool_result is not None:
                            tool_traces.extend(tool_result.trace)

                            # Serialize result content
                            result_content = (
                                tool_result.content
                                if isinstance(tool_result.content, str)
                                else json.dumps(tool_result.content)
                            )
                        else:
                            result_content = "Tool execution returned no result."

                        # Persist tool_result message
                        await self._conv_service.add_message(
                            conversation_id=conversation_id,
                            role=MessageRole.tool_result,
                            content=result_content,
                            db=db,
                            tool_result_call_id=tc.id,
                            tool_result_name=tc.name,
                        )

                        # Append tool_call + tool_result to messages for second LLM pass
                        current_messages = list(current_messages) + [
                            ChatMessage(role="assistant", tool_calls=[tc]),
                            ChatMessage(
                                role="tool_result",
                                content=result_content,
                                tool_call_id=tc.id,
                                tool_name=tc.name,
                            ),
                        ]

                        got_tool_call = True
                        tool_round += 1
                        break  # break inner for loop, restart outer while loop

                    elif event.type == "done":
                        # 8. Persist assistant message
                        assistant_msg = await self._conv_service.add_message(
                            conversation_id=conversation_id,
                            role=MessageRole.assistant,
                            content=accumulated_content,
                            db=db,
                            model_id=model_id,
                            provider=provider_name,
                            reasoning_level=reasoning_level,
                        )

                        # 9. Update conversation's last-used model/provider
                        conv = await self._conv_service.get(conversation_id, db)
                        conv.last_model_id = model_id
                        conv.last_provider = provider_name
                        await db.flush()

                        # 10. Capture visibility
                        response_metadata = dict(event.metadata or {})
                        visibility_id: uuid.UUID | None = None
                        active_token_count: int | None = None
                        context_window_size: int | None = None
                        try:
                            visibility_id = await self._visibility_service.capture(
                                message_id=assistant_msg.id,
                                request_payload=request_payload,
                                response_metadata=response_metadata,
                                messages=current_messages,
                                model_id=model_id,
                                provider=provider_name,
                                db=db,
                                reasoning_content=accumulated_reasoning or None,
                                summary_event=summary_result,
                                tool_trace=tool_traces if tool_traces else None,
                            )
                            active_token_count = None  # retrieved from visibility record
                            context_window_size = self._token_counter.get_context_window(
                                model_id, provider_name
                            )
                        except Exception:
                            logger.exception("Visibility capture failed (non-critical)")

                        # 11. Build and yield stream_done
                        utilization: float | None = None
                        if active_token_count and context_window_size:
                            utilization = active_token_count / context_window_size

                        yield StreamEvent(
                            type="done",
                            metadata={
                                "message_id": str(assistant_msg.id),
                                "visibility_id": str(visibility_id) if visibility_id else None,
                                "token_counts": None,  # populated by visibility async background
                                "context_utilization": utilization,
                                **response_metadata,
                            },
                        )

                        # 12. Fire auto-title after the first exchange (2 messages total)
                        msg_count = await self._conv_service.count_messages(conversation_id, db)
                        if msg_count == 2 and on_title_updated is not None:
                            asyncio.create_task(
                                self._run_auto_title(
                                    conversation_id=conversation_id,
                                    first_assistant_msg_id=assistant_msg.id,
                                    user_content=content,
                                    assistant_content=accumulated_content,
                                    on_title_updated=on_title_updated,
                                )
                            )
                        return

                    elif event.type == "error":
                        yield event
                        return

            except ProviderError as exc:
                logger.error("Provider error during stream: %s", exc)
                yield StreamEvent(type="error", error=str(exc))
                return

            if not got_tool_call:
                break  # Safety: shouldn't reach here normally

    async def _run_auto_title(
        self,
        conversation_id: uuid.UUID,
        first_assistant_msg_id: uuid.UUID,
        user_content: str,
        assistant_content: str,
        on_title_updated: Callable[[str], Awaitable[None]],
    ) -> None:
        """Background task: generate title with its own DB session."""
        from src.backend.database import async_session_factory

        async with async_session_factory() as db:
            try:
                title = await self._auto_title_service.generate_title(
                    conversation_id=conversation_id,
                    user_message=user_content,
                    assistant_message=assistant_content,
                    db=db,
                )
                if title:
                    # Enrich the first assistant message's visibility record
                    prompt_used = (
                        f"User: {user_content[:500]}\nAssistant: {assistant_content[:500]}"
                    )
                    try:
                        await self._visibility_service.update_auto_title_data(
                            message_id=first_assistant_msg_id,
                            title_prompt=prompt_used,
                            title_response=title,
                            db=db,
                        )
                    except Exception:
                        logger.exception("Failed to update auto-title visibility data")
                await db.commit()
            except Exception:
                logger.exception("Auto-title background task failed")
                await db.rollback()
                return

        if title:
            try:
                await on_title_updated(title)
            except Exception:
                logger.warning("title_updated callback failed (WebSocket likely closed)")
