import type {JsonValue} from '@deepseek-ai/dsh-util-values';
import type {ToolResult,ToolResultView} from '@deepseek-ai/dsh-tools';
import {length} from '../core/util.js';
import {invariant} from '../core/errors.js';
export function renderResult(value:JsonValue,budget:number){const text=JSON.stringify(value);invariant(length(text)<=budget,'LC_RESULT_BUDGET_TOO_SMALL','Tool projection exceeds active render budget');return [{type:'text' as const,text}];}
export function presentResult(tool:string,result:ToolResult):ToolResultView {
  return {card:'generic',title:tool,content:result.content};
}
