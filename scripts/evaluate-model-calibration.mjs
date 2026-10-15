import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {dshImport,project,record} from './runtime.mjs';
import {bootModel} from './model-runtime.mjs';
const directory=join(project,'evaluation/runs/model-calibration'),{ctx,shutdown,selected,assertCredentialsUnchanged}=await bootModel(directory);
const {SessionId}=await dshImport('@deepseek-ai/dsh-session'),{ToolCallId}=await dshImport('@deepseek-ai/dsh-llm');let handle,sequence=0;
const result={provider:selected.provider,model:selected.model,parameters:{reasoningEffort:selected.reasoningEffort??'route default',maxOutputTokens:8192,deadlineMs:120000},verdict:'running'};
try{
  const workspace=join(directory,'workspace');await mkdir(workspace,{recursive:true});const source=join(workspace,'source.md');await writeFile(source,'# Current method\n当前阈值为10。\n历史研究阈值为10，不应修改。\n');
  handle=await ctx.agents.create({sessionId:SessionId(`calibration-${Date.now()}`),meta:{cwd:workspace,agentPreset:'long-context'},agentOptions:{provider:selected.provider,model:selected.model},setup:async c=>{await ctx.agentPresets.mount(c,'long-context');}});
  const agent=handle.agent,engine=await ctx.longContext.engine(agent.ctx,agent);
  const tool=async(name,args)=>{const r=await agent.ctx.tools.execute({callId:ToolCallId(`calibration-${++sequence}`),name,arguments:args,agent,signal:AbortSignal.timeout(150000)});if(r.isError||!r.value?.ok)throw Error(`${name}: ${r.error?.info?.code??'failed'}`);return r.value.data;};
  const doc=await tool('lc_import',{path:source}),task=await tool('lc_task_start',{revisionId:doc.revisionId,request:'将当前阈值改为20，保留历史研究的阈值与其他所有字符',requestId:'start',expectedLedgerRevision:0});result.taskId=task.taskId;
  const cmd=async()=>({taskId:task.taskId,requestId:`step-${++sequence}`,expectedLedgerRevision:(await engine.store.task(task.taskId)).journalRevision});
  await tool('lc_scan_next',await cmd());let state=await engine.store.task(task.taskId);if(state.state!=='impacts_reviewed')throw Error('Auxiliary scan did not complete');
  const plan=await tool('lc_plan',await cmd()),candidate=await tool('lc_apply',{...await cmd(),planId:plan.planId,outputPath:join(workspace,'candidate.md')});
  await tool('lc_verify',{...await cmd(),candidateRevisionId:candidate.candidate.candidateRevisionId});await tool('lc_finish',{...await cmd(),candidateRevisionId:candidate.candidate.candidateRevisionId});
  result.exactExpected=(await readFile(candidate.candidate.path,'utf8'))==='# Current method\n当前阈值为20。\n历史研究阈值为10，不应修改。\n';result.verdict=result.exactExpected?'passed':'failed-independent-gold';
}catch(error){result.verdict='failed';result.error=String(error);}finally{
  if(handle&&result.taskId){const engine=await ctx.longContext.engine(handle.agent.ctx,handle.agent),task=await engine.store.task(result.taskId);result.audit=task.audits;result.state=task.state;}
  await assertCredentialsUnchanged();
  await record('model-calibration',result);console.log(JSON.stringify({verdict:result.verdict,provider:result.provider,model:result.model,state:result.state,error:result.error}));
  await handle?.dispose();await shutdown.shutdown(0);
}
if(result.verdict!=='passed')process.exitCode=1;
