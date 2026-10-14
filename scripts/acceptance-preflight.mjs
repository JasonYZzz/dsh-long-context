import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {project,acceptance,home,workspace,dshCli,dshRequire,nativeTarget,record} from './runtime.mjs';
const require=createRequire(import.meta.url),pkg=JSON.parse(await readFile(join(project,'package.json'),'utf8'));
const packages={};
for(const name of Object.keys(pkg.peerDependencies)){const path=require.resolve(`${name}/package.json`);const hostPath=dshRequire.resolve(`${name}/package.json`);packages[name]={version:JSON.parse(await readFile(hostPath,'utf8')).version,hostPath,developmentPath:path,sameAsHost:path===hostPath};}
const server=createServer();let portFree=false;
await new Promise(resolve=>{server.once('error',resolve);server.listen(3088,'127.0.0.1',()=>{portFree=true;server.close(resolve);});});
await mkdir(home,{recursive:true});await mkdir(workspace,{recursive:true});
const cli=spawnSync(process.execPath,[dshCli,'--version'],{encoding:'utf8'});
const result={recordedAt:new Date().toISOString(),clientTimezone:'Asia/Shanghai',node:process.version,target:{cli:dshCli,native:nativeTarget,sha256:createHash('sha256').update(await readFile(dshCli)).digest('hex')},cliVersion:cli.stdout.trim(),cliExit:cli.status,packages,port3088Available:portFree,
  isolation:{home,workspace},verdict:cli.status===0&&Object.entries(packages).every(([name,p])=>p.version===pkg.peerDependencies[name])?'passed':'failed',liveModel:'not-run'};
await writeFile(join(acceptance,'preflight.json'),JSON.stringify(result,null,2));
const directory=await record('preflight',result);console.log(JSON.stringify({verdict:result.verdict,cliVersion:result.cliVersion,node:result.node,report:directory,port3088Available:portFree}));
if(result.verdict!=='passed')process.exitCode=1;
const tarball=join(project,'.acceptance',`dsh-long-context-${pkg.version}.tgz`);try{result.tarballSha256=createHash('sha256').update(await readFile(tarball)).digest('hex');await record('preflight',result);}catch{/* Pack has not yet run; version checks are still meaningful. */}
