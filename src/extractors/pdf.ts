import {createRequire} from 'node:module';
import {dirname,join,sep} from 'node:path';
import {invariant,LcError} from '../core/errors.js';
export interface PdfExtraction {text:string;pages:number;qualityIssues:string[];}
export async function extractPdf(bytes:Uint8Array,signal?:AbortSignal):Promise<PdfExtraction>{
  invariant(Buffer.from(bytes.slice(0,8)).toString('latin1').startsWith('%PDF-'),'LC_FORMAT_UNSUPPORTED','PDF input has no PDF header');
  const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageRoot=dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const loading=getDocument({cMapUrl:join(packageRoot,'cmaps')+sep,cMapPacked:true,standardFontDataUrl:join(packageRoot,'standard_fonts')+sep,data:new Uint8Array(bytes),useSystemFonts:false,disableFontFace:true});
  const abort=()=>{void loading.destroy();};signal?.addEventListener('abort',abort,{once:true});
  try{
    signal?.throwIfAborted();const pdf=await loading.promise,qualityIssues:string[]=[],pages:string[]=[];
    invariant(pdf.numPages>0&&pdf.numPages<=1000,'LC_BUDGET_EXCEEDED','PDF page limit exceeded');
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){
      signal?.throwIfAborted();const page=await pdf.getPage(pageNumber),content=await page.getTextContent();let text='';
      let previous:{str:string;transform:number[];width:number}|null=null,overprinted=false;
      for(const item of content.items)if('str' in item){
        if(previous&&item.str&&item.str===previous.str&&Math.abs(item.transform[4]!-previous.transform[4]!)<Math.min(1,item.width/4)&&Math.abs(item.transform[5]!-previous.transform[5]!)<.2)overprinted=true;
        text+=item.str+(item.hasEOL?'\n':' ');previous=item;
      }
      if(overprinted)qualityIssues.push(`pdf:page:${pageNumber}:overprinted-text`);
      if(!text.trim())qualityIssues.push(`pdf:page:${pageNumber}:no-text`);
      if(text.includes('\0')||text.includes('\uFFFD'))qualityIssues.push(`pdf:page:${pageNumber}:unmapped-symbol`);
      const operators=await page.getOperatorList();
      if(operators.fnArray.some(op=>op===OPS.paintImageXObject||op===OPS.paintInlineImageXObject))qualityIssues.push(`pdf:page:${pageNumber}:image-content-not-extracted`);
      pages.push(text.replaceAll('\0','\uFFFD'));page.cleanup();
    }
    invariant(pages.some(p=>p.trim()),'LC_EXTRACTION_INCOMPLETE','PDF has no readable text; OCR is required');
    return {text:pages.join('\f'),pages:pdf.numPages,qualityIssues};
  }catch(error){signal?.throwIfAborted();if(error instanceof LcError)throw error;throw new LcError('LC_EXTRACTION_INCOMPLETE','PDF extraction failed; source retained for inspection');}
  finally{signal?.removeEventListener('abort',abort);await loading.destroy();}
}
