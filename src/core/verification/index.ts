import type {DocumentRevision,Task,Verification} from '../types.js';
import {applyPlan,candidateRange} from '../changes/index.js';
import {hash,slice} from '../util.js';
export function completionIssues(task:Task,doc:DocumentRevision,semanticRequired:boolean):string[]{
  const issues:string[]=[];
  if(task.legacyChecks)issues.push('Legacy verification must not satisfy v2 completion');
  if(doc.qualityIssues.length)issues.push('Unresolved extraction quality issues');
  if(task.goal.scope.some(b=>!task.reviewed.includes(b)))issues.push('Topic review coverage is incomplete');
  if(task.impacts.some(i=>i.decision==='uncertain'||i.status!=='resolved'))issues.push('Impact decisions have not been applied');
  if(task.dependencies.some(e=>e.critical&&(e.resolution!=='resolved'||e.checkedCandidateId!==task.candidate?.candidateRevisionId)))issues.push('Critical dependencies are unresolved for this candidate');
  if(!task.candidate||task.candidate.draft||task.candidate.status!=='committed')issues.push('A committed non-draft candidate is required');
  if(task.attention.length)issues.push(...task.attention);
  const candidateId=task.candidate?.candidateRevisionId;
  const required=['structural:document','format:document',...(semanticRequired&&task.goal.taskType!=='exact'?task.goal.scope.map(b=>`semantic:${b}`):[])];
  for(const key of required){const [kind,scope]=key.split(':');const check=task.checks.filter(c=>c.candidateRevisionId===candidateId&&c.checkKind===kind&&c.scope===scope).at(-1);if(check?.result!=='passed')issues.push(`Required check is ${check?.result??'missing'}: ${key}`);}
  if(task.checks.some(c=>c.candidateRevisionId===candidateId&&c.result!=='passed'))issues.push('Candidate contains failed or unknown checks');
  if(['stale','failed','cancelled','needs_attention'].includes(task.state))issues.push(`Task state: ${task.state}`);
  return [...new Set(issues)];
}
export function structuralIssues(task:Task,doc:DocumentRevision,original:string,candidate:string):string[]{
  const issues:string[]=[];
  if(!task.plan)return ['Missing change plan'];
  if(task.goal.taskType!=='review'&&task.plan.patches.length===0)issues.push('Edit goal has no changes; explicitly review instead or resolve missing impacts');
  if(task.goal.taskType==='review'&&task.plan.patches.length)issues.push('Review-only task must preserve all text');
  if(task.goal.taskType==='exact'){
    const changes:{start:number;end:number;to:string}[]=[];
    for(const change of task.goal.exactReplacements){let offset=0,index:number;while((index=original.indexOf(change.from,offset))>=0){changes.push({start:index,end:index+change.from.length,to:change.to});offset=index+change.from.length;}}
    const parts:string[]=[];let offset=0;for(const change of changes.sort((a,b)=>a.start-b.start)){if(change.start<offset)issues.push('Independent exact goals overlap');parts.push(original.slice(offset,change.start),change.to);offset=change.end;}parts.push(original.slice(offset));const expected=parts.join('');
    if(candidate!==expected)issues.push('Candidate does not match the independent exact-replacement goal');
  }
  for(const root of task.goal.rootChanges){const {start,end}=candidateRange(root.anchor.start,root.anchor.end,task.plan.patches);if(slice(candidate,start,end)!==root.replacement)issues.push('User-specified root edit is missing or differs from its goal');}

  try{if(hash(applyPlan(task.plan,doc,original))!==hash(candidate))issues.push('Candidate differs from the validated patch set');}catch(e){issues.push(e instanceof Error?e.message:String(e));}
  const changed=task.impacts.filter(i=>i.decision==='change');
  if(changed.some(i=>!task.plan!.patches.some(p=>p.itemId===i.itemId)))issues.push('Change item missing its patch');
  return issues;
}
export function formatIssues(format:string,text:string):{result:Verification['result'];issues:string[]}{
  if(text.includes('\0')||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))return {result:'failed',issues:['Invalid Unicode text']};
  if(format==='tex'){
    const labels=[...text.matchAll(/\\label\{([^}]+)\}/g)].map(m=>m[1]!);const refs=[...text.matchAll(/\\(?:eqref|ref|pageref)\{([^}]+)\}/g)].map(m=>m[1]!);
    const issues=refs.filter(ref=>!labels.includes(ref)).map(ref=>`Missing LaTeX label: ${ref}`);
    if(new Set(labels).size!==labels.length)issues.push('Duplicate LaTeX label');
    return {result:issues.length?'failed':'unknown',issues:issues.length?issues:['LaTeX compiler verification requires an external checked compiler result']};
  }
  return {result:'passed',issues:[]};
}
