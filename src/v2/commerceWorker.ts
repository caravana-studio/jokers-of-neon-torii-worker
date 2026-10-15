import type { SupabaseClient } from '@supabase/supabase-js';
import { ProcessingJobs } from './processingJobs.js';
/** Delivery is common to providers. No runtime, wallet execution or outbound payment. */
export class CommerceWorker {
  private readonly jobs:ProcessingJobs;
  constructor(private readonly db:SupabaseClient<any,'api'>,private readonly leased=false) {
    this.jobs=new ProcessingJobs(async(name,args)=>{const r=await db.rpc(name,args);if(r.error) throw Error(r.error.message);return r.data;});
  }
  async replayPending():Promise<number> {
    const {data,error}=await this.db.rpc('pending_commerce_payments');
    if(error) throw Error(error.message);
    let count=0;const errors:unknown[]=[];
    for(const {receipt_id,channel} of data as {receipt_id:string;channel?:string}[]) {
      try {
        if(this.leased||channel==='provider') {
          count+=await this.jobs.run('payment-fulfillment',receipt_id,{receipt_id},async lease=>{
            const r=await this.db.rpc('fulfill_payment_job',{p_job:lease.job_id,p_token:lease.lease_token,p_receipt:receipt_id});
            if(r.error) throw Error(r.error.message);
            return {result:r.data?.status==='fulfilled'?1:0,completed:['fulfilled','review'].includes(r.data?.status)};
          })??0;
        } else {
          const r=await this.db.rpc('process_commerce_payment',{p_receipt:receipt_id});
          if(r.error) throw Error(r.error.message);
          if(r.data?.status==='fulfilled') count++;
        }
      } catch(e) { errors.push(e); }
    }
    if(errors.length) throw new AggregateError(errors,'COMMERCE_DELIVERY_RETRY');
    return count;
  }
}
