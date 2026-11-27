import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../services/api';

export type RealtimeEventCallback = (payload: any) => void;

interface UseRealtimeOptions {
  url?: string;
  channels?: string[];
  enabled?: boolean;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

/**
 * Subscribes to the server's SSE stream.
 *
 * The connection depends only on the url, the channel *names* and `enabled`,
 * so callers may pass a fresh `channels` array or inline callbacks on every
 * render without causing a reconnect loop. Subscribers live in a ref and are
 * dispatched through one handler per event name on the current EventSource,
 * so a reconnect keeps every subscription and no event is delivered twice.
 */
// Set once the server says it has no live updates (serverless hosting); shared by every screen this session.
let liveUnavailable = false;

export function useRealtimeEvents({
  url = '/api/realtime/stream',
  channels = [],
  enabled = true,
  onConnected,
  onDisconnected,
}: UseRealtimeOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const listenersRef = useRef<Map<string, Set<RealtimeEventCallback>>>(new Map());
  const registeredRef = useRef<Set<string>>(new Set());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectAttemptRef = useRef(0);
  const failuresRef = useRef(0);

  const onConnectedRef = useRef(onConnected);
  const onDisconnectedRef = useRef(onDisconnected);
  onConnectedRef.current = onConnected;
  onDisconnectedRef.current = onDisconnected;

  const channelKey = [...new Set(channels.filter(Boolean))].sort().join(',');

  const handlePayload = useCallback((event: MessageEvent) => {
    try {
      const parsed = JSON.parse(event.data);
      setLastEventTime(new Date());
      // realtimeService wraps application data as { event, channel, data }.
      const payload = parsed?.data ?? parsed;
      const eventName = event.type && event.type !== 'message' ? event.type : parsed?.event || 'message';
      listenersRef.current.get(eventName)?.forEach((callback) => {
        try {
          callback(payload);
        } catch (err) {
          console.error(`Realtime handler for "${eventName}" failed:`, err);
        }
      });
    } catch {
      // Ignore malformed SSE payloads without breaking the stream.
    }
  }, []);

  const registerEvent = useCallback(
    (eventName: string) => {
      const es = eventSourceRef.current;
      if (!es || eventName === 'message' || registeredRef.current.has(eventName)) return;
      es.addEventListener(eventName, handlePayload as EventListener);
      registeredRef.current.add(eventName);
    },
    [handlePayload]
  );

  const subscribe = useCallback(
    (eventName: string, callback: RealtimeEventCallback) => {
      if (!listenersRef.current.has(eventName)) listenersRef.current.set(eventName, new Set());
      listenersRef.current.get(eventName)!.add(callback);
      registerEvent(eventName);

      return () => {
        const set = listenersRef.current.get(eventName);
        if (set) {
          set.delete(callback);
          if (set.size === 0) listenersRef.current.delete(eventName);
        }
      };
    },
    [registerEvent]
  );

  const closeCurrent = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    registeredRef.current = new Set();
  };

  const connect = useCallback(async () => {
    if (!enabled || typeof window === 'undefined') return;
    const attempt = ++connectAttemptRef.current;
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    closeCurrent();

    const scheduleRetry = () => {
      if (attempt !== connectAttemptRef.current) return;
      // Back off 5s, 10s, 20s ... up to 60s so a dead server isn't hammered.
      const delay = Math.min(60_000, 5_000 * 2 ** Math.min(failuresRef.current, 4));
      failuresRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(() => {
        if (attempt === connectAttemptRef.current) connect();
      }, delay);
    };

    const isPublicStream = url.includes('/public/');
    const queryParams = new URLSearchParams();
    if (channelKey) queryParams.set('channels', channelKey);

    // EventSource cannot set Authorization headers. Staff streams exchange the
    // login token (sent in a header) for a 60-second stream-only ticket, so the
    // long-lived token never appears in a URL or server log.
    if (liveUnavailable) return;
    if (!isPublicStream) {
      const token = localStorage.getItem('rms_token') || localStorage.getItem('token');
      if (!token) return;
      try {
        const res = await api.post('/realtime/ticket');
        const ticket = res.data?.data?.ticket;
        if (!ticket) throw new Error('No stream ticket');
        queryParams.set('ticket', ticket);
      } catch {
        if (attempt !== connectAttemptRef.current) return;
        setIsConnected(false);
        scheduleRetry();
        return;
      }
    }

    // A newer connect() started (or the component unmounted) while we waited.
    if (attempt !== connectAttemptRef.current) return;

    const fullUrl = `${url}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    try {
      const es = new EventSource(fullUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (attempt !== connectAttemptRef.current) return;
        failuresRef.current = 0;
        setIsConnected(true);
        onConnectedRef.current?.();
      };

      // The server has no live updates here (serverless hosting): stop for this session.
      es.addEventListener('unavailable', () => {
        liveUnavailable = true;
        closeCurrent();
        setIsConnected(false);
      });

      es.onerror = () => {
        if (attempt !== connectAttemptRef.current || liveUnavailable) return;
        setIsConnected(false);
        onDisconnectedRef.current?.();
        closeCurrent();
        scheduleRetry();
      };

      // Generic/default SSE messages.
      es.onmessage = handlePayload;

      // Named SSE events (orders, kitchen, reservations, notifications) are
      // not delivered to onmessage, so register every current event name.
      listenersRef.current.forEach((_callbacks, eventName) => registerEvent(eventName));
    } catch {
      setIsConnected(false);
      scheduleRetry();
    }
  }, [enabled, url, channelKey, handlePayload, registerEvent]);

  useEffect(() => {
    failuresRef.current = 0;
    connect();

    return () => {
      connectAttemptRef.current++;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      closeCurrent();
      setIsConnected(false);
    };
  }, [connect]);

  const reconnect = useCallback(() => {
    failuresRef.current = 0;
    return connect();
  }, [connect]);

  return {
    isConnected,
    lastEventTime,
    subscribe,
    reconnect,
  };
}
