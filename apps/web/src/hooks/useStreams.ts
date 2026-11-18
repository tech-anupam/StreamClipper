import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/clerk-react";
import { api } from "../lib/api.ts";
import toast from "react-hot-toast";

export function useStreams() {
  const { getToken } = useAuth();
  const [streams, setStreams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const token = await getToken();
      if (token) api.setToken(token);
      const data = await api.listStreams();
      setStreams(data.streams);
    } catch (err) {
      toast.error("Failed to load streams");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createStream = useCallback(
    async (url: string) => {
      const token = await getToken();
      if (token) api.setToken(token);
      const data = await api.createStream(url);
      await refresh();
      return data.stream;
    },
    [getToken, refresh]
  );

  const deleteStream = useCallback(
    async (id: string) => {
      const token = await getToken();
      if (token) api.setToken(token);
      await api.deleteStream(id);
      await refresh();
    },
    [getToken, refresh]
  );

  const startStream = useCallback(
    async (id: string) => {
      const token = await getToken();
      if (token) api.setToken(token);
      const data = await api.startStream(id);
      await refresh();
      return data;
    },
    [getToken, refresh]
  );

  const stopStream = useCallback(
    async (id: string) => {
      const token = await getToken();
      if (token) api.setToken(token);
      await api.stopStream(id);
      await refresh();
    },
    [getToken, refresh]
  );

  return {
    streams,
    loading,
    refresh,
    createStream,
    deleteStream,
    startStream,
    stopStream,
  };
}
