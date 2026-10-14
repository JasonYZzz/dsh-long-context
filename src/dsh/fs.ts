import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import {FsError} from '@deepseek-ai/dsh-fs';
import type {} from '@deepseek-ai/dsh-sandbox-policy';
import type {FilePort} from '../core/ports/index.js';
import {hash} from '../core/util.js';
import {invariant,LcError} from '../core/errors.js';
export class DshFileAdapter implements FilePort {
  constructor(private readonly ctx:Context,private readonly agent:Agent,private readonly maxBytes:number,private readonly stateRoot='.dsh-long-context'){}
  async canonical(path:string,signal?:AbortSignal):Promise<string>{return (await this.target(path,signal)).displayPath;}
  private async target(path:string,signal?:AbortSignal){
    const cwd=this.agent.session.header.cwd;invariant(cwd,'LC_PERMISSION_DENIED','Session must have an explicit workspace');
    const root=await this.ctx.fs.resolve(cwd,{signal}),target=await this.ctx.fs.resolve(path,{cwd,signal});
    invariant(this.ctx.fs.contains(root,target),'LC_PERMISSION_DENIED','Document/output must be inside the session workspace');
    const state=await this.ctx.fs.resolve(this.stateRoot,{cwd,signal});invariant(!this.ctx.fs.contains(state,target),'LC_PERMISSION_DENIED','Managed ledger paths are private; choose a document path outside stateRoot');return target;
  }
  async read(path:string,signal?:AbortSignal):Promise<Uint8Array>{
    try{const target=await this.target(path,signal);return await this.ctx.fs.readBytes(target,signal,this.maxBytes);}catch(e){throw mapFsError(e);}
  }
  private policy(){
    const service=this.ctx.get('sandboxPolicy');
    invariant(this.ctx.fs.sandboxMode===undefined||service,'LC_PERMISSION_DENIED','Sandbox policy is missing');return service?.resolve({session:this.agent.session});
  }
  async create(path:string,text:string,signal?:AbortSignal):Promise<void>{
    try{const target=await this.target(path,signal);await this.ctx.fs.writeText(target,text,{kind:'createIfAbsent'},signal,this.policy());}catch(e){throw mapFsError(e);}
  }
  async replace(path:string,expectedHash:string,text:string,signal?:AbortSignal):Promise<void>{
    try{const target=await this.target(path,signal),info=await this.ctx.fs.stat(target,signal);
      invariant(info&&hash(await this.ctx.fs.readBytes(target,signal,this.maxBytes))===expectedHash,'LC_STALE_REVISION','Output content no longer matches managed candidate');
      await this.ctx.fs.writeText(target,text,{kind:'replaceIfVersion',version:info.version},signal,this.policy());
    }catch(e){throw mapFsError(e);}
  }
}
function mapFsError(e:unknown):unknown{
  if(e instanceof FsError){if(e.code==='FS_NOT_FOUND')return new LcError('LC_FILE_NOT_FOUND',e.message);
    if(e.code==='FS_NOT_OBSERVED')return new LcError('LC_TARGET_EXISTS','Target exists; choose a new output path');
    if(e.code==='FS_TOO_LARGE')return new LcError('LC_BUDGET_EXCEEDED',e.message);
    if(e.code==='FS_STALE_VERSION')return new LcError('LC_STALE_REVISION',e.message);
    if(e.code==='FS_SANDBOX_DENIED'||e.code==='FS_PERMISSION_DENIED')return new LcError('LC_PERMISSION_DENIED',e.message);}
  return e;
}
