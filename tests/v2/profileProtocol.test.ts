import { test, expect } from 'bun:test';
import { decodeFunctionData } from 'viem';
import { profileAbi, profileCalldata } from '../../src/v2/settlement/profileProtocol.js';
import { readSettlementConfig } from '../../src/v2/settlement/config.js';
const player='0x'+'12'.repeat(20);
test('Profile rejects overflowing IDs and a burner or another beneficiary instead of the EVM wallet',()=>{
 expect(()=>profileCalldata({protocol:'profile-v1',method:'setGameData',args:['4294967296',player,0,[],0,0,false,0,'Player']},player)).toThrow('PROFILE_UINT32_OVERFLOW');
 expect(()=>profileCalldata({protocol:'profile-v1',method:'addPlayerStats',args:['0x'+'13'.repeat(20),...Array(22).fill(0)]},player)).toThrow('PROFILE_BENEFICIARY_MISMATCH');
 expect(()=>profileCalldata({protocol:'profile-v1',method:'syncProgression',args:[player,256,0,0,0]},player)).toThrow('INVALID_PROFILE_PROGRESSION');
});
test('Profile ABI preserves large unsigned counters without narrowing or combining fields',()=>{
 const args=[player,4294967295,1,...Array(20).fill(0)];
 const decoded=decodeFunctionData({abi:profileAbi,data:profileCalldata({protocol:'profile-v1',method:'addPlayerStats',args},player)});
 expect(decoded.functionName).toBe('addPlayerStats');
 expect((decoded.args![0] as any).gamesPlayed).toBe(4294967295);
 expect((decoded.args![0] as any).gamesWon).toBe(1);
});
test('Profile configuration is explicit and rejects duplicate or missing runtime mappings',async()=>{
 const mirror={contractAddress:player,runtimes:[{runtimeId:'10000000-0000-0000-0000-000000000001',rpcUrl:'http://localhost:5050',gameSystemAddress:'0x1',gameViewsAddress:'0x2'}]};
 const config={supabaseUrl:'http://localhost:54321',serviceKeyEnv:'SERVICE_KEY',executors:[{executorId:'fixture',rpcUrl:'http://localhost:8545',signerEnv:'SIGNER',profileMirror:mirror}]};
 expect((await readSettlementConfig({JOKERS_V2_SETTLEMENT_CONFIG_JSON:JSON.stringify(config)})).executors[0].profileMirror).toEqual(mirror);
 for(const runtimes of [[],[...mirror.runtimes,...mirror.runtimes]]){
  await expect(readSettlementConfig({JOKERS_V2_SETTLEMENT_CONFIG_JSON:JSON.stringify({...config,executors:[{...config.executors[0],profileMirror:{...mirror,runtimes}}]})})).rejects.toThrow('INVALID_PROFILE_MIRROR_CONFIG');
 }
});

test('Profile sending is opt-in, including the separate production switch',async()=>{
 const executorId='fixture';
 const mirror={executorId,enabled:false,contractAddress:player,runtimes:[{runtimeId:'10000000-0000-0000-0000-000000000001',rpcUrl:'http://localhost:5050',gameSystemAddress:'0x1',gameViewsAddress:'0x2'}]};
 const base={supabaseUrl:'http://localhost:54321',serviceKeyEnv:'SERVICE_KEY',executors:[{executorId,rpcUrl:'http://localhost:8545',signerEnv:'SIGNER'}]};
 const env={JOKERS_V2_SETTLEMENT_CONFIG_JSON:JSON.stringify(base)};
 const result=await readSettlementConfig({...env,JOKERS_V2_PROFILE_MIRRORS_JSON:JSON.stringify([mirror])});
 expect(result.executors[0].profileMirror?.enabled).toBe(false);
 for(const enabled of ['false','true',0,1,null]) await expect(readSettlementConfig({...env,JOKERS_V2_PROFILE_MIRRORS_JSON:JSON.stringify([{...mirror,enabled}])})).rejects.toThrow('INVALID_PROFILE_MIRROR_CONFIG');
 await expect(readSettlementConfig({...env,JOKERS_V2_PROFILE_MIRRORS_JSON:JSON.stringify([{...mirror,executorId:'unknown'}])})).rejects.toThrow('PROFILE_MIRROR_EXECUTOR_CONFLICT');
 await expect(readSettlementConfig({...env,JOKERS_V2_PROFILE_MIRRORS_JSON:'private-invalid-json'})).rejects.toThrow('INVALID_PROFILE_MIRRORS_JSON');
});
