import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {dshCli,home,record,sanitize} from './runtime.mjs';
// An authorized DSH profile owns its provider route and authentication; no secret is copied from the user's home.
const profile=process.env.LC_MODEL_PROFILE,taskPath=process.argv[2];
if(!profile||!taskPath){const report=await record('live-model',{verdict:'not-run',reason:'An authorized isolated model profile and task prompt are required',
  nextAction:'Set LC_MODEL_PROFILE to a separately authenticated headless test profile and pass a prompt file',qualityAcceptance:'not-run',realPapers:'not-provided'});
  console.log(JSON.stringify({verdict:'not-run',report}));process.exit(2);}
const task=await readFile(taskPath,'utf8');
const run=spawnSync(process.execPath,[dshCli,'--profile',profile,'--json',task],{env:{...process.env,DSH_HOME:home},encoding:'utf8',timeout:14_400_000,maxBuffer:20_000_000});
await record('live-model',{verdict:run.status===0?'execution-finished-unscored':'failed',exitCode:run.status,stdout:sanitize(run.stdout),stderr:sanitize(run.stderr),qualityAcceptance:'requires-independent-gold-scoring'});
console.log(JSON.stringify({verdict:run.status===0?'execution-finished-unscored':'failed'}));if(run.status!==0)process.exitCode=1;
