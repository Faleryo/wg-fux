import React from 'react';
import { LoginPage, useAuth } from './features/auth';
import MainLayout from './components/layout/MainLayout';
import GlobalErrorBoundary from './components/common/GlobalErrorBoundary';

const App = () => {
  const { session, login, logout } = useAuth();

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
