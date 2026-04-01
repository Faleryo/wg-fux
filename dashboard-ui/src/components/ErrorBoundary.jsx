import React, { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * 💠 VIBE-OS React Error Boundary
 * Empêche toute l'app de crasher si un composant lève une erreur.
 * Affiche un fallback premium Liquid Glass style.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[ERROR-BOUNDARY] Component crashed:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      const { fallback: FallbackComponent, sectionName } = this.props;

      if (FallbackComponent) {
        return <FallbackComponent error={this.state.error} onReset={this.handleReset} />;
      }

      return (
        <div className="flex flex-col items-center justify-center p-10 rounded-3xl bg-slate-900/50 border border-red-500/20 backdrop-blur-xl text-center min-h-[200px]">
          <div className="p-4 rounded-2xl bg-red-500/10 text-red-400 mb-6">
            <AlertTriangle size={32} />
          </div>
          <h3 className="text-lg font-black text-white uppercase tracking-tight mb-2">
            {sectionName || 'Composant'} — Erreur Critique
          </h3>
          <p className="text-xs text-slate-500 font-mono mb-1 max-w-sm">
            {this.state.error?.message || 'Une erreur inattendue est survenue.'}
          </p>
          {this.state.errorInfo?.componentStack && (
            <details className="mt-4 text-left w-full max-w-md">
              <summary className="text-[10px] text-slate-600 uppercase tracking-widest cursor-pointer mb-2">
                Stack Trace
              </summary>
              <pre className="text-[9px] text-slate-700 overflow-auto bg-slate-950 rounded-xl p-4 max-h-48">
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          <button
            onClick={this.handleReset}
            className="mt-6 flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all border border-white/10"
          >
            <RefreshCw size={14} />
            Réinitialiser
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
