/**
 * Debounce y cancelación REAL: una nueva edición termina el Worker anterior.
 * Las revisiones y solicitudes evitan mostrar resultados de otro proyecto/caso.
 * workerFactory y reloj inyectables permiten probar carreras sin DOM.
 */
export function createEngineeringClient({onState=()=>{},onResult=()=>{},onDetail=()=>{},onExport=()=>{},onError=()=>{},debounceMs=300,
  workerFactory=()=>new Worker(new URL("./worker.js",import.meta.url),{type:"module"}),setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  let worker=null,timer=null,revision=0,ready=false,requestId=0;
  const client={
    schedule(project,generation) {
      revision++;ready=false;requestId++;clearTimer(timer);worker?.terminate();worker=null;
      const job=revision;onState("calculating");
      timer=setTimer(()=>{
        try {
          const next=workerFactory();worker=next;
          next.onmessage=({data})=>{
            if(next!==worker||data.revision!==revision)return;
            if(data.type==="result"){ready=true;onState("ready");onResult(data.result);}
            else if(data.type==="detail"&&data.requestId===requestId)onDetail(data.response,data.combinationId);
            else if(data.type==="export")onExport(data.json);
            else if(data.type==="error"){ready=false;onState("error");onError(data.message);}
          };
          next.onerror=(event)=>{if(next===worker){ready=false;onState("error");onError(event.message||"No se pudo ejecutar el cálculo de ingeniería.");}};
          next.postMessage({type:"run",revision:job,project,generation});
        } catch(error){ready=false;onState("error");onError(error.message);}
      },debounceMs);
    },
    detail(combinationId){if(!ready||!worker)return false;requestId++;worker.postMessage({type:"detail",revision,requestId,combinationId});return true;},
    export(){if(!ready||!worker)return false;worker.postMessage({type:"export",revision});return true;},
    dispose(){revision++;ready=false;clearTimer(timer);worker?.terminate();worker=null;}
  };
  return client;
}
