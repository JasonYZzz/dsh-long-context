import {mkdir,open,readFile,readdir,link,unlink,rename,realpath,lstat,rm} from 'node:fs/promises';
import {join,dirname,resolve,relative} from 'node:path';
import {hostname} from 'node:os';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {managedSchema} from '../tasks/types.js';
import type {Anchor} from '../types.js';
import {workflowSchema,type Workflow} from '../workflows/types.js';
import {documentSchema,taskSchema,type DocumentRevision,type Task} from '../types.js';
import {canonical,hash,id,safeId} from '../util.js';
import {invariant,LcError} from '../errors.js';
import {changes,applyChanges,type Delta} from './delta.js';
export type RecordKind='tasks'|'workflows'|'managed';
export interface LedgerRecord {taskId:string;workspaceId:string;journalRevision:number;ownerSession:string;state:string;createdAt:string;}
interface Event {schemaVersion:number;revision:number;previousHash:string;requestId:string;stateHash:string;state?:unknown;delta?:Delta[];hash:string;}
interface Projection {revision:number;eventHash:string;stateHash:string;state:unknown;verified?:boolean;}
/** Durable records only. Paper I/O belongs to FilePort, never this store. */
export class LocalRecordStore {
  private dataRoot:string;
  private manifestHash:string|null=null;
  private version=3;
  private readonly projections=new Map<string,Projection>();
  private readonly eventProofs=new Map<string,{rawHash:string;header:Event}>();
  private activeIndex:{taskId:string;kind:RecordKind;createdAt:string;ownerSession:string}[]|null=null;
  private indexHash:string|null=null;
  readonly metrics={journalBytesRead:0,journalBytesWritten:0,recordReads:0,fullAudits:0,snapshotReads:0,objectWrites:0};
  constructor(readonly root:string,readonly workspaceId:string,private readonly initialVersion:2|3=3){this.dataRoot=root;}
  requireV3(){invariant(this.version===3,'LC_MIGRATION_REQUIRED','Upgrade this v2 workspace explicitly before starting general work');}
  async init():Promise<void>{
    await mkdir(this.root,{recursive:true,mode:0o700});
    invariant(!(await lstat(this.root)).isSymbolicLink(),'LC_PERMISSION_DENIED','State root cannot be a symbolic link');
    const manifestPath=join(this.root,'manifest.json');
    const manifest={schemaVersion:this.initialVersion,workspaceId:this.workspaceId,generation:1};
    try{await this.publish(manifestPath,canonical(manifest));}catch(e){if(!isExists(e))throw e;}
    const manifestText=await readFile(manifestPath,'utf8'),existing=JSON.parse(manifestText) as {schemaVersion:number;workspaceId:string;generation:number};
    invariant(existing.schemaVersion!==1,'LC_MIGRATION_REQUIRED','Schema v1 requires an explicit, backed-up migration before editing');
    invariant([2,3].includes(existing.schemaVersion)&&existing.workspaceId===this.workspaceId,'LC_STATE_CORRUPT','Unsupported schema or wrong workspace in state manifest');
    this.version=existing.schemaVersion;this.projections.clear();this.eventProofs.clear();this.activeIndex=null;this.indexHash=null;
    this.manifestHash=hash(manifestText);this.dataRoot=this.root;
    if(existing.generation>1)this.dataRoot=join(this.root,'generations',String(existing.generation));
    for(const dir of ['objects','locks'])await mkdir(join(this.root,dir),{recursive:true,mode:0o700});
    for(const dir of ['documents','tasks','workflows','managed'])await mkdir(join(this.dataRoot,dir),{recursive:true,mode:0o700});
  }
  private async syncDir(path:string):Promise<void>{const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}
  private async publish(path:string,content:string|Uint8Array):Promise<void>{
    await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=`${path}.${id('tmp')}`;
    const handle=await open(temp,'wx',0o600);try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}
    try{await link(temp,path);await this.syncDir(dirname(path));}finally{await unlink(temp).catch(()=>{});}
  }
  async putObject(content:string|Uint8Array):Promise<string>{
    const objectHash=hash(content);const path=join(this.root,'objects',objectHash);
    const bytes=typeof content==='string'?Buffer.from(content):content;
    try{await this.getBytes(objectHash);return objectHash;}catch(e){if(!(e instanceof LcError)||e.code!=='LC_STATE_CORRUPT')throw e;try{await lstat(path);throw e;}catch(error){if(!isMissing(error))throw error;}}
    // Binary source bytes are encoded losslessly; hash names refer to decoded bytes.
    try{await this.publish(path,JSON.stringify({encoding:'base64',data:Buffer.from(bytes).toString('base64')}));}catch(e){if(!isExists(e))throw e;}
    this.metrics.objectWrites++;await this.getBytes(objectHash);return objectHash;
  }
  async putArtifact(format:'pdf'|'docx',bytes:Uint8Array){
    const contentHash=hash(bytes),path=join(this.root,'artifacts',contentHash+'.'+format);
    try{await this.publish(path,bytes);}catch(e){if(!isExists(e))throw e;}
    invariant(hash(await readFile(path))===contentHash,'LC_STALE_REVISION','Cached artifact content changed');return {path,contentHash};
  }
  async verifyArtifact(format:'pdf'|'docx',contentHash:string){invariant(/^[a-f0-9]{64}$/.test(contentHash),'LC_STATE_CORRUPT','Invalid artifact hash');invariant(hash(await readFile(join(this.root,'artifacts',contentHash+'.'+format)))===contentHash,'LC_STALE_REVISION','Rendered artifact changed');}
  async getBytes(objectHash:string):Promise<Uint8Array>{
    invariant(/^[a-f0-9]{64}$/.test(objectHash),'LC_STATE_CORRUPT','Invalid object hash');
    try{const record=JSON.parse(await readFile(join(this.root,'objects',objectHash),'utf8')) as {encoding:string;data:string};
      invariant(record.encoding==='base64'&&typeof record.data==='string','LC_STATE_CORRUPT','Invalid object envelope');
      const bytes=Buffer.from(record.data,'base64');invariant(hash(bytes)===objectHash,'LC_STATE_CORRUPT','Object checksum mismatch');return bytes;
    }catch(e){if(e instanceof LcError)throw e;throw new LcError('LC_STATE_CORRUPT','Missing or unreadable immutable object',objectHash);}
  }
  async getObject(objectHash:string):Promise<string>{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await this.getBytes(objectHash));}
  private async receiptKey(){const path=join(this.root,'read-receipt.key');try{return await readFile(path);}catch(e){if(!isMissing(e))throw e;try{await this.publish(path,randomBytes(32));}catch(error){if(!isExists(error))throw error;}return readFile(path);}}
  private async seal(value:unknown):Promise<string>{const payload=Buffer.from(canonical(value)).toString('base64url');return payload+'.'+createHmac('sha256',await this.receiptKey()).update(payload).digest('hex');}
  async readReceipt(ownerSession:string,anchor:Anchor):Promise<string>{return this.seal({kind:'read',ownerSession,anchor});}
  async resultReceipt(ownerSession:string,objectHash:string):Promise<string>{return this.seal({kind:'result',ownerSession,objectHash});}
  private async unseal(token:string){
    const parts=token.split('.'),[payload,signature]=parts;invariant(parts.length===2&&payload&&signature&&/^[a-f0-9]{64}$/.test(signature),'LC_EVIDENCE_MISMATCH','Invalid receipt');
    const expected=createHmac('sha256',await this.receiptKey()).update(payload).digest();invariant(timingSafeEqual(expected,Buffer.from(signature,'hex')),'LC_EVIDENCE_MISMATCH','Receipt signature differs');return JSON.parse(Buffer.from(payload,'base64url').toString());
  }
  async verifyReadReceipt(token:string,ownerSession:string):Promise<Anchor>{
    const data=await this.unseal(token);invariant(data.kind==='read','LC_EVIDENCE_MISMATCH','Expected a read receipt');invariant(data.ownerSession===ownerSession,'LC_OWNER_CONFLICT','Read receipt belongs to another session');return data.anchor;
  }
  async verifyResultReceipt(token:string,ownerSession:string,objectHash:string){const data=await this.unseal(token);invariant(data.kind==='result'&&data.objectHash===objectHash,'LC_PERMISSION_DENIED','Result receipt does not authorize this object');invariant(data.ownerSession===ownerSession,'LC_OWNER_CONFLICT','Result receipt belongs to another session');}
  async saveDocument(document:DocumentRevision):Promise<void>{
    documentSchema.parse(document);await this.publish(join(this.dataRoot,'documents',safeId(document.revisionId)+'.json'),canonical(document));
  }
  async document(revisionId:string):Promise<DocumentRevision>{
    try{const doc=documentSchema.parse(JSON.parse(await readFile(join(this.dataRoot,'documents',safeId(revisionId)+'.json'),'utf8')));
      invariant(doc.workspaceId===this.workspaceId&&doc.revisionId===revisionId&&hash(canonical(doc.blocks))===doc.blocksHash,'LC_STATE_CORRUPT','Document manifest mismatch');
      const text=await this.getObject(doc.textHash),chars=Array.from(text);invariant(chars.length===doc.length,'LC_STATE_CORRUPT','Document length mismatch');
      let offset=0;for(const b of doc.blocks){invariant(b.revisionId===revisionId&&b.start===offset&&b.length===b.end-b.start&&hash(chars.slice(b.start,b.end).join(''))===b.contentHash,'LC_STATE_CORRUPT','Block coverage or hash mismatch');offset=b.end;}
      invariant(offset===doc.length,'LC_STATE_CORRUPT','Document coverage gap');return doc;
    }catch(e){if(e instanceof LcError)throw e;throw new LcError('LC_STATE_CORRUPT','Document is unavailable or malformed',revisionId);}
  }
  async documentIds():Promise<string[]>{return (await readdir(join(this.dataRoot,'documents'))).filter(name=>name.endsWith('.json')).sort().map(name=>safeId(name.slice(0,-5)));}
  async taskIds():Promise<string[]>{return (await readdir(join(this.dataRoot,'tasks'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>safeId(e.name));}
  async task(taskId:string,audit=true):Promise<Task|null>{return this.record('tasks',taskId,taskSchema,audit);}
  async commit(state:Task,expectedRevision:number,requestId:string):Promise<Task>{return this.commitRecord('tasks',state,expectedRevision,requestId,taskSchema);}
  async workflowIds():Promise<string[]>{return this.recordIds('workflows');}
  async workflow(taskId:string,audit=true):Promise<Workflow|null>{return this.record('workflows',taskId,workflowSchema,audit);}
  async commitWorkflow(state:Workflow,expectedRevision:number,requestId:string):Promise<Workflow>{return this.commitRecord('workflows',state,expectedRevision,requestId,workflowSchema);}
  async recordIds(kind:RecordKind):Promise<string[]>{try{return (await readdir(join(this.dataRoot,kind),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>safeId(e.name));}catch(e){if(isMissing(e))return [];throw e;}}
  private async event(path:string,headerOnly=false):Promise<Event>{
    const text=await readFile(path,'utf8');this.metrics.journalBytesRead+=Buffer.byteLength(text);
    const rawHash=hash(text),proof=this.eventProofs.get(path);if(headerOnly&&proof?.rawHash===rawHash)return proof.header;
    const raw=JSON.parse(text) as Event,{hash:eventHash,...body}=raw;
    invariant([2,3].includes(raw.schemaVersion)&&Number.isInteger(raw.revision)&&raw.revision>0&&typeof raw.previousHash==='string'&&hash(canonical(body))===eventHash,'LC_STATE_CORRUPT','Journal checksum mismatch');const {state:_state,delta:_delta,...header}=raw;this.eventProofs.set(path,{rawHash,header});return headerOnly?header:raw;
  }
  async record<T extends LedgerRecord>(kind:RecordKind,taskId:string,schema:{parse(value:unknown):T},audit=true):Promise<T|null>{
    this.metrics.recordReads++;if(audit)this.metrics.fullAudits++;
    const base=join(this.dataRoot,kind,safeId(taskId)),key=kind+'/'+taskId,dir=join(base,'journal');
    let names:string[];try{names=(await readdir(dir)).filter(n=>/^\d{10}\.json$/.test(n)).sort();}catch(e){if(isMissing(e))return null;throw e;}
    if(!names.length)return null;
    try{
      invariant(names.every((n,i)=>n===`${String(i+1).padStart(10,'0')}.json`),'LC_STATE_CORRUPT','Journal revision gap');
      const tip=await this.event(join(dir,names.at(-1)!),true);invariant(tip.revision===names.length,'LC_STATE_CORRUPT','Journal tip revision differs');
      let projection:Projection|undefined;
      const known=this.projections.get(key);
      if(audit&&known?.verified&&known.revision<=tip.revision){let previous='';for(let i=0;i<known.revision;i++){const event=await this.event(join(dir,names[i]!),true);invariant(event.revision===i+1&&event.previousHash===previous,'LC_STATE_CORRUPT','Verified prefix changed');previous=event.hash;}invariant(previous===known.eventHash,'LC_STATE_CORRUPT','Verified projection no longer matches history');projection=structuredClone(known);}
      if(!audit){
        const cached=this.projections.get(key);if(cached&&cached.revision===tip.revision&&cached.eventHash===tip.hash)return schema.parse(structuredClone(cached.state));
        if(cached&&cached.revision<tip.revision)projection=structuredClone(cached);
        if(!projection){
          let snapshots:string[]=[];try{snapshots=(await readdir(join(base,'snapshots'))).filter(n=>/^\d{10}\.json$/.test(n)).sort().reverse();}catch(e){if(!isMissing(e))throw e;}
          for(const name of snapshots){try{
            const snapshot=JSON.parse(await readFile(join(base,'snapshots',name),'utf8')) as Projection;
            invariant(snapshot.revision<=tip.revision&&name===`${String(snapshot.revision).padStart(10,'0')}.json`&&hash(canonical(snapshot.state))===snapshot.stateHash,'LC_STATE_CORRUPT','Snapshot checksum differs');
            const event=await this.event(join(dir,name),true);invariant(event.hash===snapshot.eventHash&&event.stateHash===snapshot.stateHash,'LC_STATE_CORRUPT','Snapshot journal binding differs');projection={...snapshot,verified:false};this.metrics.snapshotReads++;break;
          }catch{ /* A projection is disposable; replay verified events instead. */ }}
        }
      }
      let state:unknown=projection?.state,previousHash=projection?.eventHash??'';
      for(let i=projection?.revision??0;i<names.length;i++){
        const event=await this.event(join(dir,names[i]!));
        invariant(event.revision===i+1&&event.previousHash===previousHash,'LC_STATE_CORRUPT','Journal chain mismatch');
        invariant(Object.hasOwn(event,'state')!==Object.hasOwn(event,'delta')&&!(event.schemaVersion===2&&!Object.hasOwn(event,'state')),'LC_STATE_CORRUPT','Invalid event payload');
        state=Object.hasOwn(event,'state')?event.state:applyChanges(state,event.delta!,false);
        invariant(hash(canonical(state))===event.stateHash,'LC_STATE_CORRUPT','Journal state checksum differs');previousHash=event.hash;
      }
      const parsed=schema.parse(state);invariant(parsed.taskId===taskId&&parsed.workspaceId===this.workspaceId&&parsed.journalRevision===tip.revision,'LC_STATE_CORRUPT','Journal identity mismatch');
      if(audit){
        const cached=this.projections.get(key);if(cached&&cached.revision===tip.revision)invariant(hash(canonical(cached.state))===hash(canonical(parsed)),'LC_STATE_CORRUPT','Projection differs from replayed state');
      }
      this.projections.set(key,{revision:tip.revision,eventHash:tip.hash,stateHash:tip.stateHash,state:structuredClone(parsed),verified:audit||!projection||projection.verified===true});return parsed;
    }catch(e){if(e instanceof LcError)throw e;throw new LcError('LC_STATE_CORRUPT','Invalid journal or state schema',taskId);}
  }
  async commitRecord<T extends LedgerRecord>(kind:RecordKind,state:T,expectedRevision:number,requestId:string,schema:{parse(value:unknown):T}):Promise<T>{
    if(kind==='managed')this.requireV3();
    const current=await this.record(kind,state.taskId,schema,false);
    invariant((current?.journalRevision??0)===expectedRevision,'LC_STALE_REVISION','Ledger compare-and-swap failed',state.taskId);
    const next=schema.parse({...state,journalRevision:expectedRevision+1}),base=join(this.dataRoot,kind,safeId(state.taskId)),key=kind+'/'+state.taskId;
    const previous=current?await this.event(join(base,'journal',`${String(expectedRevision).padStart(10,'0')}.json`)):null;
    const protocol=kind==='managed'?3:this.version;
    const payload=protocol===3&&current&&previous?.schemaVersion===3?{delta:changes(current,next)}:{state:next};
    if('delta' in payload)invariant(hash(canonical(applyChanges(current,payload.delta!)))===hash(canonical(next)),'LC_STATE_CORRUPT','Incremental projection differs from committed state');
    const body={schemaVersion:protocol,revision:next.journalRevision,previousHash:previous?.hash??'',requestId,stateHash:hash(canonical(next)),...payload};
    const event={...body,hash:hash(canonical(body))},text=canonical(event);
    await this.ensureIndex(true);await this.replaceHint(join(this.dataRoot,'index-dirty'),requestId);
    await this.publish(join(base,'journal',`${String(next.journalRevision).padStart(10,'0')}.json`),text);this.metrics.journalBytesWritten+=Buffer.byteLength(text);
    const projection={revision:next.journalRevision,eventHash:event.hash,stateHash:body.stateHash,state:structuredClone(next),verified:current?this.projections.get(key)?.verified===true:true};this.projections.set(key,projection);
    if(protocol===3&&next.journalRevision%20===0){
      await this.publish(join(base,'snapshots',`${String(next.journalRevision).padStart(10,'0')}.json`),canonical(projection));
      const snapshots=(await readdir(join(base,'snapshots'))).filter(n=>/^\d{10}\.json$/.test(n)).sort();for(const name of snapshots.slice(0,-2))await unlink(join(base,'snapshots',name));
    }
    this.activeIndex=this.activeIndex!.filter(r=>r.kind!==kind||r.taskId!==state.taskId);
    if(!['completed_with_checks','cancelled','failed'].includes(next.state))this.activeIndex.push({taskId:state.taskId,kind,createdAt:state.createdAt,ownerSession:state.ownerSession});
    await this.saveIndex();await unlink(join(this.dataRoot,'index-dirty'));return next;
  }
  private async replaceHint(path:string,text:string){
    await mkdir(dirname(path),{recursive:true,mode:0o700});const temporary=path+'.'+id('tmp'),file=await open(temporary,'wx',0o600);
    try{await file.writeFile(text);await file.sync();}finally{await file.close();}await rename(temporary,path);await this.syncDir(dirname(path));
  }
  private async saveIndex(){const text=canonical({records:this.activeIndex,checksum:hash(canonical(this.activeIndex))});await this.replaceHint(join(this.dataRoot,'active-index.json'),text);this.indexHash=hash(text);}
  private async ensureIndex(repair=false){
    const path=join(this.dataRoot,'active-index.json');let dirty=false;try{await lstat(join(this.dataRoot,'index-dirty'));dirty=true;}catch(e){if(!isMissing(e))throw e;}
    if(!dirty){try{const text=await readFile(path,'utf8');if(this.activeIndex&&hash(text)===this.indexHash)return;const index=JSON.parse(text);invariant(Array.isArray(index.records)&&hash(canonical(index.records))===index.checksum,'LC_STATE_CORRUPT','Active index checksum differs');
      invariant(index.records.every((r:Record<string,unknown>)=>['tasks','workflows','managed'].includes(String(r.kind))&&typeof r.taskId==='string'&&typeof r.ownerSession==='string'&&typeof r.createdAt==='string'),'LC_STATE_CORRUPT','Invalid active index');this.activeIndex=index.records;this.indexHash=hash(text);return;
    }catch(e){if(isMissing(e)&&this.activeIndex&&!repair)return; /* Rebuild hints from authoritative records. */ }}
    this.activeIndex=[];
    for(const [kind,schema] of [['tasks',taskSchema],['workflows',workflowSchema],['managed',managedSchema]] as const)for(const taskId of await this.recordIds(kind)){
      const state=await this.record<LedgerRecord>(kind,taskId,schema,true);if(state&&!['completed_with_checks','cancelled','failed'].includes(state.state))this.activeIndex.push({kind,taskId,ownerSession:state.ownerSession,createdAt:state.createdAt});
    }
    if(repair){await this.saveIndex();if(dirty)await unlink(join(this.dataRoot,'index-dirty')).catch(()=>{});}
  }
  async activeRecords(ownerSession?:string):Promise<{taskId:string;kind:RecordKind;createdAt:string}[]>{
    await this.ensureIndex();return this.activeIndex!.filter(r=>ownerSession===undefined||r.ownerSession===ownerSession).map(({taskId,kind,createdAt})=>({taskId,kind,createdAt})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async locked<T>(operation:()=>Promise<T>):Promise<T>{
    const path=join(this.root,'locks','workspace.lock');
    try{await mkdir(path,{mode:0o700});}catch(e){
      if(!isExists(e))throw e;
      let owner:{pid:number;host:string};try{owner=JSON.parse(await readFile(join(path,'owner.json'),'utf8')) as typeof owner;}catch{throw new LcError('LC_OWNER_CONFLICT','Lock owner cannot be established; explicit recovery required');}
      let dead=false;if(owner.host===hostname()&&Number.isInteger(owner.pid)&&owner.pid>0){try{process.kill(owner.pid,0);}catch(error){dead=(error as NodeJS.ErrnoException).code==='ESRCH';}}
      invariant(dead,'LC_OWNER_CONFLICT','Workspace is being modified by another operation');
      // Rename claims a dead lock without using a timeout to steal a live one.
      const recovered=`${path}.${id('recovered')}`;try{await rename(path,recovered);await mkdir(path,{mode:0o700});}catch{throw new LcError('LC_OWNER_CONFLICT','Concurrent lock recovery; retry');}
    }
    const token=id('lock');try{
      if(this.manifestHash)invariant(hash(await readFile(join(this.root,'manifest.json'),'utf8'))===this.manifestHash,'LC_STALE_REVISION','State generation changed; reopen the store before writing');
      await this.publish(join(path,'owner.json'),canonical({pid:process.pid,host:hostname(),token}));return await operation();
    }finally{
      await rm(path,{recursive:true,force:true});
    }
  }
}
export async function validateStateRoot(workspacePath:string,stateRoot:string):Promise<string>{
  const workspace=await realpath(workspacePath),root=resolve(workspace,stateRoot),rel=relative(workspace,root);
  invariant(rel.length>0&&!rel.startsWith('..')&&!rel.startsWith('/'),'LC_PERMISSION_DENIED','State root must be a directory inside its workspace');
  let current=workspace;for(const part of rel.split('/')){current=join(current,part);try{const entry=await lstat(current);invariant(!entry.isSymbolicLink(),'LC_PERMISSION_DENIED','State root ancestors cannot be symlinks');}catch(e){if(!isMissing(e))throw e;}}
  return root;
}
export const isExists=(e:unknown):boolean=>(e as NodeJS.ErrnoException).code==='EEXIST';
export const isMissing=(e:unknown):boolean=>(e as NodeJS.ErrnoException).code==='ENOENT';
