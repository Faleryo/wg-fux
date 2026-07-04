import React from 'react';
import { motion } from 'framer-motion';
import GlassCard from '../../../components/ui/Card';
import { Skeleton } from '../../../components/ui/Skeleton';
import { LiveTelemetryChart } from './LiveTelemetryChart';
import EdgeNodeHeatmap from '../../../components/SRE/EdgeNodeHeatmap';
import DashboardAlerts from './DashboardAlerts';
import DashboardHero from './DashboardHero';
import StatusPanel from './StatusPanel';
import TrafficPieChart from './TrafficPieChart';
import SpeedtestSection from './SpeedtestSection';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: 'spring',
      stiffness: 100,
      damping: 10,
    },
  },
};

const DashboardSection = ({
  stats,
  trafficData,
  systemStats,
  clients,
  health,
  config,
  onRunSpeedtest,
  speedtest,
  sentinel,
  adguardStatus,
  onNavigate,
  activeInterface,
  setActiveInterface,
  interfaces,
  isManager = true,
  instanceLicensed = false,
  loading = false,
}) => {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="space-y-6 md:space-y-10"
    >
      <DashboardAlerts clients={clients} onNavigate={onNavigate} />

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-12 gap-6 md:gap-8">
        <motion.div variants={itemVariants} className="2xl:col-span-8">
          <DashboardHero
            stats={stats}
            config={config}
            health={health}
            activeInterface={activeInterface}
            setActiveInterface={setActiveInterface}
            isManager={isManager}
          />
        </motion.div>

        <motion.div
          variants={itemVariants}
          className="lg:col-span-1 2xl:col-span-4 flex flex-col gap-6"
        >
          <StatusPanel
            sentinel={sentinel}
            adguardStatus={adguardStatus}
            systemStats={systemStats}
            clients={clients}
            isManager={isManager}
            businessMode={instanceLicensed}
          />
        </motion.div>
      </div>

      {/* EdgeNodeHeatmap (interfaces) réservé aux managers : /system/interfaces */}
      {isManager &&
        (loading && interfaces.length === 0 ? (
          <motion.div variants={itemVariants}>
            <Skeleton className="h-36 rounded-[2rem]" />
          </motion.div>
        ) : interfaces.length > 0 ? (
          <motion.div variants={itemVariants}>
            <GlassCard className="p-6 md:p-8">
              <EdgeNodeHeatmap interfaces={interfaces} />
            </GlassCard>
          </motion.div>
        ) : null)}

      <motion.div
        variants={itemVariants}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-12 gap-6 lg:gap-8"
      >
        {/* Courbe de trafic temps réel pour TOUS les rôles ; l'onglet 24 h
            (historique /system/traffic-history) est réservé aux managers. */}
        <div className="md:col-span-2 lg:col-span-2 2xl:col-span-8">
          <LiveTelemetryChart realtimeData={trafficData} isManager={isManager} />
        </div>

        <motion.div
          variants={itemVariants}
          className="lg:col-span-1 2xl:col-span-4 flex flex-col gap-6"
        >
          <TrafficPieChart clients={clients} />
          {isManager && <SpeedtestSection speedtest={speedtest} onRunSpeedtest={onRunSpeedtest} />}
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default DashboardSection;
