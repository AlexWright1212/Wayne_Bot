export function ChatEmpty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 select-none">
      <span className="text-xl font-medium text-foreground tracking-tight">
        Wayne
      </span>
      <p className="text-sm text-muted-foreground">
        Ask anything. Use the controls above to switch models.
      </p>
    </div>
  );
}
