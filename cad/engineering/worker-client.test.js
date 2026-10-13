import test from "node:test";
import assert from "node:assert/strict";
import { createEngineeringClient } from "./worker-client.js";

/** Reloj y Worker controlables para reproducir respuestas fuera de orden sin demoras reales. */
function harness() {
  const workers=[],results=[],details=[],errors=[],timers=new Map();let timerId=0;
  const client=createEngineeringClient({workerFactory:()=>{const w={messages:[],terminated:false,postMessage(m){this.messages.push(m);},terminate(){this.terminated=true;}};workers.push(w);return w;},setTimer:f=>{timers.set(++timerId,f);return timerId;},clearTimer:id=>timers.delete(id),onResult:r=>results.push(r),onDetail:r=>details.push(r),onError:e=>errors.push(e)});
  const flush=()=>{const tasks=[...timers.values()];timers.clear();tasks.forEach(f=>f());};
  const reply=(w,data)=>w.onmessage({data:{revision:w.messages[0].revision,...data}});
  return {client,workers,results,details,errors,flush,reply};
}

test("Editar durante el cálculo lo cancela; el resultado anterior no puede publicarse",()=>{
  const h=harness();h.client.schedule({id:1},{});h.flush();const old=h.workers[0];
  h.client.schedule({id:2},{});assert.equal(old.terminated,true);
  h.reply(old,{type:"result",result:{project:1}});assert.deepEqual(h.results,[]);
  h.flush();h.reply(h.workers[1],{type:"result",result:{project:2}});assert.deepEqual(h.results,[{project:2}]);
});

test("Ediciones dentro del debounce ejecutan únicamente el último proyecto",()=>{
  const h=harness();h.client.schedule({id:1},{});h.client.schedule({id:2},{});h.client.schedule({id:3},{});h.flush();
  assert.equal(h.workers.length,1);assert.equal(h.workers[0].messages[0].project.id,3);
});

test("Cambio rápido de combinación: no mezcla la deformada de una con las reacciones de otra",()=>{
  const h=harness();h.client.schedule({},{});h.flush();const w=h.workers[0];h.reply(w,{type:"result",result:{}});
  h.client.detail("A");h.client.detail("B");const a=w.messages[1],b=w.messages[2];
  h.reply(w,{type:"detail",requestId:a.requestId,response:"A"});h.reply(w,{type:"detail",requestId:b.requestId,response:"B"});
  assert.deepEqual(h.details,["B"]);
});

test("Exportación y detalle esperan un resultado vigente; falla del Worker queda visible",()=>{
  const h=harness();h.client.schedule({},{});assert.equal(h.client.export(),false);h.flush();h.reply(h.workers[0],{type:"error",message:"mecanismo"});
  assert.deepEqual(h.errors,["mecanismo"]);assert.equal(h.client.detail("D"),false);h.client.dispose();assert.equal(h.workers[0].terminated,true);
});
