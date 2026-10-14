import type {Context} from '@deepseek-ai/cordis';
import {SessionId} from '@deepseek-ai/dsh-session';
import {ToolCallId} from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-agent';
import {z} from 'zod';
import {LcError,invariant} from '../core/errors.js';
import './host.js';
export const name='long-context-web';
export const inject=['longContext','connection','agents','agentPresets'];
const inputSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('snapshot'),sessionId:z.string().min(1)}).strict(),
  z.object({action:z.literal('execute'),sessionId:z.string().min(1),tool:z.string().regex(/^lc_[a-z_]+$/),arguments:z.record(z.string(),z.unknown())}).strict()
]);
/** Authentication and Host/Origin admission are provided by the native Connection route. */
export function createWebHandler(ctx:Context){return async(request:Request):Promise<Response>=>{
  try{
    invariant(request.method==='POST','LC_INVALID_ARGUMENT','Use POST');const raw=await request.text();invariant(Buffer.byteLength(raw)<=65536,'LC_BUDGET_EXCEEDED','Request exceeds 64 KiB');const input=inputSchema.parse(JSON.parse(raw));
    const agent=ctx.agents.get(SessionId(input.sessionId));invariant(agent&&agent.session.id===input.sessionId,'LC_INVALID_ARGUMENT','请先打开或恢复此会话');
    const enabled=ctx.agentPresets.composedPreset(agent.ctx)==='long-context';
    if(input.action==='snapshot'){
      if(!enabled)return Response.json({enabled:false,version:'0.3.0-beta.1',message:'请新建工作区会话并选择 Long Context 模式。已有 standard 会话保持原模式。'},{headers:{'Cache-Control':'no-store'}});
      const engine=await ctx.longContext.engine(agent.ctx,agent),store=engine.store,documents=[];
      for(const id of (await store.documentIds()).slice(-30)){const d=await store.document(id);documents.push({revisionId:id,path:d.path,format:d.format,pages:d.pages,length:d.length,qualityIssueCount:d.qualityIssues.length});}
      const tasks=[];for(const id of (await store.taskIds()).slice(-30)){const t=await store.task(id);if(t)tasks.push({taskId:id,kind:'edit',state:t.state,journalRevision:t.journalRevision,owned:t.ownerSession===agent.session.id,goal:t.goal.request,calls:t.calls,tokens:t.tokens,attention:t.attention,candidate:t.candidate,planId:t.plan?.planId??null});}
      for(const id of (await store.workflowIds()).slice(-30)){const t=await store.workflow(id);if(t)tasks.push({taskId:id,kind:t.taskKind,state:t.state,journalRevision:t.journalRevision,owned:t.ownerSession===agent.session.id,goal:t.taskKind==='generation'?t.goal.title:t.query.question,calls:t.calls,tokens:t.tokens,attention:t.attention,logicalPages:t.taskKind==='generation'?t.units.length:null,targetPages:t.taskKind==='generation'?t.goal.pages:null,candidate:t.taskKind==='generation'?t.candidate:null});}
      return Response.json({enabled:true,version:'0.3.0-beta.1',workspace:agent.session.header.cwd,busy:agent.status==='running',documents,tasks,limit:'最多显示30份文档、30个编辑任务和30个检索/生成任务；完整记录请导出任务报告。'},{headers:{'Cache-Control':'no-store'}});
    }
    invariant(enabled,'LC_PERMISSION_DENIED','请使用 Long Context 模式');
    invariant(agent.ctx.tools.schemas(agent).some(t=>t.name===input.tool),'LC_PERMISSION_DENIED','Tool is unavailable in this session');
    const data=await agent.runMaintenance(async signal=>agent.ctx.tools.execute({callId:ToolCallId(`web-${crypto.randomUUID()}`),name:input.tool,arguments:input.arguments,agent,signal:AbortSignal.any([signal,request.signal])}));
    if(data.isError)throw new LcError('LC_INVALID_ARGUMENT','工具执行失败，请检查会话与参数');return Response.json(data.value,{headers:{'Cache-Control':'no-store'}});
  }catch(error){const known=error instanceof LcError,invalid=error instanceof z.ZodError||error instanceof SyntaxError;return Response.json({ok:false,error:{code:known?error.code:invalid?'LC_INVALID_ARGUMENT':'LC_WEB_OPERATION_FAILED',message:known?error.message:invalid?'请求参数无效':'操作未完成；请刷新任务状态后重试，勿假定已经回滚。'}},{status:known&&error.code==='LC_PERMISSION_DENIED'?403:known||invalid?400:409,headers:{'Cache-Control':'no-store'}});}
};}
export function apply(ctx:Context){const connection=ctx.get('connection');if(connection)ctx.effect(()=>connection.fetch.register({path:'/api/long-context',methods:['POST'],requestBody:'buffered',fetch:createWebHandler(ctx)}));}
