import {resolveConfig,type Config} from './config.js';
import {invariant,LcError} from './errors.js';
import {anchor,chunk,locateQuote,readRange,validateAnchor} from './document/index.js';
import {LocalRecordStore} from './ledger/store.js';
import {scanPrompt,scanSchema,verifyPrompt,semanticSchema,PROMPT_VERSION} from './analysis/index.js';
import {makePlan,applyPlan,candidateRange} from './changes/index.js';
import {completionIssues,formatIssues,structuralIssues} from './verification/index.js';
import {checkpoint,coverage,nextOperation} from './context/index.js';
import {canonical,checkSignal,hash,id,length,mergeRanges,safeId,slice} from './util.js';
import {extractText} from '../extractors/text.js';
import type {FilePort,ModelPort} from './ports/index.js';
import type {Anchor,Audit,Command,DocumentRevision,Identity,Task,Verification} from './types.js';
export interface EngineOptions {store:LocalRecordStore;files:FilePort;model:ModelPort;config?:Partial<Config>;identity:Identity;}
export class LongContextEngine {
  readonly config:Config;
  constructor(readonly options:EngineOptions){this.config=resolveConfig(options.config);invariant(options.store.workspaceId===options.identity.workspaceId,'LC_OWNER_CONFLICT','Store and identity workspace mismatch');}
  get store(){return this.options.store;}
  private async task(taskId:string,write=false):Promise<Task>{
    const task=await this.store.task(taskId);invariant(task,'LC_INVALID_ARGUMENT','Unknown task',taskId);
    invariant(task.workspaceId===this.options.identity.workspaceId,'LC_OWNER_CONFLICT','Cross-workspace access denied');
    if(write)invariant(task.ownerSession===this.options.identity.sessionId,'LC_OWNER_CONFLICT','Session has no write ownership; explicitly resume with transferOwner');return task;
  }
  private async source(doc:DocumentRevision,signal?:AbortSignal):Promise<string>{
    const bytes=await this.options.files.read(doc.path,signal);invariant(hash(bytes)===doc.sourceHash,'LC_STALE_REVISION','Source file changed; import a new revision',doc.revisionId);
    return this.store.getObject(doc.textHash);
  }
  private async fresh(task:Task,signal?:AbortSignal):Promise<DocumentRevision>{
    const doc=await this.store.document(task.documentRevisionId);
    try{await this.source(doc,signal);
      if(task.candidate?.status==='committed')invariant(hash(await this.options.files.read(task.candidate.path,signal))===task.candidate.contentHash,'LC_STALE_REVISION','Candidate was externally modified');
    }catch(e){if(e instanceof LcError&&e.code==='LC_STALE_REVISION'){
      task.state='stale';task.reviewed=[];task.checks=[];task.attention=[e.message];await this.store.commit(task,task.journalRevision,id('stale'));
    }throw e;}return doc;
  }
  private summary(task:Task,doc:DocumentRevision){return {taskId:task.taskId,journalRevision:task.journalRevision,state:task.state,
    baseline:task.documentRevisionId,planId:task.plan?.planId??null,candidate:task.candidate,coverage:coverage(task,doc),pendingBlocks:task.goal.scope.filter(b=>!task.reviewed.includes(b)).length,
    pendingImpacts:task.impacts.filter(i=>i.status!=='resolved').length,unresolvedDependencies:task.dependencies.filter(d=>d.resolution!=='resolved').length,
    calls:task.calls,tokens:task.tokens,unknownUsage:task.unknownUsage,attention:task.attention,nextOperation:nextOperation(task)};}
  private async mutate(taskId:string,cmd:Command,action:string,payload:unknown,operation:(task:Task,doc:DocumentRevision)=>Promise<unknown>,signal?:AbortSignal,requireFresh=true,allowTransfer=false):Promise<unknown>{
    safeId(cmd.requestId);invariant(Number.isInteger(cmd.expectedLedgerRevision)&&cmd.expectedLedgerRevision>=0,'LC_INVALID_ARGUMENT','Expected revision must be an integer');
    const fingerprint=hash(canonical({action,payload}));
    return this.store.locked(async()=>{
      checkSignal(signal);const task=await this.task(taskId,!allowTransfer);const prior=task.requests[cmd.requestId];
      if(prior){invariant(prior.fingerprint===fingerprint,'LC_REQUEST_CONFLICT','requestId reused with different arguments');return prior.result;}
      invariant(task.journalRevision===cmd.expectedLedgerRevision,'LC_STALE_REVISION','Expected ledger revision differs from committed state');
      const doc=requireFresh?await this.fresh(task,signal):await this.store.document(task.documentRevisionId);
      const result=await operation(task,doc);checkSignal(signal);task.lastProgressAt=new Date().toISOString();
      // The authoritative result includes the committed revision, also on a retry.
      const output={...this.summary({...task,journalRevision:task.journalRevision+1},doc),detail:result};
      task.requests[cmd.requestId]={fingerprint,result:output};await this.store.commit(task,task.journalRevision,cmd.requestId);return output;
    });
  }
  async importDocument(input:{path:string;format?:DocumentRevision['format'];acceptedExtraction?:boolean},signal?:AbortSignal):Promise<DocumentRevision>{
    invariant(input.format!==undefined||/\.(txt|md|markdown|tex)$/i.test(input.path),'LC_FORMAT_UNSUPPORTED','Specify a supported text format; native PDF/DOCX are not plain text');
    const format=input.format??(/\.tex$/i.test(input.path)?'tex':/\.(md|markdown)$/i.test(input.path)?'md':'txt');
    invariant(format!=='pdf-text'||input.acceptedExtraction===true,'LC_EXTRACTION_INCOMPLETE','PDF text requires explicit extraction acceptance');
    const bytes=await this.options.files.read(input.path,signal);invariant(bytes.length<=this.config.maxInputBytes,'LC_BUDGET_EXCEEDED','Document exceeds configured input byte limit');
    const text=extractText(bytes,format),sourceHash=await this.store.putObject(bytes),textHash=await this.store.putObject(text),revisionId=id('rev');
    const blocks=chunk(text,revisionId,this.config);const doc:DocumentRevision={schemaVersion:1,documentId:id('doc'),revisionId,
      workspaceId:this.options.identity.workspaceId,path:input.path,sourceHash,textHash,format,extractorVersion:'text/1',extractorConfigHash:hash(canonical({encoding:'utf-8',blockTarget:this.config.blockTargetCodePoints,blockMax:this.config.blockMaxCodePoints})),
      blocksHash:hash(canonical(blocks)),blocks,length:length(text),qualityIssues:[],createdAt:new Date().toISOString()};
    await this.store.saveDocument(doc);return doc;
  }
  async read(input:{revisionId:string;blockId:string;start?:number;end?:number;cursor?:string;taskId?:string;requestId?:string;expectedLedgerRevision?:number},signal?:AbortSignal){
    const doc=await this.store.document(input.revisionId),text=await this.store.getObject(doc.textHash);
    if(input.cursor){try{await this.source(doc,signal);}catch(e){if(e instanceof LcError&&e.code==='LC_STALE_REVISION')throw new LcError('LC_STALE_CURSOR','Source changed during cursor traversal');throw e;}}
    const page=readRange(doc,text,input,this.config.maxToolResultCodePoints);
    if(input.taskId){invariant(input.requestId!==undefined&&input.expectedLedgerRevision!==undefined,'LC_INVALID_ARGUMENT','Tracked reads require CAS and requestId');
      await this.mutate(input.taskId,{requestId:input.requestId,expectedLedgerRevision:input.expectedLedgerRevision},'read',{revisionId:input.revisionId,blockId:input.blockId,start:page.anchor.start,end:page.anchor.end},async(task)=>{
        invariant(task.documentRevisionId===doc.revisionId,'LC_STALE_REVISION','Read receipt baseline mismatch');task.readRanges=mergeRanges([...task.readRanges,page.completeRange]);return {anchor:page.anchor};
      },signal);
    }
    return page;
  }
  async search(input:{revisionId:string;query:string;cursor?:string}){
    invariant(input.query.length>0,'LC_INVALID_ARGUMENT','Search query cannot be empty');
    const doc=await this.store.document(input.revisionId),text=await this.store.getObject(doc.textHash);const hits:Anchor[]=[];
    for(const b of doc.blocks){const content=slice(text,b.start,b.end);let offset=0,index:number;
      while((index=content.indexOf(input.query,offset))>=0){const start=b.start+length(content.slice(0,index));hits.push(anchor(doc,text,b.blockId,start,start+length(input.query)));offset=index+input.query.length;}}
    const cursorHash=hash(canonical({revisionId:input.revisionId,query:input.query}));let position=0;
    if(input.cursor){let cursor:{hash:string;position:number};try{cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString()) as typeof cursor;}catch{throw new LcError('LC_INVALID_ARGUMENT','Invalid search cursor');}
      invariant(cursor.hash===cursorHash,'LC_STALE_CURSOR','Search cursor query/revision changed');position=cursor.position;
      invariant(Number.isInteger(position)&&position>=0&&position<=hits.length,'LC_INVALID_ARGUMENT','Invalid search position');}
    const selected:Anchor[]=[];let next=position;
    for(;next<hits.length;next++){const proposed=[...selected,hits[next]!];if(length(JSON.stringify(proposed))>this.config.maxToolResultCodePoints-500)break;selected.push(hits[next]!);}
    return {hits:selected,total:hits.length,incomplete:next<hits.length,nextCursor:next<hits.length?Buffer.from(JSON.stringify({hash:cursorHash,position:next})).toString('base64url'):null,note:'Lexical discovery is not topic review coverage'};
  }
  async start(input:{revisionId:string;request:string;changeGoal?:string;aliases?:string[];mustPreserve?:string[];protectedAnchors?:Anchor[];scope?:string[]},cmd:Command,signal?:AbortSignal){
    safeId(cmd.requestId);invariant(cmd.expectedLedgerRevision===0,'LC_STALE_REVISION','Task start expects revision 0');
    const taskId=`task_${hash(canonical({owner:this.options.identity.sessionId,requestId:cmd.requestId})).slice(0,32)}`;
    const fingerprint=hash(canonical({action:'start',input}));
    return this.store.locked(async()=>{
      const existing=await this.store.task(taskId);if(existing){const request=existing.requests[cmd.requestId];invariant(request?.fingerprint===fingerprint,'LC_REQUEST_CONFLICT','Start requestId reused');return request.result;}
      const doc=await this.store.document(input.revisionId);await this.source(doc,signal);
      for(const otherId of await this.store.taskIds()){const other=await this.store.task(otherId);
        if(other&&!['completed_with_checks','cancelled','failed'].includes(other.state)){const otherDoc=await this.store.document(other.documentRevisionId);invariant(otherDoc.path!==doc.path,'LC_OWNER_CONFLICT','Document already has an active write task',otherId);}}
      const scope=input.scope??doc.blocks.map(b=>b.blockId);invariant(scope.length>0&&new Set(scope).size===scope.length&&scope.every(b=>doc.blocks.some(x=>x.blockId===b)),'LC_INVALID_ARGUMENT','Invalid scan scope');
      const goal={request:input.request,changeGoal:input.changeGoal??input.request,aliases:input.aliases??[],mustPreserve:input.mustPreserve??[],protectedAnchors:input.protectedAnchors??[],scope};
      invariant(input.request.trim().length>0,'LC_INVALID_ARGUMENT','Goal is required');for(const a of goal.protectedAnchors)validateAnchor(doc,await this.store.getObject(doc.textHash),a);
      const now=new Date().toISOString();const task:Task={schemaVersion:1,taskId,workspaceId:this.options.identity.workspaceId,ownerSession:this.options.identity.sessionId,documentRevisionId:doc.revisionId,
        journalRevision:0,state:'scanning',goal,goalHash:hash(canonical(goal)),reviewed:[],readRanges:[],scanPass:0,impacts:[],dependencies:[],plan:null,candidate:null,candidateHistory:[],checks:[],audits:[],calls:0,tokens:0,unknownUsage:false,
        createdAt:now,lastProgressAt:now,corrections:0,attention:[],requests:{}};
      checkpoint(task,doc,this.config.maxCheckpointCodePoints);
      const result=this.summary({...task,journalRevision:1},doc);task.requests[cmd.requestId]={fingerprint,result};await this.store.commit(task,0,cmd.requestId);return result;
    });
  }
  private checkBudget(task:Task):void{
    invariant(task.calls<this.config.maxCalls&&task.tokens<this.config.maxTokens&&Date.now()-Date.parse(task.createdAt)<this.config.maxWallMs,'LC_BUDGET_EXCEEDED','Model call/token/wall-clock budget exhausted');
  }
  private async generate<T>(task:Task,prompt:string,parse:(value:unknown)=>T,signal?:AbortSignal):Promise<T|null>{
    const inputHash=await this.store.putObject(prompt);
    for(let attempt=0;attempt<=this.config.retries;attempt++){
      try{this.checkBudget(task);}catch(e){task.state='needs_attention';task.attention.push((e as Error).message);return null;}
      checkSignal(signal);const started=Date.now(),deadline=AbortSignal.timeout(this.config.deadlineMs),fused=signal?AbortSignal.any([signal,deadline]):deadline;task.calls++;
      let audit:Audit={purpose:'analysis',promptVersion:PROMPT_VERSION,inputHash,outputHash:await this.store.putObject(''),model:'unknown',provider:'unknown',usage:null,finishReason:'error',elapsedMs:0,error:null};
      try{
        const response=await this.options.model.generate(prompt,fused);audit={...audit,model:response.model,provider:response.provider,usage:response.usage,finishReason:response.finishReason,outputHash:await this.store.putObject(response.text)};
        invariant(response.finishReason==='stop'||response.finishReason==='end-turn','LC_MODEL_INCOMPLETE',`Model ended with ${response.finishReason}`);
        fused.throwIfAborted();invariant(response.text.trim().length>0,'LC_MODEL_INCOMPLETE','Empty model output');
        const parsed=parse(JSON.parse(response.text));audit.elapsedMs=Date.now()-started;this.account(task,audit,prompt);task.audits.push(audit);return parsed;
      }catch(e){audit.error=e instanceof Error?e.message:String(e);audit.elapsedMs=Date.now()-started;this.account(task,audit,prompt);task.audits.push(audit);
        if(signal?.aborted){task.state='cancelled';task.attention=['Operation cancelled; audit persisted, no block marked reviewed'];await this.store.commit(task,task.journalRevision,id('cancel'));signal.throwIfAborted();}
      }
    }
    task.state='needs_attention';task.attention.push('Model/schema/evidence validation failed; range remains pending');return null;
  }
  private account(task:Task,audit:Audit,prompt:string):void{
    if(audit.usage)task.tokens+=audit.usage.input+audit.usage.output;
    else {task.unknownUsage=true;task.tokens+=length(prompt)+this.config.maxOutputTokens;}
  }
  async scanNext(taskId:string,cmd:Command,signal?:AbortSignal){
    return this.mutate(taskId,cmd,'scan',{},async(task,doc)=>{
      invariant(task.state==='scanning','LC_INVALID_STATE','Task must be scanning');
      const blockId=task.goal.scope.find(b=>!task.reviewed.includes(b));invariant(blockId,'LC_INVALID_STATE','All blocks have been reviewed');
      const block=doc.blocks.find(b=>b.blockId===blockId)!,text=await this.store.getObject(doc.textHash);
      const neighbors=[block.previous,block.next].filter((b):b is string=>b!==null).map(b=>doc.blocks.find(x=>x.blockId===b)!);
      const context=neighbors.map(b=>({blockId:b.blockId,text:slice(text,b.start,Math.min(b.start+500,b.end))}));
      const prompt=scanPrompt({goal:task.goal,block:{blockId,text:slice(text,block.start,block.end)},neighbors:context,knownClaims:task.impacts.slice(-20).map(i=>({claimId:i.claimId,blockId:i.anchor.blockId,evidence:i.evidence.slice(0,120)}))});
      const result=await this.generate(task,prompt,value=>{
        const parsed=scanSchema.parse(value);
        for(const item of parsed.impacts)locateQuote(doc,text,blockId,item.quote,item.start);
        for(const dep of parsed.dependencies)for(const evidence of dep.evidence){
          invariant([blockId,...context.map(c=>c.blockId)].includes(evidence.blockId),'LC_EVIDENCE_MISMATCH','Dependency evidence not visible in this request');
          const visible=evidence.blockId===blockId?slice(text,block.start,block.end):context.find(c=>c.blockId===evidence.blockId)!.text;
          invariant(visible.includes(evidence.quote),'LC_EVIDENCE_MISMATCH','Dependency quote absent from model input');locateQuote(doc,text,evidence.blockId,evidence.quote,evidence.start);
        }return parsed;
      },signal);
      if(!result)return {blockId,reviewed:false};
      task.audits.at(-1)!.purpose='scan';
      const itemIds:string[]=[];
      for(const item of result.impacts){
        const a=locateQuote(doc,text,blockId,item.quote,item.start),itemId=`item_${hash(canonical(a)).slice(0,24)}`;itemIds.push(itemId);
        const impact={itemId,anchor:a,decision:item.decision,evidence:item.quote,rationale:item.rationale,claimId:item.claimId,source:'scanner' as const,status:item.decision==='keep'?'resolved' as const:'pending' as const,replacement:item.replacement};
        task.impacts=task.impacts.filter(i=>i.itemId!==itemId);task.impacts.push(impact);
      }
      for(const dep of result.dependencies){
        const evidenceAnchors=dep.evidence.map(e=>locateQuote(doc,text,e.blockId,e.quote,e.start));
        const body={from:dep.fromClaim.replace(/[^\w-]/g,'_').slice(0,150)||'claim',to:dep.toClaim.replace(/[^\w-]/g,'_').slice(0,150)||'claim',relation:dep.relation,evidenceAnchors,kind:dep.kind,critical:dep.critical};
        const edgeId=`edge_${hash(canonical(body)).slice(0,24)}`;
        if(!task.dependencies.some(d=>d.edgeId===edgeId))task.dependencies.push({...body,edgeId,resolution:'pending',reason:dep.reason,checkedCandidateId:null});
      }
      task.readRanges=mergeRanges([...task.readRanges,{start:block.start,end:block.end}]);task.reviewed.push(blockId);
      const newAliases=result.aliases.filter(a=>!task.goal.aliases.includes(a));
      if(newAliases.length){task.goal.aliases=[...new Set([...task.goal.aliases,...newAliases])];task.goalHash=hash(canonical(task.goal));task.reviewed=[];task.scanPass++;}
      task.attention.push(...result.needsEvidence);if(result.needsEvidence.length)task.state='needs_attention';
      else if(task.reviewed.length===task.goal.scope.length)task.state='impacts_reviewed';
      return {blockId,reviewed:true,itemIds,newAliases,scanPass:task.scanPass};
    },signal);
  }
  async review(taskId:string,cmd:Command,input:{items?:{itemId:string;decision:'change'|'keep'|'uncertain';rationale:string;replacement?:string;evidence:string}[];dependencies?:{edgeId:string;resolution:'resolved'|'needs_evidence';reason:string}[]},signal?:AbortSignal){
    return this.mutate(taskId,cmd,'review',input,async(task,doc)=>{
      invariant(['scanning','impacts_reviewed','planned','candidate_created','verifying','needs_attention'].includes(task.state),'LC_INVALID_STATE','Review requires a task without a committed candidate');
      for(const update of input.items??[]){const item=task.impacts.find(i=>i.itemId===update.itemId);invariant(item,'LC_INVALID_ARGUMENT','Unknown impact');
        invariant(update.evidence===item.evidence&&update.rationale.trim().length>0,'LC_EVIDENCE_MISMATCH','Review requires exact evidence and reason');
        validateAnchor(doc,await this.store.getObject(doc.textHash),item.anchor,update.evidence);
        item.decision=update.decision;item.rationale=update.rationale;item.source='reviewer';item.status=update.decision==='keep'?'resolved':'pending';if(update.replacement!==undefined)item.replacement=update.replacement;}
      for(const update of input.dependencies??[]){const dep=task.dependencies.find(d=>d.edgeId===update.edgeId);invariant(dep&&update.reason.trim().length>0,'LC_INVALID_ARGUMENT','Dependency and reason required');dep.resolution=update.resolution;dep.reason=update.reason;dep.checkedCandidateId=null;}
      if(task.candidate){task.candidateHistory.push(task.candidate);task.candidate=null;}
      for(const impact of task.impacts)if(impact.decision==='change')impact.status='pending';
      for(const dep of task.dependencies)dep.checkedCandidateId=null;
      task.plan=null;task.checks=[];task.state=task.reviewed.length===task.goal.scope.length?'impacts_reviewed':'scanning';
      return {items:input.items?.length??0,dependencies:input.dependencies?.length??0};
    },signal);
  }
  async plan(taskId:string,cmd:Command,replacements:Record<string,string>={},signal?:AbortSignal){
    return this.mutate(taskId,cmd,'plan',replacements,async(task,doc)=>{
      invariant(['impacts_reviewed','planned'].includes(task.state)&&task.goal.scope.every(b=>task.reviewed.includes(b)),'LC_COVERAGE_INCOMPLETE','Complete topic review before planning');
      const plan=makePlan(task,doc,await this.store.getObject(doc.textHash),replacements);task.plan=plan;task.state='planned';task.checks=[];
      return {planId:plan.planId,patches:plan.patches.length,planHash:plan.hash};
    },signal);
  }
  async apply(taskId:string,cmd:Command,input:{planId:string;outputPath:string;draft?:boolean},signal?:AbortSignal):Promise<unknown>{
    const fingerprint=hash(canonical({action:'apply',payload:input}));safeId(cmd.requestId);
    return this.store.locked(async()=>{
      let task=await this.task(taskId,true);const previous=task.requests[cmd.requestId];if(previous){invariant(previous.fingerprint===fingerprint,'LC_REQUEST_CONFLICT','requestId reused');return previous.result;}
      const recovering=task.candidate?.status==='prepared'&&task.candidate.requestId===cmd.requestId;
      invariant(recovering||task.journalRevision===cmd.expectedLedgerRevision,'LC_STALE_REVISION','Expected ledger revision differs');
      const doc=await this.fresh(task,signal);invariant(task.plan&&task.plan.planId===input.planId,'LC_STALE_REVISION','Plan does not match');
      invariant(input.outputPath!==doc.path,'LC_PERMISSION_DENIED','Candidate must use a distinct file');
      invariant(task.state==='planned'||recovering,'LC_INVALID_STATE','Task must be planned');
      if(!input.draft){invariant(!doc.qualityIssues.length&&task.reviewed.length===task.goal.scope.length&&!task.attention.length,'LC_COVERAGE_INCOMPLETE','Review/extraction/evidence requirements pending');
        invariant(!task.dependencies.some(d=>d.critical&&d.resolution!=='resolved'),'LC_DEPENDENCY_UNRESOLVED','Resolve critical dependencies before formal apply');}
      const text=applyPlan(task.plan,doc,await this.store.getObject(doc.textHash)),contentHash=await this.store.putObject(text);
      if(!recovering){task.candidate={candidateRevisionId:`candidate_${contentHash.slice(0,32)}`,planId:input.planId,path:input.outputPath,contentHash,draft:input.draft??false,status:'prepared',requestId:cmd.requestId};
        task=await this.store.commit(task,task.journalRevision,cmd.requestId);}
      else invariant(task.candidate!.path===input.outputPath&&task.candidate!.contentHash===contentHash&&task.candidate!.draft===(input.draft??false),'LC_REQUEST_CONFLICT','Prepared candidate arguments differ');
      // A durable outbox exists before the filesystem side effect. On retry adopt only identical bytes.
      if(recovering){try{invariant(hash(await this.options.files.read(input.outputPath,signal))===contentHash,'LC_STALE_REVISION','Prepared candidate target has conflicting content');}
        catch(e){if(e instanceof LcError&&e.code==='LC_FILE_NOT_FOUND')await this.options.files.create(input.outputPath,text,signal);else throw e;}}
      else await this.options.files.create(input.outputPath,text,signal);
      task.candidate!.status='committed';task.state='candidate_created';task.checks=[];
      for(const item of task.impacts)if(item.decision==='change')item.status='resolved';
      // Dependency checks never carry across candidate revisions; semantic verification must reconfirm them.
      for(const dep of task.dependencies)dep.checkedCandidateId=null;
      const output={...this.summary({...task,journalRevision:task.journalRevision+1},doc),detail:{contentHash,patches:task.plan!.patches.length,diff:task.plan!.patches.map(p=>({itemId:p.itemId,start:p.anchor.start,end:p.anchor.end,beforeHash:hash(p.expectedOriginal),afterHash:hash(p.replacement)}))}};
      task.requests[cmd.requestId]={fingerprint,result:output};await this.store.commit(task,task.journalRevision,cmd.requestId);return output;
    });
  }
  async verify(taskId:string,cmd:Command,input:{candidateRevisionId:string;blockId?:string},signal?:AbortSignal){
    return this.mutate(taskId,cmd,'verify',input,async(task,doc)=>{
      invariant(task.candidate?.status==='committed'&&task.candidate.candidateRevisionId===input.candidateRevisionId,'LC_STALE_REVISION','Candidate revision mismatch');
      invariant(['candidate_created','verifying','needs_attention'].includes(task.state),'LC_INVALID_STATE','Candidate cannot be verified in this state');
      const original=await this.store.getObject(doc.textHash),candidate=await this.store.getObject(task.candidate.contentHash),candidateId=task.candidate.candidateRevisionId;
      const record=(kind:Verification['checkKind'],scope:string,result:Verification['result'],issues:string[],evidence:string[],checker='rules'):Verification=>({candidateRevisionId:candidateId,scope,checkKind:kind,checker,checkerVersion:PROMPT_VERSION,result,issues,evidence,createdAt:new Date().toISOString()});
      if(!task.checks.some(c=>c.checkKind==='structural')){const issues=structuralIssues(task,doc,original,candidate);task.checks.push(record('structural','document',issues.length?'failed':'passed',issues,[doc.textHash,task.candidate.contentHash]));
        const format=formatIssues(doc.format,candidate);task.checks.push(record('format','document',format.result,format.issues,[task.candidate.contentHash]));}
      if(this.config.semanticVerification){const blockId=input.blockId??task.goal.scope.find(b=>!task.checks.some(c=>c.checkKind==='semantic'&&c.scope===b&&c.result==='passed'));
        if(blockId){invariant(task.goal.scope.includes(blockId),'LC_INVALID_ARGUMENT','Verification block outside task scope');const block=doc.blocks.find(b=>b.blockId===blockId)!,range=candidateRange(block.start,block.end,task.plan!.patches);
          const before=slice(original,block.start,block.end),after=slice(candidate,range.start,range.end);
          const dependencies=task.dependencies.filter(d=>d.evidenceAnchors.some(a=>a.blockId===blockId));
          const dependencyEvidence=dependencies.flatMap(d=>d.evidenceAnchors).map(a=>({anchor:a,original:slice(original,a.start,a.end),candidate:slice(candidate,candidateRange(a.start,a.end,task.plan!.patches).start,candidateRange(a.start,a.end,task.plan!.patches).end)}));
          const result=await this.generate(task,verifyPrompt({goal:task.goal,blockId,original:before,candidate:after,dependencies,dependencyEvidence}),value=>{
            const parsed=semanticSchema.parse(value);invariant(parsed.evidence.every(q=>q.length>0&&(before.includes(q)||after.includes(q)||dependencyEvidence.some(e=>e.original.includes(q)||e.candidate.includes(q)))),'LC_EVIDENCE_MISMATCH','Verifier quotes must appear in original/candidate evidence');
            invariant(!parsed.passed||parsed.issues.length===0,'LC_VERIFICATION_FAILED','Passing verifier cannot include unresolved issues');return parsed;
          },signal);
          task.checks=task.checks.filter(c=>!(c.checkKind==='semantic'&&c.scope===blockId));task.checks.push(record('semantic',blockId,result?(result.passed?'passed':'failed'):'unknown',result?.issues??['Verifier did not return validated evidence'],result?.evidence??[],task.audits.at(-1)?.model??'unknown'));
          if(result)task.audits.at(-1)!.purpose='verify';
        }
        for(const dep of task.dependencies){if(dep.resolution==='resolved'&&dep.evidenceAnchors.every(a=>task.checks.some(c=>c.checkKind==='semantic'&&c.scope===a.blockId&&c.result==='passed')))dep.checkedCandidateId=candidateId;}
      }else for(const dep of task.dependencies)if(dep.resolution==='resolved')dep.checkedCandidateId=candidateId;
      if(task.state!=='needs_attention')task.state='verifying';
      return {remainingChecks:completionIssues(task,doc,this.config.semanticVerification)};
    },signal);
  }
  async finish(taskId:string,cmd:Command,candidateRevisionId:string,signal?:AbortSignal){
    return this.mutate(taskId,cmd,'finish',{candidateRevisionId},async(task,doc)=>{
      invariant(task.candidate?.candidateRevisionId===candidateRevisionId,'LC_STALE_REVISION','Candidate revision mismatch');
      const issues=completionIssues(task,doc,this.config.semanticVerification);invariant(issues.length===0,'LC_VERIFICATION_FAILED',issues.join('; '));task.state='completed_with_checks';
      return {academicReview:this.config.semanticVerification?'model_reviewed':'structural_only',checks:task.checks.length};
    },signal);
  }
  async resume(taskId:string,cmd:Command,input:{transferOwner?:boolean;acknowledgeAttention?:string[];cancel?:boolean}={},signal?:AbortSignal){
    // Ownership transfer shares the same CAS/idempotent transaction as resume.
    return this.mutate(taskId,cmd,'resume',input,async(task)=>{
      if(input.transferOwner)task.ownerSession=this.options.identity.sessionId;
      if(input.cancel){task.state='cancelled';return {cancelled:true};}
      invariant(task.state!=='stale','LC_STALE_REVISION','Import changed source as a new revision and start a replacement task; old evidence cannot be reused');
      invariant(task.state!=='completed_with_checks','LC_INVALID_STATE','Completed tasks are read-only');
      if(input.acknowledgeAttention){invariant(input.acknowledgeAttention.every(a=>task.attention.includes(a)),'LC_INVALID_ARGUMENT','Unknown attention item');task.attention=task.attention.filter(a=>!input.acknowledgeAttention!.includes(a));}
      task.state=task.candidate?.status==='committed'?'verifying':task.plan?'planned':task.reviewed.length===task.goal.scope.length?'impacts_reviewed':'scanning';
      return {resumed:true};
    },signal,!input.cancel,input.transferOwner===true);
  }
  async rollback(taskId:string,cmd:Command,candidateRevisionId:string,signal?:AbortSignal){
    const fingerprint=hash(canonical({action:'rollback',candidateRevisionId}));safeId(cmd.requestId);
    return this.store.locked(async()=>{
      let task=await this.task(taskId,true);const prior=task.requests[cmd.requestId];if(prior){invariant(prior.fingerprint===fingerprint,'LC_REQUEST_CONFLICT','requestId reused');return prior.result;}
      const recovering=task.candidate?.status==='rollback_prepared'&&task.candidate.requestId===cmd.requestId;
      invariant(recovering||task.journalRevision===cmd.expectedLedgerRevision,'LC_STALE_REVISION','Rollback CAS failed');
      invariant(task.candidate?.candidateRevisionId===candidateRevisionId&&(task.candidate.status==='committed'||recovering),'LC_STALE_REVISION','Committed candidate required');
      const doc=await this.store.document(task.documentRevisionId),baseline=await this.store.getObject(doc.textHash);
      await this.source(doc,signal);
      if(!recovering){task.candidate.status='rollback_prepared';task.candidate.requestId=cmd.requestId;task=await this.store.commit(task,task.journalRevision,cmd.requestId);}
      const currentHash=hash(await this.options.files.read(task.candidate!.path,signal));
      if(currentHash!==doc.textHash)await this.options.files.replace(task.candidate!.path,task.candidate!.contentHash,baseline,signal);
      task.candidate!.status='rolled_back';task.checks=[];task.state='planned';
      for(const impact of task.impacts)if(impact.decision==='change')impact.status='pending';
      const output={...this.summary({...task,journalRevision:task.journalRevision+1},doc),detail:{restoredBaseline:true,path:task.candidate!.path}};
      task.requests[cmd.requestId]={fingerprint,result:output};await this.store.commit(task,task.journalRevision,cmd.requestId);return output;
    });
  }
  async status(taskId:string,cursor=0){
    const task=await this.task(taskId),doc=await this.store.document(task.documentRevisionId);invariant(Number.isInteger(cursor)&&cursor>=0,'LC_INVALID_ARGUMENT','Invalid status offset');
    const entries=[...task.impacts.map(i=>({kind:'impact',value:i})),...task.dependencies.map(d=>({kind:'dependency',value:d}))];
    const selected:typeof entries=[];let next=cursor;
    const base=this.summary(task,doc);for(;next<entries.length;next++){const proposed={...base,entries:[...selected,entries[next]],nextCursor:next+1};if(length(JSON.stringify(proposed))>this.config.maxToolResultCodePoints)break;selected.push(entries[next]!);}
    invariant(next>cursor||cursor>=entries.length,'LC_RESULT_BUDGET_TOO_SMALL','An impact exceeds status budget; use lc_read and export report');
    return {...base,entries:selected,nextCursor:next<entries.length?next:null};
  }
  async activeTask():Promise<Task|null>{
    const tasks=(await Promise.all((await this.store.taskIds()).map(taskId=>this.store.task(taskId)))).filter((t):t is Task=>!!t&&t.ownerSession===this.options.identity.sessionId&&!['completed_with_checks','cancelled','failed'].includes(t.state));
    return tasks.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]??null;
  }
  async buildCheckpoint(taskId:string){const task=await this.task(taskId);return checkpoint(task,await this.store.document(task.documentRevisionId),this.config.maxCheckpointCodePoints);}
  async correction(taskId:string,signal?:AbortSignal):Promise<string|null>{
    return this.store.locked(async()=>{const task=await this.task(taskId,true);if(signal?.aborted||['needs_attention','stale','failed','cancelled','completed_with_checks'].includes(task.state)||task.corrections>=this.config.maxCorrections)return null;
      task.corrections++;await this.store.commit(task,task.journalRevision,id('correction'));return `Task ${taskId} is ${task.state}; authoritative completion requires lc_finish. Next: ${nextOperation(task)}. Read current lc_status before writing.`;});
  }
  async exportReport(taskId:string,cmd:Command,input:{outputPath:string;format?:'json'|'markdown'},signal?:AbortSignal){
    return this.mutate(taskId,cmd,'export',input,async(task,doc)=>{
      const report={schemaVersion:1,taskId:task.taskId,journalRevision:task.journalRevision+1,state:task.state,baseline:doc,candidate:task.candidate,candidateHistory:task.candidateHistory,goal:task.goal,
        coverage:coverage(task,doc),impacts:task.impacts,dependencies:task.dependencies,plan:task.plan,checks:task.checks,audits:task.audits,
        outstanding:completionIssues(task,doc,this.config.semanticVerification),academicReview:task.checks.some(c=>c.checkKind==='semantic')?'model_reviewed':'structural_only'};
      const content=input.format==='json'?JSON.stringify(report,null,2):`# Long-context task report\n\nTask: ${task.taskId}\n\nStatus: ${task.state}\n\nCoverage represents processing, not accuracy. Academic review: ${report.academicReview}.\n\n\`\`\`json\n${JSON.stringify(report,null,2)}\n\`\`\`\n`;
      const reportHash=await this.store.putObject(content);
      try{await this.options.files.create(input.outputPath,content,signal);}catch(e){if(e instanceof LcError&&e.code==='LC_TARGET_EXISTS')invariant(hash(await this.options.files.read(input.outputPath,signal))===reportHash,'LC_STALE_REVISION','Report target exists with different bytes');else throw e;}
      return {outputPath:input.outputPath,reportHash};
    },signal,false);
  }
}
