export interface FilePort {
  read(path:string,signal?:AbortSignal):Promise<Uint8Array>;
  create(path:string,text:string,signal?:AbortSignal):Promise<void>;
  replace(path:string,expectedHash:string,text:string,signal?:AbortSignal):Promise<void>;
}
export interface ModelResponse {text:string;provider:string;model:string;usage:{input:number;output:number}|null;finishReason:string;}
export interface ModelPort {generate(input:string,signal:AbortSignal):Promise<ModelResponse>;}
