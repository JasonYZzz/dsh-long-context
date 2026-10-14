import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import type {ModelPort,ModelResponse} from '../core/ports/index.js';
import {invariant} from '../core/errors.js';
import {length} from '../core/util.js';
export class DshModelAdapter implements ModelPort {
  constructor(private readonly ctx:Context,private readonly agent:Agent,private readonly maxOutputTokens:number){}
  async generate(input:string,signal:AbortSignal):Promise<ModelResponse>{
    const current=this.agent.session.requestHeader()?.config,provider=current?.provider??this.agent.options.provider,model=current?.model??this.agent.options.model;
    invariant(provider&&model,'LC_MODEL_UNAVAILABLE','Select a DSH provider/model before scanning');
    const response:ModelResponse={text:'',provider,model,usage:null,finishReason:'missing-finish'};
    for await(const chunk of this.ctx.llm.stream({provider,model,reasoningEffort:current?.reasoningEffort??this.agent.options.reasoningEffort,
      maxTokens:this.maxOutputTokens,temperature:0,messages:[{role:'user',content:[{type:'text',text:input}]}],signal,sessionId:this.agent.session.id})){
      if(chunk.type==='text-delta'){response.text+=chunk.text;invariant(length(response.text)<=this.maxOutputTokens*16,'LC_MODEL_INCOMPLETE','Auxiliary output exceeds bounded response size');}
      if(chunk.type==='usage')response.usage={input:chunk.usage.inputTokens,output:chunk.usage.outputTokens};
      if(chunk.type==='finish')response.finishReason=chunk.reason.kind;
    }
    signal.throwIfAborted();return response;
  }
}
