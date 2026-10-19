import * as THREE from 'three';

// جزيرة خضراء + عشب يتحرك مع الهوا. بدون أشجار وبدون أي واجهة.
// الاستخدام: const garden = createGarden3D(document.getElementById('garden-3d'));
// garden.dispose() لما تشيل العنصر.
export function createGarden3D(container, options = {}) {
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
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

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
  let theta = 0.6, dragging = false, lastX = 0, idle = 0;
  const phi = 1.0, dist = 21;
  const onDown = (ev) => { dragging = true; lastX = ev.clientX; canvas.setPointerCapture(ev.pointerId); canvas.style.cursor = 'grabbing'; };
  const onUp = () => { dragging = false; idle = 0; canvas.style.cursor = 'grab'; };
  const onMove = (ev) => { if (!dragging) return; theta -= (ev.clientX - lastX) * 0.006; lastX = ev.clientX; };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointermove', onMove);

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
  let visible = true, raf = 0;
  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  io.observe(container);

  const clock = new THREE.Clock();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!visible) return;
    const dt = clock.getDelta();
    grassMat.uniforms.uTime.value = clock.elapsedTime;
    if (!dragging) { idle += dt; if (idle > 1) theta += dt * 0.08; }
    camera.position.set(Math.sin(theta) * Math.sin(phi) * dist, Math.cos(phi) * dist, Math.cos(theta) * Math.sin(phi) * dist);
    camera.lookAt(0, 0.8, 0);
    renderer.render(scene, camera);
  };
  loop();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.remove();
      renderer.dispose();
      blade.dispose();
      grassMat.dispose();
      grass.dispose();
    },
  };
}
