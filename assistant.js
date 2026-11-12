/* Mindline voice assistant (demo).
   Talks with the person before the tasks, answers questions about the check-in and the results screen.
   It gathers the person's own view of how they are doing; it never diagnoses or judges them.
   Speech: browser Web Speech API (recognition + synthesis). Replies: Anthropic Messages API, streamed,
   either directly with a key typed into the Assistant page or through the optional proxy in /worker. */
(function(){
"use strict";
const $ = s => document.querySelector(s);

/* ---------- settings ---------- */
const CFG = 'mindline.assistant.v1', KEY = 'mindline.assistant.key', PASS = 'mindline.assistant.pass';
const DEFAULTS = {enabled:true, mode:'direct', proxyUrl:'', model:'claude-sonnet-5-5', speak:true, listen:true, voice:'', rate:0.95, remember:false};
function store(name){ try{ return window[name] || null; }catch(e){ return null; } }
function sget(name,k){ try{ const s=store(name); return s ? (s.getItem(k)||'') : ''; }catch(e){ return ''; } }
function sset(name,k,v){ try{ const s=store(name); if(!s) return; if(v) s.setItem(k,v); else s.removeItem(k); }catch(e){} }
let cfg = Object.assign({}, DEFAULTS);
try{ Object.assign(cfg, JSON.parse(sget('localStorage', CFG) || '{}')); }catch(e){}
const secret = {key: sget('sessionStorage',KEY) || sget('localStorage',KEY), pass: sget('sessionStorage',PASS) || sget('localStorage',PASS)};
function saveCfg(){
  sset('localStorage', CFG, JSON.stringify(cfg));
  const keep = cfg.remember ? 'localStorage' : 'sessionStorage', drop = cfg.remember ? 'sessionStorage' : 'localStorage';
  sset(keep, KEY, secret.key); sset(keep, PASS, secret.pass); sset(drop, KEY, ''); sset(drop, PASS, '');
}
const ready = () => !!cfg.enabled && (cfg.mode==='proxy' ? !!cfg.proxyUrl : !!secret.key);

/* ---------- speech out ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const canListen = !!SR && window.isSecureContext;
const canSpeak = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
let voices = [];
function loadVoices(){ if(canSpeak) voices = speechSynthesis.getVoices().filter(v => /^en([-_]|$)/i.test(v.lang)); }
if(canSpeak){ loadVoices(); try{ speechSynthesis.addEventListener('voiceschanged', loadVoices); }catch(e){ speechSynthesis.onvoiceschanged = loadVoices; } }
function pickVoice(){
  if(cfg.voice){ const v = voices.find(v => v.name===cfg.voice); if(v) return v; }
  for(const re of [/natural/i,/enhanced|premium/i,/samantha/i,/google us english/i,/aria|jenny/i]){
    const v = voices.find(v => re.test(v.name) && /en[-_]US/i.test(v.lang)); if(v) return v;
  }
  return voices.find(v => /en[-_]US/i.test(v.lang)) || voices[0] || null;
}
let pending = 0, gen = 0, waiters = [];
const live = new Set(); // keeps utterances referenced so browsers don't drop their end events
function say(text, force){
  text = (text||'').trim();
  if(!canSpeak || !text || !(force || (cfg.enabled && cfg.speak))) return;
  const u = new SpeechSynthesisUtterance(text), v = pickVoice();
  if(v){ u.voice = v; u.lang = v.lang; }
  u.rate = cfg.rate;
  const g = gen; pending++; live.add(u);
  let done = false;
  const fin = () => { if(done) return; done = true; live.delete(u); clearTimeout(guard);
    if(g!==gen) return; pending = Math.max(0, pending-1); if(pending===0){ const w = waiters; waiters = []; w.forEach(f => f()); } };
  // Some browsers never fire end events (e.g. no voices installed); don't hang the conversation.
  const guard = setTimeout(fin, 4000 + text.split(/\s+/).length * 650 / cfg.rate + pending * 4000);
  u.onend = fin; u.onerror = fin;
  speechSynthesis.speak(u);
}
const whenSilent = () => new Promise(r => { if(pending===0) r(); else waiters.push(r); });
function stopVoice(){ gen++; pending = 0; waiters = []; if(canSpeak) speechSynthesis.cancel(); stopListening(); }

/* ---------- speech in ---------- */
let rec = null, finishListening = null;
function listenOnce(onInterim){
  return new Promise(resolve => {
    stopListening();
    const r = new SR(); rec = r;
    r.lang = 'en-US'; r.continuous = true; r.interimResults = true;
    let text = '', err = null, timer = null;
    const arm = ms => { clearTimeout(timer); timer = setTimeout(() => { try{ r.stop(); }catch(e){} }, ms); };
    r.onresult = e => {
      let fin = '', mid = '';
      for(let i=0;i<e.results.length;i++){ const t = e.results[i][0].transcript; if(e.results[i].isFinal) fin += t+' '; else mid += t+' '; }
      text = (fin+mid).replace(/\s+/g,' ').trim();
      if(onInterim) onInterim(text);
      arm(2400); // a pause of about 2.4 s ends the turn; older speakers often pause mid-thought
    };
    r.onerror = e => { err = e.error; };
    r.onend = () => { clearTimeout(timer); if(rec===r) rec = null; finishListening = null; resolve({text, error:err}); };
    finishListening = () => { clearTimeout(timer); try{ r.stop(); }catch(e){} };
    arm(10000); // stop waiting if nothing is said
    try{ r.start(); }catch(e){ rec = null; resolve({text:'', error:'start-failed'}); }
  });
}
function stopListening(){ if(rec){ try{ rec.abort(); }catch(e){} } }

/* Dictation into a text box (word recall). Returns a stop function. */
function dictate(ta, btn, onUse){
  if(!canListen || !cfg.enabled){ btn.hidden = true; return () => {}; }
  let r = null, blocked = false;
  const idle = () => { btn.classList.remove('live'); btn.textContent = blocked ? 'Microphone blocked' : 'Say the words'; };
  btn.addEventListener('click', () => {
    if(r){ try{ r.stop(); }catch(e){} return; }
    stopVoice();
    const base = ta.value.trim() ? ta.value.trim()+' ' : '';
    r = new SR(); r.lang = 'en-US'; r.continuous = true; r.interimResults = true;
    r.onresult = e => { let t = ''; for(let i=0;i<e.results.length;i++) t += e.results[i][0].transcript+' '; ta.value = base + t.replace(/\s+/g,' ').trim(); if(onUse) onUse(); };
    r.onerror = e => { if(e.error==='not-allowed' || e.error==='service-not-allowed') blocked = true; };
    r.onend = () => { r = null; idle(); };
    try{ r.start(); btn.classList.add('live'); btn.textContent = 'Listening… tap to stop'; }catch(e){ r = null; }
  });
  return () => { if(r){ try{ r.abort(); }catch(e){} r = null; } };
}

/* ---------- Claude API (streaming) ---------- */
function httpMessage(status, detail){
  if(status===401) return cfg.mode==='proxy' ? 'The proxy rejected the request. Check its API key.' : 'The API key was not accepted. Check it on the Assistant page.';
  if(status===403) return cfg.mode==='proxy' ? 'The passcode or page address was not accepted by the proxy.' : 'This API key is not allowed to make this request.';
  if(status===404) return 'The model name was not recognized. Check it on the Assistant page.';
  if(status===429) return 'Too many requests right now. Wait a moment and try again.';
  if(status===529 || status===503) return 'The assistant service is busy. Try again in a moment.';
  return `The assistant service returned an error (${status}). ${detail||''}`.trim();
}
async function stream(c, onText){
  const body = {model:cfg.model, max_tokens:c.maxTokens||600, system:c.system, messages:c.messages, stream:true};
  if(c.tools) body.tools = c.tools;
  const headers = {'content-type':'application/json'};
  let url;
  if(cfg.mode==='proxy'){ url = cfg.proxyUrl.replace(/\/+$/,'') + '/v1/messages'; headers['x-demo-passcode'] = secret.pass; }
  else { url = 'https://api.anthropic.com/v1/messages'; headers['x-api-key'] = secret.key; headers['anthropic-version'] = '2023-06-01'; headers['anthropic-dangerous-direct-browser-access'] = 'true'; }
  let r;
  try{ r = await fetch(url, {method:'POST', headers, body:JSON.stringify(body)}); }
  catch(e){ throw new Error('Could not reach the assistant service. Check the internet connection' + (cfg.mode==='proxy' ? ' and the proxy address.' : '.')); }
  if(!r.ok){ let d = ''; try{ const j = await r.json(); d = (j.error && j.error.message) || ''; }catch(e){} throw new Error(httpMessage(r.status, d)); }
  const reader = r.body.getReader(), dec = new TextDecoder();
  const blocks = []; let buf = '', stop = null;
  for(;;){
    const {value, done} = await reader.read();
    if(done) break;
    buf += dec.decode(value, {stream:true}).replace(/\r\n/g,'\n');
    let i;
    while((i = buf.indexOf('\n\n')) >= 0){
      const chunk = buf.slice(0,i); buf = buf.slice(i+2);
      const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
      if(!data) continue;
      let ev; try{ ev = JSON.parse(data); }catch(e){ continue; }
      if(ev.type==='content_block_start'){
        const b = ev.content_block || {};
        if(b.type==='text') blocks[ev.index] = {type:'text', text:b.text||''};
        else if(b.type==='tool_use') blocks[ev.index] = {type:'tool_use', id:b.id, name:b.name, json:''};
      } else if(ev.type==='content_block_delta'){
        const b = blocks[ev.index]; if(!b) continue;
        if(ev.delta.type==='text_delta'){ b.text += ev.delta.text; onText(ev.delta.text); }
        else if(ev.delta.type==='input_json_delta') b.json += ev.delta.partial_json;
      } else if(ev.type==='message_delta'){ stop = ev.delta && ev.delta.stop_reason; }
      else if(ev.type==='error'){ throw new Error((ev.error && ev.error.message) || 'The assistant service returned an error.'); }
    }
  }
  const content = blocks.filter(Boolean).filter(b => b.type!=='text' || b.text.trim()).map(b => {
    if(b.type==='text') return {type:'text', text:b.text};
    let input = {}; try{ input = b.json ? JSON.parse(b.json) : {}; }catch(e){}
    return {type:'tool_use', id:b.id, name:b.name, input};
  });
  return {content, stop};
}

/* ---------- prompts ---------- */
const BASE = `You are the voice assistant in Mindline, a demonstration app for a 10-minute cognitive check-in. The check-in has five tasks: learning a list of 10 words (memory), a reaction-time task where the person taps when a panel turns green (alertness and speed), matching symbols to numbers for 90 seconds (processing speed), connecting circles in the order 1, A, 2, B and so on (attention and switching), and recalling the words again at the end (memory). Results are compared only with the person's own earlier check-ins. The first check-in counts as practice, and comparisons start after two more. Results are stored only in this browser. What the person says to you is sent to an AI service to produce your replies. Mindline is a demo and is not a medical device.

You are an AI, not a clinician. You said so when you greeted the person, and you say so plainly whenever asked.

How you speak
- Your replies are read aloud by a speech synthesizer. Use plain conversational English in one to three short sentences. No lists, headings, markdown, emoji, or symbols that sound odd read aloud.
- Ask at most one question per turn, and leave the person room to talk.
- The person's words come from speech recognition and may contain mistakes. If something seems garbled, kindly ask them to say it again rather than guessing.
- Be warm, patient and respectful. Speak to an adult, never down to them.

Boundaries that always apply
- Never diagnose, and never suggest the person does or doesn't have a condition.
- Never judge or comment on how well the person seems, sounds, remembers or is doing cognitively. That includes reassurance such as "you sound sharp" or "that's normal at your age".
- Don't give medical advice, and don't comment on medications or treatments. If the person has concerns about their memory or health, acknowledge them and encourage them to talk with their doctor, who can do a proper assessment.
- If the person mentions sudden confusion, sudden trouble speaking or understanding, a drooping face, or sudden weakness or numbness on one side, tell them to call 911 right now, and call the pause_for_safety tool.
- If the person mentions thoughts of suicide or of hurting themselves, respond with care, tell them they can call or text 988 to reach the Suicide and Crisis Lifeline at any time, and call the pause_for_safety tool.
- If the person says someone is hurting, neglecting, threatening or taking advantage of them, respond with care, tell them the Eldercare Locator at 1-800-677-1116 can connect them with local help and that they should call 911 if they are in danger now, and call the pause_for_safety tool.
- Stay on the subject of the check-in and how the person is doing. If asked about unrelated things, answer very briefly or gently steer back.`;

function interviewPrompt(h){
  const today = new Date().toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'});
  const hist = !h.count ? `This is the person's first check-in, so it counts as practice.`
    : `The person has done ${h.count} check-in${h.count>1?'s':''} before. The most recent was ${h.lastDaysAgo===0?'earlier today':h.lastDaysAgo===1?'yesterday':h.lastDaysAgo+' days ago'}.` +
      (h.lastDaysAgo < 7 ? ` Mindline suggests waiting at least a week between check-ins because the tasks get easier with practice. You may mention this once, but it is their choice.` : '');
  return `${BASE}

Your job right now
Today is ${today}. The person is about to start a check-in. Have a short, natural conversation, the way a kind clinic assistant checks in with someone before a test. You are gathering the person's own view of how they are doing. You are not assessing them. ${hist}

Over the conversation, learn these things one at a time, in whatever order flows naturally. Don't read them out as a checklist, and skip any the person has already covered:
- how they are feeling today
- how they slept last night
- whether they are unwell, in pain, or unusually tired
- whether they have had alcohol or started a new medication in the past day
- whether they have any concerns about their memory or thinking lately
- whether anyone close to them has mentioned changes
- whether they can work for about 10 minutes without interruption
- whether they have any questions before starting

When the person shares something, respond with a brief, genuine acknowledgement and, if it seems welcome, one follow-up question before moving on. If they don't want to talk about something, accept that and move on. Answer their questions about the check-in briefly.

Finishing
When you have covered these topics and the person has no more questions, or whenever they say they want to start, say one short sentence letting them know they can begin when they're ready, and call begin_tasks in the same turn. Fill the tool fields with what the person actually said, in their own words where possible, without adding your own interpretation. Use "not discussed" for anything that didn't come up. A typical conversation takes two to five minutes; don't drag it out.`;
}
function helpPrompt(t){
  return `${BASE}

Your job right now
The person is on the instructions screen for task ${t.n} of 5, "${t.title}", and tapped "Ask a question". The instructions on the screen say: "${t.instructions}"
Answer their questions about this task clearly and briefly. You can explain in general terms what the task measures and why it is included. Don't give strategies or tips for scoring better: each result is compared with the person's earlier ones, and coaching would make that comparison unfair. If asked, explain this kindly. When they have no more questions, tell them they can tap "Back to the task" when they're ready.`;
}
function resultsPrompt(summary){
  return `${BASE}

Your job right now
The person has just finished a check-in and tapped "Ask about these results". This is what the results screen shows them:
${summary}

Answer their questions about what the screen shows: what each task measures, and what the labels mean. "Building baseline" means there aren't enough earlier check-ins to compare with yet. "Within your usual range", "Lower than your usual" and "Better than your usual" compare today's result with the spread of the person's own earlier results. A check-in can be left out of the baseline when the person reported poor sleep, illness, alcohol or a new medication, or interruptions. The next check-in is best in about a month, at the same time of day, on the same device.
Don't add meaning beyond what the screen says, don't speculate about causes, and don't say whether the results are good or bad for their health. You may say that a single lower result is common and can come from sleep, stress or distraction. If the person is worried, or the screen suggests talking to a doctor, encourage them to talk with their doctor and to bring a backup of their results from the Your data page.`;
}
const SAFETY_TOOL = {name:'pause_for_safety',
  description:'Call when the person describes a possible medical emergency such as stroke symptoms, thoughts of suicide or self-harm, or being harmed, neglected or exploited by someone. The app pauses the check-in and shows emergency contacts on screen.',
  input_schema:{type:'object', properties:{concern:{type:'string', enum:['medical_emergency','self_harm','harm_by_others']}, note:{type:'string', description:'A brief factual note of what the person said.'}}, required:['concern']}};
const BEGIN_TOOL = {name:'begin_tasks',
  description:'Call when the pre-check-in conversation is finished and the person is ready to start, or as soon as they ask to start. The app then shows a Begin button. Record what the person said; do not interpret it.',
  input_schema:{type:'object', properties:{
    feeling:{type:'string', description:'How the person said they are feeling today, briefly and in their words.'},
    sleep:{type:'string', enum:['normal','poor','not discussed']},
    unwell:{type:'boolean', description:'True if they said they are unwell, in pain, or unusually tired.'},
    alcohol_or_new_medication:{type:'boolean', description:'True if they had alcohol or started a new medication in the past day.'},
    can_focus:{type:'boolean', description:'False if they said they may be interrupted or cannot focus for 10 minutes.'},
    concerns:{type:'string', description:"The person's own concerns about their memory or thinking, in their words, or 'none mentioned'."},
    others_noticed:{type:'string', description:"Whether anyone close to them has mentioned changes, in their words, or 'not discussed'."},
    questions:{type:'string', description:"Questions they asked about the check-in, briefly, or 'none'."}},
    required:['feeling','sleep','unwell','alcohol_or_new_medication','can_focus','concerns','others_noticed']}};

/* ---------- conversation UI ---------- */
let convo = null, lastFocus = null;
const STATE_LABEL = {idle:() => canListen ? 'Tap to talk' : 'Type your reply below', listening:() => 'Listening… tap when you’re done', thinking:() => 'Thinking…', speaking:() => 'Speaking… tap to interrupt'};
function setState(s, label){ $('#talk').dataset.state = s; $('#talk-state').textContent = label || STATE_LABEL[s](); }
function bubble(cls, text){ const d = document.createElement('div'); d.className = 'bub '+cls; d.textContent = text; $('#talk-log').appendChild(d); scrollLog(); return d; }
function scrollLog(){ const l = $('#talk-log'); l.scrollTop = l.scrollHeight; }

const SAFETY = {
  self_harm:`<p><strong>You don't have to go through this alone.</strong> Call or text <a href="tel:988">988</a> to reach the Suicide and Crisis Lifeline, any time. If you are in immediate danger, call <a href="tel:911">911</a>.</p>`,
  medical_emergency:`<p><strong>Call <a href="tel:911">911</a> now.</strong> Sudden confusion, trouble speaking, a drooping face, or weakness on one side can be signs of a stroke. Don't wait to see if it passes.</p>`,
  harm_by_others:`<p><strong>Help is available.</strong> The Eldercare Locator at <a href="tel:18006771116">1-800-677-1116</a> can connect you with local adult protective services. If you are in danger now, call <a href="tel:911">911</a>.</p>`
};
function showSafety(kind){
  const box = $('#talk-safety');
  if(!SAFETY[kind] || box.dataset.kinds && box.dataset.kinds.split(',').includes(kind)) return;
  box.dataset.kinds = (box.dataset.kinds ? box.dataset.kinds+',' : '') + kind;
  box.insertAdjacentHTML('beforeend', SAFETY[kind]);
  if(!box.querySelector('.btn-row')) box.insertAdjacentHTML('beforeend', `<div class="btn-row"><button class="btn ghost" type="button" id="talk-end">End this check-in</button></div>`);
  else box.appendChild(box.querySelector('.btn-row'));
  box.hidden = false;
  $('#talk-end').onclick = () => { close(); window.Mindline.show('home'); };
}
function safetyScan(text){
  if(/\b(kill(ing)? myself|suicid\w*|end(ing)? (it all|my life)|(don'?t|do not) want to (live|be alive|be here)|hurt(ing)? myself|better off dead)\b/i.test(text)) showSafety('self_harm');
  if(/\b(face (is |feels )?droop\w*|drooping|can'?t (move|feel) my (arm|leg|face|hand)|slurr\w*|sudden(ly)? (confus\w*|numb\w*|weak\w*)|numb\w* on one side|worst headache)\b/i.test(text)) showSafety('medical_emergency');
}

function open(c){
  stopVoice();
  lastFocus = document.activeElement;
  convo = Object.assign({messages:[{role:'user', content:c.opening}, {role:'assistant', content:c.greeting}], busy:false, ended:false, pendingTool:null}, c);
  $('#talk-log').innerHTML = '';
  const sb = $('#talk-safety'); sb.innerHTML = ''; sb.hidden = true; delete sb.dataset.kinds;
  $('#talk-begin').hidden = true;
  $('#talk-title').textContent = c.title;
  $('#talk-close').textContent = c.closeLabel || 'Close';
  $('#talk-input').value = '';
  $('#talk').hidden = false; document.documentElement.classList.add('talk-open');
  bubble('ai', c.greeting);
  $('#talk-mic').focus();
  replyDone(c.greeting);
}
function close(){
  stopVoice(); convo = null;
  $('#talk').hidden = true; document.documentElement.classList.remove('talk-open');
  if(lastFocus && document.contains(lastFocus)) try{ lastFocus.focus(); }catch(e){}
}
// After a reply: speak it (already queued when streaming), then listen automatically if allowed.
function replyDone(text){
  if(text) say(text);
  setState(pending ? 'speaking' : 'idle', convo && convo.ended ? 'Ready when you are' : undefined);
  const c = convo;
  whenSilent().then(() => {
    if(convo!==c || c.busy) return;
    if(!c.ended && cfg.listen && canListen) startListen();
    else setState('idle', c.ended ? 'Ready when you are' : undefined);
  });
}
async function startListen(){
  if(!convo || convo.busy || !canListen) return;
  const c = convo; setState('listening');
  let draft = null;
  const res = await listenOnce(t => { if(!draft) draft = bubble('me draft', ''); draft.textContent = t; scrollLog(); });
  if(convo!==c) return;
  if(res.error==='not-allowed' || res.error==='service-not-allowed'){ if(draft) draft.remove(); setState('idle', 'Microphone is blocked. Allow it in the browser, or type below.'); return; }
  if(res.error==='aborted' || !res.text){ if(draft) draft.remove(); if(!c.busy) setState('idle', res.error==='network' ? 'Speech recognition is unavailable. Type below.' : undefined); return; }
  draft.className = 'bub me';
  send(res.text, draft);
}
async function send(text, b){
  const c = convo;
  if(!c || c.busy || !text.trim()) return;
  if(!b) b = bubble('me', text);
  safetyScan(text);
  let content = text;
  if(c.pendingTool){ content = [{type:'tool_result', tool_use_id:c.pendingTool, content:'Recorded. The person is still talking.'}, {type:'text', text}]; c.pendingTool = null; c.ended = false; $('#talk-begin').hidden = true; }
  c.messages.push({role:'user', content});
  c.busy = true; setState('thinking');
  const ai = bubble('ai pending', '');
  let full = '', spoken = 0;
  try{
    const out = await stream(c, d => {
      if(convo!==c) return;
      full += d; ai.textContent = full; ai.classList.remove('pending'); scrollLog();
      const rest = full.slice(spoken), re = /[.!?]["')\]]?\s/g; let end = -1, m;
      while((m = re.exec(rest))) end = m.index + m[0].length;
      if(end > 0){ say(rest.slice(0,end)); spoken += end; if($('#talk').dataset.state==='thinking') setState(pending ? 'speaking' : 'thinking'); }
    });
    if(convo!==c) return;
    if(!out.content.length){ out.content = [{type:'text', text:'Sorry, could you say that again?'}]; full = out.content[0].text; ai.textContent = full; spoken = 0; }
    if(!full.trim()) ai.remove(); else ai.classList.remove('pending');
    c.messages.push({role:'assistant', content:out.content});
    c.busy = false;
    for(const t of out.content.filter(x => x.type==='tool_use')){ c.pendingTool = t.id; handleTool(c, t.name, t.input || {}); }
    if(convo!==c) return;
    replyDone(full.slice(spoken));
  }catch(err){
    if(convo!==c) return;
    ai.remove(); c.messages.pop(); c.busy = false;
    b.classList.add('failed');
    bubble('sys', err.message + ' You can try again' + (c.mode==='interview' ? ', or close the assistant and use the form.' : '.'));
    setState('idle');
  }
}
function handleTool(c, name, input){
  if(name==='pause_for_safety'){ showSafety(input.concern); c.ended = true; $('#talk-begin').hidden = true; return; }
  if(name==='begin_tasks' && c.mode==='interview'){ c.ended = true; c.result = input; if($('#talk-safety').hidden) $('#talk-begin').hidden = false; }
}
function transcript(c){
  return c.messages.slice(1).map(m => ({who: m.role==='assistant' ? 'assistant' : 'person',
    text: typeof m.content==='string' ? m.content : m.content.filter(b => b.type==='text').map(b => b.text).join(' ')})).filter(x => x.text.trim());
}

/* ---------- entry points ---------- */
function openInterview(){
  const h = window.Mindline.history();
  open({mode:'interview', title:'Before you begin', closeLabel:'Use the form instead', tools:[BEGIN_TOOL, SAFETY_TOOL], system:interviewPrompt(h),
    opening:'(The person has started a check-in, and the voice assistant has opened.)',
    greeting: h.count
      ? `Hi, welcome back. I'm the Mindline assistant. I'm an AI, not a doctor, and I'd like to check in with you before the tasks. How are you feeling today?`
      : `Hi, I'm the Mindline assistant. I'm an AI, not a doctor. Before the tasks, I'd like to hear how you're doing, and I can answer any questions about the check-in. How are you feeling today?`});
}
function openHelp(t){
  open({mode:'help', title:`Question about task ${t.n}`, closeLabel:'Back to the task', tools:[SAFETY_TOOL], system:helpPrompt(t),
    opening:`(The person tapped "Ask a question" on the instructions for task ${t.n}.)`, greeting:'Sure. What would you like to know about this task?'});
}
function openResults(summary){
  open({mode:'results', title:'About your results', closeLabel:'Close', tools:[SAFETY_TOOL], system:resultsPrompt(summary),
    opening:'(The person tapped "Ask about these results".)', greeting:'Happy to help. What would you like to know about today’s results?'});
}
function beginFromInterview(){
  const c = convo; if(!c || !c.result) return;
  const r = c.result;
  const ctx = {sleep: r.sleep==='poor' ? 'poor' : 'ok', unwell:!!r.unwell, subst:!!r.alcohol_or_new_medication, quiet: r.can_focus!==false};
  const interview = {feeling:r.feeling||'', sleep:r.sleep||'not discussed', concerns:r.concerns||'', othersNoticed:r.others_noticed||'', questions:r.questions||'', transcript:transcript(c)};
  close();
  window.Mindline.startRun(ctx, interview);
}

function bindUI(){
  $('#talk-close').addEventListener('click', close);
  $('#talk').addEventListener('keydown', e => { if(e.key==='Escape') close(); });
  $('#talk-mic').addEventListener('click', () => {
    if(!convo) return;
    const s = $('#talk').dataset.state;
    if(s==='speaking'){ stopVoice(); canListen ? startListen() : setState('idle'); }
    else if(s==='listening'){ if(finishListening) finishListening(); }
    else if(s==='idle' && !convo.busy){ canListen ? startListen() : $('#talk-input').focus(); }
  });
  $('#talk-form').addEventListener('submit', e => {
    e.preventDefault();
    const t = $('#talk-input').value.trim(); if(!t || !convo || convo.busy) return;
    $('#talk-input').value = ''; stopVoice(); send(t);
  });
  $('#talk-begin-btn').addEventListener('click', beginFromInterview);
  $('#talk-more').addEventListener('click', () => { $('#talk-begin').hidden = true; if(convo) convo.ended = false; canListen ? startListen() : $('#talk-input').focus(); });

  /* settings page */
  const f = $('#asst-form');
  f.addEventListener('change', e => { if(e.target.name==='asst-mode') syncMode(); });
  f.addEventListener('submit', e => { e.preventDefault(); readForm(); saveCfg(); msg('Saved.' + (ready() ? ' The assistant will start with your next check-in.' : cfg.enabled ? ' Add an API key or proxy to turn on the conversation.' : '')); });
  $('#asst-test-voice').addEventListener('click', () => { readForm(); stopVoice(); say('Hello. This is how I will sound when I read instructions and replies aloud.', true); });
  $('#asst-test').addEventListener('click', async () => {
    readForm();
    if(!(cfg.mode==='proxy' ? cfg.proxyUrl : secret.key)){ msg(cfg.mode==='proxy' ? 'Enter the proxy address first.' : 'Enter an API key first.', true); return; }
    msg('Testing…');
    try{ const out = await stream({system:'This is a connection test.', messages:[{role:'user', content:'Reply with the single word: ready'}], maxTokens:10}, () => {});
      msg(out.content.length ? 'Connected. The assistant is working. Press Save to keep these settings.' : 'Connected, but the reply was empty.'); }
    catch(err){ msg(err.message, true); }
  });
}
function msg(t, bad){ const m = $('#asst-msg'); m.hidden = false; m.textContent = t; m.style.color = bad ? 'var(--bad)' : ''; }
function syncMode(){ const p = $('#asst-mode-proxy').checked; $('#asst-direct').hidden = p; $('#asst-proxy').hidden = !p; }
function readForm(){
  cfg.enabled = $('#asst-enabled').checked;
  cfg.mode = $('#asst-mode-proxy').checked ? 'proxy' : 'direct';
  secret.key = $('#asst-key').value.trim(); secret.pass = $('#asst-pass').value;
  cfg.proxyUrl = $('#asst-proxy-url').value.trim();
  cfg.remember = $('#asst-remember').checked;
  cfg.model = $('#asst-model').value.trim() || DEFAULTS.model;
  cfg.speak = $('#asst-speak').checked; cfg.listen = $('#asst-listen').checked;
  cfg.voice = $('#asst-voice').value; cfg.rate = parseFloat($('#asst-rate').value) || 0.95;
}
function renderSettings(){
  loadVoices();
  const support = [];
  if(!window.isSecureContext) support.push('Voice input needs the page to be opened over https.');
  else if(!SR) support.push('This browser can’t listen. Voice input works in Chrome, Edge and Safari. You can still type.');
  if(!canSpeak) support.push('This browser can’t speak replies aloud.');
  const s = $('#asst-support');
  s.className = support.length ? 'notice' : 'notice ok';
  s.innerHTML = support.length ? `<p>${support.join(' ')}</p>` : `<p>Voice input and speech work in this browser. The first time you talk, the browser will ask for permission to use the microphone.</p>`;
  $('#asst-enabled').checked = cfg.enabled;
  $('#asst-mode-direct').checked = cfg.mode!=='proxy'; $('#asst-mode-proxy').checked = cfg.mode==='proxy'; syncMode();
  $('#asst-key').value = secret.key; $('#asst-pass').value = secret.pass; $('#asst-proxy-url').value = cfg.proxyUrl;
  $('#asst-remember').checked = cfg.remember; $('#asst-model').value = cfg.model;
  $('#asst-speak').checked = cfg.speak; $('#asst-listen').checked = cfg.listen; $('#asst-rate').value = cfg.rate;
  const sel = $('#asst-voice'); sel.innerHTML = '';
  const auto = document.createElement('option'); auto.value = ''; auto.textContent = 'Automatic'; sel.appendChild(auto);
  voices.forEach(v => { const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.name} (${v.lang})`; sel.appendChild(o); });
  sel.value = voices.some(v => v.name===cfg.voice) ? cfg.voice : '';
  $('#asst-msg').hidden = true;
}

window.Assistant = {
  ready, canSpeak:() => canSpeak && cfg.enabled && cfg.speak, voiceOn:() => cfg.enabled,
  say:t => say(t), stopVoice, dictate, openInterview, openHelp, openResults, renderSettings, bindUI
};
})();
