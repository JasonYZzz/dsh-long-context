import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalRecordStore,LongContextEngine,LcError,hash,type FilePort,type ModelPort,type ModelResponse,type Config} from '../src/core/index.js';
export class MemoryFiles implements FilePort {
  entries=new Map<string,Uint8Array>();
  writes=0;failCreate=false;
  seed(path:string,text:string){this.entries.set(path,Buffer.from(text));}
  async read(path:string){const bytes=this.entries.get(path);if(!bytes)throw new LcError('LC_FILE_NOT_FOUND','Missing file');return bytes;}
  async create(path:string,text:string){if(this.failCreate)throw new Error('Simulated process interruption');if(this.entries.has(path))throw new LcError('LC_TARGET_EXISTS','Exists');this.seed(path,text);this.writes++;}
  async replace(path:string,expectedHash:string,text:string){if(hash(await this.read(path))!==expectedHash)throw new LcError('LC_STALE_REVISION','Changed');this.seed(path,text);this.writes++;}
}
export class FakeModel implements ModelPort {
  calls=0;
  constructor(readonly respond:(input:string,call:number)=>string = input=>{
    const payload=JSON.parse(input.split('Input:\n')[1]!) as {block?:{text:string};original?:string;candidate?:string};
    if(payload.block){const text=payload.block.text,quote='当前阈值为10。';return JSON.stringify({impacts:text.includes(quote)?[{quote,start:Array.from(text.slice(0,text.indexOf(quote))).length,decision:'change',rationale:'Update requested threshold',claimId:'threshold',replacement:'当前阈值为20。'}]:[],aliases:[],dependencies:[],needsEvidence:[]});}
    return JSON.stringify({passed:true,issues:[],evidence:[payload.candidate!.slice(0,20)]});
  }){}
  async generate(input:string,signal:AbortSignal):Promise<ModelResponse>{signal.throwIfAborted();return {text:this.respond(input,++this.calls),provider:'fake',model:'fake/1',usage:{input:100,output:50},finishReason:'stop'};}
}
export async function harness(text='当前阈值为10。\n历史研究的阈值为10。\n',config:Partial<Config>={},model=new FakeModel()){
  const root=await mkdtemp(join(tmpdir(),'lc-tests-')),workspaceId=hash(root),files=new MemoryFiles();files.seed('paper.md',text);
  const store=new LocalRecordStore(join(root,'.state'),workspaceId);await store.init();
  const engine=new LongContextEngine({store,files,model,identity:{workspaceId,sessionId:'session-A'},config});
  const doc=await engine.importDocument({path:'paper.md'});
  const start=await engine.start({revisionId:doc.revisionId,request:'将当前阈值改为20，保留历史研究'}, {requestId:'start',expectedLedgerRevision:0}) as {taskId:string};
  let sequence=0;
  const command=async()=>({requestId:`request_${++sequence}`,expectedLedgerRevision:(await store.task(start.taskId))!.journalRevision});
  const scanAll=async()=>{for(let i=0;i<1000;i++){const t=(await store.task(start.taskId))!;if(t.state!=='scanning')return t;await engine.scanNext(start.taskId,await command());}throw new Error('Unbounded scan loop');};
  const candidate=async()=>{await scanAll();await engine.plan(start.taskId,await command());const plan=(await store.task(start.taskId))!.plan!;
    await engine.apply(start.taskId,await command(),{planId:plan.planId,outputPath:'candidate.md'});return (await store.task(start.taskId))!.candidate!;};
  return {root,workspaceId,store,files,model,engine,doc,taskId:start.taskId,command,scanAll,candidate,cleanup:()=>rm(root,{recursive:true,force:true})};
}
