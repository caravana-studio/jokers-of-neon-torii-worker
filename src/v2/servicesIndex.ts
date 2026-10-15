/** Independent child processes: failed runtime bootstrap cannot stop payment recovery. */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const children=new Set<ChildProcess>();
let stopping=false;
const extension=import.meta.url.endsWith('.ts')?'ts':'js';
function start(file:string) {
  if(stopping) return;
  const child=spawn(process.execPath,[fileURLToPath(new URL(file+'.'+extension,import.meta.url))],{stdio:'inherit',env:process.env});
  children.add(child);
  child.on('error',()=>console.error('V2 child could not start',{service:file}));
  child.on('exit',()=>{children.delete(child);if(!stopping) setTimeout(()=>start(file),5000);});
}
for(const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{
  stopping=true;for(const child of children) child.kill(signal);
  setTimeout(()=>{for(const child of children) child.kill('SIGKILL');},20000).unref();
});
start('index');
if(process.env.JOKERS_V2_COMMERCE_CONFIG || process.env.JOKERS_V2_COMMERCE_CONFIG_JSON) start('commerceIndex');
