import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {load} from 'js-yaml';
import {dshImport} from './runtime.mjs';
const {SessionId}=await dshImport('@deepseek-ai/dsh-session');
const {ToolCallId,createUserMessage}=await dshImport('@deepseek-ai/dsh-llm');
import {boot,workspace,project,record} from './runtime.mjs';
import {AcceptanceAdapter} from './fake-adapter.mjs';
const runId=Date.now();
const {ctx,shutdown}=await boot();const handles=[];const adapter=new AcceptanceAdapter();
try{
  ctx.longContext.config.legacyTools=false;
  ctx.llm.registerAdapter(['lc-fixture'],adapter);
  const create=async(suffix,preset='long-context',cwd=workspace)=>{const handle=await ctx.agents.create({sessionId:SessionId(`mechanisms-${suffix}-${Date.now()}`),meta:{cwd,agentPreset:preset},
    agentOptions:{provider:'lc-fixture',model:'fixture',maxTokens:2048},setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,preset);}});handles.push(handle);return handle.agent;};
  const bootstrap=await create('bootstrap');assert.ok(!bootstrap.ctx.tools.schemas(bootstrap).some(t=>t.name==='lc_task_start'));ctx.longContext.config.legacyTools=true;
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
  const privateRead=await agent.ctx.tools.execute({callId:ToolCallId('private-ledger-denied'),name:'lc_import',arguments:{path:join(engine.store.root,'manifest.json'),format:'txt'},agent,signal:controller.signal});assert.equal(privateRead.isError,true);assert.equal(privateRead.error.info.code,'LC_PERMISSION_DENIED');
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
  const pressureIndex=adapter.calls.length;await speak('Controlled pressure content. '+ 'pressure history '.repeat(12000),pressure);await speak('Recent retained context. '+ 'recent evidence '.repeat(600),pressure);await speak('Next actual pressure request.',pressure);
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
  const generation=await create('generation');const flow=await tool('lc_generate_start',{goal:{title:'Controlled context recovery',outline:Array.from({length:30},(_,i)=>`Unit ${i+1}`),pages:30,revisionIds:[imported.revisionId]},requestId:'generation-start',expectedLedgerRevision:0},generation);
  const flowCommand=async()=>({taskId:flow.taskId,requestId:`flow-${++seq}`,expectedLedgerRevision:(await tool('lc_status',{taskId:flow.taskId},generation)).journalRevision});
  await tool('lc_generate_next',await flowCommand(),generation);await speak('Controlled generation history '+ 'previous chapter history '.repeat(12000),generation);const generationCompactor=ctx.agentPresets.serviceFor(generation,'compaction');assert.ok(await generationCompactor.compactNow(generation,controller.signal));assert.ok(generation.session.deriveMessages().some(m=>m.content.some(b=>b.type==='text'&&b.text.includes(flow.taskId))));const flowIndex=adapter.calls.length;await speak('Continue the generation task after manual compaction.',generation);assert.ok(adapter.calls.slice(flowIndex).filter(c=>c.purpose==='conversation').every(c=>JSON.stringify(c.messages).includes(flow.taskId)));await tool('lc_generate_next',await flowCommand(),generation);assert.equal((await tool('lc_status',{taskId:flow.taskId},generation)).total,2);
  // Default tools use the generic protocol; small Q&A does not persist a task.
  ctx.longContext.config.legacyTools=false;const genericWorkspace=join(workspace,`generic-${runId}`);await mkdir(genericWorkspace,{recursive:true});const generic=await create('generic','long-context',genericWorkspace);
  const names=generic.ctx.tools.schemas(generic).map(t=>t.name);assert.ok(names.includes('lc_work')&&!names.includes('lc_task_start'));
  const genericEngine=await ctx.longContext.engine(generic.ctx,generic),before=(await genericEngine.store.recordIds('managed')).length;
  await speak('What is 2 plus 2? Answer directly.',generic);assert.equal((await genericEngine.store.recordIds('managed')).length,before);
  let genericReceipt=await tool('lc_work',{contract:{request:'Write three short coherent parts'},units:[0,1,2].map(n=>({unitId:`part_${n}`,instruction:`Write part ${n}`})),window:{maxUnits:1},requestId:'generic-start',expectedLedgerRevision:0},generic);
  assert.equal(genericReceipt.state,'running');await speak('Controlled generic context '+ 'older context '.repeat(12000),generic);
  assert.ok(await ctx.agentPresets.serviceFor(generic,'compaction').compactNow(generic,controller.signal));
  const genericIndex=adapter.calls.length;await speak('Continue the current managed task after compression.',generic);assert.ok(adapter.calls.slice(genericIndex).filter(c=>c.purpose==='conversation').every(c=>JSON.stringify(c.messages).includes(genericReceipt.taskId)));
  for(let n=0;n<10&&genericReceipt.state==='running';n++){const current=await tool('lc_status',{taskId:genericReceipt.taskId},generic);genericReceipt=await tool('lc_continue',{taskId:current.taskId,requestId:`generic-${n}`,expectedLedgerRevision:current.journalRevision},generic);}
  assert.equal(genericReceipt.state,'completed_with_checks');
  const compatFile=join(genericWorkspace,'compat.md');await writeFile(compatFile,'Current evidence for compatibility recovery.');const legacyDoc=await genericEngine.importDocument({path:compatFile}),legacyStart=await genericEngine.start({revisionId:legacyDoc.revisionId,request:'Review old task'},{requestId:'compat-start',expectedLedgerRevision:0});
  await tool('lc_resume',{taskId:legacyStart.taskId,requestId:'compat-resume',expectedLedgerRevision:legacyStart.journalRevision},generic);assert.ok(generic.ctx.tools.schemas(generic).some(t=>t.name==='lc_scan_next'));
  const report=await record('mechanisms',{verdict:'passed',layer:'L2-controlled-provider',ids:['DOC-01/02/03','ENV-02','EDIT-04','CTX-01','CTX-02','CTX-03','CTX-04-controlled','STOP-01'],
    genericDefault:true,directAnswerWithoutTask:true,genericCompaction:true,lazyLegacyResume:true,generationCheckpoint:true,generationUnitsAfterCompaction:2,manual:!!manual,overflowSummaries:overflowCalls.filter(c=>c.purpose==='compaction').length,pressureSummaries:pressureCalls.filter(c=>c.purpose==='compaction').length,
    requestCount:adapter.calls.length,taskId,checkpoint,liveProviderOverflow:'not-run',semanticQuality:'not-evaluated'});
  // Full synthetic request envelopes are local reproducibility evidence, never user conversations.
  await writeFile(join(report,'requests.json'),JSON.stringify(adapter.calls,null,2));
  console.log(JSON.stringify({verdict:'passed',manual:true,overflow:true,pressure:true,report}));
}finally{for(const handle of handles.reverse())await handle.dispose();await shutdown.shutdown(0);}
