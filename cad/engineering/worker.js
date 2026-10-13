import { runEngineering } from "./engine.js";
import { responseForCombination } from "./analysis.js";

let current=null,project=null,revision=null;

/** Resultado de interfaz: el detalle voluminoso permanece en el Worker para exportación. */
function viewResult(result) {
  const a=result.analysis;
  if(!a)return result;
  const {caseResponses,tributary,...analysis}=a;
  return {...result,analysis:{...analysis,tributary:{caseCount:tributary.cases.length,traceCount:tributary.traces.length,windRouteCount:tributary.windUnitRoutes.length,scope:"Detalle de cada acción y ruta disponible en el JSON completo."}}};
}

/** Ejecuta fuera del hilo de interfaz; las respuestas llevan la revisión de entrada. */
self.addEventListener("message",({data})=>{
  try {
    if(data.type==="run") {
      revision=data.revision;project=data.project;
      current=runEngineering(project,data.generation);
      self.postMessage({type:"result",revision,result:viewResult(current)});
    } else if(data.revision===revision&&data.type==="detail"&&current) {
      const combination=current.combinations.find(c=>c.id===data.combinationId);
      const response=combination?responseForCombination(current.analysis,combination):null;
      self.postMessage({type:"detail",revision,combinationId:data.combinationId,requestId:data.requestId,response});
    } else if(data.revision===revision&&data.type==="export"&&current) {
      self.postMessage({type:"export",revision,json:JSON.stringify({project,result:current},null,2)});
    }
  } catch(error) {
    self.postMessage({type:"error",revision,message:error.message,details:error.details??{}});
  }
});
