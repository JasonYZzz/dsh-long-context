import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {RenderPort} from '../core/ports/index.js';
import {hash} from '../core/util.js';
import {extractPdf} from '../extractors/pdf.js';
import {invariant} from '../core/errors.js';
const run=promisify(execFile),escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const css='@page{size:A4;margin:20mm}body{font-family:"PingFang SC","Noto Sans CJK SC",sans-serif;font-size:11pt;line-height:1.4}p{margin:0 0 8pt}pre{white-space:pre-wrap;word-wrap:break-word;font-family:inherit}';
/** Only escaped generated text enters a fixed HTML template, in a private temporary profile. */
export class OfficeRenderer implements RenderPort {
  constructor(readonly executable:string,readonly stateRoot:string,readonly fontconfigFile?:string){}
  async render(units:string[],title:string,signal?:AbortSignal){
    invariant(units.length>0,'LC_INVALID_ARGUMENT','No source units to render');const directory=await mkdtemp(join(resolve(this.stateRoot),'render-'));
    try{
      const fontconfig=this.fontconfigFile?await readFile(this.fontconfigFile):null,env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','SYSTEMROOT','USERPROFILE','WINDIR'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]!]));if(fontconfig)env.FONTCONFIG_FILE=resolve(this.fontconfigFile!);
      const html=`<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>${css}</style></head><body>${units.map((text,index)=>{const [first,...rest]=text.split('\n');return `<p style="page-break-before:${index?'always':'auto'}">${escape(first!)}</p>${rest.length?`<pre>${escape(rest.join('\n'))}</pre>`:''}`;}).join('')}</body></html>`;
      await writeFile(join(directory,'source.html'),html,{mode:0o600});
      await run(this.executable,[`-env:UserInstallation=${pathToFileURL(join(directory,'profile')).href}`,'--headless','--convert-to','pdf:writer_pdf_Export','--outdir',directory,join(directory,'source.html')],{cwd:directory,env,signal,timeout:180000,maxBuffer:100000});
      const {stdout:version}=await run(this.executable,['--version'],{env,signal,timeout:15000,maxBuffer:10000});
      const bytes=await readFile(join(directory,'source.pdf')),extracted=await extractPdf(bytes,signal);
      invariant(!extracted.qualityIssues.some(i=>i.endsWith('unmapped-symbol')||i.endsWith('no-text')),'LC_VERIFICATION_FAILED','Rendered PDF has missing text or unmapped characters');
      const normalize=(text:string)=>text.normalize('NFKC').replace(/[\s\u00ad]/gu,'');
      invariant(normalize(extracted.text)===normalize(units.join('')),'LC_VERIFICATION_FAILED','Rendered text differs from complete source; no truncation or missing glyphs allowed');
      return {bytes,pages:extracted.pages,renderer:version.trim(),templateHash:hash(css+'\n'+(fontconfig?hash(fontconfig):'system-fonts'))};
    }finally{await rm(directory,{recursive:true,force:true});}
  }
}
