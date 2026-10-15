import {canonical} from '../util.js';
import {invariant} from '../errors.js';

export interface Delta {path:string[];value?:unknown;append?:unknown[];remove?:true;}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function changes(before:unknown,after:unknown,path:string[]=[]):Delta[]{
  if(canonical(before)===canonical(after))return [];
  if(Array.isArray(before)&&Array.isArray(after)){
    if(after.length>=before.length&&before.every((v,i)=>canonical(v)===canonical(after[i])))return [{path,append:after.slice(before.length)}];
    if(before.length===after.length)return before.flatMap((v,i)=>changes(v,after[i],[...path,String(i)]));
  }
  if(object(before)&&object(after))return [...Object.keys(before).filter(k=>!Object.hasOwn(after,k)).map(k=>({path:[...path,k],remove:true as const})),...Object.keys(after).flatMap(k=>Object.hasOwn(before,k)?changes(before[k],after[k],[...path,k]):[{path:[...path,k],value:after[k]}])];
  return [{path,value:after}];
}
export function applyChanges(state:unknown,delta:Delta[],clone=true):unknown{
  let result=clone?structuredClone(state):state;
  for(const change of delta){
    invariant(Array.isArray(change.path)&&change.path.every(k=>typeof k==='string'&&!['__proto__','prototype','constructor'].includes(k)),'LC_STATE_CORRUPT','Unsafe event path');
    invariant([Object.hasOwn(change,'value'),Object.hasOwn(change,'append'),change.remove===true].filter(Boolean).length===1,'LC_STATE_CORRUPT','Invalid event change');
    if(change.path.length===0){invariant(Object.hasOwn(change,'value'),'LC_STATE_CORRUPT','Invalid root change');result=structuredClone(change.value);continue;}
    let parent=result as Record<string,unknown>;
    for(const key of change.path.slice(0,-1)){invariant(parent!==null&&typeof parent==='object'&&Object.hasOwn(parent,key),'LC_STATE_CORRUPT','Event path does not exist');parent=parent[key] as Record<string,unknown>;}
    const key=change.path.at(-1)!;invariant(parent!==null&&typeof parent==='object','LC_STATE_CORRUPT','Invalid event parent');
    if(change.remove)delete parent[key];
    else if(change.append){const current=parent[key];invariant(Array.isArray(current)&&Array.isArray(change.append),'LC_STATE_CORRUPT','Invalid append');current.push(...structuredClone(change.append));}
    else Object.defineProperty(parent,key,{value:structuredClone(change.value),enumerable:true,writable:true,configurable:true});
  }
  return result;
}
