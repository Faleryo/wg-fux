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
        if (options.onOpen) options.onOpen();
      };

      ws.current.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch (e) {
          message = event.data; // Handle raw logs/strings
        }
        setData(message);
        if (options.onMessage) options.onMessage(message);
      };

      ws.current.onclose = () => {
        if (status !== 'CLOSED') setStatus('CLOSED');
        
        // Exponential backoff strategy
        const delay = Math.min(1000 * Math.pow(2, reconnectCount.current), maxReconnectDelay);
        reconnectCount.current += 1;
        
        timeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      };

      ws.current.onerror = (error) => {
        // ws.close() will trigger onclose logic
        ws.current.close();
      };
    } catch (e) {
      setStatus('CLOSED');
    }
  }, [url, options.onOpen, options.onMessage]);

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
