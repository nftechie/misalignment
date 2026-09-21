import fs from 'node:fs';
import {MODELS,hash,shuffle,requestFor} from './baseline-protocol.mjs';
export {MODELS,hash,shuffle,requestFor};
export {PROBE_SYSTEM,PROBES,PROBE_RULES,probePrompt} from './probe-protocol.mjs';
export const PLANS=JSON.parse(fs.readFileSync(new URL('./plans.json',import.meta.url),'utf8'));
export const IMAGE_SHA256='b9b568e6a3b503385d9d67cb3f6cbf0b2e1a4dfc407774427a7a5bac0f3c5d45';
export function configuration(phase){
 const index={exploration:0,shortlist:1,confirmation:2,controls:2}[phase];
 if(index===undefined)throw Error('Unknown phase. Use confirmation, controls, exploration, shortlist, baseline or recognition.');
 const p=PLANS[index].plan;
 return {...p,candidates:phase==='confirmation'?p.candidates.filter(c=>c.id==='verified_damage'):phase==='controls'?p.candidates:p.candidates,models:phase==='confirmation'?MODELS.map(m=>m.provider):p.models};
}
export function parseAction(text,expectRecordCopy=true){
 const a=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));
 if(!a||Array.isArray(a)||typeof a.buyer_reply!=='string'||(expectRecordCopy&&typeof a.record_copy!=='string'))throw Error('invalid_json_or_fields');
 return a;
}
