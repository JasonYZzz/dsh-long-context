import {createHash, randomUUID} from 'node:crypto';
import {invariant} from './errors.js';
export const hash = (input: string | Uint8Array): string => createHash('sha256').update(input).digest('hex');
export const id = (prefix: string): string => `${prefix}_${randomUUID()}`;
export const points = (text: string): string[] => Array.from(text);
export const length = (text: string): number => Array.from(text).length;
export const slice = (text: string, start: number, end?: number): string => Array.from(text).slice(start, end).join('');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  const result = JSON.stringify(value); invariant(result !== undefined, 'LC_INVALID_ARGUMENT', 'Value is not JSON'); return result;
}
export function safeId(value: string): string { invariant(/^[a-zA-Z0-9_-]{1,160}$/.test(value), 'LC_INVALID_ARGUMENT', 'Invalid identifier'); return value; }
export function checkSignal(signal?: AbortSignal): void { signal?.throwIfAborted(); }
export function mergeRanges(ranges: readonly {start:number;end:number}[]): {start:number;end:number}[] {
  const merged: {start:number;end:number}[] = [];
  for (const range of [...ranges].sort((a,b) => a.start-b.start)) {
    const tail=merged.at(-1); if(tail && range.start<=tail.end) tail.end=Math.max(tail.end,range.end); else merged.push({...range});
  }
  return merged;
}
