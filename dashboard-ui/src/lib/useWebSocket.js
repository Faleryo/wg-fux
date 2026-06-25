import { useState, useEffect, useRef } from 'react';

/**
 * SRE Hook: useWebSocket
 * Provides resilient real-time connectivity with exponential backoff strategy.
 */
export const useWebSocket = (url, options = {}) => {
  const authTokenRef = useRef(options.token || null);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('CONNECTING');
  const ws = useRef(null);
  const reconnectCount = useRef(0);
  const maxReconnectDelay = 30000;
  const timeoutRef = useRef(null);
  const onMessageRef = useRef(options.onMessage);
  const onOpenRef = useRef(options.onOpen);
  useEffect(() => {
    onMessageRef.current = options.onMessage;
  }, [options.onMessage]);
  useEffect(() => {
    onOpenRef.current = options.onOpen;
  }, [options.onOpen]);
  useEffect(() => {
    authTokenRef.current = options.token || null;
  }, [options.token]);

  useEffect(() => {
    let active = true;

    const connect = () => {
      if (!url || !active) return;

      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      // Nullify old onclose to prevent it from closing the new connection
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.onerror = null;
        ws.current.close();
      }

      try {
        const token = authTokenRef.current;
        const protocols = token ? [token] : undefined;
        ws.current = new WebSocket(url, protocols);
        setStatus('CONNECTING');

        ws.current.onopen = () => {
          if (!active) return;
          setStatus('OPEN');
          reconnectCount.current = 0;
          if (onOpenRef.current) onOpenRef.current();
        };

        ws.current.onmessage = (event) => {
          if (!active) return;
          let message;
          try {
            message = JSON.parse(event.data);
          } catch (e) {
            message = event.data;
          }
          setData(message);
          if (onMessageRef.current) onMessageRef.current(message);
        };

        ws.current.onclose = () => {
          if (!active) return;
          setStatus('CLOSED');

          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
          }

          const delay = Math.min(1000 * Math.pow(2, reconnectCount.current), maxReconnectDelay);
          reconnectCount.current += 1;

          timeoutRef.current = setTimeout(() => {
            if (active) connect();
          }, delay);
        };

        ws.current.onerror = () => {
          if (ws.current) ws.current.close();
        };
      } catch (e) {
        if (active) setStatus('CLOSED');
      }
    };

    connect();

    return () => {
      active = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.onerror = null;
        ws.current.close();
      }
    };
  }, [url]);

  const send = (message) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(typeof message === 'string' ? message : JSON.stringify(message));
    }
  };

  return { data, status, send };
};
