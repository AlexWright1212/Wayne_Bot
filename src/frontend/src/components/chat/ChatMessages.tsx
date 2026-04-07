import { useEffect, useRef } from "react";
import { useConversationStore } from "@/stores/useConversationStore";
import { MOCK_VISIBILITY } from "@/mocks/data";
import { Skeleton } from "@/components/ui/skeleton";
import { UserMessage } from "./messages/UserMessage";
import { AssistantMessage } from "./messages/AssistantMessage";

export function ChatMessages() {
  const activeConversationId = useConversationStore((s) => s.activeConversationId);
  const messagesByConvId = useConversationStore((s) => s.messagesByConvId);
  const isLoadingMessages = useConversationStore((s) => s.isLoadingMessages);
  const bottomRef = useRef<HTMLDivElement>(null);

  const allMessages =
    (activeConversationId ? messagesByConvId[activeConversationId] : null) ?? [];

  // Only render user + assistant messages; tool_call / tool_result / system are
  // captured in the visibility record and surfaced via the ToolStepsBlock.
  const visibleMessages = allMessages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );

  // Snap to bottom when switching conversations; smooth-scroll when appending.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" });
  }, [activeConversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages.length]);

  if (isLoadingMessages) {
    return (
      <div className="scrollbar-subtle flex-1 overflow-y-auto px-5 py-6">
        <div className="flex flex-col gap-6">
          <div className="flex justify-end"><Skeleton className="h-10 w-48 rounded-2xl" /></div>
          <div className="flex justify-start"><Skeleton className="h-20 w-96 rounded-2xl" /></div>
          <div className="flex justify-end"><Skeleton className="h-10 w-36 rounded-2xl" /></div>
          <div className="flex justify-start"><Skeleton className="h-16 w-80 rounded-2xl" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="scrollbar-subtle flex-1 overflow-y-auto px-5 py-6">
      <div className="flex flex-col gap-6">
        {visibleMessages.map((message) => {
          if (message.role === "user") {
            return (
              <UserMessage key={message.id} content={message.content ?? ""} />
            );
          }
          return (
            <AssistantMessage
              key={message.id}
              message={message}
              visibility={MOCK_VISIBILITY[message.id] ?? null}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
