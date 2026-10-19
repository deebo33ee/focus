import * as THREE from 'three';

const treeColors = {
  olive: [0x718e3e, 0x91aa53, 0x627b37],
  apple: [0x69a743, 0x87bd4e, 0xe95449],
  oak: [0x427e3c, 0x609547, 0x78a94c],
  pine: [0x236c4a, 0x31895a, 0x4c9b64],
  palm: [0x3b9a50, 0x65b957, 0x8acb63],
  bamboo: [0x75ad45, 0x9ac85a, 0x4b8b43],
  cherry: [0xe987aa, 0xf4afc5, 0xd96e96],
  maple: [0xc85830, 0xe8833b, 0xf0ad45],
  cypress: [0x246b50, 0x347f5d, 0x48936a],
  baobab: [0x79964c, 0x92ad60, 0x5f7d43],
  mangrove: [0x378565, 0x56a77a, 0x78bb83],
  redwood: [0x356d48, 0x4b8956, 0x6ca364],
};

function getTreeParts(type) {
  const colors = treeColors[type] || treeColors.oak;
  const part = (shape, x, y, z, sx, sy, sz, color, rx = 0, rz = 0) => ({
    shape, x, y, z, sx, sy, sz, color, rx, rz,
  });
  const round = (x, y, z, size, color) => part('sphere', x, y, z, size, size, size, color);
  const trunk = part('trunk', 0, 0.9, 0, 1, 1, 1, 0x815334);
  const cone = (y, size, color) => part('cone', 0, y, 0, size, size, size, color);
  switch (type) {
    case 'apple':
      return [trunk, round(-0.45, 2.75, 0, 1.5, colors[0]), round(0.45, 2.85, 0, 1.55, colors[1]),
        round(0, 3.65, 0, 1.45, colors[0]),
        part('fruit', -0.65, 2.72, 0.58, 0.19, 0.19, 0.19, colors[2])];
    case 'pine':
    case 'cypress':
    case 'redwood':
      return [trunk, cone(2.15, 1.5, colors[0]), cone(3.05, 1.22, colors[1]), cone(3.8, 0.92, colors[2])];
    case 'palm': {
      const parts = [part('palm-trunk', 0, 1.45, 0, 1, 1, 1, 0x9b7047)];
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        parts.push(part('palm-leaf', Math.cos(angle) * 0.8, 3.05, Math.sin(angle) * 0.8,
          0.7, 1.45, 0.7, colors[index % 2], Math.cos(angle) * 0.62, Math.sin(angle) * -0.62));
      }
      return parts;
    }
    case 'bamboo':
      return [
        part('bamboo-stem', -0.35, 1.8, 0, 0.75, 1, 0.75, colors[0]),
        part('bamboo-stem', 0.15, 1.8, 0.05, 0.75, 1, 0.75, colors[1]),
        part('bamboo-stem', 0.55, 1.65, -0.08, 0.75, 0.92, 0.75, colors[0]),
        part('bamboo-leaf', -0.5, 3.3, 0, 0.5, 0.75, 0.5, colors[2], 0, -0.8),
        part('bamboo-leaf', 0.45, 3.55, 0.05, 0.5, 0.8, 0.5, colors[1], 0, 0.8),
      ];
    case 'maple':
      return [trunk, part('crown', 0, 3.05, 0, 1.75, 1.3, 1.45, colors[0])];
    case 'baobab':
      return [part('baobab-trunk', 0, 1.15, 0, 1, 1, 1, 0x8d6944),
        round(-0.55, 3.2, 0, 1.25, colors[0]), round(0.48, 3.25, 0, 1.3, colors[1])];
    case 'mangrove':
      return [trunk, part('root', -0.55, 0.62, 0, 0.42, 1.2, 0.42, 0x8a6344, 0, -0.35),
        part('root', 0.55, 0.62, 0, 0.42, 1.2, 0.42, 0x8a6344, 0, 0.35),
        round(-0.42, 2.8, 0, 1.35, colors[0]), round(0.46, 2.85, 0, 1.4, colors[1])];
    case 'cherry':
      return [trunk, round(-0.4, 2.75, 0, 1.45, colors[0]),
        round(0.48, 2.8, 0.05, 1.45, colors[1]), round(0, 3.6, 0, 1.55, colors[2])];
    default:
      return [trunk, round(-0.48, 2.75, 0, 1.45, colors[0]),
        round(0.42, 3.05, 0, 1.55, colors[1]), round(0, 3.75, 0, 1.35, colors[2])];
  }
}

function getTreeGeometry(shape) {
  switch (shape) {
    case 'trunk': return new THREE.CylinderGeometry(0.19, 0.3, 1.8, 7);
    case 'fruit': return new THREE.SphereGeometry(0.5, 7, 6);
    case 'cone': return new THREE.ConeGeometry(1, 2, 8);
    case 'palm-trunk': return new THREE.CylinderGeometry(0.2, 0.28, 2.9, 7);
    case 'palm-leaf': return new THREE.ConeGeometry(0.32, 2.2, 5);
    case 'bamboo-stem': return new THREE.CylinderGeometry(0.15, 0.2, 2.9, 6);
    case 'bamboo-leaf': return new THREE.ConeGeometry(0.22, 1.5, 5);
    case 'crown': return new THREE.DodecahedronGeometry(1);
    case 'baobab-trunk': return new THREE.CylinderGeometry(0.48, 0.58, 2.3, 8);
    case 'root': return new THREE.CylinderGeometry(0.05, 0.22, 1.2, 5);
    default: return new THREE.SphereGeometry(1, 8, 7);
  }
}

// جزيرة وعشب متحرك، بينما تستقبل الأشجار من مخزون المزرعة.
// الاستخدام: const garden = createGarden3D(document.getElementById('garden-3d'));
// garden.dispose() لما تشيل العنصر.
export function createGarden3D(container, options = {}) {
  if (!container || !(container instanceof Element)) {
    return {
      setTreeInventory() {},
      dispose() {},
    };
  }

  const R = 11;
  const grassCount = options.grassCount ?? 5500;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0); // شفاف: يظهر لون خلفية الكارت
  renderer.shadowMap.enabled = true;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x2d5a2d, 1.6));
  const sun = new THREE.DirectionalLight(0xfff4d6, 2.2);
  sun.position.set(8, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, far: 40 });
  scene.add(sun);

  // الجزيرة
  const island = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.92, 1.2, 56), [
    new THREE.MeshStandardMaterial({ color: 0x5b3a21, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x2f8f3a }),
    new THREE.MeshStandardMaterial({ color: 0x3b2616 }),
  ]);
  island.position.y = -0.6;
  island.receiveShadow = true;
  scene.add(island);
  const treeRoot = new THREE.Group();
  scene.add(treeRoot);

  // العشب
  const blade = new THREE.ConeGeometry(0.05, 0.6, 3);
  blade.translate(0, 0.3, 0);
  const grassMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime;
      varying float vH;
      void main() {
        vH = position.y / 0.6;
        vec4 p = vec4(position, 1.0);
        float w = sin(uTime * 2.0 + instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5);
        p.x += w * 0.12 * vH;
        p.z += w * 0.06 * vH;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * p;
      }`,
    fragmentShader: `
      varying float vH;
      void main() {
        vec3 a = vec3(0.12, 0.42, 0.14);
        vec3 b = vec3(0.55, 0.9, 0.3);
        gl_FragColor = vec4(mix(a, b, vH), 1.0);
      }`,
  });
  const grass = new THREE.InstancedMesh(blade, grassMat, grassCount);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const s = new THREE.Vector3(), pos = new THREE.Vector3();
  for (let i = 0; i < grassCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (R - 0.4);
    pos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    e.set(0, Math.random() * Math.PI * 2, 0);
    q.setFromEuler(e);
    s.set(1, 0.6 + Math.random() * 1.1, 1);
    m.compose(pos, q, s);
    grass.setMatrixAt(i, m);
  }
  grass.frustumCulled = false;
  scene.add(grass);

  // تدوير الكاميرا بالسحب الأفقي (السحب الرأسي يفضل يعمل سكرول للصفحة)
  let theta = 0.6, phi = 1.0, dist = 21, dragging = false, pointerId = null;
  let lastX = 0, lastY = 0, idle = 0, visible = !container.hidden, raf = null;
  let inventorySignature = '';
  const onDown = (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    pointerId = ev.pointerId;
    lastX = ev.clientX;
    lastY = ev.clientY;
  };
  const onUp = (ev) => {
    if (pointerId !== ev.pointerId) return;
    pointerId = null;
    dragging = false;
    idle = 0;
    canvas.style.cursor = 'grab';
  };
  const onMove = (ev) => {
    if (pointerId !== ev.pointerId) return;
    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    if (!dragging && Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(dy)) {
      dragging = true;
      canvas.setPointerCapture(ev.pointerId);
      canvas.style.cursor = 'grabbing';
    }
    if (dragging) theta -= dx * 0.006;
    lastX = ev.clientX;
    lastY = ev.clientY;
  };
  const onWheel = (ev) => {
    ev.preventDefault();
    dist = Math.max(9, Math.min(60, dist + ev.deltaY * 0.02));
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // لا يرسم إلا لما العنصر ظاهر
  const start = () => {
    if (visible && !document.hidden && raf === null) raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  };
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && entry.intersectionRatio > 0;
    resize();
    if (visible) start();
    else stop();
  });
  io.observe(container);
  const onVisibilityChange = () => {
    if (document.hidden) stop();
    else start();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const clock = new THREE.Clock();
  const loop = () => {
    if (!visible || document.hidden) { raf = null; return; }
    raf = requestAnimationFrame(loop);
    const dt = clock.getDelta();
    grassMat.uniforms.uTime.value = clock.elapsedTime;
    if (!dragging) { idle += dt; if (idle > 1) theta += dt * 0.08; }
    camera.position.set(Math.sin(theta) * Math.sin(phi) * dist, Math.cos(phi) * dist, Math.cos(theta) * Math.sin(phi) * dist);
    camera.lookAt(0, 1.2, 0);
    renderer.render(scene, camera);
  };
  start();

  function setTreeInventory(inventory = {}) {
    const signature = JSON.stringify(inventory);
    if (signature === inventorySignature) return;
    inventorySignature = signature;
    treeRoot.children.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    treeRoot.clear();
    const trees = Object.keys(treeColors).flatMap((id) =>
      Array.from({ length: Math.max(0, Math.floor(Number(inventory[id] || 0))) }, () => id));
    const total = trees.length;
    const countLabel = container.querySelector('#garden-3d-count');
    if (countLabel) countLabel.textContent = `المزرعة فيها ${new Intl.NumberFormat('ar-EG').format(total)} شجرة`;
    const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
    const rows = Math.max(1, Math.ceil(total / columns));
    const spacing = 4.5;
    const radius = Math.max(R, Math.hypot((columns * spacing) / 2, (rows * spacing) / 2) + 4);
    island.scale.set(radius / R, 1, radius / R);
    grass.scale.set(radius / R, 1, radius / R);
    dist = Math.max(21, radius * 1.8);

    const batches = new Map();
    const dummy = new THREE.Object3D();
    trees.forEach((type, index) => {
      const x = (index % columns - (columns - 1) / 2) * spacing;
      const z = (Math.floor(index / columns) - (rows - 1) / 2) * spacing;
      getTreeParts(type).forEach((treePart, partIndex) => {
        const key = `${type}-${partIndex}`;
        let batch = batches.get(key);
        if (!batch) {
          batch = {
            geometry: getTreeGeometry(treePart.shape),
            material: new THREE.MeshStandardMaterial({ color: treePart.color, roughness: 0.9 }),
            matrices: [],
          };
          batches.set(key, batch);
        }
        dummy.position.set(x + treePart.x, treePart.y, z + treePart.z);
        dummy.rotation.set(treePart.rx, index * 0.7, treePart.rz);
        dummy.scale.set(treePart.sx, treePart.sy, treePart.sz);
        dummy.updateMatrix();
        batch.matrices.push(dummy.matrix.clone());
      });
    });
    batches.forEach(({ geometry, material, matrices }) => {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      treeRoot.add(mesh);
    });
    camera.position.set(
      Math.sin(theta) * Math.sin(phi) * dist,
      Math.cos(phi) * dist,
      Math.cos(theta) * Math.sin(phi) * dist,
    );
    camera.lookAt(0, 1.2, 0);
    renderer.render(scene, camera);
  }

  return {
    setTreeInventory,
    dispose() {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('wheel', onWheel);
      canvas.remove();
      treeRoot.children.forEach((mesh) => {
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      island.geometry.dispose();
      island.material.forEach((material) => material.dispose());
      renderer.dispose();
      blade.dispose();
      grassMat.dispose();
      grass.dispose();
    },
  };
}
