import {BasicCompactionEngine} from '@deepseek-ai/dsh-compaction-basic';
import type {Context} from '@deepseek-ai/cordis';
import './host.js';
import {activeTaskState} from './task-state.js';
/** Inherit the host transaction, cancellation, source references, raw output and shrink gate unchanged. */
export class LongContextCompactionEngine extends BasicCompactionEngine {
  static inject=[...BasicCompactionEngine.inject,'longContext'];
  private readonly longContextCtx:Context;
  constructor(ctx:Context,config?:ConstructorParameters<typeof BasicCompactionEngine>[1]){super(ctx,config);this.longContextCtx=ctx;}
  protected override async summarize(...args:Parameters<BasicCompactionEngine['summarize']>):ReturnType<BasicCompactionEngine['summarize']>{
    const result=await super.summarize(...args),[,agent,signal]=args;
    const engine=await this.longContextCtx.longContext.engine(agent.ctx,agent),state=await activeTaskState(engine);if(!state)return result;
    signal?.throwIfAborted();const checkpoint=`<long-context-current key="${state.key}">\n${state.checkpoint}\n</long-context-current>`;
    return {...result,summary:[...result.summary,{type:'text',text:checkpoint}]};
  }
}
export default LongContextCompactionEngine;
