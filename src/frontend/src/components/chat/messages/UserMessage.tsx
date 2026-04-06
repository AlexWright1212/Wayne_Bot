interface UserMessageProps {
  content: string;
}

export function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="flex justify-end">
      <div className="bg-accent rounded-[8px] px-5 py-4 max-w-[80%]">
        <p className="text-[17px] leading-relaxed whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}
