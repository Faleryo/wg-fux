import React from 'react';
import { LoginPage, useAuth } from './features/auth';
import MainLayout from './components/layout/MainLayout';
import GlobalErrorBoundary from './components/common/GlobalErrorBoundary';

const App = () => {
  const { session, login, logout } = useAuth();

  React.useEffect(() => {
    if (session.token) {
      console.log('[Auth] Session active, transitioning to Dashboard...', {
        role: session.role,
        user: session.username
      });
    } else {
      console.log('[Auth] No active session, showing Login Page.');
    }
  }, [session.token, session.role, session.username]);

  return (
    <GlobalErrorBoundary>
      {!session.token ? (
        <LoginPage onLogin={login} />
      ) : (
        <MainLayout session={session} onLogout={logout} />
      )}
    </GlobalErrorBoundary>
  );
};

export default App;
