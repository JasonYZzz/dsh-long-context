import {it,expect} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {harness} from '../helpers.js';
import {canonical,hash,LocalRecordStore,migrateV1,rollbackMigration} from '../../src/core/index.js';
it('migrates a checked v1 journal into a new generation without deleting source or request receipts',async()=>{
  const h=await harness();try{
    const documentPath=join(h.store.root,'documents',h.doc.revisionId+'.json'),oldDoc=JSON.parse(await readFile(documentPath,'utf8'));delete oldDoc.definitions;oldDoc.schemaVersion=1;await writeFile(documentPath,canonical(oldDoc));
    const journalPath=join(h.store.root,'tasks',h.taskId,'journal','0000000001.json'),event=JSON.parse(await readFile(journalPath,'utf8'));event.schemaVersion=1;event.state.schemaVersion=1;delete event.state.legacyChecks;delete event.state.goal.taskType;delete event.state.goal.exactReplacements;delete event.state.goal.rootChanges;event.state.goalHash=hash(canonical(event.state.goal));event.stateHash=hash(canonical(event.state));const {hash:_hash,...body}=event;event.hash=hash(canonical(body));const original=canonical(event);await writeFile(journalPath,original);
    await writeFile(join(h.store.root,'manifest.json'),canonical({schemaVersion:1,workspaceId:h.workspaceId,generation:1}));
    await expect(h.store.init()).rejects.toMatchObject({code:'LC_MIGRATION_REQUIRED'});
    const report=await migrateV1(new LocalRecordStore(h.store.root,h.workspaceId));expect(report.tasks).toBe(1);expect(await readFile(journalPath,'utf8')).toBe(original);
    const recovered=new LocalRecordStore(h.store.root,h.workspaceId);await recovered.init();const task=(await recovered.task(h.taskId))!;expect(task.schemaVersion).toBe(2);expect(task.requests.start).toEqual(event.state.requests.start);expect((await recovered.document(h.doc.revisionId)).textHash).toBe(h.doc.textHash);
    const rollback=await rollbackMigration(recovered);expect(rollback.restoredGeneration).toBe(1);expect(JSON.parse(await readFile(join(h.store.root,'manifest.json'),'utf8')).schemaVersion).toBe(1);expect(await readFile(journalPath,'utf8')).toBe(original);await expect(recovered.locked(async()=>true)).rejects.toMatchObject({code:'LC_STALE_REVISION'});
  }finally{await h.cleanup();}
});
it('does not switch the manifest when a v1 journal hash fails',async()=>{
  const h=await harness();try{const p=join(h.store.root,'manifest.json'),manifest=canonical({schemaVersion:1,workspaceId:h.workspaceId,generation:1});await writeFile(p,manifest);
    await expect(migrateV1(new LocalRecordStore(h.store.root,h.workspaceId))).rejects.toMatchObject({code:'LC_STATE_CORRUPT'});expect(await readFile(p,'utf8')).toBe(manifest);
  }finally{await h.cleanup();}
});
