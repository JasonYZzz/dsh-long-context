import {resolve} from 'node:path';
import {hash,LocalRecordStore,validateStateRoot,migrateV1,rollbackMigration} from '../dist/core/index.js';
const workspace=resolve(process.argv[2]??process.cwd()),root=await validateStateRoot(workspace,process.argv[3]??'.dsh-long-context');
console.log(JSON.stringify(await (process.argv.includes('--rollback')?rollbackMigration:migrateV1)(new LocalRecordStore(root,hash(workspace))),null,2));
