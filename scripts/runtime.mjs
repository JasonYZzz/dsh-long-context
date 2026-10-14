import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
export const project=fileURLToPath(new URL('../',import.meta.url));
export const acceptance=join(project,'.acceptance');
export const home=join(acceptance,'dsh-home');
export const workspace=join(acceptance,'workspace');
export const dshRequire=createRequire(import.meta.resolve('@deepseek-ai/dsh/package.json'));
export const dshImport=async name=>import(dshRequire.resolve(name));
export const dshCli=dshRequire.resolve('@deepseek-ai/dsh/lib/bin.js');
export async function boot(profile='lc-acceptance',patchFiles=[]){
  await mkdir(home,{recursive:true});await mkdir(workspace,{recursive:true});process.env.DSH_HOME=home;
  const {runProfile}=await import('@deepseek-ai/dsh/profile-boot');
  const {createLaunchEnvironmentSnapshot}=await dshImport('@deepseek-ai/dsh-launch-environment');
  // Keep the test environment empty; explicit model profiles own their authorized authentication.
  return runProfile({environment:createLaunchEnvironmentSnapshot([]),profile,patchFiles,args:['--host','127.0.0.1','--port','0','--no-open']});
}
export async function record(name,value){const directory=join(project,'evaluation','runs',name);await mkdir(directory,{recursive:true});await writeFile(join(directory,'result.json'),JSON.stringify(value,null,2)+'\n');return directory;}
export function sanitize(value){return String(value).replace(/([?&]token=)[^\s"']+/g,'$1[REDACTED]').replace(/(sk-)[A-Za-z0-9_-]+/g,'$1[REDACTED]');}
