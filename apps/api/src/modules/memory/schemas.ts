import { z } from 'zod';

const layer = z.enum(['L2', 'L3']);
const status = z.enum(['active', 'archived']);

export const memoryListQuerySchema = z.object({
  layer: layer.optional(),
  surface: z.string().trim().min(1).max(64).optional(),
  slot: z.string().trim().min(1).max(64).optional(),
  includeArchived: z.coerce.boolean().default(false),
});

export const memoryEntryParamsSchema = z.object({ id: z.string().uuid() });

export const memoryEntryCreateSchema = z.object({
  layer,
  surface: z.string().trim().min(1).max(64).optional(),
  slot: z.string().trim().min(1).max(64).optional(),
  section: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(240),
  refs: z.array(z.string().trim().min(1).max(200)).max(32).default([]),
  status: status.default('active'),
}).superRefine((value, ctx) => {
  if (value.layer === 'L2' && (!value.surface || value.slot)) {
    ctx.addIssue({ code: 'custom', message: 'L2 entries require surface and cannot have slot', path: ['surface'] });
  }
  if (value.layer === 'L3' && (!value.slot || value.surface)) {
    ctx.addIssue({ code: 'custom', message: 'L3 entries require slot and cannot have surface', path: ['slot'] });
  }
});

export const memoryEntryUpdateSchema = z.object({
  section: z.string().trim().min(1).max(80).optional(),
  text: z.string().trim().min(1).max(240).optional(),
  refs: z.array(z.string().trim().min(1).max(200)).max(32).optional(),
  status: status.optional(),
});

export const memoryEventCreateSchema = z.object({
  surface: z.string().trim().min(1).max(64),
  kind: z.string().trim().min(1).max(80),
  payload: z.unknown(),
  sourceType: z.string().trim().min(1).max(80).nullable().optional(),
  sourceId: z.string().trim().min(1).max(200).nullable().optional(),
  fingerprint: z.string().trim().min(1).max(200).nullable().optional(),
  occurredAt: z.coerce.date().optional(),
});

export const memoryEventListQuerySchema = z.object({
  surface: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export const memoryConsolidationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const memoryRunListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });
