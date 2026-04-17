import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { axiosInstance, API_URL } from '../lib/api';

const server = setupServer(
  http.get(`${API_URL}/health`, () => {
    return HttpResponse.json({ status: 'ok' });
  }),
  http.post(`${API_URL}/auth/login`, () => {
    return HttpResponse.json({ token: 'mock-token' });
  }),
  http.get(`${API_URL}/error-500`, () => {
    return new HttpResponse(null, { status: 500 });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  localStorage.clear();
  sessionStorage.clear();
});
afterAll(() => server.close());

describe('Frontend API Logic (Axios Interceptors)', () => {
  it('should include X-Api-Token header if present in localStorage', async () => {
    localStorage.setItem('wg-api-token', 'my-secret-token');

    let capturedRequest;
    server.use(
      http.get(`${API_URL}/test-headers`, ({ request }) => {
        capturedRequest = request;
        return HttpResponse.json({ success: true });
      })
    );

    await axiosInstance.get('/test-headers');
    expect(capturedRequest.headers.get('x-api-token')).toBe('my-secret-token');
  });

  it('should trigger logout and redirect on 401 response', async () => {
    // Mock window.location
    const originalLocation = window.location;
    delete window.location;
    window.location = { href: '' };

    server.use(
      http.get(`${API_URL}/protected`, () => {
        return new HttpResponse(null, { status: 401 });
      })
    );

    try {
      await axiosInstance.get('/protected');
    } catch (e) {
      // Expected error
    }

    expect(window.location.href).toBe('/login');
    window.location = originalLocation;
  });

  it('should capture response time in metadata', async () => {
    const res = await axiosInstance.get('/health');
    expect(res.config.metadata).toHaveProperty('startTime');
  });
});
