import {it,expect} from 'vitest';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ManagedTaskEngine,LocalRecordStore,LongContextEngine,hash,workInputSchema,type ModelPort,type ModelResponse} from '../../src/core/index.js';
import {MemoryFiles} from '../helpers.js';

async function setup(respond?:(prompt:string)=>unknown){
  const root=await mkdtemp(join(tmpdir(),'lc-managed-')),workspaceId=hash(root),files=new MemoryFiles(),store=new LocalRecordStore(join(root,'state'),workspaceId);await store.init();let calls=0;
  const model:ModelPort={async generate(prompt,signal):Promise<ModelResponse>{signal.throwIfAborted();calls++;const p=JSON.parse(prompt.split('Input:\n')[1]!);const value=respond?respond(prompt):prompt.includes('Independently review')?{passed:true,issues:[],unitIds:p.units.map((u:{unitId:string})=>u.unitId)}:prompt.includes('Synthesize the supplied')?{text:'Combined result',assessment:{satisfied:true,issues:[]}}:{results:p.units.map((u:{unitId:string;input:{text:string}[]})=>({unitId:u.unitId,text:u.input.length?u.input.map(i=>i.text.replaceAll('OLD','NEW')).join(''):'A short creative answer.',summary:'Processed input',citations:[],assessment:{satisfied:true,issues:[]}}))};return {text:JSON.stringify(value),provider:'fake',model:'fake/managed',usage:{input:100,output:50},finishReason:'stop'};}};
  const engine=new LongContextEngine({store,files,model,identity:{workspaceId,sessionId:'owner'},config:{blockTargetCodePoints:128,blockMaxCodePoints:160}}),managed=new ManagedTaskEngine(engine);
  return {root,files,store,engine,managed,calls:()=>calls,cleanup:()=>rm(root,{recursive:true,force:true})};
}
const command=(requestId:string,expectedLedgerRevision=0)=>({requestId,expectedLedgerRevision});

it('creates short source-free content, publishes automatically and replays without more calls',async()=>{const h=await setup();try{
  const input=workInputSchema.parse({contract:{request:'Write a short paragraph',output:{path:'answer.md'}}});
  const receipt=await h.managed.begin(input,command('create')) as {state:string;taskId:string};expect(receipt.state).toBe('completed_with_checks');expect(h.calls()).toBe(1);expect(new TextDecoder().decode(await h.files.read('answer.md'))).toContain('short creative');
  expect(await h.managed.begin(input,command('create'))).toEqual(receipt);expect(h.calls()).toBe(1);expect(h.files.writes).toBe(1);
  await expect(h.managed.begin(workInputSchema.parse({contract:{request:'Different'}}),command('create'))).rejects.toMatchObject({code:'LC_REQUEST_CONFLICT'});
}finally{await h.cleanup();}});

it('batches complete mapped ranges and uses independent review only when required',async()=>{const h=await setup();try{
  const original='OLD paragraph.\n'.repeat(30);h.files.seed('source.md',original);const doc=await h.engine.importDocument({path:'source.md'});
  let receipt=await h.managed.begin(workInputSchema.parse({contract:{request:'Change the whole source while preserving its meaning',sources:[{revisionId:doc.revisionId}],output:{path:'mapped.md'},review:'all'},window:{maxUnits:2}}),command('start')) as {state:string;taskId:string;journalRevision:number};
  for(let n=0;n<20&&receipt.state==='running';n++)receipt=await h.managed.advance(receipt.taskId,command(`next-${n}`,receipt.journalRevision),{maxUnits:2}) as typeof receipt;
  expect(receipt.state).toBe('completed_with_checks');expect(new TextDecoder().decode(await h.files.read('source.md'))).toBe(original);expect(new TextDecoder().decode(await h.files.read('mapped.md'))).not.toContain('OLD');
  const t=await h.managed.task(receipt.taskId,true);expect(t.units.every(u=>u.provided.length>0)).toBe(true);expect(t.checks.some(c=>c.method==='independent')).toBe(true);
  const reopened=new LocalRecordStore(h.store.root,h.store.workspaceId);await reopened.init();expect((await new ManagedTaskEngine(new LongContextEngine({...h.engine.options,store:reopened})).status(receipt.taskId)).state).toBe('completed_with_checks');
}finally{await h.cleanup();}});

it('submits already prepared content only with authentic complete reading receipts',async()=>{const h=await setup();try{
  h.files.seed('source.md','Original paragraph.');const doc=await h.engine.importDocument({path:'source.md'}),page=await h.engine.read({revisionId:doc.revisionId,blockId:doc.blocks[0]!.blockId});
  const prepared={result:{unitId:'u_0_0',text:'Prepared output.',summary:'Prepared',citations:[],assessment:{satisfied:true,issues:[]}},readReceipts:[page.readReceipt]};
  const receipt=await h.managed.begin(workInputSchema.parse({contract:{request:'Rewrite all input',sources:[{revisionId:doc.revisionId}]},preparedResults:[prepared]}),command('prepared')) as {state:string;taskId:string};expect(receipt.state).toBe('completed_with_checks');expect(h.calls()).toBe(0);
  const bad=await h.managed.begin(workInputSchema.parse({contract:{request:'Rewrite all input',sources:[{revisionId:doc.revisionId}]},preparedResults:[{...prepared,readReceipts:[page.readReceipt+'x']}]}),command('forged')) as {state:string};expect(bad.state).toBe('needs_attention');
}finally{await h.cleanup();}});

it('performs exact anchored changes with zero model calls and preserves the baseline',async()=>{const h=await setup();try{
  const source='OLD and OLD.\n';h.files.seed('source.md',source);const doc=await h.engine.importDocument({path:'source.md'});
  const receipt=await h.managed.begin(workInputSchema.parse({contract:{request:'Replace OLD with NEW',sources:[{revisionId:doc.revisionId}],output:{kind:'patches',path:'edited.md'},exactReplacements:[{from:'OLD',to:'NEW'}]}}),command('exact')) as {state:string};
  expect(receipt.state).toBe('completed_with_checks');expect(new TextDecoder().decode(await h.files.read('edited.md'))).toBe('NEW and NEW.\n');expect(h.calls()).toBe(0);expect(new TextDecoder().decode(await h.files.read('source.md'))).toBe(source);
}finally{await h.cleanup();}});

it('does not turn partial or false goal output into completion',async()=>{const h=await setup(prompt=>{const p=JSON.parse(prompt.split('Input:\n')[1]!);return {results:[{unitId:p.units[0].unitId,text:'Partial',summary:'Partial',assessment:{satisfied:false,issues:['Required content missing']}}]};});try{
  const receipt=await h.managed.begin(workInputSchema.parse({contract:{request:'Produce all required sections',output:{path:'incomplete.md'}}}),command('partial')) as {state:string;taskId:string};expect(receipt.state).toBe('needs_attention');expect(h.files.entries.has('incomplete.md')).toBe(false);
  const task=await h.managed.task(receipt.taskId);expect(task.checks.some(c=>!c.passed)).toBe(true);
}finally{await h.cleanup();}});

it('keeps status and long result pages bounded, detects stale sources and blocks source overwrite',async()=>{const h=await setup();try{
  h.files.seed('source.md','OLD '.repeat(100));const doc=await h.engine.importDocument({path:'source.md'});
  await expect(h.managed.begin(workInputSchema.parse({contract:{request:'Edit',sources:[{revisionId:doc.revisionId}],output:{path:'source.md'}}}),command('overwrite'))).rejects.toMatchObject({code:'LC_PERMISSION_DENIED'});
  const receipt=await h.managed.begin(workInputSchema.parse({contract:{request:'Rewrite',sources:[{revisionId:doc.revisionId}]},window:{maxUnits:1}}),command('long')) as {state:string;taskId:string;journalRevision:number};h.files.seed('source.md','Changed externally');await expect(h.managed.advance(receipt.taskId,command('stale',receipt.journalRevision))).rejects.toMatchObject({code:'LC_STALE_REVISION'});
  const task=await h.managed.task(receipt.taskId);const page=await h.managed.readResult(receipt.taskId,task.units[0]!.contentHash!);expect(JSON.stringify(page).length).toBeLessThan(7000);await expect(h.managed.readResult(receipt.taskId,'0'.repeat(64))).rejects.toMatchObject({code:'LC_PERMISSION_DENIED'});
}finally{await h.cleanup();}});

it('writes incremental events, audits the chain and falls back from a damaged snapshot',async()=>{const h=await setup();try{
  const input=workInputSchema.parse({contract:{request:'Write many distinct short parts'},units:Array.from({length:12},(_,i)=>({unitId:`u_${i}`,instruction:`Part ${i}`})),window:{maxUnits:1}});
  let receipt=await h.managed.begin(input,command('many')) as {taskId:string;state:string;journalRevision:number};for(let i=0;i<20&&receipt.state==='running';i++)receipt=await h.managed.advance(receipt.taskId,command(`part-${i}`,receipt.journalRevision),{maxUnits:1}) as typeof receipt;
  expect(receipt.state).toBe('completed_with_checks');const dir=join(h.store.root,'managed',receipt.taskId),names=await readdir(join(dir,'journal'));const event=JSON.parse(await readFile(join(dir,'journal',names.sort()[1]!),'utf8'));expect(event.schemaVersion).toBe(3);expect(event.delta).toBeDefined();
  const snapshots=await readdir(join(dir,'snapshots'));expect(snapshots.length).toBeLessThanOrEqual(2);await writeFile(join(dir,'snapshots',snapshots[0]!),'broken');
  const reopened=new LocalRecordStore(h.store.root,h.store.workspaceId);await reopened.init();expect((await reopened.record('managed',receipt.taskId,(await import('../../src/core/tasks/types.js')).managedSchema,false))!.state).toBe('completed_with_checks');
  const first=join(dir,'journal',names[0]!),raw=JSON.parse(await readFile(first,'utf8'));raw.state.contract.request='tampered';await writeFile(first,JSON.stringify(raw));await expect(h.managed.task(receipt.taskId,true)).rejects.toMatchObject({code:'LC_STATE_CORRUPT'});
}finally{await h.cleanup();}});

it('synthesizes bounded processed results and independently checks requested synthesis stages',async()=>{const h=await setup();try{
  const input=workInputSchema.parse({contract:{request:'Combine all parts into one coherent overview',output:{aggregation:'synthesize'},review:'all'},units:Array.from({length:6},(_,i)=>({unitId:`part_${i}`,instruction:`Discuss section ${i}`})),window:{maxUnits:2}});
  let r=await h.managed.begin(input,command('synthesis')) as {taskId:string;state:string;journalRevision:number};for(let n=0;n<30&&r.state==='running';n++)r=await h.managed.advance(r.taskId,command(`synth-${n}`,r.journalRevision),{maxUnits:2}) as typeof r;
  expect(r.state).toBe('completed_with_checks');const task=await h.managed.task(r.taskId,true);expect(task.reductions).toHaveLength(5);expect((await h.managed.readResult(r.taskId,task.reductions[0]!.contentHash)).text).toContain('Combined result');expect(task.reductions.every(reduction=>task.checks.some(c=>c.method==='independent'&&c.passed&&c.unitIds.includes(reduction.unitId)))).toBe(true);expect(await h.store.getObject(task.artifact!.contentHash)).toBe('Combined result');
}finally{await h.cleanup();}});

it('selects arbitrary records with only the explicitly required quantity and exact evidence',async()=>{const h=await setup(prompt=>{const p=JSON.parse(prompt.split('Input:\n')[1]!);return {results:p.units.map((u:{unitId:string;input:{anchor:unknown}[]})=>({unitId:u.unitId,items:[{key:'entry_1',decision:'include',text:'One relevant log record',reason:'Meets the requested condition',evidence:[u.input[0]!.anchor]}],summary:'Selected one record',assessment:{satisfied:true,issues:[]}}))};});try{
  h.files.seed('logs.txt','A relevant record.');const doc=await h.engine.importDocument({path:'logs.txt'});const r=await h.managed.begin(workInputSchema.parse({contract:{request:'Select one relevant log record',sources:[{revisionId:doc.revisionId}],output:{kind:'collection',minItems:1,maxItems:1},requireCitations:true}}),command('select')) as {state:string;taskId:string};expect(r.state).toBe('completed_with_checks');const task=await h.managed.task(r.taskId);expect(JSON.parse(await h.store.getObject(task.artifact!.contentHash)).included).toHaveLength(1);
}finally{await h.cleanup();}});

it('does not hold the workspace lock during a model request or accept late cancelled results',async()=>{const h=await setup();let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(resolve=>release=resolve),entered=new Promise<void>(resolve=>started=resolve);const slow=new ManagedTaskEngine(new LongContextEngine({...h.engine.options,model:{generate:async()=>{started();await waiting;return {text:JSON.stringify({results:[{unitId:'u_0',text:'Late result',summary:'Late',assessment:{satisfied:true,issues:[]}}]}),provider:'fake',model:'slow',usage:{input:10,output:10},finishReason:'stop'};}}}));try{
  const pending=slow.begin(workInputSchema.parse({contract:{request:'Slow answer',output:{path:'late.md'},budget:{maxCalls:2,maxTokens:200000,maxWallMs:60000}}}),command('slow')).catch(e=>e);await entered;
  const r=await h.managed.begin(workInputSchema.parse({contract:{request:'Independent fast answer'}}),command('fast')) as {state:string};expect(r.state).toBe('completed_with_checks');
  const active=(await h.store.activeRecords('owner')).find(t=>t.kind==='managed')!,task=await slow.task(active.taskId);await expect(slow.resume(task.taskId,command('steal',task.journalRevision))).rejects.toMatchObject({code:'LC_OWNER_CONFLICT'});
  const cancelled=await slow.resume(task.taskId,command('cancel',task.journalRevision),{cancel:true}) as {state:string;calls:number;journalRevision:number};expect(cancelled.state).toBe('cancelled');expect(cancelled.calls).toBe(2);const resumed=await slow.resume(task.taskId,command('after-cancel',cancelled.journalRevision)) as {journalRevision:number};await expect(slow.advance(task.taskId,command('no-overspend',resumed.journalRevision))).rejects.toMatchObject({code:'LC_BUDGET_EXCEEDED'});release();expect(await pending).toMatchObject({code:'LC_STALE_REVISION'});expect(h.files.entries.has('late.md')).toBe(false);
}finally{release();await h.cleanup();}});

it('invalidates actual dependents when a completed early unit is revised',async()=>{const h=await setup();try{
  const input=workInputSchema.parse({contract:{request:'Write three consistent sections'},units:[{unitId:'first',instruction:'Define the term'},{unitId:'second',instruction:'Use its definition',dependsOn:['first']},{unitId:'third',instruction:'Conclude',dependsOn:['second']}]});
  const r=await h.managed.begin(input,command('dependency')) as {taskId:string;journalRevision:number};let task=await h.managed.task(r.taskId);const firstHash=task.units[0]!.contentHash;expect(firstHash).not.toBeNull();
  await h.managed.advance(r.taskId,command('revise',r.journalRevision),{maxUnits:1,reviseUnits:[{unitId:'first',instruction:'Clarify the existing definition',input:[],evidence:[],dependsOn:[]}]});task=await h.managed.task(r.taskId);expect(task.units[1]!.contentHash).toBeNull();expect(task.units[2]!.contentHash).toBeNull();expect(task.audits.length).toBe(2);
}finally{await h.cleanup();}});

it('rejects citation loss or fabricated citations at synthesis boundaries',async()=>{for(const forged of [false,true]){const h=await setup(prompt=>{const p=JSON.parse(prompt.split('Input:\n')[1]!);return prompt.includes('Synthesize the supplied')?{text:'Unsupported synthesis',citations:forged?[{revisionId:p.units[0].result.citations[0].revisionId,start:0,end:1,textHash:'0'.repeat(64)}]:[],assessment:{satisfied:true,issues:[]}}:{results:p.units.map((u:{unitId:string;input:{anchor:unknown}[]})=>({unitId:u.unitId,text:'Supported source result',summary:'Processed',citations:[u.input[0]!.anchor],assessment:{satisfied:true,issues:[]}}))};});try{
  h.files.seed('source.md','First source paragraph.\nSecond source paragraph.');const doc=await h.engine.importDocument({path:'source.md'}),text=await h.store.getObject(doc.textHash),split=23,anchor=(start:number,end:number)=>({revisionId:doc.revisionId,start,end,textHash:hash(Array.from(text).slice(start,end).join(''))});
  const r=await h.managed.begin(workInputSchema.parse({contract:{request:'Summarize with accurate source citations',sources:[{revisionId:doc.revisionId}],requireCitations:true,output:{aggregation:'synthesize',path:'summary.md'}},units:[{unitId:'a',instruction:'First',input:[anchor(0,split)]},{unitId:'b',instruction:'Second',input:[anchor(split,doc.length)]}]}),command('cited')) as {taskId:string;journalRevision:number};
  const next=await h.managed.advance(r.taskId,command('combine',r.journalRevision)) as {state:string};expect(next.state).toBe('needs_attention');expect(h.files.entries.has('summary.md')).toBe(false);
}finally{await h.cleanup();}}});

it('detects external output edits during rendering before final completion',async()=>{const h=await setup();try{
  const engine=new LongContextEngine({...h.engine.options,renderer:{render:async()=>{h.files.seed('rendered.md','Externally edited');return {bytes:new Uint8Array([1,2,3]),pages:1,renderer:'fixture',templateHash:hash('fixture')};}}}),managed=new ManagedTaskEngine(engine);
  const r=await managed.begin(workInputSchema.parse({contract:{request:'Write a paragraph',output:{path:'rendered.md',physicalPages:1}}}),command('render-race')) as {state:string};expect(r.state).toBe('stale');
}finally{await h.cleanup();}});

it('exports and rolls back idempotently, preserving the original source',async()=>{const h=await setup();try{
  h.files.seed('source.md','OLD.');const doc=await h.engine.importDocument({path:'source.md'}),r=await h.managed.begin(workInputSchema.parse({contract:{request:'Replace OLD with NEW',sources:[{revisionId:doc.revisionId}],output:{kind:'patches',path:'candidate.md'},exactReplacements:[{from:'OLD',to:'NEW'}]}}),command('file-effects')) as {taskId:string;journalRevision:number};
  const report=await h.managed.exportReport(r.taskId,command('export',r.journalRevision),'report.json') as {journalRevision:number};expect(await h.managed.exportReport(r.taskId,command('export',r.journalRevision),'report.json')).toEqual(report);
  const rolled=await h.managed.rollback(r.taskId,command('rollback',report.journalRevision));expect(await h.managed.rollback(r.taskId,command('rollback',report.journalRevision))).toEqual(rolled);expect(new TextDecoder().decode(await h.files.read('candidate.md'))).toBe('OLD.');expect(new TextDecoder().decode(await h.files.read('source.md'))).toBe('OLD.');
}finally{await h.cleanup();}});

it('prepares many semantic units without rereading the whole source per unit',async()=>{const h=await setup();try{
  const text='OLD line.\n'.repeat(64);h.files.seed('many.md',text);const doc=await h.engine.importDocument({path:'many.md'});let reads=0;const originalRead=h.files.read.bind(h.files);h.files.read=async path=>{if(path==='many.md')reads++;return originalRead(path);};
  const units=Array.from({length:64},(_,i)=>({unitId:`row_${i}`,instruction:'Process this record',input:[{revisionId:doc.revisionId,start:i*10,end:(i+1)*10,textHash:hash('OLD line.\n')}]}));
  const r=await h.managed.begin(workInputSchema.parse({contract:{request:'Process all records',sources:[{revisionId:doc.revisionId}]},units,window:{maxUnits:1}}),command('many-inputs')) as {state:string};expect(r.state).toBe('running');expect(reads).toBeLessThanOrEqual(8);
}finally{await h.cleanup();}});

it('recovers interrupted publication and report writes without repeating completed model work',async()=>{const h=await setup();try{
  const create=h.files.create.bind(h.files);let interrupt=true;h.files.create=async(path,text)=>{await create(path,text);if(interrupt){interrupt=false;throw Error('Interrupted after file write');}};
  const r=await h.managed.begin(workInputSchema.parse({contract:{request:'Write a short paragraph',output:{path:'answer.md'}}}),command('interrupted')) as {taskId:string;journalRevision:number;state:string};expect(r.state).toBe('needs_attention');expect(h.calls()).toBe(1);
  const recovered=await h.managed.advance(r.taskId,command('recover-file',r.journalRevision),{retry:true}) as {journalRevision:number;state:string};expect(recovered.state).toBe('completed_with_checks');expect(h.calls()).toBe(1);expect(h.files.writes).toBe(1);
  interrupt=true;await expect(h.managed.exportReport(r.taskId,command('report-crash',recovered.journalRevision),'report.json')).rejects.toThrow('Interrupted');const replay=await h.managed.exportReport(r.taskId,command('report-crash',recovered.journalRevision),'report.json');expect(await h.managed.exportReport(r.taskId,command('report-crash',recovered.journalRevision),'report.json')).toEqual(replay);expect(h.files.writes).toBe(2);
}finally{await h.cleanup();}});
