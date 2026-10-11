// Estado del diseño con deshacer/rehacer y guardado local.
import { createDefaultProject, normalizeProject } from "./model.js";

const STORAGE_KEY = "modularlive_cad_project";
const MAX_HISTORY = 80;

const safeLoad = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeProject(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const safeSave = (project) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    /* almacenamiento no disponible */
  }
};

export function createStore() {
  let project = safeLoad() ?? createDefaultProject();
  let undoStack = [];
  let redoStack = [];
  const listeners = new Set();

  const emit = (reason) => listeners.forEach((fn) => fn(project, reason));

  return {
    get project() {
      return project;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Aplica un cambio. mutate recibe una copia editable del proyecto. */
    update(mutate, reason = "edit") {
      const before = JSON.stringify(project);
      const draft = JSON.parse(before);
      mutate(draft);
      const after = JSON.stringify(draft);
      if (after === before) return;
      undoStack.push(before);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack = [];
      project = normalizeProject(draft);
      safeSave(project);
      emit(reason);
    },
    replace(next, reason = "load") {
      undoStack.push(JSON.stringify(project));
      redoStack = [];
      project = normalizeProject(next);
      safeSave(project);
      emit(reason);
    },
    undo() {
      if (!undoStack.length) return;
      redoStack.push(JSON.stringify(project));
      project = normalizeProject(JSON.parse(undoStack.pop()));
      safeSave(project);
      emit("undo");
    },
    redo() {
      if (!redoStack.length) return;
      undoStack.push(JSON.stringify(project));
      project = normalizeProject(JSON.parse(redoStack.pop()));
      safeSave(project);
      emit("redo");
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0
  };
}
