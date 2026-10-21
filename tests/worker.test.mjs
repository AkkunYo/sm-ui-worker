import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { sign } from 'hono/jwt';
import { parse as parseYaml } from 'yaml';

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
  await sql("INSERT INTO system_settings(key,value) VALUES('jwt_secret',?),('setup_completed','true')",secret);
  for (const [id, name, role] of [[1,'admin','admin'],[2,'alice','user'],[3,'bob','user']]) await sql("INSERT INTO users(id,username,password_hash,role,uuid,proxy_password,sub_token) VALUES(?,?, 'hash',?,?,?,?)",id,name,role,'uuid-'+id,'password-'+id,'sub-'+id);
  for (const id of [1, 2, 3]) await sql("INSERT INTO inbound_templates(id,name,protocol,listen_port) VALUES(?,?,?,2096)", id, 'template-'+id, 'vless');
  await sql("UPDATE inbound_templates SET protocol='hysteria2' WHERE id=2");
  await sql("INSERT INTO nodes(id,owner_id,name,server_ip,token,status,desired_config_version) VALUES(1,2,'original','192.0.2.1','node-1','online',14)");
  await sql("INSERT INTO node_inbounds(id,node_id,template_id,enabled) VALUES(99,1,1,1)");
});
test('node creation keeps every slot attached to the new node, regardless of slot row IDs', async () => {
  const res = await request('/api/v1/nodes',{name:'new', owner_id:2,template_ids:[1,2]});
  assert.equal(res.status,200,await res.clone().text());
  const node = await res.json();
  const slots = await db.prepare('SELECT node_id FROM node_inbounds WHERE node_id=?').bind(node.id).all();
  assert.equal(slots.results.length,2);
});
test('non-existent template binding is rejected atomically', async () => {
  let res=await request('/api/v1/nodes/1',{name:'changed',template_ids:[999]},2,'PUT');
  assert.equal(res.status,400);
  assert.equal((await row('SELECT name FROM nodes WHERE id=1')).name,'original');
  res=await request('/api/v1/nodes/1',{owner_id:999},1,'PUT');
  assert.equal(res.status,400);
});
test('duplicate slots fail without changing node fields or losing existing slots', async () => {
  const res=await request('/api/v1/nodes/1',{name:'changed',template_ids:[1,1]},2,'PUT');
  assert.ok(res.status>=400);
  assert.equal((await row('SELECT name FROM nodes WHERE id=1')).name,'original');
  assert.equal((await row('SELECT COUNT(*) n FROM node_inbounds WHERE node_id=1')).n,1);
});
test('traffic retry counts once; replayed or foreign batches are settled without counting or blocking config', async () => {
  const payload={traffic_batch_id:'batch-1',traffic_deltas:[{username:'alice',uplink:100,downlink:200}]};
  for(let i=0;i<2;i++) assert.equal((await sync(payload)).status,200);
  assert.equal((await row('SELECT used_up_bytes FROM users WHERE id=2')).used_up_bytes,100);
  assert.equal((await row('SELECT used_down_bytes FROM nodes WHERE id=1')).used_down_bytes,200);
  let res=await sync({...payload,traffic_deltas:[{username:'alice',uplink:300,downlink:200}]});
  assert.equal(res.status,200);
  assert.equal((await res.json()).accepted_traffic_batch_id,'batch-1');
  res=await sync({traffic_batch_id:'batch-2',traffic_deltas:[{username:'bob',uplink:10,downlink:0}]});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.accepted_traffic_batch_id,'batch-2');
  assert.ok(body.config);
  assert.equal((await row('SELECT used_up_bytes FROM users WHERE id=2')).used_up_bytes,100);
  assert.equal((await row('SELECT used_up_bytes FROM users WHERE id=3')).used_up_bytes,0);
});
test('multiple traffic batches are settled atomically and all IDs returned in accepted_traffic_batch_ids', async () => {
  const multiPayload = {
    traffic_batches: [
      { id: 'batch-m1', deltas: [{ username: 'alice', uplink: 50, downlink: 50 }] },
      { id: 'batch-m2', deltas: [{ username: 'alice', uplink: 25, downlink: 25 }] },
      { id: 'batch-m3', deltas: [{ username: 'foreign', uplink: 99, downlink: 99 }] }, // should drop foreign delta safely
    ]
  };
  const res = await sync(multiPayload);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.accepted_traffic_batch_ids, ['batch-m1', 'batch-m2', 'batch-m3']);
  assert.equal((await row('SELECT used_up_bytes FROM users WHERE id=2')).used_up_bytes, 75);
  assert.equal((await row('SELECT used_down_bytes FROM nodes WHERE id=1')).used_down_bytes, 75);
});
test('an unrelated admin edit does not reload a node whose own config is unchanged', async () => {
  const first=await (await sync()).json();
  const acked=await (await sync({applied_config_hash:first.config_hash})).json();
  assert.equal(acked.reload,false);
  assert.equal((await request('/api/v1/users/3',{traffic_limit_bytes:123},1,'PUT')).status,200);
  assert.equal((await request('/api/v1/templates',{name:'unused',protocol:'hysteria2'},1)).status,200);
  const after=await (await sync({applied_config_hash:first.config_hash})).json();
  assert.equal(after.reload,false);
  assert.equal(after.config_hash,first.config_hash);
  assert.equal((await request('/api/v1/users/2',{status:0},1,'PUT')).status,200);
  const changed=await (await sync({applied_config_hash:first.config_hash})).json();
  assert.equal(changed.reload,true);
  assert.notEqual(changed.config_hash,first.config_hash);
});
test('owner reassignment with a stale traffic batch still delivers the new config', async () => {
  assert.equal((await request('/api/v1/nodes/1',{owner_id:3},1,'PUT')).status,200);
  const res=await sync({traffic_batch_id:'stale',traffic_deltas:[{username:'alice',uplink:5,downlink:5}]});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.accepted_traffic_batch_id,'stale');
  assert.equal(body.config.inbounds[0].users[0].name,'bob');
});
test('each tenant gets its own Reality key pair for server config and subscription', async () => {
  await sql("INSERT INTO nodes(id,owner_id,name,server_ip,token) VALUES(2,3,'bob-node','192.0.2.2','node-2')");
  await sql('INSERT INTO node_inbounds(node_id,template_id) VALUES(2,1)');
  const alice=(await (await sync()).json()).config.inbounds[0].tls.reality.private_key;
  const bob=(await (await sync({},'node-2')).json()).config.inbounds[0].tls.reality.private_key;
  assert.ok(alice && bob);
  assert.notEqual(alice,bob);
  const keys=await row('SELECT reality_private_key priv, reality_public_key pub FROM users WHERE id=2');
  assert.equal(keys.priv,alice);
  const sub=await (await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=singbox')).json();
  assert.equal(sub.outbounds.find(o=>o.type==='vless').tls.reality.public_key,keys.pub);
  assert.equal((await (await sync()).json()).config.inbounds[0].tls.reality.private_key,alice);
});
test('template API never returns Reality key material', async () => {
  for(const userId of [1,3]){
    const list=await (await request('/api/v1/templates',undefined,userId,'GET')).json();
    assert.ok(list.length>0);
    for(const t of list){ assert.equal('reality_private_key' in t,false); assert.equal('reality_public_key' in t,false); }
  }
  const legacy=await (await request('/api/v1/template/generate-keys',undefined,1,'GET')).text();
  assert.equal(legacy.includes('reality_private_key'),false);
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
test('controller reports the package.json version that the agent build also stamps', async () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const status = await (await mf.dispatchFetch('https://test.local/api/v1/system/setup/status')).json();
  assert.equal(status.version, pkg.version);
  assert.equal(status.protocol_version, heartbeat.protocol_version);
});
test('agents still on 1.14.2-1 may send core_version; it is ignored and agent_version is stored', async () => {
  const res = await sync({ core_version: 'v1.14.2', agent_version: '1.14.2-1' });
  assert.equal(res.status, 200);
  const node = await row('SELECT * FROM nodes WHERE id=1');
  assert.equal(node.agent_version, '1.14.2-1');
  assert.equal('core_version' in node, false);
});
test('explicit format wins over User Agent and subscription credentials stay unchanged',async()=>{
  const res=await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=singbox',{headers:{'User-Agent':'Clash'}});
  assert.equal(res.status,200);
  const config=await res.json();
  const outbound=config.outbounds.find(o=>o.type==='vless');
  assert.equal(outbound.server,'192.0.2.1'); assert.equal(outbound.uuid,'uuid-2');
});
test('sing-box subscription emits pure single-port hysteria2 outbound', async () => {
  await sql("INSERT INTO node_inbounds(node_id,template_id,enabled) VALUES(1,2,1)");
  const res = await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=singbox');
  assert.equal(res.status, 200);
  const config = await res.json();
  const outbound = config.outbounds.find(o => o.type === 'hysteria2');
  assert.ok(outbound);
  assert.equal(outbound.server_port, 2096);
  assert.equal('server_ports' in outbound, false);
});
test('base64 subscription emits pure single-port hysteria2 URI without mport', async () => {
  await sql("INSERT INTO node_inbounds(node_id,template_id,enabled) VALUES(1,2,1)");
  const res = await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=base64');
  assert.equal(res.status, 200);
  const uris = Buffer.from(await res.text(), 'base64').toString('utf8');
  assert.match(uris, /(?:^|\n)hysteria2:\/\/[^@]+@192\.0\.2\.1:2096\?/);
  assert.doesNotMatch(uris, /mport=/);
});
test('template management is strictly adminOnly and tenants are rejected', async () => {
  let res = await request('/api/v1/templates', { name: 'tenant-created', protocol: 'vless' }, 2);
  assert.equal(res.status, 403);
  res = await request('/api/v1/templates/1', { name: 'tenant-updated' }, 2, 'PUT');
  assert.equal(res.status, 403);
  res = await request('/api/v1/templates/1', undefined, 2, 'DELETE');
  assert.equal(res.status, 403);
  res = await request('/api/v1/templates', { name: 'admin-created', protocol: 'tuic', listen_port: 8443 }, 1);
  assert.equal(res.status, 200);
});
test('template list puts default templates first, then orders by protocol vless, hysteria2, tuic, trojan, anytls', async () => {
  await sql('DELETE FROM node_inbounds');
  await sql('DELETE FROM inbound_templates');
  for (const [id, protocol, isDefault] of [[1,'trojan',0],[2,'vless',1],[3,'tuic',0],[4,'anytls',0],[5,'vless',0],[6,'hysteria2',1],[7,'vless',0]]) {
    await sql('INSERT INTO inbound_templates(id,name,protocol,listen_port,is_default) VALUES(?,?,?,2096,?)', id, `t-${id}`, protocol, isDefault);
  }
  const res = await request('/api/v1/templates', undefined, 2, 'GET');
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.deepEqual(list.map(t => t.id), [2, 6, 5, 7, 3, 1, 4]);
  assert.deepEqual(list.map(t => t.protocol), ['vless', 'hysteria2', 'vless', 'vless', 'tuic', 'trojan', 'anytls']);
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
test('node deletion hides from list, frees name for immediate recreation, and rejects revival', async () => {
  let res = await request('/api/v1/nodes/1', undefined, 2, 'DELETE');
  assert.equal(res.status, 200);
  const list = await (await request('/api/v1/nodes', undefined, 2, 'GET')).json();
  assert.equal(list.length, 0);
  // Re-creation with same name succeeds immediately
  res = await request('/api/v1/nodes', { name: 'original', owner_id: 2, template_ids: [1] }, 2);
  assert.equal(res.status, 200);
  // Revived PUT is rejected
  res = await request('/api/v1/nodes/1', { status: 'online' }, 2, 'PUT');
  assert.equal(res.status, 404);
});
test('cascade deletion of tenant safely cleans up nodes, templates and slot constraints', async () => {
  await sql("INSERT INTO nodes(id,owner_id,name,server_ip,token) VALUES(5,3,'bob-node','192.0.2.5','node-5')");
  await sql('INSERT INTO node_inbounds(node_id,template_id) VALUES(5,3)');
  const res = await request('/api/v1/users/3', undefined, 1, 'DELETE');
  assert.equal(res.status, 200);
  assert.equal(await row('SELECT id FROM users WHERE id=3'), null);
  assert.equal(await row('SELECT id FROM nodes WHERE id=5'), null);
  assert.ok(await row('SELECT id FROM inbound_templates WHERE id=3'));
});
test('user input validation enforces non-negative integer quotas and valid ISO dates', async () => {
  let res = await request('/api/v1/users', { username: 'test-val', password: 'password-123', traffic_limit_bytes: -10 }, 1);
  assert.equal(res.status, 400);
  res = await request('/api/v1/users', { username: 'test-val', password: 'password-123', expire_at: 'invalid-date' }, 1);
  assert.equal(res.status, 400);
  res = await request('/api/v1/users/2', { traffic_limit_bytes: 'not-a-number' }, 1, 'PUT');
  assert.equal(res.status, 400);
  res = await request('/api/v1/users/2', { expire_at: 'not-a-date' }, 1, 'PUT');
  assert.equal(res.status, 400);
});
test('node reports cert_sha256 which is locked into hysteria2 and tuic subscriptions', async () => {
  const fakeFingerprint = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  await sync({ cert_sha256: fakeFingerprint.toUpperCase() });
  const rowNode = await row('SELECT cert_sha256 FROM nodes WHERE id=1');
  assert.equal(rowNode.cert_sha256, fakeFingerprint);

  await sql("INSERT INTO node_inbounds(node_id,template_id) VALUES(1,2)");
  const subRes = await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=base64');
  const uris = Buffer.from(await subRes.text(), 'base64').toString('utf8');
  const hy2Uri = uris.split('\n').find(u => u.startsWith('hysteria2://'));
  assert.match(hy2Uri, /pinSHA256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/);
  assert.match(hy2Uri, /pcs=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/);
  assert.match(hy2Uri, /[?&]insecure=1/);
  assert.doesNotMatch(hy2Uri, /allowInsecure/);

  const clash = parseYaml(await (await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=clash')).text());
  const clashHy2 = clash.proxies.find(p => p.type === 'hysteria2');
  assert.equal(clashHy2.fingerprint, fakeFingerprint);
  assert.equal(clashHy2['skip-cert-verify'], true);

  // sing-box JSON stays insecure: NekoBox's 1.12 core rejects certificate_public_key_sha256
  const sb = await (await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=singbox')).json();
  const sbHy2 = sb.outbounds.find(o => o.type === 'hysteria2');
  assert.deepEqual(sbHy2.tls, { enabled: true, server_name: sbHy2.tls.server_name, insecure: true });
});
test('malformed cert_sha256 is dropped and subscriptions fall back to unpinned insecure', async () => {
  await sync({ cert_sha256: 'not-a-sha256-fingerprint' });
  assert.equal((await row('SELECT cert_sha256 FROM nodes WHERE id=1')).cert_sha256, '');

  await sql("INSERT INTO node_inbounds(node_id,template_id) VALUES(1,2)");
  const uris = Buffer.from(await (await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=base64')).text(), 'base64').toString('utf8');
  const hy2Uri = uris.split('\n').find(u => u.startsWith('hysteria2://'));
  assert.match(hy2Uri, /insecure=1&allowInsecure=1/);
  assert.doesNotMatch(hy2Uri, /pinSHA256|pcs=/);
  const clash = parseYaml(await (await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=clash')).text());
  assert.equal(clash.proxies.find(p => p.type === 'hysteria2').fingerprint, undefined);

  // A later malformed report must not wipe a previously stored valid pin
  const valid = 'a'.repeat(64);
  await sync({ cert_sha256: valid });
  await sync({ cert_sha256: 'zz' });
  assert.equal((await row('SELECT cert_sha256 FROM nodes WHERE id=1')).cert_sha256, valid);
});
test('clash subscription types anytls correctly and pins tuic and anytls by fingerprint', async () => {
  const fp = 'b'.repeat(64);
  await sync({ cert_sha256: fp });
  await sql("INSERT INTO inbound_templates(id,name,protocol,listen_port) VALUES(10,'TUIC','tuic',8443),(12,'AnyTLS','anytls',10443)");
  await sql("INSERT INTO node_inbounds(node_id,template_id) VALUES(1,10),(1,12)");

  const clash = parseYaml(await (await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=clash')).text());
  const anytls = clash.proxies.find(p => p.name.includes('AnyTLS'));
  assert.equal(anytls.type, 'anytls');
  assert.equal(anytls.fingerprint, fp);
  assert.equal(clash.proxies.find(p => p.type === 'tuic').fingerprint, fp);

  const uris = Buffer.from(await (await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=base64')).text(), 'base64').toString('utf8');
  const tuicUri = uris.split('\n').find(u => u.startsWith('tuic://'));
  assert.match(tuicUri, new RegExp(`pcs=${fp}`));
  assert.doesNotMatch(tuicUri, /allowInsecure/);
  // NekoBox's tuic:// parser only reads allow_insecure
  assert.match(tuicUri, /[?&]allow_insecure=1/);
});
test('hysteria2 with salamander obfs configures server and injects into subscriptions', async () => {
  await sql("UPDATE inbound_templates SET hy2_obfs_password='secret-obfs-pwd' WHERE id=2");
  await sql("INSERT INTO node_inbounds(node_id,template_id) VALUES(1,2)");

  const syncRes = await (await sync()).json();
  const hy2Inbound = syncRes.config.inbounds.find(i => i.type === 'hysteria2');
  assert.ok(hy2Inbound);
  assert.deepEqual(hy2Inbound.obfs, { type: 'salamander', password: 'secret-obfs-pwd' });

  // Singbox format
  const sbRes = await (await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=singbox')).json();
  const sbHy2 = sbRes.outbounds.find(o => o.type === 'hysteria2');
  assert.ok(sbHy2);
  assert.deepEqual(sbHy2.obfs, { type: 'salamander', password: 'secret-obfs-pwd' });

  // Base64 format
  const b64Res = await (await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=base64')).text();
  const uris = Buffer.from(b64Res, 'base64').toString('utf8');
  assert.match(uris, /obfs=salamander/);
  assert.match(uris, /obfs-password=secret-obfs-pwd/);
});
test('multi-protocol expansion supports tuic, trojan and anytls in server config and subscriptions', async () => {
  await sql("INSERT INTO inbound_templates(id,name,protocol,listen_port,tuic_congestion_control) VALUES(10,'TUIC','tuic',8443,'bbr')");
  await sql("INSERT INTO inbound_templates(id,name,protocol,listen_port,reality_server_name,reality_dest) VALUES(11,'Trojan','trojan',443,'www.amazon.com','www.amazon.com:443')");
  await sql("INSERT INTO inbound_templates(id,name,protocol,listen_port) VALUES(12,'AnyTLS','anytls',10443)");

  await sql("INSERT INTO node_inbounds(node_id,template_id) VALUES(1,10),(1,11),(1,12)");

  const syncRes = await (await sync()).json();
  const tuicIn = syncRes.config.inbounds.find(i => i.type === 'tuic');
  const trojanIn = syncRes.config.inbounds.find(i => i.type === 'trojan');
  const anytlsIn = syncRes.config.inbounds.find(i => i.type === 'anytls');

  assert.ok(tuicIn && trojanIn && anytlsIn);
  assert.equal(tuicIn.listen_port, 8443);
  assert.equal(tuicIn.congestion_control, 'bbr');
  assert.equal(trojanIn.listen_port, 443);
  assert.equal(anytlsIn.listen_port, 10443);

  // Subscriptions
  const b64 = Buffer.from(await (await mf.dispatchFetch('https://test.local/sub/alice/sub-2?format=base64')).text(), 'base64').toString('utf8');
  assert.match(b64, /^tuic:\/\//m);
  assert.match(b64, /^trojan:\/\//m);
  assert.match(b64, /^anytls:\/\//m);
});
