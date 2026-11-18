import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { StreamInput } from "../components/StreamInput.tsx";
import { useStreams } from "../hooks/useStreams.ts";
import toast from "react-hot-toast";

export function HomePage() {
  const navigate = useNavigate();
  const { createStream, startStream } = useStreams();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (url: string) => {
    setLoading(true);
    try {
      const stream = await createStream(url);
      toast.success("Stream added");

      // Auto-start buffering
      try {
        await startStream(stream.id);
        toast.success("Buffering started");
      } catch (err) {
        toast.error("Failed to start buffer: " + (err as Error).message);
      }

      navigate(`/editor/${stream.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-7rem)] p-4">
      <div className="w-full max-w-2xl space-y-8">
        {/* Title */}
        <div className="text-center">
          <h1 className="text-lg font-mono font-bold tracking-wider text-text-primary">
            STREAMCLIPPER
          </h1>
          <p className="text-xs font-mono text-text-muted mt-2 tracking-wide">
            Paste a YouTube live URL to start clipping
          </p>
        </div>

        <StreamInput onSubmit={handleSubmit} loading={loading} />

        {/* Info box */}
        <div className="border border-border p-4 text-xs font-mono space-y-2 text-text-secondary">
          <p>1. Paste a live stream URL</p>
          <p>2. Define content + webcam crop regions</p>
          <p>3. Stream buffers continuously in the background</p>
          <p>4. One-click to clip the last 10/20/30/60 seconds</p>
          <p className="text-text-muted mt-3">
            Output: 1080x1920 (9:16) vertical video. Content on top, webcam below.
          </p>
        </div>
      </div>
    </div>
  );
}
