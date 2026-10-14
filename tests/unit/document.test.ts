import {describe,it,expect} from 'vitest';
import {harness} from '../helpers.js';
import {readRange,resolveConfig,chunk,hash,length,locateQuote,validateAnchor} from '../../src/core/index.js';
describe('lossless source evidence',()=>{
  it('reconstructs a long Unicode line including text after character 2501',async()=>{
    const source='甲😀'.repeat(4000)+'TAIL_AFTER_2501\r\n{{do_not_interpolate}}';const h=await harness(source,{blockTargetCodePoints:4000,blockMaxCodePoints:6000,maxToolResultCodePoints:2000});
    try{let reconstructed='';for(const block of h.doc.blocks){let cursor:string|undefined;
      do{const page=await h.engine.read({revisionId:h.doc.revisionId,blockId:block.blockId,cursor});expect(length(JSON.stringify(page))).toBeLessThanOrEqual(2000);reconstructed+=page.text;cursor=page.nextCursor??undefined;}while(cursor);}
      expect(reconstructed).toBe(source);expect(hash(reconstructed)).toBe(h.doc.sourceHash);
    }finally{await h.cleanup();}
  });
  it('rejects mixed revision/range cursors and ambiguous evidence',async()=>{
    const h=await harness('同句。同句。'+'x'.repeat(3000));try{
      const first=readRange(h.doc,await h.store.getObject(h.doc.textHash),{blockId:h.doc.blocks[0]!.blockId},1300);expect(first.nextCursor).not.toBeNull();
      const nextDoc={...h.doc,revisionId:'rev_other'};
      expect(()=>readRange(nextDoc,'',{blockId:h.doc.blocks[0]!.blockId,cursor:first.nextCursor!},1300)).toThrow(/revision/);
      expect(()=>locateQuote(h.doc,'同句。同句。'+'x'.repeat(3000),h.doc.blocks[0]!.blockId,'同句。')).toThrow(/ambiguous/);
      const a=locateQuote(h.doc,'同句。同句。'+'x'.repeat(3000),h.doc.blocks[0]!.blockId,'同句。',3);expect(()=>validateAnchor(h.doc,'同句。同句。'+'x'.repeat(3000),{...a,textHash:hash('other')})).toThrow(/exact/);
    }finally{await h.cleanup();}
  });
  it('chunks every character without gaps or double counting',()=>{
    const source=Array.from({length:100},(_,i)=>`# Page ${i}\n${'中文😀 formula $x$ '.repeat(100)}\f`).join('');const blocks=chunk(source,'rev_test',resolveConfig());
    expect(blocks[0]!.start).toBe(0);expect(blocks.at(-1)!.end).toBe(length(source));
    blocks.forEach((b,i)=>{expect(b.end-b.start).toBeLessThanOrEqual(6000);if(i)expect(b.start).toBe(blocks[i-1]!.end);});
  });
  it('detects source changes during cursor traversal',async()=>{const h=await harness('z'.repeat(5000),{maxToolResultCodePoints:2000});try{
    const p=await h.engine.read({revisionId:h.doc.revisionId,blockId:h.doc.blocks[0]!.blockId});h.files.seed('paper.md','external change');
    await expect(h.engine.read({revisionId:h.doc.revisionId,blockId:h.doc.blocks[0]!.blockId,cursor:p.nextCursor!})).rejects.toMatchObject({code:'LC_STALE_CURSOR'});
  }finally{await h.cleanup();}});
  it('rejects binary and unexpanded LaTeX instead of pretending to cover them',async()=>{const h=await harness();try{
    h.files.seed('paper.tex','\\input{chapter}');await expect(h.engine.importDocument({path:'paper.tex'})).rejects.toMatchObject({code:'LC_FORMAT_UNSUPPORTED'});
    h.files.seed('scan.pdf','%PDF-1.7\0binary');await expect(h.engine.importDocument({path:'scan.pdf',format:'txt'})).rejects.toMatchObject({code:'LC_FORMAT_UNSUPPORTED'});
  }finally{await h.cleanup();}});
});
