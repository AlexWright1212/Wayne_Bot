import type { Message } from '@/lib/types'

interface UserMessageProps {
  message: Message
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[80%] rounded-lg bg-secondary px-4 py-3 text-sm">
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  )
}
