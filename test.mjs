// End-to-end test (starts its own server in a temp data dir): node test.mjs
import {spawn} from 'child_process';import fs from 'fs';import os from 'os';import path from 'path';
const DIR=fs.mkdtempSync(path.join(os.tmpdir(),'arena-')),PORT=3077,URL='http://localhost:'+PORT;
const env={...process.env,DATA_DIR:DIR,PORT:String(PORT),ADMIN_PASSWORD:'TestAdmin#123'};
let srv;const start=(port=PORT,e=env)=>new Promise(r=>{srv=spawn('node',['server/index.js'],{env:{...e,PORT:String(port)},stdio:['ignore','pipe','inherit']});srv.stdout.on('data',d=>/running/.test(d)&&r())});
const stop=()=>new Promise(r=>{srv.on('exit',r);srv.kill('SIGTERM')});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let fails=0;
const ok=(c,m)=>{console.log(c?'PASS':'FAIL',m);if(!c){fails++}};
const call=async(m,p,body,tok,base=URL)=>{const r=await fetch(base+'/api'+p,{method:m,headers:{'content-type':'application/json',...(tok?{authorization:'Bearer '+tok}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json().catch(()=>({}));return{s:r.status,j}};
await start();
const adm=(await call('POST','/admin/login',{username:'admin',password:'TestAdmin#123'})).j.token;ok(adm,'admin logs in');
ok((await call('POST','/admin/login',{username:'admin',password:'wrong'})).s===401,'wrong admin password rejected');
ok((await call('GET','/admin/overview')).s===401,'admin API rejects anonymous');
const A=(await call('POST','/register',{username:'alice',password:'password1',teamName:'Alpha'})).j,B=(await call('POST','/register',{username:'bobby',password:'password2',teamName:'Beta'})).j;ok(A.token&&B.token,'two players registered');
ok((await call('POST','/register',{username:'alice',password:'password1',teamName:'Gamma'})).s===400,'duplicate username rejected');
ok((await call('GET','/admin/overview',null,A.token)).s===401,'player token cannot use admin API');
/* privacy */
const pub=JSON.stringify([(await call('GET','/teams',null,B.token)).j,(await call('GET','/auction',null,B.token)).j,(await call('GET','/leaderboard',null,B.token)).j,(await call('GET','/battles',null,B.token)).j]);
ok(!/balance|ledger|startingBalance/.test(pub),'public/other-player API responses contain no balances');
const meA=(await call('GET','/me',null,A.token)).j;ok(meA.team.balance===1000,'player sees own balance (1000)');ok((await call('GET','/me')).s===401,'/me needs login');
ok((await call('GET','/admin/teams',null,adm)).j.every(t=>typeof t.balance==='number'),'admin sees all balances');
/* auction */
await call('PUT','/admin/settings',{rosterLimit:2,minRoster:1,auction:{timer:0,lotGapMs:500},battle:{summaryMs:500,actionTimer:30,critChance:0}},adm);
const chars=(await call('GET','/characters')).j,id=n=>chars.find(c=>c.name.startsWith(n)).id;const pool=['Iron Man','Spider-Man (','Thor Odinson','Wolverine'].map(id);
ok((await call('POST','/admin/auction/configure',{mode:'custom',ids:[...pool,'nope']},adm)).s===400,'custom pool with bad id rejected');
ok((await call('POST','/admin/auction/configure',{mode:'custom',ids:pool},adm)).s===200,'auction configured (custom pool)');
ok((await call('POST','/admin/auction/start',{},adm)).s===200,'auction started');
const lot=async(buyer,other)=>{await wait(700);const a=(await call('GET','/auction')).j;const c=a.current;const r=await call('POST','/auction/bid',{amount:c.next},buyer.token);if(r.s!==200)return r;await call('POST','/auction/pass',{},other.token);return{s:200,c}};
let a0=(await call('GET','/auction')).j;ok(a0.current&&a0.current.char.name.startsWith('Iron Man'),'lot 1 is Iron Man');
ok((await call('POST','/auction/bid',{amount:1},A.token)).s===400,'bid below base rejected');
ok((await call('POST','/auction/bid',{amount:999999},B.token)).s===400,'bid above private balance rejected');
await call('POST','/auction/bid',{amount:a0.current.next},A.token);ok((await call('POST','/auction/bid',{amount:a0.current.next+50},A.token)).s===400,'leader cannot outbid self');
ok((await call('POST','/auction/pass',{},A.token)).s===400,'leader cannot pass');await call('POST','/auction/pass',{},B.token);
await wait(300);ok((await call('GET','/me',null,A.token)).j.team.roster.some(c=>c.name.startsWith('Iron Man')),'Iron Man sold to Alpha when Beta passed');
ok((await call('GET','/me',null,A.token)).j.team.balance<1000,'Alpha balance reduced atomically');
await lot(B,A);await lot(A,B);await lot(B,A);await wait(800);
const a1=(await call('GET','/auction')).j;ok(a1.status==='ended','auction ends when rosters are full');
const tA=(await call('GET','/me',null,A.token)).j.team,tB=(await call('GET','/me',null,B.token)).j.team;ok(tA.roster.length===2&&tB.roster.length===2,'each team owns 2 characters, none duplicated');
/* battle: manual, simultaneous, hidden */
const thor=tA.roster.find(c=>c.name.startsWith('Thor')).id,iron=tA.roster.find(c=>c.name.startsWith('Iron')).id,wolv=tB.roster.find(c=>c.name.startsWith('Wolverine')).id,spid=tB.roster.find(c=>c.name.startsWith('Spider')).id;
const ch=(await call('POST','/battles',{opponentTeamId:tB.id},A.token)).j;ok(ch.id,'Alpha challenges Beta');
ok((await call('POST',`/battles/${ch.id}/respond`,{accept:true},A.token)).s===403,'challenger cannot accept own invite');
await call('POST',`/battles/${ch.id}/respond`,{accept:true},B.token);
ok((await call('POST',`/battles/${ch.id}/select`,{charId:wolv},A.token)).s===400,'cannot select a character you do not own');
await call('POST',`/battles/${ch.id}/select`,{charId:thor},A.token);
let vB=(await call('GET',`/battles/${ch.id}`,null,B.token)).j;ok(vB.state==='CharacterSelection'&&vB.sides[0].ready===true&&vB.sides[0].active===null,'opponent selection is hidden (only "ready")');
await call('POST',`/battles/${ch.id}/select`,{charId:wolv},B.token);
vB=(await call('GET',`/battles/${ch.id}`,null,B.token)).j;ok(vB.state==='ActionSelection'&&vB.turn===1,'both selected -> ActionSelection turn 1');
const vA=(await call('GET',`/battles/${ch.id}`,null,A.token)).j;ok(vA.me.options.some(o=>o.label==='God of Thunder')&&!vB.me.options.some(o=>o.label==='God of Thunder'),'each player only receives their own action options');
ok((await call('POST',`/battles/${ch.id}/action`,{turn:1,key:'ab:a9'},A.token)).s===400,'unknown action rejected');
const gk=vA.me.options.find(o=>o.label==='God of Thunder').key;const r1=await call('POST',`/battles/${ch.id}/action`,{turn:1,key:gk},A.token);ok(r1.s===200,'Alpha locks God of Thunder');
const spec=JSON.stringify((await call('GET',`/battles/${ch.id}`)).j),vB2=JSON.stringify((await call('GET',`/battles/${ch.id}`,null,B.token)).j);
ok(!/God of Thunder/.test(spec)&&!/God of Thunder/.test(vB2),'locked action is hidden from opponent and spectators');
ok((await call('GET',`/battles/${ch.id}`,null,B.token)).j.sides[0].ready===true,'opponent sees only that Alpha is ready');
ok((await call('POST',`/battles/${ch.id}/action`,{turn:1,key:'defend'},A.token)).j.already===true,'repeat submit is idempotent (action stays locked)');
const adminV=JSON.stringify((await call('GET',`/battles/${ch.id}`,null,adm)).j);ok(/God of Thunder/.test(adminV),'admin can inspect locked actions');
await call('POST',`/battles/${ch.id}/action`,{turn:1,key:'attack'},B.token);
let v=(await call('GET',`/battles/${ch.id}`,null,A.token)).j;ok(v.state==='TurnSummary'&&v.turns.length===1,'both locked -> turn resolved once');
const w1=v.sides[1].chars.find(c=>c.id===wolv).hp;ok(w1<v.sides[1].chars.find(c=>c.id===wolv).max,'damage applied: Wolverine hp '+w1);
ok((await call('POST',`/battles/${ch.id}/action`,{turn:1,key:'attack'},B.token)).s===400,'late/stale action rejected after resolution');
await wait(900);v=(await call('GET',`/battles/${ch.id}`,null,A.token)).j;ok(v.state==='ActionSelection'&&v.turn===2,'auto-advanced to turn 2');
/* switching keeps health */
const swKey=(await call('GET',`/battles/${ch.id}`,null,B.token)).j.me.options.find(o=>o.key==='sw:'+spid).key;
await call('POST',`/battles/${ch.id}/action`,{turn:2,key:'defend'},A.token);await call('POST',`/battles/${ch.id}/action`,{turn:2,key:swKey},B.token);
v=(await call('GET',`/battles/${ch.id}`,null,A.token)).j;ok(v.sides[1].chars.find(c=>c.id===wolv).hp===w1&&v.sides[1].active===spid,'switch consumed the action; Wolverine keeps his health');
/* play to the end */
let safe=0;while(safe++<60){await wait(250);const V=async t=>(await call('GET',`/battles/${ch.id}`,null,t)).j;let x=await V(A.token);if(x.state==='Finished')break;
 for(const[T,own]of[[A,'A'],[B,'B']]){x=await V(T.token);if(x.state==='ActionSelection'&&!x.me.locked){const o=x.me.options.filter(o=>!o.reason&&(o.kind==='attack'));const k=(o.sort((p,q)=>q.power-p.power)[0]||x.me.options.find(o=>!o.reason)).key;await call('POST',`/battles/${ch.id}/action`,{turn:x.turn,key:k},T.token)}
  if(x.state==='CharacterReplacement'&&x.me.needsReplacement){const c=x.sides.find(s=>s.teamId===x.me.teamId).chars.find(c=>!c.eliminated);await call('POST',`/battles/${ch.id}/select`,{charId:c.id},T.token)}}}
v=(await call('GET',`/battles/${ch.id}`,null,A.token)).j;ok(v.state==='Finished'&&v.winner,'battle finished with a winner after '+v.turns.length+' turns');
ok(['BattleWon','BattleLost'].includes(v.derived),'derived state: '+v.derived);
const lb=(await call('GET','/leaderboard')).j;ok(lb[0].wins===1&&lb[1].losses===1&&lb[0].rating>1000,'leaderboard updated: '+lb.map(t=>t.name+' '+t.rating).join(', '));
ok((await call('GET','/characters')).j.every(c=>c.currentHealth===c.maxHealth),'arena mode: health restored after the battle');
ok(v.turns.every(t=>t.events.length),'turn history recorded with events');
/* history visibility */
const hp=JSON.stringify((await call('GET','/history',null,B.token)).j),ha=(await call('GET','/admin/history',null,adm)).j;
ok(!/bid\.rejected|battle\.action\.locked/.test(hp)&&ha.events.some(e=>e.type==='bid.rejected')&&ha.events.some(e=>e.type==='battle.action.locked'),'hidden/private events only in admin history');
ok(!new RegExp(tA.id).test(JSON.stringify((await call('GET','/history',null,B.token)).j.events.filter(e=>e.type==='balance.changed'))),'other team balance events are not visible');
/* admin features */
const nc=(await call('POST','/admin/characters',{name:'Test Hero',rarity:'Rare',category:'Test',basePrice:50,maxHealth:200,attack:50,defence:40,speed:30,abilities:[{name:'Zap',kind:'attack',power:1.5,cost:10,cd:1}]},adm));ok(nc.s===200,'admin creates a character');
ok((await call('POST','/admin/characters',{name:'',rarity:'Rare'},adm)).s===400,'admin character validation rejects bad data');
ok((await call('DELETE','/admin/characters/'+nc.j.id,{},adm)).s===400,'delete needs confirmation');ok((await call('DELETE','/admin/characters/'+nc.j.id,{confirm:true,hard:true},adm)).s===200,'confirmed delete works');
ok((await call('POST','/admin/reset',{confirm:'yes'},adm)).s===400,'reset needs explicit RESET');
/* persistence across restart */
await call('GET','/state');await wait(300);const files=fs.readdirSync(DIR);ok(['characters','teams','players','auction','battles','game-history','settings','admin'].every(f=>files.includes(f+'.json')),'all JSON files exist: '+files.filter(f=>f.endsWith('.json')).join(', '));
const bak=(await call('GET','/admin/backup',null,adm)).j;ok(bak.files.teams.length===2&&!bak.files.admin,'backup exports data without admin credentials');
await stop();await start(PORT+1);const U2='http://localhost:'+(PORT+1);
const t2=(await call('GET','/teams',null,null,U2)).j;ok(t2.length===2&&t2.every(t=>t.roster.length===2),'after restart rosters are restored');
const lg=await call('POST','/login',{username:'alice',password:'password1'},null,U2);ok(lg.s===200,'player can log in after restart');ok((await call('GET','/me',null,lg.j.token,U2)).j.team.balance===tA.balance,'private balance persisted');
ok((await call('GET','/battles/'+ch.id,null,null,U2)).j.state==='Finished','battle history persisted');
const adm2=(await call('POST','/admin/login',{username:'admin',password:'TestAdmin#123'},null,U2)).j.token;
ok((await call('POST','/admin/restore',{confirm:true,files:{teams:5}},adm2,U2)).s===400,'malformed backup rejected');ok((await call('POST','/admin/restore',{confirm:true,files:bak.files},adm2,U2)).s===200,'valid backup restores');
ok((await call('POST','/admin/reset',{confirm:'RESET'},adm2,U2)).s===200&&(await call('GET','/teams',null,null,U2)).j.length===0,'reset with confirmation clears game state');
ok((await call('GET','/admin/history',null,adm2,U2)).j.events.some(e=>e.type==='admin.game.reset'),'history survives the reset and records it');
await stop();
/* corrupted file */
fs.writeFileSync(path.join(DIR,'teams.json'),'{ not json');await start(PORT+2);ok((await call('GET','/teams',null,null,'http://localhost:'+(PORT+2))).s===200&&fs.readdirSync(DIR).some(f=>f.startsWith('teams.json.corrupt')),'corrupted JSON is moved aside and defaults restored');await stop();
console.log(fails?`\n${fails} FAILED`:'\nALL PASSED');process.exit(fails?1:0);
