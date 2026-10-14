import {runProfile} from '@deepseek-ai/dsh/profile-boot';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.resolve('@deepseek-ai/dsh/package.json'));
const {createLaunchEnvironmentSnapshot}=await import(require.resolve('@deepseek-ai/dsh-launch-environment'));
process.env.DSH_HOME=new URL('../.acceptance/dsh-home',import.meta.url).pathname;
const {ctx,shutdown}=await runProfile({environment:createLaunchEnvironmentSnapshot([]),profile:'lc-acceptance',patchFiles:[],args:['--host','127.0.0.1','--port','0','--no-open']});
try{const presets=await ctx.agentPresets.list();console.log(JSON.stringify(presets,null,2));await writeFile(new URL('../.acceptance/presets.json',import.meta.url),JSON.stringify(presets,null,2));}
finally{await shutdown.shutdown(0);}
