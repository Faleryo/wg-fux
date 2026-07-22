import React from 'react';
import { translate as t } from '../../context/LanguageContext';

class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('UI CRASH DETECTED:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-[#0a0a0c] text-white p-6 font-sans">
          <div className="max-w-md w-full bg-[#16161a] border border-red-500/30 rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-center w-16 h-16 bg-red-500/10 rounded-full mb-6 mx-auto">
              <svg
                className="w-8 h-8 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-center mb-2">{t('geb_title')}</h1>
            <p className="text-gray-400 text-center mb-6">{t('geb_desc')}</p>
            <div className="bg-black/40 rounded-lg p-4 mb-6 font-mono text-xs text-red-400 overflow-auto max-h-32 border border-white/5">
              {this.state.error?.toString() || t('geb_unknown')}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 px-4 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white font-semibold rounded-xl transition-all shadow-lg shadow-red-900/20 active:scale-95"
            >
              {t('geb_reset')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
