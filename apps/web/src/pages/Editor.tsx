import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { CropEditor } from "../components/CropEditor.tsx";
import { api } from "../lib/api.ts";
import { CLIP_DURATIONS, type CropConfig, DEFAULT_CROP_CONFIG } from "@streamclipper/shared";
import toast from "react-hot-toast";
import { cn } from "../lib/utils.ts";

export function EditorPage() {
  const { streamId } = useParams<{ streamId: string }>();
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const [frame, setFrame] = useState<string | null>(null);
  const [frameWidth, setFrameWidth] = useState(1920);
  const [frameHeight, setFrameHeight] = useState(1080);
  const [cropConfig, setCropConfig] = useState<CropConfig>(DEFAULT_CROP_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState("");

  // Grab frame on load
  useEffect(() => {
    if (!streamId) return;
    (async () => {
      try {
        const token = await getToken();
        if (token) api.setToken(token);
        const data = await api.grabFrame(streamId);
        setFrame(data.frame);
        setFrameWidth(data.width);
        setFrameHeight(data.height);
      } catch (err) {
        toast.error("Failed to grab frame: " + (err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [streamId, getToken]);

  const handleSaveCrop = useCallback(async () => {
    if (!streamId) return;
    setSaving(true);
    try {
      const token = await getToken();
      if (token) api.setToken(token);
      await api.updateCrop(streamId, cropConfig);
      toast.success("Crop saved");
    } catch (err) {
      toast.error("Save failed: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [streamId, cropConfig, getToken]);

  const handleSavePreset = useCallback(async () => {
    if (!streamId || !presetName.trim()) return;
    try {
      const token = await getToken();
      if (token) api.setToken(token);
      await api.savePreset(streamId, presetName.trim(), cropConfig);
      toast.success("Preset saved");
      setPresetName("");
    } catch (err) {
      toast.error("Failed: " + (err as Error).message);
    }
  }, [streamId, presetName, cropConfig, getToken]);

  const handleClip = useCallback(
    async (seconds: number) => {
      if (!streamId) return;
      try {
        const token = await getToken();
        if (token) api.setToken(token);
        // Save crop first
        await api.updateCrop(streamId, cropConfig);
        await api.createClip(streamId, seconds);
        toast.success(`Clip queued: ${seconds}s`);
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [streamId, cropConfig, getToken]
  );

  // Global hotkey: Ctrl+Shift+C for 30s clip
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "C") {
        e.preventDefault();
        handleClip(30);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClip]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <span className="text-sm font-mono text-text-muted animate-pulse">
          LOADING FRAME...
        </span>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate("/dashboard")}
          className="text-xs font-mono text-text-secondary hover:text-text-primary transition-colors"
        >
          &lt; BACK
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveCrop}
            disabled={saving}
            className={cn(
              "px-4 py-2 text-xs font-mono font-semibold tracking-wider",
              "border border-success/30 text-success",
              "hover:bg-success/10 transition-colors",
              "disabled:opacity-40"
            )}
          >
            {saving ? "SAVING..." : "SAVE CROP"}
          </button>
        </div>
      </div>

      {/* Crop editor */}
      <CropEditor
        frameBase64={frame}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
        initialConfig={cropConfig}
        onConfigChange={setCropConfig}
      />

      {/* Quick clip buttons */}
      <div className="border border-border bg-surface-1 p-4">
        <span className="text-xs font-mono text-text-secondary tracking-wider block mb-3">
          QUICK CLIP
        </span>
        <div className="flex flex-wrap gap-2">
          {CLIP_DURATIONS.map((sec) => (
            <button
              key={sec}
              onClick={() => handleClip(sec)}
              className="px-5 py-2.5 font-mono text-sm font-bold
                border border-accent/30 text-accent bg-accent/5
                hover:bg-accent/15 transition-colors"
            >
              CLIP {sec}S
            </button>
          ))}
        </div>
        <p className="text-[10px] font-mono text-text-muted mt-2">
          Hotkey: Ctrl+Shift+C for 30s clip
        </p>
      </div>

      {/* Preset save */}
      <div className="border border-border bg-surface-1 p-4">
        <span className="text-xs font-mono text-text-secondary tracking-wider block mb-3">
          SAVE PRESET
        </span>
        <div className="flex gap-2">
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Preset name..."
            className="flex-1 bg-surface-0 border border-border px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleSavePreset}
            disabled={!presetName.trim()}
            className="px-4 py-2 text-xs font-mono border border-border text-text-secondary hover:bg-surface-2 transition-colors disabled:opacity-40"
          >
            SAVE
          </button>
        </div>
      </div>

      {/* Crop info panel */}
      <div className="border border-border bg-surface-1 p-4">
        <span className="text-xs font-mono text-text-secondary tracking-wider block mb-3">
          CURRENT CONFIG
        </span>
        <pre className="text-[10px] font-mono text-text-muted overflow-x-auto">
          {JSON.stringify(cropConfig, null, 2)}
        </pre>
      </div>
    </div>
  );
}
