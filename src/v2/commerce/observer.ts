import { ProcessingJobs, type ProcessingRpc } from '../processingJobs.js';
import { PaymentAdapters, type ProviderSnapshot, type Submission } from './providers.js';
export class ProviderPaymentObserver {
  private readonly jobs:ProcessingJobs;
  constructor(private readonly rpc:ProcessingRpc,private readonly providers:Map<string,PaymentAdapters>) { this.jobs=new ProcessingJobs(rpc); }
  async ready() { for(const kind of ['payment-scan','payment-verify']) await this.jobs.ready(kind); }
  async pollOnce() {
    const errors: {provider_key:string;stage:string;code:string}[]=[];
    for(const [key,adapters] of this.providers) {
      let snapshot:ProviderSnapshot;
      try { snapshot=await this.rpc('payment_provider_snapshot',{p_provider:key}); }
      catch { errors.push({provider_key:key,stage:'snapshot',code:'PAYMENT_CONFIG_UNAVAILABLE'});continue; }
      const run=async(stage:string,action:()=>Promise<unknown>)=>{try { await action(); } catch(e) {
        errors.push({provider_key:key,stage,code:e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'PAYMENT_RETRY'});
      }};
      // Submitted hashes get priority and can disambiguate repeated purchases before discovery.
      await run('submissions',async()=>{
        const pending=await this.rpc<Submission[]>('pending_provider_submissions',{p_provider:key});
        for(const p of pending) await run('verify',()=>this.jobs.run('payment-verify',p.submission_id,{submission_id:p.submission_id},async lease=>{
          const result=await adapters.get(snapshot.adapter_kind).verify(snapshot,p);
          await this.rpc('commit_payment_verification',{p_job:lease.job_id,p_token:lease.lease_token,p_submission:p.submission_id,
            p_status:result.status,p_code:result.code,p_events:result.events});
          return {result:null,completed:result.status!=='pending'};
        }));
      });
      await run('scan',()=>this.jobs.run('payment-scan',key,{provider_key:key},async lease=>{
        // Cursor must be reloaded after acquiring the lease.
        const current=await this.rpc<ProviderSnapshot>('payment_provider_snapshot',{p_provider:key});
        const page=await adapters.get(current.adapter_kind).scan(current);
        if(page) await this.rpc('commit_payment_scan',{p_job:lease.job_id,p_token:lease.lease_token,p_provider:key,
          p_from:page.from,p_next:page.next,p_hash:page.hash,p_events:page.events});
        return {result:null,completed:false};
      }));
    }
    return errors;
  }
}
