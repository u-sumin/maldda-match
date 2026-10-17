/**
 * 말따 MATCH one-time backup service: Cloudflare Worker + D1 (SQLite).
 * D1 binding: DB. Only the specified GitHub Pages origin can access from a browser.
 * Codes expire after 24 hours and are consumed atomically with DELETE ... RETURNING.
 */
const ALLOWED_ORIGIN = 'https://u-sumin.github.io';
const SYMBOLS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O/1/I
const EXPIRES_MS = 24 * 60 * 60 * 1000;
let initPromise = null;
async function ensureDB(db){
  if(!initPromise){
    initPromise=db.prepare('CREATE TABLE IF NOT EXISTS backups (code TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL)').run().catch(e=>{initPromise=null;throw e;});
  }
  await initPromise;
}
const HEADERS = {'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
const error = (msg, status, origin) => reply({ok:false,error:msg},status,origin);
function reply(data,status=200,origin=''){
  return new Response(JSON.stringify(data),{status,headers:{...HEADERS,...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}});
}
function makeCode(){
  const bytes=crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes,b=>SYMBOLS[b&31]).join('');
}
function formatted(code){return code.replace(/(.{4})/g,'$1-').slice(0,-1);}
export default {
  async fetch(request, env){
    const origin=request.headers.get('Origin')||'';
    const corsOrigin=origin===ALLOWED_ORIGIN?origin:'';
    if(request.method==='OPTIONS'){
      if(!corsOrigin)return new Response(null,{status:403});
      return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':corsOrigin,'Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'}});
    }
    // Only service the user's GitHub Pages browser. Health may also be checked by directly opening its URL.
    if(origin&&origin!==ALLOWED_ORIGIN)return error('허용되지 않은 사이트입니다.',403);
    const url=new URL(request.url);
    if(url.pathname==='/health'&&request.method==='GET'){
      if(!env.DB)return error('D1 데이터베이스 바인딩(DB)이 없습니다.',503,corsOrigin);
      try{await ensureDB(env.DB);return reply({ok:true,status:'ready'},200,corsOrigin);}
      catch(e){return error('D1 백업 테이블을 만들지 못했습니다. DB 권한을 확인해 주세요.',503,corsOrigin);}
    }
    if(!corsOrigin)return error('허용된 GitHub Pages에서 실행해야 합니다.',403);
    if(request.method!=='POST'||!['/api/create','/api/redeem'].includes(url.pathname))return error('지원하지 않는 요청입니다.',404,corsOrigin);
    if(!env.DB)return error('D1 DB 바인딩을 설정해 주세요.',503,corsOrigin);
    if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return error('JSON 형식만 지원합니다.',415,corsOrigin);
    let payload;
    try{const raw=await request.text();if(raw.length>15000)return error('너무 큰 데이터입니다.',413,corsOrigin);payload=JSON.parse(raw);}catch(e){return error('JSON 데이터가 올바르지 않습니다.',400,corsOrigin);}
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return error('잘못된 입력입니다.',400,corsOrigin);
    const now=Date.now();
    try{
      await ensureDB(env.DB);
      if(url.pathname==='/api/create'){
        if(!Array.isArray(payload.ids)||payload.ids.length>1200||payload.ids.some(id=>typeof id!=='string'||!/^q[0-9]{1,6}(?:s[0-9]{1,6})?$/.test(id)))return error('암기 체크 목록 형식이 올바르지 않습니다.',400,corsOrigin);
        const ids=[...new Set(payload.ids)];
        await env.DB.prepare('DELETE FROM backups WHERE expires_at <= ?').bind(now).run();
        const packed=JSON.stringify(ids);
        for(let attempt=0;attempt<5;attempt++){
          const code=makeCode();
          const r=await env.DB.prepare('INSERT INTO backups (code, payload, expires_at) VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING').bind(code,packed,now+EXPIRES_MS).run();
          if(r.meta?.changes===1)return reply({ok:true,code:formatted(code),expiresAt:new Date(now+EXPIRES_MS).toISOString()},200,corsOrigin);
        }
        return error('코드를 생성하지 못했습니다. 다시 시도해 주세요.',503,corsOrigin);
      }
      const code=String(payload.code||'').replace(/[\s-]/g,'').toUpperCase();
      if(!/^[A-HJ-NP-Z2-9]{12}$/.test(code))return error('12자리 백업 코드를 입력하세요.',400,corsOrigin);
      // One SQL statement atomically returns the record and removes it.
      const record=await env.DB.prepare('DELETE FROM backups WHERE code = ? AND expires_at > ? RETURNING payload').bind(code,now).first();
      if(!record)return error('코드가 없거나, 이미 사용했거나, 유효기간이 지났습니다.',404,corsOrigin);
      return reply({ok:true,ids:JSON.parse(record.payload)},200,corsOrigin);
    }catch(e){return error('서버 처리 중 오류가 발생했습니다. D1 설정을 확인하세요.',500,corsOrigin);}
  }
};
