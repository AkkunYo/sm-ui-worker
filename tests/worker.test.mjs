import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { sign } from 'hono/jwt';

let mf, db;
const secret = 'integration-test-secret-at-least-32-bytes';
async function sql(query, ...params) { return db.prepare(query).bind(...params).run(); }
async function row(query, ...params) { return db.prepare(query).bind(...params).first(); }
async function request(path, body, userId = 1, method = 'POST', extra = {}) {
  const token = await sign({ userId, exp: Math.floor(Date.now()/1000)+60 }, secret, 'HS256');
  return mf.dispatchFetch('https://test.local'+path, {method, headers:{'Content-Type':'application/json', Cookie:'sm_ui_session='+token, ...extra}, ...(body !== undefined ? {body:JSON.stringify(body)} : {})});
}
const heartbeat = {protocol_version:2, status:'online', agent_version:'v2.0.0', applied_config_version:0, applied_config_hash:''};
async function sync(body = {}, token = 'node-1') { return request('/api/v2/node/sync',{...heartbeat,...body},1,'POST',{'X-Node-Token':token}); }
before(async () => {
  const result = await build({entryPoints:['src/index.ts'], bundle:true, format:'esm', write:false, platform:'browser'});
  mf = new Miniflare({modules:true, script:result.outputFiles[0].text, compatibilityDate:'2025-02-24', compatibilityFlags:['nodejs_compat'], d1Databases:['DB']});
  db = await mf.getD1Database('DB');
  for (const statement of readFileSync('schema.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(statement).run();
});
after(async () => { await mf?.dispose(); });
beforeEach(async () => {
  for (const table of ['traffic_receipts','node_inbounds','nodes','inbound_templates','users','system_settings','login_attempts']) await sql(`DELETE FROM ${table}`);
  await sql("INSERT INTO system_settings(key,value) VALUES('jwt_secret',?),('config_version','14'),('setup_completed','true')",secret);
  for (const [id, name, role] of [[1,'admin','admin'],[2,'alice','user'],[3,'bob','user']]) await sql("INSERT INTO users(id,username,password_hash,role,uuid,proxy_password,sub_token) VALUES(?,?, 'hash',?,?,?,?)",id,name,role,'uuid-'+id,'password-'+id,'sub-'+id);
  for (const [id,owner] of [[1,null],[2,null],[3,3]]) await sql("INSERT INTO inbound_templates(id,owner_id,name,protocol,reality_private_key,reality_public_key) VALUES(?,?,?,'vless',?,?)",id,owner,'template-'+id,'private-'+id,'public-'+id);
  await sql("UPDATE inbound_templates SET protocol='hysteria2' WHERE id=2");
  await sql("INSERT INTO nodes(id,owner_id,name,server_ip,token,status,desired_config_version) VALUES(1,2,'original','192.0.2.1','node-1','online',14)");
  await sql("INSERT INTO node_inbounds(id,node_id,template_id,listen_port,enabled) VALUES(99,1,1,2096,1)");
});
test('node creation keeps every slot attached to the new node, regardless of slot row IDs', async () => {
  const res = await request('/api/v1/nodes',{name:'new', owner_id:2,inbounds:[{template_id:1,listen_port:2096},{template_id:2,listen_port:2096}]});
  assert.equal(res.status,200,await res.clone().text());
  const node = await res.json();
  const slots = await db.prepare('SELECT node_id FROM node_inbounds WHERE node_id=?').bind(node.id).all();
  assert.equal(slots.results.length,2);
});
test('cross tenant bindings and reassignment without replacement are rejected atomically', async () => {
  let res=await request('/api/v1/nodes/1',{name:'changed',inbounds:[{template_id:3,listen_port:2096}]},2,'PUT');
  assert.equal(res.status,400);
  assert.equal((await row('SELECT name FROM nodes WHERE id=1')).name,'original');
  await sql('UPDATE inbound_templates SET owner_id=2 WHERE id=1');
  res=await request('/api/v1/nodes/1',{owner_id:3},1,'PUT');
  assert.equal(res.status,400);
  assert.equal((await row('SELECT owner_id FROM nodes WHERE id=1')).owner_id,2);
});
test('duplicate slots fail without changing node fields or losing existing slots', async () => {
  const res=await request('/api/v1/nodes/1',{name:'changed',inbounds:[{template_id:1,listen_port:2096},{template_id:1,listen_port:2096}]},2,'PUT');
  assert.ok(res.status>=400);
  assert.equal((await row('SELECT name FROM nodes WHERE id=1')).name,'original');
  assert.equal((await row('SELECT COUNT(*) n FROM node_inbounds WHERE node_id=1')).n,1);
});
test('traffic retry counts once, rejects changed payload under same ID and invalid batches', async () => {
  const payload={traffic_batch_id:'batch-1',traffic_deltas:[{username:'alice',uplink:100,downlink:200}]};
  for(let i=0;i<2;i++) assert.equal((await sync(payload)).status,200);
  assert.equal((await row('SELECT used_up_bytes FROM users WHERE id=2')).used_up_bytes,100);
  assert.equal((await row('SELECT used_down_bytes FROM nodes WHERE id=1')).used_down_bytes,200);
  assert.equal((await sync({...payload,traffic_deltas:[{username:'alice',uplink:300,downlink:200}]})).status,409);
  assert.equal((await sync({traffic_batch_id:'batch-2',traffic_deltas:[{username:'bob',uplink:10,downlink:0}]})).status,400);
});
test('inactive owner traffic is still settled and acknowledged', async () => {
  await sql('UPDATE users SET status=0 WHERE id=2');
  const res=await sync({traffic_batch_id:'final',traffic_deltas:[{username:'alice',uplink:100,downlink:200}]});
  assert.equal(res.status,200);
  assert.equal((await res.json()).accepted_traffic_batch_id,'final');
  assert.equal((await row('SELECT used_up_bytes FROM users WHERE id=2')).used_up_bytes,100);
});
test('only matching healthy config acknowledgements advance server applied state', async () => {
  const first=await (await sync()).json();
  assert.equal(first.reload,true);
  assert.equal((await row('SELECT applied_config_version FROM nodes WHERE id=1')).applied_config_version,0);
  await sync({applied_config_version:999,applied_config_hash:'invented',status:'offline',apply_error:'failed'});
  assert.equal((await row('SELECT applied_config_version FROM nodes WHERE id=1')).applied_config_version,0);
  assert.equal((await (await sync({applied_config_version:first.config_version,applied_config_hash:first.config_hash})).json()).reload,false);
  assert.equal((await row('SELECT applied_config_hash FROM nodes WHERE id=1')).applied_config_hash,first.config_hash);
});
test('disable/revoke directs stop and preserves node identity, endpoint and token', async () => {
  assert.equal((await request('/api/v1/nodes/1',{status:'disabled'},2,'PUT')).status,200);
  assert.equal((await (await sync()).json()).desired_state,'disabled');
  assert.equal((await request('/api/v1/nodes/1',undefined,2,'DELETE')).status,200);
  assert.equal((await (await sync()).json()).desired_state,'revoked');
  const n=await row('SELECT token,server_ip FROM nodes WHERE id=1');
  assert.deepEqual(n,{token:'node-1',server_ip:'192.0.2.1'});
});
test('legacy synchronization endpoint is removed', async()=>assert.equal((await request('/api/v1/node/sync',{})).status,404));
test('explicit format wins over User Agent and subscription credentials stay unchanged',async()=>{
  const res=await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=singbox',{headers:{'User-Agent':'Clash'}});
  assert.equal(res.status,200);
  const config=await res.json();
  const outbound=config.outbounds.find(o=>o.type==='vless');
  assert.equal(outbound.server,'192.0.2.1'); assert.equal(outbound.uuid,'uuid-2');
});
test('sing-box subscription preserves hysteria2 port hopping',async()=>{
  await sql("INSERT INTO node_inbounds(node_id,template_id,listen_port,hop_ports,enabled) VALUES(1,2,2096,'22200-22300',1)");
  const res=await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=singbox');
  assert.equal(res.status,200);
  const config=await res.json();
  const outbound=config.outbounds.find(o=>o.type==='hysteria2' && o.server_ports);
  assert.deepEqual(outbound.server_ports,['22200:22300']);
  assert.equal('server_port' in outbound,false);
});
test('base64 subscription emits NekoBox-compatible hysteria2 hopping URI',async()=>{
  await sql("INSERT INTO node_inbounds(node_id,template_id,listen_port,hop_ports,enabled) VALUES(1,2,2096,'22200-22300',1)");
  const res=await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=base64');
  assert.equal(res.status,200);
  const uris=Buffer.from(await res.text(),'base64').toString('utf8').split('\n');
  const hopUri=uris.find(uri=>uri.includes('Hy2-Hop-'));
  assert.ok(hopUri);
  assert.match(hopUri,/^hysteria2:\/\/[^@]+@192\.0\.2\.1:2096\?/);
  assert.match(hopUri,/(?:\?|&)mport=22200-22300(?:&|$)/);
  assert.doesNotMatch(hopUri,/@192\.0\.2\.1:22200-22300(?:\?|$)/);
});
test('admin preview edits selected tenant, tenants cannot raise own quotas',async()=>{
  const denied=await request('/api/v1/subscription',{traffic_limit_bytes:999},2,'PUT');
  assert.equal(denied.status,403);
  const res=await request('/api/v1/subscription?user_id=2',{status:1,traffic_limit_bytes:999,expire_at:'2030-01-01T00:00:00Z'},1,'PUT');
  assert.equal(res.status,200);
  assert.equal((await row('SELECT traffic_limit_bytes FROM users WHERE id=2')).traffic_limit_bytes,999);
  assert.equal((await row('SELECT traffic_limit_bytes FROM users WHERE id=1')).traffic_limit_bytes,0);
});
test('cross-origin cookie mutations rejected even when Host header is absent',async()=>{
  assert.equal((await request('/api/v1/nodes/1',{name:'attack'},2,'PUT',{Origin:'https://evil.test'})).status,403);
});
test('parallel setup creates exactly one complete administrator without partial defaults',async()=>{
  for(const table of ['node_inbounds','nodes','inbound_templates','users','system_settings']) await sql(`DELETE FROM ${table}`);
  await sql("INSERT INTO system_settings(key,value) VALUES('jwt_secret',?)",secret);
  const results=await Promise.all(['first','second'].map(username=>request('/api/v1/system/setup',{username,password:'long-enough-password',confirm_password:'long-enough-password'})));
  assert.equal(results.filter(r=>r.status===200).length,1);
  assert.equal((await row("SELECT COUNT(*) n FROM users WHERE role='admin'")).n,1);
  assert.equal((await row('SELECT COUNT(*) n FROM inbound_templates')).n,2);
});
