/**
 * 말따 MATCH 자동 동기화 서버: Cloudflare Workers + D1 (binding = DB)
 * 로그인 대신 브라우저에서 생성하는 120비트 비밀키로 저장 공간을 분리합니다.
 * 공개 Github Pages 소스에는 비밀키를 넣지 않습니다.
 * 서버에는 문제/답/그림이 아니라 암기 체크 여부만 저장합니다.
 */
const ALLOWED_ORIGIN = 'https://u-sumin.github.io';
const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const isSecret = key => typeof key==='string' && /^[A-HJ-NP-Z2-9]{24}$/.test(key);
const isID = id => typeof id==='string' && /^q[0-9]{1,6}(?:s[0-9]{1,6})?$/.test(id);
const cors = origin => origin===ALLOWED_ORIGIN ? {'Access-Control-Allow-Origin':origin,'Vary':'Origin'} : {};
const reply = (obj,status=200,origin='')=>new Response(JSON.stringify(obj),{status,headers:{...HEADERS,...cors(origin)}});
const fail = (message,status=400,origin='')=>reply({ok:false,error:message},status,origin);
let initPromise=null;
async function ensureDB(db){
  if(!initPromise){
    initPromise=(async()=>{
      await db.prepare('CREATE TABLE IF NOT EXISTS sync_rooms (room_id TEXT PRIMARY KEY, updated_at INTEGER NOT NULL)').run();
      await db.prepare('CREATE TABLE IF NOT EXISTS sync_items (room_id TEXT NOT NULL, item_id TEXT NOT NULL, learned INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (room_id, item_id))').run();
    })().catch(e=>{initPromise=null;throw e;});
  }
  await initPromise;
}
async function roomId(secret){
  const bytes=new TextEncoder().encode('maldda-match-sync-v2:'+secret);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
}
async function readData(req,max=30000){
  if((req.headers.get('Content-Type')||'').split(';')[0].trim()!=='application/json')throw Error('JSON 요청만 허용합니다.');
  const raw=await req.text();if(raw.length>max)throw Error('데이터가 너무 큽니다.');
  const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('입력 형식이 올바르지 않습니다.');
  return data;
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin')||'';
    const site=origin===ALLOWED_ORIGIN?origin:'';
    if(request.method==='OPTIONS'){
      if(!site)return new Response(null,{status:403});
      return new Response(null,{status:204,headers:{...cors(site),'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
    }
    if(origin&&origin!==ALLOWED_ORIGIN)return fail('허용되지 않은 출처입니다.',403);
    const path=new URL(request.url).pathname;
    if(request.method==='GET'&&path==='/health'){
      if(!env.DB)return fail('D1 데이터베이스를 DB 이름으로 연결해 주세요.',503,site);
      try{await ensureDB(env.DB);return reply({ok:true,status:'ready',mode:'auto-sync-v2'},200,site);}
      catch(e){return fail('D1 연결이나 테이블 생성에 실패했습니다.',503,site);}
    }
    if(!['/api/state','/api/bootstrap','/api/changes'].includes(path))return fail('지원하지 않는 주소입니다.',404,site);
    if(!env.DB)return fail('D1 연결(DB)이 필요합니다.',503,site);
    const auth=request.headers.get('Authorization')||'';
    const secret=auth.startsWith('Bearer ')?auth.slice(7):'';
    if(!isSecret(secret))return fail('연결 키가 없거나 형식이 맞지 않습니다.',401,site);
    if(path==='/api/state'&&request.method!=='GET')return fail('GET 요청이 필요합니다.',405,site);
    if(path!=='/api/state'&&request.method!=='POST')return fail('POST 요청이 필요합니다.',405,site);
    try{
      await ensureDB(env.DB);
      const key=await roomId(secret);
      if(path==='/api/state'){
        const room=await env.DB.prepare('SELECT updated_at FROM sync_rooms WHERE room_id = ?').bind(key).first();
        if(!room)return reply({ok:true,initialized:false,ids:[]},200,site);
        const records=await env.DB.prepare('SELECT item_id FROM sync_items WHERE room_id = ? AND learned = 1').bind(key).all();
        return reply({ok:true,initialized:true,ids:(records.results||[]).map(x=>x.item_id),updatedAt:room.updated_at},200,site);
      }
      const data=await readData(request);
      if(path==='/api/bootstrap'){
        if(!Array.isArray(data.ids)||data.ids.length>400||!data.ids.every(isID))return fail('초기 암기 체크 기록 형식이 잘못됐습니다.',400,site);
        const existing=await env.DB.prepare('SELECT room_id FROM sync_rooms WHERE room_id = ?').bind(key).first();
        if(existing)return reply({ok:false,error:'이 연결 키는 이미 사용 중입니다.',created:false},409,site);
        const ids=[...new Set(data.ids)];const now=Date.now();
        await env.DB.batch([
          env.DB.prepare('INSERT OR IGNORE INTO sync_rooms (room_id, updated_at) VALUES (?, ?)').bind(key,now),
          ...ids.map(id=>env.DB.prepare('INSERT INTO sync_items (room_id, item_id, learned, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(room_id, item_id) DO UPDATE SET learned = 1, updated_at = excluded.updated_at').bind(key,id,now))
        ]);
        return reply({ok:true,created:true,count:ids.length},200,site);
      }
      if(!Array.isArray(data.changes)||data.changes.length>400||!data.changes.every(x=>x&&typeof x==='object'&&isID(x.id)&&typeof x.learned==='boolean'))return fail('변경한 문제 기록 형식이 잘못됐습니다.',400,site);
      const room=await env.DB.prepare('SELECT room_id FROM sync_rooms WHERE room_id = ?').bind(key).first();
      if(!room)return fail('동기화가 아직 시작되지 않았습니다.',409,site);
      const dedup=new Map(data.changes.map(x=>[x.id,x.learned]));const now=Date.now();
      await env.DB.batch([
        ...[...dedup].map(([id,value])=>env.DB.prepare('INSERT INTO sync_items (room_id, item_id, learned, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id, item_id) DO UPDATE SET learned = excluded.learned, updated_at = excluded.updated_at').bind(key,id,value?1:0,now)),
        env.DB.prepare('UPDATE sync_rooms SET updated_at = ? WHERE room_id = ?').bind(now,key)
      ]);
      return reply({ok:true,updatedAt:now,count:dedup.size},200,site);
    }catch(e){
      if(e instanceof SyntaxError)return fail('JSON 형식이 올바르지 않습니다.',400,site);
      if(e.message==='JSON 요청만 허용합니다.'||e.message==='입력 형식이 올바르지 않습니다.')return fail(e.message,400,site);
      if(e.message==='데이터가 너무 큽니다.')return fail(e.message,413,site);
      return fail('서버가 기록을 처리하지 못했습니다. D1 설정을 확인해 주세요.',500,site);
    }
  }
};
