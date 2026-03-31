const { z } = require('zod');

// Common Regex for identifiers (container, names)
const identifierRegex = /^[a-zA-Z0-9_\-]+$/;

const loginSchema = z.object({
  username: z.string().min(1, 'Username requis'),
  password: z.string().min(1, 'Mot de passe requis'),
  token: z.string().optional()
});

const clientSchema = z.object({
  name: z.string().regex(identifierRegex, 'Format de nom invalide'),
  container: z.string().regex(identifierRegex, 'Format de container invalide'),
  expiry: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'Format de date invalide (YYYY-MM-DD)').or(z.literal('')).optional(),
  quota: z.union([z.number(), z.string()]).transform(v => parseInt(v) || 0).optional(),
  uploadLimit: z.union([z.number(), z.string()]).transform(v => parseInt(v) || 0).optional(),
});

const userSchema = z.object({
  username: z.string().min(3).regex(identifierRegex, 'Format de nom d\'utilisateur invalide'),
  password: z.string().min(6).optional(),
  role: z.enum(['admin', 'manager', 'viewer', 'user']).default('viewer'),
  expiry: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).or(z.null()).optional(),
});

const ticketSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
});

module.exports = {
  loginSchema,
  clientSchema,
  userSchema,
  ticketSchema
};
