// services/brand.js — White-label : résolution de la marque d'un compte.
//
// Un compte sans marque hérite de celle de son plus proche ancêtre (parentId),
// sinon la marque par défaut wg-fux. Profondeur bornée (≤ 2) mais on remonte la
// chaîne de façon itérative pour rester correct.

const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');

const DEFAULT_BRAND = {
  name: 'wg-fux',
  logoUrl: null,
  primaryColor: null,
  customDomain: null,
};

async function getOwnBrand(userId) {
  const [row] = await db
    .select()
    .from(schema.brands)
    .where(eq(schema.brands.userId, userId))
    .limit(1);
  return row || null;
}

// Remonte parentId jusqu'à trouver une marque ; défaut sinon. Garde-fou anti-cycle.
async function resolveBrand(userId) {
  let current = userId;
  const seen = new Set();
  while (current != null && !seen.has(current)) {
    seen.add(current);
    const own = await getOwnBrand(current);
    if (own && (own.name || own.logoUrl || own.primaryColor || own.customDomain)) {
      return { ...DEFAULT_BRAND, ...own, inherited: current !== userId, sourceUserId: current };
    }
    const [u] = await db
      .select({ parentId: schema.users.parentId })
      .from(schema.users)
      .where(eq(schema.users.id, current))
      .limit(1);
    current = u ? u.parentId : null;
  }
  return { ...DEFAULT_BRAND, inherited: false, sourceUserId: null };
}

async function setBrand(userId, { name, logoUrl, primaryColor, customDomain }) {
  const values = {
    userId,
    name: name ?? null,
    logoUrl: logoUrl ?? null,
    primaryColor: primaryColor ?? null,
    customDomain: customDomain ?? null,
  };
  await db
    .insert(schema.brands)
    .values(values)
    .onConflictDoUpdate({ target: schema.brands.userId, set: values });
  return values;
}

module.exports = { DEFAULT_BRAND, getOwnBrand, resolveBrand, setBrand };
