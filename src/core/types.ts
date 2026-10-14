import {z} from 'zod';
export type BrandedId<K extends string> = string & {readonly __brand:K};
export type DocumentId=BrandedId<'DocumentId'>;
export type RevisionId=BrandedId<'RevisionId'>;
export type TaskId=BrandedId<'TaskId'>;
const key=z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const offset=z.number().int().nonnegative();
export const anchorSchema=z.object({revisionId:key,blockId:key,start:offset,end:offset,textHash:sha}).strict().refine(a=>a.end>=a.start);
export type Anchor=z.infer<typeof anchorSchema>;
export const blockSchema=z.object({blockId:key,revisionId:key,start:offset,end:offset,length:offset,contentHash:sha,
  sectionPath:z.array(z.string()),pageStart:offset.nullable(),pageEnd:offset.nullable(),lineStart:offset,lineEnd:offset,
  previous:key.nullable(),next:key.nullable(),kind:z.enum(['text','formula','table'])}).strict();
export type Block=z.infer<typeof blockSchema>;
export const documentSchema=z.object({schemaVersion:z.literal(1),documentId:key,revisionId:key,workspaceId:sha,path:z.string(),
  sourceHash:sha,textHash:sha,format:z.enum(['txt','md','tex','pdf-text']),extractorVersion:z.string(),extractorConfigHash:sha,
  blocksHash:sha,blocks:z.array(blockSchema),length:offset,qualityIssues:z.array(z.string()),createdAt:z.string()}).strict();
export type DocumentRevision=z.infer<typeof documentSchema>;
export const impactSchema=z.object({itemId:key,anchor:anchorSchema,decision:z.enum(['change','keep','uncertain']),evidence:z.string().min(1),
  rationale:z.string().min(1),claimId:z.string(),source:z.enum(['scanner','reviewer']),status:z.enum(['pending','resolved']),replacement:z.string().nullable()}).strict();
export type Impact=z.infer<typeof impactSchema>;
export const dependencySchema=z.object({edgeId:key,from:key,to:key,relation:z.string().min(1),evidenceAnchors:z.array(anchorSchema).min(1),
  kind:z.enum(['explicit','inferred']),critical:z.boolean(),resolution:z.enum(['pending','resolved','needs_evidence']),reason:z.string(),
  checkedCandidateId:key.nullable()}).strict();
export type Dependency=z.infer<typeof dependencySchema>;
export const patchSchema=z.object({itemId:key,baseRevisionId:key,anchor:anchorSchema,expectedOriginal:z.string().min(1),replacement:z.string(),rationale:z.string().min(1),hash:sha}).strict();
export type Patch=z.infer<typeof patchSchema>;
export const planSchema=z.object({planId:key,baseRevisionId:key,goalHash:sha,patches:z.array(patchSchema),hash:sha}).strict();
export type Plan=z.infer<typeof planSchema>;
export const candidateSchema=z.object({candidateRevisionId:key,planId:key,path:z.string(),contentHash:sha,draft:z.boolean(),status:z.enum(['prepared','committed','rollback_prepared','rolled_back']),requestId:key}).strict();
export type Candidate=z.infer<typeof candidateSchema>;
export const checkSchema=z.object({candidateRevisionId:key,scope:z.string(),checkKind:z.enum(['structural','semantic','format','human']),checker:z.string(),
  checkerVersion:z.string(),result:z.enum(['passed','failed','unknown']),issues:z.array(z.string()),evidence:z.array(z.string()),createdAt:z.string()}).strict();
export type Verification=z.infer<typeof checkSchema>;
export const auditSchema=z.object({purpose:z.string(),promptVersion:z.string(),inputHash:sha,outputHash:sha,model:z.string(),provider:z.string(),
  usage:z.object({input:z.number().nonnegative(),output:z.number().nonnegative()}).nullable(),finishReason:z.string(),elapsedMs:offset,error:z.string().nullable()}).strict();
export type Audit=z.infer<typeof auditSchema>;
export const taskSchema=z.object({schemaVersion:z.literal(1),taskId:key,workspaceId:sha,ownerSession:z.string().min(1),documentRevisionId:key,
  journalRevision:offset,state:z.enum(['scanning','impacts_reviewed','planned','candidate_created','verifying','completed_with_checks','needs_attention','stale','failed','cancelled']),
  goal:z.object({request:z.string().min(1),changeGoal:z.string().min(1),aliases:z.array(z.string()),mustPreserve:z.array(z.string()),protectedAnchors:z.array(anchorSchema),scope:z.array(key)}).strict(),
  goalHash:sha,reviewed:z.array(key),readRanges:z.array(z.object({start:offset,end:offset})),scanPass:offset,
  impacts:z.array(impactSchema),dependencies:z.array(dependencySchema),plan:planSchema.nullable(),candidate:candidateSchema.nullable(),candidateHistory:z.array(candidateSchema).default([]),
  checks:z.array(checkSchema),audits:z.array(auditSchema),calls:offset,tokens:offset,unknownUsage:z.boolean(),
  createdAt:z.string(),lastProgressAt:z.string(),corrections:offset,attention:z.array(z.string()),
  requests:z.record(z.string(),z.object({fingerprint:sha,result:z.unknown()}))}).strict();
export type Task=z.infer<typeof taskSchema>;
export interface Identity {workspaceId:string;sessionId:string;}
export interface Command {requestId:string;expectedLedgerRevision:number;}
export interface ReadPage {text:string;anchor:Anchor;completeRange:{start:number;end:number};nextCursor:string|null;total:number;}
