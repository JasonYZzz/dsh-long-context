import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import {ModelFailure,type ModelPort,type ModelResponse} from '../core/ports/index.js';
import {invariant} from '../core/errors.js';
import {length} from '../core/util.js';
import {ReasoningEffortId} from '@deepseek-ai/dsh-llm';
import type {Config} from '../core/config.js';
export class DshModelAdapter implements ModelPort {
  constructor(private readonly ctx:Context,private readonly agent:Agent,private readonly maxOutputTokens:number,private readonly options:Config['auxiliaryModel']={}){}
  async generate(input:string,signal:AbortSignal):Promise<ModelResponse>{
    const current=this.agent.session.requestHeader()?.config,provider=this.options.provider??current?.provider??this.agent.options.provider,model=this.options.model??current?.model??this.agent.options.model;
    invariant(provider&&model,'LC_MODEL_UNAVAILABLE','Select a DSH provider/model before scanning');
    const maxTokens=this.options.maxOutputTokens??this.maxOutputTokens;
    const reasoningEffort=this.options.reasoningEffort?ReasoningEffortId(this.options.reasoningEffort):current?.reasoningEffort??this.agent.options.reasoningEffort;
    const info=await this.ctx.llm.resolveModelInfo(provider,model,signal);
    if(this.options.reasoningEffort)invariant(info.reasoning?.efforts.some(e=>e.id===reasoningEffort),'LC_MODEL_UNAVAILABLE','Auxiliary reasoning effort is unsupported by the selected model');
    const response:ModelResponse={text:'',provider,model,usage:null,finishReason:'missing-finish',reasoningChunks:0};
    try{
    for await(const chunk of this.ctx.llm.stream({provider,model,reasoningEffort,
      maxTokens,temperature:0,messages:[{role:'user',content:[{type:'text',text:input}]}],signal,sessionId:this.agent.session.id})){
      if(chunk.type==='text-delta'){response.text+=chunk.text;invariant(length(response.text)<=maxTokens*16,'LC_MODEL_INCOMPLETE','Auxiliary output exceeds bounded response size');}
      if(chunk.type==='reasoning-delta')response.reasoningChunks!++;
      if(chunk.type==='usage')response.usage={input:chunk.usage.inputTokens,output:chunk.usage.outputTokens};
      if(chunk.type==='finish')response.finishReason=chunk.reason.kind;
    }
    signal.throwIfAborted();return response;
    }catch(error){throw new ModelFailure(error instanceof Error?error.message:String(error),response,{cause:error});}
  }
}
