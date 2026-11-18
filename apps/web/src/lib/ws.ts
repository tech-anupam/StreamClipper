import type { WorkerEvent } from "@streamclipper/shared";

type EventHandler = (event: WorkerEvent) => void;

class WorkerSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<EventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  connect(url: string) {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("[ws] connected");
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (e) => {
      try {
        const event: WorkerEvent = JSON.parse(e.data);
        for (const handler of this.handlers) {
          handler(event);
        }
      } catch {
        console.warn("[ws] invalid message:", e.data);
      }
    };

    this.ws.onclose = () => {
      console.log("[ws] disconnected, reconnecting...");
      this.scheduleReconnect(url);
    };

    this.ws.onerror = (err) => {
      console.error("[ws] error:", err);
    };
  }

  private scheduleReconnect(url: string) {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay
      );
      this.connect(url);
    }, this.reconnectDelay);
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const workerSocket = new WorkerSocket();
