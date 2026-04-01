import React, { useState, useEffect } from 'react';
import { Users, Plus, Shield, Search, Trash2, Edit, CheckCircle2, ChevronRight, UserCheck } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';
import { axiosInstance } from '../../lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import GlassCard from '../ui/Card';
import VibeButton from '../ui/Button';

const UsersSection = ({ onCreateUser }) => {
  const { theme } = useTheme();
  const [users, setUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await axiosInstance.get('/users');
      setUsers(res.data);
    } catch (error) {
      console.error('Erreur lors de la récupération des utilisateurs:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter(user => 
    user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDelete = async (username) => {
    if (!window.confirm(`Supprimer l'opérateur "${username}" ?`)) return;
    try {
      await axiosInstance.delete(`/users/${username}`);
      fetchUsers();
    } catch (err) {
      console.error('Erreur suppression:', err);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-5 duration-700">
      {/* Header Liquid Glass */}
      <GlassCard className="flex flex-col lg:flex-row justify-between items-center gap-8">
        <div className="flex items-center gap-6">
          <div className={cn("w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl", `bg-${theme}-600/20 text-${theme}-400 border border-${theme}-500/20`)}>
            <Users size={32} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-white tracking-tighter italic uppercase">Gestion des Opérateurs</h2>
            <p className="text-slate-500 text-[10px] font-black tracking-[0.3em] uppercase opacity-60">System Access Control</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 w-full lg:w-auto items-center">
          <div className="relative group w-full md:w-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-white transition-colors" size={20} />
            <input 
              type="text" 
              placeholder="Rechercher un opérateur..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-12 pr-6 py-4 bg-white/5 border border-white/5 rounded-2xl focus:outline-none focus:border-white/20 focus:bg-white/10 text-sm text-white w-full md:w-80 transition-all font-mono"
            />
          </div>
          <VibeButton variant="primary" icon={Plus} className="w-full md:w-auto" onClick={onCreateUser}>
            Créer un Accès
          </VibeButton>
        </div>
      </GlassCard>

      {/* Users Table Liquid Glass */}
      <GlassCard className="p-0 overflow-hidden" hover={false}>
         <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
               <thead>
                  <tr className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-white/5">
                     <th className="px-10 py-8">Identité Opérateur</th>
                     <th className="px-8 py-8">Rôle Système</th>
                     <th className="px-8 py-8">Statut</th>
                     <th className="px-10 py-8 text-right">Intervention</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-white/5">
                  <AnimatePresence mode="popLayout">
                    {filteredUsers.map((user, idx) => (
                      <motion.tr 
                        key={user.id || idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ delay: idx * 0.05 }}
                        className="group hover:bg-white/5 transition-colors cursor-pointer"
                      >
                         <td className="px-10 py-6">
                            <div className="flex items-center gap-5">
                               <div className={cn(
                                 "w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center font-black text-white text-lg transition-all group-hover:scale-110 group-hover:bg-slate-700 shadow-xl",
                                 user.role === 'admin' ? `border border-${theme}-500/30` : "border border-white/5"
                               )}>
                                  {user.username.charAt(0).toUpperCase()}
                               </div>
                               <div>
                                  <div className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
                                    {user.username}
                                    {user.role === 'admin' && <Shield size={14} className={cn(`text-${theme}-400`)} />}
                                  </div>
                                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{user.role === 'admin' ? 'Root Access' : 'Operator Access'}</div>
                               </div>
                            </div>
                         </td>
                         <td className="px-8 py-6">
                             <span className={cn(
                               "text-[10px] font-black px-4 py-1.5 rounded-xl border uppercase tracking-widest inline-block",
                               user.role === 'admin' ? `bg-${theme}-500/10 text-${theme}-400 border-${theme}-500/20` : "bg-white/5 text-slate-400 border-white/5"
                             )}>
                               {user.role}
                             </span>
                         </td>
                         <td className="px-8 py-6">
                             <div className="flex items-center gap-2 text-emerald-400 text-[10px] font-black uppercase tracking-widest bg-emerald-500/5 px-4 py-1.5 rounded-xl border border-emerald-500/10 w-fit">
                                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
                                Active
                             </div>
                         </td>
                         <td className="px-6 py-6 text-right">
                             <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                                <VibeButton variant="danger" size="sm" icon={Trash2} className="p-2.5" onClick={(e) => { e.stopPropagation(); handleDelete(user.username); }} />
                             </div>
                         </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
               </tbody>
            </table>
         </div>

         {filteredUsers.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-24">
               <div className="p-6 bg-white/5 rounded-full mb-4">
                  <UserCheck size={48} className="text-slate-600" />
               </div>
               <p className="text-slate-500 font-black uppercase text-xs tracking-widest">Aucun opérateur trouvé</p>
            </div>
         )}
      </GlassCard>
    </div>
  );
};

export default UsersSection;
