import type {DocumentRevision,Patch,Plan,Task} from '../types.js';
import {validateAnchor} from '../document/index.js';
import {canonical,hash,slice} from '../util.js';
import {invariant} from '../errors.js';
export function makePlan(task:Task,doc:DocumentRevision,text:string,replacements:Record<string,string>):Plan {
  const patches:Patch[]=[];
  for(const item of task.impacts){
    invariant(item.decision!=='uncertain','LC_COVERAGE_INCOMPLETE','Uncertain impact must be resolved',item.itemId);
    if(item.decision==='keep')continue;
    const replacement=replacements[item.itemId]??item.replacement;invariant(replacement!==null&&replacement!==undefined,'LC_EVIDENCE_MISMATCH','Every change needs a replacement',item.itemId);
    validateAnchor(doc,text,item.anchor,item.evidence);
    invariant(replacement!==item.evidence,'LC_VERIFICATION_FAILED','A change item cannot resolve to unchanged text',item.itemId);
    const body={itemId:item.itemId,baseRevisionId:doc.revisionId,anchor:item.anchor,expectedOriginal:item.evidence,replacement,rationale:item.rationale};
    patches.push({...body,hash:hash(canonical(body))});
  }
  patches.sort((a,b)=>a.anchor.start-b.anchor.start);
  for(let i=1;i<patches.length;i++)invariant(patches[i]!.anchor.start>=patches[i-1]!.anchor.end,'LC_PATCH_CONFLICT','Overlapping patches',patches[i]!.itemId);
  for(const patch of patches){
    for(const protectedAnchor of [...task.goal.protectedAnchors,...task.impacts.filter(i=>i.decision==='keep').map(i=>i.anchor)])
      invariant(patch.anchor.end<=protectedAnchor.start||patch.anchor.start>=protectedAnchor.end,'LC_PATCH_CONFLICT','Patch touches a protected range',patch.itemId);
  }
  const body={planId:`plan_${hash(canonical(patches)).slice(0,24)}`,baseRevisionId:doc.revisionId,goalHash:task.goalHash,patches};
  return {...body,hash:hash(canonical(body))};
}
export function applyPlan(plan:Plan,doc:DocumentRevision,text:string):string {
  const {hash:planHash,...body}=plan;invariant(hash(canonical(body))===planHash&&plan.baseRevisionId===doc.revisionId,'LC_STALE_REVISION','Plan checksum or baseline mismatch');
  let output=text;
  for(const patch of [...plan.patches].reverse()){
    const {hash:patchHash,...patchBody}=patch;invariant(hash(canonical(patchBody))===patchHash,'LC_STATE_CORRUPT','Patch checksum mismatch');
    validateAnchor(doc,text,patch.anchor,patch.expectedOriginal);
    output=slice(output,0,patch.anchor.start)+patch.replacement+slice(output,patch.anchor.end);
  }
  return output;
}
/** Candidate slices include insertions at either edge and all changed text inside the original block. */
export function candidateRange(start:number,end:number,patches:Patch[]):{start:number;end:number}{
  let before=0,inside=0;
  for(const p of patches){const delta=Array.from(p.replacement).length-(p.anchor.end-p.anchor.start);if(p.anchor.end<=start)before+=delta;else if(p.anchor.start<end)inside+=delta;}
  return {start:start+before,end:end+before+inside};
}
