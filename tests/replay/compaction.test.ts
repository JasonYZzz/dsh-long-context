import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const exec=promisify(execFile);
it('retains current checkpoint in actual requests across manual, pressure and controlled overflow compaction',async()=>{
  // Each command is independently reproducible, including from a fresh checkout.
  await exec(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.build.json'],{cwd:process.cwd()});await exec('pnpm',['pack','--pack-destination','.acceptance'],{cwd:process.cwd()});
  await exec(process.execPath,['scripts/acceptance-web.mjs'],{cwd:process.cwd(),timeout:150000,maxBuffer:2_000_000});
  await exec(process.execPath,['scripts/acceptance-mechanisms.mjs'],{cwd:process.cwd(),timeout:150000,maxBuffer:2_000_000});
  const report=JSON.parse(await readFile(resolve('evaluation/runs/mechanisms/result.json'),'utf8'));
  expect(report.verdict).toBe('passed');expect(report.manual).toBe(true);expect(report.overflowSummaries).toBeGreaterThan(0);expect(report.pressureSummaries).toBeGreaterThan(0);
  expect(report.semanticQuality).toBe('not-evaluated');
},360000);
