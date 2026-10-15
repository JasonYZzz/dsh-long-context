import {mkdir,readFile,writeFile,readdir,stat,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]??`evaluation/runs/general-performance-${Date.now()}`);await mkdir(root,{recursive:true});
const baseline=resolve('.acceptance/general-baseline');await mkdir(baseline,{recursive:true});
const archive=join(root,'baseline.tar');await writeFile(archive,execFileSync('git',['archive','a731f9c'],{maxBuffer:50_000_000}));execFileSync('tar',['-xf',archive,'-C',baseline]);
try{await symlink(resolve('node_modules'),join(baseline,'node_modules'));}catch(e){if(e.code!=='EEXIST')throw e;}
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p',join(baseline,'tsconfig.build.json')]);
const modules=[['baseline',await import(pathToFileURL(join(baseline,'dist/core/index.js')))],['managed',await import('../dist/core/index.js')]],rows=[];
const paragraph='检索结果是证据，必须先检查来源是否支持当前结论。受控文本包含Unicode字符😀、阈值ROOT=10、普通句子与很长的一行。',input=Array.from({length:100},(_,i)=>`Logical separator ${i+1}\n${paragraph.repeat(60)}\n`).join('\f');
for(const [name,core] of modules){
 const directory=join(root,name);await mkdir(directory,{recursive:true});const source=join(directory,'source.txt'),output=join(directory,'candidate.txt');await writeFile(source,input);
 const {LocalRecordStore,LongContextEngine,ManagedTaskEngine,LcError,hash}=core;let calls=0,commands=0;
 const files={read:async path=>{try{return await readFile(path);}catch(e){if(e.code==='ENOENT')throw new LcError('LC_FILE_NOT_FOUND','Missing file');throw e;}},create:async(path,text)=>{try{await writeFile(path,text,{flag:'wx'});}catch(e){if(e.code==='EEXIST')throw new LcError('LC_TARGET_EXISTS','Target exists');throw e;}},replace:async()=>{throw Error('No replacement required');}};
 const store=new LocalRecordStore(join(directory,'state'),hash(directory));await store.init();const engine=new LongContextEngine({store,files,model:{generate:async()=>{calls++;throw Error('Exact changes must be deterministic');}},identity:{workspaceId:hash(directory),sessionId:'benchmark'}}),start=performance.now(),doc=await engine.importDocument({path:source}),importMs=performance.now()-start;
 const begin=performance.now();let receipt,kind;
 if(name==='baseline'){
  receipt=await engine.start({revisionId:doc.revisionId,request:'Replace every ROOT=10 with ROOT=20',taskType:'exact',exactReplacements:[{from:'ROOT=10',to:'ROOT=20'}]},{requestId:'start',expectedLedgerRevision:0});commands++;
  const cmd=async()=>({requestId:`step-${++commands}`,expectedLedgerRevision:(await store.task(receipt.taskId)).journalRevision});
  while((await store.task(receipt.taskId)).state==='scanning')await engine.scanNext(receipt.taskId,await cmd());
  const plan=await engine.plan(receipt.taskId,await cmd());await engine.apply(receipt.taskId,await cmd(),{planId:plan.planId,outputPath:output});const candidate=(await store.task(receipt.taskId)).candidate.candidateRevisionId;await engine.verify(receipt.taskId,await cmd(),{candidateRevisionId:candidate});receipt=await engine.finish(receipt.taskId,await cmd(),candidate);kind='tasks';
 }else{receipt=await new ManagedTaskEngine(engine).begin(core.workInputSchema.parse({contract:{request:'Replace every ROOT=10 with ROOT=20',sources:[{revisionId:doc.revisionId}],output:{kind:'patches',path:output},exactReplacements:[{from:'ROOT=10',to:'ROOT=20'}]}}),{requestId:'start',expectedLedgerRevision:0});commands++;kind='managed';}
 const elapsedMs=performance.now()-begin;assert.equal(receipt.state,'completed_with_checks');assert.equal(await readFile(output,'utf8'),input.replaceAll('ROOT=10','ROOT=20'));assert.equal(await readFile(source,'utf8'),input);assert.equal(calls,0);
 const reopened=new LocalRecordStore(store.root,hash(directory));await reopened.init();const recoverStart=performance.now();const recovered=name==='baseline'?await reopened.task(receipt.taskId):await reopened.record('managed',receipt.taskId,core.managedSchema,true);assert.equal(recovered.state,'completed_with_checks');const recoveryMs=performance.now()-recoverStart;
 const journal=join(store.root,kind,receipt.taskId,'journal'),events=await readdir(journal),journalBytes=(await Promise.all(events.map(async n=>(await stat(join(journal,n))).size))).reduce((a,b)=>a+b,0);
 const row={name,sourceBytes:Buffer.byteLength(input),codePoints:Array.from(input).length,blocks:doc.blocks.length,replacements:6000,importMs:Math.round(importMs),elapsedMs:Math.round(elapsedMs),recoveryMs:Math.round(recoveryMs),journalBytes,journalEvents:events.length,mutatingCommands:commands,modelCalls:calls,metrics:store.metrics??null};rows.push(row);console.log(JSON.stringify(row));
}
const [old,current]=rows,result={verdict:'passed',scope:'One same-machine controlled sample, exact result independently asserted; no semantic quality or physical-page claim',baseline:'a731f9c',rows,improvement:{journalBytes:1-current.journalBytes/old.journalBytes,recoveryMs:1-current.recoveryMs/old.recoveryMs,elapsedMs:1-current.elapsedMs/old.elapsedMs}};
assert.ok(result.improvement.journalBytes>=.8,'Journal reduction below 80% target');assert.ok(result.improvement.recoveryMs>=.5,'Recovery reduction below 50% target');await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({report:join(root,'result.json'),improvement:result.improvement}));
