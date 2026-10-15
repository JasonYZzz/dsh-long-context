import {Context,Service} from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type {Agent} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-fs';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import type {} from '@deepseek-ai/dsh-compaction-tool-result-pruner';
import {realpath} from 'node:fs/promises';
import {LongContextEngine} from '../core/engine.js';
import {LocalRecordStore,validateStateRoot} from '../core/ledger/store.js';
import {resolveConfig,type Config} from '../core/config.js';
import {hash} from '../core/util.js';
import {invariant} from '../core/errors.js';
import {DshFileAdapter} from './fs.js';
import {OfficeRenderer} from './render.js';
import {DshModelAdapter} from './model.js';
import {assertCompatibility} from './compatibility.js';
declare module '@deepseek-ai/cordis' {interface Context {longContext:LongContextHub;}}
export class LongContextHub extends Service {
  static inject=['fs','llm'];
  static Config=z.object({rendererExecutable:z.string(),rendererFontconfigFile:z.string(),legacyTools:z.boolean().default(false),auxiliaryModel:z.object({provider:z.string(),model:z.string(),reasoningEffort:z.string(),maxOutputTokens:z.number(),deadlineMs:z.number()}),stateRoot:z.string().default('.dsh-long-context'),mode:z.union(['strict','advisory']).default('strict'),
    maxEvidenceCodePoints:z.number(),blockTargetCodePoints:z.number(),blockMaxCodePoints:z.number(),maxInputBytes:z.number(),maxToolResultCodePoints:z.number(),maxCheckpointCodePoints:z.number(),
    deadlineMs:z.number(),retries:z.number(),maxCalls:z.number(),maxTokens:z.number(),maxWallMs:z.number(),maxOutputTokens:z.number(),maxCorrections:z.number(),semanticVerification:z.boolean()});
  readonly config:Config;
  private readonly hostContext:Context;
  private readonly stores=new Map<string,Promise<LocalRecordStore>>();
  constructor(ctx:Context,config:Partial<Config>={}){super(ctx,'longContext');this.hostContext=ctx;assertCompatibility();this.config=resolveConfig(config);}
  async engine(_ctx:Context,agent:Agent):Promise<LongContextEngine>{
    const ctx=this.hostContext;
    const cwd=agent.session.header.cwd;invariant(cwd,'LC_PERMISSION_DENIED','Long-context requires a workspace-backed session');
    const workspace=await realpath(cwd),target=await ctx.fs.resolve(workspace);
    invariant(ctx.fs.processPathFromHostPath(workspace)===workspace&&ctx.fs.processPath(target)===workspace,'LC_DSH_INCOMPATIBLE','Only verified host-local filesystems are supported');
    const workspaceId=hash(workspace);
    const pruner=ctx.get('agentPresets')?.serviceFor(agent,'toolResultPruner')??ctx.get('toolResultPruner');
    const resultBudget=Math.min(this.config.maxToolResultCodePoints,pruner?.config.thresholdChars??Infinity);
    invariant(resultBudget>=2000,'LC_RESULT_BUDGET_TOO_SMALL','Active pruner threshold cannot fit a resumable tool result');
    let store=this.stores.get(workspaceId);if(!store){store=(async()=>{const root=await validateStateRoot(workspace,this.config.stateRoot),stateTarget=await ctx.fs.resolve(root);
      invariant(ctx.fs.contains(target,stateTarget),'LC_PERMISSION_DENIED','State root escapes workspace');
      // State is private plugin storage inside the authorized workspace, independent from paper filesystem effects.
      const s=new LocalRecordStore(root,workspaceId);await s.init();return s;})();this.stores.set(workspaceId,store);store.catch(()=>this.stores.delete(workspaceId));}
    return new LongContextEngine({store:await store,files:new DshFileAdapter(ctx,agent,this.config.maxInputBytes,this.config.stateRoot),model:new DshModelAdapter(ctx,agent,this.config.maxOutputTokens,this.config.auxiliaryModel),
      renderer:this.config.rendererExecutable?new OfficeRenderer(this.config.rendererExecutable,(await store).root,this.config.rendererFontconfigFile):undefined,identity:{workspaceId,sessionId:agent.session.id},config:{...this.config,maxToolResultCodePoints:resultBudget-500}});
  }
}
export default LongContextHub;
