import {it,expect} from 'vitest';
import {readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {harness} from '../helpers.js';
import {LocalRecordStore,validateStateRoot} from '../../src/core/index.js';
it('detects journal corruption and ignores uncommitted temp files',async()=>{const h=await harness();try{
  const dir=join(h.store.root,'tasks',h.taskId,'journal');await writeFile(join(dir,'0000000002.json.tmp'),'incomplete');expect((await h.store.task(h.taskId))!.journalRevision).toBe(1);
  const path=join(dir,'0000000001.json'),data=JSON.parse(await readFile(path,'utf8'));data.state.goal.request='tampered';await writeFile(path,JSON.stringify(data));await expect(h.store.task(h.taskId)).rejects.toMatchObject({code:'LC_STATE_CORRUPT'});
  const recovered=new LocalRecordStore(h.store.root,h.workspaceId);await expect(recovered.task(h.taskId)).rejects.toMatchObject({code:'LC_STATE_CORRUPT'});
}finally{await h.cleanup();}});
it('rejects unsafe state roots and unknown schemas',async()=>{const h=await harness();try{
  await expect(validateStateRoot(h.root,'../escape')).rejects.toMatchObject({code:'LC_PERMISSION_DENIED'});
  await mkdir(join(h.root,'external'));await symlink(join(h.root,'external'),join(h.root,'link'));await expect(validateStateRoot(h.root,'link/state')).rejects.toMatchObject({code:'LC_PERMISSION_DENIED'});
  await writeFile(join(h.store.root,'manifest.json'),JSON.stringify({schemaVersion:999,workspaceId:h.workspaceId}));await expect(h.store.init()).rejects.toMatchObject({code:'LC_STATE_CORRUPT'});
}finally{await h.cleanup();}});

it('never exposes cached mutable task state',async()=>{const h=await harness();try{const task=(await h.store.task(h.taskId))!,request=task.goal.request;task.goal.request='uncommitted caller mutation';expect((await h.store.task(h.taskId))!.goal.request).toBe(request);}finally{await h.cleanup();}});
