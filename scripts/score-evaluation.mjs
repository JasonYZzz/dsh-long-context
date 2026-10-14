import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [goldPath,originalPath,candidatePath,outputPath]=process.argv.slice(2);
if(!goldPath||!originalPath||!candidatePath){console.error('Usage: pnpm evaluate:gold <gold.json> <original.md> <candidate.md> [score.json]');process.exit(2);}
const gold=JSON.parse(await readFile(goldPath,'utf8')),original=await readFile(originalPath,'utf8'),candidate=await readFile(candidatePath,'utf8');
if(createHash('sha256').update(original).digest('hex')!==gold.sourceHash)throw new Error('Gold/source version mismatch');
const chars=Array.from(original);let expected=original;
for(const change of [...gold.changes].sort((a,b)=>b.start-a.start)){
  if(chars.slice(change.start,change.end).join('')!==change.expectedOriginal)throw new Error('Gold anchor mismatch');expected=Array.from(expected).slice(0,change.start).join('')+change.replacement+Array.from(expected).slice(change.end).join('');}
let shift=0,correct=0;for(const change of [...gold.changes].sort((a,b)=>a.start-b.start)){const start=change.start+shift,end=start+Array.from(change.replacement).length;
  if(Array.from(candidate).slice(start,end).join('')===change.replacement)correct++;shift+=Array.from(change.replacement).length-(change.end-change.start);}
const exact=candidate===expected;
const score={schemaVersion:1,unit:'document-task',requiredChanges:gold.changes.length,correctChanges:correct,recall:gold.changes.length?correct/gold.changes.length:1,
  precision:exact?1:null,precisionStatus:exact?'exact-expected-output':'requires-diff-review',criticalDependencies:null,
  documentSuccess:exact,unexpectedChanges:exact?0:null,humanGoldReview:gold.humanGoldReview??'unknown',limitations:['Position/string benchmark only; semantic rewordings require blinded review','Failed positional alignment may undercount later correct replacements']};
if(outputPath)await writeFile(outputPath,JSON.stringify(score,null,2)+'\n');console.log(JSON.stringify(score,null,2));
