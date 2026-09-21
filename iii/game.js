/* Star Fighter - vertical scroller shmup, vanilla JS + Canvas, no deps */
(function(){
'use strict';
const W=480,H=640;
const canvas=document.getElementById('game');
const ctx=canvas.getContext('2d');
ctx.imageSmoothingEnabled=false;

//////////////////// AUDIO (procedural, Web Audio API) ////////////////////
const Audio_ = (function(){
  let actx=null;
  function ctxOn(){ if(!actx){ try{ actx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } }
  function tone(freq,dur,type,vol,slideTo){
    if(!actx) return;
    const o=actx.createOscillator();
    const g=actx.createGain();
    o.type=type||'square';
    o.frequency.setValueAtTime(freq,actx.currentTime);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1,slideTo),actx.currentTime+dur);
    g.gain.setValueAtTime((vol!=null?vol:0.15),actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,actx.currentTime+dur);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime+dur);
  }
  function noise(dur,vol){
    if(!actx) return;
    const bufferSize=actx.sampleRate*dur;
    const buffer=actx.createBuffer(1,bufferSize,actx.sampleRate);
    const data=buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++) data[i]=(Math.random()*2-1)*(1-i/bufferSize);
    const src=actx.createBufferSource(); src.buffer=buffer;
    const g=actx.createGain(); g.gain.setValueAtTime((vol!=null?vol:0.2),actx.currentTime);
    src.connect(g); g.connect(actx.destination); src.start();
  }
  return {
    unlock: ctxOn,
    shoot(){ tone(880,0.08,'square',0.06,440); },
    enemyShoot(){ tone(220,0.1,'sawtooth',0.05,120); },
    explosion(){ noise(0.3,0.25); tone(120,0.25,'triangle',0.12,40); },
    hit(){ tone(150,0.15,'square',0.15,60); },
    powerup(){ tone(440,0.12,'square',0.1,880); tone(660,0.12,'square',0.08,1320); },
    boss(){ tone(80,0.5,'sawtooth',0.2,40); },
    gameover(){ tone(300,0.6,'sawtooth',0.2,60); },
  };
})();

//////////////////// INPUT ////////////////////
const keys={};
const touch={left:false,right:false,up:false,down:false,fire:false,pause:false};
window.addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  Audio_.unlock();
});
window.addEventListener('keyup',e=>{ keys[e.code]=false; });

function bindTouch(id,prop){
  const el=document.getElementById(id);
  if(!el) return;
  const on=e=>{ e.preventDefault(); touch[prop]=true; Audio_.unlock(); };
  const off=e=>{ e.preventDefault(); touch[prop]=false; };
  el.addEventListener('touchstart',on,{passive:false});
  el.addEventListener('touchend',off,{passive:false});
  el.addEventListener('touchcancel',off,{passive:false});
  el.addEventListener('mousedown',on);
  el.addEventListener('mouseup',off);
  el.addEventListener('mouseleave',off);
}
bindTouch('tLeft','left'); bindTouch('tRight','right'); bindTouch('tUp','up'); bindTouch('tDown','down');
bindTouch('tFire','fire');
document.getElementById('tPause')?.addEventListener('touchstart',e=>{e.preventDefault(); pausePressed=true;},{passive:false});
document.getElementById('tPause')?.addEventListener('mousedown',()=>{pausePressed=true;});

function left(){ return keys['ArrowLeft']||keys['KeyA']||touch.left; }
function right(){ return keys['ArrowRight']||keys['KeyD']||touch.right; }
function up(){ return keys['ArrowUp']||keys['KeyW']||touch.up; }
function down(){ return keys['ArrowDown']||keys['KeyS']||touch.down; }
function fire(){ return keys['Space']||touch.fire; }
let pausePressed=false;
let prevPauseKey=false;

//////////////////// STARFIELD ////////////////////
const stars=[];
for(let i=0;i<120;i++){
  stars.push({x:Math.random()*W,y:Math.random()*H,z:Math.random()*2+0.5,r:Math.random()*1.5+0.5});
}
function updateStars(dt){
  for(const s of stars){
    s.y+=s.z*60*dt;
    if(s.y>H){ s.y=0; s.x=Math.random()*W; }
  }
}
function drawStars(){
  ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  for(const s of stars){
    ctx.fillStyle=`rgba(255,255,255,${0.3+s.z*0.35})`;
    ctx.fillRect(s.x,s.y,s.r,s.r);
  }
}

//////////////////// UTIL ////////////////////
function aabb(a,b){
  return a.x-a.w/2 < b.x+b.w/2 && a.x+a.w/2 > b.x-b.w/2 &&
         a.y-a.h/2 < b.y+b.h/2 && a.y+a.h/2 > b.y-b.h/2;
}
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function rand(a,b){ return a+Math.random()*(b-a); }

//////////////////// OBJECT POOLS ////////////////////
function makePool(factory,size){
  const pool=[]; for(let i=0;i<size;i++){ const o=factory(); o.active=false; pool.push(o); }
  return {
    pool,
    get(){ for(const o of pool){ if(!o.active){ o.active=true; return o; } }
      const o=factory(); o.active=true; pool.push(o); return o; },
    each(fn){ for(const o of pool){ if(o.active) fn(o); } },
    count(){ let c=0; for(const o of pool) if(o.active) c++; return c; }
  };
}

const playerBullets=makePool(()=>({x:0,y:0,w:4,h:10,vx:0,vy:-500,dmg:1,active:false}),40);
const enemyBullets=makePool(()=>({x:0,y:0,w:6,h:6,vx:0,vy:200,active:false}),60);
const particles=makePool(()=>({x:0,y:0,vx:0,vy:0,life:0,maxLife:1,color:'#fff',size:2,active:false}),200);
const powerups=makePool(()=>({x:0,y:0,w:16,h:16,vy:80,type:'weapon',active:false}),10);

function spawnExplosion(x,y,color,count){
  Audio_.explosion();
  for(let i=0;i<(count||18);i++){
    const p=particles.get();
    const a=Math.random()*Math.PI*2, sp=rand(30,220);
    p.x=x; p.y=y; p.vx=Math.cos(a)*sp; p.vy=Math.sin(a)*sp;
    p.life=p.maxLife=rand(0.3,0.7);
    p.color=color||'#ffaa33'; p.size=rand(1.5,3.5);
  }
}

//////////////////// SCREEN SHAKE ////////////////////
let shakeTime=0, shakeMag=0;
function addShake(t,m){ shakeTime=Math.max(shakeTime,t); shakeMag=Math.max(shakeMag,m); }

//////////////////// GAME STATE ////////////////////
let state='title'; // title, playing, paused, gameover
let score=0, highScore=parseInt(localStorage.getItem('starfighter_hs')||'0',10);
let elapsedTime=0;

const player={
  x:W/2, y:H-80, w:28, h:28, speed:260, cooldown:0, fireRate:0.18,
  lives:3, invuln:0, weaponLevel:1, shield:0, bombs:1,
};

function resetPlayer(){
  player.x=W/2; player.y=H-80; player.cooldown=0; player.lives=3;
  player.invuln=2; player.weaponLevel=1; player.shield=0; player.bombs=1;
}

//////////////////// ENEMIES ////////////////////
let enemies=[];
let enemyId=0;
function spawnEnemy(type,x,y){
  const base={id:enemyId++, type, x, y, w:26, h:26, hp:1, t:0, vy:90, active:true, fireTimer:rand(1,2.5)};
  if(type==='straight'){ base.hp=1; base.color='#e74c3c'; }
  else if(type==='sine'){ base.hp=2; base.color='#3498db'; base.amp=rand(60,110); base.freq=rand(1.5,2.5); base.baseX=x; }
  else if(type==='diver'){ base.hp=2; base.color='#9b59b6'; base.diving=false; base.diveT=0; }
  return base;
}

let boss=null;
function spawnBoss(){
  Audio_.boss();
  boss={
    x:W/2, y:-80, w:120, h:90, hp:120, maxHp:120, t:0, phase:0, phaseTimer:0,
    active:true, entering:true, fireTimer:0.5
  };
}

//////////////////// WAVE TIMELINE ////////////////////
// Each entry: {time, action}
let timeline=[];
let timelineIdx=0;
function buildTimeline(){
  timeline=[];
  let t=1;
  for(let i=0;i<6;i++){ timeline.push({time:t, action:()=>spawnEnemy('straight', 40+Math.random()*(W-80), -30)}); t+=0.8; }
  t+=1;
  for(let i=0;i<6;i++){ timeline.push({time:t, action:()=>spawnEnemy('sine', 60+Math.random()*(W-120), -30)}); t+=0.9; }
  t+=1;
  for(let i=0;i<5;i++){ timeline.push({time:t, action:()=>spawnEnemy('diver', 40+Math.random()*(W-80), -30)}); t+=1.0; }
  t+=1;
  // mixed wave
  for(let i=0;i<8;i++){
    const types=['straight','sine','diver'];
    const ty=types[i%3];
    timeline.push({time:t, action:()=>spawnEnemy(ty, 40+Math.random()*(W-80), -30)});
    t+=0.6;
  }
  t+=2;
  timeline.push({time:t, action:()=>spawnBoss()});
}
buildTimeline();

//////////////////// DIFFICULTY SCALING ////////////////////
function difficultyMult(){ return 1 + elapsedTime/60; } // ramps over time

//////////////////// PLAYER UPDATE ////////////////////
function playerShoot(){
  const lvl=player.weaponLevel;
  Audio_.shoot();
  if(lvl===1){
    const b=playerBullets.get(); b.x=player.x; b.y=player.y-18; b.vx=0; b.vy=-500; b.w=4; b.h=10;
  } else if(lvl===2){
    let b=playerBullets.get(); b.x=player.x-8; b.y=player.y-16; b.vx=0; b.vy=-500; b.w=4; b.h=10;
    b=playerBullets.get(); b.x=player.x+8; b.y=player.y-16; b.vx=0; b.vy=-500; b.w=4; b.h=10;
  } else {
    let b=playerBullets.get(); b.x=player.x; b.y=player.y-18; b.vx=0; b.vy=-520; b.w=4; b.h=12;
    b=playerBullets.get(); b.x=player.x-10; b.y=player.y-12; b.vx=-90; b.vy=-480; b.w=4; b.h=10;
    b=playerBullets.get(); b.x=player.x+10; b.y=player.y-12; b.vx=90; b.vy=-480; b.w=4; b.h=10;
  }
}

function updatePlayer(dt){
  if(left()) player.x-=player.speed*dt;
  if(right()) player.x+=player.speed*dt;
  if(up()) player.y-=player.speed*dt;
  if(down()) player.y+=player.speed*dt;
  player.x=clamp(player.x,player.w/2,W-player.w/2);
  player.y=clamp(player.y,player.h/2,H-player.h/2);

  player.cooldown-=dt;
  if(fire() && player.cooldown<=0){ playerShoot(); player.cooldown=player.fireRate; }
  if(player.invuln>0) player.invuln-=dt;
}

function drawPlayer(){
  ctx.save();
  ctx.translate(player.x,player.y);
  if(player.invuln>0 && Math.floor(player.invuln*10)%2===0){ ctx.globalAlpha=0.4; }
  // simple triangle ship sprite
  ctx.fillStyle='#2ecc71';
  ctx.beginPath();
  ctx.moveTo(0,-16); ctx.lineTo(14,14); ctx.lineTo(0,8); ctx.lineTo(-14,14);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle='#1abc9c';
  ctx.fillRect(-3,-4,6,10);
  if(player.shield>0){
    ctx.strokeStyle=`rgba(80,180,255,${0.5+0.3*Math.sin(elapsedTime*8)})`;
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(0,0,22,0,Math.PI*2); ctx.stroke();
  }
  ctx.restore();
}

//////////////////// ENEMY UPDATE ////////////////////
function enemyShoot(e){
  Audio_.enemyShoot();
  const b=enemyBullets.get();
  const dx=player.x-e.x, dy=player.y-e.y, d=Math.hypot(dx,dy)||1;
  const sp=180*difficultyMult();
  b.x=e.x; b.y=e.y; b.vx=dx/d*sp; b.vy=dy/d*sp;
}

function updateEnemies(dt){
  const dm=difficultyMult();
  for(const e of enemies){
    if(!e.active) continue;
    e.t+=dt;
    e.fireTimer-=dt;
    if(e.fireTimer<=0 && e.y>0 && e.y<H-40){ enemyShoot(e); e.fireTimer=rand(1.2,2.2)/dm; }
    if(e.type==='straight'){
      e.y+=e.vy*dm*dt;
    } else if(e.type==='sine'){
      e.y+=e.vy*dm*dt;
      e.x=e.baseX+Math.sin(e.t*e.freq)*e.amp;
    } else if(e.type==='diver'){
      if(!e.diving){
        e.y+=60*dm*dt;
        if(e.y>100+Math.random()*60){ e.diving=true; e.diveVX=(player.x-e.x)/1.2; e.diveVY=260*dm; }
      } else {
        e.x+=e.diveVX*dt*0.6;
        e.y+=e.diveVY*dt;
      }
    }
    if(e.y>H+40) e.active=false;
  }
  enemies=enemies.filter(e=>e.active);
}

function drawEnemies(){
  for(const e of enemies){
    ctx.save();
    ctx.translate(e.x,e.y);
    ctx.fillStyle=e.color;
    if(e.type==='straight'){
      ctx.beginPath(); ctx.moveTo(0,14); ctx.lineTo(13,-10); ctx.lineTo(-13,-10); ctx.closePath(); ctx.fill();
    } else if(e.type==='sine'){
      ctx.beginPath(); ctx.arc(0,0,13,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#1c5b7a'; ctx.fillRect(-3,-3,6,6);
    } else {
      ctx.beginPath();
      ctx.moveTo(0,-14); ctx.lineTo(13,10); ctx.lineTo(0,4); ctx.lineTo(-13,10);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}

//////////////////// BOSS ////////////////////
function updateBoss(dt){
  if(!boss) return;
  boss.t+=dt;
  if(boss.entering){
    boss.y+=60*dt;
    if(boss.y>=100){ boss.y=100; boss.entering=false; }
    return;
  }
  boss.x=W/2+Math.sin(boss.t*0.6)*140;
  boss.phaseTimer-=dt;
  if(boss.phaseTimer<=0){ boss.phase=(boss.phase+1)%3; boss.phaseTimer=rand(3,4.5); }
  boss.fireTimer-=dt;
  if(boss.fireTimer<=0){
    if(boss.phase===0){
      // spread shot
      for(let i=-2;i<=2;i++){
        const b=enemyBullets.get(); b.x=boss.x; b.y=boss.y+30;
        const ang=Math.PI/2+i*0.25; b.vx=Math.cos(ang)*180; b.vy=Math.sin(ang)*180;
      }
      boss.fireTimer=0.7;
    } else if(boss.phase===1){
      // aimed shot
      const dx=player.x-boss.x, dy=player.y-boss.y, d=Math.hypot(dx,dy)||1;
      const b=enemyBullets.get(); b.x=boss.x; b.y=boss.y+30; b.vx=dx/d*260; b.vy=dy/d*260;
      boss.fireTimer=0.25;
    } else {
      // ring burst
      for(let i=0;i<10;i++){
        const a=(i/10)*Math.PI*2;
        const b=enemyBullets.get(); b.x=boss.x; b.y=boss.y+30; b.vx=Math.cos(a)*160; b.vy=Math.sin(a)*160;
      }
      boss.fireTimer=1.4;
    }
  }
}
function drawBoss(){
  if(!boss) return;
  ctx.save();
  ctx.translate(boss.x,boss.y);
  ctx.fillStyle='#c0392b';
  ctx.fillRect(-60,-40,120,80);
  ctx.fillStyle='#e67e22';
  ctx.fillRect(-40,-20,80,40);
  ctx.fillStyle='#f1c40f';
  ctx.beginPath(); ctx.arc(0,0,14,0,Math.PI*2); ctx.fill();
  ctx.restore();
  // health bar
  const bw=W-40;
  ctx.fillStyle='#333'; ctx.fillRect(20,14,bw,10);
  ctx.fillStyle='#e74c3c'; ctx.fillRect(20,14,bw*(boss.hp/boss.maxHp),10);
  ctx.strokeStyle='#fff'; ctx.strokeRect(20,14,bw,10);
}

//////////////////// POWERUPS ////////////////////
function maybeDropPowerup(x,y){
  if(Math.random()<0.18){
    const p=powerups.get();
    p.x=x; p.y=y;
    const r=Math.random();
    p.type = r<0.5?'weapon': (r<0.8?'shield':'bomb');
  }
}
function updatePowerups(dt){
  powerups.each(p=>{
    p.y+=p.vy*dt;
    if(p.y>H+20) p.active=false;
    if(aabb(p,player)){
      Audio_.powerup();
      if(p.type==='weapon'){ player.weaponLevel=Math.min(3,player.weaponLevel+1); }
      else if(p.type==='shield'){ player.shield=8; }
      else if(p.type==='bomb'){ player.bombs=Math.min(3,player.bombs+1); }
      p.active=false;
    }
  });
}
function drawPowerups(){
  powerups.each(p=>{
    ctx.save(); ctx.translate(p.x,p.y);
    ctx.fillStyle = p.type==='weapon'?'#f1c40f': p.type==='shield'?'#3498db':'#e74c3c';
    ctx.beginPath(); ctx.arc(0,0,9,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#000'; ctx.font='10px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(p.type==='weapon'?'W':p.type==='shield'?'S':'B',0,1);
    ctx.restore();
  });
}

//////////////////// BULLETS ////////////////////
function updateBullets(dt){
  playerBullets.each(b=>{
    b.x+=b.vx*dt; b.y+=b.vy*dt;
    if(b.y<-20||b.x<-20||b.x>W+20) b.active=false;
  });
  enemyBullets.each(b=>{
    b.x+=b.vx*dt; b.y+=b.vy*dt;
    if(b.y>H+20||b.y<-20||b.x<-20||b.x>W+20) b.active=false;
  });
}
function drawBullets(){
  ctx.fillStyle='#ffff66';
  playerBullets.each(b=>{ ctx.fillRect(b.x-b.w/2,b.y-b.h/2,b.w,b.h); });
  ctx.fillStyle='#ff5555';
  enemyBullets.each(b=>{ ctx.beginPath(); ctx.arc(b.x,b.y,b.w/2,0,Math.PI*2); ctx.fill(); });
}

//////////////////// PARTICLES ////////////////////
function updateParticles(dt){
  particles.each(p=>{
    p.life-=dt;
    p.x+=p.vx*dt; p.y+=p.vy*dt;
    p.vx*=0.96; p.vy*=0.96;
    if(p.life<=0) p.active=false;
  });
}
function drawParticles(){
  particles.each(p=>{
    ctx.globalAlpha=Math.max(0,p.life/p.maxLife);
    ctx.fillStyle=p.color;
    ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);
  });
  ctx.globalAlpha=1;
}

//////////////////// COLLISIONS ////////////////////
function damagePlayer(){
  if(player.invuln>0) return;
  if(player.shield>0){ player.shield=0; Audio_.hit(); addShake(0.2,4); return; }
  player.lives--;
  Audio_.hit();
  addShake(0.3,8);
  spawnExplosion(player.x,player.y,'#2ecc71',24);
  player.invuln=2;
  if(player.lives<=0){
    endGame();
  }
}

function handleCollisions(){
  // player bullets vs enemies
  playerBullets.each(b=>{
    if(!b.active) return;
    for(const e of enemies){
      if(!e.active) continue;
      if(aabb(b,e)){
        b.active=false; e.hp-=1;
        if(e.hp<=0){
          e.active=false; score+=100;
          spawnExplosion(e.x,e.y,e.color,20);
          maybeDropPowerup(e.x,e.y);
          addShake(0.1,2);
        }
        break;
      }
    }
    if(b.active && boss && boss.active && !boss.entering){
      const bb={x:boss.x,y:boss.y,w:boss.w,h:boss.h};
      if(aabb(b,bb)){
        b.active=false; boss.hp-=1; score+=10;
        spawnExplosion(b.x,b.y,'#f39c12',6);
        if(boss.hp<=0){
          spawnExplosion(boss.x,boss.y,'#e74c3c',60);
          addShake(0.6,12);
          score+=5000;
          boss.active=false; boss=null;
          winGame();
        }
      }
    }
  });
  // enemy bullets vs player
  enemyBullets.each(b=>{
    if(!b.active) return;
    if(aabb(b,player)){ b.active=false; damagePlayer(); }
  });
  // enemies vs player (collision)
  for(const e of enemies){
    if(!e.active) continue;
    if(aabb(e,player)){
      e.active=false; score+=50;
      spawnExplosion(e.x,e.y,e.color,20);
      damagePlayer();
    }
  }
  // boss body vs player
  if(boss && boss.active && !boss.entering){
    const bb={x:boss.x,y:boss.y,w:boss.w,h:boss.h};
    if(aabb(bb,player)) damagePlayer();
  }
}

function useBomb(){
  if(player.bombs<=0) return;
  player.bombs--;
  Audio_.explosion();
  addShake(0.4,10);
  for(const e of enemies){ if(e.active){ spawnExplosion(e.x,e.y,e.color,14); e.active=false; score+=80; } }
  enemies=[];
  enemyBullets.each(b=>b.active=false);
  if(boss && boss.active){ boss.hp-=20; if(boss.hp<0) boss.hp=0; }
}
let prevBombKey=false;

//////////////////// STATE MACHINE ////////////////////
function startGame(){
  state='playing';
  score=0; elapsedTime=0;
  enemies=[]; boss=null; timelineIdx=0;
  playerBullets.each(b=>b.active=false);
  enemyBullets.each(b=>b.active=false);
  particles.each(p=>p.active=false);
  powerups.each(p=>p.active=false);
  buildTimeline();
  resetPlayer();
}
function endGame(){
  state='gameover';
  Audio_.gameover();
  if(score>highScore){ highScore=score; localStorage.setItem('starfighter_hs',String(highScore)); }
}
function winGame(){
  state='gameover';
  if(score>highScore){ highScore=score; localStorage.setItem('starfighter_hs',String(highScore)); }
}

//////////////////// MAIN UPDATE ////////////////////
function updateTimeline(dt){
  elapsedTime+=dt;
  while(timelineIdx<timeline.length && timeline[timelineIdx].time<=elapsedTime){
    const item=timeline[timelineIdx];
    const res=item.action();
    if(res && res.type) enemies.push(res);
    timelineIdx++;
  }
}

function update(dt){
  updateStars(dt);
  if(state!=='playing'){
    if(shakeTime>0) shakeTime=Math.max(0,shakeTime-dt);
    return;
  }
  updateTimeline(dt);
  updatePlayer(dt);
  updateEnemies(dt);
  if(boss) updateBoss(dt);
  updateBullets(dt);
  updatePowerups(dt);
  updateParticles(dt);
  handleCollisions();
  if(shakeTime>0) shakeTime=Math.max(0,shakeTime-dt);

  const bombKey=keys['KeyB']||keys['ShiftLeft'];
  if(bombKey && !prevBombKey) useBomb();
  prevBombKey=bombKey;
}

//////////////////// DRAW ////////////////////
function drawHUD(){
  ctx.fillStyle='#fff';
  ctx.font='16px monospace';
  ctx.textAlign='left'; ctx.textBaseline='top';
  ctx.fillText('SCORE '+score,8,8);
  ctx.fillText('HI '+highScore,8,28);
  ctx.textAlign='right';
  ctx.fillText('LIVES '+player.lives,W-8,8);
  ctx.fillText('BOMBS '+player.bombs,W-8,28);
  if(player.weaponLevel>1){ ctx.textAlign='left'; ctx.fillText('WPN Lv'+player.weaponLevel,8,48); }
}

function drawCentered(lines,startY,sizes){
  ctx.textAlign='center';
  lines.forEach((l,i)=>{
    ctx.font=(sizes&&sizes[i]||20)+'px monospace';
    ctx.fillText(l,W/2,startY+i*32);
  });
  ctx.textAlign='left';
}

function draw(){
  ctx.save();
  if(shakeTime>0){
    const dx=(Math.random()*2-1)*shakeMag, dy=(Math.random()*2-1)*shakeMag;
    ctx.translate(dx,dy);
  }
  drawStars();
  if(state==='title'){
    ctx.fillStyle='#fff';
    drawCentered(['STAR FIGHTER'],220,[36]);
    ctx.fillStyle='#aaa';
    drawCentered(['Arrows/WASD move, Space fire','B/Shift bomb, P pause','','Press SPACE to start'],300,[14,14,14,18]);
    ctx.fillStyle='#f1c40f';
    drawCentered(['HI SCORE '+highScore],460,[16]);
  } else {
    drawEnemies();
    if(boss) drawBoss();
    drawPowerups();
    drawBullets();
    drawParticles();
    if(state!=='gameover') drawPlayer();
    drawHUD();
    if(state==='paused'){
      ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#fff'; drawCentered(['PAUSED'],290,[32]);
    }
    if(state==='gameover'){
      ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#e74c3c'; drawCentered(['GAME OVER'],250,[34]);
      ctx.fillStyle='#fff'; drawCentered(['Score '+score,'Hi Score '+highScore,'Press SPACE to restart'],300,[18,18,16]);
    }
  }
  ctx.restore();
}

//////////////////// INPUT: STATE TRANSITIONS ////////////////////
let prevSpace=false;
function handleStateInput(){
  const spacePressed = keys['Space']||touch.fire;
  const spaceJustPressed = spacePressed && !prevSpace;
  prevSpace=spacePressed;

  if(state==='title' && spaceJustPressed){ startGame(); }
  else if(state==='gameover' && spaceJustPressed){ startGame(); }

  const pKey = keys['KeyP'] || pausePressed;
  const pJustPressed = pKey && !prevPauseKey;
  prevPauseKey=pKey;
  pausePressed=false;
  if(pJustPressed){
    if(state==='playing') state='paused';
    else if(state==='paused') state='playing';
  }
}

//////////////////// GAME LOOP (fixed timestep) ////////////////////
const STEP=1/60;
let acc=0, last=performance.now();
function frame(now){
  requestAnimationFrame(frame);
  let dt=(now-last)/1000;
  last=now;
  if(dt>0.25) dt=0.25; // avoid spiral of death on tab-switch
  acc+=dt;
  handleStateInput();
  while(acc>=STEP){
    update(STEP);
    acc-=STEP;
  }
  draw();
}
requestAnimationFrame(frame);
})();
