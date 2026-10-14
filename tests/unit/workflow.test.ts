import {describe,it,expect} from 'vitest';
import {harness,FakeModel} from '../helpers.js';
import {LongContextEngine,LocalRecordStore,checkpoint,hash,canonical,locateQuote,makePlan,structuralIssues,applyPlan} from '../../src/core/index.js';
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
    await h.engine.scanNext(h.taskId,await h.command());const task=(await h.store.task(h.taskId))!;expect(task.state).toBe('needs_attention');expect(task.reviewed).toEqual([]);expect(task.audits).toHaveLength(2);expect(h.model.calls).toBe(2);
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
    const c=await h.candidate();await h.engine.verify(h.taskId,await h.command(),{candidateRevisionId:c.candidateRevisionId});h.files.seed('candidate.md','tampered');expect((await h.engine.status(h.taskId)).freshness).toBe('stale');
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
it('rejects a zero-change semantic edit even when both model passes miss the request',async()=>{
  const model=new FakeModel(input=>JSON.stringify(input.includes('WHOLE block')?{impacts:[],aliases:[],dependencies:[],needsEvidence:[]}:{passed:true,issues:[],evidence:['当前阈值为10。']}));
  const h=await harness(undefined,{},model);try{const c=await h.candidate();await h.engine.verify(h.taskId,await h.command(),{candidateRevisionId:c.candidateRevisionId});
    await expect(h.engine.finish(h.taskId,await h.command(),c.candidateRevisionId)).rejects.toMatchObject({code:'LC_VERIFICATION_FAILED'});
  }finally{await h.cleanup();}
});
it('provides the exact schema validation error to a bounded corrective attempt',async()=>{
  const inputs:string[]=[];const model=new FakeModel((input,call)=>{inputs.push(input);return JSON.stringify({impacts:[{quote:'当前阈值为10。',decision:'keep',rationale:'Preserve source',claimId:call===1?null:'threshold',replacement:null}],aliases:[],dependencies:[],needsEvidence:[]});});
  const h=await harness(undefined,{},model);try{await h.engine.scanNext(h.taskId,await h.command());expect(model.calls).toBe(2);expect(inputs[1]).toContain('claimId');expect(inputs[1]).toContain('Previous attempt failed validation');expect((await h.store.task(h.taskId))!.reviewed).toHaveLength(1);
  }finally{await h.cleanup();}
});
it('applies an explicit cross-block exact goal even when the scanner finds no impacts',async()=>{
  const h=await harness('x'.repeat(3996)+'DualPipe'+'y'.repeat(4200),{},new FakeModel(()=>{throw new Error('Exact goal must not require model interpretation');}));
  try{await h.engine.resume(h.taskId,await h.command(),{cancel:true});const t=await h.engine.start({revisionId:h.doc.revisionId,request:'Rename every exact occurrence',taskType:'exact',exactReplacements:[{from:'DualPipe',to:'DualPipe-Eval'}]},{requestId:'exact-start',expectedLedgerRevision:0}) as {taskId:string};
    let seq=0;const cmd=async()=>({requestId:`exact-${++seq}`,expectedLedgerRevision:(await h.store.task(t.taskId))!.journalRevision});
    while((await h.store.task(t.taskId))!.state==='scanning')await h.engine.scanNext(t.taskId,await cmd());
    await h.engine.plan(t.taskId,await cmd());let task=(await h.store.task(t.taskId))!;await h.engine.apply(t.taskId,await cmd(),{planId:task.plan!.planId,outputPath:'exact.md'});task=(await h.store.task(t.taskId))!;
    for(const b of h.doc.blocks)await h.engine.verify(t.taskId,await cmd(),{candidateRevisionId:task.candidate!.candidateRevisionId,blockId:b.blockId});
    await h.engine.finish(t.taskId,await cmd(),task.candidate!.candidateRevisionId);expect(Buffer.from(await h.files.read('exact.md')).toString()).toBe('x'.repeat(3996)+'DualPipe-Eval'+'y'.repeat(4200));
  }finally{await h.cleanup();}
});
it('keeps an early definition visible after more than twenty intervening claims',async()=>{
  const inputs:string[]=[];const model=new FakeModel(input=>{inputs.push(input);const p=JSON.parse(input.split('Input:\n')[1]!);return JSON.stringify({impacts:[0,100,200].map(start=>({quote:Array.from(p.block.text).slice(start,start+80).join(''),start,decision:'keep',rationale:'Keep evidence',claimId:`c-${inputs.length}-${start}`,replacement:null})),aliases:[],dependencies:[],needsEvidence:[]});});
  const text=Array.from({length:30},(_,i)=>`# Chapter ${i+1}\n`+(i===0?'ROOT-DEFINITION: code Q7 means threshold ten.\n':i===29?'LATE-REFERENCE: use Q7 from chapter one.\n':'')+'正文保留。'.repeat(250)+'\n\f').join(''),h=await harness(text,{},model);
  try{await h.scanAll();const late=inputs.find(p=>p.includes('LATE-REFERENCE'))!;const p=JSON.parse(late.split('Input:\n')[1]!);expect(p.definitions.some((d:{text:string})=>d.text.includes('ROOT-DEFINITION'))).toBe(true);expect((await h.store.task(h.taskId))!.impacts.length).toBeGreaterThan(20);
  }finally{await h.cleanup();}
});

it('checks exact goals independently even if reviewed rule replacements are altered',async()=>{
  const h=await harness();try{await h.engine.resume(h.taskId,await h.command(),{cancel:true});const result=await h.engine.start({revisionId:h.doc.revisionId,request:'Rename 10 to 20',taskType:'exact',exactReplacements:[{from:'10',to:'20'}]},{requestId:'exact-independent',expectedLedgerRevision:0}) as {taskId:string};const task=(await h.store.task(result.taskId))!,text=await h.store.getObject(h.doc.textHash);for(const item of task.impacts)item.replacement='99';task.plan=makePlan(task,h.doc,text,{});expect(structuralIssues(task,h.doc,text,applyPlan(task.plan,h.doc,text))).toContain('Candidate does not match the independent exact-replacement goal');
  }finally{await h.cleanup();}
});
it('applies and checks a user-specified paragraph before accepting related edits',async()=>{
  const h=await harness('根段落：阈值为10。\n后文引用阈值。');try{await h.engine.resume(h.taskId,await h.command(),{cancel:true});const text=await h.store.getObject(h.doc.textHash),a=locateQuote(h.doc,text,h.doc.blocks[0]!.blockId,'根段落：阈值为10。'),r=await h.engine.start({revisionId:h.doc.revisionId,request:'Update definition and related content',rootChanges:[{anchor:a,replacement:'根段落：阈值为20。'}]},{requestId:'root',expectedLedgerRevision:0}) as {taskId:string},task=(await h.store.task(r.taskId))!;task.plan=makePlan(task,h.doc,text,{});expect(structuralIssues(task,h.doc,text,applyPlan(task.plan,h.doc,text))).toEqual([]);task.impacts[0]!.replacement='根段落：阈值为30。';task.plan=makePlan(task,h.doc,text,{});expect(structuralIssues(task,h.doc,text,applyPlan(task.plan,h.doc,text))).toContain('User-specified root edit is missing or differs from its goal');
  }finally{await h.cleanup();}
});

it('applies thousands of length-changing Unicode patches without changing other text',async()=>{
 const text='😀甲旧🚀保留。\n'.repeat(1500),h=await harness(text);try{await h.engine.resume(h.taskId,await h.command(),{cancel:true});const s=await h.engine.start({revisionId:h.doc.revisionId,request:'Exact Unicode update',taskType:'exact',exactReplacements:[{from:'旧🚀',to:'新😀更长'}]},{requestId:'unicode-exact',expectedLedgerRevision:0}) as {taskId:string};const task=(await h.store.task(s.taskId))!,plan=makePlan(task,h.doc,text,{}),candidate=applyPlan(plan,h.doc,text);expect(plan.patches).toHaveLength(1500);expect(candidate).toBe(text.split('旧🚀').join('新😀更长'));task.plan=plan;expect(structuralIssues(task,h.doc,text,candidate)).toEqual([]);const reversed={...plan,patches:plan.patches.toReversed()};const {hash:_hash,...body}=reversed;reversed.hash=hash(canonical(body));expect(()=>applyPlan(reversed,h.doc,text)).toThrow(/ordered/);
 }finally{await h.cleanup();}
});
