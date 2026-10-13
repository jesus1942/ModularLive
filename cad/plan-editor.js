// Editor de planta 2D sobre SVG. Coordenadas del modelo en metros; Y crece hacia abajo en pantalla.
import { dist, dot, normalize, pointInPolygon, pointKey, sub, wallDir, wallLength } from "./geometry.js";
import { STAIR_DEFAULTS, defaultSwing, doorLeaf, levelFootprints, newId, placeBalcony, wallFootprint } from "./model.js";
import { dirVector, layoutStair } from "./stairs.js";
import { balconyGeometry } from "./outdoor-build.js";

const NS = "http://www.w3.org/2000/svg";
const WALL_THICKNESS = 0.14;
const DEFAULT_OPENINGS = {
  door: { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1, sill: 1 }
};

const fmt = (v) => v.toFixed(2).replace(".", ",");

function projectOnSegment(p, a, b) {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)) : 0;
  const q = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return { q, t, d: dist(p, q) };
}

export function createPlanEditor({ svg, store, status, onSelectionChange, onToolChange }) {
  const view = { scale: 60, ox: 60, oy: 60 };
  let tool = "select";
  let selection = null; // { type: "wall", wallId } | { type: "opening", wallId, openingId }
  let gen = null;
  let draft = null; // proyecto temporal durante arrastres
  let chain = null; // { type, start, last }
  let rectStart = null;
  let cursor = null; // { p, kind }
  let drag = null;
  let typed = "";
  let ortho = true;
  let snapStep = 0.1;
  const pointers = new Map();
  let pinch = null;
  let level = 0;
  let stairStart = null; // primer toque de la herramienta Escalera

  const model = () => draft ?? store.project;
  const lvl = (p) => p.levels[Math.min(level, p.levels.length - 1)];
  const ghostWalls = (p) => (level > 0 && p.levels[level - 1] ? p.levels[level - 1].walls : []);
  const toScreen = (p) => ({ x: p.x * view.scale + view.ox, y: p.y * view.scale + view.oy });
  const toModel = (evt) => {
    const rect = svg.getBoundingClientRect();
    return { x: (evt.clientX - rect.left - view.ox) / view.scale, y: (evt.clientY - rect.top - view.oy) / view.scale };
  };
  const tol = (px) => px / view.scale;

  // ---------- Snap ----------
  function snapPoint(raw, opts = {}) {
    const r = snapPointRaw(raw, opts);
    return { ...r, p: { x: Math.round(r.p.x * 1000) / 1000, y: Math.round(r.p.y * 1000) / 1000 } };
  }

  function snapPointRaw(raw, { anchor = null, freeAxis = false, excludeKey = null } = {}) {
    // se usa el proyecto confirmado: durante un arrastre el vértice movido no debe atraerse a sí mismo
    const walls = lvl(store.project).walls;
    // extremos de muros
    let best = null;
    walls.forEach((w) => {
      [w.a, w.b].forEach((e) => {
        if (excludeKey && pointKey(e) === excludeKey) return;
        const d = dist(raw, e);
        if (d < tol(14) && (!best || d < best.d)) best = { p: { ...e }, d, kind: "end" };
      });
    });
    ghostWalls(store.project).forEach((w) => {
      [w.a, w.b].forEach((e) => {
        const d = dist(raw, e);
        if (d < tol(14) && (!best || d < best.d)) best = { p: { ...e }, d, kind: "end" };
      });
    });
    if (best) return best;
    let p = { ...raw };
    if (anchor && ortho && !freeAxis) {
      const dx = Math.abs(raw.x - anchor.x);
      const dy = Math.abs(raw.y - anchor.y);
      if (dx >= dy) p.y = anchor.y;
      else p.x = anchor.x;
      const len = dist(p, anchor);
      const snappedLen = Math.round(len / snapStep) * snapStep;
      const dir = normalize(sub(p, anchor));
      p = { x: anchor.x + dir.x * snappedLen, y: anchor.y + dir.y * snappedLen };
    } else {
      p = { x: Math.round(raw.x / snapStep) * snapStep, y: Math.round(raw.y / snapStep) * snapStep };
    }
    // sobre un muro existente (encuentro en T)
    let edge = null;
    walls.forEach((w) => {
      const { q, d, t } = projectOnSegment(raw, w.a, w.b);
      if (t > 0 && t < 1 && d < tol(10) && (!edge || d < edge.d)) {
        // posición sobre el muro redondeada al paso de snap
        const L = dist(w.a, w.b);
        const dir = normalize(sub(w.b, w.a));
        let sPos = Math.round((t * L) / snapStep) * snapStep;
        if (Math.abs(dir.y) < 1e-9) sPos = Math.abs(Math.round(q.x / snapStep) * snapStep - w.a.x);
        else if (Math.abs(dir.x) < 1e-9) sPos = Math.abs(Math.round(q.y / snapStep) * snapStep - w.a.y);
        if (sPos > 1e-6 && sPos < L - 1e-6) {
          edge = { p: { x: w.a.x + dir.x * sPos, y: w.a.y + dir.y * sPos }, d, kind: "edge", wallId: w.id };
        }
      }
    });
    if (edge) {
      if (anchor && ortho && !freeAxis) {
        // mantener ortogonalidad: intersectar la recta ortogonal con el muro
        const w = walls.find((x) => x.id === edge.wallId);
        const horizontal = Math.abs(p.y - anchor.y) < 1e-9;
        const dir = sub(w.b, w.a);
        if (horizontal && Math.abs(dir.y) > 1e-9) {
          const t = (anchor.y - w.a.y) / dir.y;
          if (t > 0 && t < 1) return { p: { x: w.a.x + dir.x * t, y: anchor.y }, kind: "edge", wallId: w.id };
        } else if (!horizontal && Math.abs(dir.x) > 1e-9) {
          const t = (anchor.x - w.a.x) / dir.x;
          if (t > 0 && t < 1) return { p: { x: anchor.x, y: w.a.y + dir.y * t }, kind: "edge", wallId: w.id };
        }
      } else {
        return edge;
      }
    }
    return { p, kind: "grid" };
  }

  // ---------- Escaleras ----------
  /** Cotas para resolver una escalera que arranca en este nivel; null si no hay nivel encima. */
  function stairEnv(li = level) {
    const lo = gen?.levels?.[li];
    const up = gen?.levels?.[li + 1];
    if (!lo || !up) return null;
    return { f0: lo.floorTop, H: up.floorTop - lo.floorTop, zUnder: up.elev - 0.013 };
  }
  const layoutFor = (stair) => {
    const env = stairEnv();
    return env ? layoutStair(stair, env) : null;
  };
  /** Si la escalera queda a menos de 30 cm de un muro paralelo, la pega a su cara. */
  function fitStairToWalls(st, walls) {
    const u = dirVector(st.dir);
    const r = { x: -u.y, y: u.x };
    let best = null;
    walls.forEach((w) => {
      const d = normalize(sub(w.b, w.a));
      if (Math.abs(d.x * u.y - d.y * u.x) > 1e-3) return; // no es paralelo
      const tw = (w.a.x - st.x) * r.x + (w.a.y - st.y) * r.y;
      const along = [w.a, w.b].map((q) => (q.x - st.x) * u.x + (q.y - st.y) * u.y);
      if (Math.max(...along) < 0.3 || Math.min(...along) > 1.5) return; // no acompaña al primer tramo
      const gapToFace = Math.abs(tw) - 0.07 - st.width / 2;
      if (gapToFace > -0.3 && gapToFace < 0.3 && (!best || Math.abs(gapToFace) < Math.abs(best.gap))) best = { gap: gapToFace, sign: Math.sign(tw) };
    });
    if (!best) return st;
    const shift = best.sign * best.gap;
    return { ...st, x: Math.round((st.x + r.x * shift) * 1000) / 1000, y: Math.round((st.y + r.y * shift) * 1000) / 1000 };
  }
  const dirFrom = (a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 180;
    return dy >= 0 ? 90 : 270;
  };
  function stairAt(raw) {
    const p = model();
    for (const st of lvl(p).stairs ?? []) {
      const lay = layoutFor(st);
      if (lay?.rects.some((r) => raw.x >= r.x0 && raw.x <= r.x1 && raw.y >= r.y0 && raw.y <= r.y1)) return st;
    }
    return null;
  }

  // ---------- Partes descubiertas y balcones ----------
  /** Parte descubierta de este nivel bajo el puntero (viene del generador). */
  function exposedAt(raw) {
    const parts = gen?.levels?.[level]?.exposed ?? [];
    return parts.some((part) => part.outline.some((loop) => pointInPolygon(raw, loop))) ? { type: "exposed" } : null;
  }
  const balconyPolyOf = (p, bal) => {
    const wall = lvl(p).walls.find((w) => w.id === bal.wallId);
    return wall ? balconyGeometry(bal, wall, wallFootprint(gen?.levels?.[level], wall)) : null;
  };
  function balconyAt(raw) {
    const p = model();
    return (lvl(p).balconies ?? []).find((bal) => {
      const g = balconyPolyOf(p, bal);
      return g && pointInPolygon(raw, g.poly);
    }) ?? null;
  }

  // ---------- Operaciones sobre el modelo ----------
  function splitExteriorAt(project, point) {
    const wall = lvl(project).walls.find((w) => {
      if (w.type !== "exterior") return false;
      const { t, d } = projectOnSegment(point, w.a, w.b);
      return d < 1e-3 && t > 1e-4 && t < 1 - 1e-4;
    });
    if (!wall) return;
    const sCut = dist(wall.a, point);
    const first = { ...wall, id: newId("w"), b: { ...point }, openings: [] };
    const second = { ...wall, id: newId("w"), a: { ...point }, openings: [] };
    wall.openings.forEach((o) => {
      if (o.offset + o.width <= sCut) first.openings.push(o);
      else if (o.offset >= sCut) second.openings.push({ ...o, offset: o.offset - sCut });
    });
    lvl(project).walls.splice(lvl(project).walls.indexOf(wall), 1, first, second);
    // los balcones siguen al tramo donde queda su centro
    (lvl(project).balconies ?? []).forEach((b) => {
      if (b.wallId !== wall.id) return;
      if (b.offset + b.width / 2 <= sCut) b.wallId = first.id;
      else Object.assign(b, { wallId: second.id, offset: Math.max(0, b.offset - sCut) });
    });
  }

  function addWall(type, a, b) {
    if (dist(a, b) < 0.1) return null;
    const id = newId("w");
    store.update((p) => {
      if (type === "exterior") {
        splitExteriorAt(p, a);
        splitExteriorAt(p, b);
      }
      lvl(p).walls.push({ id, type, a: { ...a }, b: { ...b }, openings: [] });
    });
    return id;
  }

  function addRectangle(a, b) {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    if (x1 - x0 < 0.5 || y1 - y0 < 0.5) return;
    const pts = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    store.update((p) => {
      pts.forEach((pt, i) => lvl(p).walls.push({ id: newId("w"), type: "exterior", a: pt, b: pts[(i + 1) % 4], openings: [] }));
    });
  }

  function addOpening(kind, raw) {
    const walls = lvl(store.project).walls;
    let hit = null;
    walls.forEach((w) => {
      const { d, t } = projectOnSegment(raw, w.a, w.b);
      if (d < tol(16) && (!hit || d < hit.d)) hit = { w, d, t };
    });
    if (!hit) {
      flash("Tocá sobre un muro para ubicar la abertura.");
      return;
    }
    const { w } = hit;
    const L = wallLength(w);
    const def = DEFAULT_OPENINGS[kind];
    const width = Math.min(def.width, L - 0.3);
    let offset = Math.round((hit.t * L - width / 2) / snapStep) * snapStep;
    offset = Math.max(0.15, Math.min(L - width - 0.15, offset));
    const clash = w.openings.some((o) => offset < o.offset + o.width + 0.1 && offset + width > o.offset - 0.1);
    if (clash || width < 0.4) {
      flash("No entra: se superpone con otra abertura o el muro es muy corto.");
      return;
    }
    const id = newId("o");
    const extra = kind === "door" ? { hinge: "start", swing: defaultSwing(w, wallFootprint(gen?.levels?.[level], w)) } : {};
    store.update((p) => {
      lvl(p).walls.find((x) => x.id === w.id).openings.push({ id, kind, offset, width, height: def.height, sill: def.sill, ...extra });
    });
    setSelection({ type: "opening", wallId: w.id, openingId: id });
  }

  function deleteSelection() {
    if (!selection || ["exposed", "floor", "roof"].includes(selection.type)) return;
    const sel = selection;
    store.update((p) => {
      if (sel.type === "wall") {
        lvl(p).walls = lvl(p).walls.filter((w) => w.id !== sel.wallId);
        lvl(p).balconies = (lvl(p).balconies ?? []).filter((b) => b.wallId !== sel.wallId);
      }
      else if (sel.type === "stair") lvl(p).stairs = (lvl(p).stairs ?? []).filter((st) => st.id !== sel.stairId);
      else if (sel.type === "balcony") lvl(p).balconies = (lvl(p).balconies ?? []).filter((b) => b.id !== sel.balconyId);
      else {
        const w = lvl(p).walls.find((x) => x.id === sel.wallId);
        if (w) w.openings = w.openings.filter((o) => o.id !== sel.openingId);
      }
    });
    setSelection(null);
  }

  // ---------- Hit test ----------
  function hitTest(raw) {
    const p = model();
    // barrido de las puertas (cuarto de círculo de la hoja)
    for (const w of lvl(p).walls) {
      for (const o of w.openings) {
        if (o.kind !== "door") continue;
        const leaf = doorLeaf(w, o);
        const rel = { x: raw.x - leaf.hingePt.x, y: raw.y - leaf.hingePt.y };
        const along = { x: leaf.freePt.x - leaf.hingePt.x, y: leaf.freePt.y - leaf.hingePt.y };
        const a = (rel.x * along.x + rel.y * along.y) / o.width;
        const b = rel.x * leaf.out.x + rel.y * leaf.out.y;
        if (a >= -0.05 && b > 0.05 && Math.hypot(a, b) <= o.width + tol(6)) return { type: "opening", wallId: w.id, openingId: o.id };
      }
    }
    for (const w of lvl(p).walls) {
      const L = wallLength(w);
      const { d, t } = projectOnSegment(raw, w.a, w.b);
      if (d > Math.max(tol(10), WALL_THICKNESS)) continue;
      const sPos = t * L;
      const o = w.openings.find((op) => sPos >= op.offset && sPos <= op.offset + op.width);
      if (o) return { type: "opening", wallId: w.id, openingId: o.id };
    }
    let best = null;
    lvl(p).walls.forEach((w) => {
      const { d } = projectOnSegment(raw, w.a, w.b);
      if (d < Math.max(tol(10), WALL_THICKNESS) && (!best || d < best.d)) best = { d, wallId: w.id };
    });
    if (best) return { type: "wall", wallId: best.wallId };
    const st = stairAt(raw);
    if (st) return { type: "stair", stairId: st.id };
    const bal = balconyAt(raw);
    if (bal) return { type: "balcony", balconyId: bal.id };
    return exposedAt(raw);
  }

  function vertexAt(raw) {
    let best = null;
    lvl(model()).walls.forEach((w) =>
      [w.a, w.b].forEach((e) => {
        const d = dist(raw, e);
        if (d < tol(12) && (!best || d < best.d)) best = { d, key: pointKey(e), p: { ...e } };
      })
    );
    return best;
  }

  // ---------- Selección ----------
  function setSelection(sel) {
    selection = sel;
    render();
    onSelectionChange?.(selection);
  }

  function setTool(next) {
    tool = next;
    chain = null;
    rectStart = null;
    stairStart = null;
    typed = "";
    svg.dataset.tool = tool;
    render();
    onToolChange?.(tool);
  }

  let flashTimer = null;
  function flash(message) {
    if (!status) return;
    status.textContent = message;
    status.classList.add("is-alert");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      status.classList.remove("is-alert");
      updateStatus();
    }, 2600);
  }

  function updateStatus() {
    if (!status || status.classList.contains("is-alert")) return;
    const hints = {
      select: "Tocá un muro, abertura, escalera, balcón o la parte descubierta para editarlo. Arrastrá los extremos para mover vértices.",
      rect: "Arrastrá (o tocá dos esquinas) para crear un contorno rectangular.",
      exterior: "Tocá para ir marcando muros exteriores. Escribí un largo y Enter para medidas exactas. Doble toque o Esc para terminar.",
      interior: "Tocá para marcar tabiques interiores. Se enganchan a los muros existentes.",
      door: "Tocá sobre un muro para agregar una puerta.",
      window: "Tocá sobre un muro para agregar una ventana.",
      floor: "Tocá dentro de una estructura cerrada para ver y editar su piso.",
      roof: "Tocá dentro de una estructura cerrada para ver y editar su techo.",
      balcony: "Tocá un muro exterior para colocar un balcón y editar sus medidas.",
      stair: stairEnv()
        ? "Tocá donde arranca la escalera y después hacia dónde sube. Se calcula sola según el reglamento."
        : "Para poner una escalera hace falta un nivel encima: tocá + en la barra de niveles."
    };
    let text = hints[tool] ?? "";
    if (chain && cursor) {
      text = `Largo: ${fmt(dist(chain.last, cursor.p))} m${typed ? ` · escribiendo ${typed} m` : ""} · Enter confirma · Esc termina`;
    } else if (stairStart && cursor) {
      text = "Tocá hacia donde sube la escalera para ubicarla. Esc cancela.";
    } else if (rectStart && cursor) {
      text = `Rectángulo ${fmt(Math.abs(cursor.p.x - rectStart.x))} × ${fmt(Math.abs(cursor.p.y - rectStart.y))} m`;
    }
    status.textContent = text;
  }

  // ---------- Eventos ----------
  function onPointerDown(evt) {
    svg.setPointerCapture(evt.pointerId);
    pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2, scale: view.scale, ox: view.ox, oy: view.oy };
      drag = null;
      return;
    }
    const raw = toModel(evt);
    if (evt.button === 1 || evt.button === 2 || evt.altKey) {
      drag = { kind: "pan", sx: evt.clientX, sy: evt.clientY, ox: view.ox, oy: view.oy };
      return;
    }
    if (tool === "floor" || tool === "roof") {
      const region = levelFootprints(gen?.levels?.[level]).findIndex(poly => pointInPolygon(raw, poly));
      if (region < 0) { flash("Cerrá el contorno exterior y tocá dentro de la estructura para colocar piso y techo."); return; }
      const type = tool;
      setTool("select"); setSelection({ type, region });
      return;
    }
    if (tool === "balcony") {
      const hit = lvl(store.project).walls.filter(w => w.type === "exterior").map(w => ({ w, ...projectOnSegment(raw, w.a, w.b) }))
        .filter(h => h.d < Math.max(tol(16), WALL_THICKNESS)).sort((a, b) => a.d - b.d)[0];
      if (!hit || !wallFootprint(gen?.levels?.[level], hit.w)) { flash("Tocá un muro exterior de una estructura con contorno cerrado."); return; }
      const effective = gen?.effectiveWalls?.[level];
      if (effective && !effective.some(w => w.type === "exterior" && (w.sourceWallIds ?? [w.id]).includes(hit.w.id))) {
        flash("Ese muro queda dentro del conjunto. Elegí un borde exterior para el balcón."); return;
      }
      let balcony;
      store.update(p => { balcony = placeBalcony(lvl(p), hit.w.id, hit.t * wallLength(hit.w)); });
      if (!balcony) { flash("Elegí un tramo exterior de al menos 0,80 m para colocar el balcón."); return; }
      setTool("select"); setSelection({ type: "balcony", balconyId: balcony.id });
      return;
    }
    if (tool === "select") {
      const vtx = vertexAt(raw);
      if (vtx && selection?.type === "wall") {
        drag = { kind: "vertex", key: vtx.key, origin: vtx.p, moved: false };
        return;
      }
      const hit = hitTest(raw);
      if (hit?.type === "opening") {
        const w = lvl(store.project).walls.find((x) => x.id === hit.wallId);
        const o = w.openings.find((x) => x.id === hit.openingId);
        // doble clic o doble toque sobre una puerta: cambia hacia dónde abre
        const now = performance.now();
        const again = lastDoorTap && lastDoorTap.id === o.id && now - lastDoorTap.t < 420 && Math.hypot(evt.clientX - lastDoorTap.x, evt.clientY - lastDoorTap.y) < 12;
        lastDoorTap = { id: o.id, t: now, x: evt.clientX, y: evt.clientY };
        if (again && o.kind === "door") {
          lastDoorTap = null;
          cycleDoor(w.id, o.id);
          return;
        }
        const sPos = dot(sub(raw, w.a), wallDir(w));
        drag = { kind: "opening", wallId: w.id, openingId: o.id, grab: sPos - o.offset, moved: false };
        setSelection(hit);
        return;
      }
      if (vtx) {
        drag = { kind: "vertex", key: vtx.key, origin: vtx.p, moved: false };
        return;
      }
      if (hit?.type === "balcony") {
        const bal = (lvl(store.project).balconies ?? []).find((x) => x.id === hit.balconyId);
        const wall = lvl(store.project).walls.find((w) => w.id === bal.wallId);
        drag = { kind: "balcony", balconyId: bal.id, grab: dot(sub(raw, wall.a), wallDir(wall)) - bal.offset, moved: false };
        setSelection(hit);
        return;
      }
      if (hit?.type === "stair") {
        const st = (lvl(store.project).stairs ?? []).find((x) => x.id === hit.stairId);
        drag = { kind: "stair", stairId: st.id, grab: { x: raw.x - st.x, y: raw.y - st.y }, moved: false };
        setSelection(hit);
        return;
      }
      setSelection(hit);
      if (!hit) drag = { kind: "pan", sx: evt.clientX, sy: evt.clientY, ox: view.ox, oy: view.oy };
      return;
    }
    if (tool === "door" || tool === "window") {
      addOpening(tool, raw);
      return;
    }
    if (tool === "stair") {
      if (!stairEnv()) {
        flash("Para poner una escalera hace falta un nivel encima. Tocá + en la barra de niveles.");
        return;
      }
      const p = { x: Math.round(raw.x / snapStep) * snapStep, y: Math.round(raw.y / snapStep) * snapStep };
      if (!stairStart) {
        stairStart = p;
        render();
        return;
      }
      const id = newId("s");
      const st = fitStairToWalls({ id, ...STAIR_DEFAULTS, x: stairStart.x, y: stairStart.y, dir: dirFrom(stairStart, raw) }, lvl(store.project).walls);
      stairStart = null;
      store.update((pr) => {
        const L = lvl(pr);
        L.stairs = [...(L.stairs ?? []), st];
      });
      setTool("select");
      setSelection({ type: "stair", stairId: id });
      return;
    }
    const snapped = snapPoint(raw, { anchor: chain?.last ?? null, freeAxis: evt.shiftKey });
    if (tool === "rect") {
      if (!rectStart) {
        rectStart = snapped.p;
        drag = { kind: "rect", sx: evt.clientX, sy: evt.clientY };
      } else {
        addRectangle(rectStart, snapped.p);
        rectStart = null;
      }
      render();
      return;
    }
    if (tool === "exterior" || tool === "interior") {
      handleChainPoint(snapped.p);
    }
  }

  function handleChainPoint(point) {
    if (!chain) {
      chain = { type: tool, start: point, last: point };
    } else {
      if (dist(point, chain.last) < 0.05) return;
      addWall(chain.type, chain.last, point);
      const closes = dist(point, chain.start) < 1e-6;
      chain = closes ? null : { ...chain, last: point };
    }
    typed = "";
    render();
  }

  let lastTap = 0;
  let lastDoorTap = null;
  function onPointerUp(evt) {
    pointers.delete(evt.pointerId);
    if (pointers.size < 2) pinch = null;
    const now = performance.now();
    if ((tool === "exterior" || tool === "interior") && evt.pointerType !== "mouse" && now - lastTap < 320) {
      chain = null;
      render();
    }
    lastTap = now;
    if (!drag) return;
    const current = drag;
    drag = null;
    if (current.kind === "rect") {
      const moved = Math.hypot(evt.clientX - current.sx, evt.clientY - current.sy) > 8;
      if (moved && rectStart && cursor) {
        addRectangle(rectStart, cursor.p);
        rectStart = null;
      }
      render();
      return;
    }
    if (current.kind === "stair" && draft) {
      const finalProject = draft;
      draft = null;
      if (current.moved) {
        const L = lvl(finalProject);
        L.stairs = L.stairs.map((st) => (st.id === current.stairId ? fitStairToWalls(st, L.walls) : st));
        store.replace(finalProject, "drag");
      } else render();
      return;
    }
    if ((current.kind === "vertex" || current.kind === "opening" || current.kind === "balcony") && draft) {
      const finalProject = draft;
      draft = null;
      if (current.moved) store.replace(finalProject, "drag");
      else render();
    }
  }

  function onPointerMove(evt) {
    if (pointers.has(evt.pointerId)) pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
    if (pinch && pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;
      const rect = svg.getBoundingClientRect();
      const k = Math.min(Math.max((pinch.scale * d) / pinch.d, 10), 400) / pinch.scale;
      view.scale = pinch.scale * k;
      view.ox = cx - rect.left - (pinch.cx - rect.left - pinch.ox) * k;
      view.oy = cy - rect.top - (pinch.cy - rect.top - pinch.oy) * k;
      render();
      return;
    }
    const raw = toModel(evt);
    if (drag?.kind === "pan") {
      view.ox = drag.ox + evt.clientX - drag.sx;
      view.oy = drag.oy + evt.clientY - drag.sy;
      render();
      return;
    }
    if (drag?.kind === "vertex") {
      const snapped = snapPoint(raw, { excludeKey: drag.key });
      const next = JSON.parse(JSON.stringify(store.project));
      lvl(next).walls.forEach((w) => {
        if (pointKey(w.a) === drag.key) w.a = { ...snapped.p };
        if (pointKey(w.b) === drag.key) w.b = { ...snapped.p };
      });
      drag.moved = dist(snapped.p, drag.origin) > 1e-6;
      draft = next;
      cursor = snapped;
      render();
      return;
    }
    if (drag?.kind === "stair") {
      const next = JSON.parse(JSON.stringify(store.project));
      const st = (lvl(next).stairs ?? []).find((x) => x.id === drag.stairId);
      const nx = Math.round((raw.x - drag.grab.x) / snapStep) * snapStep;
      const ny = Math.round((raw.y - drag.grab.y) / snapStep) * snapStep;
      drag.moved = drag.moved || Math.abs(nx - st.x) > 1e-6 || Math.abs(ny - st.y) > 1e-6;
      st.x = nx;
      st.y = ny;
      draft = next;
      render();
      return;
    }
    if (drag?.kind === "balcony") {
      const next = JSON.parse(JSON.stringify(store.project));
      const bal = (lvl(next).balconies ?? []).find((x) => x.id === drag.balconyId);
      const w = lvl(next).walls.find((x) => x.id === bal.wallId);
      const L = wallLength(w);
      let offset = Math.round((dot(sub(raw, w.a), wallDir(w)) - drag.grab) / snapStep) * snapStep;
      offset = Math.max(0, Math.min(Math.max(L - bal.width, 0), offset));
      drag.moved = drag.moved || Math.abs(offset - bal.offset) > 1e-6;
      bal.offset = Math.round(offset * 1000) / 1000;
      draft = next;
      render();
      return;
    }
    if (drag?.kind === "opening") {
      const next = JSON.parse(JSON.stringify(store.project));
      const w = lvl(next).walls.find((x) => x.id === drag.wallId);
      const o = w.openings.find((x) => x.id === drag.openingId);
      const L = wallLength(w);
      let offset = Math.round((dot(sub(raw, w.a), wallDir(w)) - drag.grab) / snapStep) * snapStep;
      offset = Math.max(0.1, Math.min(L - o.width - 0.1, offset));
      drag.moved = drag.moved || Math.abs(offset - o.offset) > 1e-6;
      o.offset = offset;
      draft = next;
      render();
      return;
    }
    if (tool === "exterior" || tool === "interior" || tool === "rect") {
      cursor = snapPoint(raw, { anchor: chain?.last ?? null, freeAxis: evt.shiftKey });
      render();
    } else if (tool === "stair") {
      cursor = { p: raw, kind: "grid" };
      render();
    } else if (cursor) {
      cursor = null;
      render();
    }
  }

  function onWheel(evt) {
    evt.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = evt.clientX - rect.left;
    const my = evt.clientY - rect.top;
    zoomAt(mx, my, Math.exp(-evt.deltaY * 0.0015));
  }

  function zoomAt(mx, my, factor) {
    const next = Math.min(Math.max(view.scale * factor, 10), 400);
    const k = next / view.scale;
    view.ox = mx - (mx - view.ox) * k;
    view.oy = my - (my - view.oy) * k;
    view.scale = next;
    render();
  }

  function onKeyDown(evt) {
    const target = evt.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
    if (evt.key === "Escape") {
      if (chain || rectStart || typed || stairStart) {
        chain = null;
        rectStart = null;
        stairStart = null;
        typed = "";
        render();
      } else {
        setSelection(null);
      }
      return;
    }
    if ((evt.key === "Delete" || evt.key === "Backspace") && selection && !chain) {
      evt.preventDefault();
      deleteSelection();
      return;
    }
    if (chain) {
      if (/^[0-9]$/.test(evt.key) || ((evt.key === "." || evt.key === ",") && !typed.includes("."))) {
        typed += evt.key === "," ? "." : evt.key;
        updateStatus();
        return;
      }
      if (evt.key === "Backspace") {
        typed = typed.slice(0, -1);
        updateStatus();
        return;
      }
      if (evt.key === "Enter") {
        const len = Number(typed);
        if (typed && len > 0 && cursor) {
          const dir = normalize(sub(cursor.p, chain.last));
          const r = (v) => Math.round(v * 1000) / 1000;
          if (dir.x || dir.y) handleChainPoint({ x: r(chain.last.x + dir.x * len), y: r(chain.last.y + dir.y * len) });
        } else {
          chain = null;
          render();
        }
      }
    }
  }

  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointercancel", onPointerUp);
  svg.addEventListener("pointerleave", () => {
    if (!drag && cursor) {
      cursor = null;
      render();
    }
  });
  svg.addEventListener("dblclick", () => {
    if (tool === "select") return;
    chain = null;
    render();
  });

  /** Recorre las cuatro combinaciones de bisagra y lado de apertura. */
  function cycleDoor(wallId, openingId) {
    store.update((p) => {
      const o = lvl(p).walls.find((w) => w.id === wallId)?.openings.find((x) => x.id === openingId);
      if (!o) return;
      const order = [["start", 1], ["end", 1], ["end", -1], ["start", -1]];
      const i = order.findIndex(([h, sw]) => h === (o.hinge ?? "start") && sw === (o.swing ?? 1));
      const [hinge, swing] = order[(i + 1) % order.length];
      o.hinge = hinge;
      o.swing = swing;
    });
  }
  svg.addEventListener("wheel", onWheel, { passive: false });
  svg.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", onKeyDown);

  // ---------- Dibujo ----------
  function render() {
    const project = model();
    const rect = svg.getBoundingClientRect();
    const W = rect.width || 800;
    const H = rect.height || 600;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const parts = [];

    // grilla
    const minX = Math.floor(-view.ox / view.scale);
    const maxX = Math.ceil((W - view.ox) / view.scale);
    const minY = Math.floor(-view.oy / view.scale);
    const maxY = Math.ceil((H - view.oy) / view.scale);
    const minorStep = view.scale > 45 ? 0.5 : view.scale > 20 ? 1 : 5;
    for (let x = Math.floor(minX / minorStep) * minorStep; x <= maxX; x += minorStep) {
      const sx = x * view.scale + view.ox;
      const major = Math.abs(x - Math.round(x)) < 1e-9;
      parts.push(`<line x1="${sx}" y1="0" x2="${sx}" y2="${H}" class="${major ? "grid-major" : "grid-minor"}"/>`);
    }
    for (let y = Math.floor(minY / minorStep) * minorStep; y <= maxY; y += minorStep) {
      const sy = y * view.scale + view.oy;
      const major = Math.abs(y - Math.round(y)) < 1e-9;
      parts.push(`<line x1="0" y1="${sy}" x2="${W}" y2="${sy}" class="${major ? "grid-major" : "grid-minor"}"/>`);
    }

    // nivel inferior como referencia
    ghostWalls(project).forEach((w) => {
      const a = toScreen(w.a);
      const b = toScreen(w.b);
      parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="wall-ghost"/>`);
    });

    // superficie cubierta
    const footprint = gen?.levels?.[level]?.footprint;
    if (!draft) levelFootprints(gen?.levels?.[level]).forEach((poly, region) => {
      const selected = ["floor", "roof"].includes(selection?.type) && selection.region === region;
      parts.push(`<polygon class="footprint${selected ? " surface-selected" : ""}" data-region="${region}" points="${poly.map((p) => { const s = toScreen(p); return `${s.x},${s.y}`; }).join(" ")}"/>`);
    });

    const wt = Math.max(WALL_THICKNESS * view.scale, 4);
    // muros
    lvl(project).walls.forEach((w) => {
      const a = toScreen(w.a);
      const b = toScreen(w.b);
      const selected = selection?.wallId === w.id && selection.type === "wall";
      parts.push(
        `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="wall wall--${w.type}${selected ? " is-selected" : ""}" stroke-width="${w.type === "interior" ? wt * 0.75 : wt}"/>`
      );
    });

    // aberturas
    lvl(project).walls.forEach((w) => {
      const dir = wallDir(w);
      const n = { x: -dir.y, y: dir.x };
      w.openings.forEach((o) => {
        const p1 = toScreen({ x: w.a.x + dir.x * o.offset, y: w.a.y + dir.y * o.offset });
        const p2 = toScreen({ x: w.a.x + dir.x * (o.offset + o.width), y: w.a.y + dir.y * (o.offset + o.width) });
        const selected = selection?.openingId === o.id;
        parts.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" class="opening-gap" stroke-width="${wt + 2}"/>`);
        const half = (wt / 2) * 0.55;
        if (o.kind === "window") {
          [-half, half].forEach((k) => {
            parts.push(`<line x1="${p1.x + n.x * k}" y1="${p1.y + n.y * k}" x2="${p2.x + n.x * k}" y2="${p2.y + n.y * k}" class="opening opening--window${selected ? " is-selected" : ""}"/>`);
          });
          parts.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" class="opening opening--window${selected ? " is-selected" : ""}"/>`);
        } else {
          const leaf = doorLeaf(w, o);
          const H = toScreen(leaf.hingePt);
          const T = toScreen(leaf.tip);
          const P = toScreen(leaf.freePt);
          const r = o.width * view.scale;
          const u = { x: T.x - H.x, y: T.y - H.y };
          const v = { x: P.x - H.x, y: P.y - H.y };
          const sweep = u.x * v.y - u.y * v.x > 0 ? 1 : 0;
          parts.push(`<line x1="${H.x}" y1="${H.y}" x2="${T.x}" y2="${T.y}" class="opening opening--door${selected ? " is-selected" : ""}"/>`);
          parts.push(`<path d="M ${T.x} ${T.y} A ${r} ${r} 0 0 ${sweep} ${P.x} ${P.y}" class="opening-swing${selected ? " is-selected" : ""}"/>`);
          parts.push(`<circle cx="${H.x}" cy="${H.y}" r="${Math.max(2.5, wt * 0.22)}" class="door-hinge${selected ? " is-selected" : ""}"/>`);
        }
      });
    });

    // columnas generadas
    if (gen && !draft) {
      const colSize = gen.members.find((m) => m.group === "Columnas")?.w ?? 0.1;
      (gen.levels?.[level]?.columns ?? []).forEach((pt) => {
        const c = toScreen(pt);
        const s = Math.max(colSize * view.scale, 5);
        parts.push(`<rect x="${c.x - s / 2}" y="${c.y - s / 2}" width="${s}" height="${s}" class="column"/>`);
      });
    }

    // parte descubierta de este nivel (techo a un agua o terraza) y la del nivel de abajo como referencia
    const drawExposed = (list, ghost) => {
      list.forEach((part) => {
        const selected = !ghost && selection?.type === "exposed";
        part.outline.forEach((loop) => {
          const pts = loop.map(toScreen);
          parts.push(`<polygon class="exposed exposed--${part.kind}${ghost ? " exposed--ghost" : ""}${selected ? " is-selected" : ""}" points="${pts.map((q) => `${q.x},${q.y}`).join(" ")}"/>`);
        });
        if (ghost || view.scale < 14) return;
        const xs = part.outline.flat().map((p) => p.x);
        const ys = part.outline.flat().map((p) => p.y);
        let c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
        if (!part.outline.some((loop) => pointInPolygon(c, loop))) c = part.outline[0][0];
        const L = Math.min(part.run * 0.35, 1.1);
        const a = toScreen({ x: c.x - part.d.x * L / 2, y: c.y - part.d.y * L / 2 });
        const b = toScreen({ x: c.x + part.d.x * L / 2, y: c.y + part.d.y * L / 2 });
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const ah = 7;
        parts.push(`<line class="exposed-arrow" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
        parts.push(`<path class="exposed-head" d="M ${b.x} ${b.y} L ${b.x - ah * Math.cos(ang - 0.45)} ${b.y - ah * Math.sin(ang - 0.45)} L ${b.x - ah * Math.cos(ang + 0.45)} ${b.y - ah * Math.sin(ang + 0.45)} Z"/>`);
        const label = part.kind === "terraza" ? "TERRAZA" : `TECHO ${fmt(part.slope * 100).replace(/,00$/, "")} %`;
        const cs = toScreen(c);
        parts.push(`<text x="${cs.x}" y="${cs.y - 10}" class="exposed-label">${label}</text>`);
      });
    };
    if (!draft) {
      if (level > 0) drawExposed((gen?.levels?.[level - 1]?.exposed ?? []), true);
      drawExposed(gen?.levels?.[level]?.exposed ?? [], false);
    }

    // balcones de este nivel
    (lvl(project).balconies ?? []).forEach((bal) => {
      const g = balconyPolyOf(project, bal);
      if (!g) return;
      const selected = selection?.type === "balcony" && selection.balconyId === bal.id;
      const pts = g.poly.map(toScreen);
      parts.push(`<polygon class="balcony${selected ? " is-selected" : ""}" points="${pts.map((q) => `${q.x},${q.y}`).join(" ")}"/>`);
      if (bal.railing !== false) {
        parts.push(`<polyline class="balcony-rail" points="${[pts[1], pts[2], pts[3], pts[0]].map((q) => `${q.x},${q.y}`).join(" ")}"/>`);
      }
      if (view.scale > 18) {
        const c = toScreen({ x: g.poly.reduce((sum, p) => sum + p.x, 0) / 4, y: g.poly.reduce((sum, p) => sum + p.y, 0) / 4 });
        parts.push(`<text x="${c.x}" y="${c.y}" class="stair-label">BALCÓN${bal.support === "columnas" ? " · CON COLUMNAS" : ""}</text>`);
      }
    });

    // huecos de escalera en este nivel (vienen del nivel de abajo)
    (gen?.levels?.[level]?.holes ?? []).forEach((loop) => {
      if (draft) return;
      const pts = loop.map((p) => toScreen(p));
      parts.push(`<polygon class="stair-hole" points="${pts.map((q) => `${q.x},${q.y}`).join(" ")}"/>`);
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      parts.push(`<text x="${cx}" y="${cy}" class="stair-label">HUECO · BAJA</text>`);
    });

    // escaleras que arrancan en este nivel
    const drawStair = (st, preview = false) => {
      const lay = layoutFor(st);
      if (!lay || !lay.solution.ok) return;
      const selected = selection?.type === "stair" && selection.stairId === st.id;
      const cls = `stair${selected ? " is-selected" : ""}${preview ? " stair--preview" : ""}`;
      lay.outline.forEach((loop) => {
        parts.push(`<polygon class="${cls}" points="${loop.map((p) => { const q = toScreen(p); return `${q.x},${q.y}`; }).join(" ")}"/>`);
      });
      lay.treads.forEach((t) => {
        const q = t.poly.map(toScreen);
        parts.push(`<polygon class="stair-tread" points="${q.map((v) => `${v.x},${v.y}`).join(" ")}"/>`);
      });
      lay.landings.forEach((l) => {
        const q = l.poly.map(toScreen);
        parts.push(`<polygon class="stair-landing" points="${q.map((v) => `${v.x},${v.y}`).join(" ")}"/>`);
      });
      // línea de huella con flecha hacia donde sube
      const path = [];
      lay.flights.forEach((f, i) => {
        if (i === 0) path.push(f.start);
        path.push(f.end);
        const next = lay.flights[i + 1];
        if (next) path.push(next.start);
      });
      const scr = path.map(toScreen);
      parts.push(`<polyline class="stair-path" points="${scr.map((q) => `${q.x},${q.y}`).join(" ")}"/>`);
      const tip = scr[scr.length - 1];
      const prev = scr[scr.length - 2] ?? scr[0];
      const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
      const ah = 8;
      parts.push(`<path class="stair-arrow" d="M ${tip.x} ${tip.y} L ${tip.x - ah * Math.cos(ang - 0.45)} ${tip.y - ah * Math.sin(ang - 0.45)} L ${tip.x - ah * Math.cos(ang + 0.45)} ${tip.y - ah * Math.sin(ang + 0.45)} Z"/>`);
      const s0 = scr[0];
      parts.push(`<circle class="stair-start" cx="${s0.x}" cy="${s0.y}" r="3.5"/>`);
      if (view.scale > 22) {
        const f0 = lay.flights[0];
        const mid = toScreen({ x: (f0.start.x + f0.end.x) / 2, y: (f0.start.y + f0.end.y) / 2 });
        parts.push(`<text x="${mid.x}" y="${mid.y - 6}" class="stair-label">SUBE · ${lay.solution.n} × ${fmt(lay.solution.a)} m</text>`);
      }
    };
    (lvl(project).stairs ?? []).forEach((st) => drawStair(st));
    if (tool === "stair" && stairStart && cursor) {
      drawStair({ id: "preview", ...STAIR_DEFAULTS, x: stairStart.x, y: stairStart.y, dir: dirFrom(stairStart, cursor.p) }, true);
    }

    // cotas
    lvl(project).walls.forEach((w) => {
      const L = wallLength(w);
      const dir = wallDir(w);
      let n = { x: -dir.y, y: dir.x };
      const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
      const localFootprint = wallFootprint(gen?.levels?.[level], w);
      if (localFootprint && w.type === "exterior") {
        const probe = { x: mid.x + n.x * 0.2, y: mid.y + n.y * 0.2 };
        if (pointInPolygon(probe, localFootprint)) n = { x: -n.x, y: -n.y };
      }
      const off = w.type === "exterior" ? 0.42 : 0.24;
      const pos = toScreen({ x: mid.x + n.x * off, y: mid.y + n.y * off });
      let angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      if (view.scale > 18) {
        parts.push(`<text x="${pos.x}" y="${pos.y}" class="dim${w.type === "interior" ? " dim--interior" : ""}" transform="rotate(${angle} ${pos.x} ${pos.y})">${fmt(L)}</text>`);
      }
    });

    // manijas de vértices del muro seleccionado
    if (selection?.type === "wall") {
      const w = lvl(project).walls.find((x) => x.id === selection.wallId);
      if (w) {
        [w.a, w.b].forEach((e) => {
          const s = toScreen(e);
          parts.push(`<circle cx="${s.x}" cy="${s.y}" r="7" class="handle"/>`);
        });
      }
    }

    // trazado en curso
    if (chain && cursor) {
      const a = toScreen(chain.last);
      const b = toScreen(cursor.p);
      parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="wall wall--preview wall--${chain.type}" stroke-width="${wt}"/>`);
      const len = dist(chain.last, cursor.p);
      parts.push(`<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - wt}" class="dim dim--live">${fmt(len)} m</text>`);
      const s = toScreen(chain.start);
      parts.push(`<circle cx="${s.x}" cy="${s.y}" r="6" class="chain-start"/>`);
    }
    if (rectStart && cursor) {
      const a = toScreen(rectStart);
      const b = toScreen(cursor.p);
      parts.push(`<rect x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}" class="rect-preview" stroke-width="${wt}"/>`);
    }
    if (cursor && (tool === "exterior" || tool === "interior" || tool === "rect")) {
      const c = toScreen(cursor.p);
      parts.push(`<circle cx="${c.x}" cy="${c.y}" r="${cursor.kind === "grid" ? 3 : 6}" class="snap snap--${cursor.kind}"/>`);
    }

    svg.innerHTML = parts.join("");
    updateStatus();
  }

  function fit() {
    const rect = svg.getBoundingClientRect();
    const pts = [...lvl(store.project).walls, ...ghostWalls(store.project)].flatMap((w) => [w.a, w.b]);
    if (!pts.length || !rect.width) {
      view.scale = 60;
      view.ox = 60;
      view.oy = 60;
      render();
      return;
    }
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs) + 2;
    const h = Math.max(...ys) - Math.min(...ys) + 2;
    view.scale = Math.min(Math.max(Math.min(rect.width / w, rect.height / h), 10), 200);
    view.ox = rect.width / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * view.scale;
    view.oy = rect.height / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * view.scale;
    render();
  }

  return {
    render,
    fit,
    setTool,
    setSelection,
    deleteSelection,
    getSelection: () => selection,
    cycleDoor,
    setLevel(index) {
      level = index;
      chain = null;
      rectStart = null;
      selection = null;
      onSelectionChange?.(null);
      render();
    },
    get level() {
      return level;
    },
    setGeneration(next) {
      gen = next;
      render();
    },
    setSnapStep(step) {
      snapStep = step;
    },
    setOrtho(value) {
      ortho = value;
    },
    zoom(factor) {
      const rect = svg.getBoundingClientRect();
      zoomAt(rect.width / 2, rect.height / 2, factor);
    },
    get tool() {
      return tool;
    }
  };
}

export { NS };
