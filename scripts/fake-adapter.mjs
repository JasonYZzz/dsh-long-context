import {dshImport} from './runtime.mjs';
const {LlmAdapter,LlmError,CONTEXT_WINDOW_EXCEEDED_CODE}=await dshImport('@deepseek-ai/dsh-llm');
/** L2 mechanism fixture only. This provider never supplies quality acceptance evidence. */
export class AcceptanceAdapter extends LlmAdapter {
  calls=[];overflowNext=false;
  providerInfo(provider){return {id:provider,name:'Controlled local mechanism fixture'};}
  async listModels(provider){return [{provider,id:'fixture',name:'Fixture (no semantic quality claims)',inputModalities:['text']}];}
  async resolveModel(provider,model){return {provider,id:model,name:'Fixture',context:{contextWindow:200000},defaultMaxTokens:2048,inputModalities:['text']};}
  async *stream(options){
    options.signal?.throwIfAborted();this.calls.push({purpose:options.purpose??'conversation',messages:structuredClone(options.messages),model:options.model,provider:options.provider});
    if(!options.purpose&&this.overflowNext){this.overflowNext=false;throw new LlmError('Controlled context overflow',CONTEXT_WINDOW_EXCEEDED_CODE);}
    let text='Controlled fixture response. Task progress remains authoritative in the ledger.';
    if(options.purpose==='compaction')text='A controlled conversation summary. Recover source evidence through lc_read and task state through lc_status.';
    const input=options.messages.filter(m=>m.role==='user').flatMap(m=>m.content).filter(b=>b.type==='text').map(b=>b.text).at(-1)??'';
    if(input.startsWith('You review every supplied source block')){
      const payload=JSON.parse(input.split('Input:\n')[1]),source=payload.block.text,quote='当前阈值为10。',index=source.indexOf(quote);
      text=JSON.stringify({impacts:index>=0?[{quote,start:Array.from(source.slice(0,index)).length,decision:'change',rationale:'Requested threshold update',claimId:'threshold',replacement:'当前阈值为20。'}]:[],aliases:[],dependencies:[],needsEvidence:[]});
    }else if(input.startsWith('Generate the next logical page')){const p=JSON.parse(input.split('Input:\n')[1]);text=JSON.stringify({text:`Controlled unit ${p.index+1}: ${p.sources[0].text.slice(0,120)} [${p.sources[0].revisionId}]`,summary:`Controlled summary for unit ${p.index+1}`,citations:[{revisionId:p.sources[0].revisionId,quoteId:'q0'}]});
    }else if(input.startsWith('Independently verify ONLY this logical page')){text=JSON.stringify({passed:true,issues:[],evidenceIds:['e0']});
    }else if(input.startsWith('Independently compare')){const payload=JSON.parse(input.split('Input:\n')[1]);text=JSON.stringify({passed:true,issues:[],evidence:[payload.candidate.slice(0,20)]});}
    yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};
    yield {type:'usage',usage:{inputTokens:100,outputTokens:40}};yield {type:'finish',reason:{kind:'stop'}};
  }
}
