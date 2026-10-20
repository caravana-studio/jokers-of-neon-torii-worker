import { ProcessingJobs, type ProcessingRpc } from '../processingJobs.js';
import { PaymentAdapters, type ProviderSnapshot, type Submission, type Observation } from './providers.js';
export class ProviderPaymentObserver {
  private readonly jobs:ProcessingJobs;
  constructor(private readonly rpc:ProcessingRpc,private readonly providers:Map<string,PaymentAdapters>,private readonly afterVerification?:()=>Promise<void>) { this.jobs=new ProcessingJobs(rpc); }
  async ready() { for(const kind of ['payment-scan','payment-verify','payment-finality','payment-recent-scan']) await this.jobs.ready(kind); }
  async pollOnce(mode: "all" | "fast" | "discovery" | "maintenance" = "all") {
    const errors: {provider_key:string;stage:string;code:string}[]=[];
    const entries=[...this.providers];
    for(let offset=0;offset<entries.length;offset+=4) await Promise.all(entries.slice(offset,offset+4).map(async ([key,adapters]) => {
      let snapshot:ProviderSnapshot;
      try { snapshot=await this.rpc('payment_provider_snapshot',{p_provider:key}); }
      catch { errors.push({provider_key:key,stage:'snapshot',code:'PAYMENT_CONFIG_UNAVAILABLE'});return; }
      const run=async(stage:string,action:()=>Promise<unknown>)=>{try { await action(); } catch(e) {
        errors.push({provider_key:key,stage,code:e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'PAYMENT_RETRY'});
      }};
      // Submitted hashes get priority and can disambiguate repeated purchases before discovery.
      if(mode==='all'||mode==='fast') await run('submissions',async()=>{
        const pending=await this.rpc<Submission[]>('pending_provider_submissions',{p_provider:key});
        for(let offset=0;offset<pending.length;offset+=4) await Promise.all(pending.slice(offset,offset+4).map(p=>run('verify',()=>this.jobs.run('payment-verify',p.submission_id,{submission_id:p.submission_id},async lease=>{
          const result=await adapters.get(snapshot.adapter_kind).verify(snapshot,p);
          await this.rpc('commit_receipt_payment_verification',{p_job:lease.job_id,p_token:lease.lease_token,p_submission:p.submission_id,
            p_status:result.status,p_code:result.code,p_events:result.events,p_confirmation:p.order.delivery_confirmation==='receipt'?'mined':'finalized'});
          if(result.status==='verified') await this.afterVerification?.();
          return {result:null,completed:result.status!=='pending'};
        }))));
      });
      if(mode==='all'||mode==='discovery') await run('recent-scan',()=>this.jobs.run('payment-recent-scan',key,{provider_key:key},async lease=>{
        const current=await this.rpc<ProviderSnapshot>('payment_provider_snapshot',{p_provider:key});
        const adapter=adapters.get(current.adapter_kind);
        const page=await adapter.scanRecent?.(current);
        if(page) {
          await this.rpc('commit_recent_payment_scan',{p_job:lease.job_id,p_token:lease.lease_token,p_provider:key,
            p_revision:current.recent!.cursor.revision,p_from:page.from,p_next:page.next,p_hash:page.hash,p_events:page.events});
          await this.afterVerification?.();
        }
        return {result:null,completed:false};
      }));
      if(mode==='all'||mode==='maintenance') await run('finality',async()=>{
        const adapter=adapters.get(snapshot.adapter_kind);
        if(!adapter.reconcile) return;
        const pending=await this.rpc<{observation_id:string;event:Observation}[]>('pending_payment_finality',{p_provider:key});
        for(let offset=0;offset<pending.length;offset+=4) await Promise.all(pending.slice(offset,offset+4).map(item=>run('finality',()=>this.jobs.run('payment-finality',item.observation_id,{observation_id:item.observation_id},async lease=>{
          const result=await adapter.reconcile!(snapshot,item.event);
          await this.rpc('commit_payment_finality',{p_job:lease.job_id,p_token:lease.lease_token,p_observation:item.observation_id,
            p_status:result.status,p_code:result.code});
          if(result.status==='review') console.error('V2 payment finality requires review',{observation_id:item.observation_id,code:result.code});
          return {result:null,completed:result.status!=='pending'};
        }))));
      });
      if(mode==='all'||mode==='maintenance') await run('scan',()=>this.jobs.run('payment-scan',key,{provider_key:key},async lease=>{
        // Cursor must be reloaded after acquiring the lease.
        const current=await this.rpc<ProviderSnapshot>('payment_provider_snapshot',{p_provider:key});
        const page=await adapters.get(current.adapter_kind).scan(current);
        if(page) await this.rpc('commit_payment_scan_checkpoint',{p_job:lease.job_id,p_token:lease.lease_token,p_provider:key,
          p_from:page.from,p_next:page.next,p_hash:page.hash,p_events:page.events,p_covered_through:page.coveredThrough});
        return {result:null,completed:false};
      }));
    }));
    return errors;
  }
}
