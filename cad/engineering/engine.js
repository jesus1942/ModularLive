import { computeDeadLoad } from "./loads.js";

export const ENGINE_VERSION = "0.1.0";
export const PROJECT_AUTHOR = "Jesús Olguín · jesus.olguin";

/** Ejecuta los chequeos efectivamente implementados sobre la generación que usa el 3D y el BOM. */
export function runEngineering(project, generation) {
  return { version: ENGINE_VERSION, phase: 0, author: PROJECT_AUTHOR, ...computeDeadLoad(project, generation) };
}
