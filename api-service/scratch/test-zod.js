const { z } = require('zod');

const systemConfigSchema = z.object({
  port: z
    .union([z.number(), z.string()])
    .transform((v) => parseInt(v))
    .refine((n) => n >= 1 && n <= 65535, 'Port invalide')
    .optional(),
});

const result = systemConfigSchema.safeParse({ port: 'invalid-port' });
console.log('Result:', JSON.stringify(result, null, 2));
