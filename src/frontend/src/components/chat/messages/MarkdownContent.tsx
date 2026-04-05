import { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CopyIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ── Code block wrapper — dark bg + copy button ────────────────────────────────

function PreBlock({ children }: { children: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const text = preRef.current?.innerText ?? "";
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="group relative my-3">
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-lg bg-[#1a1a1a] px-4 py-3 font-mono text-[13px] leading-relaxed"
      >
        {children}
      </pre>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={handleCopy}
        className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
      >
        {copied ? (
          <CheckIcon className="size-3 text-primary" />
        ) : (
          <CopyIcon className="size-3" />
        )}
      </Button>
    </div>
  );
}

// ── MarkdownContent ───────────────────────────────────────────────────────────

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="font-serif text-[14px] leading-[1.6]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: ({ children }) => (
            <p className="my-2 first:mt-0 last:mb-0 leading-[1.6]">{children}</p>
          ),
          h1: ({ children }) => (
            <h1 className="font-sans mt-4 mb-2 text-[17px] font-medium first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="font-sans mt-4 mb-2 text-[15px] font-semibold first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="font-sans mt-3 mb-1 text-[14px] font-semibold first:mt-0">
              {children}
            </h3>
          ),
          ul: ({ children }) => (
            <ul className="my-2 flex list-disc flex-col gap-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 flex list-decimal flex-col gap-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-[1.6]">{children}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-primary underline-offset-2 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-4 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,
          pre: ({ children }) => <PreBlock>{children}</PreBlock>,
          code: ({ className, children }) => {
            // Block code inside <pre> — let hljs handle coloring, we just set font
            if (className) {
              return (
                <code className={cn(className, "font-mono text-[13px]")}>
                  {children}
                </code>
              );
            }
            // Inline code — orange mono pill
            return (
              <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[13px] text-[--code]">
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
