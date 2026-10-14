import {z} from 'zod';
export const auxiliaryModelSchema=z.object({provider:z.string().min(1).optional(),model:z.string().min(1).optional(),reasoningEffort:z.string().min(1).optional(),maxOutputTokens:z.number().int().positive().optional(),deadlineMs:z.number().int().min(100).max(300000).optional()}).strict();
export const configSchema=z.object({
  rendererExecutable:z.string().min(1).optional(),rendererFontconfigFile:z.string().min(1).optional(),
  auxiliaryModel:auxiliaryModelSchema.default({}),
  stateRoot:z.string().min(1).default('.dsh-long-context'), mode:z.enum(['strict','advisory']).default('strict'),
  blockTargetCodePoints:z.number().int().min(128).max(6000).default(4000), blockMaxCodePoints:z.number().int().min(128).max(12000).default(6000),
  maxEvidenceCodePoints:z.number().int().min(1000).max(100000).default(48000),
  maxInputBytes:z.number().int().positive().max(100_000_000).default(20_000_000),
  maxToolResultCodePoints:z.number().int().min(1000).max(7000).default(7000),
  maxCheckpointCodePoints:z.number().int().min(1000).max(4500).default(4500),
  deadlineMs:z.number().int().min(100).max(300000).default(45000), retries:z.number().int().min(0).max(2).default(2),
  maxCalls:z.number().int().positive().default(1000), maxTokens:z.number().int().positive().default(2_000_000),
  maxWallMs:z.number().int().positive().default(14_400_000), maxOutputTokens:z.number().int().positive().default(4096),
  maxCorrections:z.number().int().min(0).max(2).default(2), semanticVerification:z.boolean().default(true)
}).strict().refine(c=>c.blockTargetCodePoints<=c.blockMaxCodePoints,{message:'block target exceeds maximum'});
export type Config=z.infer<typeof configSchema>;
export const resolveConfig=(input:unknown={})=>configSchema.parse(input);
