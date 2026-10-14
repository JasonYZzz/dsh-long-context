import {BasicCompactionEngine} from '@deepseek-ai/dsh-compaction-basic';
import type {Context} from '@deepseek-ai/cordis';
import './host.js';
import {WorkflowEngine} from '../core/workflows/engine.js';
/** Inherit the host transaction, cancellation, source references, raw output and shrink gate unchanged. */
export class LongContextCompactionEngine extends BasicCompactionEngine {
  static inject=[...BasicCompactionEngine.inject,'longContext'];
  private readonly longContextCtx:Context;
  constructor(ctx:Context,config?:ConstructorParameters<typeof BasicCompactionEngine>[1]){super(ctx,config);this.longContextCtx=ctx;}
  protected override async summarize(...args:Parameters<BasicCompactionEngine['summarize']>):ReturnType<BasicCompactionEngine['summarize']>{
    const result=await super.summarize(...args),[,agent,signal]=args;
    const engine=await this.longContextCtx.longContext.engine(agent.ctx,agent),task=await engine.activeTask(),workflow=new WorkflowEngine(engine),flow=await workflow.activeTask();if(!task&&!flow)return result;
    signal?.throwIfAborted();const checkpoint=task?await engine.buildCheckpoint(task.taskId):await workflow.buildCheckpoint(flow!.taskId);
    return {...result,summary:[...result.summary,{type:'text',text:checkpoint}]};
  }
}
export default LongContextCompactionEngine;
