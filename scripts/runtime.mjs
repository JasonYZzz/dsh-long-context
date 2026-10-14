import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {realpathSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname,delimiter} from 'node:path';
export const project=fileURLToPath(new URL('../',import.meta.url));
const configuredCli=process.env.LC_DSH_CLI;
const nativeCli=configuredCli??(process.env.PATH??'').split(delimiter).map(path=>join(path,'dsh')).find(existsSync);
export const dshCli=realpathSync(nativeCli??createRequire(import.meta.url).resolve('@deepseek-ai/dsh/lib/bin.js'));
export const dshRequire=createRequire(join(dirname(dirname(dshCli)),'package.json'));
export const nativeTarget=!!nativeCli;
export const acceptance=join(project,'.acceptance',nativeTarget?'native':'project');
export const home=join(acceptance,'dsh-home-v2');
export const workspace=join(acceptance,'workspace-v2');
export const dshImport=async name=>import(dshRequire.resolve(name));
export async function boot(profile='lc-acceptance',patchFiles=[],environment){
  await mkdir(home,{recursive:true});await mkdir(workspace,{recursive:true});process.env.DSH_HOME=home;
  const {runProfile}=await dshImport('@deepseek-ai/dsh/profile-boot');
  const {createLaunchEnvironmentSnapshot}=await dshImport('@deepseek-ai/dsh-launch-environment');
  // Keep the test environment empty; explicit model profiles own their authorized authentication.
  return runProfile({environment:environment??createLaunchEnvironmentSnapshot([]),profile,patchFiles,args:['--host','127.0.0.1','--port','0','--no-open']});
}
export async function record(name,value){const directory=join(project,'evaluation','runs',name);await mkdir(directory,{recursive:true});await writeFile(join(directory,'result.json'),JSON.stringify(value,null,2)+'\n');return directory;}
export function sanitize(value){return String(value).replace(/([?&]token=)[^\s"']+/g,'$1[REDACTED]').replace(/(sk-)[A-Za-z0-9_-]+/g,'$1[REDACTED]');}
