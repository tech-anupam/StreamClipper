import type { Env } from "../db/client.js";
import type {
  CropConfig,
  StreamFrameResponse,
  BufferHealth,
} from "@streamclipper/shared";

/**
 * Client for communicating with the worker service.
 */
export class WorkerClient {
  private baseUrl: string;
  private token: string;

  constructor(env: Env) {
    this.baseUrl = env.WORKER_API_URL;
    this.token = env.WORKER_TOKEN;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(
        `Worker request failed: ${(error as { error: string }).error}`
      );
    }

    return res.json() as Promise<T>;
  }

  async startStream(
    streamId: string,
    url: string
  ): Promise<{
    ok: boolean;
    stream: {
      title: string;
      channelName: string;
      channelId: string;
      sourceWidth: number;
      sourceHeight: number;
    };
  }> {
    return this.request("POST", `/streams/${streamId}/start`, { url });
  }

  async stopStream(streamId: string): Promise<{ ok: boolean }> {
    return this.request("POST", `/streams/${streamId}/stop`);
  }

  async getStreamHealth(streamId: string): Promise<BufferHealth> {
    return this.request("GET", `/streams/${streamId}/health`);
  }

  async grabFrame(streamId: string): Promise<StreamFrameResponse> {
    return this.request("POST", `/streams/${streamId}/frame`);
  }

  async createClip(
    streamId: string,
    clipId: string,
    seconds: number,
    cropConfig: CropConfig
  ): Promise<{ ok: boolean; clipId: string; jobId: string }> {
    return this.request("POST", `/streams/${streamId}/clip`, {
      seconds,
      cropConfig,
      clipId,
    });
  }
}
