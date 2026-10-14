import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {LongContextEngine,LocalRecordStore,WorkflowEngine,hash,anchor} from '../dist/core/index.js';
import {extractPdf} from '../dist/extractors/pdf.js';
const root=resolve('evaluation/runs/research-real'),papers=resolve('evaluation/runs/implementation-20261014/papers');await mkdir(root,{recursive:true});
const bytes=await readFile(join(papers,'ccl-rag-2024.pdf')),extracted=await extractPdf(bytes);
// The real paper's English title/affiliation block provides exact identity evidence, retained byte-for-byte.
const first=extracted.text.split('\f')[0],group='Research Center for Social Computing and Information Retrieval',member='Ting Liu',title='Enhancing Large Language Models with Retrieval-Augmented Techniques: Trends, Challenges, and Prospects';
if(!first.includes(group)||!first.includes(member))throw Error('Expected real group/author evidence missing');
const source=join(root,'ccl-body.txt');await writeFile(source,extracted.text);const files={read:async path=>readFile(path),create:async(path,text)=>writeFile(path,text,{flag:'wx'}),replace:async()=>{throw Error('Acceptance does not overwrite files');}};
const store=new LocalRecordStore(join(root,`state-${Date.now()}`),hash(root));await store.init();
const engine=new LongContextEngine({store,files,model:{generate:async()=>{throw Error('Real scientific relevance review not run in metadata acceptance');}},identity:{workspaceId:hash(root),sessionId:'real-research'},config:{maxCalls:1}}),workflow=new WorkflowEngine(engine),doc=await engine.importDocument({path:source}),a=anchor(doc,extracted.text,doc.blocks[0].blockId,0,Array.from(first).length);
const started=await workflow.start('research',{question:'retrieval augmented generation factual accuracy',asOf:'2026-10-14',groupName:group,groupMembers:[member],groupEvidence:a,minCount:50},{requestId:'start',expectedLedgerRevision:0});let step=0;const cmd=async()=>({requestId:`step-${++step}`,expectedLedgerRevision:(await store.workflow(started.taskId)).journalRevision});
const result={topic:'Can retrieval augmented generation improve factual accuracy?',asOf:'2026-10-14',source:'https://aclanthology.org/2024.ccl-2.9.pdf',pdfHash:hash(bytes),pdfPages:extracted.pages,pdfIssues:extracted.qualityIssues,group,title,network:'not-run',verdict:'running',scientificReview:'not-run',quotaAcceptance:'not-passed'};
try{const page=await workflow.researchNext(started.taskId,await cmd());result.network='passed';result.networkPage=page.detail;
  await workflow.importPapers(started.taskId,await cmd(),[{title,authors:[member],published:'2024-07',sourceUrl:'https://aclanthology.org/2024.ccl-2.9/',revisionId:doc.revisionId,participationEvidence:a}]);
  // Metadata and this one real body cannot establish 51 qualified original papers; finish must stop.
  const finished=await workflow.researchFinish(started.taskId,await cmd()),state=await store.workflow(started.taskId);result.state=state.state;result.shortfall=finished.detail;result.verdict=state.state==='needs_attention'?'passed-shortfall-guard':'failed-false-completion';
  await writeFile(join(root,'workflow.json'),JSON.stringify(state,null,2));
}catch(error){result.verdict='failed';result.error=String(error);}finally{await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
if(!result.verdict.startsWith('passed'))process.exitCode=1;
