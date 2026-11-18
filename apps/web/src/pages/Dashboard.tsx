import { useState, useEffect, useCallback } from "react";
import { Dashboard } from "../components/Dashboard.tsx";
import { ClipList } from "../components/ClipList.tsx";
import { useStreams } from "../hooks/useStreams.ts";
import { useClips } from "../hooks/useClips.ts";
import { cn } from "../lib/utils.ts";
import toast from "react-hot-toast";

export function DashboardPage() {
  const {
    streams,
    loading: streamsLoading,
    refresh: refreshStreams,
    deleteStream,
    stopStream,
    startStream,
  } = useStreams();
  const {
    clips,
    loading: clipsLoading,
    refresh: refreshClips,
    createClip,
    getDownloadUrl,
  } = useClips();
  const [activeTab, setActiveTab] = useState<"streams" | "clips">("streams");

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refreshStreams();
      refreshClips();
    }, 10_000);
    return () => clearInterval(interval);
  }, [refreshStreams, refreshClips]);

  const handleClip = useCallback(
    async (streamId: string, seconds: number) => {
      try {
        await createClip(streamId, seconds);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [createClip]
  );

  const handleDownload = useCallback(
    async (clipId: string) => {
      try {
        const url = await getDownloadUrl(clipId);
        window.open(url, "_blank");
      } catch (err) {
        toast.error("Download failed");
      }
    },
    [getDownloadUrl]
  );

  const handleDelete = useCallback(
    async (streamId: string) => {
      if (!confirm("Delete this stream?")) return;
      try {
        await deleteStream(streamId);
        toast.success("Stream deleted");
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [deleteStream]
  );

  const handleStop = useCallback(
    async (streamId: string) => {
      try {
        await stopStream(streamId);
        toast.success("Stream stopped");
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [stopStream]
  );

  const handleStart = useCallback(
    async (streamId: string) => {
      try {
        await startStream(streamId);
        toast.success("Stream started");
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [startStream]
  );

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      {/* Stats bar */}
      <div className="flex gap-6 border-b border-border pb-3">
        <Stat
          label="STREAMS"
          value={
            streams.filter((s: any) => s.status === "buffering").length
          }
          suffix={`/ ${streams.length}`}
        />
        <Stat label="CLIPS" value={clips.length} />
        <Stat
          label="DONE"
          value={clips.filter((c: any) => c.status === "done").length}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {(["streams", "clips"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-xs font-mono tracking-wider transition-colors",
              activeTab === tab
                ? "bg-surface-2 text-text-primary"
                : "text-text-secondary hover:bg-surface-1"
            )}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "streams" && (
        <Dashboard
          streams={streams}
          onClip={handleClip}
          onStop={handleStop}
          onDelete={handleDelete}
          onStart={handleStart}
        />
      )}
      {activeTab === "clips" && (
        <ClipList clips={clips} onDownload={handleDownload} />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-mono text-text-muted tracking-wider">
        {label}
      </span>
      <span className="text-lg font-mono font-bold text-text-primary">
        {value}
      </span>
      {suffix && (
        <span className="text-xs font-mono text-text-muted">{suffix}</span>
      )}
    </div>
  );
}
