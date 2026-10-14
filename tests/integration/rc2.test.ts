import {beforeAll,it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const exec=promisify(execFile);
beforeAll(async()=>{
  await exec(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.build.json'],{cwd:process.cwd()});
  await exec('pnpm',['pack','--pack-destination','.acceptance'],{cwd:process.cwd()});
},180000);
it('loads the actual tarball in rc.2 and exposes only the strict scoped tools',async()=>{
  await exec(process.execPath,['scripts/acceptance-web.mjs'],{cwd:process.cwd(),timeout:150000,maxBuffer:2_000_000});
  const report=JSON.parse(await readFile(resolve('evaluation/runs/web-loader/result.json'),'utf8'));
  expect(report.verdict).toBe('passed');expect(report.names).toContain('lc_read');expect(report.names).toContain('lc_finish');
  expect(report.names).not.toContain('bash');expect(report.names).not.toContain('run_code');expect(report.presets.find((p:{id:string})=>p.id==='standard').broken).toBeUndefined();
  expect(report.names).toContain('lc_research_finish');expect(report.names).toContain('lc_generate_finish');
},180000);
