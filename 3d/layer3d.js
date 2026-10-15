// v22: 3D map layer. When zoomed in, settlements, garrisons, trees and rocks are drawn as small 3D models on the map
// (a tilted orthographic camera, so each model stands on its map cell). Models: Kenney (CC0), base64 glTF in models.js;
// modern buildings, factories and the tank are built here. Buildings and plants are instanced (a fixed number of draw
// calls); people are skinned clones from a capped pool. Animation runs on the real clock, not the simulation clock.
import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const here=n=>new URL(n,import.meta.url).href,TILT=55*Math.PI/180,SN=Math.sin(TILT),MAXP=40,PS=28,ZONE=6.5;
let R,S,cam,cv,src=null,lastDraw=0,loaded=null,M={},SK={},on=false,lastKey="",lastBuild=0;
// map colour -> instance colour: multiplied with the model's own colours, scaled so the brightest channel is 1.6
const tintOf=(t,out)=>{if(!t)return out.copy(WHITE);out.setRGB(t[0]/255,t[1]/255,t[2]/255,THREE.SRGBColorSpace);return out.multiplyScalar(1.6/Math.max(.05,out.r,out.g,out.b))};
const PROTO={},POOL=new Map(),IM=new Map(),clock=new THREE.Clock(),tmpM=new THREE.Matrix4(),tmpC=new THREE.Color(),WHITE=new THREE.Color(1,1,1);

// ---------- prototypes: each is flattened into parts (geometry, material, matrix in zone units) ----------
const flat=root=>{root.updateMatrixWorld(true);const inv=new THREE.Matrix4().copy(root.matrixWorld).invert(),parts=[];
  root.traverse(o=>{if(o.isMesh&&!o.isSkinnedMesh)parts.push({key:o.geometry.uuid+o.material.uuid,g:o.geometry,m:o.material,x:new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld)})});return parts};
const mat=(c,r=.85,m=0)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:m});
const canvasTex=(w,h,draw)=>{const c=document.createElement("canvas");c.width=w;c.height=h;draw(c.getContext("2d"),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;return t};

function buildProtos(){
  const centered=n=>{const s=M[n].scene.clone(),b=new THREE.Box3().setFromObject(s),c=b.getCenter(new THREE.Vector3());s.position.set(-c.x,-b.min.y,-c.z);const w=new THREE.Group();w.add(s);return w};
  const put=(n,g,x,z,o={})=>{const m=centered(n);m.position.set(x,o.y||0,z);m.rotation.y=o.r||0;m.scale.setScalar(o.s||1);
    if(o.tint)m.traverse(k=>{if(k.isMesh){k.material=k.material.clone();k.material.color.lerp(new THREE.Color(o.tint),.75)}});g.add(m);return m};
  const house=(g,x,z,w,door,win,o={})=>{const h=new THREE.Group(),fl=o.floors||1;h.position.set(x,0,z);h.rotation.y=o.r||0;h.scale.setScalar(o.s||1);g.add(h);
    for(let f=0;f<fl;f++)[f?win:door,win,w,win].forEach((n,i)=>{const m=M[n].scene.clone();m.rotation.y=i*Math.PI/2;m.position.y=f;h.add(m)});
    const roof=M.roofPoint.scene.clone();roof.position.y=fl;h.add(roof);if(o.chimney){const c=M.chimney.scene.clone();c.position.y=fl-.2;h.add(c)}};
  const brick=canvasTex(128,128,(g,w,h)=>{g.fillStyle="#9a4a36";g.fillRect(0,0,w,h);g.fillStyle="#7e3a2a";for(let y=0;y<h;y+=16){g.fillRect(0,y,w,2);for(let x=(y/16)%2*16;x<w;x+=32)g.fillRect(x,y,2,16)}});
  const windows=base=>canvasTex(128,128,(g,w,h)=>{g.fillStyle=base;g.fillRect(0,0,w,h);for(let y=10;y<h;y+=32)for(let x=10;x<w;x+=32){g.fillStyle="#e8e8e8";g.fillRect(x-2,y-2,20,20);g.fillStyle="#9cc8e6";g.fillRect(x,y,16,16)}});
  const box=(g,w,h,d,m,x,y,z)=>{const b=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);b.position.set(x,y+h/2,z);g.add(b);return b};
  const factory3=(g,x,z)=>{const f=new THREE.Group();f.position.set(x,0,z);g.add(f);const t=brick.clone();t.repeat.set(3,1);t.needsUpdate=true;const bm=new THREE.MeshStandardMaterial({map:t,roughness:.95});
    box(f,2.6,1.1,1.6,bm,0,0,0);const saw=new THREE.CylinderGeometry(.36,.36,1.6,3),sm=mat(0x4a4f57);
    for(let i=0;i<4;i++){const s=new THREE.Mesh(saw,sm);s.rotation.set(Math.PI/2,Math.PI,0);s.position.set(-.97+i*.65,1.1,0);f.add(s)}
    const c=new THREE.Mesh(new THREE.CylinderGeometry(.16,.2,3.1,12),bm);c.position.set(1.05,1.55,-.55);f.add(c)};
  const apt=(g,x,z,w,d,h,col)=>{const t=windows(col);t.repeat.set(Math.round(w*2),Math.round(h*2));box(g,w,h,d,new THREE.MeshStandardMaterial({map:t,roughness:.8}),x,0,z);box(g,w*.3,.25,d*.3,mat(0xb0b4b8),x,h,z)};
  const factory4=(g,x,z)=>{const f=new THREE.Group();f.position.set(x,0,z);g.add(f);box(f,2.6,.9,1.5,mat(0x9aa3ab,.6,.3),0,0,0);
    const r=new THREE.Mesh(new THREE.CylinderGeometry(.75,.75,2.6,16,1,false,0,Math.PI),mat(0x7d8790,.5,.4));r.rotation.z=Math.PI/2;r.position.y=.9;f.add(r);
    const silo=new THREE.CylinderGeometry(.32,.32,1.8,16),sm=mat(0xc9ced3,.4,.5);for(let i=0;i<2;i++){const s=new THREE.Mesh(silo,sm);s.position.set(1.65,.9,-.45+i*.75);f.add(s)}
    const c=new THREE.Mesh(new THREE.CylinderGeometry(.11,.14,2.6,12),mat(0xd0d0d0));c.position.set(-1.05,1.3,-.5);f.add(c)};
  const tank=(g,x,z,r)=>{const t=new THREE.Group();t.position.set(x,0,z);t.rotation.y=r;g.add(t);const o=mat(0x5d6b3e),d=mat(0x2f3326);
    box(t,1.3,.32,.7,o,0,.12,0);box(t,1.4,.22,.18,d,0,0,.32);box(t,1.4,.22,.18,d,0,0,-.32);const tu=new THREE.Mesh(new THREE.CylinderGeometry(.26,.3,.22,12),o);tu.position.set(-.05,.55,0);t.add(tu);
    const br=new THREE.Mesh(new THREE.CylinderGeometry(.04,.05,.9,8),d);br.rotation.z=Math.PI/2;br.position.set(.48,.58,0);t.add(br)};
  const G=()=>new THREE.Group(),P=(name,g)=>{PROTO[name]=flat(g)};
  // towns by level (0 camp, 1 timber village, 2 stone houses and early industry, 3 modern); capitals add more buildings
  for(const cap of[0,1]){const k=cap?"cap":"city";let g;
    g=G();put("tent_detailedOpen",g,-.9,-.6,{s:2.2,r:.4});put("campfire_stones",g,.2,.6,{s:1.6});if(cap)put("tent_detailedOpen",g,1.3,-1.4,{s:1.8,r:-.6});P(k+0,g);
    g=G();house(g,-1.2,-1,"wallWood","wallWoodDoor","wallWoodWindowShutters",{s:1.3,r:.3});put("stall",g,-1.5,.8,{s:1.1,r:-.3});
      if(cap){house(g,1.2,-1.6,"wallWood","wallWoodDoor","wallWoodWindowShutters",{s:1.1,r:-.4});put("cart",g,.9,.6,{s:1.2,r:.8})}P(k+1,g);
    g=G();house(g,-1.5,-1.1,"wall","wallDoor","wallWindowGlass",{s:1.15,r:.2,floors:2,chimney:true});house(g,0,-2.1,"wall","wallDoor","wallWindowGlass",{s:1,r:-.1,floors:2});
      if(cap){factory3(g,1.4,-.4);put("windmill",g,2.8,-2.9,{s:.9,y:1.4,r:Math.PI/2})}P(k+2,g);
    g=G();apt(g,-1.6,-1.8,1.2,1.2,3.2,"#e9e1d2");box(g,1.2,.7,1,mat(0xf4f4f2),-2.6,0,.1);box(g,1.25,.06,1.05,mat(0x3a3f45),-2.6,.7,.1);
      if(cap){apt(g,-.2,-2.2,1,1,2.4,"#c9d3dc");factory4(g,1.6,-1.4);const rd=new THREE.Mesh(new THREE.PlaneGeometry(6.4,.8),mat(0x3b3f45));rd.rotation.x=-Math.PI/2;rd.position.set(0,.01,.9);g.add(rd);
        put("sedan",g,-.9,.95,{s:.45,r:Math.PI/2});put("suv",g,.6,.75,{s:.45,r:-Math.PI/2})}P(k+3,g)}
  // garrison weapons by level
  let g=G();P("arms0",g);g=G();put("weapon_catapult",g,-2.6,2.3,{s:2.4,r:.6});put("weapon_ballista",g,2.6,2.3,{s:2.2,r:-.5});P("arms1",g);
  g=G();put("cannonMobile",g,-2.4,2.3,{s:1.6,r:.8});put("weapon_cannon",g,2.6,2.3,{s:2,r:-.6});P("arms2",g);
  g=G();put("truck",g,-1.6,2.6,{s:.5,r:.4,tint:0x5d6b3e});tank(g,1.4,2.4,-.5);P("arms3",g);
  // plants and rocks, one model each, about a third of a cell high
  for(const[n,s]of[["tree_cone",1.6],["tree_default",1.5],["tree_detailed",1.4],["tree_fat",1.4],["tree_palmTall",1.2],["rock_largeA",1.6],["rock_tallB",1.2],["plant_bushLarge",1.4]]){g=G();put(n,g,0,0,{s});P(n,g)}
}

// ---------- people: skinned clones in a pool, accessories attached to bones ----------
let base,clipRun,clipIdle;
function person(kind,e){const c=SkeletonUtils.clone(base.scene),root=new THREE.Group();c.scale.multiplyScalar(.85);root.add(c);
  c.traverse(m=>{if(m.isMesh){m.material=new THREE.MeshStandardMaterial({map:SK[kind+(e+1)],roughness:.9});m.frustumCulled=false}});root.updateMatrixWorld(true);
  const cyl=(rt,rb,h,col,seg=10)=>new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),mat(col));
  const attach=(bn,obj,x=0,y=0,z=0)=>{let b;c.traverse(k=>{if(k.isBone&&k.name===bn)b=k});if(!b)return;
    const p=b.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(x*.85,y*.85,z*.85)),w=new THREE.Group();w.position.copy(b.worldToLocal(p));
    w.quaternion.copy(b.getWorldQuaternion(new THREE.Quaternion()).invert());w.scale.setScalar(1/b.getWorldScale(new THREE.Vector3()).x);w.add(obj);b.add(w)};
  if(kind==="f"){const h=new THREE.Mesh(new THREE.SphereGeometry(.1,10,8),mat([0x2a1a14,0x3a2418,0x22160f,0x5a3a22][e]));h.scale.set(1.05,1.25,.7);attach("Head",h,0,-.02,-.07);
    if(e<3)attach("Hips",cyl(.1,.17,.24,[0x86603c,0x96463c,0x3c506e][e],14),0,-.14,0)}
  if(kind==="s"){const wood=0x6b4a2b,arm=new THREE.Group();
    if(e===0){arm.add(cyl(.012,.012,.95,wood,6));const t=cyl(0,.028,.09,0x8a8f96,6);t.position.y=.5;arm.add(t);arm.position.y=.2}
    else if(e===1){const s=M.sword.scene.clone();s.scale.setScalar(.7);s.rotation.x=Math.PI;s.position.y=.1;arm.add(s)}
    else if(e===2){arm.add(new THREE.Mesh(new THREE.BoxGeometry(.03,.62,.04),mat(wood)));const b=cyl(.008,.008,.5,0x333333,6);b.position.set(0,.1,.02);arm.add(b);arm.position.y=.12}
    else{arm.add(new THREE.Mesh(new THREE.BoxGeometry(.035,.48,.05),mat(0x2b2b2b)));const m=new THREE.Mesh(new THREE.BoxGeometry(.03,.08,.07),mat(0x2b2b2b));m.position.set(0,-.05,.04);arm.add(m)}
    attach("RightHand",arm);if(e<2){const sh=cyl(.13,.13,.025,[0x7a4a2a,0xa0302a][e],16);sh.rotation.z=Math.PI/2;attach("LeftArm",sh,.06,-.05,.06)}
    const helm=col=>new THREE.Mesh(new THREE.SphereGeometry(.11,12,8,0,Math.PI*2,0,Math.PI/2),mat(col,.6,.3));
    if(e===1)attach("Head",helm(0x8a8f96),0,.05,0);if(e===2)attach("Head",cyl(.07,.1,.08,0x1a1a1a,10),0,.1,0);if(e===3)attach("Head",helm(0x55613a),0,.06,0)}
  const mx=new THREE.AnimationMixer(c),run=mx.clipAction(clipRun),idle=mx.clipAction(clipIdle);run.timeScale=.5;
  const tinted=[];root.traverse(m=>{if(m.isMesh)tinted.push(m.material)});root.visible=false;S.add(root);
  return{root,mx,run,idle,mats:tinted,walk:null,ph:Math.random()*6.3}}
function take(kind,e,used){const k=kind+e,list=POOL.get(k)||(POOL.set(k,[]),POOL.get(k)),n=used[k]=(used[k]||0)+1;if(list.length<n)list.push(person(kind,e));return list[n-1]}

// ---------- instanced parts ----------
function partsOf(name){return PROTO[name]||[]}
function fill(list){const need=new Map();for(const it of list)for(const p of partsOf(it.p))need.set(p.key,(need.get(p.key)||0)+1);
  for(const[k,im]of IM)if(!need.has(k))im.count=0;
  const at=new Map(),T=new THREE.Matrix4(),Q=new THREE.Quaternion(),V=new THREE.Vector3(),SC=new THREE.Vector3(),UP=new THREE.Vector3(0,1,0);
  for(const it of list){Q.setFromAxisAngle(UP,it.r||0);T.compose(V.set(it.x,0,it.z),Q,SC.setScalar(it.sc));const col=tintOf(it.tint,tmpC);
    for(const p of partsOf(it.p)){let im=IM.get(p.key);const n=need.get(p.key);
      if(!im||im.instanceMatrix.count<n){if(im){S.remove(im);im.dispose()}im=new THREE.InstancedMesh(p.g,p.m,Math.max(16,n*1.5|0));im.frustumCulled=false;im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);S.add(im);IM.set(p.key,im)}
      const j=at.get(p.key)||0;at.set(p.key,j+1);im.setMatrixAt(j,tmpM.multiplyMatrices(T,p.x));im.setColorAt(j,col)}}
  for(const[k,im]of IM){const n=at.get(k)||0;im.count=n;if(n){im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true}}}

// ---------- scene from the simulator: src.view() -> {w,h,key}; src.items() -> {towns,decor} in CSS pixels and px per cell ----------
let walkers=[],idlers=0;
function rebuild(v){const{towns,decor}=src.items(),list=[],used={};walkers=[];idlers=0;
  for(const P of POOL.values())for(const p of P)p.root.visible=false;
  const mapZ=y=>y/SN;
  for(const d of decor)list.push({p:d.p,x:d.x,z:mapZ(d.y),sc:v.s*.15*d.k,r:d.r,tint:d.tint});
  // a capital spans about two cells and a town about 1.3, like the town models of a strategy game map
  let np=0;for(const t of towns){const z=mapZ(t.y),lv=t.lv,Z=v.s*(t.cap?2:1.3)/ZONE;list.push({p:(t.cap?"cap":"city")+lv,x:t.x,z,sc:Z,r:t.r,tint:t.tint});
    if(t.cap)list.push({p:"arms"+lv,x:t.x,z,sc:Z,r:t.r,tint:t.tint});
    const crowd=t.cap?[["m",1],["f",1],["s",0],["s",0],["s",2]]:[["m",1],["f",1]];
    if(v.s>=PS)crowd.forEach(([kind,mode],k)=>{if(np>=MAXP)return;np++;const p=take(kind,lv,used);p.root.visible=true;p.root.scale.setScalar(Z);
      const col=tintOf(t.tint,tmpC);for(const m of p.mats)m.color.copy(col);
      if(mode===1){p.run.play();p.idle.stop();walkers.push({p,cx:t.x,cz:z,r:(1.9+.6*k)*Z,sp:(kind==="f"?-.3:.3)/(1.9+.6*k)})}
      else if(mode===2){p.run.play();p.idle.stop();walkers.push({p,cx:t.x,cz:z,r:3.2*Z,sp:.12})}
      else{idlers++;p.idle.play();p.run.stop();p.root.position.set(t.x+(k-3)*.55*Z,0,z+3.4*Z);p.root.rotation.y=0}})}
  fill(list)}

function tick(){if(!on)return;requestAnimationFrame(tick);const v=src.view(),dt=Math.min(.05,clock.getDelta()),now=performance.now();
  if(!v){cv.hidden=true;return}cv.hidden=false;
  if(R.domElement.width!==Math.round(v.w*R.getPixelRatio())||R.domElement.height!==Math.round(v.h*R.getPixelRatio())){R.setSize(v.w,v.h,false)}
  // orthographic camera tilted by TILT; ground point (x, 0, y/sin) lands on screen pixel (x, y)
  cam.left=0;cam.right=v.w;cam.top=0;cam.bottom=-v.h;cam.updateProjectionMatrix();
  let dirty=false;if(v.key!==lastKey||now-lastBuild>800){dirty=v.key!==lastKey||src.busy();lastKey=v.key;lastBuild=now;if(dirty)rebuild(v)}
  for(const P of POOL.values())for(const p of P)if(p.root.visible)p.mx.update(dt);
  for(const w of walkers){w.p.ph+=w.sp*dt;const s=Math.sign(w.sp),a=w.p.ph;w.p.root.position.set(w.cx+Math.cos(a)*w.r,0,w.cz+Math.sin(a)*w.r);w.p.root.rotation.y=Math.atan2(-Math.sin(a)*s,Math.cos(a)*s)}
  // a view change draws at once; frames that only move people are capped at 30 a second so the map keeps its frame rate
  if(dirty||(walkers.length||idlers)&&now-lastDraw>=32){lastDraw=now;R.render(S,cam)}}

async function load(){
  if(!window.MODELS)await new Promise((ok,no)=>{const s=document.createElement("script");s.src=here("models.js");s.onload=ok;s.onerror=no;document.head.appendChild(s)});
  const b64=t=>{const s=atob(t),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer},L=new GLTFLoader();
  await Promise.all(Object.keys(window.MODELS).map(n=>L.parseAsync(b64(window.MODELS[n]),"").then(g=>{M[n]=g})));
  const TX=new THREE.TextureLoader();await Promise.all(["m","f","s"].flatMap(k=>[1,2,3,4].map(e=>TX.loadAsync(here(`${k}${e}.png`)).then(t=>{t.colorSpace=THREE.SRGBColorSpace;SK[k+e]=t}))));
  base=M.citizen;clipRun=base.animations.find(a=>a.name==="run");clipIdle=base.animations.find(a=>a.name==="idle");buildProtos()}

// canvas: the overlay canvas above the map; source: {view(), items()} from the simulator
export async function start(canvas,source){src=source;
  if(!R){cv=canvas;R=new THREE.WebGLRenderer({canvas:cv,alpha:true,antialias:false,powerPreference:"high-performance"});R.setPixelRatio(Math.min(1.5,devicePixelRatio||1));R.outputColorSpace=THREE.SRGBColorSpace;R.setClearColor(0,0);
    S=new THREE.Scene();S.add(new THREE.HemisphereLight(0xf2f6ff,0x6a6a5a,1.7));const sun=new THREE.DirectionalLight(0xfff2dd,2);sun.position.set(-.4,1,.6);S.add(sun);
    cam=new THREE.OrthographicCamera(0,1,0,-1,1,40000);cam.rotation.x=-TILT;cam.position.set(0,0,0).addScaledVector(new THREE.Vector3(0,-SN,-Math.cos(TILT)),-15000);cam.updateMatrixWorld(true)}
  loaded??=load().catch(e=>{loaded=null;throw e});await loaded;if(!on){on=true;lastKey="";clock.getDelta();tick()}}
export function stop(){on=false;if(cv)cv.hidden=true}
export const refresh=()=>{lastKey=""};
