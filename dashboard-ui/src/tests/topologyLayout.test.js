/**
 * Répartition des peers sur la carte de topologie.
 *
 * BUG : tous les peers étaient placés sur UN seul cercle. Au-delà de quelques
 * dizaines, la circonférence disponible devient inférieure à la place occupée
 * — 47 peers de 64 px réclament ~3000 px pour ~1760 offerts — et les nœuds se
 * chevauchent au point de rendre la carte illisible. La formule était en outre
 * dupliquée entre les nœuds et les liens, donc toute divergence désalignait les
 * traits par rapport aux icônes.
 */
import { describe, it, expect } from 'vitest';
import { computeTopologyLayout } from '../features/dashboard/components/topologyLayout';

const CX = 500;
const CY = 400;
const R = 280;
const NODE = 64;

const dist = (p) => Math.hypot(p.x - CX, p.y - CY);
// Plus petite distance entre deux nœuds d'un même anneau.
const minGapWithinRing = (positions, ring) => {
  const pts = positions.filter((p) => p.ring === ring);
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    }
  }
  return min;
};

describe('computeTopologyLayout', () => {
  it('renvoie exactement une position par peer', () => {
    expect(computeTopologyLayout(47, CX, CY, R, NODE)).toHaveLength(47);
    expect(computeTopologyLayout(1, CX, CY, R, NODE)).toHaveLength(1);
  });

  it('gère les cas vides sans lever', () => {
    expect(computeTopologyLayout(0, CX, CY, R, NODE)).toEqual([]);
    expect(computeTopologyLayout(10, CX, CY, 0, NODE)).toEqual([]);
  });

  it('garde un seul anneau tant que les peers y tiennent', () => {
    const pos = computeTopologyLayout(8, CX, CY, R, NODE);
    expect(new Set(pos.map((p) => p.ring)).size).toBe(1);
  });

  it('déborde sur plusieurs anneaux quand un seul ne suffit plus', () => {
    // C'est le cas réel qui rendait la carte illisible.
    const pos = computeTopologyLayout(47, CX, CY, R, NODE);
    expect(new Set(pos.map((p) => p.ring)).size).toBeGreaterThan(1);
  });

  it('ne laisse JAMAIS deux nœuds se chevaucher sur un même anneau', () => {
    const pos = computeTopologyLayout(47, CX, CY, R, NODE);
    for (const ring of new Set(pos.map((p) => p.ring))) {
      if (pos.filter((p) => p.ring === ring).length < 2) continue;
      // Deux icônes de 64 px ne doivent pas se recouvrir : centres > 64 px.
      expect(minGapWithinRing(pos, ring)).toBeGreaterThan(NODE);
    }
  });

  it('éloigne chaque anneau du précédent', () => {
    const pos = computeTopologyLayout(60, CX, CY, R, NODE);
    const r0 = dist(pos.find((p) => p.ring === 0));
    const r1 = dist(pos.find((p) => p.ring === 1));
    expect(r1).toBeGreaterThan(r0);
  });

  it('place le premier anneau au rayon demandé, centré sur le noyau', () => {
    const pos = computeTopologyLayout(6, CX, CY, R, NODE);
    for (const p of pos.filter((x) => x.ring === 0)) {
      expect(dist(p)).toBeCloseTo(R, 5);
    }
  });

  it('démarre en haut du cercle', () => {
    const [first] = computeTopologyLayout(4, CX, CY, R, NODE);
    expect(first.x).toBeCloseTo(CX, 5);
    expect(first.y).toBeCloseTo(CY - R, 5);
  });

  it('reste borné même sur une géométrie dégénérée', () => {
    // Rayon minuscule + gros nœuds : la capacité par anneau tombe à 1.
    const pos = computeTopologyLayout(200, CX, CY, 1, 500);
    expect(pos.length).toBeLessThanOrEqual(200);
    expect(pos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});
