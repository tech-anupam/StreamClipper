import {
  cn,
  formatDuration,
  formatBytes,
  formatTimeAgo,
  copyToClipboard,
} from "../lib/utils.ts";
import toast from "react-hot-toast";

interface Clip {
  id: string;
  streamId: string;
  durationSec: number;
  sizeBytes: number | null;
  status: string;
  createdAt: string;
  gdriveFileId: string | null;
  gdriveWebLink: string | null;
  localPath: string | null;
}

interface ClipListProps {
  clips: Clip[];
  onDownload: (clipId: string) => void;
}

export function ClipList({ clips, onDownload }: ClipListProps) {
  if (clips.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm font-mono text-text-muted">NO CLIPS YET</p>
      </div>
    );
  }

  return (
    <div className="border border-border divide-y divide-border">
      {/* Header */}
      <div className="grid grid-cols-[1fr_80px_80px_100px_140px] gap-2 px-3 py-2 text-[10px] font-mono text-text-muted tracking-wider">
        <span>ID</span>
        <span>DURATION</span>
        <span>SIZE</span>
        <span>STATUS</span>
        <span>ACTIONS</span>
      </div>

      {/* Rows */}
      {clips.map((clip) => (
        <div
          key={clip.id}
          className="grid grid-cols-[1fr_80px_80px_100px_140px] gap-2 px-3 py-2.5 text-xs font-mono hover:bg-surface-1 transition-colors items-center"
        >
          <span className="text-text-secondary truncate" title={clip.id}>
            {clip.id.slice(0, 12)}...
          </span>
          <span className="text-text-primary">
            {formatDuration(clip.durationSec)}
          </span>
          <span className="text-text-secondary">
            {clip.sizeBytes ? formatBytes(clip.sizeBytes) : "--"}
          </span>
          <span>
            <StatusBadge status={clip.status} />
          </span>
          <div className="flex gap-1">
            {clip.status === "done" && (
              <>
                {/* Open in Google Drive */}
                {clip.gdriveWebLink && (
                  <a
                    href={clip.gdriveWebLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 text-[10px] border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
                    title="View in Google Drive"
                  >
                    VIEW
                  </a>
                )}
                <button
                  onClick={() => onDownload(clip.id)}
                  className="px-2 py-1 text-[10px] border border-success/30 text-success hover:bg-success/10 transition-colors"
                >
                  DL
                </button>
                <button
                  onClick={() => {
                    const link =
                      clip.gdriveWebLink ??
                      `${window.location.origin}/api/clips/${clip.id}/url`;
                    copyToClipboard(link);
                    toast.success("Link copied");
                  }}
                  className="px-2 py-1 text-[10px] border border-border text-text-secondary hover:bg-surface-2 transition-colors"
                >
                  COPY
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: "text-text-muted border-border",
    processing: "text-accent border-accent/30",
    uploading: "text-warning border-warning/30",
    done: "text-success border-success/30",
    failed: "text-danger border-danger/30",
  };

  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 text-[10px] border",
        colors[status] ?? "text-text-muted border-border"
      )}
    >
      {status.toUpperCase()}
    </span>
  );
}
