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
const selected=layers.find(row=>row.id==='agent-default-model')?.config??{provider:'deepseek-official',model:'deepseek-flash'};
if(!selected?.provider||!selected?.model)throw Error('The selected profile has no provider/model');
const native=selected.provider==='deepseek-official';
const configured=native?{apiKeyEnv:'DEEPSEEK_API_KEY',...layers.find(row=>row.id==='llm-deepseek-api-key')?.config}:layers.find(row=>row.id==='llm-pi-ai')?.config?.providers?.[selected.provider];
if(!configured?.apiKeyEnv)throw Error('Calibration requires an existing credential-reference route');
const {parseCredentialsDocument}=await dshImport('@deepseek-ai/dsh-credentials-local');
const credentialPath=join(sourceHome,'.credentials.yaml'),credentialBytes=await readFile(credentialPath),hash=b=>createHash('sha256').update(b).digest('hex');
const credential=parseCredentialsDocument(credentialBytes.toString(),credentialPath).refs.get(configured.apiKeyEnv);
if(!credential)throw Error('The selected native provider has no stored credential reference');
await mkdir(directory,{recursive:true});
const whitelist=['apiKeyEnv','api','baseURL','models','modelOverrides','compat','defaultContextWindow','defaultMaxTokens','reasoning'];
const provider=Object.fromEntries(Object.entries(configured).filter(([k])=>whitelist.includes(k)));
const patch=join(directory,'route.patch.yml');
await writeFile(patch,dump([native?{id:'llm-deepseek-api-key',config:provider}:{id:'llm-pi-ai',config:{providers:{[selected.provider]:provider}}},{id:'long-context-host',config:{legacyTools:true,...extraConfig,auxiliaryModel:{maxOutputTokens:8192,deadlineMs:120000,...extraConfig.auxiliaryModel}}}]),{mode:0o600});
const {createLaunchEnvironmentSnapshot}=await dshImport('@deepseek-ai/dsh-launch-environment');
const {ctx,shutdown}=await boot('lc-acceptance',[patch],createLaunchEnvironmentSnapshot([{source:'process',values:{[configured.apiKeyEnv]:credential}}]));
return {ctx,shutdown,selected,assertCredentialsUnchanged:async()=>{if(hash(await readFile(credentialPath))!==hash(credentialBytes))throw Error('Source credential file changed');}};
}
