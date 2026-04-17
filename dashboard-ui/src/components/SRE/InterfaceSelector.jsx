import React, { useState, useEffect } from 'react';
import { axiosInstance } from '../../lib/api';

const InterfaceSelector = ({ onSelect, current }) => {
  const [interfaces, setInterfaces] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInterfaces = async () => {
      try {
        const response = await axiosInstance.get('/system/interfaces');
        setInterfaces(response.data);
      } catch (error) {
        console.error('Failed to fetch interfaces', error);
      } finally {
        setLoading(false);
      }
    };
    fetchInterfaces();
  }, []);

  if (loading) return <div className="animate-pulse h-10 w-32 bg-slate-700/50 rounded-lg"></div>;

  return (
    <div className="flex items-center gap-3 bg-slate-900/50 p-1.5 rounded-xl border border-slate-700/50 backdrop-blur-sm">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2">Node</span>
      <div className="flex gap-1">
        {interfaces.map((iface) => (
          <button
            key={iface.name}
            onClick={() => onSelect(iface.name)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-300 flex items-center gap-2 ${
              current === iface.name
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50 shadow-[0_0_15px_rgba(37,99,235,0.2)]'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-transparent'
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${iface.status === 'up' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-500'}`}></div>
            {iface.name.toUpperCase()}
            {iface.type === 'WireGuard' && <span className="text-[8px] opacity-50 px-1 border border-current rounded uppercase">Edge</span>}
          </button>
        ))}
      </div>
    </div>
  );
};

export default InterfaceSelector;
