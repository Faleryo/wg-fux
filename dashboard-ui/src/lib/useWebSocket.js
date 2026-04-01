import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 💠 VIBE-OS SRE Hook: useWebSocket
 * Provides resilient real-time connectivity with exponential backoff strategy.
 */
export const useWebSocket = (url, options = {}) => {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('CONNECTING');
  const ws = useRef(null);
  const reconnectCount = useRef(0);
  const maxReconnectDelay = 30000;
  const timeoutRef = useRef(null);
  // Store callbacks in refs to avoid re-creating connect() on every render
  const onMessageRef = useRef(options.onMessage);
  const onOpenRef = useRef(options.onOpen);
  useEffect(() => { onMessageRef.current = options.onMessage; }, [options.onMessage]);
  useEffect(() => { onOpenRef.current = options.onOpen; }, [options.onOpen]);

  const connect = useCallback(() => {
    if (!url) return;
    
    // Clean up any existing connection or timeout
    if (ws.current) ws.current.close();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    try {
      ws.current = new WebSocket(url);
      setStatus('CONNECTING');

      ws.current.onopen = () => {
        setStatus('OPEN');
        reconnectCount.current = 0;
        if (onOpenRef.current) onOpenRef.current();
      };

      ws.current.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (e) {
          message = event.data; // Handle raw logs/strings
        }
        setData(message);
        if (onMessageRef.current) onMessageRef.current(message);
      };

      ws.current.onclose = () => {
        setStatus('CLOSED');
        
        // Exponential backoff strategy
        const delay = Math.min(1000 * Math.pow(2, reconnectCount.current), maxReconnectDelay);
        reconnectCount.current += 1;
        
        timeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      ws.current.onerror = () => {
        // ws.close() will trigger onclose logic
        if (ws.current) ws.current.close();
      };
    } catch (e) {
      setStatus('CLOSED');
    }
  }, [url]); // Only url as dependency — callbacks are stable via refs

  useEffect(() => {
    connect();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (ws.current) {
        ws.current.onclose = null; // Prevent reconnect on manual unmount
        ws.current.close();
      }
    };
  }, [url]); // Only reconnect if URL changes

  const send = useCallback((message) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(typeof message === 'string' ? message : JSON.stringify(message));
    }
  }, []);

  return { data, status, send };
};
