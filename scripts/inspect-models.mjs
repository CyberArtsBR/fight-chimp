import fs from 'node:fs';

function readGlbJson(path) {
  const data = fs.readFileSync(path);
  if (data.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${path}: invalid GLB magic`);
  let offset = 12;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    offset += 8;
    if (type === 0x4e4f534a) {
      const text = data.subarray(offset, offset + length).toString('utf8').replace(/\0+$/g, '').trim();
      return JSON.parse(text);
    }
    offset += length;
  }
  throw new Error(`${path}: JSON chunk not found`);
}

for (const path of ['public/models/fighter-1.glb', 'public/models/fighter-2.glb']) {
  const gltf = readGlbJson(path);
  const joints = new Set((gltf.skins ?? []).flatMap((skin) => skin.joints ?? []));
  const names = [...joints].map((index) => gltf.nodes?.[index]?.name ?? `#${index}`);
  const animations = (gltf.animations ?? []).map((animation, i) => animation.name || `animation-${i}`);
  console.log(`\n=== ${path} ===`);
  console.log(`nodes=${gltf.nodes?.length ?? 0} skins=${gltf.skins?.length ?? 0} joints=${names.length} animations=${animations.length}`);
  console.log('JOINTS:', names.join(' | '));
  console.log('ANIMATIONS:', animations.length ? animations.join(' | ') : '(none)');
}
