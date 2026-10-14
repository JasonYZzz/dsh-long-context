import {invariant} from '../core/errors.js';
export function extractText(bytes:Uint8Array,format:string):string {
  invariant(['txt','md','tex','pdf-text'].includes(format),'LC_FORMAT_UNSUPPORTED','Supported formats: UTF-8 TXT, Markdown, single-file LaTeX, accepted PDF text');
  invariant(!Buffer.from(bytes.slice(0,8)).toString('latin1').startsWith('%PDF-')&&!(bytes[0]===0x50&&bytes[1]===0x4b),'LC_FORMAT_UNSUPPORTED','Native PDF/DOCX must not be imported as plain text');
  let text:string; try {text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);} catch {throw new Error('LC_ENCODING_UNSUPPORTED: supply UTF-8 text');}
  invariant(!text.includes('\0'),'LC_FORMAT_UNSUPPORTED','Binary input is not text');
  invariant(text.length>0,'LC_EXTRACTION_INCOMPLETE','Empty text cannot establish document coverage');
  if(format==='tex') invariant(!/\\(?:input|include|bibliography)\s*\{/.test(text),'LC_FORMAT_UNSUPPORTED','Multi-file LaTeX requires an expanded source; includes are not silently ignored');
  return text;
}
