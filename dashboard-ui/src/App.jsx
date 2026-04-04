import React from 'react';
import { LoginPage, useAuth } from './features/auth';
import MainLayout from './components/layout/MainLayout';

/**
 * App Shell — Routeur de haut niveau.
 * Responsabilité unique : routing entre Auth et Dashboard.
 * Toute la logique métier est dans les features dédiées.
 */
const App = () => {
  const { session, login, logout } = useAuth();

  if (!session.token) {
    return <LoginPage onLogin={login} />;
  }

  return <MainLayout session={session} onLogout={logout} />;
};

export default App;
