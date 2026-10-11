// Visor 3D por capas. Planta (x, y, z) → three (x, z, y): Y de three es la altura.
import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";

export const LAYERS = [
  { id: "fundacion", label: "Fundación" },
  { id: "estructura", label: "Estructura" },
  { id: "piso", label: "Piso" },
  { id: "cerramientos", label: "Cerramientos" },
  { id: "cubierta", label: "Cubierta" },
  { id: "aberturas", label: "Aberturas" }
];

const ROLE_COLORS = {
  column: 0x214034,
  ringBeam: 0x2f5d4b,
  stud: 0x6f9583,
  track: 0x58806d,
  openingFrame: 0xd67d44,
  floorJoist: 0x8a6d4f,
  rafter: 0x9a4f2a,
  roofEdge: 0x7d3d1f,
  ridge: 0x6e2f16
};

const SURFACE_STYLES = {
  exterior: { color: 0xc9d3cd, opacity: 0.92 },
  interior: { color: 0xf2eee5, opacity: 0.95 },
  cubierta: { color: 0x8c979c, opacity: 0.9 },
  piso: { color: 0xc8a676, opacity: 1 },
  platea: { color: 0xb9b4a8, opacity: 1 },
  vidrio: { color: 0x9cc7e0, opacity: 0.45 },
  puerta: { color: 0x8b5a3c, opacity: 1 }
};

const toV = ([x, y, z]) => new THREE.Vector3(x, z, y);

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3f1e8);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  camera.position.set(9, 7, 11);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.495;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(12, 20, 8);
  scene.add(sun);

  const grid = new THREE.GridHelper(60, 60, 0xb9b3a4, 0xdcd7ca);
  grid.position.y = 0.001;
  scene.add(grid);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshLambertMaterial({ color: 0xe7e2d4, transparent: true, opacity: 0.55, depthWrite: false })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const layerGroups = {};
  LAYERS.forEach(({ id }) => {
    layerGroups[id] = new THREE.Group();
    scene.add(layerGroups[id]);
  });

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const materialCache = new Map();
  const getMaterial = (key, factory) => {
    if (!materialCache.has(key)) materialCache.set(key, factory());
    return materialCache.get(key);
  };
  const highlightMaterial = new THREE.MeshLambertMaterial({ color: 0xd67d44, emissive: 0x5a2a0c });

  let memberMeshes = [];
  let firstBuild = true;
  let maxLevel = Infinity;
  const applyLevelVisibility = () => {
    Object.values(layerGroups).forEach((g) =>
      g.children.forEach((child) => {
        child.visible = (child.userData.level ?? 0) <= maxLevel;
      })
    );
  };

  function clearGroups() {
    Object.values(layerGroups).forEach((g) => {
      g.children.forEach((child) => {
        if (child.geometry && child.geometry !== unitBox) child.geometry.dispose();
      });
      g.clear();
    });
    memberMeshes = [];
  }

  /** Caja orientada entre a y b. across: vector en planta [nx, ny] para piezas de muro. */
  function orientedBox(a, b, w, h, across) {
    const A = toV(a);
    const B = toV(b);
    const dirVec = new THREE.Vector3().subVectors(B, A);
    const len = dirVec.length();
    const X = dirVec.clone().normalize();
    let Z;
    let sizeY;
    let sizeZ;
    if (across) {
      Z = new THREE.Vector3(across[0], 0, across[1]).normalize();
      sizeZ = h;
      sizeY = w;
    } else {
      const ref = Math.abs(X.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      Z = new THREE.Vector3().crossVectors(X, ref).normalize();
      sizeZ = w;
      sizeY = h;
    }
    const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
    Z = new THREE.Vector3().crossVectors(X, Y).normalize();
    const m = new THREE.Matrix4().makeBasis(X, Y, Z);
    const mesh = new THREE.Mesh(unitBox);
    mesh.quaternion.setFromRotationMatrix(m);
    mesh.scale.set(len, sizeY, sizeZ);
    mesh.position.copy(A).add(B).multiplyScalar(0.5);
    return mesh;
  }

  function surfaceMesh(surface) {
    const pts = surface.points.map(toV);
    const holes = (surface.holes ?? []).map((h) => h.map(toV));
    // base 2D sobre el plano
    const normal = new THREE.Vector3();
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      normal.x += (p.y - q.y) * (p.z + q.z);
      normal.y += (p.z - q.z) * (p.x + q.x);
      normal.z += (p.x - q.x) * (p.y + q.y);
    }
    normal.normalize();
    const u = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u);
    const to2 = (p) => new THREE.Vector2(p.dot(u), p.dot(v));
    const contour = pts.map(to2);
    const holes2 = holes.map((h) => h.map(to2));
    if (THREE.ShapeUtils.isClockWise(contour)) {
      contour.reverse();
      pts.reverse();
    }
    holes2.forEach((h, i) => {
      if (!THREE.ShapeUtils.isClockWise(h)) {
        h.reverse();
        holes[i].reverse();
      }
    });
    const faces = THREE.ShapeUtils.triangulateShape(contour, holes2);
    const all = [...pts, ...holes.flat()];
    const positions = new Float32Array(all.length * 3);
    all.forEach((p, i) => positions.set([p.x, p.y, p.z], i * 3));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(faces.flat());
    geometry.computeVertexNormals();
    const style = SURFACE_STYLES[surface.material] ?? SURFACE_STYLES.exterior;
    const material = getMaterial(`s-${surface.material}`, () =>
      new THREE.MeshLambertMaterial({
        color: style.color,
        transparent: style.opacity < 1,
        opacity: style.opacity,
        side: THREE.DoubleSide,
        depthWrite: style.opacity >= 1
      })
    );
    return new THREE.Mesh(geometry, material);
  }

  function solidMesh(solid) {
    const material = getMaterial("concrete", () => new THREE.MeshLambertMaterial({ color: 0xb9b4a8 }));
    if (solid.shape === "beam") {
      const mesh = solid.vertical
        ? orientedBox(solid.a, solid.b, solid.w, solid.h, [1, 0])
        : orientedBox(solid.a, solid.b, solid.w, solid.h);
      mesh.material = material;
      return mesh;
    }
    if (solid.shape === "cylinder") {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(solid.r, solid.r, solid.h, 18), material);
      mesh.position.copy(toV(solid.center));
      return mesh;
    }
    if (solid.shape === "prism") {
      const shape = new THREE.Shape(solid.polygon.map((p) => new THREE.Vector2(p.x, -p.y)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: solid.z1 - solid.z0, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, solid.z0, 0);
      return new THREE.Mesh(geometry, material);
    }
    return null;
  }

  function build(gen) {
    clearGroups();
    gen.solids.forEach((solid) => {
      const mesh = solidMesh(solid);
      if (!mesh) return;
      mesh.userData.level = solid.level ?? 0;
      layerGroups.fundacion.add(mesh);
    });
    gen.members.forEach((m) => {
      const mesh = orientedBox(m.a, m.b, m.w, m.h, m.nrm);
      mesh.material = getMaterial(`r-${m.role}`, () => new THREE.MeshLambertMaterial({ color: ROLE_COLORS[m.role] ?? 0x777777 }));
      mesh.userData = { member: m, level: m.level ?? 0 };
      layerGroups.estructura.add(mesh);
      memberMeshes.push(mesh);
    });
    gen.surfaces.forEach((surface) => {
      const mesh = surfaceMesh(surface);
      if (!mesh) return;
      mesh.userData.level = surface.level ?? 0;
      layerGroups[surface.layer]?.add(mesh);
    });
    applyLevelVisibility();
    if (firstBuild) {
      frame();
      firstBuild = false;
    }
  }

  function highlightWall(wallId) {
    memberMeshes.forEach((mesh) => {
      const m = mesh.userData.member;
      mesh.material =
        wallId && m.wallId === wallId
          ? highlightMaterial
          : getMaterial(`r-${m.role}`, () => new THREE.MeshLambertMaterial({ color: ROLE_COLORS[m.role] ?? 0x777777 }));
    });
  }

  function setMaxLevel(value) {
    maxLevel = value;
    applyLevelVisibility();
  }

  function setLayerVisible(id, visible) {
    if (layerGroups[id]) layerGroups[id].visible = visible;
  }

  function frame() {
    const box = new THREE.Box3();
    Object.values(layerGroups).forEach((g) => box.expandByObject(g));
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    controls.target.copy(center);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const distance = (radius * 0.92) / Math.sin(Math.min(vFov, hFov) / 2);
    const dir = new THREE.Vector3(0.8, 0.55, 1).normalize();
    camera.position.copy(center).add(dir.multiplyScalar(distance));
    camera.near = 0.05;
    camera.far = distance * 20 + 100;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  let running = true;
  const loop = () => {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  loop();

  return {
    build,
    frame,
    highlightWall,
    setLayerVisible,
    setMaxLevel,
    resize,
    snapshot: () => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL("image/png");
    },
    dispose() {
      running = false;
      renderer.dispose();
    }
  };
}
