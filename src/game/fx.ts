/* THE BIG CON: BATTLE ROYALE — combat & board FX renderer
 * Tracers, hit sparks, floating +$ / 🛈 / 🔥 text (the board game's
 * popup FX, now in 3D), crude-oil fireballs, raid beacons.
 */
import * as THREE from 'three';
import { FxEvent } from './types';
import { Sfx } from './audio';

interface FloatText {
  sprite: THREE.Sprite;
  vy: number;
  life: number;
  maxLife: number;
  scale: number;
}

interface Explosion {
  mesh: THREE.Mesh;
  ring: THREE.Mesh;
  life: number;
}

interface Beacon {
  mesh: THREE.Mesh;
  life: number;
}

function textSprite(text: string, color: string, big: boolean): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.font = `900 ${big ? 72 : 56}px "Times New Roman", serif`;
  ctx.lineWidth = big ? 10 : 8;
  ctx.strokeStyle = '#0f0a05';
  ctx.strokeText(text, 128, 86);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, fog: false }));
  return s;
}

const STYLE_COLORS: Record<string, string> = {
  money: '#7fe08d',
  danger: '#ff6b5e',
  gold: '#f5c542',
  good: '#7ff6fb',
  info: '#55c1ff',
  cortisol: '#ffa94d',
};

export class FxRenderer {
  private floats: FloatText[] = [];
  private booms: Explosion[] = [];
  private beacons: Beacon[] = [];
  private tracerPts: number[] = [];
  private tracers: THREE.LineSegments;
  private scene: THREE.Scene;
  private seenIds = new Set<number>();
  private tracerLife: { pts: number[]; life: number }[] = [];

  constructor(scene: THREE.Scene, tracerMesh: THREE.LineSegments) {
    this.scene = scene;
    this.tracers = tracerMesh;
  }

  handle(fx: FxEvent[]) {
    for (const f of fx) {
      if (f.id !== undefined) {
        if (this.seenIds.has(f.id)) continue;
        this.seenIds.add(f.id);
        if (this.seenIds.size > 400) this.seenIds.clear();
      }
      switch (f.k) {
        case 'shot': break; /* handled by engine (needs aim dir) */
        case 'hit': this.hit(f); break;
        case 'kill': this.kill(f); break;
        case 'boom': this.boom(f); break;
        case 'text': this.text(f); break;
        case 'seize': this.seizeFx(f); break;
        case 'raid': this.raidFx(f); break;
        case 'pickup': break; /* sound handled by engine (local only) */
      }
    }
  }

  private text(f: FxEvent) {
    const col = STYLE_COLORS[f.s || 'info'] || '#f2f2f2';
    const big = (f.n || '').startsWith('+$') && (f.n || '').length <= 6;
    const s = textSprite(f.n || '', col, big);
    s.position.set(f.x || 0, f.y || 2.5, f.z || 0);
    s.scale.set(7, 3.5, 1);
    this.scene.add(s);
    this.floats.push({ sprite: s, vy: 3.4, life: 0, maxLife: 2.2, scale: 7 });
    if (f.n?.startsWith('+$')) Sfx.income();
    else if (f.n?.includes('PANIC')) Sfx.zoneTick();
  }

  private hit(f: FxEvent) {
    const s = textSprite('-' + (f.v || 0), '#ff6b5e', false);
    s.position.set(f.x || 0, (f.y || 2) + 0.8, f.z || 0);
    s.scale.set(4.5, 2.2, 1);
    this.scene.add(s);
    this.floats.push({ sprite: s, vy: 2.2, life: 0, maxLife: 0.9, scale: 4.5 });
    Sfx.hurt();
  }

  private kill(f: FxEvent) {
    const s = textSprite('LIQUIDATED', '#ff6b5e', true);
    s.position.set(f.x || 0, 4, f.z || 0);
    s.scale.set(13, 6.5, 1);
    this.scene.add(s);
    this.floats.push({ sprite: s, vy: 2.4, life: 0, maxLife: 2.8, scale: 13 });
    Sfx.dead();
  }

  private boom(f: FxEvent) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ff6b5e', transparent: true, opacity: 0.85, depthWrite: false })
    );
    mesh.position.set(f.x || 0, 1.5, f.z || 0);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.2, 32),
      new THREE.MeshBasicMaterial({ color: '#f5c542', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(f.x || 0, 0.3, f.z || 0);
    this.scene.add(mesh, ring);
    this.booms.push({ mesh, ring, life: 0 });
    Sfx.boom();
  }

  private raidFx(f: FxEvent) {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 160, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ff6b5e', transparent: true, opacity: 0.5, depthWrite: false })
    );
    beam.position.set(f.x || 0, 80, f.z || 0);
    this.scene.add(beam);
    this.beacons.push({ mesh: beam, life: 0 });
    Sfx.raid();
  }

  private seizeFx(f: FxEvent) {
    const s = textSprite('SEIZED', '#7ff6fb', true);
    s.position.set(f.x || 0, 5, f.z || 0);
    s.scale.set(11, 5.5, 1);
    this.scene.add(s);
    this.floats.push({ sprite: s, vy: 2.6, life: 0, maxLife: 2.2, scale: 11 });
    Sfx.seizeDone();
  }

  addTracer(from: THREE.Vector3, to: THREE.Vector3) {
    this.tracerLife.push({ pts: [from.x, from.y, from.z, to.x, to.y, to.z], life: 0.09 });
    Sfx.shoot('ppk');
  }

  addTracerShotSound(wpn: string) { Sfx.shoot(wpn); }

  update(dt: number) {
    /* floats */
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life += dt;
      f.sprite.position.y += f.vy * dt;
      const p = f.life / f.maxLife;
      f.sprite.material.opacity = p < 0.7 ? 1 : Math.max(0, 1 - (p - 0.7) / 0.3);
      f.sprite.scale.setScalar(f.scale * (p < 0.15 ? 0.6 + p / 0.15 * 0.4 : 1));
      f.sprite.scale.y = f.scale / 2;
      if (f.life >= f.maxLife) {
        this.scene.remove(f.sprite);
        f.sprite.material.map?.dispose();
        f.sprite.material.dispose();
        this.floats.splice(i, 1);
      }
    }
    /* booms */
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.life += dt;
      const p = b.life / 0.7;
      b.mesh.scale.setScalar(1 + p * 5);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - p));
      b.ring.scale.setScalar(1 + p * 9);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - p));
      if (b.life >= 0.7) {
        this.scene.remove(b.mesh, b.ring);
        b.mesh.geometry.dispose();
        this.booms.splice(i, 1);
      }
    }
    /* beacons */
    for (let i = this.beacons.length - 1; i >= 0; i--) {
      const bc = this.beacons[i];
      bc.life += dt;
      (bc.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.abs(Math.sin(bc.life * 4));
      if (bc.life >= 6) {
        this.scene.remove(bc.mesh);
        this.beacons.splice(i, 1);
      }
    }
    /* tracers */
    const pos: number[] = [];
    for (let i = this.tracerLife.length - 1; i >= 0; i--) {
      const tr = this.tracerLife[i];
      tr.life -= dt;
      if (tr.life > 0) pos.push(...tr.pts);
      else this.tracerLife.splice(i, 1);
    }
    const attr = this.tracers.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < Math.min(arr.length, pos.length); i++) arr[i] = pos[i];
    for (let i = pos.length; i < arr.length; i++) arr[i] = 9999;
    attr.needsUpdate = true;
  }
}
