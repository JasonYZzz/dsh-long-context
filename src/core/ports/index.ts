export interface FilePort {
  read(path:string,signal?:AbortSignal):Promise<Uint8Array>;
  create(path:string,text:string,signal?:AbortSignal):Promise<void>;
  replace(path:string,expectedHash:string,text:string,signal?:AbortSignal):Promise<void>;
}
export interface ModelResponse {text:string;provider:string;model:string;usage:{input:number;output:number}|null;finishReason:string;reasoningChunks?:number;}
export interface ModelPort {generate(input:string,signal:AbortSignal):Promise<ModelResponse>;}

export class ModelFailure extends Error {
  constructor(message:string,readonly response:ModelResponse,options?:ErrorOptions){super(message,options);this.name='ModelFailure';}
}

export interface RenderPort {render(units:string[],title:string,signal?:AbortSignal):Promise<{bytes:Uint8Array;pages:number;renderer:string;templateHash:string}>;}
