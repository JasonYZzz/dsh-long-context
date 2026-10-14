import {readFile,writeFile} from 'node:fs/promises';
const [inputPath,outputPath]=process.argv.slice(2);
if(!inputPath||!outputPath){console.error('Usage: pnpm evaluate:report <scores.json> <report.md>');process.exit(2);}
const input=JSON.parse(await readFile(inputPath,'utf8')),scores=Array.isArray(input)?input:input.scores;
if(!Array.isArray(scores)||scores.length===0)throw new Error('Scores must contain independent document-task runs');
const n=scores.length,success=scores.filter(s=>s.documentSuccess===true).length,p=success/n,z=1.96,d=1+z*z/n,
  center=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
const recalls=scores.filter(s=>typeof s.recall==='number').map(s=>s.recall),mean=recalls.reduce((a,b)=>a+b,0)/recalls.length;
const report=`# Document task evaluation\n\nIndependent task runs: ${n}. Successful tasks: ${success}/${n} (${(p*100).toFixed(1)}%).\n\n95% Wilson interval: ${(100*(center-half)).toFixed(1)}%–${(100*(center+half)).toFixed(1)}%.\n\nMean document recall: ${Number.isFinite(mean)?(100*mean).toFixed(1)+'%':'unknown'}.\n\nThe unit is a complete document task. Repeated runs on the same document are not independent document samples; clustered uncertainty needs separate analysis. Model self-review and structural checks alone do not establish semantic quality. Unknown fields remain unknown.\n\n\`\`\`json\n${JSON.stringify(scores,null,2)}\n\`\`\`\n`;
await writeFile(outputPath,report);console.log(JSON.stringify({outputPath,tasks:n,success,interval:[center-half,center+half]}));
