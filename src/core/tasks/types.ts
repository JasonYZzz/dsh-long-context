import {z} from 'zod';
import {anchorSchema,exactReplacementSchema,auditSchema} from '../types.js';
const key=z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),sha=z.string().regex(/^[a-f0-9]{64}$/),offset=z.number().int().nonnegative();
export const sourceSchema=z.object({revisionId:key,start:offset.optional(),end:offset.optional()}).strict();
export const unitSchema=z.object({unitId:key,instruction:z.string().min(1).max(4000),input:z.array(anchorSchema).max(100).default([]),evidence:z.array(anchorSchema).max(100).default([]),dependsOn:z.array(key).max(100).default([]),expectedOutputCodePoints:offset.optional()}).strict();
export const contractSchema=z.object({
  request:z.string().min(1).max(12000),sources:z.array(sourceSchema).max(100).default([]),
  output:z.object({kind:z.enum(['segments','patches','collection']).default('segments'),aggregation:z.enum(['concat','synthesize']).default('concat'),path:z.string().min(1).optional(),format:z.enum(['txt','md','tex']).default('md'),title:z.string().max(500).default(''),physicalPages:z.number().int().positive().max(1000).optional(),minCodePoints:offset.optional(),maxCodePoints:z.number().int().positive().optional(),minItems:offset.optional(),maxItems:offset.optional()}).strict().default({kind:'segments',aggregation:'concat',format:'md',title:''}),
  requirements:z.array(z.string().min(1).max(2000)).max(40).default([]),protectedAnchors:z.array(anchorSchema).max(1000).default([]),
  exactReplacements:z.array(exactReplacementSchema).max(100).default([]),requireCitations:z.boolean().default(false),
  review:z.enum(['self','related','all']).default('self'),reviewUnitIds:z.array(key).default([]),
  budget:z.object({maxCalls:z.number().int().positive(),maxTokens:z.number().int().positive(),maxWallMs:z.number().int().positive()}).optional()
}).strict();
export type TaskContract=z.infer<typeof contractSchema>;
export const itemSchema=z.object({key:key,decision:z.enum(['include','exclude','uncertain']),text:z.string(),reason:z.string().min(1),evidence:z.array(anchorSchema).default([])}).strict();
export const resultSchema=z.object({unitId:key,text:z.string().optional(),patches:z.array(z.object({anchor:anchorSchema,replacement:z.string(),reason:z.string().min(1)}).strict()).optional(),items:z.array(itemSchema).optional(),citations:z.array(anchorSchema).default([]),summary:z.string().max(500),assessment:z.object({satisfied:z.boolean(),issues:z.array(z.string().min(1)).max(30)}).strict()}).strict();
export type UnitResult=z.infer<typeof resultSchema>;
export const preparedSchema=z.object({result:resultSchema,readReceipts:z.array(z.string()).default([])}).strict();
export const directiveSchema=z.object({maxUnits:z.number().int().min(1).max(8).default(4),evidence:z.array(anchorSchema).max(30).optional(),reviewUnitIds:z.array(key).optional(),reviseUnits:z.array(unitSchema).max(100).optional(),units:z.array(unitSchema).min(1).max(10000).optional(),retry:z.boolean().default(false)}).strict();
export const workInputSchema=z.object({contract:contractSchema,units:z.array(unitSchema).min(1).max(10000).optional(),preparedResults:z.array(preparedSchema).max(8).optional(),window:directiveSchema.optional()}).strict();
export type WorkInput=z.infer<typeof workInputSchema>;
export type Directive=z.infer<typeof directiveSchema>;
export const managedCheckSchema=z.object({unitIds:z.array(key),outputHashes:z.array(sha),method:z.enum(['self','session','independent','deterministic','format']),passed:z.boolean(),issues:z.array(z.string()),instruction:z.string(),createdAt:z.string()}).strict();
export const managedSchema=z.object({schemaVersion:z.literal(3),taskId:key,workspaceId:sha,ownerSession:z.string().min(1),journalRevision:offset,
  state:z.enum(['running','needs_attention','stale','completed_with_checks','cancelled']),createdAt:z.string(),contract:contractSchema,scope:z.array(anchorSchema),
  units:z.array(unitSchema.extend({contentHash:sha.nullable(),summary:z.string(),provided:z.array(anchorSchema)}).strict()),
  checks:z.array(managedCheckSchema),calls:offset,tokens:offset,unknownUsage:z.boolean(),
  budget:z.object({maxCalls:z.number().int().positive(),maxTokens:z.number().int().positive(),maxWallMs:z.number().int().positive()}),audits:z.array(auditSchema),
  attention:z.array(z.string()),startRequestId:key,startFingerprint:sha,
  operation:z.object({token:key,requestId:key,fingerprint:sha,phase:z.enum(['produce','review','combine','publish','export','rollback']),unitIds:z.array(key),pid:z.number().int(),host:z.string(),reservedTokens:offset,reservedCalls:offset.optional(),startedAt:z.string(),inputHash:sha.nullable(),outputPath:z.string().optional()}).nullable(),
  requests:z.record(z.string(),z.object({fingerprint:sha,result:z.unknown()}).strict()),
  reductions:z.array(z.object({unitId:key,inputs:z.array(z.object({unitId:key,contentHash:sha}).strict()).min(2),contentHash:sha}).strict()).default([]),
  artifact:z.object({contentHash:sha,path:z.string().nullable(),renderedHash:sha.nullable(),renderedPath:z.string().nullable(),physicalPages:offset.nullable()}).nullable(),combinedHash:sha.nullable(),corrections:offset
}).strict();
export type ManagedTask=z.infer<typeof managedSchema>;
