import type {DocumentRevision,Patch,Plan,Task} from '../types.js';
import {validateAnchor} from '../document/index.js';
import {canonical,hash,points} from '../util.js';
import {invariant} from '../errors.js';
export function makePlan(task:Pick<Task,'impacts'|'goalHash'>&{goal:Pick<Task['goal'],'protectedAnchors'>},doc:DocumentRevision,text:string,replacements:Record<string,string>):Plan {
  const patches:Patch[]=[],chars=points(text),protectedRanges=[...task.goal.protectedAnchors,...task.impacts.filter(i=>i.decision==='keep').map(i=>i.anchor)];
  for(const item of task.impacts){
    invariant(item.decision!=='uncertain','LC_COVERAGE_INCOMPLETE','Uncertain impact must be resolved',item.itemId);
    if(item.decision==='keep')continue;
    const replacement=replacements[item.itemId]??item.replacement;invariant(replacement!==null&&replacement!==undefined,'LC_EVIDENCE_MISMATCH','Every change needs a replacement',item.itemId);
    validateAnchor(doc,chars,item.anchor,item.evidence);
    invariant(replacement!==item.evidence,'LC_VERIFICATION_FAILED','A change item cannot resolve to unchanged text',item.itemId);
    const body={itemId:item.itemId,baseRevisionId:doc.revisionId,anchor:item.anchor,expectedOriginal:item.evidence,replacement,rationale:item.rationale};
    patches.push({...body,hash:hash(canonical(body))});
  }
  patches.sort((a,b)=>a.anchor.start-b.anchor.start);
  for(let i=1;i<patches.length;i++)invariant(patches[i]!.anchor.start>=patches[i-1]!.anchor.end,'LC_PATCH_CONFLICT','Overlapping patches',patches[i]!.itemId);
  for(const patch of patches){
    for(const protectedAnchor of protectedRanges)
      invariant(patch.anchor.end<=protectedAnchor.start||patch.anchor.start>=protectedAnchor.end,'LC_PATCH_CONFLICT','Patch touches a protected range',patch.itemId);
  }
  const body={planId:`plan_${hash(canonical(patches)).slice(0,24)}`,baseRevisionId:doc.revisionId,goalHash:task.goalHash,patches};
  return {...body,hash:hash(canonical(body))};
}
export function applyPlan(plan:Plan,doc:DocumentRevision,text:string):string {
  const {hash:planHash,...body}=plan;invariant(hash(canonical(body))===planHash&&plan.baseRevisionId===doc.revisionId,'LC_STALE_REVISION','Plan checksum or baseline mismatch');
  const chars=points(text),output:string[]=[];let offset=0;
  for(const patch of plan.patches){
    const {hash:patchHash,...patchBody}=patch;invariant(hash(canonical(patchBody))===patchHash,'LC_STATE_CORRUPT','Patch checksum mismatch');
    validateAnchor(doc,chars,patch.anchor,patch.expectedOriginal);
    invariant(patch.anchor.start>=offset,'LC_PATCH_CONFLICT','Patches must be ordered and must not overlap');
    output.push(chars.slice(offset,patch.anchor.start).join(''),patch.replacement);offset=patch.anchor.end;
  }
  output.push(chars.slice(offset).join(''));return output.join('');
}
/** Candidate slices include insertions at either edge and all changed text inside the original block. */
export function candidateRange(start:number,end:number,patches:Patch[]):{start:number;end:number}{
  const map=(position:number,edge:'start'|'end')=>{let shift=0;
    for(const p of patches){if(p.anchor.end<=position)shift+=Array.from(p.replacement).length-(p.anchor.end-p.anchor.start);
      else if(p.anchor.start<position)return p.anchor.start+shift+(edge==='end'?Array.from(p.replacement).length:0);}
    return position+shift;
  };
  return {start:map(start,'start'),end:map(end,'end')};
}
