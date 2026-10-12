/* THE BIG CON: BATTLE ROYALE — 3D world construction
 * Dark teal financial-terminal noir: dot-grid ground, black skyline with
 * teal windows, exhibit pads that carry the board game's corkboard photos,
 * and THE PANIC — the shrinking market-crash wall.
 */
import * as THREE from 'three';
import { NODES } from './data';
import { TYPE_COLORS, MOOD_COLORS, Mood, NodePub, MAP_R } from './types';

export interface ExhibitView {
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  flag: THREE.Mesh;
  flagMat: THREE.MeshBasicMaterial;
  label: THREE.Sprite;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  padPos: THREE.Vector3;
  node: (typeof NODES)[number];
}

export interface PickupView {
  mesh: THREE.Object3D;
  kind: string;
  id: number;
}

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ground: #1d201f with the board's teal dot grid */
function makeGround(): THREE.Mesh {
  const tex = canvasTex(256, 256, ctx => {
    ctx.fillStyle = '#1d201f';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(22,131,136,0.20)';
    for (let x = 8; x < 256; x += 26) for (let y = 8; y < 256; y += 26) ctx.fillRect(x, y, 2, 2);
    ctx.strokeStyle = 'rgba(22,131,136,0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 256, 256);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(MAP_R / 13, MAP_R / 13);
  const g = new THREE.PlaneGeometry(MAP_R * 2.4, MAP_R * 2.4);
  const m = new THREE.MeshLambertMaterial({ map: tex });
  const mesh = new THREE.Mesh(g, m);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/* city blocks with teal windows — three window textures reused */
function makeBuildingTex(seed: number): THREE.Texture {
  const lit = 0.35 + (seed % 3) * 0.12;
  return canvasTex(64, 128, ctx => {
    ctx.fillStyle = '#0c0f0e';
    ctx.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 122; y += 10) {
      for (let x = 6; x < 58; x += 12) {
        const on = Math.random() < lit;
        ctx.fillStyle = on ? (Math.random() < 0.85 ? '#1a6e73' : '#7ff6fb') : '#141817';
        ctx.globalAlpha = on ? 0.55 + Math.random() * 0.45 : 1;
        ctx.fillRect(x, y, 6, 5);
        ctx.globalAlpha = 1;
      }
    }
  });
}

export interface WorldRefs {
  scene: THREE.Scene;
  exhibits: ExhibitView[];
  zoneWall: THREE.Mesh;
  zoneMat: THREE.MeshBasicMaterial;
  hemi: THREE.HemisphereLight;
  dir: THREE.DirectionalLight;
  moodLight: THREE.PointLight;
  sun: THREE.Mesh;
  colliders: { x: number; z: number; r: number; h: number }[];
  pickupGroup: THREE.Group;
  tracers: THREE.LineSegments;
  tracerMat: THREE.LineBasicMaterial;
}

export function buildWorld(scene: THREE.Scene): WorldRefs {
  scene.background = new THREE.Color('#050807');
  scene.fog = new THREE.FogExp2('#050807', 0.0022);

  /* lights: cold teal ambient + a low moon */
  const hemi = new THREE.HemisphereLight('#3ec9cf', '#0a0f0e', 0.55);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight('#9adfe4', 0.7);
  dir.position.set(-200, 300, -150);
  scene.add(dir);
  const moodLight = new THREE.PointLight('#8fbf7f', 0.0, 900, 1.4);
  moodLight.position.set(0, 120, 0);
  scene.add(moodLight);

  /* the moon: a big teal disc with THE BIG CON watermark nearby */
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(60, 48),
    new THREE.MeshBasicMaterial({ color: '#168388', transparent: true, opacity: 0.85, fog: false })
  );
  moon.position.set(-350, 260, -700);
  moon.lookAt(0, 0, 0);
  scene.add(moon);
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(84, 48),
    new THREE.MeshBasicMaterial({ color: '#168388', transparent: true, opacity: 0.16, fog: false })
  );
  halo.position.set(-350, 260, -699);
  halo.lookAt(0, 0, 0);
  scene.add(halo);

  /* stars — sparse teal-white dots */
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 600 + Math.random() * 400;
    const y = 80 + Math.random() * 500;
    starPos[i * 3] = Math.cos(a) * r;
    starPos[i * 3 + 1] = y;
    starPos[i * 3 + 2] = Math.sin(a) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#9ad', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false }));
  scene.add(stars);

  scene.add(makeGround());

  /* roads: dark strips + center line */
  const roadMat = new THREE.MeshLambertMaterial({ color: '#101312' });
  const lineMat = new THREE.MeshBasicMaterial({ color: '#168388', transparent: true, opacity: 0.25 });
  for (let r = -MAP_R + 100; r < MAP_R; r += 100) {
    const h = new THREE.Mesh(new THREE.PlaneGeometry(MAP_R * 2, 16), roadMat);
    h.rotation.x = -Math.PI / 2; h.position.set(0, 0.02, r); scene.add(h);
    const v = new THREE.Mesh(new THREE.PlaneGeometry(16, MAP_R * 2), roadMat);
    v.rotation.x = -Math.PI / 2; v.position.set(r, 0.02, 0); scene.add(v);
    const lh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_R * 2, 0.5), lineMat);
    lh.rotation.x = -Math.PI / 2; lh.position.set(0, 0.05, r); scene.add(lh);
    const lv = new THREE.Mesh(new THREE.PlaneGeometry(0.5, MAP_R * 2), lineMat);
    lv.rotation.x = -Math.PI / 2; lv.position.set(r, 0.05, 0); scene.add(lv);
  }

  /* buildings — instanced boxes with window emissive maps */
  const colliders: { x: number; z: number; r: number; h: number }[] = [];
  const bTex = [makeBuildingTex(1), makeBuildingTex(2), makeBuildingTex(3)];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const bMats = bTex.map(t => new THREE.MeshLambertMaterial({ map: t, emissive: new THREE.Color('#0f3d40'), emissiveMap: t, emissiveIntensity: 0.9 }));
  const rng = mulberry(1337);
  let placed = 0;
  for (let tries = 0; tries < 900 && placed < 260; tries++) {
    const x = (rng() * 2 - 1) * (MAP_R - 24);
    const z = (rng() * 2 - 1) * (MAP_R - 24);
    /* keep roads clear */
    if (Math.abs(((x % 100) + 100) % 100 - 50) > 34 || Math.abs(((z % 100) + 100) % 100 - 50) > 34) continue;
    /* keep exhibit pads clear */
    if (NODES.some(n => Math.hypot(n.x - x, n.z - z) < 22)) continue;
    const w = 8 + rng() * 16;
    const d = 8 + rng() * 16;
    const tall = rng() < 0.14;
    const h = tall ? 60 + rng() * 120 : 10 + rng() * 34;
    const mesh = new THREE.Mesh(boxGeo, bMats[Math.floor(rng() * 3)]);
    mesh.position.set(x, h / 2, z);
    mesh.scale.set(w, h, d);
    scene.add(mesh);
    /* roof cap light */
    if (tall) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 1.2, d + 1.2), new THREE.MeshBasicMaterial({ color: '#7ff6fb', transparent: true, opacity: 0.5 }));
      cap.position.set(x, h + 0.6, z);
      scene.add(cap);
    }
    colliders.push({ x, z, r: Math.max(w, d) * 0.72, h });
    placed++;
  }

  /* Citi Tower — the landmark, 200m at the CBD node */
  {
    const x = 10, z = -300;
    const tex = makeBuildingTex(7);
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color('#1a6e73'), emissiveMap: tex, emissiveIntensity: 1.1 });
    const tower = new THREE.Mesh(boxGeo, mat);
    tower.position.set(x, 100, z);
    tower.scale.set(26, 200, 26);
    scene.add(tower);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(28, 2, 28), new THREE.MeshBasicMaterial({ color: '#7ff6fb' }));
    cap.position.set(x, 201, z);
    scene.add(cap);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.2, 40, 6), new THREE.MeshBasicMaterial({ color: '#168388' }));
    spire.position.set(x, 222, z);
    scene.add(spire);
    colliders.push({ x, z, r: 20, h: 200 });
  }

  /* ---- exhibit pads (the corkboard, materialized) ---- */
  const exhibits: ExhibitView[] = [];
  const texLoader = new THREE.TextureLoader();
  NODES.forEach(node => {
    const group = new THREE.Group();
    group.position.set(node.x, 0, node.z);
    const typeCol = TYPE_COLORS[node.type];

    /* pad disc */
    const ringMat = new THREE.MeshBasicMaterial({ color: typeCol, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(6.4, 7.4, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.09;
    group.add(ring);
    const discMat = new THREE.MeshBasicMaterial({ color: '#111413', transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(6.4, 40), discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.08;
    group.add(disc);

    /* ownership flag ring (outer) */
    const flagMat = new THREE.MeshBasicMaterial({ color: '#333', transparent: true, opacity: 0.0, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.RingGeometry(7.8, 8.6, 40), flagMat);
    flag.rotation.x = -Math.PI / 2;
    flag.position.y = 0.1;
    group.add(flag);

    /* vertical light beam */
    const beamMat = new THREE.MeshBasicMaterial({ color: typeCol, transparent: true, opacity: 0.16, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.6, 60, 12, 1, true), beamMat);
    beam.position.y = 30;
    group.add(beam);

    /* billboard: corkboard photo pinned on a post */
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 7.5, 8), new THREE.MeshLambertMaterial({ color: '#0c0f0e' }));
    post.position.set(0, 3.4, -3.4);
    group.add(post);
    const bbGroup = new THREE.Group();
    bbGroup.position.set(0, 6.6, -3.3);
    bbGroup.rotation.y = Math.PI / 12;
    const bbW = 6.4, bbH = 4.6;
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(bbW, bbH), new THREE.MeshLambertMaterial({ color: '#0e1110' }));
    bbGroup.add(bb);
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(bbW + 0.5, bbH + 0.5), new THREE.MeshBasicMaterial({ color: '#168388' }));
    frame.position.z = -0.02;
    bbGroup.add(frame);
    const photo = new THREE.Mesh(
      new THREE.PlaneGeometry(bbW - 0.5, bbH - 0.5),
      new THREE.MeshBasicMaterial({ color: '#ffffff' })
    );
    photo.position.z = 0.02;
    texLoader.load(node.img, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      (photo.material as THREE.MeshBasicMaterial).map = t;
      (photo.material as THREE.MeshBasicMaterial).needsUpdate = true;
    });
    bbGroup.add(photo);
    group.add(bbGroup);

    /* floating label: NAME · $income · type — canvas sprite */
    const labelTex = canvasTex(512, 160, ctx => {
      ctx.fillStyle = '#111413';
      ctx.fillRect(0, 0, 512, 160);
      ctx.strokeStyle = TYPE_COLORS[node.type as keyof typeof TYPE_COLORS];
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 506, 154);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f2f2f2';
      ctx.font = '900 44px "Times New Roman", serif';
      ctx.fillText(node.name.slice(0, 24), 256, 62);
      ctx.fillStyle = '#9ad';
      ctx.font = '600 26px system-ui, sans-serif';
      ctx.fillText(`${node.type} · $${node.income}/QTR · LIST $${node.cost}`, 256, 106);
      ctx.fillStyle = 'burlywood';
      ctx.font = 'italic 500 22px "Times New Roman", serif';
      ctx.fillText(node.sub.slice(0, 40), 256, 140);
    });
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, fog: false }));
    label.scale.set(11, 3.4, 1);
    label.position.set(0, 10.5, 0);
    group.add(label);

    /* owner name sprite (updated on state) */
    const ownLabel = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false, fog: false }));
    ownLabel.position.set(0, 13.6, 0);
    (ownLabel as THREE.Sprite & { _nodeId?: string })._nodeId = node.id;
    ownLabel.scale.set(9, 2.2, 1);
    group.add(ownLabel);

    scene.add(group);
    exhibits.push({
      group, ring, ringMat, flag, flagMat, label, beam, beamMat,
      padPos: new THREE.Vector3(node.x, 0, node.z), node,
    });
  });

  /* ---- THE PANIC — zone wall ---- */
  const zoneMat = new THREE.MeshBasicMaterial({
    color: '#ff6b5e', transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false,
  });
  const zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(400, 400, 240, 64, 1, true), zoneMat);
  zoneWall.position.y = 120;
  scene.add(zoneWall);
  const zoneWire = new THREE.Mesh(
    new THREE.CylinderGeometry(400, 400, 240, 64, 8, true),
    new THREE.MeshBasicMaterial({ color: '#ff6b5e', wireframe: true, transparent: true, opacity: 0.12 })
  );
  zoneWall.add(zoneWire);

  /* tracer lines pool */
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 6), 3));
  const tracerMat = new THREE.LineBasicMaterial({ color: '#7ff6fb', transparent: true, opacity: 0.9 });
  const tracers = new THREE.LineSegments(tracerGeo, tracerMat);
  tracers.frustumCulled = false;
  scene.add(tracers);

  const pickupGroup = new THREE.Group();
  scene.add(pickupGroup);

  return { scene, exhibits, zoneWall, zoneMat, hemi, dir, moodLight, sun: moon, colliders, pickupGroup, tracers, tracerMat };
}

export function applyMood(refs: WorldRefs, mood: Mood) {
  const col = MOOD_COLORS[mood];
  refs.moodLight.color.set(col);
  refs.moodLight.intensity = mood === 'CALM' ? 0.25 : 0.85;
  (refs.scene.fog as THREE.FogExp2).color.set(mood === 'PANIC' ? '#170a09' : mood === 'BOOM' ? '#0c0d08' : mood === 'FRENZY' ? '#0f0a13' : '#050807');
}

export function updateExhibits(refs: WorldRefs, nodePubs: NodePub[], playerColors: string[], playerNames: string[]) {
  for (const ev of refs.exhibits) {
    const pub = nodePubs.find(n => n.id === ev.node.id);
    if (!pub) continue;
    if (pub.owner === null) {
      ev.flagMat.opacity = 0.0;
      ev.flagMat.color.set('#333');
    } else {
      ev.flagMat.opacity = 0.9;
      ev.flagMat.color.set(playerColors[pub.owner] || '#fff');
    }
  }
  /* owner labels — redraw only when ownership changed */
  for (const ev of refs.exhibits) {
    const pub = nodePubs.find(n => n.id === ev.node.id);
    if (!pub) continue;
    const own = ev.group.children.find(c => (c as THREE.Sprite & { _nodeId?: string })._nodeId === ev.node.id) as THREE.Sprite | undefined;
    if (!own) continue;
    const want = pub.owner === null ? '' : (playerNames[pub.owner] || '?') + (pub.bugBy !== null ? ' 🐛' : '');
    const cur = (own.userData as { want?: string }).want;
    if (cur !== want) {
      (own.userData as { want?: string }).want = want;
      if (!want) {
        (own.material as THREE.SpriteMaterial).opacity = 0;
      } else {
        const t = canvasTex(256, 64, ctx => {
          ctx.fillStyle = '#111413';
          ctx.fillRect(0, 0, 256, 64);
          ctx.strokeStyle = playerColors[pub.owner!] || '#168388';
          ctx.lineWidth = 5;
          ctx.strokeRect(3, 3, 250, 58);
          ctx.textAlign = 'center';
          ctx.fillStyle = playerColors[pub.owner!] || '#fff';
          ctx.font = '900 34px "Times New Roman", serif';
          ctx.fillText(want.slice(0, 18), 128, 44);
        });
        own.material.map = t;
        own.material.opacity = 1;
        own.material.needsUpdate = true;
      }
    }
  }
}

/* pickup meshes factory */
export function makePickupMesh(kind: string, v: number, w?: string): THREE.Object3D {
  if (kind === 'money' || kind === 'intel') {
    const col = kind === 'money' ? '#7fe08d' : '#55c1ff';
    const glyph = kind === 'money' ? '$' + v : 'i' + v;
    const tex = canvasTex(128, 128, ctx => {
      ctx.fillStyle = '#111413';
      ctx.fillRect(14, 34, 100, 60);
      ctx.strokeStyle = col;
      ctx.lineWidth = 6;
      ctx.strokeRect(14, 34, 100, 60);
      ctx.fillStyle = col;
      ctx.textAlign = 'center';
      ctx.font = '900 44px "Times New Roman", serif';
      ctx.fillText(glyph, 64, 78);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    s.scale.set(2.2, 2.2, 1);
    s.position.y = 1.4;
    const holder = new THREE.Group();
    holder.add(s);
    /* glow disc */
    const glow = new THREE.Mesh(new THREE.CircleGeometry(1.4, 20), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.25 }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.12;
    holder.add(glow);
    return holder;
  }
  if (kind === 'med') {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.2), new THREE.MeshLambertMaterial({ color: '#f2f2f2' }));
    box.position.y = 0.7;
    g.add(box);
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.06), new THREE.MeshBasicMaterial({ color: '#168388' }));
    c1.position.set(0, 0.7, 0.62); g.add(c1);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.06), new THREE.MeshBasicMaterial({ color: '#168388' }));
    c2.position.set(0, 0.7, 0.62); g.add(c2);
    return g;
  }
  if (kind === 'ammo') {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.0), new THREE.MeshLambertMaterial({ color: '#2e3a38' }));
    box.position.y = 0.6; g.add(box);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.2, 1.02), new THREE.MeshBasicMaterial({ color: '#ffa94d' }));
    strip.position.y = 0.75; g.add(strip);
    return g;
  }
  if (kind === 'oil') {
    const g = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 12), new THREE.MeshLambertMaterial({ color: '#1a2a3a' }));
    barrel.position.y = 0.8; g.add(barrel);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.18, 12), new THREE.MeshBasicMaterial({ color: '#ff6b5e' }));
    ring.position.y = 0.9; g.add(ring);
    return g;
  }
  /* weapon crate */
  const g = new THREE.Group();
  const crate = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.2, 1.4), new THREE.MeshLambertMaterial({ color: '#111413' }));
  crate.position.y = 0.75; g.add(crate);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.16, 1.46), new THREE.MeshBasicMaterial({ color: '#7ff6fb' }));
  edge.position.y = 1.1; g.add(edge);
  const tex = canvasTex(256, 96, ctx => {
    ctx.fillStyle = '#111413';
    ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = '#7ff6fb'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 250, 90);
    ctx.fillStyle = '#f2f2f2'; ctx.textAlign = 'center';
    ctx.font = '900 34px "Times New Roman", serif';
    ctx.fillText((w || 'gun').toUpperCase().slice(0, 12), 128, 58);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(3.2, 1.2, 1);
  s.position.y = 2.4;
  g.add(s);
  return g;
}

export function makeAvatar(color: string, charImg: string): { group: THREE.Group; faceSprite: THREE.Sprite; body: THREE.Mesh; ring: THREE.Mesh } {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.55, 1.15, 6, 12),
    new THREE.MeshLambertMaterial({ color: '#141817' })
  );
  body.position.y = 1.55;
  group.add(body);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.28, 0.2),
    new THREE.MeshBasicMaterial({ color })
  );
  visor.position.set(0, 1.95, -0.42);
  group.add(visor);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.75, 0.95, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.14;
  group.add(ring);
  /* character face floating above — the board token, remembered */
  const faceSprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, fog: false }));
  faceSprite.scale.set(1.9, 1.9, 1);
  faceSprite.position.y = 3.4;
  new THREE.TextureLoader().load(charImg, t => {
    t.colorSpace = THREE.SRGBColorSpace;
    faceSprite.material.map = t;
    faceSprite.material.needsUpdate = true;
  });
  group.add(faceSprite);
  return { group, faceSprite, body, ring };
}

export function makeNameTag(name: string, color: string): THREE.Sprite {
  const t = canvasTex(256, 64, ctx => {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillText(name.slice(0, 16), 129, 44);
    ctx.fillStyle = color;
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillText(name.slice(0, 16), 128, 42);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, fog: false }));
  s.scale.set(4.4, 1.1, 1);
  s.position.y = 4.6;
  return s;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return function () {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
