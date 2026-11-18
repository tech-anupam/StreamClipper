import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { api } from "../lib/api.ts";
import toast from "react-hot-toast";

export function useClips() {
  const { getToken } = useAuth();
  const [clips, setClips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const token = await getToken();
      if (token) api.setToken(token);
      const data = await api.listClips();
      setClips(data.clips);
    } catch (err) {
      toast.error("Failed to load clips");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createClip = useCallback(
    async (streamId: string, seconds: number) => {
      const token = await getToken();
      if (token) api.setToken(token);
      const data = await api.createClip(streamId, seconds);
      toast.success(`Clip queued (${seconds}s)`);
      await refresh();
      return data;
    },
    [getToken, refresh]
  );

  const getDownloadUrl = useCallback(
    async (clipId: string): Promise<string> => {
      const token = await getToken();
      if (token) api.setToken(token);
      const data = await api.getClipUrl(clipId);
      // Prefer Google Drive download link, fall back to local URL
      return data.downloadUrl ?? data.url ?? "";
    },
    [getToken]
  );

  return { clips, loading, refresh, createClip, getDownloadUrl };
}
