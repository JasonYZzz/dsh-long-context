import {readFile,readdir,mkdir,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {LocalRecordStore} from './store.js';
import {canonical,hash,id} from '../util.js';
import {documentSchema,taskSchema} from '../types.js';
import {definitionAnchors} from '../context/evidence.js';
import {invariant} from '../errors.js';
/** Explicit copy-on-write migration; immutable v1 evidence and journals remain intact. */
export async function migrateV1(store:LocalRecordStore){
  const manifestPath=join(store.root,'manifest.json'),manifestBytes=await readFile(manifestPath,'utf8');
  const manifest=JSON.parse(manifestBytes) as {schemaVersion:number;workspaceId:string;generation:number};
  invariant(manifest.workspaceId===store.workspaceId&&manifest.schemaVersion===1&&manifest.generation===1,'LC_MIGRATION_REQUIRED','Migration expects this workspace schema v1 generation 1');
  await mkdir(join(store.root,'locks'),{recursive:true,mode:0o700});
  return store.locked(async()=>{
    invariant(await readFile(manifestPath,'utf8')===manifestBytes,'LC_STALE_REVISION','State manifest changed before migration');
    const backup=join(store.root,'migration-v1-manifest.json');try{const handle=await open(backup,'wx',0o600);try{await handle.writeFile(manifestBytes);await handle.sync();}finally{await handle.close();}}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;invariant(await readFile(backup,'utf8')===manifestBytes,'LC_STATE_CORRUPT','Migration backup differs');}
    const target=join(store.root,'generations','2');
    await mkdir(target,{recursive:true,mode:0o700});
    // Remove only an uncommitted migration generation while the v1 manifest still owns the workspace.
    for(const entry of await readdir(target))await rm(join(target,entry),{recursive:true,force:true});
    const migrated=new LocalRecordStore(target,store.workspaceId);await migrated.init();
    const docs=new Map<string,ReturnType<typeof documentSchema.parse>>(),texts=new Map<string,string[]>();
    for(const filename of await readdir(join(store.root,'documents'))){
      if(!filename.endsWith('.json'))continue;
      const old=JSON.parse(await readFile(join(store.root,'documents',filename),'utf8'));
      invariant(old.schemaVersion===1&&old.workspaceId===store.workspaceId&&old.blocksHash===hash(canonical(old.blocks)),'LC_STATE_CORRUPT','Invalid v1 document');
      for(const h of [old.sourceHash,old.textHash])await migrated.putObject(await store.getBytes(h));
      const doc=documentSchema.parse({...old,schemaVersion:2});doc.definitions=definitionAnchors(doc,await store.getObject(doc.textHash));await migrated.saveDocument(doc);await migrated.document(doc.revisionId);docs.set(doc.revisionId,doc);texts.set(doc.revisionId,Array.from(await migrated.getObject(doc.textHash)));
    }
    const convertAnchor=(a:{revisionId:string;blockId:string;start:number;end:number;textHash:string})=>{
      const doc=docs.get(a.revisionId),block=doc?.blocks.find(b=>b.blockId===a.blockId);
      invariant(block&&a.start>=block.start&&a.end<=block.end&&a.end>=a.start,'LC_STATE_CORRUPT','Invalid legacy anchor');
      invariant(hash(texts.get(a.revisionId)!.slice(a.start,a.end).join(''))===a.textHash,'LC_STATE_CORRUPT','Legacy anchor content hash mismatch');
      const {blockId:_blockId,...result}=a;return result;
    };
    let tasks=0;
    for(const taskId of await store.taskIds()){
      const journal=join(store.root,'tasks',taskId,'journal'),names=(await readdir(journal)).filter(n=>/^\d{10}\.json$/.test(n)).sort();
      let previousHash='',state;
      for(let i=0;i<names.length;i++){
        const raw=JSON.parse(await readFile(join(journal,names[i]!),'utf8')),eventHash=raw.hash,{hash:_eventHash,...body}=raw;
        invariant(raw.schemaVersion===1&&raw.revision===i+1&&names[i]===`${String(i+1).padStart(10,'0')}.json`&&raw.previousHash===previousHash&&hash(canonical(body))===eventHash&&hash(canonical(raw.state))===raw.stateHash,'LC_STATE_CORRUPT','Legacy journal chain failed');
        invariant(raw.state.taskId===taskId&&raw.state.workspaceId===store.workspaceId&&raw.state.journalRevision===raw.revision,'LC_STATE_CORRUPT','Legacy task identity failed');
        state=raw.state;previousHash=eventHash;
      }
      if(!state)continue;
      invariant(state.goalHash===hash(canonical(state.goal)),'LC_STATE_CORRUPT','Legacy goal checksum mismatch');
      const goal={...state.goal,taskType:'semantic',exactReplacements:[],rootChanges:[],protectedAnchors:state.goal.protectedAnchors.map(convertAnchor)};
      const goalHash=hash(canonical(goal));
      const impacts=state.impacts.map((item:{anchor:Parameters<typeof convertAnchor>[0]})=>({...item,anchor:convertAnchor(item.anchor)}));
      const dependencies=state.dependencies.map((edge:{evidenceAnchors:Parameters<typeof convertAnchor>[0][]})=>({...edge,evidenceAnchors:edge.evidenceAnchors.map(convertAnchor),checkedCandidateId:null}));
      const plan=state.plan?{...state.plan,goalHash,patches:state.plan.patches.map((patch:{anchor:Parameters<typeof convertAnchor>[0];hash:string})=>{const {hash:_hash,...body}=patch;const next={...body,anchor:convertAnchor(patch.anchor)};return {...next,hash:hash(canonical(next))};})}:null;
      if(plan){const {hash:_hash,...body}=plan;plan.hash=hash(canonical(body));}
      const next=taskSchema.parse({...state,schemaVersion:2,legacyChecks:state.state==='completed_with_checks',goal,goalHash,impacts,dependencies,plan,checks:[]});
      for(const audit of next.audits)for(const h of [audit.inputHash,audit.outputHash])await migrated.putObject(await store.getBytes(h));
      for(const candidate of [...next.candidateHistory,...next.candidate?[next.candidate]:[]])await migrated.putObject(await store.getBytes(candidate.contentHash));
      // Preserve every requestId/fingerprint; cached v1 results remain replayable, never re-executed.
      // A migration event starts the v2 chain; current CAS is exposed by lc_status.
      const migratedState={...next,journalRevision:0,requests:state.requests};
      if(next.state!=='completed_with_checks'&&next.state!=='cancelled'&&next.state!=='failed'){
        migratedState.reviewed=[];migratedState.state='scanning';migratedState.plan=null;
        if(migratedState.candidate)migratedState.candidateHistory.push(migratedState.candidate);
        migratedState.candidate=null;
        for(const item of migratedState.impacts)if(item.decision==='change')item.status='pending';
      }
      await migrated.commit(migratedState,0,'migration-v2');tasks++;
    }
    // The active store shares the original object namespace; publish copied objects before switching.
    for(const h of await readdir(join(target,'objects')))await store.putObject(await migrated.getBytes(h));
    const report={schemaVersion:2,fromGeneration:1,toGeneration:2,tasks,documents:docs.size,createdAt:new Date().toISOString(),legacyVerification:'requires fresh v2 review',legacyRequests:'requestId/fingerprint/results preserved; refresh lc_status for current CAS'};
    await store.putObject(canonical(report));
    const temp=join(store.root,id('manifest'));
    const handle=await open(temp,'wx',0o600);try{await handle.writeFile(canonical({schemaVersion:2,workspaceId:store.workspaceId,generation:2}));await handle.sync();}finally{await handle.close();}
    await rename(temp,manifestPath);const directory=await open(store.root,'r');try{await directory.sync();}finally{await directory.close();}
    await store.init();return report;
  });
}

/** Restores only the manifest pointer; v2 journals and candidates remain recoverable. */
export async function rollbackMigration(store:LocalRecordStore){
  await store.init();return store.locked(async()=>{
    const current=JSON.parse(await readFile(join(store.root,'manifest.json'),'utf8'));
    invariant(current.schemaVersion===2&&current.generation===2&&current.workspaceId===store.workspaceId,'LC_MIGRATION_REQUIRED','Only migrated generation 2 can roll back to v1');
    const bytes=await readFile(join(store.root,'migration-v1-manifest.json'),'utf8'),old=JSON.parse(bytes);
    invariant(old.schemaVersion===1&&old.generation===1&&old.workspaceId===store.workspaceId,'LC_STATE_CORRUPT','Invalid original manifest backup');
    for(const filename of await readdir(join(store.root,'documents'))){if(!filename.endsWith('.json'))continue;const doc=JSON.parse(await readFile(join(store.root,'documents',filename),'utf8'));invariant(doc.schemaVersion===1&&doc.workspaceId===store.workspaceId&&hash(canonical(doc.blocks))===doc.blocksHash,'LC_STATE_CORRUPT','Original document changed');await store.getBytes(doc.sourceHash);await store.getBytes(doc.textHash);}
    for(const taskId of (await readdir(join(store.root,'tasks'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name)){let previousHash='';const journal=join(store.root,'tasks',taskId,'journal'),names=(await readdir(journal)).filter(n=>/^\d{10}\.json$/.test(n)).sort();for(let i=0;i<names.length;i++){const raw=JSON.parse(await readFile(join(journal,names[i]!),'utf8')),{hash:eventHash,...body}=raw;invariant(raw.schemaVersion===1&&raw.revision===i+1&&raw.previousHash===previousHash&&hash(canonical(body))===eventHash&&hash(canonical(raw.state))===raw.stateHash&&raw.state.workspaceId===store.workspaceId&&raw.state.taskId===taskId,'LC_STATE_CORRUPT','Original journal changed');previousHash=eventHash;}}
    const tasks=await Promise.all((await store.taskIds()).map(id=>store.task(id))),workflows=await Promise.all((await store.workflowIds()).map(id=>store.workflow(id)));
    const report={restoredGeneration:1,preservedGeneration:2,v2Tasks:tasks.filter(Boolean).map(t=>({taskId:t!.taskId,journalRevision:t!.journalRevision})),v2Workflows:workflows.filter(Boolean).map(t=>({taskId:t!.taskId,journalRevision:t!.journalRevision})),createdAt:new Date().toISOString()};await store.putObject(canonical(report));
    const temp=join(store.root,id('manifest'));const handle=await open(temp,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await rename(temp,join(store.root,'manifest.json'));const directory=await open(store.root,'r');try{await directory.sync();}finally{await directory.close();}return report;
  });
}
