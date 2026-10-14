import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {load,DEFAULT_SCHEMA,Type,dump} from 'js-yaml';
import {boot,dshImport} from './runtime.mjs';
export async function bootModel(directory,extraConfig={}){
const sourceHome=process.env.LC_MODEL_SOURCE_HOME??join(homedir(),'.dsh');
const schema=DEFAULT_SCHEMA.extend([new Type('tag:yaml.org,2002:js',{kind:'scalar',construct:s=>s})]);
const layers=load(await readFile(join(sourceHome,'profiles','web','cordis.patch.yml'),'utf8'),{schema});
const selected=layers.find(row=>row.id==='agent-default-model')?.config;
if(!selected?.provider||!selected?.model)throw Error('The current native Web profile has no explicit provider/model; select a model before calibration');
const configured=layers.find(row=>row.id==='llm-pi-ai')?.config?.providers?.[selected.provider];
if(!configured?.apiKeyEnv)throw Error('This calibration supports an existing credential-reference route only');
const {parseCredentialsDocument}=await dshImport('@deepseek-ai/dsh-credentials-local');
const credentialPath=join(sourceHome,'.credentials.yaml'),credentialBytes=await readFile(credentialPath),hash=b=>createHash('sha256').update(b).digest('hex');
const credential=parseCredentialsDocument(credentialBytes.toString(),credentialPath).refs.get(configured.apiKeyEnv);
if(!credential)throw Error('The selected native provider has no stored credential reference');
await mkdir(directory,{recursive:true});
const whitelist=['apiKeyEnv','api','baseURL','models','modelOverrides','compat','defaultContextWindow','defaultMaxTokens','reasoning'];
const provider=Object.fromEntries(Object.entries(configured).filter(([k])=>whitelist.includes(k)));
const patch=join(directory,'route.patch.yml');
await writeFile(patch,dump([{id:'llm-pi-ai',config:{providers:{[selected.provider]:provider}}},{id:'long-context-host',config:{...extraConfig,auxiliaryModel:{reasoningEffort:'off',maxOutputTokens:8192,deadlineMs:120000}}}]),{mode:0o600});
const {createLaunchEnvironmentSnapshot}=await dshImport('@deepseek-ai/dsh-launch-environment');
const {ctx,shutdown}=await boot('lc-acceptance',[patch],createLaunchEnvironmentSnapshot([{source:'process',values:{[configured.apiKeyEnv]:credential}}]));
return {ctx,shutdown,selected,assertCredentialsUnchanged:async()=>{if(hash(await readFile(credentialPath))!==hash(credentialBytes))throw Error('Source credential file changed');}};
}
