import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../../lib/utils';

const NetworkEdge = ({ clients, centerX, centerY, radius, isDark, getContainerColor }) => {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none drop-shadow-2xl">
      {clients.map((client, i) => {
        const angle = (i * (2 * Math.PI)) / clients.length - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        const isOnline = client.isOnline;
        const hasTraffic = client.downloadRate + client.uploadRate > 1024;
        const color = getContainerColor(client.container);

        if (!centerX || !centerY) return null;

        return (
          <g key={`link-${client.id}`}>
            <motion.line
              x1={centerX}
              y1={centerY}
              x2={x}
              y2={y}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: isOnline ? 0.6 : 0.1 }}
              stroke={
                isOnline
                  ? hasTraffic
                    ? color.hex
                    : isDark
                      ? 'rgba(255, 255, 255, 0.2)'
                      : 'rgba(0, 0, 0, 0.2)'
                  : isDark
                    ? 'rgba(255, 255, 255, 0.05)'
                    : 'rgba(0, 0, 0, 0.05)'
              }
              strokeWidth={isOnline ? (hasTraffic ? '2' : '1.5') : '1'}
              strokeDasharray={isOnline ? '0' : '5,5'}
            />
            {isOnline && (
              <circle r={hasTraffic ? '3' : '2'} fill={hasTraffic ? color.hex : '#818cf8'}>
                <animateMotion
                  dur={
                    hasTraffic
                      ? `${Math.max(0.4, 4 - Math.log10(client.downloadRate + client.uploadRate + 1))}s`
                      : '4s'
                  }
                  repeatCount="indefinite"
                  path={`M${centerX},${centerY} L${x},${y}`}
                />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
};

export default NetworkEdge;
