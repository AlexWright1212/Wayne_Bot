interface UserMessageProps {
  content: string;
}

export function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="bg-muted rounded-[8px] px-5 py-4">
      <p className="text-[17px] leading-relaxed whitespace-pre-wrap">{content}</p>
    </div>
  );
}
