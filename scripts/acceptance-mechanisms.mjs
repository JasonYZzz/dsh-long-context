import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {load} from 'js-yaml';
import {SessionId} from '@deepseek-ai/dsh-session';
import {ToolCallId,createUserMessage} from '@deepseek-ai/dsh-llm';
import {boot,workspace,project,record} from './runtime.mjs';
import {AcceptanceAdapter} from './fake-adapter.mjs';
const runId=Date.now();
const {ctx,shutdown}=await boot();const handles=[];const adapter=new AcceptanceAdapter();
try{
  ctx.llm.registerAdapter(['lc-fixture'],adapter);
  const create=async(suffix,preset='long-context',cwd=workspace)=>{const handle=await ctx.agents.create({sessionId:SessionId(`mechanisms-${suffix}-${Date.now()}`),meta:{cwd,agentPreset:preset},
    agentOptions:{provider:'lc-fixture',model:'fixture',maxTokens:2048},setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,preset);}});handles.push(handle);return handle.agent;};
  const agent=await create('A'),controller=new AbortController();let seq=0;
  const tool=async(name,args,who=agent)=>{const result=await who.ctx.tools.execute({callId:ToolCallId(`mechanism-${++seq}`),name,arguments:args,agent:who,signal:controller.signal});
    assert.equal(result.isError,false,JSON.stringify(result));assert.equal(result.value.ok,true,JSON.stringify(result.value));return result.value.data;};
  const file=join(workspace,`mechanisms-${runId}.md`);await writeFile(file,'# Mechanism source\n当前阈值为10。\n'+'Long Unicode 😀 evidence. '.repeat(700));
  const imported=await tool('lc_import',{path:file});const started=await tool('lc_task_start',{revisionId:imported.revisionId,request:'Update current threshold to 20; preserve historical statements',requestId:'start',expectedLedgerRevision:0});
  const taskId=started.taskId;
  let cursor=null,read='';const manifest=await tool('lc_inspect',{revisionId:imported.revisionId});
  for(const block of manifest.blocks){do{const page=await tool('lc_read',{revisionId:imported.revisionId,blockId:block.blockId,...cursor?{cursor}:{}});read+=page.text;cursor=page.nextCursor;}while(cursor);}
  assert.equal(read,await readFile(file,'utf8'));
  const observer=await create('observer');const denied=await observer.ctx.tools.execute({callId:ToolCallId('owner-conflict'),name:'lc_scan_next',arguments:{taskId,requestId:'forbidden',expectedLedgerRevision:1},agent:observer,signal:controller.signal});assert.equal(denied.isError,true);assert.equal(denied.error.info.code,'LC_OWNER_CONFLICT');
  const otherWorkspace=join(workspace,'other');await mkdir(otherWorkspace,{recursive:true});const other=await create('other','long-context',otherWorkspace);
  const cross=await other.ctx.tools.execute({callId:ToolCallId('cross-workspace'),name:'lc_read',arguments:{revisionId:imported.revisionId,blockId:manifest.blocks[0].blockId},agent:other,signal:controller.signal});assert.equal(cross.isError,true);assert.equal(cross.error.info.code,'LC_STATE_CORRUPT');
  const forbidden=await agent.ctx.tools.execute({callId:ToolCallId('no-shell'),name:'bash',arguments:{command:'echo forbidden'},agent,signal:controller.signal});assert.equal(forbidden.isError,true);
  const speak=async(text,who=agent)=>{who.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text}]}));await who.whenIdle();};
  const first=adapter.calls.length;
  await speak('Controlled pressure fixture (not paper evidence). '+ 'history context '.repeat(14000));
  const conversation=adapter.calls.slice(first).filter(c=>c.purpose==='conversation');assert.ok(conversation.length>0);
  assert.ok(conversation.every(c=>JSON.stringify(c.messages).includes(taskId)),'pre-step checkpoint absent from a real request');
  const engine=await ctx.longContext.engine(agent.ctx,agent),checkpoint=await engine.buildCheckpoint(taskId);
  const compaction=ctx.agentPresets.serviceFor(agent,'compaction');assert.ok(compaction);
  const manual=await compaction.compactNow(agent,controller.signal);assert.ok(manual,'manual compaction did not replace a region');
  assert.ok(agent.session.deriveMessages().some(m=>m.content.some(b=>b.type==='text'&&b.text.includes(checkpoint))),'checkpoint missing from actual replacement summary');
  const manualIndex=adapter.calls.length;await speak('Continue after manual compaction.');assert.ok(adapter.calls.slice(manualIndex).filter(c=>c.purpose==='conversation').every(c=>JSON.stringify(c.messages).includes(taskId)));
  await speak('Controlled overflow source (not paper evidence). '+ 'overflow history '.repeat(12000));
  adapter.overflowNext=true;const overflowIndex=adapter.calls.length;await speak('Trigger the controlled provider overflow once.');
  const overflowCalls=adapter.calls.slice(overflowIndex);assert.ok(overflowCalls.some(c=>c.purpose==='compaction'),'overflow recovery did not summarize');
  assert.ok(overflowCalls.filter(c=>c.purpose==='conversation').length>=2,'overflow did not issue an immediate retry');
  assert.ok(overflowCalls.filter(c=>c.purpose==='conversation').every(c=>JSON.stringify(c.messages).includes(taskId)),'overflow retry lost checkpoint');
  // A separate preset uses a declared pressure configuration; the original preset/default are unchanged.
  const layer=load(await readFile(join(project,'bundle','long-context.preset.patch.yml'),'utf8')),plugins=structuredClone(layer[0].insert[0].config.plugins);
  plugins.find(p=>p.id==='long-context-compaction').config.find(p=>p.id==='compaction-long-context').config={thresholdRatio:.1,headroomTokens:1000,retainTokens:1000,maxTokens:2048,compactionRetries:1};
  await ctx.agentPresets.register({id:'lc-pressure',plugins});const pressure=await create('pressure','lc-pressure');
  const pressureEngine=await ctx.longContext.engine(pressure.ctx,pressure);const pressureFile=join(workspace,`pressure-${runId}.md`);await writeFile(pressureFile,'Current evidence for a separate task.');
  const pressureDoc=await pressureEngine.importDocument({path:pressureFile});const pressureTask=await pressureEngine.start({revisionId:pressureDoc.revisionId,request:'Review evidence'},{requestId:'pressure-start',expectedLedgerRevision:0});
  const pressureIndex=adapter.calls.length;await speak('Controlled pressure content. '+ 'pressure history '.repeat(12000),pressure);await speak('Next actual pressure request.',pressure);
  const pressureCalls=adapter.calls.slice(pressureIndex);assert.ok(pressureCalls.some(c=>c.purpose==='compaction'),'pressure did not trigger compaction');assert.ok(pressureCalls.filter(c=>c.purpose==='conversation').every(c=>JSON.stringify(c.messages).includes(pressureTask.taskId)));
  // Complete the managed text workflow through the actual ToolRuntime after compression.
  const command=async()=>({taskId,requestId:`workflow-${++seq}`,expectedLedgerRevision:(await tool('lc_status',{taskId})).journalRevision});
  while((await tool('lc_status',{taskId})).state==='scanning')await tool('lc_scan_next',await command());
  const planned=await tool('lc_plan',await command());
  const applied=await tool('lc_apply',{...await command(),planId:planned.planId,outputPath:join(workspace,`candidate-${runId}.md`)});
  for(const block of manifest.blocks)await tool('lc_verify',{...await command(),candidateRevisionId:applied.candidate.candidateRevisionId,blockId:block.blockId});
  const finished=await tool('lc_finish',{...await command(),candidateRevisionId:applied.candidate.candidateRevisionId});assert.equal(finished.state,'completed_with_checks');
  assert.ok((await readFile(applied.candidate.path,'utf8')).includes('当前阈值为20。'));assert.ok((await readFile(file,'utf8')).includes('当前阈值为10。'));
  await tool('lc_export_report',{...await command(),format:'json',outputPath:join(workspace,`report-${runId}.json`)});
  const report=await record('mechanisms',{verdict:'passed',layer:'L2-controlled-provider',ids:['DOC-01/02/03','ENV-02','EDIT-04','CTX-01','CTX-02','CTX-03','CTX-04-controlled','STOP-01'],
    manual:!!manual,overflowSummaries:overflowCalls.filter(c=>c.purpose==='compaction').length,pressureSummaries:pressureCalls.filter(c=>c.purpose==='compaction').length,
    requestCount:adapter.calls.length,taskId,checkpoint,liveProviderOverflow:'not-run',semanticQuality:'not-evaluated'});
  // Full synthetic request envelopes are local reproducibility evidence, never user conversations.
  await writeFile(join(report,'requests.json'),JSON.stringify(adapter.calls,null,2));
  console.log(JSON.stringify({verdict:'passed',manual:true,overflow:true,pressure:true,report}));
}finally{for(const handle of handles.reverse())await handle.dispose();await shutdown.shutdown(0);}
