/* THE BIG CON: BATTLE ROYALE — FPS engine
 * Pointer-lock controls, hitscan combat with board-game weapon flavor,
 * exhibit seizure channel, Qantas drop & redeploy, spectator mode.
 * Local prediction for the local player; host validates intents.
 */
import * as THREE from 'three';
import { NODES, NMAP, WMAP, CHARS, CMAP } from './data';
import {
  FxEvent, Snapshot, PlayerPub, MAP_R, PCOLORS,
} from './types';
import { buildWorld, makeAvatar, makeNameTag, makePickupMesh, applyMood, updateExhibits, WorldRefs } from './world';
import { FxRenderer } from './fx';
import { Sfx } from './audio';

export interface SeizeHudState {
  nodeId: string;
  name: string;
  type: string;
  cost: number;
  hostile: boolean;
  ownerName: string;
  progress: number;   // 0..1
  error: string;
}

export interface HudState {
  hp: number; money: number; intel: number; cor: number;
  weapon: string; mag: number; ammo: number; reloading: boolean;
  dead: boolean; kills: number;
  phase: string; altitude: number;
  spread: number; ads: boolean;
  zoneDist: number; inZone: boolean; zonePhase: number; zoneNext: number;
  compass: number; zoneBearing: number;
  nodesHeld: number; sprinting: boolean;
  hurtAt: number; oil: number;
  nodeTypesHeld: Record<string, boolean>;
  bugCount: number;
  locked: boolean;
}

export interface EngineCallbacks {
  onToast: (msg: string, kind?: 'info' | 'bad' | 'good') => void;
  onSeize: (s: SeizeHudState | null) => void;
  onPointerLock: (locked: boolean) => void;
}

export interface EngineNetOut {
  sendPose: (x: number, y: number, z: number, ry: number, p: number, mv: number) => void;
  sendShot: (wpn: string, hit: number | null, dmg: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) => void;
  sendSeize: (nodeId: string) => void;
  sendOil: (x: number, z: number) => void;
  sendAbility: (kind: string) => void;
  sendWeapon: (slot: number) => void;
  sendReload: () => void;
  sendPickup: (id: number) => void;
}

const WEAPON_ORDER = ['ppk', 'auditor', 'bondmageddon', 'tweet', 'boulder', 'dossier'];
const EYE = 1.7;
const GRAV = -24;
const WALK = 6.4;
const SPRINT = 9.6;
const JUMP = 8.4;

interface RemoteAvatar {
  group: THREE.Group;
  body: THREE.Mesh;
  nameTag: THREE.Sprite;
  ring: THREE.Mesh;
  idx: number;
  buffer: { t: number; x: number; y: number; z: number; ry: number }[];
  marked: THREE.Mesh | null;
}

export class Engine {
  private renderer!: THREE.WebGLRenderer;
  private camera!: THREE.PerspectiveCamera;
  private scene!: THREE.Scene;
  private world!: WorldRefs;
  private fx!: FxRenderer;
  private container: HTMLElement;
  private cbs: EngineCallbacks;
  private net: EngineNetOut;

  myIdx = 0;
  running = false;
  locked = false;
  dead = false;
  phase: string = 'drop';

  hud: HudState = {
    hp: 100, money: 15, intel: 2, cor: 0, weapon: 'ppk', mag: 12, ammo: 96, reloading: false,
    dead: false, kills: 0, phase: 'drop', altitude: 0, spread: 0, ads: false,
    zoneDist: 0, inZone: true, zonePhase: 0, zoneNext: 0, compass: 0, zoneBearing: 0,
    nodesHeld: 0, sprinting: false, hurtAt: -9, oil: 1, nodeTypesHeld: {}, bugCount: 0,
    locked: false,
  };

  private keys = new Set<string>();
  private mouseDown = false;
  private rightDown = false;
  private pos = new THREE.Vector3(0, 260, 0);
  private vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private grounded = true;
  private clock = new THREE.Clock();
  private raf = 0;
  private lastPoseSent = 0;
  private lastShotAt = -9;
  private reloadUntil = -9;
  private mag: Record<string, number> = { ppk: 12, auditor: 0, bondmageddon: 0, tweet: 0, boulder: 0, dossier: 0 };
  private ammo: Record<string, number> = { ppk: 96, auditor: 0, bondmageddon: 0, tweet: 0, boulder: 0, dossier: 0 };
  private weapon = 'ppk';
  private recoil = 0;
  private recoilYaw = 0;
  private seizeNode: string | null = null;
  private seizeStart = 0;
  private lastSeizeErr = '';
  private lastSeizeErrAt = -9;
  private remotes = new Map<number, RemoteAvatar>();
  private snap: Snapshot | null = null;
  private pickupViews = new Map<number, THREE.Object3D>();
  private oilBall: { mesh: THREE.Mesh; vel: THREE.Vector3 } | null = null;
  private viewmodel!: THREE.Group;
  private muzzle!: THREE.Mesh;
  private muzzleLight!: THREE.PointLight;
  private muzzleUntil = -9;
  private jet: THREE.Group | null = null;
  private markedBeams = new Map<number, THREE.Mesh>();
  private raycaster = new THREE.Raycaster();
  private hurtAt = -9;
  private oilCount = 1;
  private sprintBoost = false;
  private uid = Math.random();

  constructor(container: HTMLElement, cbs: EngineCallbacks, net: EngineNetOut) {
    this.container = container;
    this.cbs = cbs;
    this.net = net;
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(75, this.container.clientWidth / this.container.clientHeight, 0.1, 1600);
    this.scene = new THREE.Scene();
    this.world = buildWorld(this.scene);
    this.fx = new FxRenderer(this.scene, this.world.tracers);

    /* viewmodel: stylized pistol-ish slate with teal edges */
    this.viewmodel = new THREE.Group();
    const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.62), new THREE.MeshLambertMaterial({ color: '#141817' }));
    gunBody.position.set(0.26, -0.22, -0.55);
    const gunEdge = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.04, 0.64), new THREE.MeshBasicMaterial({ color: '#168388' }));
    gunEdge.position.set(0.26, -0.13, -0.55);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.14), new THREE.MeshLambertMaterial({ color: '#0c0f0e' }));
    grip.position.set(0.26, -0.34, -0.32);
    this.viewmodel.add(gunBody, gunEdge, grip);
    this.camera.add(this.viewmodel);
    this.scene.add(this.camera);
    this.muzzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#7ff6fb', transparent: true, opacity: 0 })
    );
    this.muzzle.position.set(0.26, -0.16, -0.92);
    this.viewmodel.add(this.muzzle);
    this.muzzleLight = new THREE.PointLight('#7ff6fb', 0, 14);
    this.muzzleLight.position.copy(this.muzzle.position);
    this.viewmodel.add(this.muzzleLight);

    /* the Qantas jet — flies the sky at drop */
    this.jet = this.makeJet();
    this.scene.add(this.jet);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('contextmenu', this.onCtx);
    document.addEventListener('pointerlockchange', this.onPL);
    document.addEventListener('wheel', this.onWheel, { passive: true });
  }

  makeJet(): THREE.Group {
    const g = new THREE.Group();
    const fus = new THREE.Mesh(new THREE.CapsuleGeometry(2.2, 26, 6, 10), new THREE.MeshLambertMaterial({ color: '#e8ecec' }));
    fus.rotation.z = Math.PI / 2;
    g.add(fus);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 7, 5), new THREE.MeshLambertMaterial({ color: '#168388' }));
    tail.position.set(-15, 4, 0);
    g.add(tail);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(6, 0.7, 26), new THREE.MeshLambertMaterial({ color: '#d0d8d8' }));
    g.add(wing);
    for (const s of [-1, 1]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4, 8), new THREE.MeshLambertMaterial({ color: '#9ad' }));
      eng.rotation.z = Math.PI / 2;
      eng.position.set(1, -0.6, s * 8);
      g.add(eng);
    }
    g.position.set(-600, 300, -400);
    g.rotation.y = Math.PI / 4;
    return g;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('contextmenu', this.onCtx);
    document.removeEventListener('pointerlockchange', this.onPL);
    document.removeEventListener('wheel', this.onWheel);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) this.container.removeChild(this.renderer.domElement);
  }

  requestLock() { this.renderer.domElement.requestPointerLock(); }
  isLocked() { return this.locked; }

  /* ============ host data in ============ */

  setMyIdx(i: number) {
    this.myIdx = i;
    const me = this.snap?.players[i];
    if (me) this.applyLocalFromPub(me);
  }

  setSpawn(x: number, y: number, z: number) {
    /* high spawn = skydrop; low spawn = resume in place */
    this.pos.set(x, y > 100 ? Math.max(y, 240) : Math.max(y, EYE), z);
    this.vel.set(0, y > 100 ? -2 : 0, 0);
    this.spawned = true;
  }

  private spawned = false;

  /* testing hook */
  debugTeleport(x: number, z: number, y?: number) {
    this.pos.set(x, y ?? EYE, z);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.spawned = true;
  }

  debugAim(yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  applySnapshot(s: Snapshot) {
    this.snap = s;
    this.phase = s.phase;
    this.dead = !!s.players[this.myIdx]?.dead;
    this.hud.phase = s.phase;
    /* avatars */
    s.players.forEach((p, i) => {
      if (i === this.myIdx) { this.applyLocalFromPub(p); return; }
      this.ensureAvatar(i, p);
    });
    for (const key of [...this.remotes.keys()]) {
      if (key >= s.players.length) {
        const av = this.remotes.get(key)!;
        this.scene.remove(av.group);
        this.remotes.delete(key);
      }
    }
    updateExhibits(this.world, s.nodes, s.players.map(p => p.color), s.players.map(p => p.name));
    applyMood(this.world, s.mood);
    /* zone */
    this.world.zoneWall.position.set(s.zone.cx, 120, s.zone.cz);
    const sc = Math.max(0.02, s.zone.r / 400);
    this.world.zoneWall.scale.set(sc, 1, sc);
    /* pickups */
    this.syncPickups(s.pickups || []);
    /* marked beacons */
    s.players.forEach((p, i) => {
      const marked = p.markedUntil > s.t;
      const av = this.remotes.get(i);
      if (av && marked && !av.marked) {
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.9, 90, 10, 1, true),
          new THREE.MeshBasicMaterial({ color: '#ff6b5e', transparent: true, opacity: 0.42, depthWrite: false })
        );
        beam.position.y = 45;
        av.group.add(beam);
        av.marked = beam;
      } else if (av && !marked && av.marked) {
        av.group.remove(av.marked);
        av.marked = null;
      }
    });
    /* HUD values */
    const me = s.players[this.myIdx];
    if (me) {
      this.hud.hp = me.hp; this.hud.money = me.money; this.hud.intel = me.intel;
      this.hud.cor = me.cor; this.hud.dead = me.dead; this.hud.kills = me.kills;
      this.hud.nodesHeld = me.nodes.length;
      this.hud.bugCount = me.bugCount;
      const held: Record<string, boolean> = {};
      me.nodes.forEach(nid => { held[NMAP[nid]?.type] = true; });
      this.hud.nodeTypesHeld = held;
      this.sprintBoost = me.nodes.includes('train');
      if (me.hp < this.lastHpKnown - 0.5) this.hurtAt = performance.now() / 1000;
      this.lastHpKnown = me.hp;
      if (me.dead && !this.dead) this.onLocalDeath();
    }
    this.hud.zonePhase = s.zone.phase;
    this.hud.zoneNext = s.zone.nextAt;
    this.hud.hurtAt = this.hurtAt;
  }

  private lastHpKnown = 100;

  private applyLocalFromPub(p: PlayerPub) {
    this.hud.weapon = p.weapon;
  }

  private onLocalDeath() {
    this.dead = true;
    this.cbs.onToast('💀 LIQUIDATED — spectating the table. The con goes on without you.', 'bad');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private ensureAvatar(i: number, p: PlayerPub) {
    let av = this.remotes.get(i);
    if (av && (av.group.userData as { char?: string }).char === p.char) return;
    if (av) { this.scene.remove(av.group); this.remotes.delete(i); }
    const char = CMAP[p.char] || CHARS[0];
    const a = makeAvatar(p.color, char.img);
    const tag = makeNameTag(p.name, p.color);
    a.group.add(tag);
    a.group.userData = { char: p.char };
    this.scene.add(a.group);
    this.remotes.set(i, { group: a.group, body: a.body, nameTag: tag, ring: a.ring, idx: i, buffer: [], marked: null });
  }

  applyPoses(arr: number[]) {
    const now = performance.now() / 1000;
    for (let k = 0; k + 6 <= arr.length; k += 7) {
      const idx = arr[k] | 0;
      if (idx === this.myIdx) continue;
      const av = this.remotes.get(idx);
      if (!av) continue;
      av.buffer.push({ t: now, x: arr[k + 1], y: arr[k + 2] - EYE, z: arr[k + 3], ry: arr[k + 4] });
      if (av.buffer.length > 30) av.buffer.shift();
    }
  }

  applyFxHost(list: FxEvent[]) {
    /* remote shots → tracer from attacker aim; local pickups → apply client-side */
    for (const f of list) {
      if (f.k === 'shot' && f.a !== undefined && f.a !== this.myIdx) {
        const av = this.remotes.get(f.a);
        const w = WMAP[f.n || 'ppk'];
        if (av && w) {
          const from = new THREE.Vector3(f.x || 0, f.y || 0, f.z || 0);
          const yaw = av.group.rotation.y;
          const dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
          const to = from.clone().add(dir.multiplyScalar(Math.min(w.range, 160)));
          this.fx.addTracerShotSound(f.n || 'ppk');
          this.fx.addTracer(from, to);
        }
      }
      if (f.k === 'pickup' && f.a === this.myIdx) {
        Sfx.pickup();
        const n = f.n || '';
        if (n.startsWith('w:')) {
          this.giveWeapon(n.slice(2));
          /* optimistic: clear the local mesh */
          if (f.x !== undefined && f.z !== undefined) this.removePickupAt(f.x, f.z);
        } else if (n === 'ammo') {
          const w = WMAP[this.weapon];
          this.ammo[this.weapon] = Math.min(w.reserveMax, this.ammo[this.weapon] + Math.ceil(w.reserveMax * 0.4));
          this.addOil(1);
          this.removePickupAt(f.x || 0, f.z || 0);
        } else if (n === 'oil') {
          this.addOil(1);
          this.removePickupAt(f.x || 0, f.z || 0);
        } else {
          this.removePickupAt(f.x || 0, f.z || 0);
        }
      }
    }
    this.fx.handle(list);
  }

  private removePickupAt(x: number, z: number) {
    for (const [id, m] of [...this.pickupViews]) {
      if (Math.hypot(m.position.x - x, m.position.z - z) < 0.6) {
        this.scene.remove(m);
        this.pickupViews.delete(id);
        return;
      }
    }
  }

  /* ============ input ============ */

  private onResize = () => {
    if (!this.renderer) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private onPL = () => {
    this.locked = document.pointerLockElement === this.renderer.domElement;
    this.cbs.onPointerLock(this.locked);
  };

  private onCtx = (e: Event) => { e.preventDefault(); };

  private typingGuard(): boolean {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.running || this.typingGuard()) return;
    if (e.code === 'KeyE') e.preventDefault();
    if (this.keys.has(e.code)) return;
    this.keys.add(e.code);
    const wpnIdx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
    if (wpnIdx >= 0 && WEAPON_ORDER[wpnIdx] && this.ammo[WEAPON_ORDER[wpnIdx]] + this.mag[WEAPON_ORDER[wpnIdx]] > 0) {
      this.switchWeapon(WEAPON_ORDER[wpnIdx]);
    }
    switch (e.code) {
      case 'KeyR': this.tryReload(); break;
      case 'KeyF': this.net.sendAbility('favor'); break;
      case 'KeyC': this.net.sendAbility('spy'); break;
      case 'KeyV': this.net.sendAbility('leak'); break;
      case 'KeyB': this.net.sendAbility('bug'); break;
      case 'KeyK': this.net.sendAbility('redeploy'); break;
      case 'KeyJ': this.net.sendAbility('jtdeny'); break;
      case 'KeyG': this.throwOil(); break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.typingGuard()) return;
    this.keys.delete(e.code);
    if (e.code === 'KeyE' && this.seizeNode) {
      this.seizeNode = null;
      this.cbs.onSeize(null);
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.typingGuard()) return;
    if (this.locked || (this.mouseDown && !this.rightDown)) {
      /* pointer-locked look, or drag-look fallback when lock unavailable */
      const sens = 0.0022 * (this.rightDown ? 0.55 : 1);
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    if (!this.running || this.typingGuard()) return;
    if (e.target !== this.renderer.domElement && !this.locked) return; /* HUD clicks are not game input */
    if (e.button === 0) {
      this.mouseDown = true;
      if (!this.locked) this.renderer.domElement.requestPointerLock();
      const w = WMAP[this.weapon];
      if (w && w.rof >= 0.3) this.fire(); /* semi-autos fire on click */
    }
    if (e.button === 2) this.rightDown = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2) this.rightDown = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.locked) return;
    const owned = WEAPON_ORDER.filter(w => this.ammo[w] + this.mag[w] > 0);
    if (owned.length < 2) return;
    const cur = owned.indexOf(this.weapon);
    const next = owned[(cur + (e.deltaY > 0 ? 1 : owned.length - 1)) % owned.length];
    this.switchWeapon(next);
  };

  private switchWeapon(w: string) {
    if (w === this.weapon) return;
    this.weapon = w;
    this.reloadUntil = -9;
    this.net.sendWeapon(WEAPON_ORDER.indexOf(w));
    this.updateViewModel();
    Sfx.reload();
  }

  private updateViewModel() {
    const w = WMAP[this.weapon];
    if (!this.viewmodel) return;
    const len = 0.45 + (w?.dmg || 20) / 95 * 0.55;
    this.viewmodel.children[0].scale.z = len;
    this.viewmodel.children[0].position.z = -0.35 - len / 2;
    this.viewmodel.children[1].scale.z = len + 0.02;
    this.viewmodel.children[1].position.z = -0.35 - len / 2;
    this.muzzle.position.z = -0.35 - len - 0.1;
    (this.viewmodel.children[1] as THREE.Mesh).material = new THREE.MeshBasicMaterial({
      color: this.weapon === 'dossier' ? '#e19bff' : this.weapon === 'bondmageddon' ? '#ff6b5e' : '#168388',
    });
  }

  private tryReload() {
    const w = WMAP[this.weapon];
    if (!w) return;
    if (this.mag[this.weapon] >= w.mag || this.ammo[this.weapon] <= 0) return;
    if (performance.now() / 1000 < this.reloadUntil) return;
    this.reloadUntil = performance.now() / 1000 + w.reload;
    this.net.sendReload();
    Sfx.reload();
    setTimeout(() => {
      const need = w.mag - this.mag[this.weapon];
      const take = Math.min(need, this.ammo[this.weapon]);
      this.mag[this.weapon] += take;
      this.ammo[this.weapon] -= take;
    }, w.reload * 1000);
  }

  /* ============ combat ============ */

  private fire() {
    const w = WMAP[this.weapon];
    if (!w || this.dead) return;
    const now = performance.now() / 1000;
    if (now < this.reloadUntil || now - this.lastShotAt < w.rof) return;
    if (this.mag[this.weapon] <= 0) { Sfx.empty(); this.tryReload(); return; }
    this.lastShotAt = now;
    this.mag[this.weapon]--;

    /* muzzle fx */
    this.muzzleUntil = now + 0.05;
    this.recoil += w.recoil * 0.012;
    this.recoilYaw += (Math.random() - 0.5) * w.recoil * 0.006;

    /* hitscan: ray from camera with spread */
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const spread = (this.rightDown ? w.spread * 0.35 : w.spread) * (this.hud.sprinting ? 2.2 : 1);
    const pellets = w.pellets;
    let bestHit: number | null = null;
    let bestDmg = 0;
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const targets: THREE.Object3D[] = [];
    this.remotes.forEach((av, idx) => {
      if (!this.snap?.players[idx]?.dead) { av.body.userData.idx = idx; targets.push(av.body); }
    });
    for (let p = 0; p < pellets; p++) {
      const d = dir.clone();
      if (spread > 0) {
        d.x += (Math.random() - 0.5) * spread * 2;
        d.y += (Math.random() - 0.5) * spread * 2;
        d.z += (Math.random() - 0.5) * spread * 2;
        d.normalize();
      }
      this.raycaster.set(camPos, d);
      this.raycaster.far = w.range * 1.3;
      const hits = this.raycaster.intersectObjects(targets, false);
      if (hits.length) {
        const idx = hits[0].object.userData.idx as number;
        const dist = hits[0].distance;
        const falloff = Math.max(0.45, 1 - (dist / w.range) * 0.55);
        bestHit = idx;
        bestDmg += Math.round(w.dmg * falloff);
        /* tracer to hit point */
        this.fx.addTracer(camPos.clone().add(d.clone().multiplyScalar(1.2)), hits[0].point);
      } else {
        const end = camPos.clone().add(d.multiplyScalar(Math.min(w.range, 200)));
        this.fx.addTracer(camPos.clone().add(dir.clone().multiplyScalar(1.2)), end);
      }
    }
    this.fx.addTracerShotSound(this.weapon);
    if (bestHit !== null && bestDmg > 0) Sfx.hitmarker();
    this.net.sendShot(this.weapon, bestHit, bestDmg, camPos.x, camPos.y, camPos.z, dir.x, dir.y, dir.z);
    if (this.mag[this.weapon] === 0) this.tryReload();
  }

  private throwOil() {
    if (this.oilCount <= 0 || this.dead || this.phase === 'drop') return;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshLambertMaterial({ color: '#1a2a3a' }));
    mesh.position.copy(this.camera.getWorldPosition(new THREE.Vector3())).add(dir.clone().multiplyScalar(1.5));
    this.scene.add(mesh);
    this.oilBall = { mesh, vel: dir.multiplyScalar(26).add(new THREE.Vector3(0, 6, 0)) };
    this.oilCount--;
    this.hud.oil = this.oilCount;
  }

  /* ============ pickups ============ */

  private syncPickups(list: readonly (readonly [number, string, number, number, number, string])[]) {
    const seen = new Set<number>();
    for (const [id, kind, x, z, v, w] of list) {
      seen.add(id);
      if (this.pickupViews.has(id)) continue;
      const m = makePickupMesh(kind, v, w);
      m.position.set(x, 0, z);
      m.userData.pid = id;
      m.userData.kind = kind;
      this.scene.add(m);
      this.pickupViews.set(id, m);
    }
    for (const [id, m] of [...this.pickupViews]) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.pickupViews.delete(id);
      }
    }
  }

  private checkPickups() {
    if (this.dead) return;
    for (const [id, m] of this.pickupViews) {
      const d = Math.hypot(m.position.x - this.pos.x, m.position.z - this.pos.z);
      if (d < 3.0 && Math.abs(0 - (this.pos.y - EYE)) < 6) {
        this.net.sendPickup(id);
      }
    }
  }

  /* ============ seizing ============ */

  private checkSeize(dt: number) {
    if (this.dead || this.phase !== 'live') { if (this.seizeNode) { this.seizeNode = null; this.cbs.onSeize(null); } return; }
    const holdingE = this.keys.has('KeyE');
    let near: (typeof NODES)[number] | null = null;
    let nd = 12;
    for (const n of NODES) {
      const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
      if (d < nd) { nd = d; near = n; }
    }
    const snap = this.snap;
    if (!near || nd > 8.5) {
      if (this.seizeNode) { this.seizeNode = null; this.cbs.onSeize(null); }
      return;
    }
    const pub = snap?.nodes.find(nn => nn.id === near.id);
    const owner = pub?.owner ?? null;
    if (owner === this.myIdx) {
      if (this.seizeNode) { this.seizeNode = null; this.cbs.onSeize(null); }
      return;
    }
    const hostile = owner !== null;
    if (!this.seizeNode || this.seizeNode !== near.id) {
      this.seizeNode = near.id;
      this.seizeStart = performance.now() / 1000;
      if (holdingE) Sfx.seizeStart();
    }
    const dur = hostile ? 5 : 3;
    let cost = near.cost;
    if (snap?.players[this.myIdx]?.nodes.includes('golf')) cost = Math.max(1, cost - 1);
    if (hostile) {
      const inflate = near.neverInflates ? 1 : Math.pow(2, Math.max(1, pub?.takeovers || 0));
      cost = cost * inflate;
    }
    const ownerName = owner !== null ? snap?.players[owner]?.name || 'rival' : '';
    if (!holdingE) {
      this.seizeStart = performance.now() / 1000;
      this.cbs.onSeize({
        nodeId: near.id, name: near.name, type: near.type, cost: Math.floor(cost),
        hostile, ownerName, progress: 0, error: '',
      });
      return;
    }
    const progress = Math.min(1, (performance.now() / 1000 - this.seizeStart) / dur);
    this.cbs.onSeize({
      nodeId: near.id, name: near.name, type: near.type, cost: Math.floor(cost),
      hostile, ownerName, progress, error: (performance.now() / 1000 - this.lastSeizeErrAt < 2.4) ? this.lastSeizeErr : '',
    });
    if (progress >= 1) {
      this.net.sendSeize(near.id);
      this.seizeNode = null;
      this.cbs.onSeize(null);
      /* host will confirm via fx/sys */
      this.seizeStart = performance.now() / 1000 + 0.8; /* brief lockout */
    }
  }

  setSeizeError(err: string) {
    this.lastSeizeErr = err;
    this.lastSeizeErrAt = performance.now() / 1000;
  }

  /* ============ movement & loop ============ */

  private loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number) {
    const now = performance.now() / 1000;

    /* drop phase / parachute */
    if (this.pos.y > EYE + 0.5) {
      const falling = this.phase === 'drop' || this.pos.y > 40;
      const chute = this.pos.y < 120;
      const g = chute ? GRAV * 0.14 : GRAV * 0.55;
      this.vel.y = Math.max(chute ? -8.5 : -38, this.vel.y + g * dt);
      /* steer */
      const sp = chute ? 15 : 8;
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const move = new THREE.Vector3();
      if (this.keys.has('KeyW')) move.add(f);
      if (this.keys.has('KeyS')) move.sub(f);
      if (this.keys.has('KeyD')) move.add(r);
      if (this.keys.has('KeyA')) move.sub(r);
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(sp);
      this.vel.x = move.x; this.vel.z = move.z;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y <= EYE) {
        this.pos.y = EYE;
        this.vel.set(0, 0, 0);
        this.grounded = true;
        Sfx.drop();
        this.cbs.onToast('🪂 Down safe. Talk your book.', 'good');
      }
    } else if (!this.dead) {
      /* ground movement */
      this.grounded = this.pos.y <= EYE + 0.02;
      const sprinting = this.keys.has('ShiftLeft') && this.keys.has('KeyW');
      const boost = this.sprintBoost ? 1.15 : 1;
      const speed = (sprinting ? SPRINT : WALK) * boost * (this.rightDown ? 0.55 : 1);
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const move = new THREE.Vector3();
      if (this.keys.has('KeyW')) move.add(f);
      if (this.keys.has('KeyS')) move.sub(f);
      if (this.keys.has('KeyD')) move.add(r);
      if (this.keys.has('KeyA')) move.sub(r);
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
      const accel = this.grounded ? 14 : 3;
      this.vel.x += (move.x - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (move.z - this.vel.z) * Math.min(1, accel * dt);
      if (this.grounded) this.vel.y = 0;
      if (this.grounded && this.keys.has('Space')) {
        this.vel.y = JUMP;
        this.grounded = false;
      }
      if (!this.grounded) this.vel.y += GRAV * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y < EYE) { this.pos.y = EYE; this.vel.y = 0; this.grounded = true; }
      /* collisions */
      this.collide();
      this.hud.sprinting = sprinting;
    } else {
      /* spectator free-fly */
      const sp = this.keys.has('ShiftLeft') ? 60 : 26;
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const move = new THREE.Vector3();
      if (this.keys.has('KeyW')) move.add(f);
      if (this.keys.has('KeyS')) move.sub(f);
      if (this.keys.has('KeyD')) move.add(r);
      if (this.keys.has('KeyA')) move.sub(r);
      if (this.keys.has('Space')) move.y += 1;
      if (this.keys.has('ShiftLeft')) move.y += 0; /* shift = fast */
      if (this.keys.has('ControlLeft')) move.y -= 1;
      if (move.lengthSq() > 0) move.normalize().multiplyScalar(sp * dt);
      this.pos.add(move);
      this.pos.y = Math.max(1, Math.min(300, this.pos.y));
    }

    /* map bounds */
    this.pos.x = Math.max(-MAP_R - 10, Math.min(MAP_R + 10, this.pos.x));
    this.pos.z = Math.max(-MAP_R - 10, Math.min(MAP_R + 10, this.pos.z));

    /* oil ball */
    if (this.oilBall) {
      this.oilBall.vel.y += GRAV * dt;
      this.oilBall.mesh.position.addScaledVector(this.oilBall.vel, dt);
      if (this.oilBall.mesh.position.y <= 0.4) {
        this.net.sendOil(this.oilBall.mesh.position.x, this.oilBall.mesh.position.z);
        this.scene.remove(this.oilBall.mesh);
        this.oilBall = null;
      }
    }

    /* firing (auto) — drag-look fallback allows firing while unlocked */
    if (this.mouseDown && !this.dead && this.phase === 'live' && (this.locked || this.mouseDown)) {
      const w = WMAP[this.weapon];
      if (w && w.rof < 0.3) this.fire();
    }

    /* camera */
    this.recoil = Math.max(0, this.recoil - dt * 0.35);
    this.recoilYaw *= 1 - Math.min(1, dt * 6);
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw + this.recoilYaw);
    this.camera.rotateX(this.pitch + this.recoil);
    /* ADS fov */
    const w = WMAP[this.weapon];
    const targetFov = this.rightDown && w ? 75 / w.zoom : 75;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();
    /* viewmodel sway + ads position */
    const vmTarget = this.rightDown ? { x: 0.001, y: -0.16, z: -0.42 } : { x: 0.26, y: -0.22, z: -0.55 };
    const vm = this.viewmodel;
    vm.position.x += (vmTarget.x - vm.position.x) * Math.min(1, dt * 14);
    vm.position.y += ((vmTarget.y + Math.sin(now * 8) * 0.004 * (this.hud.sprinting ? 3 : 1)) - vm.position.y) * Math.min(1, dt * 14);
    vm.position.z += (vmTarget.z - vm.position.z) * Math.min(1, dt * 14);
    vm.rotation.z = this.hud.sprinting ? 0.35 : 0;
    /* muzzle flash */
    const mo = now < this.muzzleUntil ? 0.95 : 0;
    (this.muzzle.material as THREE.MeshBasicMaterial).opacity = mo;
    this.muzzleLight.intensity = mo * 2.2;

    /* jet flight */
    if (this.jet) {
      const jt = (now % 40) / 40;
      this.jet.position.set(-600 + jt * 1200, 300, -400 + jt * 800);
      if (this.phase !== 'drop' && jt > 0.55) this.jet.visible = false;
      else this.jet.visible = true;
    }

    /* remote avatars interpolation */
    const renderT = now - 0.12;
    this.remotes.forEach(av => {
      const buf = av.buffer;
      if (!buf.length) return;
      let a = buf[0], b = buf[buf.length - 1];
      for (let i = buf.length - 1; i >= 0; i--) { if (buf[i].t <= renderT) { a = buf[i]; b = buf[Math.min(i + 1, buf.length - 1)]; break; } }
      const span = Math.max(0.001, b.t - a.t);
      const k = Math.max(0, Math.min(1, (renderT - a.t) / span));
      av.group.position.set(
        a.x + (b.x - a.x) * k,
        Math.max(0, a.y + (b.y - a.y) * k),
        a.z + (b.z - a.z) * k
      );
      let dy = b.ry - a.ry;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      av.group.rotation.y = a.ry + dy * k;
    });

    /* pickups: spin + proximity */
    let t2 = now;
    this.pickupViews.forEach(m => { m.rotation.y = t2 * 1.4; });
    this.checkPickups();
    this.checkSeize(dt);

    /* zone pulse + HUD zone info */
    const s = this.snap;
    if (s) {
      const zd = Math.hypot(this.pos.x - s.zone.cx, this.pos.z - s.zone.cz);
      this.hud.zoneDist = Math.round(zd - s.zone.r);
      this.hud.inZone = zd <= s.zone.r;
      const bearing = Math.atan2(s.zone.cx - this.pos.x, -(s.zone.cz - this.pos.z));
      this.hud.zoneBearing = bearing;
    }
    this.hud.compass = this.yaw;
    this.hud.altitude = Math.round(this.pos.y);
    this.hud.mag = this.mag[this.weapon];
    this.hud.ammo = this.ammo[this.weapon];
    this.hud.reloading = now < this.reloadUntil;
    this.hud.ads = this.rightDown;
    this.hud.oil = this.oilCount;
    this.hud.spread = (WMAP[this.weapon]?.spread || 0.01) * (this.rightDown ? 0.4 : 1) * (this.hud.sprinting ? 2.5 : 1);
    this.hud.weapon = this.weapon;
    this.hud.locked = this.locked;

    /* pose to host 20Hz — only after a real spawn, so the default
     * (0,260,0) stand-in never contaminates the authoritative sim */
    if (this.spawned && now - this.lastPoseSent > 0.05 && this.phase !== 'lobby') {
      this.lastPoseSent = now;
      const moving = this.keys.has('KeyW') || this.keys.has('KeyA') || this.keys.has('KeyS') || this.keys.has('KeyD') ? 1 : 0;
      this.net.sendPose(
        Math.round(this.pos.x * 100) / 100, Math.round(this.pos.y * 100) / 100, Math.round(this.pos.z * 100) / 100,
        Math.round(this.yaw * 100) / 100, Math.round(this.pitch * 100) / 100, moving
      );
    }

    this.fx.update(dt);
  }

  private collide() {
    const feet = this.pos.y - EYE;
    for (const c of this.world.colliders) {
      if (feet > c.h - 0.5) continue;
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.7;
      if (d < min && d > 0.001) {
        const push = (min - d) / d;
        this.pos.x += dx * push;
        this.pos.z += dz * push;
      }
    }
  }

  /* for HUD minimap */
  minimapData() {
    const s = this.snap;
    return {
      me: { x: this.pos.x, z: this.pos.z, yaw: this.yaw },
      zone: s ? { cx: s.zone.cx, cz: s.zone.cz, r: s.zone.r } : null,
      nodes: NODES.map(n => {
        const pub = s?.nodes.find(nn => nn.id === n.id);
        return { x: n.x, z: n.z, type: n.type, owner: pub?.owner ?? null, name: n.name };
      }),
      players: s ? s.players.map((p, i) => ({
        dead: p.dead, color: p.color, marked: p.markedUntil > s.t,
        x: i === this.myIdx ? this.pos.x : (this.remotes.get(i)?.group.position.x ?? null),
        z: i === this.myIdx ? this.pos.z : (this.remotes.get(i)?.group.position.z ?? null),
      })) : [],
      pickups: [...this.pickupViews.values()].map(m => ({ x: m.position.x, z: m.position.z, kind: m.userData.kind || 'money' })),
    };
  }

  giveWeapon(w: string) {
    if (this.ammo[w] === undefined) return;
    this.ammo[w] = Math.max(this.ammo[w], Math.floor(WMAP[w].mag * 2.5));
    this.mag[w] = WMAP[w].mag;
    this.cbs.onToast(`📦 Acquired ${WMAP[w].name} — ${WMAP[w].sub}`, 'good');
    this.switchWeapon(w);
  }

  addOil(n: number) { this.oilCount = Math.min(2, this.oilCount + n); this.hud.oil = this.oilCount; }

  getPos() { return this.pos; }
  getWeapon() { return this.weapon; }
}
