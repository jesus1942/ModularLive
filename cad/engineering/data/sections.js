// Propiedades geométricas NOMINALES, coherentes con PROFILES y el peso del BOM.
// No representan ancho efectivo, radios reales ni resistencias de fabricante.
// Iy: flexión sobre la altura h, Iz: sobre el ancho b. Unidades SI.

/** Área, inercias y torsión de la sección real elegida; null si no está implementada. */
export function nominalSectionProperties(profile) {
  if (!profile) return null;
  const { b,h,t,shape }=profile;
  if (![b,h,t].every(v=>Number.isFinite(v)&&v>0)) return null;
  if(shape==="rhs") {
    if(2*t>=Math.min(b,h))return null;
    const A_m2=b*h-(b-2*t)*(h-2*t);
    const Iy_m4=(b*h**3-(b-2*t)*(h-2*t)**3)/12;
    const Iz_m4=(h*b**3-(h-2*t)*(b-2*t)**3)/12;
    // Bredt-Batho de pared delgada: J=4 Am² / ∮(ds/t), sección cerrada.
    const J_m4=4*((b-t)*(h-t))**2/(2*(b+h-2*t)/t);
    return {A_m2,Iy_m4,Iz_m4,J_m4,ry_m:Math.sqrt(Iy_m4/A_m2),rz_m:Math.sqrt(Iz_m4/A_m2),basis:"Dimensiones nominales sin radios; J por Bredt-Batho de pared delgada. Confirmar tabla del proveedor."};
  }
  if(shape==="round") {
    const A_m2=Math.PI*b*b/4,Iy_m4=Math.PI*b**4/64;
    return {A_m2,Iy_m4,Iz_m4:Iy_m4,J_m4:2*Iy_m4,ry_m:b/4,rz_m:b/4,basis:"Barra maciza circular, dimensiones nominales."};
  }
  return null;
}
