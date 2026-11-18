const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const error = await res
        .json()
        .catch(() => ({ error: res.statusText }));
      throw new Error(
        (error as { error: string }).error ?? "Request failed"
      );
    }

    return res.json() as Promise<T>;
  }

  // ── Streams ────────────────────────────────────────
  createStream(url: string) {
    return this.request<{ stream: any }>("POST", "/streams", { url });
  }

  listStreams() {
    return this.request<{ streams: any[] }>("GET", "/streams");
  }

  deleteStream(id: string) {
    return this.request<{ ok: boolean }>("DELETE", `/streams/${id}`);
  }

  startStream(id: string) {
    return this.request<{ ok: boolean; stream: any }>(
      "POST",
      `/streams/${id}/start`
    );
  }

  stopStream(id: string) {
    return this.request<{ ok: boolean }>("POST", `/streams/${id}/stop`);
  }

  grabFrame(id: string) {
    return this.request<{ frame: string; width: number; height: number }>(
      "POST",
      `/streams/${id}/frame`
    );
  }

  updateCrop(id: string, config: any) {
    return this.request<{ ok: boolean; config: any }>(
      "PUT",
      `/streams/${id}/crop`,
      { config }
    );
  }

  createClip(id: string, seconds: number) {
    return this.request<{ clip: any; job: any }>(
      "POST",
      `/streams/${id}/clip`,
      { seconds }
    );
  }

  // ── Presets ────────────────────────────────────────
  listPresets(streamId: string) {
    return this.request<{ presets: any[] }>(
      "GET",
      `/streams/${streamId}/presets`
    );
  }

  savePreset(
    streamId: string,
    name: string,
    config: any,
    channelId?: string
  ) {
    return this.request<any>("POST", `/streams/${streamId}/presets`, {
      name,
      config,
      channelId,
    });
  }

  // ── Clips ──────────────────────────────────────────
  listClips() {
    return this.request<{ clips: any[] }>("GET", "/clips");
  }

  /**
   * Returns download + view URLs.
   * When stored on Google Drive, viewUrl opens the Drive player.
   */
  getClipUrl(id: string) {
    return this.request<{
      viewUrl?: string;
      downloadUrl?: string;
      url?: string;
      gdriveFileId?: string;
    }>("GET", `/clips/${id}/url`);
  }
}

export const api = new ApiClient();
