import { decodeEventLog, parseAbiItem, toHex } from 'viem';
import type { PaymentAdapter, ProviderSnapshot, Submission, Observation, Verification, ScanPage } from './providers.js';
import { evmAcceptanceHead } from "../chainEvidence/policy.js";
export type EvmRpc = (method: string, params: unknown[]) => Promise<any>;
export function paymentRpc(url: string): EvmRpc {
  const u=new URL(url);
  if(!['http:','https:'].includes(u.protocol)) throw Error('INVALID_PAYMENT_RPC');
  return async(method,params) => {
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
    if(!r.ok) throw Error('PAYMENT_RPC_UNAVAILABLE');
    const result=await r.json() as any;
    if(result.error) throw Error('PAYMENT_RPC_UNAVAILABLE');
    return result.result;
  };
}
const transfer=parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const hash=/^0x[0-9a-f]{64}$/i, address=/^0x[0-9a-f]{40}$/;
const transferTopic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const pending=(code:string):Verification=>({status:'pending',code,events:[]});
const review=(code:string):Verification=>({status:'review',code,events:[]});
export class EvmTransferAdapter implements PaymentAdapter {
  readonly kind='evm_erc20_transfer';
  constructor(private readonly rpc:EvmRpc) {}
  private async head(s:ProviderSnapshot,tag: 'latest' | 'finalized' = 'finalized') {
    if(s.config.finality!=='finalized' || !/^[1-9][0-9]*$/.test(s.config.chain_id) || !address.test(s.config.treasury_address) || !s.assets?.length ||
      s.assets.some(a=>!address.test(a.address)||!Number.isInteger(a.decimals)||a.decimals<6||a.decimals>36)) throw Error('PAYMENT_CONFIGURATION_INVALID');
    if(BigInt(await this.rpc('eth_chainId',[]))!==BigInt(s.config.chain_id)) throw Error('PAYMENT_CHAIN_MISMATCH');
    const b=await this.rpc('eth_getBlockByNumber',[tag,false]);
    if(!b || !hash.test(b.hash) || b.number==null) throw Error(tag==='finalized'?'PAYMENT_NOT_FINAL':'PAYMENT_HEAD_UNAVAILABLE');
    for(const asset of s.assets) {
      const decimals=await this.rpc('eth_call',[{to:asset.address,data:'0x313ce567'},b.number]);
      if(BigInt(decimals)!==BigInt(asset.decimals)) throw Error('PAYMENT_TOKEN_DECIMALS_MISMATCH');
    }
    return b;
  }
  private async receipt(s:ProviderSnapshot,tx:string,head?:{number:string}):Promise<{pending?:string; invalid?:string; events:Observation[]}> {
    const r=await this.rpc('eth_getTransactionReceipt',[tx]);
    if(!r || r.blockNumber==null) return {pending:'PAYMENT_NOT_MINED',events:[]};
    if(!hash.test(r.blockHash) || String(r.transactionHash).toLowerCase()!==tx.toLowerCase()) throw Error('PAYMENT_RECEIPT_MISMATCH');
    if(head && BigInt(r.blockNumber)>BigInt(head.number)) return {pending:'PAYMENT_NOT_FINAL',events:[]};
    const b=await this.rpc('eth_getBlockByNumber',[r.blockNumber,false]);
    if(!b || b.hash.toLowerCase()!==r.blockHash.toLowerCase()) return {pending:'PAYMENT_REORG_PENDING',events:[]};
    if(BigInt(r.status)!==1n) return {invalid:'PAYMENT_NOT_SUCCEEDED',events:[]};
    const timestamp=BigInt(b.timestamp);
    if(timestamp<0n || timestamp>BigInt(Math.floor(Date.now()/1000)+120)) throw Error('PAYMENT_BLOCK_INVALID');
    const events:Observation[]=[];
    for(const log of r.logs??[]) {
      if(log.removed || !s.assets.some(a=>a.address===String(log.address).toLowerCase()) || log.topics?.[0]?.toLowerCase()!==transferTopic) continue;
      if(String(log.transactionHash).toLowerCase()!==tx.toLowerCase() || String(log.blockHash).toLowerCase()!==String(b.hash).toLowerCase() || BigInt(log.blockNumber)!==BigInt(r.blockNumber)) throw Error('PAYMENT_LOG_MISMATCH');
      const decoded=decodeEventLog({abi:[transfer],topics:log.topics,data:log.data,strict:true});
      if(decoded.args.to.toLowerCase()!==s.config.treasury_address) continue;
      const index=BigInt(log.logIndex);
      if(index<0n || index>2147483647n) throw Error('PAYMENT_LOG_MISMATCH');
      events.push({network_id:s.config.chain_id,tx_hash:tx.toLowerCase(),log_index:Number(index),token_address:log.address.toLowerCase(),
        sender:decoded.args.from.toLowerCase(),recipient:decoded.args.to.toLowerCase(),amount_atomic:decoded.args.value.toString(),
        block_number:BigInt(r.blockNumber).toString(),block_hash:b.hash.toLowerCase(),paid_at:new Date(Number(timestamp)*1000).toISOString()});
    }
    return {events};
  }
  async verify(s:ProviderSnapshot,p:Submission):Promise<Verification> {
    if(!hash.test(p.tx_hash)) return review('INVALID_PAYMENT_HASH');
    let head;
    try { head=await this.head(s,evmAcceptanceHead(p.order.delivery_confirmation ?? "finalized")); } catch(e) { if(e instanceof Error && e.message==='PAYMENT_NOT_FINAL') return pending(e.message); throw e; }
    const r=await this.receipt(s,p.tx_hash,p.order.delivery_confirmation==='receipt'?undefined:head);
    if(r.pending) return pending(r.pending);
    if(r.invalid) return review(r.invalid);
    const events=r.events.filter(e=>e.sender===p.wallet.toLowerCase() && e.token_address===p.order.quote.token_address && e.recipient===p.order.quote.treasury_address);
    if(!events.length) return review('PAYMENT_TRANSFER_MISMATCH');
    // Store matching-party transfers even when their amount/window is invalid. SQL keeps evidence for review.
    return {status:'verified',code:null,events};
  }
  async reconcile(s:ProviderSnapshot,event:Observation):Promise<{status:'pending'|'finalized'|'review';code:string|null}> {
    const head=await this.head(s);
    // Re-read the live receipt even before finality, detecting changed evidence early.
    const result=await this.receipt(s,event.tx_hash);
    if(result.pending) return result.pending==='PAYMENT_REORG_PENDING'
      ? {status:'review',code:'PAYMENT_EVIDENCE_CHANGED'}
      : {status:'pending',code:result.pending};
    const current=result.events.find(e=>e.log_index===event.log_index);
    if(result.invalid || !current || Object.keys(event).some(k=>current[k as keyof Observation]!==event[k as keyof Observation]))
      return {status:'review',code:'PAYMENT_EVIDENCE_CHANGED'};
    return BigInt(event.block_number)<=BigInt(head.number)
      ? {status:'finalized',code:null} : {status:'pending',code:'PAYMENT_NOT_FINAL'};
  }
  private blockTime(block:any):string {
    const seconds=BigInt(block.timestamp);
    if(seconds<0n || seconds>BigInt(Math.floor(Date.now()/1000)+120)) throw Error('PAYMENT_BLOCK_INVALID');
    return new Date(Number(seconds)*1000).toISOString();
  }
  async scan(s:ProviderSnapshot):Promise<ScanPage|null> {
    const head=await this.head(s), from=BigInt(s.cursor.next_block);
    let previous:any;
    if(s.cursor.last_block_hash && from>0n) {
      if(BigInt(head.number)<from-1n) throw Error('PAYMENT_FINALIZED_REORG');
      previous=await this.rpc('eth_getBlockByNumber',[toHex(from-1n),false]);
      if(previous?.hash?.toLowerCase()!==s.cursor.last_block_hash) throw Error('PAYMENT_FINALIZED_REORG');
    }
    if(from>BigInt(head.number)) return previous ? {from:from.toString(),next:from.toString(),hash:previous.hash.toLowerCase(),coveredThrough:this.blockTime(previous),events:[]} : null;
    return this.scanRange(s, head, from);
  }
  async scanRecent(s: ProviderSnapshot): Promise<ScanPage | null> {
    if (!s.recent?.earliest_attempt_at) return null;
    const head = await this.head(s, "latest"), maximum = BigInt(head.number);
    const minimum = BigInt(s.config.start_block), cursor = s.recent.cursor;
    let from: bigint;
    if (cursor.next_block !== null) {
      const next = BigInt(cursor.next_block);
      const anchor = next > 0n && next <= maximum + 1n
        ? await this.rpc("eth_getBlockByNumber", [toHex(next - 1n), false]) : null;
      if (anchor?.hash?.toLowerCase() === cursor.last_block_hash) {
        from = next > minimum + 32n ? next - 32n : minimum;
      } else {
        // Rewind to the separately verified finalized checkpoint, including
        // reorgs deeper than our overlap. Never skip an unknown gap.
        from = BigInt(s.cursor.next_block);
        if (s.cursor.last_block_hash && from > 0n) {
          const finalized = await this.rpc("eth_getBlockByNumber", [toHex(from - 1n), false]);
          if (finalized?.hash?.toLowerCase() !== s.cursor.last_block_hash)
            throw Error("PAYMENT_FINALIZED_REORG");
        }
      }
    } else {
      // Locate the first potentially payable block without replaying years of
      // history. The historical scanner still owns coverage/abandonment.
      let low = minimum, high = maximum;
      const since = BigInt(Math.floor(Date.parse(s.recent.earliest_attempt_at) / 1000) - 120);
      while (low < high) {
        const mid = (low + high) / 2n;
        const block = await this.rpc("eth_getBlockByNumber", [toHex(mid), false]);
        if (!block || !hash.test(block.hash)) throw Error("PAYMENT_BLOCK_INVALID");
        if (BigInt(block.timestamp) < since) low = mid + 1n; else high = mid;
      }
      from = low;
    }
    if (from > maximum) return null;
    return this.scanRange(s, head, from);
  }
  private async scanRange(s: ProviderSnapshot, head: any, from: bigint): Promise<ScanPage> {
    let end=from+99n<BigInt(head.number)?from+99n:BigInt(head.number);
    let logs:any[];
    let before: any;
    for(;;) {
      before=await this.rpc('eth_getBlockByNumber',[toHex(end),false]);
      if(!before || !hash.test(before.hash)) throw Error('PAYMENT_BLOCK_INVALID');
      logs=await this.rpc('eth_getLogs',[{fromBlock:toHex(from),toBlock:toHex(end),address:s.assets.map(a=>a.address),
        topics:[transferTopic,null,'0x'+s.config.treasury_address.slice(2).padStart(64,'0')]}]);
      if(logs.length<=1000) break;
      if(end===from) throw Error('PAYMENT_SCAN_BLOCK_LIMIT');
      end=from+(end-from)/2n;
    }
    const events:Observation[]=[];
    for(const tx of new Set<string>(logs.map(l=>String(l.transactionHash).toLowerCase()))) {
      const r=await this.receipt(s,tx,head);
      if(r.pending || r.invalid) throw Error('PAYMENT_SCAN_RECEIPT_INCONSISTENT');
      events.push(...r.events.filter(e=>BigInt(e.block_number)>=from&&BigInt(e.block_number)<=end));
    }
    if(events.length>1000) throw Error('PAYMENT_SCAN_BLOCK_LIMIT');
    const block=await this.rpc('eth_getBlockByNumber',[toHex(end),false]);
    if(!block || !hash.test(block.hash)) throw Error('PAYMENT_BLOCK_INVALID');
    if(block.hash.toLowerCase()!==before.hash.toLowerCase()) throw Error('PAYMENT_SCAN_REORG');
    return {from:from.toString(),next:(end+1n).toString(),hash:block.hash.toLowerCase(),coveredThrough:this.blockTime(block),events};
  }
}
