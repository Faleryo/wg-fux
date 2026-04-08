const { z } = require('zod');

const paginationSchema = z.object({
  page: z.string().optional().default('1').transform(Number),
  limit: z.string().optional().default('10').transform(Number),
  search: z.string().optional(),
});

const clientSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional(),
  groupId: z.number().optional(),
});

module.exports = {
  paginationSchema,
  clientSchema,
};
