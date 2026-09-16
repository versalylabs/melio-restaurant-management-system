import { useEffect, useRef, useState, useCallback } from 'react';

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

  const connect = useCallback(() => {
    if (!enabled || typeof window === 'undefined') return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const token = localStorage.getItem('rms_token') || localStorage.getItem('token');
    const queryParams = new URLSearchParams();
    if (channels.length > 0) queryParams.set('channels', channels.join(','));
    // EventSource cannot set Authorization headers, so the staff realtime
    // endpoint accepts the token as a short-lived query credential. Public
    // tracking streams intentionally do not send a staff token.
    if (token && !url.includes('/public/')) queryParams.set('token', token);

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
