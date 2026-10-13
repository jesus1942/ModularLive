import { normal3D } from "./load-geometry.js";

/** Tipo y pendiente de ESTE paño; los metadatos nuevos prevalecen sobre el techo global. */
export function roofSurfaceGeometry(project,gen,sf) {
  const n=normal3D(sf.points),actual=Math.acos(Math.min(1,Math.abs(n[2])))*180/Math.PI;
  const slope_percent=Number.isFinite(sf.slope_percent)?sf.slope_percent:Math.tan(actual*Math.PI/180)*100;
  const roofType=sf.roofType??(sf.level===gen.levels.length-1?project.roof.type:sf.access==="terraza"?"plano":"una_agua");
  const axis=Math.hypot(n[0],n[1])>1e-8?(Math.abs(n[0])>Math.abs(n[1])?0:1):(gen.levels[sf.level].spanAxis==="x"?0:1);
  return {roofType,slope_percent,theta_deg:Math.atan(slope_percent/100)*180/Math.PI,axis,normal:n[2]<0?n.map(v=>-v):n};
}
