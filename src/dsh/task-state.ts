import type {LongContextEngine} from '../core/engine.js';
import {ManagedTaskEngine} from '../core/tasks/engine.js';
import {WorkflowEngine} from '../core/workflows/engine.js';
import {canonical,hash} from '../core/util.js';

export async function activeTaskState(engine:LongContextEngine){
  const records=await engine.store.activeRecords(engine.options.identity.sessionId);
  for(const ref of records){
    if(ref.kind==='managed'){const executor=new ManagedTaskEngine(engine),t=await executor.task(ref.taskId);if(['completed_with_checks','cancelled'].includes(t.state))continue;return {taskId:t.taskId,state:t.state,key:hash(canonical([t.taskId,t.state,t.contract.request])),checkpoint:await executor.buildCheckpoint(t.taskId),kind:'managed' as const};}
    if(ref.kind==='tasks'){const t=await engine.store.task(ref.taskId,false);if(!t||['completed_with_checks','cancelled','failed'].includes(t.state))continue;return {taskId:t.taskId,state:t.state,key:hash(canonical([t.taskId,t.state,t.goalHash])),checkpoint:await engine.buildCheckpoint(t.taskId),kind:'edit' as const};}
    const executor=new WorkflowEngine(engine),t=await executor.task(ref.taskId);if(['completed_with_checks','cancelled'].includes(t.state))continue;return {taskId:t.taskId,state:t.state,key:hash(canonical([t.taskId,t.state,t.taskKind])),checkpoint:await executor.buildCheckpoint(t.taskId),kind:'workflow' as const};
  }
  return null;
}
