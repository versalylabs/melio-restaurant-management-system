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
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Subscribe callback for a specific event name
  const subscribe = useCallback((eventName: string, callback: RealtimeEventCallback) => {
    if (!listenersRef.current.has(eventName)) {
      listenersRef.current.set(eventName, new Set());
    }
    listenersRef.current.get(eventName)!.add(callback);

    const es = eventSourceRef.current;
    const dynamicHandler = (event: Event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data);
        setLastEventTime(new Date());
        callback(parsed?.data ?? parsed);
      } catch {}
    };
    if (es) es.addEventListener(eventName, dynamicHandler as EventListener);

    return () => {
      if (es) es.removeEventListener(eventName, dynamicHandler as EventListener);
      const set = listenersRef.current.get(eventName);
      if (set) {
        set.delete(callback);
        if (set.size === 0) listenersRef.current.delete(eventName);
      }
    };
  }, []);

  const connectAttemptRef = useRef(0);

  const connect = useCallback(async () => {
    if (!enabled || typeof window === 'undefined') return;
    const attempt = ++connectAttemptRef.current;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const isPublicStream = url.includes('/public/');
    const queryParams = new URLSearchParams();
    if (channels.length > 0) queryParams.set('channels', channels.join(','));

    // EventSource cannot set Authorization headers. Staff streams exchange the
    // login token (sent in a header) for a 60-second stream-only ticket, so the
    // long-lived token never appears in a URL or server log.
    if (!isPublicStream) {
      const token = localStorage.getItem('rms_token') || localStorage.getItem('token');
      if (!token) return;
      try {
        const res = await api.post('/realtime/ticket');
        const ticket = res.data?.data?.ticket;
        if (!ticket) throw new Error('No stream ticket');
        queryParams.set('ticket', ticket);
      } catch {
        setIsConnected(false);
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (enabled) connect();
        }, 10000);
        return;
      }
    }

    // A newer connect() started (or the component unmounted) while we waited.
    if (attempt !== connectAttemptRef.current) return;

    const fullUrl = `${url}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    try {
      const es = new EventSource(fullUrl);
      eventSourceRef.current = es;

      const handlePayload = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data);
          setLastEventTime(new Date());
          // realtimeService wraps application data as { event, channel, data }.
          // Subscribers should receive the useful data object directly.
          const payload = parsed?.data ?? parsed;
          const eventName = parsed?.event || event.type || 'message';
          const callbacks = listenersRef.current.get(eventName);
          callbacks?.forEach((callback) => callback(payload));
        } catch {
          // Ignore malformed SSE payloads without breaking the stream.
        }
      };

      es.onopen = () => {
        setIsConnected(true);
        onConnected?.();
      };

      es.onerror = () => {
        setIsConnected(false);
        onDisconnected?.();
        es.close();

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          if (enabled) connect();
        }, 5000);
      };

      // Generic/default SSE messages.
      es.onmessage = handlePayload;

      // Named SSE events are what the server emits for order, kitchen,
      // reservation and notification updates. EventSource.onmessage does not
      // receive named events, so explicitly register every current subscriber.
      listenersRef.current.forEach((_callbacks, eventName) => {
        es.addEventListener(eventName, handlePayload as EventListener);
      });
    } catch {
      setIsConnected(false);
    }
  }, [enabled, url, channels, onConnected, onDisconnected]);

  useEffect(() => {
    connect();

    return () => {
      connectAttemptRef.current++;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsConnected(false);
    };
  }, [connect]);

  return {
    isConnected,
    lastEventTime,
    subscribe,
    reconnect: connect,
  };
}
