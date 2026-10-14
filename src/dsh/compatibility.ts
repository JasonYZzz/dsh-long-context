import {createRequire} from 'node:module';
import {invariant} from '../core/errors.js';
export function assertCompatibility():void {
  const require=createRequire(import.meta.url);
  for(const pkg of ['dsh-agent','dsh-compaction-basic','dsh-fs','dsh-llm','dsh-tools','dsh-session']){
    const version=(require(`@deepseek-ai/${pkg}/package.json`) as {version:string}).version;
    invariant(version==='0.2.0-rc.2','LC_DSH_INCOMPATIBLE',`Expected ${pkg}@0.2.0-rc.2, found ${version}`);
  }
  invariant((require('@deepseek-ai/cordis/package.json') as {version:string}).version==='4.0.4','LC_DSH_INCOMPATIBLE','Cordis 4.0.4 is required');
}
