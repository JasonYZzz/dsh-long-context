import {resolve} from 'node:path';
import {hash,LocalRecordStore,validateStateRoot,migrateV1,rollbackMigration,migrateV2,rollbackV2} from '../dist/core/index.js';
const args=process.argv.slice(2),flags=args.filter(a=>a.startsWith('--')),paths=args.filter(a=>!a.startsWith('--'));
if(flags.length>1||flags.some(f=>!['--to-v3','--rollback-v3','--rollback'].includes(f))||paths.length>2)throw Error('Usage: migrate-state.mjs [workspace] [stateRoot] [--to-v3|--rollback-v3|--rollback]');
const workspace=resolve(paths[0]??process.cwd()),root=await validateStateRoot(workspace,paths[1]??'.dsh-long-context');
const action=process.argv.includes('--rollback-v3')?rollbackV2:process.argv.includes('--to-v3')?migrateV2:process.argv.includes('--rollback')?rollbackMigration:migrateV1;
console.log(JSON.stringify(await action(new LocalRecordStore(root,hash(workspace))),null,2));
