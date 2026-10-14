import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {project,acceptance,home,workspace,dshCli,boot,record,sanitize,dshImport} from './runtime.mjs';
const {initializeProfileFromDefault}=await import('@deepseek-ai/dsh/profile-boot');
const {version}=JSON.parse(await readFile(join(project,'package.json'),'utf8'));
try{initializeProfileFromDefault('lc-acceptance','web',home);}catch(e){if(!String(e).includes('already exists')&&!String(e).includes('exists'))throw e;}
const packed=join(acceptance,`dsh-long-context-${version}.tgz`);
const digest=createHash('sha256').update(await readFile(packed)).digest('hex');
const tarball=join(acceptance,`dsh-long-context-${version}-${digest.slice(0,16)}.tgz`);await copyFile(packed,tarball);
const install=spawnSync(process.execPath,[dshCli,'plugin','--profile','lc-acceptance','add',tarball],{env:{...process.env,DSH_HOME:home},encoding:'utf8'});
if(install.status!==0)throw new Error(sanitize(install.stderr||install.stdout));
const {ctx,shutdown}=await boot();
try{
  const presets=await ctx.agentPresets.list(),preset=presets.find(p=>p.id==='long-context');
  if(!preset||preset.broken)throw new Error(`Long-context loader failure: ${preset?.broken??'missing preset'}`);
  const {SessionId}=await import('@deepseek-ai/dsh-session');
  const handle=await ctx.agents.create({sessionId:SessionId(`acceptance-${Date.now()}`),meta:{cwd:workspace,agentPreset:'long-context'},
    setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,'long-context');}});
  const agent=handle.agent;
  const {scopeOf,scopeChainOf}=await dshImport('@deepseek-ai/dsh-scope');
  const agentKey=scopeOf(agent.ctx);
  console.log(JSON.stringify({preset:ctx.agentPresets.composedPreset(agent.ctx),scopeMatches:agentKey===agent,chainLength:scopeChainOf(agentKey).length}));
  const schemas=agent.ctx.tools.schemas(agentKey);const names=schemas.map(s=>s.name);
  if(!names.includes('lc_import')||!names.includes('lc_finish')||names.some(n=>/bash|pwsh|run_code|subagent|terminal/.test(n)))throw new Error('Strict tool capability audit failed: '+JSON.stringify(names));
  const fixture=join(workspace,'smoke.md');await writeFile(fixture,'# Evidence\n当前阈值为10。\n'+ '长行😀'.repeat(2000));
  const {ToolCallId}=await import('@deepseek-ai/dsh-llm');
  const result=await agent.ctx.tools.execute({callId:ToolCallId('acceptance-import'),name:'lc_import',arguments:{path:fixture},agent,signal:new AbortController().signal});
  if(result.isError||!result.value?.ok)throw new Error(`Import failed: ${JSON.stringify(result)}`);
  const directory=await record('web-loader',{verdict:'passed',layer:'L1-loader-and-agent-tools',presets,names,importResult:result.value,
    model:'not-run',browserInteraction:'separate manual CUA evidence',limitations:['Does not establish model quality or compression behavior']});
  console.log(JSON.stringify({verdict:'passed',tools:names,report:directory}));
  await handle.dispose();
}finally{await shutdown.shutdown(0);}
