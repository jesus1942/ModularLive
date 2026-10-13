// Visor 3D por capas. Planta (x, y, z) → three (x, z, y): Y de three es la altura.
import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";
import { barAxes, sampleBarDiagram } from "./engineering/frame3d.js";
import { formatForce } from "./engineering/units.js";

export const LAYERS = [
  { id: "fundacion", label: "Fundación" },
  { id: "estructura", label: "Estructura" },
  { id: "piso", label: "Piso" },
  { id: "cerramientos", label: "Cerramientos" },
  { id: "cubierta", label: "Cubierta" },
  { id: "cielorraso", label: "Cielorraso" },
  { id: "aberturas", label: "Aberturas" },
  { id: "escaleras", label: "Escaleras" },
  { id: "balcones", label: "Balcones y terrazas" }
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
  ridge: 0x6e2f16,
  ceilingJoist: 0x555555,
  ceilingTrack: 0x333333,
  stairStringer: 0x2b2b2b,
  landingFrame: 0x3d3d3d,
  landingPost: 0x2b2b2b,
  handrail: 0x111111,
  railPost: 0x333333,
  baluster: 0x555555,
  balconyBeam: 0x2b2b2b
};

const SURFACE_STYLES = {
  exterior: { color: 0xc9d3cd, opacity: 0.92 },
  interior: { color: 0xf2eee5, opacity: 0.95 },
  cubierta: { color: 0x8c979c, opacity: 0.9 },
  cielorraso: { color: 0xe8e8e8, opacity: 1 },
  piso: { color: 0xc8a676, opacity: 1 },
  platea: { color: 0xb9b4a8, opacity: 1 },
  vidrio: { color: 0x9cc7e0, opacity: 0.45 },
  puerta: { color: 0x8b5a3c, opacity: 1 },
  escalon: { color: 0x9a9a9a, opacity: 1 },
  terraza: { color: 0xa98b62, opacity: 1 },
  balcon: { color: 0xa98b62, opacity: 1 },
  volado: { color: 0xc9d3cd, opacity: 0.92 }
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
  const windGroup = new THREE.Group();
  scene.add(windGroup);
  const pointLoadGroup = new THREE.Group();
  scene.add(pointLoadGroup);
  const analysisGroup = new THREE.Group();
  scene.add(analysisGroup);
  const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  renderer.domElement.addEventListener("pointermove", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(windGroup.children, false).find((h) => h.object.visible && h.object.userData.pressureFaces);
    const p = hit?.object.userData.pressureFaces?.[hit.faceIndex];
    const tooltip = document.querySelector("#windTooltip");
    raycaster.params.Line.threshold=.04;
    const analysisHit=raycaster.intersectObjects(analysisGroup.children,true).find(h=>h.object.visible);
    let object=analysisHit?.object;while(object&&!object.userData.analysisLabel)object=object.parent;
    if (tooltip) tooltip.textContent = object?.userData.analysisLabel ?? (p ? `Zona ${p.zone} · ${(p.pressure_Pa / 1000).toLocaleString("es-AR", { maximumFractionDigits: 3 })} kN/m² · nivel ${p.level + 1}` : "");
  });
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
    [windGroup, pointLoadGroup, analysisGroup].forEach((g) => g.children.forEach((child) => { child.visible = (child.userData.level ?? 0) <= maxLevel; }));
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
    const styleId = surface.style ?? surface.material;
    const style = SURFACE_STYLES[styleId] ?? SURFACE_STYLES.exterior;
    const material = getMaterial(`s-${styleId}`, () =>
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
      (layerGroups[{ cielorraso: "cielorraso", escaleras: "escaleras", balcones: "balcones" }[m.layer] ?? "estructura"]).add(mesh);
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

  /** Parches de presión reales y flechas normales; presión positiva hacia adentro, negativa afuera. */
  function setWindPatches(patches, pointEntries = []) {
    windGroup.traverse((object) => { if (object.geometry && object.geometry !== unitBox) object.geometry.dispose(); });
    windGroup.clear();
    const maxPressure = Math.max(1, ...patches.map((p) => Math.abs(p.pressure_Pa)));
    const batches = new Map();
    patches.forEach((p, i) => {
      const offset = p.normal.map((v) => .025 * v);
      const points = p.points.map((pt) => pt.map((v, j) => v + offset[j]));
      const temporary = surfaceMesh({ ...p, material: "wind", holes: [], points });
      const shade = p.pressure_Pa < 0 ? Math.round(105 - 70 * Math.abs(p.pressure_Pa) / maxPressure) : Math.round(245 - 45 * Math.abs(p.pressure_Pa) / maxPressure);
      const color = new THREE.Color(shade * 0x010101);
      if (!batches.has(p.level)) batches.set(p.level, { positions: [], colors: [], edges: [], faces: [] });
      const batch = batches.get(p.level), position = temporary.geometry.attributes.position;
      const indices = temporary.geometry.index.array;
      for (let j = 0; j < indices.length; j += 1) {
        const k = indices[j];
        batch.positions.push(position.getX(k), position.getY(k), position.getZ(k));
        batch.colors.push(color.r, color.g, color.b);
        if (j % 3 === 0) batch.faces.push(p);
      }
      points.forEach((pt, j) => { const a = toV(pt), b = toV(points[(j + 1) % points.length]); batch.edges.push(a.x, a.y, a.z, b.x, b.y, b.z); });
      temporary.geometry.dispose();
      if (i % Math.max(1, Math.ceil(patches.length / 45)) === 0) {
        const direction = toV(p.normal.map((v) => p.pressure_Pa < 0 ? v : -v)).normalize();
        const center = toV(p.point_m.map((v, j) => v + offset[j]));
        if (p.pressure_Pa > 0) center.addScaledVector(direction, -.4);
        const arrow = new THREE.ArrowHelper(direction, center, .4, 0x111111, .10, .05);
        arrow.userData.level = p.level; windGroup.add(arrow);
      }
    });
    // Una malla por nivel, con color por vértice: cientos de parches no generan cientos de draw calls.
    batches.forEach((batch, level) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(batch.colors, 3));
      const mesh = new THREE.Mesh(geometry, getMaterial("wind-batch", () => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: .88, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
      mesh.userData = { level, pressureFaces: batch.faces }; windGroup.add(mesh);
      const edgesGeometry = new THREE.BufferGeometry();
      edgesGeometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.edges, 3));
      const edge = new THREE.LineSegments(edgesGeometry, getMaterial("wind-edge", () => new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: .5 })));
      edge.userData.level = level; windGroup.add(edge);
    });
    pointEntries.forEach((entry) => {
      const direction = toV(entry.force_N).normalize();
      if (!direction.lengthSq()) return;
      const arrow = new THREE.ArrowHelper(direction, toV(entry.point_m), .7, 0x111111, .14, .07);
      arrow.userData.level = entry.level; windGroup.add(arrow);
    });
    applyLevelVisibility();
  }

  /** Marcadores de cargas permanentes manuales, en la posición que se usa para calcular D. */
  function setPointLoads(entries) {
    pointLoadGroup.traverse((object) => { if (object.geometry) object.geometry.dispose(); });
    pointLoadGroup.clear();
    entries.forEach((entry) => {
      const origin = toV(entry.point_m); origin.y += .6;
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), origin, .55, 0x111111, .13, .07);
      arrow.userData.level = entry.level; pointLoadGroup.add(arrow);
    });
    applyLevelVisibility();
  }

  /** Ejes, reacciones o deformada del caso elegido. No modifica geometría de obra ni BOM. */
  function setAnalysisView(model,response,mode,{amplification=10}={}) {
    analysisGroup.traverse(object=>{object.geometry?.dispose();if(object.material){for(const m of Array.isArray(object.material)?object.material:[object.material])m.dispose();}});
    analysisGroup.clear();
    if(!model||mode==="none")return;
    const nodes=new Map(model.nodes.map(n=>[n.id,n])),responses=new Map(response?.bars.map(b=>[b.barId,b])??[]);
    const line=(points,color,level,label)=>{
      const mesh=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(toV)),new THREE.LineBasicMaterial({color,transparent:true,opacity:.95,depthTest:false}));
      mesh.renderOrder=20;mesh.userData={level,analysisLabel:label};analysisGroup.add(mesh);
    };
    model.bars.forEach(bar=>{
      const a=nodes.get(bar.a).point_m,b=nodes.get(bar.b).point_m;
      line([a,b],mode==="analysis-deformed"?0x999999:0x111111,bar.level,`${bar.group} · eje analítico · nivel ${bar.level+1}`);
      if(mode!=="analysis-deformed"||!responses.has(bar.id))return;
      const r=responses.get(bar.id),axes=barAxes(a,b,bar.yAxis),L=Math.hypot(...b.map((v,i)=>v-a[i]));
      const samples=sampleBarDiagram(bar,a,b,r);
      const points=samples.map(s=>a.map((v,i)=>v+s.x_m*axes[0][i]+amplification*((r.endDisplacements_local[0]*(1-s.x_m/L)+r.endDisplacements_local[6]*s.x_m/L)*axes[0][i]+s.uy_m*axes[1][i]+s.uz_m*axes[2][i])));
      line(points,0x111111,bar.level,`${bar.group} · deformada elástica ×${amplification}, sin segundo orden`);
    });
    if(mode==="analysis-reactions"&&response) {
      const largest=Math.max(1,...response.reactions.map(r=>Math.hypot(...r.force_N)));
      response.reactions.forEach(r=>{
        const force=toV(r.force_N),length=.2+.8*force.length()/largest;
        if(force.length()<1e-8)return;
        const arrow=new THREE.ArrowHelper(force.normalize(),toV(r.point_m),length,0x111111,.12,.065);
        arrow.userData={level:nodes.get(r.nodeId)?.level??0,analysisLabel:`Reacción: X ${formatForce(r.force_N[0])}; Y ${formatForce(r.force_N[1])}; Z ${formatForce(r.force_N[2])}. Fundación sin dimensionar.`};analysisGroup.add(arrow);
      });
    }
    applyLevelVisibility();
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
    setWindPatches,
    setPointLoads,
    setAnalysisView,
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
