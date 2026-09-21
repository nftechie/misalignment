import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const providers={openai:{key:'OPENAI_API_KEY',url:'https://api.openai.com/v1/responses'},xai:{key:'XAI_API_KEY',url:'https://api.x.ai/v1/chat/completions'},google:{key:'GEMINI_API_KEY',url:'https://generativelanguage.googleapis.com/v1beta/models/'}};
export function subscriptionEnvironment(source=process.env){const env={...source};for(const k of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL','CLAUDE_CODE_USE_BEDROCK','CLAUDE_CODE_USE_VERTEX','CLAUDE_CODE_USE_FOUNDRY'])delete env[k];return env;}
export async function preflight(models){
 let client;
 for(const m of models){
  if(m.provider==='anthropic'){
   const executable=process.env.CLAUDE_CLI_PATH||'claude',env=subscriptionEnvironment();
   try{const auth=JSON.parse((await exec(executable,['auth','status','--json'],{env,timeout:15000})).stdout);if(!auth.loggedIn||auth.authMethod!=='claude.ai'||!auth.subscriptionType)throw Error();client={executable,env};}
   catch{throw Error('Sign in to the official Claude CLI with your local subscription. No API fallback is used.');}
  }else if(!process.env[providers[m.provider]?.key])throw Error('Set '+providers[m.provider]?.key+' in your environment.');
 }
 return client;
}
export function parseNative(provider,response){
 if(provider==='openai'){const parts=(response.output||[]).filter(o=>o.type==='message').flatMap(o=>o.content||[]),refusal=parts.filter(c=>c.type==='refusal').map(c=>c.refusal).join('\n');return {text:parts.filter(c=>c.type==='output_text').map(c=>c.text).join('\n')||refusal,providerRefusal:Boolean(refusal),complete:response.status==='completed',returnedModel:response.model};}
 if(provider==='xai'){const c=response.choices?.[0];return {text:c?.message?.content||c?.message?.refusal||'',providerRefusal:Boolean(c?.message?.refusal||c?.finish_reason==='content_filter'),complete:['stop','content_filter'].includes(c?.finish_reason),returnedModel:response.model};}
 const c=response.candidates?.[0],refusal=response.promptFeedback?.blockReason||(['SAFETY','BLOCKLIST','PROHIBITED_CONTENT'].includes(c?.finishReason)?c.finishReason:null);
 return {text:(c?.content?.parts||[]).filter(p=>!p.thought&&typeof p.text==='string').map(p=>p.text).join('\n')||refusal||'',providerRefusal:Boolean(refusal),complete:Boolean(refusal)||c?.finishReason==='STOP',returnedModel:response.modelVersion};
}
export function subscriptionArgs(request){return ['--print','--safe-mode','--model',request.model,'--system-prompt',request.system,'--tools','','--disable-slash-commands','--strict-mcp-config','--no-session-persistence','--input-format','stream-json','--output-format','stream-json','--verbose','--max-turns','1'];}
async function subscription(client,request){
 const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'misalignment-003-'));let raw;
 try{raw=await new Promise(resolve=>{
  const child=spawn(client.executable,subscriptionArgs(request),{cwd,env:client.env,stdio:['pipe','pipe','pipe']});let stdout='',timedOut=false,forceTimer;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');forceTimer=setTimeout(()=>child.kill('SIGKILL'),3000);},180000);
  const finish=code=>{clearTimeout(timer);clearTimeout(forceTimer);resolve({stdout,code,timedOut});};
  child.stdout.on('data',d=>{stdout+=d;if(stdout.length>8000000)child.kill('SIGTERM');});child.stderr.resume();child.on('error',()=>finish(null));child.on('close',finish);child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({type:'user',message:request.messages[0]})+'\n');
 });}finally{await fs.rm(cwd,{recursive:true,force:true});}
 const events=raw.stdout.split('\n').flatMap(l=>{try{return[JSON.parse(l)];}catch{return[];}}),init=events.find(e=>e.type==='system'&&e.subtype==='init'),result=events.findLast(e=>e.type==='result');
 if(init?.apiKeySource!=='none'||!Array.isArray(init?.tools)||init.tools.length)return {text:'',complete:false,error:'unexpected_client_access'};
 const text=typeof result?.result==='string'?result.result:events.filter(e=>e.type==='assistant').flatMap(e=>e.message?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
 return {text,complete:!raw.timedOut&&raw.code===0&&Boolean(result)&&!result.is_error,providerRefusal:false,returnedModel:init?.model,error:raw.timedOut?'timeout':result?.is_error?'client_error':undefined};
}
export async function call(model,request,client){
 try{
  if(model.provider==='anthropic')return await subscription(client,request);
  const cfg=providers[model.provider],headers={'Content-Type':'application/json'};
  if(model.provider==='google')headers['x-goog-api-key']=process.env[cfg.key];else headers.Authorization='Bearer '+process.env[cfg.key];
  const url=model.provider==='google'?cfg.url+encodeURIComponent(model.model)+':generateContent':cfg.url;
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(request),signal:AbortSignal.timeout(180000)});
  if(!response.ok)return {text:'',complete:false,error:'http_'+response.status};
  return parseNative(model.provider,await response.json());
 }catch{return {text:'',complete:false,error:'request_failed_or_timed_out'};}
}
