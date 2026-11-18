import { useState } from "react";
import { cn } from "../lib/utils.ts";

interface StreamInputProps {
  onSubmit: (url: string) => Promise<void>;
  loading?: boolean;
}

export function StreamInput({ onSubmit, loading }: StreamInputProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  const validate = (value: string): boolean => {
    try {
      const parsed = new URL(value);
      return (
        parsed.hostname === "www.youtube.com" ||
        parsed.hostname === "youtube.com" ||
        parsed.hostname === "youtu.be" ||
        parsed.hostname === "m.youtube.com"
      );
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!url.trim()) {
      setError("URL required");
      return;
    }

    if (!validate(url)) {
      setError("Invalid YouTube URL");
      return;
    }

    try {
      await onSubmit(url.trim());
      setUrl("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="flex flex-col gap-2">
        <label className="text-xs font-mono text-text-secondary tracking-wider">
          YOUTUBE LIVE URL
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError("");
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            className={cn(
              "flex-1 bg-surface-1 border border-border px-3 py-2.5",
              "font-mono text-sm text-text-primary placeholder:text-text-muted",
              "focus:outline-none focus:border-accent transition-colors",
              error && "border-danger"
            )}
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className={cn(
              "px-6 py-2.5 font-mono text-xs font-semibold tracking-wider",
              "bg-accent/10 border border-accent/30 text-accent",
              "hover:bg-accent/20 transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            {loading ? "..." : "ADD"}
          </button>
        </div>
        {error && (
          <p className="text-xs font-mono text-danger">{error}</p>
        )}
      </div>
    </form>
  );
}
