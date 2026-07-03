import React, { useState } from 'react';
import { LoginPage, RegisterPage, useAuth } from './features/auth';
import MainLayout from './components/layout/MainLayout';
import GlobalErrorBoundary from './components/common/GlobalErrorBoundary';

// Token d'invitation dans l'URL (?invite=…) → page d'inscription revendeur.
const inviteFromUrl = () => {
  try {
    return new URLSearchParams(window.location.search).get('invite');
  } catch {
    return null;
  }
};

const App = () => {
  const { session, login, logout } = useAuth();
  const [invite, setInvite] = useState(inviteFromUrl);

  const clearInvite = () => {
    setInvite(null);
    try {
      window.history.replaceState({}, '', window.location.pathname);
    } catch {
      /* ignore */
    }
  };

  return (
    <GlobalErrorBoundary>
      {!session.token && invite ? (
        <RegisterPage inviteToken={invite} onDone={clearInvite} />
      ) : !session.token ? (
        <LoginPage onLogin={login} />
      ) : (
        <MainLayout session={session} onLogout={logout} />
      )}
    </GlobalErrorBoundary>
  );
};

export default App;
