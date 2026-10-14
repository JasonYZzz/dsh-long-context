import type {Paper} from './types.js';
import {researchQuerySchema} from './types.js';
import type {z} from 'zod';
import {hash} from '../util.js';
import {invariant} from '../errors.js';
export function originalLanguage(text:string):Paper['language']{
  if(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text))return 'unknown';
  const han=(text.match(/\p{Script=Han}/gu)??[]).length,latin=(text.match(/\p{Script=Latin}/gu)??[]).length,total=han+latin;
  if(han>200&&han/total>.35)return 'zh';
  const words=text.toLowerCase().match(/[a-z]+/g)??[],english=new Set(['the','and','of','to','in','that','is','for','with','as','on','are','we','by','this']),matched=words.filter(word=>english.has(word));
  // shortcut: lexical language confidence is conservative; use verified bibliographic language evidence for multilingual collections.
  if(latin>200&&han/total<.05&&new Set(matched).size>=5&&matched.length/words.length>.08)return 'en';return 'unknown';
}
export function normalizeDoi(value:string){return value.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//,'');}
export function normalizeArxivId(value:string){return value.trim().toLowerCase().replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//,'').replace(/^arxiv:/,'').replace(/\.pdf$/,'').replace(/v\d+$/,'');}
export function workId(p:{doi?:string;arxivId?:string;title:string;authors:string[]}){
  const identity=p.doi?`doi:${normalizeDoi(p.doi)}`:p.arxivId?`arxiv:${normalizeArxivId(p.arxivId)}`:`title:${p.title.normalize('NFKC').toLowerCase().replace(/\s+/g,' ')}:${[...p.authors].sort().join('|')}`;
  return `paper_${hash(identity).slice(0,32)}`;
}
function dateRange(date:string):[string,string]|null{
  const parts=date.split('-').map(Number),year=parts[0]!;if(year<1900||year>2100)return null;
  const month=parts[1]??1,day=parts[2]??1,first=new Date(Date.UTC(year,month-1,day));
  if(first.getUTCFullYear()!==year||first.getUTCMonth()!==month-1||first.getUTCDate()!==day)return null;
  const last=parts.length===1?new Date(Date.UTC(year,11,31)):parts.length===2?new Date(Date.UTC(year,month,0)):first;
  return [first.toISOString().slice(0,10),last.toISOString().slice(0,10)];
}
export function researchWindow(asOf:string){
  const range=dateRange(asOf);invariant(range&&range[0]===range[1],'LC_INVALID_ARGUMENT','Query date must be an exact valid date');
  const end=new Date(asOf+'T00:00:00Z'),year=end.getUTCFullYear()-5,month=end.getUTCMonth(),day=Math.min(end.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate());
  return {start:new Date(Date.UTC(year,month,day)).toISOString().slice(0,10),end:asOf};
}
export function paperIssues(p:Paper,q:z.infer<typeof researchQuerySchema>){
  const issues:string[]=[],window=researchWindow(q.asOf),date=p.published?dateRange(p.published):null;
  if(!date||date[0]<window.start||date[1]>window.end)issues.push('Publication date is outside the frozen window or insufficiently precise');
  const arxivValue=p.arxivId??p.doi?.match(/arxiv\.(.+)$/i)?.[1],arxiv=arxivValue?normalizeArxivId(arxivValue).match(/^(?:[a-z-]+\/)?(\d{2})(\d{2})(?:\.|\d{3}$)/):null,firstMonth=arxiv?`${Number(arxiv[1])>=91?'19':'20'}${arxiv[1]}-${arxiv[2]}`:null,firstRange=firstMonth?dateRange(firstMonth):null;
  if(firstRange&&firstRange[1]<window.start)issues.push('Known arXiv first-public month predates the window; later publication cannot reset age');
  const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s.,-]/g,'');
  if(!p.authors.some(a=>q.groupMembers.some(m=>normalize(a)===normalize(m))))issues.push('No confirmed group member is an author');
  if(p.language==='unknown')issues.push('Original body language is not established');
  if(!p.revisionId)issues.push('Readable source body is missing');
  if(p.extractionIssues?.length)issues.push('Source extraction has unresolved quality issues');
  if(!p.participationEvidence)issues.push('Paper-level group participation evidence is missing');
  return issues;
}
export function selectPapers(papers:Paper[],minimum:number){
  const target=Math.ceil(minimum/3)*3,eligible=[...new Map(papers.filter(p=>p.decision==='include').map(p=>[p.workId,p])).values()].sort((a,b)=>a.workId.localeCompare(b.workId));
  const zh=eligible.filter(p=>p.language==='zh'),en=eligible.filter(p=>p.language==='en');
  const bodySeen=new Set<string>(),duplicates:string[]=[];const unique=(list:Paper[])=>list.filter(p=>{if(bodySeen.has(p.bodyHash)){duplicates.push(p.workId);return false;}bodySeen.add(p.bodyHash);return true;}),uniqueZh=unique(zh),uniqueEn=unique(en);
  const selected=[...uniqueZh.slice(0,target/3),...uniqueEn.slice(0,target*2/3)];
  return {target,duplicates,selected: selected.map(p=>p.workId),missing:{zh:Math.max(0,target/3-uniqueZh.length),en:Math.max(0,target*2/3-uniqueEn.length)}};
}

export function paperDateOutside(p:Paper,q:z.infer<typeof researchQuerySchema>){const range=p.published?dateRange(p.published):null,window=researchWindow(q.asOf);return !!range&&(range[1]<window.start||range[0]>window.end);}

/** Bind every readable code point to a source excerpt; the model selects ids, never retypes quotes. */
export function researchEvidence(text:string){return (text.match(/[\s\S]{1,120}/gu)??[]).filter(quote=>quote.trim()).map((quote,index)=>({quoteId:`q${index}`,quote}));}
