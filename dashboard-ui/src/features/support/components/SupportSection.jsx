import React, { useState, useEffect } from 'react';
import {
  LifeBuoy,
  Send,
  MessageSquare,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { axiosInstance } from '../../../lib/api';
import { useTheme } from '../../../context/ThemeContext';
import { useToast } from '../../../context/ToastContext';
import { cn } from '../../../lib/utils';

const SupportSection = () => {
  const { isDark, theme } = useTheme();
  const { addToast } = useToast();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [newTicket, setNewTicket] = useState({ title: '', message: '' });
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [reply, setReply] = useState('');

  const fetchTickets = async () => {
    try {
      const { data } = await axiosInstance.get('/tickets');
      setTickets(data);
    } catch (e) {
      addToast('Erreur lors du chargement des tickets', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const handleCreateTicket = async (e) => {
    e.preventDefault();
    if (!newTicket.title || !newTicket.message) return;
    try {
      await axiosInstance.post('/tickets', newTicket);
      addToast('Ticket ouvert avec succès', 'success');
      setShowNewTicket(false);
      setNewTicket({ title: '', message: '' });
      fetchTickets();
    } catch (e) {
      addToast('Erreur lors de la création du ticket', 'error');
    }
  };

  const handleReply = async (e) => {
    e.preventDefault();
    if (!reply) return;
    try {
      await axiosInstance.post(`/tickets/${selectedTicket.id}/reply`, { message: reply });
      addToast('Réponse envoyée', 'success');
      setReply('');
      fetchTickets();
      // Refresh selected ticket
      const { data } = await axiosInstance.get('/tickets');
      setSelectedTicket(data.find((t) => t.id === selectedTicket.id));
    } catch (e) {
      addToast("Erreur lors de l'envoi de la réponse", 'error');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2
            className={cn(
              'text-3xl font-black italic uppercase tracking-tighter flex items-center gap-4',
              isDark ? 'text-white' : 'text-slate-900'
            )}
          >
            <LifeBuoy size={32} className={`text-${theme}-500`} /> Support Cluster
          </h2>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1 opacity-60">
            Assistance technique & Ouverture de tickets
          </p>
        </div>
        <button
          onClick={() => setShowNewTicket(true)}
          className={cn(
            'px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 shadow-xl',
            `bg-${theme}-600 text-white shadow-${theme}-600/20 hover:scale-105`
          )}
        >
          <Plus size={16} /> Ouvrir un ticket
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Tickets List */}
        <div className="lg:col-span-1 space-y-4">
          <div
            className={cn(
              'p-6 rounded-[2.5rem] glass-panel border flex flex-col h-[600px]',
              isDark ? 'border-white/5' : 'border-slate-100'
            )}
          >
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-6 flex items-center gap-2">
              <Clock size={14} /> Vos Interventions
            </h3>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
              {loading ? (
                <div className="flex items-center justify-center h-full opacity-20">
                  Chargement...
                </div>
              ) : tickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full opacity-20 text-center">
                  <Ghost size={48} className="mb-4" />
                  <p className="text-[10px] font-black uppercase">Aucun ticket ouvert</p>
                </div>
              ) : (
                tickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    onClick={() => setSelectedTicket(ticket)}
                    className={cn(
                      'w-full p-4 rounded-2xl border text-left transition-all group',
                      selectedTicket?.id === ticket.id
                        ? `bg-${theme}-600/10 border-${theme}-500/30`
                        : isDark
                          ? 'bg-white/5 border-white/5 hover:bg-white/10'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={cn(
                          'text-[9px] font-black uppercase px-2 py-0.5 rounded-full border',
                          ticket.status === 'open'
                            ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20'
                            : 'text-slate-500 bg-slate-500/10 border-slate-500/20'
                        )}
                      >
                        {ticket.status}
                      </span>
                      <span className="text-[8px] font-mono opacity-40">
                        {new Date(ticket.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p
                      className={cn(
                        'text-xs font-bold truncate mb-1',
                        isDark ? 'text-white' : 'text-slate-900'
                      )}
                    >
                      {ticket.title}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate italic">
                      {ticket.messages[0]?.text}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Ticket Content */}
        <div className="lg:col-span-2">
          {selectedTicket ? (
            <div
              className={cn(
                'p-8 rounded-[3rem] glass-panel border flex flex-col h-[600px]',
                isDark ? 'border-white/5' : 'border-slate-100'
              )}
            >
              <div className="flex items-center justify-between mb-8 border-b border-white/5 pb-6">
                <div>
                  <h3
                    className={cn(
                      'text-xl font-black italic',
                      isDark ? 'text-white' : 'text-slate-900'
                    )}
                  >
                    {selectedTicket.title}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                    ID: {selectedTicket.id}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedTicket(null)}
                  className="p-2 rounded-xl hover:bg-white/5 text-slate-500 transition-all"
                >
                  Fermer
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-6 pr-4 custom-scrollbar mb-6">
                {selectedTicket.messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      'flex flex-col max-w-[80%]',
                      msg.sender === 'admin' ? 'self-start' : 'self-end items-end ml-auto'
                    )}
                  >
                    <div
                      className={cn(
                        'p-4 rounded-2xl text-[11px] font-medium leading-relaxed',
                        msg.sender === 'admin'
                          ? isDark
                            ? 'bg-indigo-500/20 text-indigo-100 rounded-tl-none border border-indigo-500/10'
                            : 'bg-indigo-50 text-indigo-900 rounded-tl-none border border-indigo-100'
                          : isDark
                            ? 'bg-white/5 text-slate-300 rounded-tr-none border border-white/5'
                            : 'bg-slate-100 text-slate-800 rounded-tr-none border border-slate-200'
                      )}
                    >
                      {msg.text}
                    </div>
                    <span className="text-[8px] font-mono mt-1.5 opacity-30 px-1">
                      {msg.sender === 'admin' ? 'Agent Support' : 'Vous'} •{' '}
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>

              <form onSubmit={handleReply} className="relative">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Écrivez votre réponse..."
                  className={cn(
                    'w-full bg-transparent border rounded-2xl p-4 pr-14 text-xs font-medium focus:ring-1 focus:ring-indigo-500 transition-all outline-none resize-none h-20',
                    isDark
                      ? 'border-white/10 text-white placeholder:text-slate-600'
                      : 'border-slate-200 text-slate-900 placeholder:text-slate-400'
                  )}
                />
                <button
                  type="submit"
                  className={cn(
                    'absolute right-3 bottom-3 p-3 rounded-xl transition-all active:scale-90',
                    `bg-${theme}-600 text-white shadow-lg shadow-${theme}-600/20`
                  )}
                >
                  <Send size={16} />
                </button>
              </form>
            </div>
          ) : (
            <div
              className={cn(
                'flex flex-col items-center justify-center h-[600px] rounded-[3rem] border border-dashed opacity-30',
                isDark ? 'border-white/10' : 'border-slate-300'
              )}
            >
              <MessageSquare size={64} className="mb-6" />
              <p className="text-[10px] font-black uppercase tracking-widest">
                Sélectionnez un ticket pour voir la conversation
              </p>
            </div>
          )}
        </div>
      </div>

      {/* New Ticket Modal (Simple implementation) */}
      <AnimatePresence>
        {showNewTicket && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn(
                'w-full max-w-lg p-8 rounded-[3rem] glass-panel border shadow-2xl',
                isDark ? 'bg-slate-900 border-white/10' : 'bg-white border-slate-100'
              )}
            >
              <h3
                className={cn(
                  'text-2xl font-black italic mb-6',
                  isDark ? 'text-white' : 'text-slate-900'
                )}
              >
                Nouvelle Demande
              </h3>
              <form onSubmit={handleCreateTicket} className="space-y-6">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">
                    Sujet
                  </label>
                  <input
                    type="text"
                    value={newTicket.title}
                    onChange={(e) => setNewTicket((p) => ({ ...p, title: e.target.value }))}
                    placeholder="Ex: Problème de connexion wg0"
                    className={cn(
                      'w-full bg-transparent border rounded-2xl p-4 text-xs font-bold outline-none focus:ring-1 focus:ring-indigo-500 transition-all',
                      isDark ? 'border-white/10 text-white' : 'border-slate-200 text-slate-900'
                    )}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">
                    Message détaillé
                  </label>
                  <textarea
                    value={newTicket.message}
                    onChange={(e) => setNewTicket((p) => ({ ...p, message: e.target.value }))}
                    placeholder="Décrivez votre problème précisément..."
                    className={cn(
                      'w-full bg-transparent border rounded-2xl p-4 text-xs font-medium h-32 outline-none focus:ring-1 focus:ring-indigo-500 transition-all resize-none',
                      isDark ? 'border-white/10 text-white' : 'border-slate-200 text-slate-900'
                    )}
                  />
                </div>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setShowNewTicket(false)}
                    className={cn(
                      'flex-1 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all hover:bg-white/5',
                      isDark ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'
                    )}
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className={cn(
                      'flex-2 px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white shadow-xl transition-all active:scale-95',
                      `bg-${theme}-600 shadow-${theme}-600/20`
                    )}
                  >
                    Envoyer le ticket
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SupportSection;
