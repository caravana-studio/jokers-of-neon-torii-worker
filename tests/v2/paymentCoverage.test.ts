import {test,expect} from 'bun:test';
import {EvmTransferAdapter} from '../../src/v2/commerce/evm.js';
import type {ProviderSnapshot} from '../../src/v2/commerce/providers.js';
const h=(n:number)=>'0x'+n.toString(16).padStart(64,'0');
const timestamp=Math.floor(Date.now()/1000)-30;
const snapshot=(next=5,hash:string|null=null):ProviderSnapshot=>({provider_key:'test',adapter_kind:'evm_erc20_transfer',chain_key:'staging:celo',config:{chain_id:'42220',treasury_address:'0x'+'11'.repeat(20),start_block:'5',finality:'finalized'},assets:[{symbol:'USDC',address:'0x'+'22'.repeat(20),decimals:6,fee_currency:null}],cursor:{next_block:String(next),last_block_hash:hash,revision:'0'}});
const rpc=async(method:string,args:any[])=>{
 if(method==='eth_chainId')return '0xa4ec';if(method==='eth_call')return '0x6';if(method==='eth_getLogs')return [];
 if(method==='eth_getBlockByNumber'){const n=args[0]==='finalized'?6:Number(BigInt(args[0]));return {number:'0x'+n.toString(16),hash:h(n),timestamp:'0x'+timestamp.toString(16)};}
 throw Error('UNEXPECTED_RPC');
};
test('coverage reports the last scanned finalized block, including an empty range',async()=>{
 const page=await new EvmTransferAdapter(rpc).scan(snapshot());
 expect(page?.next).toBe('7');expect(page?.coveredThrough).toBe(new Date(timestamp*1000).toISOString());expect(page?.events).toEqual([]);
});
test('an idle scan revalidates the canonical block before refreshing coverage',async()=>{
 const page=await new EvmTransferAdapter(rpc).scan(snapshot(7,h(6)));
 expect(page?.from).toBe('7');expect(page?.next).toBe('7');expect(page?.hash).toBe(h(6));
 await expect(new EvmTransferAdapter(rpc).scan(snapshot(7,h(99)))).rejects.toThrow('PAYMENT_FINALIZED_REORG');
 await expect(new EvmTransferAdapter(rpc).scan(snapshot(8,h(7)))).rejects.toThrow('PAYMENT_FINALIZED_REORG');
});
test('RPC failure or a future block timestamp cannot certify recovery coverage',async()=>{
 await expect(new EvmTransferAdapter(async()=>{throw Error('PAYMENT_RPC_UNAVAILABLE');}).scan(snapshot())).rejects.toThrow('PAYMENT_RPC_UNAVAILABLE');
 await expect(new EvmTransferAdapter(async(m,p)=>{const r=await rpc(m,p);return m==='eth_getBlockByNumber'?{...r,timestamp:'0x'+(timestamp+1000).toString(16)}:r;}).scan(snapshot())).rejects.toThrow('PAYMENT_BLOCK_INVALID');
});
