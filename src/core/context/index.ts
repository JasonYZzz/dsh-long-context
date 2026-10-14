import type {DocumentRevision,Task} from '../types.js';
import {canonical,hash,length,mergeRanges} from '../util.js';
import {invariant} from '../errors.js';
export function coverage(task:Task,doc:DocumentRevision){
  return {readCodePoints:mergeRanges(task.readRanges).reduce((n,r)=>n+r.end-r.start,0),totalCodePoints:doc.length,
    topicReviewed:task.reviewed.length,scopeBlocks:task.goal.scope.length,changeResolved:task.impacts.filter(i=>i.status==='resolved').length,
    impactTotal:task.impacts.length,verified:task.checks.filter(c=>c.checkKind==='semantic'&&c.result==='passed'&&c.candidateRevisionId===task.candidate?.candidateRevisionId).length};
}
export function nextOperation(task:Task):string {
  if(['needs_attention','stale','cancelled','failed'].includes(task.state))return 'lc_resume';
  if(task.state==='scanning')return 'lc_scan_next';
  if(task.impacts.some(i=>i.decision==='uncertain')||task.dependencies.some(d=>d.resolution!=='resolved'))return 'lc_impact_review';
  if(task.state==='impacts_reviewed')return 'lc_plan';if(task.state==='planned')return 'lc_apply';
  if(task.state==='completed_with_checks')return 'lc_export_report';return 'lc_verify then lc_finish';
}
export function checkpoint(task:Task,doc:DocumentRevision,maxPoints:number):string {
  const packet={schemaVersion:1,taskId:task.taskId,journalRevision:task.journalRevision,baseline:task.documentRevisionId,
    candidate:task.candidate?.candidateRevisionId??null,state:task.state,
    goal:task.goal.request,changeGoal:task.goal.changeGoal,mustPreserve:task.goal.mustPreserve,
    goalHash:task.goalHash,scopeHash:hash(canonical(task.goal.scope)),coverage:coverage(task,doc),
    pendingBlocks:task.goal.scope.filter(b=>!task.reviewed.includes(b)).length,pendingImpacts:task.impacts.filter(i=>i.status!=='resolved').length,
    unresolvedDependencies:task.dependencies.filter(d=>d.resolution!=='resolved').length,
    nextOperation:nextOperation(task),evidenceIndex:`documents/${doc.revisionId}.json`,ledgerIndex:`tasks/${task.taskId}/journal`,
    note:'Coverage is processing scope, not semantic accuracy. Use lc_status/lc_read to recover evidence.'};
  const rendered=`<long-context-checkpoint>\n${canonical({...packet,checkpointHash:hash(canonical(packet))})}\n</long-context-checkpoint>`;
  invariant(length(rendered)<=maxPoints,'LC_CHECKPOINT_TOO_LARGE','Required goal and constraints cannot fit the checkpoint budget');return rendered;
}
