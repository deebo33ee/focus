import { createClient } from '@supabase/supabase-js';
import { PublicClientApplication } from '@azure/msal-browser';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import './style.css';

const STORAGE_KEY = 'jozoor-focus-garden-v1';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const MS_TODO_CLIENT_ID = import.meta.env.VITE_MS_TODO_CLIENT_ID;
const syncEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = syncEnabled ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const TREE_CATALOG = [
  { id: 'olive', name: 'زيتون', icon: '🫒', minutes: 30 },
  { id: 'apple', name: 'تفاح', icon: '🍎', minutes: 45 },
  { id: 'oak', name: 'بلوط', icon: '🌳', minutes: 60 },
  { id: 'pine', name: 'صنوبر', icon: '🌲', minutes: 90 },
  { id: 'palm', name: 'نخيل', icon: '🌴', minutes: 120 },
  { id: 'bamboo', name: 'بامبو', icon: '🎋', minutes: 150 },
  { id: 'cherry', name: 'كرز', icon: '🌸', minutes: 180 },
  { id: 'maple', name: 'قيقب', icon: '🍁', minutes: 240 },
  { id: 'cypress', name: 'سرو', icon: '🌲', minutes: 300 },
  { id: 'baobab', name: 'باوباب', icon: '🌳', minutes: 360 },
  { id: 'mangrove', name: 'مانجروف', icon: '🌿', minutes: 480 },
  { id: 'redwood', name: 'سيكويا', icon: '🌲', minutes: 600 },
];
const msalClient = MS_TODO_CLIENT_ID
  ? new PublicClientApplication({
    auth: {
      clientId: MS_TODO_CLIENT_ID,
      authority: 'https://login.microsoftonline.com/common',
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'localStorage' },
  })
  : null;
const MS_TODO_PENDING_KEY = `${STORAGE_KEY}-ms-todo-pending`;
let msalInitialization;

const freshState = () => ({
  displayName: 'صاحب المزرعة',
  privateFarm: { sessions: 0, totalSeconds: 0, tree_inventory: {}, tree_progress: {} },
  sharedFarm: null,
  members: [],
  shareFocus: false,
  settings: { focusMinutes: 25, breakMinutes: 5 },
  taskTargetMinutes: 60,
  selectedTree: 'oak',
  selectedTask: null,
  timer: {
    status: 'idle', phase: 'focus', durationSeconds: 1500, remainingSeconds: 1500,
    deadline: null, plan: null,
  },
});

function readState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored) return freshState();
    const defaults = freshState();
    const previousTimer = stored.timer || defaults.timer;
    const durationSeconds = previousTimer.durationSeconds || defaults.timer.durationSeconds;
    const savedFarm = { ...defaults.privateFarm, ...stored.privateFarm };
    if (!stored.privateFarm?.tree_inventory && savedFarm.sessions) {
      savedFarm.tree_inventory = { oak: savedFarm.sessions };
    }
    const savedSharedFarm = stored.sharedFarm
      ? { tree_inventory: {}, tree_progress: {}, ...stored.sharedFarm }
      : null;
    return {
      ...defaults,
      ...stored,
      settings: { ...defaults.settings, ...stored.settings },
      privateFarm: savedFarm,
      sharedFarm: savedSharedFarm,
      taskTargetMinutes: Math.min(1440, Math.max(1, Number(stored.taskTargetMinutes) || 60)),
      selectedTree: TREE_CATALOG.some((tree) => tree.id === stored.selectedTree) ? stored.selectedTree : 'oak',
      timer: {
        ...defaults.timer,
        ...previousTimer,
        durationSeconds,
        remainingSeconds: previousTimer.remainingSeconds ?? durationSeconds,
        phase: previousTimer.phase || 'focus',
        plan: previousTimer.plan || null,
      },
    };
  } catch (error) {
    console.error('Unable to read saved garden data.', error);
    return freshState();
  }
}

let state = readState();
let userId = null;
let ticking = null;
let toastTimer = null;
let realtimeChannel = null;
let realtimeFarmId = null;
let onlineReady = Promise.resolve();

// Three.js 3D garden state
let threeInitialized = false;
let threeScene = null;
let threeCamera = null;
let threeRenderer = null;
let threeControls = null;
let threeAnimationId = null;
let threeRoot = null;
let threeGround = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const dom = {
  timerDisplay: $('#timer-display'),
  timerToggle: $('#timer-toggle'),
  timerHint: $('#timer-hint'),
  timerMode: $('#timer-mode-label'),
  timerCaption: $('#timer-caption'),
  timerOrbit: $('#timer-orbit'),
  toast: $('#toast'),
  nameDialog: $('#name-dialog'),
  joinDialog: $('#join-dialog'),
};

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Unable to save garden data.', error);
    showToast('تعذر حفظ التغييرات على هذا الجهاز.');
  }
}

function showToast(message, isError = false) {
  dom.toast.textContent = message;
  dom.toast.classList.toggle('error', isError);
  dom.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('visible'), 3300);
}

function formatArabicNumber(value) {
  return new Intl.NumberFormat('ar-EG').format(value);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function formatFocusTime(totalSeconds) {
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (!totalMinutes) return '٠ د';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${formatArabicNumber(hours)} س ${formatArabicNumber(minutes)} د`;
  if (hours) return `${formatArabicNumber(hours)} س`;
  return `${formatArabicNumber(totalMinutes)} د`;
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function setIntegrationStatus(selector, message, connected = false, error = false) {
  const element = $(selector);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('is-connected', connected);
  element.classList.toggle('is-error', error);
}

function sumTrees(inventory = {}) {
  return Object.values(inventory).reduce((total, count) => total + Number(count || 0), 0);
}

function selectedTree() {
  return TREE_CATALOG.find((tree) => tree.id === state.selectedTree) || TREE_CATALOG[2];
}

function treeIllustration(tree, sapling = false) {
  if (sapling) {
    return '<svg viewBox="0 0 72 84" aria-hidden="true"><ellipse cx="36" cy="77" rx="18" ry="4" fill="#71934b" opacity=".22"/><path d="M36 75V48" stroke="#8a5d38" stroke-width="5" stroke-linecap="round"/><path d="M36 57C25 56 20 48 20 40c10 0 16 5 16 13Zm0-8c2-11 9-17 19-18 0 11-6 19-19 21Z" fill="#69a954"/><path d="M36 74h12" stroke="#9c7048" stroke-width="2" stroke-linecap="round"/></svg>';
  }

  const svgStart = '<svg viewBox="0 0 72 84" aria-hidden="true">';
  const ground = '<ellipse cx="36" cy="77" rx="21" ry="4" fill="#52783e" opacity=".2"/>';
  const trunk = '<path d="M33 75c2-13 1-25 3-37h5c-1 15-1 25 3 37Z" fill="#8b5a37"/><path d="M37 48l-9-9m12 5 8-10" fill="none" stroke="#8b5a37" stroke-width="3" stroke-linecap="round"/>';
  const palette = {
    olive: ['#83ad4e', '#5f8b3c', '#b9ce70'],
    apple: ['#83c84f', '#55a842', '#ef6c59'],
    oak: ['#70aa4d', '#4c8d3d', '#8ec96b'],
    pine: ['#4da66a', '#287e55', '#78c48a'],
    palm: ['#78c86e', '#3f9b57', '#b6dc6b'],
    bamboo: ['#88c957', '#4c9c48', '#b4d976'],
    cherry: ['#f4a1bd', '#df6f9b', '#ffe1e9'],
    maple: ['#f39c48', '#d96b37', '#ffd16b'],
    cypress: ['#60a879', '#347c5d', '#9ad091'],
    baobab: ['#91bc68', '#638f4d', '#c5d985'],
    mangrove: ['#67bd87', '#38956e', '#a4d899'],
    redwood: ['#5caa72', '#327653', '#91c886'],
  }[tree.id] || ['#78b95b', '#4f9144', '#a5ce78'];

  let canopy;
  if (tree.id === 'palm') {
    canopy = `<path d="M38 39C19 37 14 28 12 20c12 0 22 6 27 17C31 22 34 12 41 7c7 9 7 20 2 31 8-13 17-17 27-16-3 11-12 18-27 20" fill="none" stroke="${palette[1]}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M38 39C25 24 22 16 22 12m20 26c9-14 15-18 21-20" fill="none" stroke="${palette[0]}" stroke-width="3" stroke-linecap="round"/><circle cx="34" cy="43" r="3" fill="#f2ad46"/><circle cx="41" cy="44" r="3" fill="#dc8142"/>`;
  } else if (tree.id === 'bamboo') {
    canopy = `<path d="M29 74V25m11 50V12m11 62V29" stroke="${palette[1]}" stroke-width="5" stroke-linecap="round"/><path d="M25 41h8m3-12h9m-8 25h9m-20-1h8m13-5h8" stroke="#d4ed9c" stroke-width="2"/><path d="M28 30c-9-4-13-10-13-17 9 2 14 7 15 16m11-9C44 10 51 6 60 7c-2 8-7 13-16 15m-5 22c-8-7-9-13-7-20 8 4 11 10 9 20m8-6c5-9 11-12 19-11-3 8-8 12-17 14" fill="${palette[0]}"/>`;
  } else if (['pine', 'cypress', 'redwood'].includes(tree.id)) {
    canopy = `<path d="M39 7 17 38h12L13 55h19L20 69h38L45 55h17L48 38h12Z" fill="${palette[1]}"/><path d="m39 13-16 24h11L19 52h14L25 65h25L40 52h13L42 37h10Z" fill="${palette[0]}"/>`;
  } else if (tree.id === 'maple') {
    canopy = `<path d="m39 7 6 13 12-7-2 15 13 4-12 9 7 11-15-1-4 14-9-11-11 8 1-15-14-4 12-9-7-12 15 2Z" fill="${palette[0]}"/><path d="m39 17 1 38m0-19-13-8m14 14 13-10" fill="none" stroke="${palette[1]}" stroke-width="2" stroke-linecap="round"/>`;
  } else {
    canopy = `<circle cx="27" cy="36" r="15" fill="${palette[1]}"/><circle cx="43" cy="29" r="17" fill="${palette[0]}"/><circle cx="52" cy="43" r="13" fill="${palette[1]}"/><circle cx="33" cy="49" r="15" fill="${palette[0]}"/><circle cx="43" cy="39" r="13" fill="${palette[2]}" opacity=".75"/>`;
    if (tree.id === 'cherry') {
      canopy += '<g fill="#fff3f5"><circle cx="27" cy="33" r="2.5"/><circle cx="42" cy="25" r="2.5"/><circle cx="53" cy="42" r="2.5"/><circle cx="34" cy="48" r="2.5"/><circle cx="47" cy="38" r="2.5"/></g>';
    } else if (tree.id === 'apple' || tree.id === 'olive') {
      canopy += `<circle cx="28" cy="43" r="3" fill="${tree.id === 'apple' ? '#f15b4a' : '#d4a83f'}"/><circle cx="48" cy="32" r="3" fill="${tree.id === 'apple' ? '#f15b4a' : '#d4a83f'}"/>`;
    }
  }

  return `${svgStart}${ground}${trunk}${canopy}</svg>`;
}

function drawTrees(container, inventory = {}) {
  if (!container) return;
  container.replaceChildren();
  const planted = TREE_CATALOG.flatMap((tree) =>
    Array.from({ length: Math.min(Number(inventory[tree.id] || 0), 18) }, () => tree));
  if (!planted.length) {
    const sapling = document.createElement('span');
    sapling.className = 'tree sapling';
    sapling.innerHTML = treeIllustration(null, true);
    sapling.setAttribute('aria-hidden', 'true');
    container.append(sapling);
    return;
  }
  const visibleCount = Math.min(planted.length, 18);
  for (let index = 0; index < visibleCount; index += 1) {
    const tree = document.createElement('span');
    tree.className = `tree tree-${index % 4}`;
    tree.innerHTML = treeIllustration(planted[index]);
    tree.title = planted[index].name;
    tree.style.setProperty('--tree-index', index);
    tree.setAttribute('aria-hidden', 'true');
    container.append(tree);
  }
  const count = sumTrees(inventory);
  if (count > visibleCount) {
    const extra = document.createElement('span');
    extra.className = 'tree-extra';
    extra.textContent = `+${formatArabicNumber(count - visibleCount)}`;
    container.append(extra);
  }
}

/* 3D garden using Three.js */
function init3DGarden(container) {
  if (!container) return;
  if (threeInitialized) return;
  threeInitialized = true;
  const width = container.clientWidth || container.offsetWidth || 800;
  const height = container.clientHeight || container.offsetHeight || 400;
  threeScene = new THREE.Scene();
  threeScene.fog = new THREE.FogExp2(0xe0f3df, 0.00035);
  threeCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 5000);
  threeCamera.position.set(0, 18, 28);
  threeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  threeRenderer.setSize(width, height);
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(threeRenderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x88aa88, 0.95);
  threeScene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff3d9, 0.9);
  dir.position.set(10, 20, 10);
  threeScene.add(dir);

  threeGround = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshLambertMaterial({ color: 0x9fd07a }),
  );
  threeGround.rotation.x = -Math.PI / 2;
  threeGround.position.y = -0.03;
  threeScene.add(threeGround);

  // root group for trees
  threeRoot = new THREE.Group();
  threeScene.add(threeRoot);

  // controls
  threeControls = new OrbitControls(threeCamera, threeRenderer.domElement);
  threeControls.target.set(0, 3, 0);
  threeControls.enableDamping = true;
  threeControls.minDistance = 6;
  threeControls.maxDistance = 5000;
  threeControls.maxPolarAngle = Math.PI / 2 - 0.1;

  window.addEventListener('resize', onResize3D);
  update3DGarden();
  animate3D();
}

function treeModel(typeKey) {
  const part = (shape, x, y, z, sx, sy, sz, color, rx = 0, rz = 0) => ({
    shape, x, y, z, sx, sy, sz, color, rx, rz,
  });
  const trunk = part('trunk', 0, 0.9, 0, 1, 1, 1, 0x815334);
  const round = (x, y, z, size, color) => part('round', x, y, z, size, size, size, color);
  const conifer = (y, size, color) => part('cone', 0, y, 0, size, size, size, color);
  const colors = {
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
  }[typeKey] || [0x427e3c, 0x609547, 0x78a94c];
  const leaf = (x, y, z, size, color = colors[0]) => round(x, y, z, size, color);

  switch (typeKey) {
    case 'olive':
      return [
        part('trunk', 0, 0.9, 0, 1, 1, 1, 0x795235),
        leaf(-0.48, 2.75, 0, 1.45, colors[0]), leaf(0.42, 3.05, 0, 1.55, colors[1]),
        leaf(0, 3.75, 0, 1.35, colors[0]), leaf(0.65, 2.55, 0.15, 1.05, colors[2]),
      ];
    case 'apple':
      return [
        trunk, leaf(-0.45, 2.75, 0, 1.5, colors[0]), leaf(0.45, 2.85, 0, 1.55, colors[1]),
        leaf(0, 3.65, 0, 1.45, colors[0]),
        part('fruit', -0.65, 2.72, 0.58, 0.19, 0.19, 0.19, colors[2]),
        part('fruit', 0.5, 3.25, 0.52, 0.18, 0.18, 0.18, colors[2]),
        part('fruit', 0.1, 2.45, -0.63, 0.18, 0.18, 0.18, colors[2]),
      ];
    case 'oak':
      return [
        trunk, leaf(-0.55, 2.7, 0, 1.65, colors[0]), leaf(0.5, 2.75, 0.05, 1.65, colors[1]),
        leaf(0, 3.55, 0, 1.8, colors[0]), leaf(0, 2.65, -0.55, 1.35, colors[2]),
      ];
    case 'pine':
      return [trunk, conifer(2.15, 1.5, colors[0]), conifer(3.05, 1.22, colors[1]), conifer(3.8, 0.92, colors[2])];
    case 'palm': {
      const parts = [part('palm-trunk', 0, 1.45, 0, 1, 1, 1, 0x9b7047)];
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        parts.push(part(
          'palm-leaf',
          Math.cos(angle) * 0.8,
          3.05 - (index % 2) * 0.18,
          Math.sin(angle) * 0.8,
          0.7, 1.45, 0.7, index % 2 ? colors[0] : colors[1],
          Math.cos(angle) * 0.62,
          Math.sin(angle) * -0.62,
        ));
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
        part('bamboo-leaf', 0.1, 2.95, -0.2, 0.5, 0.7, 0.5, colors[2], 0, 0.65),
      ];
    case 'cherry':
      return [
        trunk, leaf(-0.4, 2.75, 0, 1.45, colors[0]), leaf(0.48, 2.8, 0.05, 1.45, colors[1]),
        leaf(0, 3.6, 0, 1.55, colors[0]), leaf(0, 2.55, -0.45, 1.2, colors[2]),
      ];
    case 'maple':
      return [trunk, part('maple-crown', 0, 3.05, 0, 1.75, 1.3, 1.45, colors[0])];
    case 'cypress':
      return [trunk, conifer(2.45, 1.15, colors[0]), conifer(3.25, 0.92, colors[1]), conifer(4, 0.7, colors[2])];
    case 'baobab':
      return [
        part('baobab-trunk', 0, 1.15, 0, 1, 1, 1, 0x8d6944),
        leaf(-0.55, 3.2, 0, 1.25, colors[0]), leaf(0.48, 3.25, 0, 1.3, colors[1]),
        leaf(0, 3.75, 0, 1.18, colors[2]),
      ];
    case 'mangrove':
      return [
        trunk,
        part('root', -0.55, 0.62, 0, 0.42, 1.2, 0.42, 0x8a6344, 0, -0.35),
        part('root', 0.55, 0.62, 0, 0.42, 1.2, 0.42, 0x8a6344, 0, 0.35),
        part('root', 0, 0.62, -0.52, 0.42, 1.2, 0.42, 0x8a6344, 0.35),
        leaf(-0.42, 2.8, 0, 1.35, colors[0]), leaf(0.46, 2.85, 0, 1.4, colors[1]),
        leaf(0, 3.55, 0, 1.3, colors[2]),
      ];
    case 'redwood':
      return [
        part('redwood-trunk', 0, 1.8, 0, 1, 1, 1, 0x81573d),
        conifer(3.45, 1.18, colors[0]), conifer(4.15, 0.93, colors[1]), conifer(4.8, 0.7, colors[2]),
      ];
    default:
      return [trunk, round(0, 3, 0, 1.5, colors[0])];
  }
}

function treePartGeometry(shape) {
  switch (shape) {
    case 'trunk': return new THREE.CylinderGeometry(0.19, 0.3, 1.8, 7);
    case 'fruit': return new THREE.SphereGeometry(0.5, 7, 6);
    case 'cone': return new THREE.ConeGeometry(1, 2, 8);
    case 'palm-trunk': return new THREE.CylinderGeometry(0.2, 0.28, 2.9, 7);
    case 'palm-leaf': return new THREE.ConeGeometry(0.32, 2.2, 5);
    case 'bamboo-stem': return new THREE.CylinderGeometry(0.15, 0.2, 2.9, 6);
    case 'bamboo-leaf': return new THREE.ConeGeometry(0.22, 1.5, 5);
    case 'maple-crown': return new THREE.DodecahedronGeometry(1);
    case 'baobab-trunk': return new THREE.CylinderGeometry(0.48, 0.58, 2.3, 8);
    case 'root': return new THREE.CylinderGeometry(0.05, 0.22, 1.2, 5);
    case 'redwood-trunk': return new THREE.CylinderGeometry(0.38, 0.48, 3.6, 8);
    default: return new THREE.SphereGeometry(1, 8, 7);
  }
}

function update3DGarden() {
  if (!threeInitialized || !threeRoot) return;
  threeRoot.children.forEach((mesh) => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  threeRoot.clear();
  const inventory = state.privateFarm.tree_inventory || {};
  const trees = TREE_CATALOG.flatMap((tree) =>
    Array.from({ length: Math.max(0, Math.floor(Number(inventory[tree.id] || 0))) }, () => tree));
  const total = trees.length;
  const spacing = 4.5;
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / columns));
  const width = columns * spacing;
  const depth = rows * spacing;
  if (threeGround) threeGround.scale.set(width + 12, depth + 12, 1);
  setText('#garden-3d-count', `المزرعة فيها ${formatArabicNumber(total)} شجرة`);

  if (!total) {
    threeControls.target.set(0, 1.5, 0);
    threeCamera.position.set(0, 14, 24);
    threeControls.update();
    return;
  }

  const batches = new Map();
  const dummy = new THREE.Object3D();
  const treeIndices = new Map();
  const models = new Map(TREE_CATALOG.map((tree) => [tree.id, treeModel(tree.id)]));
  trees.forEach((tree, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = (col - (columns - 1) / 2) * spacing;
    const z = (row - (rows - 1) / 2) * spacing;
    const sameTypeIndex = treeIndices.get(tree.id) || 0;
    treeIndices.set(tree.id, sameTypeIndex + 1);
    const variation = 0.88 + ((sameTypeIndex * 37 + tree.id.length * 13) % 25) / 100;
    const rotation = ((sameTypeIndex * 137 + tree.id.length * 17) % 360) * (Math.PI / 180);

    models.get(tree.id).forEach((treePart, partIndex) => {
      const key = `${tree.id}-${partIndex}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = {
          geometry: treePartGeometry(treePart.shape),
          material: new THREE.MeshStandardMaterial({ color: treePart.color, roughness: 0.9 }),
          parts: [],
        };
        batches.set(key, batch);
      }
      const localX = treePart.x * variation;
      const localZ = treePart.z * variation;
      const rotatedX = localX * Math.cos(rotation) - localZ * Math.sin(rotation);
      const rotatedZ = localX * Math.sin(rotation) + localZ * Math.cos(rotation);
      dummy.position.set(x + rotatedX, treePart.y * variation, z + rotatedZ);
      dummy.rotation.set(treePart.rx, rotation, treePart.rz);
      dummy.scale.set(
        treePart.sx * variation,
        treePart.sy * variation,
        treePart.sz * variation,
      );
      dummy.updateMatrix();
      batch.parts.push(dummy.matrix.clone());
    });
  });

  batches.forEach(({ geometry, material, parts }) => {
    const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
    parts.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    threeRoot.add(mesh);
  });

  const span = Math.max(width, depth);
  const distance = Math.max(22, span * Math.max(1.35, 1.4 / threeCamera.aspect));
  threeControls.target.set(0, 2, 0);
  threeCamera.position.set(distance * 0.48, distance * 0.7, distance);
  threeCamera.far = Math.max(5000, distance * 10);
  threeCamera.updateProjectionMatrix();
  threeControls.maxDistance = Math.max(5000, distance * 3);
  threeControls.update();
}

function animate3D() {
  threeAnimationId = requestAnimationFrame(animate3D);
  if (threeControls) threeControls.update();
  if (threeRenderer && threeScene && threeCamera) threeRenderer.render(threeScene, threeCamera);
}

function onResize3D() {
  if (!threeRenderer || !threeCamera) return;
  const container = threeRenderer.domElement.parentElement;
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  threeCamera.aspect = w / h;
  threeCamera.updateProjectionMatrix();
  threeRenderer.setSize(w, h);
}

function dispose3D() {
  if (!threeInitialized) return;
  cancelAnimationFrame(threeAnimationId);
  window.removeEventListener('resize', onResize3D);
  if (threeRenderer && threeRenderer.domElement && threeRenderer.domElement.parentElement) {
    threeRenderer.domElement.parentElement.removeChild(threeRenderer.domElement);
  }
  threeScene = threeCamera = threeRenderer = threeControls = threeRoot = null;
  threeInitialized = false;
}

function render() {
  const personal = state.privateFarm;
  const shared = state.sharedFarm;
  const treeCount = sumTrees(personal.tree_inventory);
  const sharedTreeCount = sumTrees(shared?.tree_inventory);
  setText('#profile-name', state.displayName);
  setText('#profile-avatar', [...state.displayName][0] || 'ج');
  setText('#greeting-name', state.displayName === 'صاحب المزرعة' ? 'يا بطل' : state.displayName);
  setText('#streak-value', formatArabicNumber(treeCount));
  setText('#personal-tree-count', formatArabicNumber(treeCount));
  setText('#personal-focus-time', formatFocusTime(personal.totalSeconds || 0));
  setText('#personal-session-count', formatArabicNumber(personal.sessions || 0));
  setText('#shared-tree-count', formatArabicNumber(sharedTreeCount));
  setText('#shared-focus-time', formatFocusTime(shared?.total_seconds || 0));
  setText('#shared-farm-name', shared?.name || 'مزرعة الصحاب');
  setText('#shared-member-count', `${formatArabicNumber(state.members.length || (shared ? 1 : 0))} أصدقاء`);
  setText('#connection-status', syncEnabled ? 'متصل · مزامنة مباشرة' : 'وضع تجريبي · محلي');
  setText('#nav-friends', formatArabicNumber(Math.max(state.members.length, shared ? 1 : 0)));
  drawTrees($('#personal-trees'), personal.tree_inventory);
  drawTrees($('#personal-trees-full'), personal.tree_inventory);
  drawTrees($('#shared-trees'), shared?.tree_inventory);

  const avatars = $('#friend-avatars');
  avatars.replaceChildren();
  state.members.slice(0, 4).forEach((member, index) => {
    const avatar = document.createElement('span');
    avatar.className = `friend-avatar avatar-color-${index % 4}`;
    avatar.textContent = [...(member.display_name || 'ص')][0];
    avatar.title = member.display_name || 'صديق';
    avatars.append(avatar);
  });
  if (shared && state.members.length < 3) {
    const invite = document.createElement('button');
    invite.className = 'friend-avatar invite-avatar';
    invite.textContent = '+';
    invite.title = 'ادعُ صديقًا';
    invite.addEventListener('click', shareInvite);
    avatars.append(invite);
  }
  $('#invite-empty').classList.toggle('visible', !shared);
  $('#share-focus-toggle').checked = Boolean(state.shareFocus && shared);
  $('#share-focus-toggle').disabled = !shared;
  if (document.activeElement !== $('#setting-focus-minutes')) $('#setting-focus-minutes').value = state.settings.focusMinutes;
  if (document.activeElement !== $('#setting-break-minutes')) $('#setting-break-minutes').value = state.settings.breakMinutes;
  if (document.activeElement !== $('#task-minutes')) $('#task-minutes').value = state.taskTargetMinutes;
  renderTreeCatalog();
  renderTaskPlan();
  renderDetailStats();
  renderTimer();
  if (threeInitialized) update3DGarden();
  saveState();
}

function renderDetailStats() {
  const target = $('#personal-detail-stats');
  target.replaceChildren();
  [
    ['♧', formatArabicNumber(sumTrees(state.privateFarm.tree_inventory)), 'شجرة نمت'],
    ['◷', formatFocusTime(state.privateFarm.totalSeconds || 0), 'وقت ركّزت فيه'],
    ['✳', formatArabicNumber(state.privateFarm.sessions || 0), 'جلسة مكتملة'],
  ].forEach(([icon, value, label]) => {
    const card = document.createElement('div');
    card.className = 'detail-stat';
    card.innerHTML = `<span class="detail-stat-icon">${icon}</span><strong>${value}</strong><small>${label}</small>`;
    target.append(card);
  });
}

function renderTreeCatalog() {
  const catalog = $('#tree-catalog');
  catalog.replaceChildren();
  const tree = selectedTree();
  const progress = Number(state.privateFarm.tree_progress?.[tree.id] || 0);
  const progressPercent = Math.min(100, (progress / (tree.minutes * 60)) * 100);
  TREE_CATALOG.forEach((entry) => {
    const count = Number(state.privateFarm.tree_inventory?.[entry.id] || 0);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tree-choice${entry.id === state.selectedTree ? ' selected' : ''}`;
    button.dataset.tree = entry.id;
    button.setAttribute('aria-pressed', String(entry.id === state.selectedTree));
    button.innerHTML = `<span class="tree-choice-icon">${treeIllustration(entry)}</span><strong>${entry.name}</strong><small>${formatArabicNumber(entry.minutes)} دقيقة تركيز</small><span class="tree-choice-count">${formatArabicNumber(count)} مزروعة</span>`;
    button.addEventListener('click', () => {
      state.selectedTree = entry.id;
      saveState();
      render();
    });
    catalog.append(button);
  });
  setText('#selected-tree-progress', `تقدم ${tree.name}: ${formatArabicNumber(Math.floor(progressPercent))}٪`);
  const progressBar = $('#selected-tree-progress-bar');
  if (progressBar) progressBar.style.width = `${progressPercent}%`;
}

function renderTaskPlan() {
  const requestedSeconds = Math.max(60, state.taskTargetMinutes * 60);
  const focusSeconds = state.settings.focusMinutes * 60;
  const sessions = Math.ceil(requestedSeconds / focusSeconds);
  const breaks = Math.max(0, sessions - 1);
  const totalElapsed = requestedSeconds + breaks * state.settings.breakMinutes * 60;
  const sessionLabel = sessions === 1 ? 'جلسة واحدة' : sessions === 2 ? 'جلستين' : `${formatArabicNumber(sessions)} جلسات`;
  const breakLabel = breaks === 0 ? 'من غير استراحة' : breaks === 1 ? 'استراحة واحدة' : breaks === 2 ? 'استراحتين' : `${formatArabicNumber(breaks)} استراحات`;
  const plan = `${formatArabicNumber(state.taskTargetMinutes)} د تركيز = ${sessionLabel} + ${breakLabel} · إجمالي ${formatFocusTime(totalElapsed)}`;
  const lastSessionSeconds = requestedSeconds - (sessions - 1) * focusSeconds;
  setText('#plan-summary', plan);
  setText('#selected-task-title', state.selectedTask ? `المهمة: ${state.selectedTask.title}` : 'اكتب وقت المهمة، وسيقسّمه جذور لجلسات واستراحات.');
  setText('#settings-plan-preview', `مهمة ${formatArabicNumber(state.taskTargetMinutes)} دقيقة على ${sessionLabel} للتركيز، مع ${breakLabel}. الجلسة الأخيرة ${formatArabicNumber(Math.ceil(lastSessionSeconds / 60))} دقيقة.`);
}

function renderTimer() {
  const seconds = state.timer.status === 'running' && state.timer.deadline
    ? Math.max(0, Math.ceil((state.timer.deadline - Date.now()) / 1000))
    : state.timer.remainingSeconds;
  dom.timerDisplay.textContent = formatTime(seconds);
  dom.timerOrbit.style.setProperty('--timer-progress', `${100 - (seconds / state.timer.durationSeconds) * 100}%`);
  dom.timerOrbit.classList.toggle('is-running', state.timer.status === 'running');
  const isBreak = state.timer.phase === 'break';
  dom.timerMode.textContent = isBreak ? 'وقت الراحة' : 'وقت التركيز';
  dom.timerCaption.textContent = state.timer.status === 'running'
    ? (isBreak ? 'ابعد عن الشاشة وخد نفس' : 'على مهلك.. أنت بتعمل كويس')
    : 'كل حاجة بتبدأ بخطوة';
  const actionText = state.timer.status === 'running'
    ? 'وقّف مؤقتًا'
    : state.timer.status === 'paused' ? 'كمّل التركيز' : 'ابدأ التركيز';
  dom.timerToggle.innerHTML = `<span class="action-icon">${state.timer.status === 'running' ? 'Ⅱ' : '▶'}</span><span>${actionText}</span>`;
  const plan = state.timer.plan;
  const currentFocusSeconds = state.timer.phase === 'focus' && state.timer.status !== 'idle'
    ? state.timer.durationSeconds - seconds
    : 0;
  const completed = (plan?.focusedSeconds || 0) + currentFocusSeconds;
  dom.timerHint.textContent = state.timer.status === 'paused'
    ? 'المؤقت متوقف.. كمّل وقت ما تحب'
    : plan ? `${formatArabicNumber(Math.floor(completed / 60))} من ${formatArabicNumber(state.taskTargetMinutes)} دقيقة تركيز` : 'تقدر توقف وتكمل في أي وقت';
  $('#timer-skip').hidden = !isBreak || state.timer.status === 'idle';
  $('#timer-skip').disabled = state.timer.status === 'paused';
  $('#task-minutes').disabled = state.timer.status !== 'idle';
  $('#calculate-plan').disabled = state.timer.status !== 'idle';
}

function switchPage(pageName) {
  $$('.page-view').forEach((page) => page.classList.toggle('active', page.id === `page-${pageName}`));
  $$('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === pageName));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function saveTimer() {
  saveState();
}

function beginPhase(phase, durationSeconds, autoStart = true) {
  state.timer.phase = phase;
  state.timer.durationSeconds = durationSeconds;
  state.timer.remainingSeconds = durationSeconds;
  state.timer.status = autoStart ? 'running' : 'idle';
  state.timer.deadline = autoStart ? Date.now() + durationSeconds * 1000 : null;
  clearInterval(ticking);
  ticking = autoStart ? setInterval(tick, 250) : null;
  saveTimer();
  renderTimer();
}

function beginFocusBlock(autoStart = true) {
  if (!state.timer.plan) {
    state.timer.plan = {
      targetSeconds: state.taskTargetMinutes * 60,
      focusedSeconds: 0,
      completedFocusSessions: 0,
    };
  }
  const remainingTaskSeconds = state.timer.plan.targetSeconds - state.timer.plan.focusedSeconds;
  if (remainingTaskSeconds <= 0) {
    finishTaskPlan();
    return;
  }
  const seconds = Math.min(state.settings.focusMinutes * 60, remainingTaskSeconds);
  beginPhase('focus', seconds, autoStart);
}

function startTimer() {
  if (state.timer.status === 'running') {
    state.timer.remainingSeconds = Math.max(0, Math.ceil((state.timer.deadline - Date.now()) / 1000));
    state.timer.status = 'paused';
    state.timer.deadline = null;
    clearInterval(ticking);
    ticking = null;
  } else if (state.timer.status === 'paused') {
    state.timer.status = 'running';
    state.timer.deadline = Date.now() + state.timer.remainingSeconds * 1000;
    ticking = setInterval(tick, 250);
  } else {
    beginFocusBlock();
    return;
  }
  saveTimer();
  renderTimer();
}

function resetTimer() {
  clearInterval(ticking);
  ticking = null;
  state.timer = {
    status: 'idle',
    phase: 'focus',
    durationSeconds: state.settings.focusMinutes * 60,
    remainingSeconds: state.settings.focusMinutes * 60,
    deadline: null,
    plan: null,
  };
  saveTimer();
  renderTimer();
}

function tick() {
  const remaining = Math.max(0, Math.ceil((state.timer.deadline - Date.now()) / 1000));
  dom.timerDisplay.textContent = formatTime(remaining);
  dom.timerOrbit.style.setProperty('--timer-progress', `${100 - (remaining / state.timer.durationSeconds) * 100}%`);
  if (remaining <= 0) {
    clearInterval(ticking);
    ticking = null;
    state.timer.remainingSeconds = 0;
    state.timer.deadline = null;
    void completePhase();
  }
}

async function completePhase() {
  if (state.timer.phase === 'break') {
    beginFocusBlock();
    return;
  }
  if (!state.timer.plan) {
    state.timer.plan = {
      targetSeconds: state.timer.durationSeconds,
      focusedSeconds: 0,
      completedFocusSessions: 0,
    };
  }
  const durationSeconds = state.timer.durationSeconds;
  state.timer.plan.focusedSeconds += durationSeconds;
  state.timer.plan.completedFocusSessions += 1;
  const recordResult = await recordCompletedFocus(durationSeconds);
  if (recordResult === 'save-error') state.timer.plan.recordingFailed = true;
  if (recordResult === 'refresh-error') state.timer.plan.refreshFailed = true;
  if (state.timer.plan.focusedSeconds >= state.timer.plan.targetSeconds) {
    finishTaskPlan();
    return;
  }
  beginPhase('break', state.settings.breakMinutes * 60);
  if (recordResult === 'saved') showToast('جلسة خلصت! وقت استراحة قصيرة 🌿');
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('وقت الاستراحة', { body: 'جلسة تركيز مكتملة. خد استراحة قصيرة 🌿' });
  }
}

function finishTaskPlan() {
  const recordingFailed = Boolean(state.timer.plan?.recordingFailed);
  const refreshFailed = Boolean(state.timer.plan?.refreshFailed);
  clearInterval(ticking);
  ticking = null;
  state.timer.status = 'idle';
  state.timer.phase = 'focus';
  state.timer.durationSeconds = state.settings.focusMinutes * 60;
  state.timer.remainingSeconds = state.timer.durationSeconds;
  state.timer.deadline = null;
  state.timer.plan = null;
  saveTimer();
  render();
  showToast(
    recordingFailed
      ? 'خلص وقت المهمة، لكن تعذر حفظ جلسة أو أكثر. راجع الاتصال قبل ما تعتمد على المزامنة.'
      : refreshFailed
        ? 'خلص وقت المهمة والجلسات اتحفظت، لكن تعذر تحديث عرض المزرعة. أعد تحميل الصفحة.'
        : 'برافو! خلصت وقت المهمة المخطط له 🌱',
    recordingFailed || refreshFailed,
  );
  if (!recordingFailed && state.selectedTask?.completeOnFinish) {
    void completeMicrosoftTask(state.selectedTask);
  }
}

function addLocalFocus(farm, seconds, tree) {
  farm.sessions += 1;
  farm.totalSeconds += seconds;
  farm.tree_inventory ||= {};
  farm.tree_progress ||= {};
  const threshold = tree.minutes * 60;
  let progress = Number(farm.tree_progress[tree.id] || 0) + seconds;
  let grown = 0;
  while (progress >= threshold) {
    progress -= threshold;
    farm.tree_inventory[tree.id] = Number(farm.tree_inventory[tree.id] || 0) + 1;
    grown += 1;
  }
  farm.tree_progress[tree.id] = progress;
  return grown;
}

async function recordCompletedFocus(durationSeconds) {
  const tree = selectedTree();
  if (!syncEnabled) {
    const grown = addLocalFocus(state.privateFarm, durationSeconds, tree);
    if (state.shareFocus && state.sharedFarm) {
      addLocalFocus(state.sharedFarm, durationSeconds, tree);
    }
    saveState();
    render();
    if (grown) showToast(`أحسنت! نمت ${formatArabicNumber(grown)} شجرة ${tree.name} 🌱`);
    else showToast(`جلسة مكتملة! ${formatArabicNumber(Math.floor(state.privateFarm.tree_progress[tree.id] / 60))} دقيقة نحو شجرة ${tree.name}.`);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('جلسة تركيز مكتملة!', { body: 'أحسنت! وقتك بيقرّب شجرتك من النمو 🌱' });
    }
    return 'saved';
  } else {
    let recorded = false;
    const previousTreeCount = Number(state.privateFarm.tree_inventory?.[tree.id] || 0);
    try {
      const { error } = await supabase.rpc('record_focus', {
        p_seconds: durationSeconds,
        p_shared_farm_id: state.shareFocus ? state.sharedFarm?.id : null,
        p_tree_type: tree.id,
      });
      if (error) throw error;
      recorded = true;
      await loadFarmData();
      const progress = Number(state.privateFarm.tree_progress?.[tree.id] || 0);
      const grown = Number(state.privateFarm.tree_inventory?.[tree.id] || 0) - previousTreeCount;
      showToast(grown
        ? `أحسنت! نمت ${formatArabicNumber(grown)} شجرة ${tree.name} 🌱`
        : `جلسة مكتملة! ${formatArabicNumber(Math.floor(progress / 60))} دقيقة نحو شجرة ${tree.name}.`);
    } catch (error) {
      console.error('Could not sync the completed focus session.', error);
      showToast(
        recorded
          ? 'الجلسة اتحفظت، لكن تعذر تحديث المزرعة. أعد تحميل الصفحة بعد التحقق من الاتصال.'
          : 'انتهت الجلسة لكن تعذر حفظها في المزرعة. تحقق من الاتصال وحاول تاني.',
        true,
      );
      return recorded ? 'refresh-error' : 'save-error';
    }
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('جلسة تركيز مكتملة!', { body: 'أحسنت! وقتك بيقرّب شجرتك من النمو 🌱' });
  }
  return 'saved';
}

function openNameDialog(title, copy, submitLabel) {
  $('#name-dialog-title').textContent = title;
  $('#name-dialog-copy').textContent = copy;
  $('#name-dialog-submit').textContent = submitLabel;
  $('#display-name-input').value = state.displayName === 'صاحب المزرعة' ? '' : state.displayName;
  dom.nameDialog.showModal();
  setTimeout(() => $('#display-name-input').focus(), 0);
}

function makeInviteUrl(code) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('join', code);
  return url.toString();
}

async function shareInvite() {
  if (!state.sharedFarm?.invite_code) {
    if (!syncEnabled) {
      showToast('فعّل Supabase أولًا لمشاركة مزرعة تتزامن بين الأجهزة.', true);
      return;
    }
    showToast('أنشئ مزرعة مشتركة أولًا.', true);
    return;
  }
  const url = makeInviteUrl(state.sharedFarm.invite_code);
  const text = `تعالى نركّز ونزرع سوا في جذور 🌱\n${url}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'انضم لمزرعتنا في جذور', text, url });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('Native share failed; falling back to clipboard.', error);
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('نسخت رابط الدعوة.. ابعته لأصحابك!');
  } catch (error) {
    console.error('Could not copy the invitation link.', error);
    showToast(`رمز الدعوة: ${state.sharedFarm.invite_code}`, true);
  }
}

async function createSharedFarm(displayName) {
  if (!syncEnabled) {
    showToast('لإنشاء مزرعة مشتركة متزامنة، أضف إعدادات Supabase حسب دليل التشغيل.', true);
    return;
  }
  await onlineReady;
  if (!userId) throw new Error('تعذر الاتصال بخدمة المزامنة. راجع إعدادات Supabase وحاول تاني.');
  const { data, error } = await supabase.rpc('create_shared_farm', {
    p_name: `مزرعة ${displayName}`,
    p_display_name: displayName,
  });
  if (error) throw error;
  state.displayName = displayName;
  await loadFarmData();
  render();
  showToast('مزرعتكم جاهزة! ابعت رابط الدعوة لصاحبينك.');
  shareInvite();
}

async function joinSharedFarm(code, displayName) {
  if (!syncEnabled) {
    showToast('الانضمام لمزرعة مشتركة يحتاج إعداد Supabase.', true);
    return;
  }
  await onlineReady;
  if (!userId) throw new Error('تعذر الاتصال بخدمة المزامنة. راجع إعدادات Supabase وحاول تاني.');
  const { data, error } = await supabase.rpc('join_shared_farm', {
    p_invite_code: code.trim().toUpperCase(),
    p_display_name: displayName,
  });
  if (error) throw error;
  state.displayName = displayName;
  await loadFarmData(data?.farm_id || null);
  render();
  showToast('أهلًا بيك في المزرعة المشتركة 🌿');
  const url = new URL(window.location.href);
  url.searchParams.delete('join');
  history.replaceState({}, '', url);
  switchPage('shared-garden');
}

async function loadFarmData(preferredFarmId = null) {
  if (!syncEnabled || !userId) return;
  const { data: personal, error: personalError } = await supabase
    .from('private_farms').select('sessions,total_seconds,tree_inventory,tree_progress').eq('user_id', userId).single();
  if (personalError) throw personalError;
  state.privateFarm = personal;

  let farmId = preferredFarmId;
  if (!farmId) {
    const savedFarmId = localStorage.getItem(`${STORAGE_KEY}-shared-id`);
    if (savedFarmId) farmId = savedFarmId;
    else {
      const { data: membership, error: membershipError } = await supabase
        .from('farm_members').select('farm_id').eq('user_id', userId).limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      farmId = membership?.farm_id || null;
    }
  }
  if (farmId) {
    const { data: farm, error: farmError } = await supabase
      .from('shared_farms').select('id,name,invite_code,sessions,total_seconds,tree_inventory,tree_progress').eq('id', farmId).maybeSingle();
    if (farmError) throw farmError;
    state.sharedFarm = farm;
  } else {
    state.sharedFarm = null;
  }

  if (state.sharedFarm) {
    localStorage.setItem(`${STORAGE_KEY}-shared-id`, state.sharedFarm.id);
    const { data: members, error: memberError } = await supabase
      .from('farm_members').select('user_id,display_name').eq('farm_id', state.sharedFarm.id);
    if (memberError) throw memberError;
    state.members = members || [];
  } else {
    state.members = [];
    localStorage.removeItem(`${STORAGE_KEY}-shared-id`);
  }
  render();
  subscribeToSharedFarm();
}

function subscribeToSharedFarm() {
  const farmId = state.sharedFarm?.id || null;
  if (farmId === realtimeFarmId) return;
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
  realtimeFarmId = farmId;
  if (!farmId) return;

  realtimeChannel = supabase.channel(`shared-farm-${farmId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_farms', filter: `id=eq.${farmId}` }, refreshFarmData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'farm_members', filter: `farm_id=eq.${farmId}` }, refreshFarmData)
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') showToast('تعذرت المزامنة المباشرة. تحقق من إعدادات Realtime.', true);
    });
}

async function refreshFarmData() {
  try {
    await loadFarmData();
  } catch (error) {
    console.error('Could not refresh the shared garden.', error);
    showToast('تعذر تحديث المزرعة المشتركة. تحقق من الاتصال وحاول تاني.', true);
  }
}

async function initializeOnline() {
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    let session = sessionData.session;
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      session = data.session;
    }
    userId = session.user.id;
    const isGoogleLinked = session.user.identities?.some((identity) => identity.provider === 'google');
    setIntegrationStatus(
      '#google-status',
      isGoogleLinked ? 'تم الاتصال بحساب Google ✓' : 'غير متصل — اربط حسابك لحفظ المزرعة.',
      Boolean(isGoogleLinked),
    );
    setText('#google-connect', isGoogleLinked ? 'مرتبط' : 'حفظ المزرعة');
    if (isGoogleLinked && localStorage.getItem(`${STORAGE_KEY}-google-pending`) === 'true') {
      localStorage.removeItem(`${STORAGE_KEY}-google-pending`);
      showToast('تم الاتصال بحساب Google بنجاح ✓');
    }
    const { error: initError } = await supabase.rpc('initialize_private_farm');
    if (initError) throw initError;
    await loadFarmData();
    $('#connection-status').textContent = 'متصل · مزامنة مباشرة';
  } catch (error) {
    console.error('Supabase initialization failed.', error);
    setIntegrationStatus('#google-status', 'تعذر التحقق من اتصال Google.', false, true);
    $('#connection-status').textContent = 'تعذر الاتصال';
    showToast('تعذر الاتصال بخدمة المزامنة. راجع إعداد Supabase والاتصال.', true);
  }
}

async function linkGoogleAccount() {
  if (!syncEnabled) {
    showToast('ربط Google يحتاج إعداد مشروع Supabase أولًا.', true);
    return;
  }
  await onlineReady;
  if (!userId) {
    setIntegrationStatus('#google-status', 'تعذر الاتصال — سجّل الدخول للمزامنة أولًا.', false, true);
    showToast('تعذر تهيئة الحساب. راجع Supabase وحاول تاني.', true);
    return;
  }
  setIntegrationStatus('#google-status', 'جاري الاتصال بحساب Google…');
  try {
    const { data, error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: window.location.href },
    });
    if (error) throw error;
    if (data.url) {
      localStorage.setItem(`${STORAGE_KEY}-google-pending`, 'true');
      window.location.assign(data.url);
    }
  } catch (error) {
    console.error('Could not link the Google account.', error);
    setIntegrationStatus('#google-status', 'فشل الاتصال بحساب Google. تحقق من إعدادات المزوّد.', false, true);
    showToast(error.message || 'تعذر ربط حساب Google. راجع تفعيل المزود وإعدادات الربط في Supabase.', true);
  }
}

async function signInWithGoogle() {
  if (!syncEnabled) {
    setIntegrationStatus('#google-status', 'غير متاح — أضف إعدادات Supabase أولًا.', false, true);
    showToast('تسجيل الدخول بـ Google يحتاج إعداد مشروع Supabase أولًا.', true);
    return;
  }
  setIntegrationStatus('#google-status', 'جاري الاتصال بحساب Google…');
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
    localStorage.setItem(`${STORAGE_KEY}-google-pending`, 'true');
    if (!data.url) setIntegrationStatus('#google-status', 'جارٍ التحقق من اتصال Google…');
  } catch (error) {
    console.error('Could not sign in with Google.', error);
    localStorage.removeItem(`${STORAGE_KEY}-google-pending`);
    setIntegrationStatus('#google-status', 'فشل الاتصال بحساب Google. تحقق من إعدادات المزوّد.', false, true);
    showToast(error.message || 'تعذر تسجيل الدخول بـ Google. راجع إعدادات المزوّد.', true);
  }
}

async function getMicrosoftToken() {
  if (!msalClient) throw new Error('أضف VITE_MS_TODO_CLIENT_ID في ملف البيئة أولًا.');
  const redirectResult = await initializeMsal();
  let account = redirectResult?.account || msalClient.getActiveAccount() || msalClient.getAllAccounts()[0];
  if (!account) {
    localStorage.setItem(MS_TODO_PENDING_KEY, 'true');
    await msalClient.loginRedirect({ scopes: ['User.Read', 'Tasks.ReadWrite'] });
    return null;
  }
  try {
    const result = await msalClient.acquireTokenSilent({
      account,
      scopes: ['User.Read', 'Tasks.ReadWrite'],
    });
    return result.accessToken;
  } catch (error) {
    if (error.name !== 'InteractionRequiredAuthError') throw error;
    localStorage.setItem(MS_TODO_PENDING_KEY, 'true');
    await msalClient.acquireTokenRedirect({
      account,
      scopes: ['User.Read', 'Tasks.ReadWrite'],
    });
    return null;
  }
}

async function initializeMsal() {
  if (!msalInitialization) {
    msalInitialization = (async () => {
      await msalClient.initialize();
      const result = await msalClient.handleRedirectPromise();
      if (result?.account) msalClient.setActiveAccount(result.account);
      return result;
    })();
  }
  return msalInitialization;
}

async function graphGetAll(url, token) {
  const values = [];
  let next = url;
  while (next) {
    const response = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Microsoft Graph: ${response.status} ${response.statusText}`);
    const page = await response.json();
    values.push(...(page.value || []));
    next = page['@odata.nextLink'] || null;
  }
  return values;
}

async function connectMicrosoftToDo() {
  if (!msalClient) {
    setIntegrationStatus('#todo-status', 'غير متاح — أضف معرّف تطبيق Microsoft أولًا.', false, true);
    showToast('أضف معرّف تطبيق Microsoft إلى .env.local حسب دليل التشغيل.', true);
    return;
  }
  const button = $('#todo-connect');
  button.disabled = true;
  button.textContent = 'جاري الربط…';
  setIntegrationStatus('#todo-status', 'جاري الاتصال بـ Microsoft To Do…');
  try {
    const token = await getMicrosoftToken();
    if (!token) return;
    const lists = await graphGetAll('https://graph.microsoft.com/v1.0/me/todo/lists?$select=id,displayName', token);
    const taskSets = await Promise.all(lists.map(async (list) => {
      const tasks = await graphGetAll(
        `https://graph.microsoft.com/v1.0/me/todo/lists/${encodeURIComponent(list.id)}/tasks?$select=id,title,status`,
        token,
      );
      return tasks.filter((task) => task.status !== 'completed')
        .map((task) => ({ id: task.id, listId: list.id, title: task.title, listName: list.displayName }));
    }));
    const tasks = taskSets.flat();
    const select = $('#todo-task-select');
    select.replaceChildren(new Option('اختار مهمة من القائمة', ''));
    tasks.forEach((task) => {
      const option = new Option(`${task.title} · ${task.listName}`, `${task.listId}:${task.id}`);
      select.add(option);
    });
    $('#todo-panel').hidden = false;
    button.textContent = 'تحديث المهام';
    setIntegrationStatus(
      '#todo-status',
      `تم الاتصال بـ Microsoft To Do ✓ · ${formatArabicNumber(tasks.length)} مهمة متاحة.`,
      true,
    );
    showToast('تم الاتصال بـ Microsoft To Do بنجاح ✓ اختار مهمة وحدد مدتها.');
  } catch (error) {
    localStorage.removeItem(MS_TODO_PENDING_KEY);
    console.error('Could not load Microsoft To Do tasks.', error);
    button.textContent = 'ربط المهام';
    setIntegrationStatus('#todo-status', 'فشل الاتصال بـ Microsoft To Do. تحقق من الصلاحيات وحاول مجددًا.', false, true);
    showToast(error.message || 'تعذر الاتصال بـ Microsoft To Do.', true);
  } finally {
    button.disabled = false;
  }
}

async function restoreMicrosoftConnection() {
  if (!msalClient) return;
  try {
    const redirectResult = await initializeMsal();
    const account = redirectResult?.account || msalClient.getActiveAccount() || msalClient.getAllAccounts()[0];
    if (!account) return;
    if (localStorage.getItem(MS_TODO_PENDING_KEY)) {
      localStorage.removeItem(MS_TODO_PENDING_KEY);
      await connectMicrosoftToDo();
      return;
    }
    const result = await msalClient.acquireTokenSilent({
      account,
      scopes: ['User.Read', 'Tasks.ReadWrite'],
    });
    const lists = await graphGetAll(
      'https://graph.microsoft.com/v1.0/me/todo/lists?$select=id,displayName',
      result.accessToken,
    );
    setIntegrationStatus(
      '#todo-status',
      `تم الاتصال بـ Microsoft To Do ✓ · ${formatArabicNumber(lists.length)} قائمة متاحة.`,
      true,
    );
    $('#todo-connect').textContent = 'تحديث المهام';
  } catch (error) {
    if (error.name !== 'InteractionRequiredAuthError') {
      console.error('Could not restore Microsoft To Do connection.', error);
      setIntegrationStatus('#todo-status', 'تعذر التحقق من اتصال Microsoft To Do. أعد الربط.', false, true);
    }
  }
}

async function completeMicrosoftTask(task) {
  try {
    const token = await getMicrosoftToken();
    if (!token) return;
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/todo/lists/${encodeURIComponent(task.listId)}/tasks/${encodeURIComponent(task.id)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      },
    );
    if (!response.ok) throw new Error(`Microsoft Graph: ${response.status} ${response.statusText}`);
    showToast('اتعلّمت المهمة مكتملة في Microsoft To Do ✓');
  } catch (error) {
    console.error('Could not mark the Microsoft To Do task as completed.', error);
    showToast('خلصت وقت المهمة، لكن ما قدرناش نحدّث Microsoft To Do.', true);
  }
}

function saveFocusSettings() {
  const focusInput = $('#setting-focus-minutes');
  const breakInput = $('#setting-break-minutes');
  const focusMinutes = Number(focusInput.value);
  const breakMinutes = Number(breakInput.value);
  if (!Number.isInteger(focusMinutes) || focusMinutes < 1 || focusMinutes > 180) {
    showToast('مدة التركيز لازم تكون من دقيقة إلى ١٨٠ دقيقة.', true);
    focusInput.value = state.settings.focusMinutes;
    return;
  }
  if (!Number.isInteger(breakMinutes) || breakMinutes < 1 || breakMinutes > 60) {
    showToast('مدة الراحة لازم تكون من دقيقة إلى ٦٠ دقيقة.', true);
    breakInput.value = state.settings.breakMinutes;
    return;
  }
  state.settings = { focusMinutes, breakMinutes };
  if (state.timer.status === 'idle') {
    state.timer.durationSeconds = focusMinutes * 60;
    state.timer.remainingSeconds = state.timer.durationSeconds;
  }
  saveState();
  render();
  showToast('اتحفظت إعدادات التركيز والراحة.');
}

function saveTaskTarget() {
  const input = $('#task-minutes');
  const minutes = Number(input.value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    showToast('مدة المهمة لازم تكون من دقيقة إلى ١٤٤٠ دقيقة.', true);
    input.value = state.taskTargetMinutes;
    return false;
  }
  state.taskTargetMinutes = minutes;
  saveState();
  renderTaskPlan();
  return true;
}

function wireEvents() {
  $$('[data-page]').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.page)));
  $$('[data-open]').forEach((button) => button.addEventListener('click', () => switchPage(button.dataset.open)));
  dom.timerToggle.addEventListener('click', startTimer);
  $('#timer-reset').addEventListener('click', resetTimer);
  $('#timer-skip').addEventListener('click', () => {
    if (state.timer.phase === 'break' && state.timer.status !== 'idle') beginFocusBlock();
  });
  $('#setting-focus-minutes').addEventListener('change', saveFocusSettings);
  $('#setting-break-minutes').addEventListener('change', saveFocusSettings);
  $('#task-minutes').addEventListener('change', saveTaskTarget);
  $('#calculate-plan').addEventListener('click', () => {
    if (!saveTaskTarget()) return;
    renderTaskPlan();
    showToast('خطة المهمة جاهزة. ابدأ لما تكون مستعد.');
  });
  $('#google-connect').addEventListener('click', linkGoogleAccount);
  $('#google-login').addEventListener('click', signInWithGoogle);
  $('#todo-connect').addEventListener('click', connectMicrosoftToDo);
  $('#todo-task-select').addEventListener('change', (event) => {
    $('#todo-use-task').disabled = !event.target.value;
  });
  $('#todo-use-task').addEventListener('click', () => {
    const selected = $('#todo-task-select');
    const [listId, id] = selected.value.split(':');
    if (!listId || !id) return;
    state.selectedTask = {
      id,
      listId,
      title: selected.selectedOptions[0].textContent.split(' · ')[0],
      completeOnFinish: $('#todo-complete-on-finish').checked,
    };
    saveState();
    renderTaskPlan();
    showToast('اتحدد هدفك. اكتب المدة واضغط احسب الخطة.');
  });
  $('#todo-complete-on-finish').addEventListener('change', (event) => {
    if (state.selectedTask) {
      state.selectedTask.completeOnFinish = event.target.checked;
      saveState();
    }
  });
  $('#share-focus-toggle').addEventListener('change', (event) => {
    state.shareFocus = event.target.checked;
    saveState();
    showToast(state.shareFocus ? 'جلساتك الجاية هتزرع في المزرعتين.' : 'جلساتك الجاية هتزرع في مزرعتك بس.');
  });
  $('#top-share').addEventListener('click', shareInvite);
  $('#share-invite').addEventListener('click', shareInvite);
  $('#copy-invite').addEventListener('click', shareInvite);
  $('#create-farm').addEventListener('click', () => {
    if (!syncEnabled) {
      showToast('فعّل Supabase أولًا عشان أصحابك يقدروا يشوفوا نفس المزرعة.', true);
      return;
    }
    openNameDialog('مين بيزرع هنا؟', 'اكتب اسمك اللي هيظهر لأصحابك في المزرعة.', 'أنشئ المزرعة');
  });
  $('#join-farm').addEventListener('click', () => dom.joinDialog.showModal());

  dom.nameDialog.addEventListener('submit', async (event) => {
    if (event.submitter?.id !== 'name-dialog-submit') return;
    event.preventDefault();
    const displayName = $('#display-name-input').value.trim();
    if (!displayName) return;
    dom.nameDialog.close();
    try {
      await createSharedFarm(displayName);
    } catch (error) {
      console.error('Could not create a shared farm.', error);
      showToast(error.message || 'تعذر إنشاء المزرعة المشتركة.', true);
    }
  });
  dom.joinDialog.addEventListener('submit', async (event) => {
    if (event.submitter?.id !== 'join-dialog-submit') return;
    event.preventDefault();
    const code = $('#invite-code-input').value.trim();
    const displayName = $('#join-name-input').value.trim();
    if (!code || !displayName) return;
    dom.joinDialog.close();
    try {
      await joinSharedFarm(code, displayName);
    } catch (error) {
      console.error('Could not join the shared farm.', error);
      showToast(error.message || 'تعذر الانضمام. تأكد من رمز الدعوة وأن المزرعة لم تمتلئ.', true);
    }
  });
}

function resumePersistedTimer() {
  if (state.timer.status === 'running' && state.timer.deadline) {
    if (state.timer.deadline <= Date.now()) {
      state.timer.remainingSeconds = 0;
      tick();
    } else {
      ticking = setInterval(tick, 250);
      renderTimer();
    }
  }
}

function initializeDate() {
  const now = new Date();
  setText('#date-label', new Intl.DateTimeFormat('ar-EG', { weekday: 'long' }).format(now));
  setText('#date-short', new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long' }).format(now));
}

wireEvents();
// 3D toggle handler
const toggle3dBtn = $('#toggle-3d');
if (toggle3dBtn) {
  toggle3dBtn.addEventListener('click', () => {
    const d3 = $('#garden-3d');
    const landscape = $('#personal-landscape-full');
    const showing = d3 && !d3.hasAttribute('hidden');
    if (showing) {
      if (d3) { d3.setAttribute('hidden', ''); d3.setAttribute('aria-hidden','true'); }
      if (landscape) { landscape.removeAttribute('hidden'); landscape.setAttribute('aria-hidden','false'); }
      toggle3dBtn.textContent = 'عرض 3D';
    } else {
      if (d3) { d3.removeAttribute('hidden'); d3.setAttribute('aria-hidden','false'); }
      if (landscape) { landscape.setAttribute('hidden', ''); landscape.setAttribute('aria-hidden','true'); }
      toggle3dBtn.textContent = 'عرض المزرعة المسطّح';
      const container = $('#garden-3d');
      if (container) init3DGarden(container);
      update3DGarden();
    }
  });
}
initializeDate();
render();
resumePersistedTimer();
if (syncEnabled) onlineReady = initializeOnline();
if (msalClient) void restoreMicrosoftConnection();

const inviteCode = new URLSearchParams(window.location.search).get('join');
if (inviteCode && syncEnabled) {
  $('#invite-code-input').value = inviteCode.toUpperCase();
  dom.joinDialog.showModal();
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker registration failed.', error);
    });
  });
}
