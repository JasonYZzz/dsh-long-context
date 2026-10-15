import {readFile,readdir,mkdir,cp,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {LocalRecordStore,isMissing} from './store.js';
import {managedSchema} from '../tasks/types.js';
import {canonical,hash,id} from '../util.js';
import {invariant} from '../errors.js';

const directories=['documents','tasks','workflows','managed'];
async function tree(root:string){
  const files:{path:string;hash:string}[]=[];
  async function walk(path:string,relative:string){for(const entry of await readdir(path,{withFileTypes:true})){const target=join(path,entry.name),name=relative+'/'+entry.name;invariant(!entry.isSymbolicLink(),'LC_PERMISSION_DENIED','Migration does not follow private state symlinks');if(entry.isDirectory())await walk(target,name);else if(entry.name.endsWith('.json'))files.push({path:name,hash:hash(await readFile(target))});}}
  for(const directory of directories)try{await walk(join(root,directory),directory);}catch(e){if(!isMissing(e))throw e;}
  return {files:files.sort((a,b)=>a.path.localeCompare(b.path)),checksum:hash(canonical(files.sort((a,b)=>a.path.localeCompare(b.path))))};
}
async function writeDurable(path:string,content:string){const handle=await open(path,'wx',0o600);try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}}
async function syncTree(path:string){for(const entry of await readdir(path,{withFileTypes:true}))if(entry.isDirectory())await syncTree(join(path,entry.name));const directory=await open(path,'r');try{await directory.sync();}finally{await directory.close();}}
async function switchManifest(root:string,content:string){const temporary=join(root,id('manifest'));await writeDurable(temporary,content);await rename(temporary,join(root,'manifest.json'));const directory=await open(root,'r');try{await directory.sync();}finally{await directory.close();}}

/** Explicit storage upgrade: old payloads and completion semantics stay unchanged. */
export async function migrateV2(store:LocalRecordStore){
  await store.init();return store.locked(async()=>{
    const manifestText=await readFile(join(store.root,'manifest.json'),'utf8'),manifest=JSON.parse(manifestText);
    if(manifest.schemaVersion===3)return {schemaVersion:3,generation:manifest.generation,alreadyCurrent:true};
    invariant(manifest.schemaVersion===2&&manifest.workspaceId===store.workspaceId,'LC_MIGRATION_REQUIRED','Expected this workspace schema v2');
    for(const taskId of await store.taskIds())await store.task(taskId,true);for(const taskId of await store.workflowIds())await store.workflow(taskId,true);
    for(const taskId of await store.recordIds('managed')){const task=await store.record('managed',taskId,managedSchema,true);invariant(!task?.operation,'LC_OWNER_CONFLICT','End or explicitly recover in-flight work before migration');}
    const source=manifest.generation>1?join(store.root,'generations',String(manifest.generation)):store.root,original=await tree(source);
    const generations=join(store.root,'generations');await mkdir(generations,{recursive:true,mode:0o700});const nextGeneration=Math.max(2,manifest.generation,...(await readdir(generations)).filter(n=>/^\d+$/.test(n)).map(Number))+1,target=join(generations,String(nextGeneration));await mkdir(target,{mode:0o700});
    for(const name of directories)try{await cp(join(source,name),join(target,name),{recursive:true,errorOnExist:true,force:false});}catch(e){if(!isMissing(e))throw e;}
    const copied=await tree(target);invariant(copied.checksum===original.checksum,'LC_STATE_CORRUPT','Migration copy differs from original');
    for(const file of copied.files){const handle=await open(join(target,file.path),'r');try{await handle.sync();}finally{await handle.close();}}
    // V2 snapshots are disposable projections, not audit history.
    for(const kind of ['tasks','workflows','managed']){let records:string[]=[];try{records=await readdir(join(target,kind));}catch(e){if(!isMissing(e))throw e;}for(const taskId of records){const path=join(target,kind,taskId,'snapshots');try{for(const name of await readdir(path))await unlink(join(path,name));}catch(e){if(!isMissing(e))throw e;}}}
    await syncTree(target);const generationDirectory=await open(generations,'r');try{await generationDirectory.sync();}finally{await generationDirectory.close();}
    const backup=id('migration_v2')+'.json';await writeDurable(join(store.root,backup),canonical({manifestText,sourceTreeHash:original.checksum,targetGeneration:nextGeneration}));
    await switchManifest(store.root,canonical({schemaVersion:3,workspaceId:store.workspaceId,generation:nextGeneration,previousManifest:backup}));await store.init();return {schemaVersion:3,generation:nextGeneration,priorGeneration:manifest.generation,filesVerified:copied.files.length,backup,oldDataPreserved:true};
  });
}

/** Switches the runtime pointer only; never removes new work or promises reverse conversion. */
export async function rollbackV2(store:LocalRecordStore){
  await store.init();return store.locked(async()=>{
    const current=JSON.parse(await readFile(join(store.root,'manifest.json'),'utf8'));invariant(current.schemaVersion===3&&/^migration_v2_[a-f0-9-]+\.json$/.test(current.previousManifest),'LC_MIGRATION_REQUIRED','No v2 migration backup is attached to this generation');
    const backup=JSON.parse(await readFile(join(store.root,current.previousManifest),'utf8')),original=JSON.parse(backup.manifestText);invariant(original.schemaVersion===2&&original.workspaceId===store.workspaceId,'LC_STATE_CORRUPT','Invalid prior manifest');
    const source=original.generation>1?join(store.root,'generations',String(original.generation)):store.root;invariant((await tree(source)).checksum===backup.sourceTreeHash,'LC_STATE_CORRUPT','Prior generation changed; refusing rollback');
    const records=[];for(const taskId of await store.taskIds()){const t=await store.task(taskId,true);if(t)records.push({taskId,journalRevision:t.journalRevision,kind:'edit'});}for(const taskId of await store.workflowIds()){const t=await store.workflow(taskId,true);if(t)records.push({taskId,journalRevision:t.journalRevision,kind:t.taskKind});}for(const taskId of await store.recordIds('managed')){const t=await store.record('managed',taskId,managedSchema,true);invariant(!t?.operation,'LC_OWNER_CONFLICT','Stop in-flight operations before rollback');if(t)records.push({taskId,journalRevision:t.journalRevision,kind:'managed'});}
    const report={restoredGeneration:original.generation,preservedGeneration:current.generation,records,newWritesVisibleInOldVersion:false,scope:'Runtime pointer rollback only; new generation and output files are preserved.'};await store.putObject(canonical(report));await switchManifest(store.root,backup.manifestText);return report;
  });
}
