import {describe,it,expect} from 'vitest';
import {harness,FakeModel} from '../helpers.js';
import {LongContextEngine,LocalRecordStore,checkpoint,hash,locateQuote,makePlan} from '../../src/core/index.js';
describe('evidence-bound editing workflow',()=>{
  it('preserves original, applies all changes, verifies and finishes after restart',async()=>{const h=await harness();try{
    const candidate=await h.candidate();expect(Buffer.from(await h.files.read('paper.md')).toString()).toContain('当前阈值为10。');expect(Buffer.from(await h.files.read('candidate.md')).toString()).toBe('当前阈值为20。\n历史研究的阈值为10。\n');
    await expect(h.engine.finish(h.taskId,await h.command(),candidate.candidateRevisionId)).rejects.toMatchObject({code:'LC_VERIFICATION_FAILED'});
    await h.engine.verify(h.taskId,await h.command(),{candidateRevisionId:candidate.candidateRevisionId});
    const store=new LocalRecordStore(h.store.root,h.workspaceId);await store.init();const engine=new LongContextEngine({...h.engine.options,store});
    await engine.finish(h.taskId,await h.command(),candidate.candidateRevisionId);expect((await store.task(h.taskId))!.state).toBe('completed_with_checks');
    expect((await engine.status(h.taskId)).coverage.topicReviewed).toBe(h.doc.blocks.length);
  }finally{await h.cleanup();}});
  it('does not infer coverage from lexical search and rejects premature planning',async()=>{const h=await harness('正文没有目标关键字。');try{
    expect((await h.engine.search({revisionId:h.doc.revisionId,query:'missing'})).total).toBe(0);
    await expect(h.engine.plan(h.taskId,await h.command())).rejects.toMatchObject({code:'LC_COVERAGE_INCOMPLETE'});expect((await h.store.task(h.taskId))!.reviewed).toEqual([]);
  }finally{await h.cleanup();}});
  it('keeps failed schema/evidence pending and enforces bounded retries',async()=>{const h=await harness(undefined,{retries:2},new FakeModel(()=>JSON.stringify({impacts:[{quote:'fabricated',decision:'change',rationale:'bad',claimId:'x',replacement:'x'}],aliases:[],dependencies:[],needsEvidence:[]})));try{
    await h.engine.scanNext(h.taskId,await h.command());const task=(await h.store.task(h.taskId))!;expect(task.state).toBe('needs_attention');expect(task.reviewed).toEqual([]);expect(task.audits).toHaveLength(3);expect(h.model.calls).toBe(3);
    expect(await h.store.getObject(task.audits[0]!.inputHash)).toContain('当前阈值为10。');expect(await h.store.getObject(task.audits[0]!.outputHash)).toContain('fabricated');
  }finally{await h.cleanup();}});
  it('reuses the exact result without repeating model calls or candidate writes',async()=>{const h=await harness();try{
    const command=await h.command(),result=await h.engine.scanNext(h.taskId,command);expect(await h.engine.scanNext(h.taskId,command)).toEqual(result);expect(h.model.calls).toBe(1);
    await h.engine.plan(h.taskId,await h.command());const task=(await h.store.task(h.taskId))!,apply=await h.command(),input={planId:task.plan!.planId,outputPath:'candidate.md'};
    const applied=await h.engine.apply(h.taskId,apply,input);expect(await h.engine.apply(h.taskId,apply,input)).toEqual(applied);expect(h.files.writes).toBe(1);
    await expect(h.engine.apply(h.taskId,apply,{...input,outputPath:'other.md'})).rejects.toMatchObject({code:'LC_REQUEST_CONFLICT'});
  }finally{await h.cleanup();}});
  it('recovers durable prepare after interruption without repeating changes',async()=>{const h=await harness();try{
    await h.scanAll();await h.engine.plan(h.taskId,await h.command());const task=(await h.store.task(h.taskId))!,command=await h.command(),input={planId:task.plan!.planId,outputPath:'candidate.md'};
    h.files.failCreate=true;await expect(h.engine.apply(h.taskId,command,input)).rejects.toThrow('interruption');expect((await h.store.task(h.taskId))!.candidate!.status).toBe('prepared');
    h.files.failCreate=false;await h.engine.apply(h.taskId,command,input);expect(h.files.writes).toBe(1);expect((await h.store.task(h.taskId))!.candidate!.status).toBe('committed');
  }finally{await h.cleanup();}});
  it('makes old plans/checks stale after external source/candidate modification',async()=>{const h=await harness();try{
    const c=await h.candidate();await h.engine.verify(h.taskId,await h.command(),{candidateRevisionId:c.candidateRevisionId});h.files.seed('candidate.md','tampered');
    await expect(h.engine.finish(h.taskId,await h.command(),c.candidateRevisionId)).rejects.toMatchObject({code:'LC_STALE_REVISION'});expect((await h.store.task(h.taskId))!.checks).toEqual([]);expect((await h.store.task(h.taskId))!.state).toBe('stale');
  }finally{await h.cleanup();}});
  it('rejects protected/overlapping patches before any output write',async()=>{const h=await harness();try{
    await h.scanAll();const task=(await h.store.task(h.taskId))!,text=await h.store.getObject(h.doc.textHash);task.goal.protectedAnchors=[locateQuote(h.doc,text,h.doc.blocks[0]!.blockId,'当前阈值为10。')];
    expect(()=>makePlan(task,h.doc,text,{})).toThrow(/protected/);task.goal.protectedAnchors=[];task.impacts.push({...task.impacts[0]!,itemId:'item_duplicate'});
    expect(()=>makePlan(task,h.doc,text,{})).toThrow(/Overlapping/);expect(h.files.writes).toBe(0);
  }finally{await h.cleanup();}});
  it('requires scoped session ownership and compare-and-swap',async()=>{const h=await harness();try{
    const observer=new LongContextEngine({...h.engine.options,identity:{workspaceId:h.workspaceId,sessionId:'fork-session'}});await expect(observer.scanNext(h.taskId,await h.command())).rejects.toMatchObject({code:'LC_OWNER_CONFLICT'});
    await expect(h.engine.scanNext(h.taskId,{requestId:'stale',expectedLedgerRevision:0})).rejects.toMatchObject({code:'LC_STALE_REVISION'});
    await expect(h.engine.start({revisionId:h.doc.revisionId,request:'other'},{requestId:'other',expectedLedgerRevision:0})).rejects.toMatchObject({code:'LC_OWNER_CONFLICT'});
    const cross=new LocalRecordStore(h.store.root,hash('other-workspace'));await expect(cross.init()).rejects.toMatchObject({code:'LC_STATE_CORRUPT'});
  }finally{await h.cleanup();}});
  it('bounds correction attempts and never drops required checkpoint constraints',async()=>{const h=await harness();try{
    expect(await h.engine.correction(h.taskId)).toContain('lc_scan_next');expect(await h.engine.correction(h.taskId)).not.toBeNull();expect(await h.engine.correction(h.taskId)).toBeNull();
    const task=(await h.store.task(h.taskId))!;task.goal.mustPreserve=['x'.repeat(6000)];expect(()=>checkpoint(task,h.doc,4500)).toThrow(/constraints/);
  }finally{await h.cleanup();}});
  it('returns budget exhaustion as attention without reviewing remaining blocks',async()=>{const h=await harness('当前阈值为10。'+'a'.repeat(400),{blockTargetCodePoints:128,blockMaxCodePoints:128,maxCalls:1});try{
    await h.engine.scanNext(h.taskId,await h.command());await h.engine.scanNext(h.taskId,await h.command());const task=(await h.store.task(h.taskId))!;expect(task.state).toBe('needs_attention');expect(task.calls).toBe(1);expect(task.reviewed.length).toBeLessThan(task.goal.scope.length);
  }finally{await h.cleanup();}});
  it('rolls back only the managed candidate and keeps source unchanged',async()=>{const h=await harness();try{const c=await h.candidate();await h.engine.rollback(h.taskId,await h.command(),c.candidateRevisionId);expect(hash(await h.files.read('candidate.md'))).toBe(h.doc.sourceHash);expect(hash(await h.files.read('paper.md'))).toBe(h.doc.sourceHash);expect((await h.store.task(h.taskId))!.checks).toEqual([]);}finally{await h.cleanup();}});
});
it('transfers ownership with an idempotent journaled CAS and releases stale tasks through cancellation',async()=>{const h=await harness();try{
  const observer=new LongContextEngine({...h.engine.options,identity:{workspaceId:h.workspaceId,sessionId:'session-B'}}),cmd=await h.command();
  const result=await observer.resume(h.taskId,cmd,{transferOwner:true});expect(await observer.resume(h.taskId,cmd,{transferOwner:true})).toEqual(result);
  expect((await h.store.task(h.taskId))!.ownerSession).toBe('session-B');
  await expect(h.engine.scanNext(h.taskId,await h.command())).rejects.toMatchObject({code:'LC_OWNER_CONFLICT'});
  h.files.seed('paper.md','external edit');await expect(observer.scanNext(h.taskId,await h.command())).rejects.toMatchObject({code:'LC_STALE_REVISION'});
  await observer.resume(h.taskId,await h.command(),{cancel:true});expect((await h.store.task(h.taskId))!.state).toBe('cancelled');
}finally{await h.cleanup();}});
it('can revise a failed candidate while retaining prior candidate history',async()=>{const h=await harness();try{
  const first=await h.candidate();let task=(await h.store.task(h.taskId))!;const item=task.impacts[0]!;
  await h.engine.review(h.taskId,await h.command(),{items:[{itemId:item.itemId,decision:'change',rationale:'Clarify threshold units',evidence:item.evidence,replacement:'当前阈值为20个单位。'}]});
  task=(await h.store.task(h.taskId))!;expect(task.candidateHistory[0]!.candidateRevisionId).toBe(first.candidateRevisionId);expect(task.candidate).toBeNull();
  await h.engine.plan(h.taskId,await h.command());task=(await h.store.task(h.taskId))!;
  await h.engine.apply(h.taskId,await h.command(),{planId:task.plan!.planId,outputPath:'candidate-v2.md'});expect(Buffer.from(await h.files.read('candidate-v2.md')).toString()).toContain('20个单位');
  expect(Buffer.from(await h.files.read('candidate.md')).toString()).toContain('当前阈值为20。');
}finally{await h.cleanup();}});
