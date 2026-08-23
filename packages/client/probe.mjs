import { readFileSync } from 'node:fs';
import { Box3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const buf = readFileSync('/tmp/claude-0/-home-user-CARDS/fc725c27-265a-5ba3-9b28-fc561d86be79/scratchpad/aegis-notex.glb');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

const gltf = await new Promise((res, rej) =>
  new GLTFLoader().parse(ab, '', res, rej));

const report = (label, obj) => {
  const b = new Box3().setFromObject(obj);
  console.log(`${label}: min.y=${b.min.y.toFixed(4)} max.y=${b.max.y.toFixed(4)} ` +
              `height=${(b.max.y - b.min.y).toFixed(4)} isEmpty=${b.isEmpty()}`);
  return b.max.y - b.min.y;
};

console.log('animations:', gltf.animations.map((a) => a.name).join(', '));
report('gltf.scene as loaded ', gltf.scene);
const c = skeletonClone(gltf.scene);
const h = report('SkeletonUtils.clone', c);
console.log(`\nscale the renderer would apply = 1 * 1.15 / ${h.toFixed(4)} = ${(1.15 / h).toFixed(4)}`);
console.log(`rendered height in tiles = ${(1.733 * (1.15 / h)).toFixed(2)}`);
