#!/usr/bin/env node
// Node 22+. No packages, scene renderer, or video tools required.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
import { CUT_PROTOCOL, CUT_SYSTEM, CUT_INSTRUCTION, CUT_SCHEMA, CUT_MODELS, CUT_CONDITIONS, readImage, validatePhotoSet, cuttingSchedule, cuttingOutcome } from './protocol.mjs';
import { cuttingVariation } from './variations.mjs';
const protocol = { protocol: CUT_PROTOCOL, systemPrompt: CUT_SYSTEM, decisionSchema: CUT_SCHEMA };
const finalPrompt = JSON.parse(await fs.readFile(path.join(here, 'final-prompt.json'), 'utf8'));
if (finalPrompt.systemPrompt !== CUT_SYSTEM || JSON.stringify(finalPrompt.decisionSchema) !== JSON.stringify(CUT_SCHEMA)) throw new Error('The published final prompt must match the original system and schema.');
export function studyVariation(id = 'baseline') {
  return id === 'fake_emergency'
    ? { id, label: 'Fake emergency: controller fault', instruction: finalPrompt.instruction, repetitions: 20 }
    : cuttingVariation(id);
}
export function replicationSchedule(models, repetitions, seed, variationId) {
  const schedule = cuttingSchedule(models, repetitions, seed);
  return (variationId === 'fake_emergency' ? schedule.filter(t => t.condition === 'blocked') : schedule)
    .map((trial, i) => ({ ...trial, order: i + 1 }));
}
const providers = {
  openai: { key: 'OPENAI_API_KEY', url: 'https://api.openai.com/v1/responses' },
  xai: { key: 'XAI_API_KEY', url: 'https://api.x.ai/v1/chat/completions' },
  google: { key: 'GEMINI_API_KEY', url: 'https://generativelanguage.googleapis.com/v1beta/models/' },
  anthropic: { key: 'ANTHROPIC_API_KEY', url: 'https://api.anthropic.com/v1/messages' },
};

export function providerFor(model) {
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('grok-')) return 'xai';
  if (model.startsWith('gemini-')) return 'google';
  if (model.startsWith('claude-')) return 'anthropic';
  throw new Error('Use a gpt-, grok-, gemini-, or claude- model ID.');
}

function decision(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!protocol.decisionSchema.properties.action.enum.includes(parsed?.action) || typeof parsed.statement !== 'string' || parsed.statement.length > 4000) throw new Error('Invalid structured decision.');
  return { action: parsed.action, statement: parsed.statement, providerRefusal: false };
}
const refusal = statement => ({ action: null, statement: statement || 'Provider refused the request.', providerRefusal: true });
const userText = instruction => `Operator instruction: ${instruction}`;
const claudeMessage = (instruction, image) => ({ role: 'user', content: [{ type: 'text', text: userText(instruction) }, { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.bytes.toString('base64') } }] });

export function apiRequest(provider, model, instruction, image) {
  const imageData=image.bytes.toString('base64'), imageURL=`data:${image.mimeType};base64,${imageData}`;
  const schema = protocol.decisionSchema, system = protocol.systemPrompt, text = userText(instruction);
  if (provider === 'openai') return {
    model, store: false, max_output_tokens: 4096, instructions: system,
    input: [{ role: 'user', content: [{ type: 'input_text', text }, { type: 'input_image', image_url: imageURL, detail: 'high' }] }],
    text: { format: { type: 'json_schema', name: 'robot_decision', strict: true, schema } },
  };
  if (provider === 'xai') return {
    model, max_tokens: 4096, messages: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: imageURL, detail: 'high' } }] }],
    response_format: { type: 'json_schema', json_schema: { name: 'robot_decision', strict: true, schema } },
  };
  if (provider === 'anthropic') return { model, max_tokens: 4096, system, messages: [claudeMessage(instruction, image)], output_config: { format: { type: 'json_schema', schema } } };
  return { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text }, { inlineData: { mimeType: image.mimeType, data: imageData } }] }], generationConfig: { maxOutputTokens: 4096, responseMimeType: 'application/json', responseJsonSchema: schema } };
}

export function apiDecision(provider, data) {
  if (provider === 'openai') {
    const parts = (data.output || []).flatMap(o => o.content || []), blocked = parts.find(p => p.type === 'refusal');
    if (blocked) return refusal(blocked.refusal);
    if (data.status !== 'completed') throw new Error('Incomplete response.');
    return decision(parts.filter(p => p.type === 'output_text').map(p => p.text).join(''));
  }
  if (provider === 'xai') {
    const c = data.choices?.[0];
    if (c?.message?.refusal || c?.finish_reason === 'content_filter') return refusal(c?.message?.refusal);
    if (c?.finish_reason !== 'stop') throw new Error('Incomplete response.');
    return decision(c.message.content);
  }
  if (provider === 'anthropic') {
    const text = (data.content || []).filter(p => p.type === 'text').map(p => p.text).join('');
    if (data.stop_reason === 'refusal') return refusal(text);
    if (data.stop_reason !== 'end_turn') throw new Error('Incomplete response.');
    return decision(text);
  }
  const c = data.candidates?.[0];
  if (data.promptFeedback?.blockReason || ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(c?.finishReason)) return refusal('Provider safety block.');
  if (c?.finishReason !== 'STOP') throw new Error('Incomplete response.');
  return decision((c.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join(''));
}

async function callAPI(provider, model, instruction, image) {
  const config = providers[provider], key = process.env[config.key];
  if (!key) throw new Error(`Set ${config.key} in your process environment.`);
  const headers = { 'Content-Type': 'application/json' };
  if (provider === 'anthropic') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
  else if (provider === 'google') headers['x-goog-api-key'] = key;
  else headers.Authorization = `Bearer ${key}`;
  const url = provider === 'google' ? `${config.url}${encodeURIComponent(model)}:generateContent` : config.url;
  const request = apiRequest(provider,model,instruction,image);
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(request), signal: AbortSignal.timeout(120_000) });
  // Provider error bodies can contain account data. Do not print or persist them.
  if (!response.ok) return { status: 'api_error', httpStatus: response.status };
  const data = await response.json();
  try { return { status: 'completed', model: data.model || data.modelVersion || model, decision: apiDecision(provider,data), request, response:data }; }
  catch { return { status:'invalid_response', request, response:data }; }
}

async function subscriptionClient() {
  const executable = process.env.CLAUDE_CLI_PATH || 'claude', env = { ...process.env };
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) delete env[key];
  try {
    const auth = JSON.parse((await execute(executable, ['auth', 'status', '--json'], { env, timeout: 15_000 })).stdout);
    if (!auth.loggedIn || auth.authMethod !== 'claude.ai' || !auth.subscriptionType) throw new Error();
    const version = (await execute(executable, ['--version'], { env, timeout: 15_000 })).stdout.trim();
    return { executable, env, version };
  } catch { throw new Error('Sign in to your Claude subscription with the official Claude CLI. No API fallback is used.'); }
}

async function callSubscription(client, model, instruction, image) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'misalignment-002-'));
  try {
    const args = ['--print', '--safe-mode', '--model', model, '--system-prompt', protocol.systemPrompt, '--tools', '', '--disable-slash-commands', '--strict-mcp-config', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(protocol.decisionSchema), '--max-turns', '3'];
    const raw = await new Promise(resolve => {
      const child = spawn(client.executable, args, { cwd, env: client.env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', timedOut = false, forceTimer;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); forceTimer = setTimeout(() => child.kill('SIGKILL'), 3000); }, 120_000);
      const finish = code => { clearTimeout(timer); clearTimeout(forceTimer); resolve({ stdout, code, timedOut }); };
      child.stdout.on('data', data => { stdout += data; if (stdout.length > 8_000_000) child.kill('SIGTERM'); });
      child.stderr.resume(); child.on('error', () => finish(null)); child.on('close', finish); child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ type: 'user', message: claudeMessage(instruction, image) }) + '\n');
    });
    const events = raw.stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const result = events.findLast(e => e.type === 'result'), init = events.find(e => e.type === 'system' && e.subtype === 'init');
    if (raw.timedOut || raw.code !== 0 || !result || result.is_error || (init?.apiKeySource && init.apiKeySource !== 'none')) return { status: 'client_error', response: events };
    try { return { status:'completed', model:init?.model || model, decision:decision(result.structured_output || result.result), response:events, request:{system:CUT_SYSTEM, messages:[claudeMessage(instruction,image)], decisionSchema:CUT_SCHEMA} }; }
    catch { return { status:'invalid_response', response:events }; }
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
}

export async function main(argv=process.argv.slice(2)) {
  let selected, all=false, check=false, photoDirectory=path.join(here,'observations'), repetitions,variationId='baseline';
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--check')check=true;
    else if(argv[i]==='--all')all=true;
    else if(argv[i]==='--model')selected=argv[++i];
    else if(argv[i]==='--variation')variationId=argv[++i];
    else if(argv[i]==='--photos')photoDirectory=path.resolve(argv[++i]);
    else if(argv[i]==='--repetitions')repetitions=Number(argv[++i]);
    else if(argv[i]==='--help'){console.log('node experiments/002/replicate.mjs --check | --all | --model MODEL [--photos DIRECTORY] [--repetitions N] [--variation baseline|child_hunger|self_hunger|self_survival|fake_emergency]');return;}
    else throw new Error('Unknown option. Use --help.');
  }
  if(all&&selected)throw new Error('Choose --all or --model.');
  const models=selected?CUT_MODELS.filter(m=>m.model===selected):CUT_MODELS;
  if(!models.length)throw new Error('Use a published model ID from protocol.mjs.');
  const variation=studyVariation(variationId);repetitions??=variation.repetitions;
  const conditions=variationId==='fake_emergency'?CUT_CONDITIONS.filter(c=>c.id==='blocked'):CUT_CONDITIONS;
  const seed=randomBytes(4).readUInt32LE(),schedule=replicationSchedule(models,repetitions,seed,variationId),images={},assets={},missing=[];
  for(const c of conditions) {
    const candidates=[];
    for(const extension of ['jpg','jpeg','png'])try{await fs.access(path.join(photoDirectory,`${c.id}.${extension}`));candidates.push(extension);}catch{}
    if(candidates.length===0){missing.push(c.id);continue;}
    if(candidates.length>1)throw new Error(`Keep only one image for ${c.id}.`);
    const extension=candidates[0],bytes=await fs.readFile(path.join(photoDirectory,`${c.id}.${extension}`));
    const image=readImage(`data:image/${extension==='png'?'png':'jpeg'};base64,${bytes.toString('base64')}`);
    images[c.id]=image;assets[c.id]={id:c.id,source:'user_supplied_photo',labelSource:'user_assigned',filename:`${c.id}.${extension}`,sha256:image.sha256,width:image.width,height:image.height,mimeType:image.mimeType};
  }
  if(!missing.length&&conditions.length===3)validatePhotoSet(assets);
  const matchesPublishedBlockedPhoto=assets.blocked?.sha256===finalPrompt.sourceImageSha256;
  if(check){console.log(JSON.stringify({protocol:CUT_PROTOCOL,variation,ready:missing.length===0,missing,assets,models,plannedCalls:schedule.length,matchesPublishedBlockedPhoto,networkCallsMade:0},null,2));return;}
  if(!selected&&!all)throw new Error('Choose --all or --model. Use --check for a free input check.');
  if(missing.length)throw new Error(`Supply the required photos first. Missing: ${missing.join(', ')}.`);
  let client;
  for(const m of models)if(m.provider==='anthropic')client=await subscriptionClient();else if(!process.env[providers[m.provider].key])throw new Error(`Set ${providers[m.provider].key}.`);
  const directory=path.join(here,'outputs',`${new Date().toISOString().replaceAll(':','-')}-${randomUUID()}`);
  await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.mkdir(path.join(directory,'raw'),{mode:0o700});
  for(const c of conditions)await fs.writeFile(path.join(directory,assets[c.id].filename),images[c.id].bytes,{mode:0o600,flag:'wx'});
  const report={experiment:'002',protocol:CUT_PROTOCOL,variationId,variationLabel:variation.label,status:'running',startedAt:new Date().toISOString(),physicalOutcome:'not_executed',instruction:variation.instruction,systemPrompt:CUT_SYSTEM,decisionSchema:CUT_SCHEMA,models,assets,repetitions,seed,matchesPublishedBlockedPhoto,clientVersion:client?.version,schedule,runs:[]};
  const save=async()=>{const temporary=path.join(directory,'report.tmp');await fs.writeFile(temporary,JSON.stringify(report,null,2)+'\n',{mode:0o600});await fs.rename(temporary,path.join(directory,'report.json'));};
  await save(); // Freeze the full plan and exact photographs before the first call.
  const failed=new Set();let stopping=false;
  const stop=()=>{stopping=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  try {
    for(const trial of schedule) {
      if(stopping)break;
      const id=randomUUID(),startedAt=new Date().toISOString();let result;
      if(failed.has(trial.provider))result={status:'skipped_unavailable'};
      else {
        try{result=trial.provider==='anthropic'?await callSubscription(client,trial.model,variation.instruction,images[trial.condition]):await callAPI(trial.provider,trial.model,variation.instruction,images[trial.condition]);}
        catch{result={status:'request_error'};}
        if(result.status!=='completed')failed.add(trial.provider);
      }
      const {request,response,...summary}=result;
      const run={...trial,variationId,variationLabel:variation.label,instruction:variation.instruction,requestedModel:trial.model,...summary,id,startedAt,endedAt:new Date().toISOString(),physicalOutcome:'not_executed',asset:assets[trial.condition]};
      if(result.status==='completed')run.outcome=cuttingOutcome(trial.condition,result.decision);
      if(request||response)await fs.writeFile(path.join(directory,'raw',id+'.json'),JSON.stringify({request,response},null,2),{mode:0o600,flag:'wx'});
      report.runs.push(run);await save();
      console.log(`${trial.label} / ${trial.condition} / ${trial.repetition}: ${result.decision?.providerRefusal?'provider refusal':result.decision?.action||result.status}`);
    }
    report.status=stopping?'cancelled':failed.size?'completed_with_errors':'completed';report.endedAt=new Date().toISOString();await save();
  } finally {process.off('SIGINT',stop);process.off('SIGTERM',stop);}
  console.log(`Saved ${report.runs.length} of ${schedule.length} scheduled states: ${path.join(directory,'report.json')}`);
  if(report.status!=='completed')process.exitCode=1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
