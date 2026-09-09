import { useEffect, useMemo, useRef, useState } from 'react';
import { Gamepad2, Maximize2, Pause, Play, RotateCcw, Shield, Swords } from 'lucide-react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type Action = 'idle' | 'walk' | 'punch' | 'kick' | 'guard' | 'hit' | 'ko';
type MatchState = 'ready' | 'fighting' | 'round-over' | 'match-over';
type Snapshot = {
  p1: number; p2: number; r1: number; r2: number; timer: number;
  state: MatchState; message: string; m1: 'glb' | 'fallback'; m2: 'glb' | 'fallback';
};

type InputState = { left: boolean; right: boolean; punch: boolean; kick: boolean; guard: boolean };
type Rig = {
  hips?: THREE.Object3D; spine?: THREE.Object3D; chest?: THREE.Object3D; neck?: THREE.Object3D; head?: THREE.Object3D;
  shoulderL?: THREE.Object3D; shoulderR?: THREE.Object3D;
  armL?: THREE.Object3D; armR?: THREE.Object3D; foreL?: THREE.Object3D; foreR?: THREE.Object3D;
  legL?: THREE.Object3D; legR?: THREE.Object3D; calfL?: THREE.Object3D; calfR?: THREE.Object3D;
};
type Fighter = {
  root: THREE.Group; visual: THREE.Group; shadow: THREE.Mesh; rig: Rig;
  rest: Map<THREE.Object3D, THREE.Quaternion>; input: InputState;
  x: number; vx: number; face: 1 | -1; hp: number; rounds: number;
  action: Action; time: number; duration: number; resolved: boolean; model: 'glb' | 'fallback';
};

const EMPTY: Snapshot = { p1: 100, p2: 100, r1: 0, r2: 0, timer: 60, state: 'ready', message: 'LOADING FIGHTERS…', m1: 'fallback', m2: 'fallback' };
const FLOOR = -1.72;
const LEFT = -4.6;
const RIGHT = 4.6;
const MODEL_URLS = ['./models/fighter-1.glb', './models/fighter-2.glb'];

const clamp = THREE.MathUtils.clamp;
const damp = (from: number, to: number, lambda: number, dt: number) => THREE.MathUtils.lerp(from, to, 1 - Math.exp(-lambda * dt));
function boneName(name: string) {
  return name
    .toLowerCase()
    .replace(/mixamorig/g, '')
    .replace(/armature/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function rawSide(name: string): 'l' | 'r' | undefined {
  const raw = name.toLowerCase();
  if (raw.includes('left')) return 'l';
  if (raw.includes('right')) return 'r';
  if (/(^|[_.:\-\s])l($|[_.:\-\s])/.test(raw) || /[_.:\-]l$/.test(raw)) return 'l';
  if (/(^|[_.:\-\s])r($|[_.:\-\s])/.test(raw) || /[_.:\-]r$/.test(raw)) return 'r';
  const n = boneName(raw);
  if (/(upperarm|forearm|thigh|calf|upleg|lowerleg|upperleg)l$/.test(n)) return 'l';
  if (/(upperarm|forearm|thigh|calf|upleg|lowerleg|upperleg)r$/.test(n)) return 'r';
  return undefined;
}

function scoreBone(obj: THREE.Object3D, aliases: string[], side?: 'l' | 'r') {
  const n = boneName(obj.name);
  const detected = rawSide(obj.name);
  if (side && detected && detected !== side) return -1000;
  let score = side && detected === side ? 24 : 0;
  for (const alias of aliases) {
    const a = boneName(alias);
    if (n === a) score = Math.max(score, 120);
    else if (n.endsWith(a)) score = Math.max(score, 92);
    else if (n.startsWith(a)) score = Math.max(score, 82);
    else if (n.includes(a)) score = Math.max(score, 64);
  }
  return score - Math.min(n.length * 0.06, 3);
}

function pickBone(bones: THREE.Object3D[], aliases: string[], side?: 'l' | 'r') {
  let best: THREE.Object3D | undefined;
  let bestScore = 18;
  for (const bone of bones) {
    const score = scoreBone(bone, aliases, side);
    if (score > bestScore) { bestScore = score; best = bone; }
  }
  return best;
}

function firstBoneChild(obj: THREE.Object3D | undefined, reject: RegExp) {
  if (!obj) return undefined;
  const queue = [...obj.children];
  while (queue.length) {
    const child = queue.shift()!;
    if ((child as THREE.Bone).isBone && !reject.test(boneName(child.name))) return child;
    queue.push(...child.children);
  }
  return undefined;
}

function findRig(root: THREE.Object3D): Rig {
  const bones: THREE.Object3D[] = [];
  root.traverse((obj) => {
    const namedFallbackPart = /(head|upperarm|forearm|thigh|calf|upperleg|lowerleg)/i.test(obj.name);
    if ((obj as THREE.Bone).isBone || namedFallbackPart) bones.push(obj);
  });

  const rig: Rig = {
    hips: pickBone(bones, ['hips', 'pelvis']),
    spine: pickBone(bones, ['spine']),
    chest: pickBone(bones, ['upperchest', 'chest', 'spine02', 'spine2', 'spine03', 'spine3']),
    neck: pickBone(bones, ['neck']),
    head: pickBone(bones, ['head']),
    shoulderL: pickBone(bones, ['leftshoulder', 'shoulder'], 'l'),
    shoulderR: pickBone(bones, ['rightshoulder', 'shoulder'], 'r'),
    armL: pickBone(bones, ['leftupperarm', 'upperarm', 'leftarm', 'arm'], 'l'),
    armR: pickBone(bones, ['rightupperarm', 'upperarm', 'rightarm', 'arm'], 'r'),
    foreL: pickBone(bones, ['leftforearm', 'forearm', 'leftlowerarm', 'lowerarm'], 'l'),
    foreR: pickBone(bones, ['rightforearm', 'forearm', 'rightlowerarm', 'lowerarm'], 'r'),
    legL: pickBone(bones, ['leftupleg', 'leftthigh', 'thigh', 'upperleg'], 'l'),
    legR: pickBone(bones, ['rightupleg', 'rightthigh', 'thigh', 'upperleg'], 'r'),
    calfL: pickBone(bones, ['leftleg', 'leftcalf', 'calf', 'lowerleg', 'shin'], 'l'),
    calfR: pickBone(bones, ['rightleg', 'rightcalf', 'calf', 'lowerleg', 'shin'], 'r'),
  };

  rig.foreL ??= firstBoneChild(rig.armL, /(hand|finger|thumb)/);
  rig.foreR ??= firstBoneChild(rig.armR, /(hand|finger|thumb)/);
  rig.calfL ??= firstBoneChild(rig.legL, /(foot|toe)/);
  rig.calfR ??= firstBoneChild(rig.legR, /(foot|toe)/);
  return rig;
}

function rigSummary(rig: Rig) {
  const entries = Object.entries(rig).filter(([, value]) => Boolean(value));
  return {
    matched: entries.length,
    total: 15,
    bones: Object.fromEntries(entries.map(([key, value]) => [key, value?.name ?? ''])),
  };
}

function captureRest(rig: Rig) {
  const map = new Map<THREE.Object3D, THREE.Quaternion>();
  Object.values(rig).forEach((o) => { if (o) map.set(o, o.quaternion.clone()); });
  return map;
}

function pose(f: Fighter, obj: THREE.Object3D | undefined, x: number, y = 0, z = 0) {
  if (!obj) return;
  const base = f.rest.get(obj);
  if (!base) return;
  obj.quaternion.copy(base).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')));
}

function resetRig(f: Fighter) {
  f.rest.forEach((q, o) => o.quaternion.slerp(q, 0.48));
}

function fallbackChimp(primary: number, accent: number) {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.78 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc99770, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.7 });
  const neon = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.45, metalness: 0.18 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.56, 0.78, 8, 16), fur);
  torso.scale.set(1.05, 1, 0.74);
  g.add(torso);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.48, 20, 16), skin);
  chest.position.set(0, 0.12, 0.41);
  chest.scale.set(0.88, 0.95, 0.32);
  g.add(chest);

  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 1.05;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.53, 24, 18), fur);
  head.add(skull);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), skin);
  muzzle.position.set(0, -0.1, 0.43);
  muzzle.scale.set(1.05, 0.72, 0.56);
  head.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), dark);
  nose.position.set(0, 0, 0.67);
  head.add(nose);
  [-0.17, 0.17].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), dark);
    eye.position.set(x, 0.15, 0.48);
    head.add(eye);
  });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.055, 8, 28, Math.PI * 1.25), neon);
  band.rotation.z = Math.PI * 0.9;
  head.add(band);
  g.add(head);

  const limb = (name: string, x: number, y: number, len: number, radius: number, mat: THREE.Material) => {
    const p = new THREE.Group();
    p.name = name;
    p.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, len, 6, 12), mat);
    m.position.y = -(len + radius * 2) * 0.5;
    p.add(m);
    g.add(p);
  };
  limb('leftupperarm', -0.58, 0.55, 0.72, 0.15, fur);
  limb('rightupperarm', 0.58, 0.55, 0.72, 0.15, fur);
  limb('leftthigh', -0.25, -0.55, 0.68, 0.17, dark);
  limb('rightthigh', 0.25, -0.55, 0.68, 0.17, dark);

  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.07, 8, 28), neon);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = -0.47;
  g.add(belt);

  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
  });
  return g;
}

class ArenaGame {
  mount: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 100);
  loader = new GLTFLoader();
  clock = new THREE.Clock();
  p1!: Fighter;
  p2!: Fighter;
  state: MatchState = 'ready';
  message = 'LOADING FIGHTERS…';
  timer = 60;
  ready = 0;
  aiWait = 0;
  aiCommit = 0;
  elapsed = 0;
  shake = 0;
  hitStop = 0;
  cameraPunch = 0;
  roundTransition = 0;
  raf = 0;
  onState: (s: Snapshot) => void;
  observer: ResizeObserver;
  keyDown: (e: KeyboardEvent) => void;
  keyUp: (e: KeyboardEvent) => void;

  constructor(mount: HTMLElement, onState: (s: Snapshot) => void) {
    this.mount = mount;
    this.onState = onState;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.tabIndex = 0;
    this.mount.appendChild(this.renderer.domElement);
    this.buildWorld();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.mount);
    this.resize();

    const apply = (down: boolean, e: KeyboardEvent) => {
      if (!this.p1) return;
      const k = e.key.toLowerCase();
      if (['a', 'd', 'j', 'k', 'l', 'arrowleft', 'arrowright', ' ', 'enter'].includes(k)) e.preventDefault();
      if (k === 'a' || k === 'arrowleft') this.p1.input.left = down;
      if (k === 'd' || k === 'arrowright') this.p1.input.right = down;
      if (k === 'j') this.p1.input.punch = down;
      if (k === 'k') this.p1.input.kick = down;
      if (k === 'l') this.p1.input.guard = down;
      if (down && (k === ' ' || k === 'enter') && this.state !== 'fighting') this.start();
    };
    this.keyDown = (e) => apply(true, e);
    this.keyUp = (e) => apply(false, e);
    addEventListener('keydown', this.keyDown);
    addEventListener('keyup', this.keyUp);

    Promise.all([this.loadFighter(0), this.loadFighter(1)]).then(([a, b]) => {
      this.p1 = a;
      this.p2 = b;
      this.emit();
    });
    this.raf = requestAnimationFrame(() => this.loop());
  }

  buildWorld() {
    this.scene.background = new THREE.Color(0x0a1612);
    this.scene.fog = new THREE.FogExp2(0x11251b, 0.033);
    this.scene.add(new THREE.HemisphereLight(0xd7f5da, 0x1b0d07, 1.25));

    const sun = new THREE.DirectionalLight(0xffd6a5, 3.1);
    sun.position.set(-4, 8, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -5;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x64e3b9, 1.5);
    rim.position.set(5, 3, -4);
    this.scene.add(rim);

    const wood = new THREE.MeshStandardMaterial({ color: 0x684326, roughness: 0.94 });
    for (let i = -5; i <= 5; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.22, 3.15), wood.clone());
      (plank.material as THREE.MeshStandardMaterial).color.offsetHSL(0, 0, (i % 2) * 0.018);
      plank.position.set(i * 1.01, FLOOR - 0.11, 0);
      plank.rotation.y = Math.sin(i * 1.5) * 0.015;
      plank.castShadow = true;
      plank.receiveShadow = true;
      this.scene.add(plank);
    }

    const rail = new THREE.MeshStandardMaterial({ color: 0x3a281a, roughness: 1 });
    [-1.72, 1.72].forEach((z) => {
      for (let x = -5; x <= 5; x += 1.25) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.105, 1.2, 8), rail);
        post.position.set(x, FLOOR + 0.48, z);
        post.castShadow = true;
        this.scene.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 10.2, 8), rail);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, FLOOR + 1.02, z);
      this.scene.add(bar);
    });

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x342316, roughness: 1 });
    const leafA = new THREE.MeshStandardMaterial({ color: 0x1c5738, roughness: 0.95 });
    const leafB = new THREE.MeshStandardMaterial({ color: 0x2d7b4c, roughness: 0.9 });
    for (let i = 0; i < 22; i++) {
      const x = -12 + (i * 3.7) % 24;
      const z = -4.5 - (i % 5) * 1.8;
      const h = 5 + (i % 4) * 1.45;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, h, 9), trunkMat);
      trunk.position.set(x, -1.4 + h / 2, z);
      trunk.rotation.z = Math.sin(i) * 0.07;
      this.scene.add(trunk);
      for (let j = 0; j < 3; j++) {
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + ((i + j) % 3) * 0.28, 1), j % 2 ? leafA : leafB);
        crown.scale.set(1.45, 0.72, 0.9);
        crown.position.set(x + Math.sin(j * 2) * 1.05, 2.2 + h * 0.42 + j * 0.45, z + Math.cos(j) * 0.65);
        this.scene.add(crown);
      }
    }

    const hutWall = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.2, 0.35), new THREE.MeshStandardMaterial({ color: 0x79502e, roughness: 0.95 }));
    hutWall.position.set(0, 1.2, -6.1);
    this.scene.add(hutWall);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.4, 4), new THREE.MeshStandardMaterial({ color: 0x3c2b19, roughness: 1 }));
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, 3.0, -6.1);
    this.scene.add(roof);

    [-3.7, 0, 3.7].forEach((x) => {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffbb55, emissive: 0xff7c1d, emissiveIntensity: 2.6 }));
      bulb.position.set(x, 2.6 + Math.abs(x) * 0.08, -0.8);
      this.scene.add(bulb);
      const light = new THREE.PointLight(0xff9840, 1.5, 5);
      light.position.copy(bulb.position);
      this.scene.add(light);
    });

    this.camera.position.set(0, 0.15, 12.2);
    this.camera.lookAt(0, -0.05, 0);
  }

  makeShadow(x: number) {
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.y = 0.42;
    shadow.position.set(x, FLOOR + 0.015, 0);
    this.scene.add(shadow);
    return shadow;
  }

  async loadFighter(index: 0 | 1): Promise<Fighter> {
    const x = index === 0 ? -2.1 : 2.1;
    const root = new THREE.Group();
    root.position.set(x, FLOOR, 0);
    const visual = new THREE.Group();
    root.add(visual);
    this.scene.add(root);
    let model: 'glb' | 'fallback' = 'fallback';
    let rig: Rig = {};
    try {
      const gltf = await this.loader.loadAsync(MODEL_URLS[index]);
      const s = gltf.scene;
      const box = new THREE.Box3().setFromObject(s);
      const size = new THREE.Vector3();
      box.getSize(size);
      s.scale.setScalar(3.05 / Math.max(size.y, 0.001));
      const fitted = new THREE.Box3().setFromObject(s);
      const center = fitted.getCenter(new THREE.Vector3());
      s.position.set(-center.x, -fitted.min.y, -center.z);
      s.rotation.y = Math.PI / 2;
      s.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
      visual.add(s);
      rig = findRig(s);
      const summary = rigSummary(rig);
      console.info(`[Canopy Clash] Fighter ${index + 1} rig ${summary.matched}/${summary.total}`, summary.bones);
      model = 'glb';
    } catch {
      const s = fallbackChimp(index === 0 ? 0x6a4732 : 0x3f5666, index === 0 ? 0xff9337 : 0x62d7ff);
      s.position.y = 1.42;
      s.rotation.y = Math.PI / 2;
      visual.add(s);
      rig = findRig(s);
    }
    return {
      root, visual, shadow: this.makeShadow(x), rig, rest: captureRest(rig),
      input: { left: false, right: false, punch: false, kick: false, guard: false },
      x, vx: 0, face: index === 0 ? 1 : -1, hp: 100, rounds: 0,
      action: 'idle', time: 0, duration: 0, resolved: false, model
    };
  }

  setInput(key: keyof InputState, down: boolean) {
    if (this.p1) this.p1.input[key] = down;
  }

  start() {
    if (!this.p1 || !this.p2) return;
    if (this.state === 'match-over') { this.p1.rounds = 0; this.p2.rounds = 0; }
    [this.p1, this.p2].forEach((f, i) => {
      f.hp = 100; f.x = i === 0 ? -2.1 : 2.1; f.vx = 0; f.action = 'idle'; f.time = 0; f.resolved = false;
      f.root.position.x = f.x;
    });
    this.timer = 60;
    this.ready = 2.35;
    this.state = 'ready';
    this.message = 'ROUND ' + (this.p1.rounds + this.p2.rounds + 1);
    this.emit();
    this.renderer.domElement.focus({ preventScroll: true });
  }

  pause() {
    if (this.state === 'fighting') { this.state = 'ready'; this.ready = 0; this.message = 'PAUSED'; }
    else if (this.state === 'ready' && this.message === 'PAUSED') { this.state = 'fighting'; this.message = 'FIGHT!'; }
    this.emit();
  }

  attack(f: Fighter, kind: 'punch' | 'kick') {
    if (!['idle', 'walk', 'guard'].includes(f.action)) return;
    f.action = kind;
    f.time = 0;
    f.duration = kind === 'punch' ? 0.46 : 0.66;
    f.resolved = false;
  }

  updateInput(f: Fighter, dt: number) {
    const canMove = ['idle', 'walk', 'guard'].includes(f.action);
    const dir = (f.input.right ? 1 : 0) - (f.input.left ? 1 : 0);
    if (canMove) {
      f.vx = damp(f.vx, dir * (f.input.guard ? 1.1 : 2.6), 14, dt);
      f.action = f.input.guard ? 'guard' : Math.abs(f.vx) > 0.16 ? 'walk' : 'idle';
    } else f.vx *= Math.exp(-dt * 9);
    if (f.input.punch) this.attack(f, 'punch');
    if (f.input.kick) this.attack(f, 'kick');
  }

  updateAI(dt: number) {
    this.aiWait -= dt;
    this.aiCommit -= dt;
    if (this.state !== 'fighting') return;

    const a = this.p2;
    const p = this.p1;
    const d = Math.abs(a.x - p.x);

    if (this.aiCommit > 0) return;
    if (this.aiWait > 0) return;

    const losing = a.hp + 18 < p.hp;
    const lowHealth = a.hp < 30;
    const reaction = lowHealth ? 0.09 : losing ? 0.11 : 0.13;
    this.aiWait = reaction + Math.random() * 0.12;

    Object.keys(a.input).forEach((k) => { a.input[k as keyof InputState] = false; });

    const playerAttacking = p.action === 'punch' || p.action === 'kick';
    if (playerAttacking && d < 1.72) {
      const guardChance = lowHealth ? 0.82 : 0.66;
      if (Math.random() < guardChance) {
        a.input.guard = true;
        this.aiCommit = 0.18 + Math.random() * 0.16;
        return;
      }
    }

    if (d > 1.72) {
      if (p.x < a.x) a.input.left = true; else a.input.right = true;
      this.aiCommit = 0.12 + Math.random() * 0.16;
      return;
    }

    if (d < 0.92 && Math.random() < 0.28) {
      if (p.x < a.x) a.input.right = true; else a.input.left = true;
      this.aiCommit = 0.16 + Math.random() * 0.18;
      return;
    }

    const aggression = losing ? 0.78 : 0.64;
    const r = Math.random();
    if (r < aggression * 0.56) {
      a.input.punch = true;
      this.aiCommit = 0.12;
    } else if (r < aggression) {
      a.input.kick = true;
      this.aiCommit = 0.16;
    } else if (r < aggression + 0.2) {
      a.input.guard = true;
      this.aiCommit = 0.18 + Math.random() * 0.18;
    } else {
      if (Math.random() < 0.5) a.input.left = true; else a.input.right = true;
      this.aiCommit = 0.1 + Math.random() * 0.14;
    }
  }

  hit(attacker: Fighter, defender: Fighter) {
    if (attacker.resolved || (attacker.action !== 'punch' && attacker.action !== 'kick')) return;
    const t = attacker.time / attacker.duration;
    const active = attacker.action === 'punch' ? [0.31, 0.56] : [0.43, 0.69];
    if (t < active[0] || t > active[1]) return;
    attacker.resolved = true;
    const range = attacker.action === 'punch' ? 1.36 : 1.58;
    if (Math.abs(attacker.x - defender.x) > range || Math.sign(defender.x - attacker.x) !== attacker.face) return;
    const block = defender.action === 'guard' || defender.input.guard;
    const damage = Math.ceil((attacker.action === 'punch' ? 9 : 14) * (block ? 0.24 : 1));
    defender.hp = Math.max(0, defender.hp - damage);
    defender.vx = attacker.face * (block ? 0.55 : attacker.action === 'kick' ? 2.8 : 1.6);
    if (!block) { defender.action = defender.hp <= 0 ? 'ko' : 'hit'; defender.time = 0; defender.duration = defender.hp <= 0 ? 1.2 : 0.3; }
    this.shake = block ? 0.04 : attacker.action === 'kick' ? 0.15 : 0.09;
    this.hitStop = block ? 0.024 : attacker.action === 'kick' ? 0.072 : 0.046;
    this.cameraPunch = block ? 0.08 : attacker.action === 'kick' ? 0.34 : 0.2;
    const impactX = (attacker.x + defender.x) * 0.5;
    const impactY = FLOOR + (attacker.action === 'kick' ? 1.05 : 1.42);
    this.spark(impactX, impactY, block ? 0x76d5ff : 0xffaa43);
    this.impactRing(impactX, impactY, block ? 0x76d5ff : 0xffb14a, attacker.action === 'kick' ? 0.72 : 0.52);
    this.emit();
  }

  spark(x: number, y: number, color: number) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.035 + Math.random() * 0.04, 6, 6), mat.clone());
      s.position.set(x + (Math.random() - 0.5) * 0.45, y + (Math.random() - 0.5) * 0.4, 0.3);
      s.userData.life = 0.24;
      s.userData.maxLife = 0.24;
      s.userData.vx = (Math.random() - 0.5) * 2.6;
      s.userData.vy = 0.4 + Math.random() * 2.2;
      s.name = 'hitfx';
      this.scene.add(s);
    }
  }

  impactRing(x: number, y: number, color: number, size: number) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.26, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.position.set(x, y, 0.42);
    ring.scale.setScalar(size);
    ring.userData.life = 0.18;
    ring.userData.maxLife = 0.18;
    ring.userData.grow = 8.5;
    ring.name = 'impactring';
    this.scene.add(ring);
  }

  animate(f: Fighter, dt: number) {
    resetRig(f);
    const phase = this.elapsed * 8 + (f === this.p2 ? Math.PI : 0);
    const t = f.duration ? clamp(f.time / f.duration, 0, 1) : 0;
    f.visual.position.set(0, 0, 0);
    f.visual.rotation.z = 0;
    if (f.action === 'idle') {
      const breathe = Math.sin(phase * 0.45);
      f.visual.position.y = breathe * 0.018;
      pose(f, f.rig.spine, 0.018 * breathe);
      pose(f, f.rig.chest, 0.025 * breathe, 0, 0);
      pose(f, f.rig.shoulderL, 0.04, 0, -0.08);
      pose(f, f.rig.shoulderR, 0.04, 0, 0.08);
      pose(f, f.rig.armL, 0.18, 0, -0.12 * f.face);
      pose(f, f.rig.armR, 0.18, 0, 0.12 * f.face);
    } else if (f.action === 'walk') {
      const s = Math.sin(phase);
      f.visual.position.y = Math.abs(s) * 0.03;
      pose(f, f.rig.spine, 0, 0, -s * 0.035);
      pose(f, f.rig.armL, s * 0.45); pose(f, f.rig.armR, -s * 0.45);
      pose(f, f.rig.legL, -s * 0.55); pose(f, f.rig.legR, s * 0.55);
    } else if (f.action === 'guard') {
      f.visual.position.y = -0.035;
      pose(f, f.rig.chest, 0.08, 0, 0);
      pose(f, f.rig.shoulderL, -0.18, 0, -0.22);
      pose(f, f.rig.shoulderR, -0.18, 0, 0.22);
      pose(f, f.rig.armL, -1.0, 0, -0.72 * f.face); pose(f, f.rig.armR, -1.0, 0, 0.72 * f.face);
      pose(f, f.rig.foreL, -0.8); pose(f, f.rig.foreR, -0.8);
    } else if (f.action === 'punch') {
      const p = Math.sin(t * Math.PI);
      f.visual.position.x = f.face * p * 0.12;
      f.visual.rotation.z = -f.face * p * 0.08;
      pose(f, f.rig.spine, 0, -f.face * p * 0.16, 0);
      pose(f, f.rig.chest, 0, -f.face * p * 0.42, 0);
      const shoulder = f.face === 1 ? f.rig.shoulderR : f.rig.shoulderL;
      const arm = f.face === 1 ? f.rig.armR : f.rig.armL;
      const fore = f.face === 1 ? f.rig.foreR : f.rig.foreL;
      pose(f, shoulder, -0.22 * p, 0, -f.face * 0.25 * p);
      pose(f, arm, -1.3 * p, 0, -f.face * 0.58 * p);
      pose(f, fore, -0.5 * (1 - p));
    } else if (f.action === 'kick') {
      const p = Math.sin(t * Math.PI);
      f.visual.position.x = f.face * p * 0.15;
      f.visual.rotation.z = -f.face * p * 0.1;
      pose(f, f.rig.hips, 0, f.face * p * 0.12, -f.face * p * 0.05);
      pose(f, f.rig.chest, 0.08 * p, -f.face * p * 0.16, f.face * p * 0.05);
      pose(f, f.face === 1 ? f.rig.legR : f.rig.legL, -1.05 * p, 0, f.face * 0.5 * p);
      pose(f, f.face === 1 ? f.rig.calfR : f.rig.calfL, 1.0 * p);
    } else if (f.action === 'hit') {
      const p = 1 - t;
      f.visual.rotation.z = -f.face * p * 0.17;
      pose(f, f.rig.chest, 0.08 * p, 0, -f.face * 0.16 * p);
      pose(f, f.rig.neck, 0.12 * p, 0, -f.face * 0.18 * p);
      pose(f, f.rig.head, 0.22 * p, 0, -f.face * 0.3 * p);
    } else if (f.action === 'ko') {
      f.visual.rotation.z = -f.face * Math.min(t * 1.4, 1) * 1.28;
      f.visual.position.y = -Math.min(t * 1.2, 1) * 0.65;
    }
  }

  updateFighter(f: Fighter, dt: number) {
    this.updateInput(f, dt);
    if (['punch', 'kick', 'hit', 'ko'].includes(f.action)) {
      f.time += dt;
      if (f.action !== 'ko' && f.time >= f.duration) { f.action = 'idle'; f.time = 0; f.resolved = false; }
    }
    f.x = clamp(f.x + f.vx * dt, LEFT, RIGHT);
    f.root.position.x = f.x;
    f.shadow.position.x = f.x;
    this.animate(f, dt);
  }

  separate() {
    const d = this.p2.x - this.p1.x;
    if (Math.abs(d) < 0.95) {
      const push = (0.95 - Math.abs(d)) * 0.5;
      const s = d >= 0 ? 1 : -1;
      this.p1.x -= push * s;
      this.p2.x += push * s;
      this.p1.root.position.x = this.p1.x;
      this.p2.root.position.x = this.p2.x;
    }
    this.p1.face = this.p2.x >= this.p1.x ? 1 : -1;
    this.p2.face = this.p1.x >= this.p2.x ? 1 : -1;
    this.p1.visual.rotation.y = this.p1.face === 1 ? 0 : Math.PI;
    this.p2.visual.rotation.y = this.p2.face === 1 ? 0 : Math.PI;
  }

  finishRound() {
    if (this.state !== 'fighting') return;
    this.state = 'round-over';
    const winner = this.p1.hp > this.p2.hp ? this.p1 : this.p2.hp > this.p1.hp ? this.p2 : null;
    const knockout = this.p1.hp <= 0 || this.p2.hp <= 0;
    if (winner) winner.rounds++;
    this.message = winner === this.p1
      ? (knockout ? 'K.O. — PLAYER 1 TAKES ROUND' : 'PLAYER 1 WINS ROUND')
      : winner === this.p2
        ? (knockout ? 'K.O. — CPU TAKES ROUND' : 'CPU WINS ROUND')
        : 'DRAW';
    if (this.p1.rounds >= 2 || this.p2.rounds >= 2) {
      this.state = 'match-over';
      this.message = this.p1.rounds > this.p2.rounds ? 'PLAYER 1 WINS MATCH' : 'CPU WINS MATCH';
    }
    this.roundTransition = this.state === 'match-over' ? 0 : 2.6;
    this.emit();
  }

  updateFx(dt: number) {
    const remove: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.name !== 'hitfx' && o.name !== 'impactring') return;
      o.userData.life -= dt;
      const m = o as THREE.Mesh;
      const maxLife = o.userData.maxLife || 0.22;
      if (o.name === 'hitfx') {
        o.position.x += o.userData.vx * dt;
        o.position.y += o.userData.vy * dt;
        o.userData.vy -= 4 * dt;
      } else {
        const grow = 1 + o.userData.grow * dt;
        o.scale.multiplyScalar(grow);
      }
      if (m.material && !Array.isArray(m.material)) (m.material as THREE.MeshBasicMaterial).opacity = clamp(o.userData.life / maxLife, 0, 1);
      if (o.userData.life <= 0) remove.push(o);
    });
    remove.forEach((o) => this.scene.remove(o));
  }

  update(dt: number) {
    if (!this.p1 || !this.p2) return;
    this.elapsed += dt;
    this.updateFx(dt);

    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt);
      this.updateCamera(dt);
      return;
    }

    if (this.state === 'round-over' && this.roundTransition > 0) {
      this.roundTransition -= dt;
      if (this.roundTransition <= 0) this.start();
    }

    if (this.state === 'ready' && this.ready > 0) {
      this.ready -= dt;
      if (this.ready <= 1.45 && this.ready > 0.72 && this.message.startsWith('ROUND')) {
        this.message = 'READY';
        this.emit();
      }
      if (this.ready <= 0.72 && this.message !== 'FIGHT!') {
        this.message = 'FIGHT!';
        this.emit();
      }
      if (this.ready <= 0) {
        this.state = 'fighting';
        this.message = 'FIGHT!';
        this.emit();
      }
    }
    if (this.state === 'fighting') {
      this.timer = Math.max(0, this.timer - dt);
      this.updateAI(dt);
      this.updateFighter(this.p1, dt);
      this.updateFighter(this.p2, dt);
      this.separate();
      this.hit(this.p1, this.p2);
      this.hit(this.p2, this.p1);
      if (this.p1.hp <= 0 || this.p2.hp <= 0 || this.timer <= 0) this.finishRound();
    } else {
      this.animate(this.p1, dt);
      this.animate(this.p2, dt);
    }
    this.updateCamera(dt);
  }

  updateCamera(dt: number) {
    this.shake *= Math.exp(-dt * 18);
    this.cameraPunch *= Math.exp(-dt * 9);
    const center = (this.p1.x + this.p2.x) * 0.5;
    const distance = Math.abs(this.p2.x - this.p1.x);
    const targetZ = clamp(10.9 + distance * 0.43 - this.cameraPunch, 11.2, 13.6);
    this.camera.position.x = damp(this.camera.position.x, center * 0.18, 4.5, dt) + (Math.random() - 0.5) * this.shake;
    this.camera.position.y = damp(this.camera.position.y, 0.15, 6, dt) + (Math.random() - 0.5) * this.shake * 0.45;
    this.camera.position.z = damp(this.camera.position.z, targetZ, 4.5, dt);
    this.camera.lookAt(center * 0.12, -0.05, 0);
  }

  loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(() => this.loop());
  }

  emit() {
    if (!this.p1 || !this.p2) return;
    this.onState({
      p1: this.p1.hp, p2: this.p2.hp, r1: this.p1.rounds, r2: this.p2.rounds,
      timer: Math.ceil(this.timer), state: this.state, message: this.message, m1: this.p1.model, m2: this.p2.model
    });
  }

  resize() {
    const w = Math.max(1, this.mount.clientWidth);
    const h = Math.max(1, this.mount.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1.15 ? 42 : 34;
    this.camera.updateProjectionMatrix();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    removeEventListener('keydown', this.keyDown);
    removeEventListener('keyup', this.keyUp);
    this.renderer.dispose();
    this.mount.replaceChildren();
  }
}

function Health({ value, right }: { value: number; right?: boolean }) {
  return <div className={'health' + (right ? ' right' : '')}><div className="health-fill" style={{ width: String(value) + '%' }} /><span>{Math.round(value)}</span></div>;
}

function HoldButton({ label, onChange, className }: { label: string; onChange: (v: boolean) => void; className?: string }) {
  return <button className={'touch ' + (className || '')} onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); onChange(true); }} onPointerUp={() => onChange(false)} onPointerCancel={() => onChange(false)}>{label}</button>;
}

export default function App() {
  const mount = useRef<HTMLDivElement>(null);
  const game = useRef<ArenaGame | null>(null);
  const [s, setS] = useState<Snapshot>(EMPTY);
  const [intro, setIntro] = useState(true);
  const reduced = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  useEffect(() => {
    if (!mount.current) return;
    const g = new ArenaGame(mount.current, setS);
    game.current = g;
    return () => { g.destroy(); game.current = null; };
  }, []);

  const start = () => { setIntro(false); game.current?.start(); };
  const setInput = (k: keyof InputState, v: boolean) => game.current?.setInput(k, v);
  const fullscreen = async () => {
    const el = document.querySelector('.arena') as HTMLElement | null;
    if (!el) return;
    if (document.fullscreenElement) await document.exitFullscreen(); else await el.requestFullscreen();
  };

  return <main className={'app' + (reduced ? ' reduced' : '')}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Swords size={20} /></span><span><b>CANOPY CLASH</b><small>CHIMPIONS 3D FIGHT</small></span></div>
      <div className="top-actions"><button onClick={() => game.current?.pause()} aria-label="Pause"><Pause size={18} /></button><button onClick={fullscreen} aria-label="Fullscreen"><Maximize2 size={18} /></button></div>
    </header>

    <section className="hero">
      <div><span className="eyebrow">TREEHOUSE ARENA // PLAYER VS CPU</span><h1>TWO CHIMPIONS. ONE CANOPY.</h1><p>A side-view 3D fighting game built for your rigged GLB avatars with punch, kick, guard, hit reactions, rounds and adaptive CPU combat.</p></div>
      <button className="start-top" onClick={start}><Play size={17} fill="currentColor" />{s.state === 'match-over' ? 'REMATCH' : 'START FIGHT'}</button>
    </section>

    <section className="arena" id="arena">
      <div className="stage" ref={mount} />
      <div className="hud">
        <div><div className="fighter-name"><b>PLAYER 1</b><span>{s.m1 === 'glb' ? 'CUSTOM GLB' : 'FALLBACK RIG'}</span></div><Health value={s.p1} /><div className="pips"><i className={s.r1 > 0 ? 'won' : ''}/><i className={s.r1 > 1 ? 'won' : ''}/></div></div>
        <div className="timer"><small>ROUND</small><b>{s.timer}</b><span>BEST OF 3</span></div>
        <div><div className="fighter-name cpu"><b>CPU</b><span>{s.m2 === 'glb' ? 'CUSTOM GLB' : 'FALLBACK RIG'}</span></div><Health value={s.p2} right /><div className="pips cpu"><i className={s.r2 > 0 ? 'won' : ''}/><i className={s.r2 > 1 ? 'won' : ''}/></div></div>
      </div>
      <div className={'announce ' + (s.state === 'fighting' ? 'quiet' : '')}>{s.message}</div>
      <div className="keys"><span><kbd>A</kbd><kbd>D</kbd> MOVE</span><span><kbd>J</kbd> PUNCH</span><span><kbd>K</kbd> KICK</span><span><kbd>L</kbd> GUARD</span></div>

      <div className="touch-controls">
        <div><HoldButton label="◀" onChange={(v) => setInput('left', v)} /><HoldButton label="▶" onChange={(v) => setInput('right', v)} /></div>
        <div><HoldButton label="PUNCH" className="punch" onChange={(v) => setInput('punch', v)} /><HoldButton label="KICK" className="kick" onChange={(v) => setInput('kick', v)} /><HoldButton label="GUARD" className="guard" onChange={(v) => setInput('guard', v)} /></div>
      </div>

      {intro && s.message !== 'LOADING FIGHTERS…' && <div className="intro">
        <div className="intro-icon"><Gamepad2 /></div><span className="eyebrow">READY TO RUMBLE</span><h2>CANOPY CLASH</h2>
        <p>Close distance, mix punches and kicks, and hold guard when the CPU attacks. First fighter to win two rounds takes the match.</p>
        <div className="control-grid"><div><b>A / D</b><span>Move</span></div><div><b>J</b><span>Punch</span></div><div><b>K</b><span>Kick</span></div><div><b>L</b><span>Guard</span></div></div>
        <button onClick={start}><Swords size={18} />ENTER ARENA</button>
        {(s.m1 === 'fallback' || s.m2 === 'fallback') && <small className="model-note">Custom avatar files are expected at public/models/fighter-1.glb and public/models/fighter-2.glb.</small>}
      </div>}

      {s.state === 'match-over' && <div className="result"><span className="eyebrow">MATCH COMPLETE</span><h2>{s.message}</h2><strong>{s.r1} — {s.r2}</strong><button onClick={start}><RotateCcw size={17} />REMATCH</button></div>}
    </section>

    <section className="features">
      <div><Swords /><span><b>Responsive combat</b><small>Active hit windows, block reduction, knockback and impact effects.</small></span></div>
      <div><Shield /><span><b>Rig-aware avatars</b><small>Common GLB bone names drive attack and defense poses automatically.</small></span></div>
      <div><Gamepad2 /><span><b>Desktop + touch</b><small>Keyboard and mobile controls use the same combat input system.</small></span></div>
    </section>
    <footer>CANOPY CLASH // CHIMPIONS COMMUNITY PROTOTYPE</footer>
  </main>;
}
