import { Response } from 'express';

interface ClientConnection {
  id: string;
  res: Response;
  channels: Set<string>;
  createdAt: Date;
}

class RealtimeService {
  private clients: Map<string, ClientConnection> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      this.sendKeepAlive();
    }, 25000); // 25s keepalive ping for reverse proxies / cloud load balancers
  }

  public registerClient(id: string, res: Response, channels: string[]) {
    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering (Nginx, Caddy, Cloudflare)
    res.flushHeaders?.();

    const connection: ClientConnection = {
      id,
      res,
      channels: new Set(channels),
      createdAt: new Date(),
    };

    this.clients.set(id, connection);

    // Send initial connected handshake event
    this.sendToClient(res, 'connected', {
      clientId: id,
      channels,
      timestamp: new Date().toISOString(),
    });

    res.on('close', () => {
      this.clients.delete(id);
    });
  }

  public subscribeClientToChannels(clientId: string, channels: string[]) {
    const client = this.clients.get(clientId);
    if (!client) return;
    channels.forEach((c) => client.channels.add(c));
  }

  public unsubscribeClientFromChannels(clientId: string, channels: string[]) {
    const client = this.clients.get(clientId);
    if (!client) return;
    channels.forEach((c) => client.channels.delete(c));
  }

  public broadcast(channel: string, eventName: string, data: any) {
    const payload = JSON.stringify({
      channel,
      event: eventName,
      data,
      timestamp: new Date().toISOString(),
    });

    for (const [, client] of this.clients) {
      if (client.channels.has(channel)) {
        try {
          client.res.write(`event: ${eventName}\ndata: ${payload}\n\n`);
        } catch {
          this.clients.delete(client.id);
        }
      }
    }
  }

  private sendToClient(res: Response, eventName: string, data: any) {
    try {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client write error
    }
  }

  private sendKeepAlive() {
    for (const [id, client] of this.clients) {
      try {
        client.res.write(': keepalive\n\n');
      } catch {
        this.clients.delete(id);
      }
    }
  }

  public getConnectedClientCount(): number {
    return this.clients.size;
  }
}

export const realtimeService = new RealtimeService();
