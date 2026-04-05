import { useState, useCallback } from "react";
import { SendHorizonalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend?: (content: string) => void;
  disabled?: boolean;
  className?: string;
}

export function ChatInput({ onSend, disabled, className }: ChatInputProps) {
  const [value, setValue] = useState("");

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend?.(trimmed);
    setValue("");
  }, [value, disabled, onSend]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className={cn("flex items-end gap-2", className)}>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message Wayne..."
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none min-h-[36px] max-h-[200px] overflow-y-auto py-2 text-sm leading-snug"
      />
      <Button
        size="icon-sm"
        disabled={!value.trim() || disabled}
        onClick={handleSend}
        className="mb-[1px] shrink-0"
      >
        <SendHorizonalIcon />
      </Button>
    </div>
  );
}
