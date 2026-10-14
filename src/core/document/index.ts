import type {Config} from '../config.js';
import {invariant,LcError} from '../errors.js';
import type {Anchor,Block,DocumentRevision,ReadPage} from '../types.js';
import {canonical,hash,length,points,slice} from '../util.js';
export function chunk(text:string,revisionId:string,config:Config):Block[] {
  const chars=points(text),blocks:Block[]=[]; let start=0,line=1,page=1; const sections:string[]=[];
  while(start<chars.length){
    let end=Math.min(start+config.blockTargetCodePoints,chars.length);
    if(end<chars.length){
      const lower=start+Math.floor(config.blockTargetCodePoints*.65),upper=Math.min(start+config.blockMaxCodePoints,chars.length);
      let boundary=-1;
      for(let i=end;i>=lower;i--) if(chars[i-1]==='\n'||/[。！？.!?]/u.test(chars[i-1]??'')){boundary=i;break;}
      if(boundary<0) for(let i=end;i<upper;i++) if(chars[i]==='\n'){boundary=i+1;break;}
      if(boundary>start) end=boundary;
    }
    const content=chars.slice(start,end).join('');
    const title=content.match(/(?:^|\n)#{1,6}\s+([^\n]+)|\\(?:sub)*section\*?\{([^}]+)\}/u);
    if(title) sections.splice(0,sections.length,title[1]??title[2]??'');
    const newlines=(content.match(/\n/g)??[]).length,breaks=(content.match(/\f/g)??[]).length;
    const blockId=`b_${blocks.length.toString().padStart(6,'0')}`;
    blocks.push({blockId,revisionId,start,end,length:end-start,contentHash:hash(content),sectionPath:[...sections],
      pageStart:text.includes('\f')?page:null,pageEnd:text.includes('\f')?page+breaks:null,
      lineStart:line,lineEnd:line+newlines,previous:blocks.at(-1)?.blockId??null,next:null,
      kind:/^\s*\|/m.test(content)?'table':/\\begin\{(?:equation|align)/.test(content)?'formula':'text'});
    const previous=blocks.at(-2);if(previous)previous.next=blockId;
    start=end;line+=newlines;page+=breaks;
  }
  return blocks;
}
export function anchor(document:DocumentRevision,text:string|readonly string[],blockId:string,start:number,end:number):Anchor {
  const block=document.blocks.find(b=>b.blockId===blockId);
  invariant(block&&Number.isInteger(start)&&Number.isInteger(end)&&start>=block.start&&start<block.end&&end<=document.length&&end>=start,'LC_EVIDENCE_MISMATCH','Range lies outside its document or starting block',blockId);
  return {revisionId:document.revisionId,start,end,textHash:hash(slice(text,start,end))};
}
export function validateAnchor(document:DocumentRevision,text:string|readonly string[],a:Anchor,quote?:string):void {
  invariant(a.revisionId===document.revisionId,'LC_STALE_REVISION','Anchor belongs to another revision');
  const block=anchorBlock(document,a);const actual=anchor(document,text,block.blockId,a.start,a.end);
  invariant(actual.textHash===a.textHash&&(quote===undefined||slice(text,a.start,a.end)===quote),'LC_EVIDENCE_MISMATCH','Evidence must match the exact source range',block.blockId);
}
interface Cursor {revisionId:string;blockId:string;start:number;end:number;position:number;}
export function readRange(document:DocumentRevision,text:string,input:{blockId:string;start?:number;end?:number;cursor?:string},budget:number):ReadPage {
  const block=document.blocks.find(b=>b.blockId===input.blockId);invariant(block,'LC_INVALID_ARGUMENT','Unknown block');
  let range:Cursor={revisionId:document.revisionId,blockId:input.blockId,start:input.start??block.start,end:input.end??block.end,position:input.start??block.start};
  if(input.cursor){
    try {const envelope=JSON.parse(Buffer.from(input.cursor,'base64url').toString()) as {range:Cursor;hash:string};invariant(hash(canonical(envelope.range))===envelope.hash,'LC_INVALID_ARGUMENT','Invalid cursor checksum');range=envelope.range;}catch(error){if(error instanceof LcError)throw error;throw new LcError('LC_INVALID_ARGUMENT','Malformed cursor');}
    invariant(range.revisionId===document.revisionId,'LC_STALE_CURSOR','Cursor belongs to a different document revision');
    invariant(range.blockId===input.blockId&&(input.start===undefined||input.start===range.start)&&(input.end===undefined||input.end===range.end),'LC_STALE_CURSOR','Cursor range changed');
  }
  invariant(Number.isInteger(range.position)&&range.position>=range.start&&range.position<range.end,'LC_INVALID_ARGUMENT','Invalid cursor position');
  anchor(document,text,range.blockId,range.start,range.end);
  invariant(budget>=1000,'LC_RESULT_BUDGET_TOO_SMALL','Cannot fit complete read metadata');
  let end=Math.min(range.position+Math.max(1,budget-1100),range.end);
  let result:ReadPage;
  while(true){
    const next={...range,position:end};
    result={text:slice(text,range.position,end),anchor:anchor(document,text,range.blockId,range.position,end),completeRange:{start:range.position,end},
      nextCursor:end<range.end?Buffer.from(JSON.stringify({range:next,hash:hash(canonical(next))})).toString('base64url'):null,total:range.end-range.start};
    const size=length(JSON.stringify(result));if(size<=budget)return result;
    end-=Math.max(1,Math.ceil((size-budget)/2));invariant(end>range.position,'LC_RESULT_BUDGET_TOO_SMALL','Read envelope does not fit');
  }
}
export function locateQuote(document:DocumentRevision,text:string,blockId:string,quote:string,relativeStart?:number):Anchor {
  const block=document.blocks.find(b=>b.blockId===blockId);invariant(block,'LC_EVIDENCE_MISMATCH','Unknown block');
  const content=slice(text,block.start,Math.min(document.length,block.end+length(quote)-1));
  if(relativeStart!==undefined){const start=block.start+relativeStart;const a=anchor(document,text,blockId,start,start+length(quote));validateAnchor(document,text,a,quote);return a;}
  const first=content.indexOf(quote);invariant(first>=0&&content.indexOf(quote,first+1)<0,'LC_EVIDENCE_MISMATCH','Quote missing or ambiguous; supply a Unicode start offset');
  const start=block.start+length(content.slice(0,first));return anchor(document,text,blockId,start,start+length(quote));
}

export function anchorBlock(document:DocumentRevision,a:Anchor):Block {
  const block=document.blocks.find(b=>b.start<=a.start&&a.start<b.end);
  invariant(block&&a.revisionId===document.revisionId,'LC_EVIDENCE_MISMATCH','Anchor has no valid starting block');return block;
}
