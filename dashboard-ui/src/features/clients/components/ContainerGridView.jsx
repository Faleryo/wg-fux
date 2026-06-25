import { motion } from 'framer-motion';
import { Package } from 'lucide-react';
import GlassCard from '../../../components/ui/Card';
import ContainerCard from './ContainerCard';
import { getContainerColor } from './ClientListHelpers';

const ContainerGridView = ({ containerEntries, onSelectContainer, onDeleteContainer }) => {
  return (
    <motion.div
      key="container-grid"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      {containerEntries.length === 0 ? (
        <GlassCard
          className="flex flex-col items-center justify-center py-32 border-dashed"
          hover={false}
        >
          <div className="p-8 bg-white/5 rounded-full mb-6">
            <Package size={64} className="text-slate-600" />
          </div>
          <h3 className="text-2xl font-black text-white tracking-widest uppercase mb-2">
            Initialisation Requise
          </h3>
          <p className="text-slate-500 font-bold uppercase text-[10px] tracking-widest">
            Créez votre premier conteneur depuis le bouton "+" ci-dessus
          </p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {containerEntries.map(([name, cClients], idx) => (
            <ContainerCard
              key={name}
              name={name}
              clients={cClients}
              color={getContainerColor(name)}
              onDeleteContainer={onDeleteContainer}
              idx={idx}
              onClick={() => onSelectContainer(name)}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
};

export default ContainerGridView;
