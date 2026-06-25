import React, { useMemo } from 'react';

const peersData = [
  { x: 14, y: 20, fireDelay: 0.0 },
  { x: 74, y: 14, fireDelay: 1.4 },
  { x: 88, y: 56, fireDelay: 0.6 },
  { x: 32, y: 78, fireDelay: 2.2 },
  { x: 56, y: 42, fireDelay: 1.0 },
  { x: 10, y: 62, fireDelay: 0.3 },
  { x: 64, y: 84, fireDelay: 1.8 },
  { x: 44, y: 18, fireDelay: 2.8 },
];

const synapsesData = [
  { a: 0, b: 4, delay: 0.0, dur: 2.4 },
  { a: 4, b: 1, delay: 0.6, dur: 1.8 },
  { a: 4, b: 2, delay: 1.2, dur: 2.6 },
  { a: 4, b: 3, delay: 0.3, dur: 3.0 },
  { a: 3, b: 5, delay: 1.6, dur: 2.0 },
  { a: 5, b: 0, delay: 0.9, dur: 2.2 },
  { a: 1, b: 2, delay: 2.4, dur: 1.6 },
  { a: 2, b: 6, delay: 1.1, dur: 2.4 },
  { a: 6, b: 3, delay: 0.4, dur: 2.8 },
  { a: 7, b: 1, delay: 1.9, dur: 1.4 },
  { a: 7, b: 4, delay: 2.6, dur: 2.0 },
  { a: 0, b: 7, delay: 0.5, dur: 1.9 },
];

const NeuralNetworkAnimation = ({ accent, isLight }) => {
  const lineColor = isLight ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.07)';

  const peers = useMemo(() => peersData, []);
  const synapses = useMemo(() => synapsesData, []);

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <filter id="signalGlow" x="-200%" y="-200%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="nodeHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accent.hex} stopOpacity="0.6" />
          <stop offset="100%" stopColor={accent.hex} stopOpacity="0" />
        </radialGradient>
        {synapses.map((s, i) => (
          <path
            key={i}
            id={`syn-${i}`}
            d={`M ${peers[s.a].x} ${peers[s.a].y} L ${peers[s.b].x} ${peers[s.b].y}`}
          />
        ))}
      </defs>

      {synapses.map((s, i) => (
        <g key={`base-${i}`}>
          <use href={`#syn-${i}`} stroke={lineColor} strokeWidth="0.15" fill="none" />
          <use
            href={`#syn-${i}`}
            stroke={accent.hex}
            strokeWidth="0.18"
            fill="none"
            strokeLinecap="round"
            opacity="0"
          >
            <animate
              attributeName="opacity"
              values="0;0.55;0"
              keyTimes="0;0.15;1"
              dur={`${s.dur}s`}
              begin={`${s.delay}s`}
              repeatCount="indefinite"
            />
          </use>
        </g>
      ))}

      {synapses.map((s, i) => (
        <g key={`pulse-${i}`} filter="url(#signalGlow)">
          <circle r="0.55" fill={accent.hex} opacity="0">
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.1;0.9;1"
              dur={`${s.dur}s`}
              begin={`${s.delay}s`}
              repeatCount="indefinite"
            />
            <animateMotion
              dur={`${s.dur}s`}
              begin={`${s.delay}s`}
              repeatCount="indefinite"
              rotate="auto"
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="spline"
              keySplines="0.22 1 0.36 1"
            >
              <mpath href={`#syn-${i}`} />
            </animateMotion>
          </circle>
        </g>
      ))}

      {peers.map((p, i) => (
        <g key={`node-${i}`}>
          <circle cx={p.x} cy={p.y} r="3" fill="url(#nodeHalo)" opacity="0.7" />
          <circle cx={p.x} cy={p.y} r="0.85" fill={accent.hex} opacity="0.4">
            <animate
              attributeName="opacity"
              values="0.35;1;0.35"
              keyTimes="0;0.1;1"
              dur="3.6s"
              begin={`${p.fireDelay}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="r"
              values="0.85;1.6;0.85"
              keyTimes="0;0.1;1"
              dur="3.6s"
              begin={`${p.fireDelay}s`}
              repeatCount="indefinite"
              calcMode="spline"
              keySplines="0.16 1 0.3 1; 0.4 0 0.6 1"
            />
          </circle>
          <circle
            cx={p.x}
            cy={p.y}
            r="0.85"
            fill="none"
            stroke={accent.hex}
            strokeWidth="0.1"
            opacity="0"
          >
            <animate
              attributeName="r"
              values="0.85;3.5"
              dur="3.6s"
              begin={`${p.fireDelay}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0;0.7;0"
              keyTimes="0;0.1;0.6"
              dur="3.6s"
              begin={`${p.fireDelay}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="stroke-width"
              values="0.18;0.02"
              dur="3.6s"
              begin={`${p.fireDelay}s`}
              repeatCount="indefinite"
            />
          </circle>
        </g>
      ))}
    </svg>
  );
};

export default NeuralNetworkAnimation;
