import React, { useState } from 'react';
import { X, Copy, Check, Download, QrCode, FileText, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import Modal from '../ui/Modal';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

const QRCodeModal = ({ isOpen, onClose, client, onDownload }) => {
  const { theme } = useTheme();
  const [copied, setCopied] = useState(false);

  if (!client) return null;

  const handleCopy = () => {
    const copyText = async () => {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(client.config);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = client.config;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    copyText().catch(console.error);
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Tactical Configuration"
      maxWidth="max-w-4xl"
      className="p-0 overflow-hidden"
    >
      <div className="flex flex-col md:flex-row h-full">
        {/* QR Section */}
        <div className="bg-white p-12 flex flex-col items-center justify-center md:w-[40%] bg-[radial-gradient(circle_at_center,white_0%,#f1f5f9_100%)]">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white p-4 rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-slate-200 mb-10"
          >
            <QRCodeSVG value={client.config} size={220} level="H" includeMargin={true} />
          </motion.div>
          <div className="text-center space-y-2">
             <div className="flex items-center justify-center gap-2 text-slate-900 font-black uppercase tracking-widest text-sm">
                <Smartphone size={18} /> Mobile Scan
             </div>
             <p className="text-slate-500 font-bold text-[10px] uppercase tracking-widest opacity-60">Utilisez l'app WireGuard officielle</p>
          </div>
        </div>

        {/* Config Section */}
        <div className="p-8 md:p-12 md:w-[60%] flex flex-col bg-slate-950/40 backdrop-blur-3xl border-l border-white/5">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
               <div className={cn("p-3 rounded-2xl", `bg-${theme}-600 text-white shadow-2xl shadow-${theme}-600/30`)}>
                  <FileText size={24} />
               </div>
               <div>
                 <h3 className="text-xl font-black text-white tracking-widest uppercase mb-1">{client.name}</h3>
                 <span className={cn("text-[10px] font-mono font-bold tracking-widest", `text-${theme}-400`)}>{client.name.toLowerCase()}.conf</span>
               </div>
            </div>
          </div>

          <div className="relative flex-1 bg-black/40 rounded-[2rem] border border-white/5 p-6 group overflow-hidden shadow-inner">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:100%_4px] pointer-events-none opacity-20"></div>
            <pre className={cn(
              "font-mono text-[10px] leading-relaxed md:text-xs overflow-auto h-64 md:h-80 custom-scrollbar whitespace-pre-wrap pr-4",
              `text-${theme}-300/80`
            )}>
              {client.config}
            </pre>
            
            <button
              onClick={handleCopy}
              className={cn(
                "absolute top-6 right-6 p-4 backdrop-blur-3xl text-white rounded-2xl opacity-0 group-hover:opacity-100 transition-all duration-300 shadow-2xl border border-white/10 hover:scale-110 active:scale-95",
                `bg-${theme}-600/80 hover:bg-${theme}-600`
              )}
            >
              <AnimatePresence mode="wait">
                {copied ? (
                  <motion.div key="check" initial={{ scale: 0.5 }} animate={{ scale: 1 }}><Check size={20} /></motion.div>
                ) : (
                  <motion.div key="copy" initial={{ scale: 0.5 }} animate={{ scale: 1 }}><Copy size={20} /></motion.div>
                )}
              </AnimatePresence>
            </button>
          </div>

          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <button
              onClick={() => onDownload(client.name, client.config)}
              className={cn(
                "flex-1 py-4 text-white rounded-2xl font-black uppercase text-xs tracking-[0.2em] shadow-2xl transition-all flex items-center justify-center gap-3 active:scale-95 hover:scale-105",
                `bg-${theme}-600 hover:bg-${theme}-500 shadow-${theme}-600/30`
              )}
            >
              <Download size={20} /> Télécharger .conf
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default QRCodeModal;
