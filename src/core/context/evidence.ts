import type {DocumentRevision,Task,Anchor} from '../types.js';
import {anchor,anchorBlock} from '../document/index.js';
import {length,slice} from '../util.js';
import {invariant} from '../errors.js';
/** Exact definitions persist in the immutable document; summaries never replace evidence. */
export function definitionAnchors(doc:DocumentRevision,text:string):Anchor[]{
  const result:Anchor[]=[];let start=0;
  for(const line of text.split(/(?<=\n)/u)){
    const end=start+length(line);
    if(/(?:定义|阈值|假设|约束|适用范围|definition|defined as|\bmeans\b|threshold|assumption|constraint)/iu.test(line)&&line.trim()){
      const block=doc.blocks.find(b=>b.start<=start&&start<b.end)!;result.push(anchor(doc,text,block.blockId,start,end));
    }start=end;
  }return result;
}
export function evidenceContext(task:Task,doc:DocumentRevision,text:string,blockId:string,budget:number){
  const current=doc.blocks.find(b=>b.blockId===blockId)!,ranges:Anchor[]=[...(doc.definitions??[])];
  for(const edge of task.dependencies)if(edge.evidenceAnchors.some(a=>a.start<current.end&&a.end>current.start))ranges.push(...edge.evidenceAnchors);
  const unique=[...new Map(ranges.map(a=>[`${a.start}:${a.end}`,a])).values()];
  const result=unique.map(a=>({blockId:anchorBlock(doc,a).blockId,start:a.start,end:a.end,anchor:a,text:slice(text,a.start,a.end)}));
  invariant(length(JSON.stringify(result))<=budget,'LC_BUDGET_EXCEEDED','Required definitions and dependency evidence exceed the auxiliary evidence budget; increase the budget or review smaller semantic scopes');return result;
}
