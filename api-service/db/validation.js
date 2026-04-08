const { z } = require('zod');

// Common Regex for identifiers (container, names)
const identifierRegex = /^[a-zA-Z0-9_-]+$/;
const dateRegex = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const loginSchema = z.object({
  username: z.string().min(1, 'Username requis'),
  password: z.string().min(1, 'Mot de passe requis'),
  token: z.string().optional()
});

const clientSchema = z.object({
  name: z.string().regex(identifierRegex, 'Format de nom invalide'),
  container: z.string().regex(identifierRegex, 'Format de container invalide'),
  expiry: z.string().regex(dateRegex, 'Format de date invalide (YYYY-MM-DD)').or(z.literal('')).optional(),
  quota: z.union([z.number(), z.string()]).transform(v => parseInt(v) || 0).optional(),
  uploadLimit: z.union([z.number(), z.string()]).transform(v => parseInt(v) || 0).optional(),
}).strict();

// Schéma pour patch client (expiry/quota/uploadLimit partiels)
const clientPatchSchema = z.object({
  expiry: z.string().regex(dateRegex).or(z.literal('')).or(z.null()).optional(),
  quota: z.union([z.number(), z.string()]).transform(v => parseInt(v) || 0).optional(),
  uploadLimit: z.union([z.number(), z.string()]).transform(v => parseInt(v) || 0).optional(),
}).strict();

// Schéma pour toggle client
const toggleSchema = z.object({
  enabled: z.boolean({ required_error: 'enabled (boolean) requis' }),
});

// Schéma pour bulk-update
const bulkUpdateSchema = z.object({
  clients: z.array(z.object({
    container: z.string().regex(identifierRegex),
    name: z.string().regex(identifierRegex),
  })).min(1, 'Au moins un client requis'),
  update: z.object({
    expiry: z.string().regex(dateRegex).or(z.literal('')).or(z.null()).optional(),
    quota: z.union([z.number(), z.string()]).transform(v => parseInt(v) || 0).optional(),
  })
});

// Schéma pour bulk-delete
const bulkDeleteSchema = z.object({
  clients: z.array(z.object({
    container: z.string().regex(identifierRegex),
    name: z.string().regex(identifierRegex),
  })).min(1, 'Au moins un client requis'),
});

// Schéma pour move client
const moveClientSchema = z.object({
  container: z.string().regex(identifierRegex, 'Container invalide'),
  name: z.string().regex(identifierRegex, 'Nom invalide'),
  newContainer: z.string().regex(identifierRegex, 'Nouveau container invalide'),
});

// Schéma pour create container
const containerSchema = z.object({
  name: z.string().regex(identifierRegex, 'Format de nom invalide'),
});

const userSchema = z.object({
  username: z.string().min(2, 'Username doit faire au moins 2 caractères').regex(identifierRegex, 'Format de nom d\'utilisateur invalide'),
  password: z.string().min(6).optional(),
  role: z.enum(['admin', 'manager', 'viewer', 'user']).default('viewer'),
  expiry: z.string().regex(dateRegex).or(z.null()).optional(),
}).strict();

const ticketSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
});

// Schéma pour config système
const systemConfigSchema = z.object({
  port: z.union([z.number(), z.string()]).transform(v => parseInt(v)).refine(n => n >= 1 && n <= 65535, 'Port invalide').optional(),
  mtu: z.union([z.number(), z.string()]).transform(v => parseInt(v)).refine(n => n >= 576 && n <= 9000, 'MTU invalide').optional(),
  dns: z.string().min(1).regex(/^[a-zA-Z0-9\s.,-]+$/, 'Format DNS invalide (caractères spéciaux interdits)').optional(),
  subnet: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/, 'Subnet invalide').optional(),
  keepalive: z.union([z.number(), z.string(), z.boolean()])
    .transform(v => {
      if (typeof v === 'boolean') return v ? 25 : 0;
      const n = parseInt(v);
      return isNaN(n) ? 0 : n;
    })
    .refine(n => n >= 0 && n <= 120, 'Keepalive doit être entre 0 et 120s')
    .optional(),
});

module.exports = {
  loginSchema,
  clientSchema,
  clientPatchSchema,
  toggleSchema,
  bulkUpdateSchema,
  bulkDeleteSchema,
  moveClientSchema,
  containerSchema,
  userSchema,
  ticketSchema,
  systemConfigSchema,
};
