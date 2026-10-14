import {mkdir,open,readFile,readdir,link,unlink,rename,realpath,lstat} from 'node:fs/promises';
import {join,dirname,resolve,relative} from 'node:path';
import {hostname} from 'node:os';
import {z} from 'zod';
import {documentSchema,taskSchema,type DocumentRevision,type Task} from '../types.js';
import {canonical,hash,id,safeId} from '../util.js';
import {invariant,LcError} from '../errors.js';
const eventSchema=z.object({schemaVersion:z.literal(1),revision:z.number().int().positive(),previousHash:z.string(),requestId:z.string(),
  stateHash:z.string(),state:taskSchema,hash:z.string()}).strict();
/** Durable records only. Paper I/O belongs to FilePort, never this store. */
export class LocalRecordStore {
  constructor(readonly root:string,readonly workspaceId:string){}
  async init():Promise<void>{
    await mkdir(this.root,{recursive:true,mode:0o700});
    invariant(!(await lstat(this.root)).isSymbolicLink(),'LC_PERMISSION_DENIED','State root cannot be a symbolic link');
    const manifestPath=join(this.root,'manifest.json');
    const manifest={schemaVersion:1,workspaceId:this.workspaceId,generation:1};
    try{await this.publish(manifestPath,canonical(manifest));}catch(e){if(!isExists(e))throw e;}
    const existing=JSON.parse(await readFile(manifestPath,'utf8')) as typeof manifest;
    invariant(existing.schemaVersion===1&&existing.workspaceId===this.workspaceId,'LC_STATE_CORRUPT','Unsupported schema or wrong workspace in state manifest');
    for(const dir of ['objects','documents','tasks','locks'])await mkdir(join(this.root,dir),{recursive:true,mode:0o700});
  }
  private async syncDir(path:string):Promise<void>{const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}
  private async publish(path:string,content:string):Promise<void>{
    await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=`${path}.${id('tmp')}`;
    const handle=await open(temp,'wx',0o600);try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}
    try{await link(temp,path);await this.syncDir(dirname(path));}finally{await unlink(temp).catch(()=>{});}
  }
  async putObject(content:string|Uint8Array):Promise<string>{
    const objectHash=hash(content);const path=join(this.root,'objects',objectHash);
    const bytes=typeof content==='string'?Buffer.from(content):content;
    // Binary source bytes are encoded losslessly; hash names refer to decoded bytes.
    try{await this.publish(path,JSON.stringify({encoding:'base64',data:Buffer.from(bytes).toString('base64')}));}catch(e){if(!isExists(e))throw e;}
    await this.getBytes(objectHash);return objectHash;
  }
  async getBytes(objectHash:string):Promise<Uint8Array>{
    invariant(/^[a-f0-9]{64}$/.test(objectHash),'LC_STATE_CORRUPT','Invalid object hash');
    try{const record=JSON.parse(await readFile(join(this.root,'objects',objectHash),'utf8')) as {encoding:string;data:string};
      invariant(record.encoding==='base64'&&typeof record.data==='string','LC_STATE_CORRUPT','Invalid object envelope');
      const bytes=Buffer.from(record.data,'base64');invariant(hash(bytes)===objectHash,'LC_STATE_CORRUPT','Object checksum mismatch');return bytes;
    }catch(e){if(e instanceof LcError)throw e;throw new LcError('LC_STATE_CORRUPT','Missing or unreadable immutable object',objectHash);}
  }
  async getObject(objectHash:string):Promise<string>{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await this.getBytes(objectHash));}
  async saveDocument(document:DocumentRevision):Promise<void>{
    documentSchema.parse(document);await this.publish(join(this.root,'documents',safeId(document.revisionId)+'.json'),canonical(document));
  }
  async document(revisionId:string):Promise<DocumentRevision>{
    try{const doc=documentSchema.parse(JSON.parse(await readFile(join(this.root,'documents',safeId(revisionId)+'.json'),'utf8')));
      invariant(doc.workspaceId===this.workspaceId&&doc.revisionId===revisionId&&hash(canonical(doc.blocks))===doc.blocksHash,'LC_STATE_CORRUPT','Document manifest mismatch');
      const text=await this.getObject(doc.textHash);invariant(Array.from(text).length===doc.length,'LC_STATE_CORRUPT','Document length mismatch');
      let offset=0;for(const b of doc.blocks){invariant(b.revisionId===revisionId&&b.start===offset&&b.length===b.end-b.start&&hash(Array.from(text).slice(b.start,b.end).join(''))===b.contentHash,'LC_STATE_CORRUPT','Block coverage or hash mismatch');offset=b.end;}
      invariant(offset===doc.length,'LC_STATE_CORRUPT','Document coverage gap');return doc;
    }catch(e){if(e instanceof LcError)throw e;throw new LcError('LC_STATE_CORRUPT','Document is unavailable or malformed',revisionId);}
  }
  async taskIds():Promise<string[]>{return (await readdir(join(this.root,'tasks'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>safeId(e.name));}
  async task(taskId:string):Promise<Task|null>{
    const dir=join(this.root,'tasks',safeId(taskId),'journal');let names:string[];
    try{names=(await readdir(dir)).filter(n=>/^\d{10}\.json$/.test(n)).sort();}catch(e){if(isMissing(e))return null;throw e;}
    let previousHash='',state:Task|null=null;
    for(let index=0;index<names.length;index++){
      try{const raw=JSON.parse(await readFile(join(dir,names[index]!), 'utf8')) as Record<string,unknown>;const event=eventSchema.parse(raw);const {hash:eventHash,...body}=raw;
        invariant(names[index]===`${String(index+1).padStart(10,'0')}.json`&&event.revision===index+1&&event.previousHash===previousHash&&hash(canonical(body))===eventHash&&hash(canonical(raw.state))===event.stateHash,'LC_STATE_CORRUPT','Journal chain mismatch',taskId);
        invariant(event.state.taskId===taskId&&event.state.workspaceId===this.workspaceId&&event.state.journalRevision===event.revision,'LC_STATE_CORRUPT','Journal identity mismatch',taskId);
        previousHash=event.hash;state=event.state;
      }catch(e){if(e instanceof LcError)throw e;throw new LcError('LC_STATE_CORRUPT','Invalid journal schema',taskId);}
    }return state;
  }
  async commit(state:Task,expectedRevision:number,requestId:string):Promise<Task>{
    const current=await this.task(state.taskId);
    invariant((current?.journalRevision??0)===expectedRevision,'LC_STALE_REVISION','Ledger compare-and-swap failed',state.taskId);
    const next=taskSchema.parse({...state,journalRevision:expectedRevision+1});
    let previousHash='';if(expectedRevision>0){const prior=JSON.parse(await readFile(join(this.root,'tasks',safeId(state.taskId),'journal',`${String(expectedRevision).padStart(10,'0')}.json`),'utf8')) as {hash:string};previousHash=prior.hash;}
    const body={schemaVersion:1,revision:next.journalRevision,previousHash,requestId,stateHash:hash(canonical(next)),state:next};
    await this.publish(join(this.root,'tasks',safeId(state.taskId),'journal',`${String(next.journalRevision).padStart(10,'0')}.json`),canonical({...body,hash:hash(canonical(body))}));
    // Snapshots are optional acceleration; recovery always validates the journal.
    if(next.journalRevision%20===0) await this.publish(join(this.root,'tasks',safeId(state.taskId),'snapshots',`${next.journalRevision}.json`),canonical(next)).catch(()=>{});
    return next;
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
      await this.publish(join(path,'owner.json'),canonical({pid:process.pid,host:hostname(),token}));return await operation();
    }finally{
      const {rm}=await import('node:fs/promises');await rm(path,{recursive:true,force:true});
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
