import { useState } from "react";
import { Link } from "react-router-dom";
import { cn, formatTimeAgo } from "../lib/utils.ts";
import { CLIP_DURATIONS } from "@streamclipper/shared";

interface StreamRow {
  id: string;
  url: string;
  title: string;
  channelName: string;
  status: string;
  createdAt: string;
}

interface DashboardProps {
  streams: StreamRow[];
  onClip: (streamId: string, seconds: number) => void;
  onStop: (streamId: string) => void;
  onDelete: (streamId: string) => void;
  onStart: (streamId: string) => void;
}

export function Dashboard({
  streams,
  onClip,
  onStop,
  onDelete,
  onStart,
}: DashboardProps) {
  if (streams.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm font-mono text-text-muted">NO ACTIVE STREAMS</p>
        <p className="text-xs font-mono text-text-muted mt-2">
          Add a stream from the{" "}
          <Link to="/" className="text-accent hover:underline">
            home page
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {streams.map((stream) => (
        <StreamCard
          key={stream.id}
          stream={stream}
          onClip={(sec) => onClip(stream.id, sec)}
          onStop={() => onStop(stream.id)}
          onDelete={() => onDelete(stream.id)}
          onStart={() => onStart(stream.id)}
        />
      ))}
    </div>
  );
}

function StreamCard({
  stream,
  onClip,
  onStop,
  onDelete,
  onStart,
}: {
  stream: StreamRow;
  onClip: (seconds: number) => void;
  onStop: () => void;
  onDelete: () => void;
  onStart: () => void;
}) {
  const isBuffering = stream.status === "buffering";
  const isIdle = stream.status === "idle" || stream.status === "stopped";

  return (
    <div className="border border-border bg-surface-1 p-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusDot status={stream.status} />
            <span className="text-xs font-mono text-text-muted tracking-wider">
              {stream.status.toUpperCase()}
            </span>
          </div>
          <h3 className="text-sm font-medium text-text-primary truncate">
            {stream.title || "Untitled stream"}
          </h3>
          <p className="text-xs font-mono text-text-secondary mt-0.5">
            {stream.channelName || "Unknown channel"}
          </p>
          <p className="text-[10px] font-mono text-text-muted mt-1">
            {formatTimeAgo(stream.createdAt)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 shrink-0">
          {/* Quick clip buttons */}
          {isBuffering && (
            <div className="flex gap-1">
              {CLIP_DURATIONS.map((sec) => (
                <button
                  key={sec}
                  onClick={() => onClip(sec)}
                  className="px-2.5 py-1.5 text-[10px] font-mono font-semibold
                    border border-accent/30 text-accent bg-accent/5
                    hover:bg-accent/15 transition-colors"
                >
                  {sec}S
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-1">
            {isBuffering && (
              <Link
                to={`/editor/${stream.id}`}
                className="px-3 py-1.5 text-[10px] font-mono border border-border
                  text-text-secondary hover:bg-surface-2 transition-colors text-center"
              >
                EDIT CROP
              </Link>
            )}
            {isIdle && (
              <button
                onClick={onStart}
                className="px-3 py-1.5 text-[10px] font-mono border border-success/30
                  text-success hover:bg-success/10 transition-colors"
              >
                START
              </button>
            )}
            {isBuffering && (
              <button
                onClick={onStop}
                className="px-3 py-1.5 text-[10px] font-mono border border-warning/30
                  text-warning hover:bg-warning/10 transition-colors"
              >
                STOP
              </button>
            )}
            <button
              onClick={onDelete}
              className="px-3 py-1.5 text-[10px] font-mono border border-danger/30
                text-danger hover:bg-danger/10 transition-colors"
            >
              DEL
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: "bg-text-muted",
    resolving: "bg-warning animate-pulse",
    buffering: "bg-success animate-pulse",
    error: "bg-danger",
    stopped: "bg-text-muted",
  };

  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full",
        colors[status] ?? "bg-text-muted"
      )}
    />
  );
}
