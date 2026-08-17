// topologyLayout.js — Placement des peers autour du noyau.
//
// POURQUOI : la carte plaçait TOUS les peers sur un unique cercle. Au-delà de
// quelques dizaines, la circonférence disponible devient inférieure à la place
// qu'ils occupent (47 peers de 64 px demandent ~3000 px pour ~1760 offerts) :
// les nœuds se chevauchent et la carte devient illisible. On répartit donc sur
// plusieurs anneaux concentriques, en remplissant du plus proche au plus loin.
//
// Le calcul est partagé par les nœuds ET par les liens : les deux le
// dédupliquaient auparavant, donc toute divergence de formule désalignait les
// traits par rapport aux icônes.

// Espacement minimal entre deux centres de nœuds sur un même anneau.
const GAP_FACTOR = 1.35;

/**
 * @param {number} total      nombre de peers
 * @param {number} centerX    centre du noyau (px)
 * @param {number} centerY
 * @param {number} baseRadius rayon du premier anneau
 * @param {number} nodeSize   diamètre d'un nœud (px)
 * @returns {Array<{x:number,y:number,ring:number}>} une position par peer
 */
export function computeTopologyLayout(total, centerX, centerY, baseRadius, nodeSize) {
  const positions = [];
  if (!total || !baseRadius) return positions;

  const spacing = Math.max(1, nodeSize * GAP_FACTOR);
  // Écart entre deux anneaux : de quoi ne pas coller les icônes verticalement.
  const ringStep = Math.max(nodeSize * 1.15, 48);

  let placed = 0;
  let ring = 0;
  while (placed < total) {
    const radius = baseRadius + ring * ringStep;
    // Combien tiennent sur cette circonférence sans se chevaucher.
    const capacity = Math.max(1, Math.floor((2 * Math.PI * radius) / spacing));
    const count = Math.min(capacity, total - placed);

    for (let i = 0; i < count; i++) {
      // -PI/2 → on démarre en haut. Décalage d'un demi-pas sur les anneaux
      // impairs pour que les nœuds ne s'alignent pas radialement.
      const angle = (i * (2 * Math.PI)) / count - Math.PI / 2 + (ring % 2 ? Math.PI / count : 0);
      positions.push({
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        ring,
      });
    }
    placed += count;
    ring += 1;
    // Garde-fou : jamais de boucle infinie même sur une géométrie dégénérée.
    if (ring > 50) break;
  }
  return positions;
}

export default computeTopologyLayout;
