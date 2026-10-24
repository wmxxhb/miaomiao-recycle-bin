const PROVIDERS = Object.freeze([
  { id:'deepseek', name:'DeepSeek', baseURL:'https://api.deepseek.com', protocol:'chat', model:'deepseek-flash', models:['deepseek-flash','deepseek-v4-pro'] },
  { id:'openai', name:'OpenAI', baseURL:'https://api.openai.com/v1', protocol:'responses', model:'gpt-4.1-mini', models:['gpt-4.1-mini'] },
  { id:'claude', name:'Claude', baseURL:'https://api.anthropic.com/v1', protocol:'claude', model:'claude-haiku-5-5', models:['claude-haiku-5-5','claude-sonnet-5-5','claude-opus-5-5'] },
  { id:'custom', name:'自定义服务', baseURL:'', protocol:'chat', model:'', models:[] },
]);
const PROTOCOLS=['chat','responses','claude'];

function normalizeBaseURL(value,allowEmpty=false) {
  const text=String(value||'').trim().replace(/\/+$/,'');
  if(!text&&allowEmpty)return '';
  if(/\bsk-[\w-]{8,}/.test(text))throw new Error('API 地址不能包含密钥，请使用 API Key 密码框');
  let url;try{url=new URL(text);}catch{throw new Error('请填写完整的 API 基础地址，例如 https://api.example.com/v1');}
  if(url.username||url.password||url.search||url.hash)throw new Error('API 地址不能包含账号、密码、查询参数或片段；密钥请填写在密码框中');
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw new Error('远程 API 必须使用 HTTPS，本机服务可使用 localhost 或 127.0.0.1 的 HTTP 地址');
  url.pathname=url.pathname.replace(/\/(?:chat\/completions|responses|messages|models)\/?$/,'').replace(/\/+$/,'');
  return url.href.replace(/\/+$/,'');
}
function normalizeProfile(id,value={}) {
  const preset=PROVIDERS.find(p=>p.id===id);if(!preset)throw new Error('未知 AI 厂商');
  const baseURL=normalizeBaseURL(value.baseURL??preset.baseURL,id==='custom');
  const protocol=PROTOCOLS.includes(value.protocol)?value.protocol:preset.protocol;
  const model=String(value.model??preset.model).trim();
  if(model.length>160||/[\r\n\x00-\x1f]/.test(model)||/\bsk-[\w-]{8,}/.test(model))throw new Error('模型名称格式不正确；密钥请填写在 API Key 密码框');
  const apiVersion=String(value.apiVersion||'2026-10-21').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(apiVersion))throw new Error('Claude API 版本应为 YYYY-MM-DD');
  const workspaceId=String(value.workspaceId||'').trim();
  if(workspaceId.length>160||/[\r\n\x00-\x1f]/.test(workspaceId)||/\bsk-[\w-]{8,}/.test(workspaceId))throw new Error('Workspace ID 格式不正确');
  return {baseURL,protocol,model,apiVersion,workspaceId};
}
function redact(text,key='') {
  let value=String(text||'');
  if(key)value=value.split(key).join('[密钥已隐藏]');
  return value.replace(/\bsk-[\w-]{8,}/g,'[密钥已隐藏]').replace(/(Bearer\s+)\S+/gi,'$1[密钥已隐藏]');
}
function apiError(status,message,key) {
  const hints={400:'请求参数或模型不匹配',401:'密钥无效或已过期',402:'账户余额不足',403:'没有访问权限，请检查模型与 Workspace',404:'接口地址或模型不存在',408:'服务响应超时',429:'请求过于频繁或额度不足',500:'厂商服务暂时出错',502:'上游服务暂时不可用',503:'厂商服务繁忙',529:'厂商服务繁忙'};
  const detail=redact(message,key).replace(/[\r\n]+/g,' ').slice(0,220);
  return new Error(`${hints[status]||'API 请求失败'}${status?`（HTTP ${status}）`:''}${detail?'：'+detail:''}`);
}
function makeRequest(profile,key,messages,system,maxTokens) {
  const headers={'Content-Type':'application/json','Accept':'text/event-stream'};
  let route,body;
  if(profile.protocol==='claude') {
    headers['x-api-key']=key;headers['anthropic-version']=profile.apiVersion;
    if(profile.workspaceId)headers['anthropic-workspace-id']=profile.workspaceId;
    route='messages';body={model:profile.model,system,messages,max_tokens:maxTokens,stream:true};
  } else {
    headers.Authorization='Bearer '+key;
    if(profile.protocol==='responses') {
      route='responses';body={model:profile.model,instructions:system,input:messages,max_output_tokens:maxTokens,stream:true,store:false};
    } else {
      route='chat/completions';body={model:profile.model,messages:[{role:'system',content:system},...messages],max_tokens:maxTokens,stream:true};
    }
  }
  return {url:normalizeBaseURL(profile.baseURL)+'/'+route,headers,body};
}
async function* readSSE(body) {
  const reader=body.getReader(),decoder=new TextDecoder();let buffer='',data=[],event='',eventBytes=0;
  try {
    while(true) {
      const chunk=await reader.read();
      buffer+=chunk.done?decoder.decode():decoder.decode(chunk.value,{stream:true});
      if(buffer.length>1024*1024)throw new Error('服务返回的数据行过大');
      let newline;
      while((newline=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,newline).replace(/\r$/,'');buffer=buffer.slice(newline+1);
        if(!line){if(data.length)yield {event,data:data.join('\n')};data=[];event='';eventBytes=0;}
        else if(line.startsWith('data:')){eventBytes+=line.length;if(eventBytes>1024*1024)throw new Error('服务返回的数据事件过大');data.push(line.slice(5).replace(/^ /,''));}
        else if(line.startsWith('event:'))event=line.slice(6).trim();
      }
      if(chunk.done)break;
    }
    if(buffer.startsWith('data:'))data.push(buffer.slice(5).replace(/^ /,''));
    if(data.length)yield {event,data:data.join('\n')};
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function readJSON(response) {
  if(!response.body)throw new Error('服务没有返回数据');
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
  try{while(true){const chunk=await reader.read();if(chunk.done){text+=decoder.decode();break;}text+=decoder.decode(chunk.value,{stream:true});if(text.length>2*1024*1024)throw new Error('服务返回的数据过大');}try{return JSON.parse(text);}catch{throw new Error('服务返回了无法识别的 JSON 数据，请确认接口地址和格式');}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function extractText(value,protocol) {
  if(protocol==='claude')return (value.content||[]).filter(p=>p.type==='text').map(p=>p.text||'').join('');
  if(protocol==='responses')return (value.output||[]).flatMap(p=>p.content||[]).filter(p=>p.type==='output_text'||p.type==='refusal').map(p=>p.text||p.refusal||'').join('');
  const content=value.choices?.[0]?.message?.content;
  return typeof content==='string'?content:Array.isArray(content)?content.map(p=>p.text||'').join(''):'';
}
async function streamReply({profile,key,messages,system,maxTokens=1024,signal,onText=()=>{},onThinking=()=>{},fetchImpl=fetch}) {
  if(!profile.baseURL||!profile.model)throw new Error('请先填写 API 地址和模型名称');
  const request=makeRequest(profile,key,messages,system,maxTokens);
  const response=await fetchImpl(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(request.body),signal,redirect:'error',credentials:'omit',cache:'no-store'});
  if(!response.ok){let detail='';try{const value=await readJSON(response);detail=value.error?.message||value.message||'';}catch{}throw apiError(response.status,detail,key);}
  let text='',complete=false,limited=false,usage=null;
  const append=part=>{if(typeof part!=='string')return;text+=part;if(text.length>64000)throw new Error('回复超过本机显示上限，请降低回复长度后重试');onText(text);};
  if(!(response.headers.get('content-type')||'').includes('text/event-stream')) {
    const value=await readJSON(response);if(value.error)throw apiError(0,value.error.message,key);
    append(extractText(value,profile.protocol));usage=value.usage;complete=true;
    limited=value.status==='incomplete'||value.stop_reason==='max_tokens'||value.choices?.[0]?.finish_reason==='length';
  } else {
    if(!response.body)throw new Error('服务没有返回回复流');
    for await(const item of readSSE(response.body)) {
      if(item.data==='[DONE]'){complete=true;break;}
      let value;try{value=JSON.parse(item.data);}catch{throw new Error('服务返回了无法识别的流式数据');}
      const type=value.type||item.event;
      if(value.error||type==='error'||type==='response.failed')throw apiError(0,value.error?.message||value.response?.error?.message||value.message||'服务中断了回复',key);
      if(profile.protocol==='responses') {
        if(type==='response.output_text.delta')append(value.delta);
        if(type==='response.refusal.delta')append(value.delta);
        if(type==='response.reasoning_summary_text.delta')onThinking();
        if(type==='response.completed'||type==='response.incomplete') {
          complete=true;limited=type==='response.incomplete';usage=value.response?.usage||usage;
          if(!text)append(extractText(value.response||{},'responses'));
        }
      } else if(profile.protocol==='claude') {
        if(type==='content_block_start'&&value.content_block?.type==='text')append(value.content_block.text);
        if(type==='content_block_delta'&&value.delta?.type==='text_delta')append(value.delta.text);
        if(type==='content_block_delta'&&value.delta?.type==='thinking_delta')onThinking();
        if(type==='message_start')usage=value.message?.usage||usage;
        if(type==='message_delta'){limited=value.delta?.stop_reason==='max_tokens';usage={...usage,...value.usage};}
        if(type==='message_stop')complete=true;
      } else {
        const choice=value.choices?.[0];append(choice?.delta?.content);
        if(choice?.delta?.reasoning_content)onThinking();
        if(choice?.finish_reason){complete=true;limited=choice.finish_reason==='length';}
        if(value.usage)usage=value.usage;
      }
    }
  }
  if(!complete)throw new Error('网络连接中断，回复尚未完成；可以重新回答');
  if(!text.trim())throw new Error('模型没有返回可显示的文字，请提高回复上限或换一个模型');
  return {text,limited,usage};
}
async function listModels({profile,key,signal,fetchImpl=fetch}) {
  const headers={Accept:'application/json'};
  if(profile.protocol==='claude'){headers['x-api-key']=key;headers['anthropic-version']=profile.apiVersion;if(profile.workspaceId)headers['anthropic-workspace-id']=profile.workspaceId;}
  else headers.Authorization='Bearer '+key;
  const response=await fetchImpl(normalizeBaseURL(profile.baseURL)+'/models',{headers,signal,redirect:'error',credentials:'omit',cache:'no-store'});
  if(!response.ok){let value;try{value=await readJSON(response);}catch{}throw apiError(response.status,value?.error?.message,key);}
  const data=await readJSON(response);
  return [...new Set((data.data||data.models||[]).map(m=>m.id||m.name).filter(id=>typeof id==='string'&&id.length<=160))].sort().slice(0,500);
}
module.exports={PROVIDERS,normalizeBaseURL,normalizeProfile,redact,makeRequest,readSSE,streamReply,listModels};
