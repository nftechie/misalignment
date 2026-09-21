#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {MODELS,hash,shuffle,requestFor,configuration,probePrompt,parseAction,IMAGE_SHA256} from './protocol.mjs';
import * as baseline from './baseline-protocol.mjs';
import {call,preflight} from './transport.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export async function main(argv=process.argv.slice(2)){
 let phase='confirmation',modelId,all=false,check=false,repetitions;
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--phase')phase=argv[++i];else if(argv[i]==='--model')modelId=argv[++i];else if(argv[i]==='--all')all=true;else if(argv[i]==='--check')check=true;else if(argv[i]==='--repetitions')repetitions=Number(argv[++i]);
  else if(argv[i]==='--help'){console.log('node experiments/003/replicate.mjs --check | --all | --model MODEL [--phase confirmation|controls|exploration|shortlist|baseline|recognition] [--repetitions N]');return;}else throw Error('Unknown option. Use --help.');
 }
 if(all&&modelId)throw Error('Choose --all or --model.');
 const old=phase==='baseline',vision=phase==='recognition',cfg=old||vision?{system:old?baseline.SYSTEM:baseline.VISION_SYSTEM,models:MODELS.map(m=>m.provider),repetitions:old?10:3,candidates:old?baseline.CONDITIONS:[{id:'recognition'}]}:configuration(phase);
 const models=MODELS.filter(m=>cfg.models.includes(m.provider)&&(!modelId||m.model===modelId));if(!models.length)throw Error('No published model matches this phase and selection.');
 repetitions??=cfg.repetitions;if(!Number.isInteger(repetitions)||repetitions<1||repetitions>1000)throw Error('Repetitions must be an integer from 1 to 1000.');
 const bytes=await fs.readFile(path.join(HERE,'observation.jpg'));if(hash(bytes)!==IMAGE_SHA256)throw Error('Input image hash differs from the published input. Use a separate study for changed images.');const image=bytes.toString('base64');
 const seed=randomBytes(4).readUInt32LE(),schedule=shuffle(Array.from({length:repetitions},(_,i)=>cfg.candidates.flatMap(c=>models.map(m=>({...m,candidate:c.id,repetition:i+1,id:randomUUID()})))).flat(),seed).map((r,i)=>({...r,order:i+1}));
 if(check){console.log(JSON.stringify({phase,models,repetitions,scheduledTrials:schedule.length,plannedCalls:schedule.length*(old?3:1),imageSha256:hash(bytes),networkCallsMade:0},null,2));return;}
 if(!all&&!modelId)throw Error('Choose --all or --model to make calls; --check is free.');const client=await preflight(models);
 const dir=path.join(HERE,'outputs',new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());await fs.mkdir(dir,{recursive:true,mode:0o700});
 const plan={experiment:'003',phase,createdAt:new Date().toISOString(),seed,repetitions,system:cfg.system,candidates:cfg.candidates,models,imageHash:hash(bytes),schedule,access:'Native API defaults; Claude local subscription. Sequential calls in this replication runner; original run used two native workers per provider and one Claude worker.',baseline:old?{inventory:baseline.INVENTORY,questions:baseline.QUESTIONS}:undefined};
 await fs.writeFile(path.join(dir,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});const records=[];let stopping=false;const stop=()=>{stopping=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{for(const trial of schedule){if(stopping)break;const c=cfg.candidates.find(c=>c.id===trial.candidate),turns=[];
  for(let step=0;step<(old?3:1);step++){
   const buyer=old&&step?baseline.QUESTIONS[step-1]:null,history=turns.map(t=>({buyer:t.buyer,assistant:t.text}));
   const text=old?baseline.promptFor(c.id,history,buyer):vision?baseline.VISION_PROMPT:probePrompt(c),request=requestFor(trial.provider,trial.model,c.system||cfg.system,text,image),raw=await call(trial,request,client);let action=null,error=raw.error;
   if(raw.complete&&!raw.providerRefusal)try{action=old?baseline.parseAction(raw.text):vision?{description:raw.text}:parseAction(raw.text,c.expectRecordCopy!==false);}catch{error='invalid_json_or_fields';}
   const turn={step,buyer,text:raw.text,action,status:action?'completed':raw.providerRefusal?'refusal':'error',error,returnedModel:raw.returnedModel,requestHash:hash(request)};turns.push(turn);
   await fs.writeFile(path.join(dir,trial.id+'-'+step+'.json'),JSON.stringify({trial,turn},null,2)+'\n',{flag:'wx',mode:0o600});
   if(old&&turn.status!=='completed')break;
  }
  records.push({...trial,turns});console.log(`${trial.label} / ${trial.candidate} / ${trial.repetition}: ${turns.map(t=>t.status).join(', ')}`);
 }}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({planHash:hash(plan),status:stopping?'interrupted':'finished',records},null,2)+'\n',{flag:'wx',mode:0o600});}
 console.log('Saved '+records.length+'/'+schedule.length+' scheduled trials to '+dir);if(stopping)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
