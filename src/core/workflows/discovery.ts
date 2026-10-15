import {z} from 'zod';
import {invariant} from '../errors.js';

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Invalid exact date');
export const discoverySchema=z.object({query:z.string().min(1).max(1000),cursor:z.string().max(30000).optional(),from:date.optional(),until:date.optional(),rows:z.number().int().min(1).max(50).default(20)}).strict().refine(input=>!input.from||!input.until||input.from<=input.until,'Date bounds are reversed');
const pageSchema=z.object({message:z.object({items:z.array(z.object({DOI:z.string(),title:z.array(z.string()),author:z.array(z.object({given:z.string().optional(),family:z.string().optional()}).passthrough()).optional(),published:z.object({'date-parts':z.array(z.array(z.number()))}).optional(),abstract:z.string().optional()}).passthrough()),'next-cursor':z.string().optional()}).passthrough()}).passthrough();

/** A bounded metadata source, never a substitute for original-body evidence. */
export async function discoverMetadata(input:z.input<typeof discoverySchema>,signal?:AbortSignal){
  const query=discoverySchema.parse(input),url=new URL('https://api.crossref.org/works');url.searchParams.set('query',query.query);url.searchParams.set('rows',String(query.rows));url.searchParams.set('cursor',query.cursor??'*');
  const filter=[query.from?`from-pub-date:${query.from}`:null,query.until?`until-pub-date:${query.until}`:null].filter(Boolean);if(filter.length)url.searchParams.set('filter',filter.join(','));
  const timeout=AbortSignal.timeout(30000),response=await fetch(url,{signal:signal?AbortSignal.any([signal,timeout]):timeout,redirect:'error',headers:{'User-Agent':'dsh-long-context/0.4 (metadata discovery)'}});invariant(response.ok,'LC_SOURCE_UNAVAILABLE',`Crossref HTTP ${response.status}`);
  const reader=response.body?.getReader();invariant(reader,'LC_SOURCE_UNAVAILABLE','Crossref body unavailable');let raw='',size=0;const decoder=new TextDecoder();
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;invariant(size<=5_000_000,'LC_BUDGET_EXCEEDED','Crossref response exceeds five MB');raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel();}
  return {raw,page:pageSchema.parse(JSON.parse(raw)),url:url.href,fetchedAt:new Date().toISOString()};
}
