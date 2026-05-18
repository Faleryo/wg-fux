import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import App from '../App';
import * as auth from '../features/auth';

// Mock specific parts of the auth feature
vi.mock('../features/auth', async () => {
  const actual = await vi.importActual('../features/auth');
  return {
    ...actual,
    useAuth: vi.fn(),
    LoginPage: ({ onLogin }) => <div data-testid="login-page">Login Page</div>,
  };
});

// Mock MainLayout
vi.mock('../components/layout/MainLayout', () => ({
  default: ({ session, onLogout }) => <div data-testid="main-layout">Main Layout</div>,
}));

describe('App Root', () => {
  it('should render LoginPage when not authenticated', () => {
    vi.mocked(auth.useAuth).mockReturnValue({
      session: { token: null },
      login: vi.fn(),
      logout: vi.fn(),
    });

    render(<App />);
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });

  it('should render MainLayout when authenticated', () => {
    vi.mocked(auth.useAuth).mockReturnValue({
      session: { token: 'mock-token', username: 'admin' },
      login: vi.fn(),
      logout: vi.fn(),
    });

    render(<App />);
    expect(screen.getByTestId('main-layout')).toBeInTheDocument();
  });
});
