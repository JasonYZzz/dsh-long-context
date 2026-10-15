import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {project,acceptance,home,workspace,dshCli,boot,record,sanitize,dshImport} from './runtime.mjs';
const {initializeProfileFromDefault}=await dshImport('@deepseek-ai/dsh/profile-boot');
const {version}=JSON.parse(await readFile(join(project,'package.json'),'utf8'));
try{initializeProfileFromDefault('lc-acceptance','web',home);}catch(e){if(!String(e).includes('already exists')&&!String(e).includes('exists'))throw e;}
const profilePackage=join(home,'profiles','lc-acceptance','package.json'),profileManifest=JSON.parse(await readFile(profilePackage,'utf8'));
// Pin the isolated profile's package manager; Corepack's implicit latest lookup can block offline reinstalls.
profileManifest.packageManager='pnpm@11.1.2';await writeFile(profilePackage,JSON.stringify(profileManifest,null,2));
const packed=join(project,'.acceptance',`dsh-long-context-${version}.tgz`);
const digest=createHash('sha256').update(await readFile(packed)).digest('hex');
const tarball=join(acceptance,`dsh-long-context-${version}-${digest.slice(0,16)}.tgz`);await copyFile(packed,tarball);
const install=spawnSync(process.execPath,[dshCli,'plugin','--profile','lc-acceptance','add',tarball,...process.env.LC_INSTALL_OFFLINE==='1'?['--offline']:[]],{env:{...process.env,DSH_HOME:home,COREPACK_ENABLE_DOWNLOAD_PROMPT:'0',COREPACK_DEFAULT_TO_LATEST:'0'},encoding:'utf8',timeout:150000});
if(install.status!==0)throw new Error(sanitize(install.stderr||install.stdout));
const {ctx,shutdown}=await boot();
try{
  const presets=await ctx.agentPresets.list(),preset=presets.find(p=>p.id==='long-context');
  if(!preset||preset.broken)throw new Error(`Long-context loader failure: ${preset?.broken??'missing preset'}`);
  const {SessionId}=await dshImport('@deepseek-ai/dsh-session');
  const handle=await ctx.agents.create({sessionId:SessionId(`acceptance-${Date.now()}`),meta:{cwd:workspace,agentPreset:'long-context'},
    setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,'long-context');}});
  const agent=handle.agent;
  const {scopeOf,scopeChainOf}=await dshImport('@deepseek-ai/dsh-scope');
  const agentKey=scopeOf(agent.ctx);
  console.log(JSON.stringify({preset:ctx.agentPresets.composedPreset(agent.ctx),scopeMatches:agentKey===agent,chainLength:scopeChainOf(agentKey).length}));
  const schemas=agent.ctx.tools.schemas(agentKey);const names=schemas.map(s=>s.name);
  if(!names.includes('lc_import')||!names.includes('lc_work')||!names.includes('lc_continue')||names.includes('lc_task_start')||names.some(n=>/bash|pwsh|run_code|subagent|terminal/.test(n)))throw new Error('Strict tool capability audit failed: '+JSON.stringify(names));
  const fixture=join(workspace,'smoke.md');await writeFile(fixture,'# Evidence\n当前阈值为10。\n'+ '长行😀'.repeat(2000));
  const {ToolCallId}=await dshImport('@deepseek-ai/dsh-llm');
  const result=await agent.ctx.tools.execute({callId:ToolCallId('acceptance-import'),name:'lc_import',arguments:{path:fixture},agent,signal:new AbortController().signal});
  if(result.isError||!result.value?.ok)throw new Error(`Import failed: ${JSON.stringify(result)}`);
  if(!ctx.clientModules.clientPath('dsh-long-context'))throw new Error('Native Web client module was not discovered');
  const bridge=ctx.connection.createSharedFetchHandler('/api'),webResponse=await bridge.fetch(new Request('http://127.0.0.1/api/long-context',{method:'POST',body:JSON.stringify({action:'snapshot',sessionId:agent.session.id})}));
  if(webResponse.status!==200||(await webResponse.json()).enabled!==true)throw new Error('Native Web route was not activated');
  ctx.longContext.config.legacyTools=true;
  const legacy=await ctx.agents.create({sessionId:SessionId(`legacy-loader-${Date.now()}`),meta:{cwd:workspace,agentPreset:'long-context'},setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,'long-context');}});
  const legacyNames=legacy.agent.ctx.tools.schemas(legacy.agent).map(s=>s.name);
  if(!legacyNames.includes('lc_finish'))throw Error('Legacy compatibility tools missing');
  await legacy.dispose();ctx.longContext.config.legacyTools=false;
  const directory=await record('web-loader',{verdict:'passed',layer:'L1-loader-and-agent-tools',tarballSha256:digest,pluginVersion:version,nativeCli:dshCli,presets,names,legacyNames,importResult:result.value,
    model:'not-run',webApiSnapshot:'passed',browserInteraction:'not-run',limitations:['Does not establish model quality or compression behavior']});
  console.log(JSON.stringify({verdict:'passed',tools:names,report:directory}));
  await handle.dispose();
}finally{await shutdown.shutdown(0);}
