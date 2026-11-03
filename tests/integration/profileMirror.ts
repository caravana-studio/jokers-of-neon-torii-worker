/** Disposable local Postgres + Anvil. Exercises real signed transactions and the production Profile ABI. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { ProfileMirror } from '../../src/v2/settlement/profileMirror.js';
import { profileSnapshot } from '../../src/v2/settlement/profileProtocol.js';
import type { Executor } from '../../src/v2/settlement/types.js';
const api = resolve(import.meta.dirname, '../../../jokers-of-neon-api');
const contracts = resolve(import.meta.dirname, '../../../../mainnet/jokers-of-neon-profile/evm');
const container = 'supabase_db_jokers-of-neon-v2', database = 'jon_profile_'+randomUUID().replaceAll('-','');
const q = (v: unknown) => v === null ? 'null' : "'"+String(v).replaceAll("'","''")+"'";
const json = (v: unknown) => q(JSON.stringify(v))+'::jsonb';
const sql = (s: string) => execFileSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database],{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const query = (s: string) => { const v=sql(s); return v ? JSON.parse(v) : null; };
let failPrepare = false, failNote = false;
const db = { rpc: async(name: string,args: Record<string,unknown>) => {
 try {
  const result=query('set role service_role; select api.'+name+'('+Object.values(args).map(v=>v!==null&&typeof v==='object'?json(v):q(v)).join(',')+');');
  if(name==='prepare_profile_submission' && failPrepare) { failPrepare=false; throw Error('SIMULATED_LOST_PREPARE_RESPONSE'); }
  if(name==='note_profile_submission' && args.p_state==='submitted' && failNote) { failNote=false; throw Error('SIMULATED_LOST_SEND_RESPONSE'); }
  return {data:result,error:null};
 }catch(e){return {data:null,error:{message:(e as any).stderr?.toString()??(e as Error).message}};}
}} as any;
const socket=createServer();await new Promise<void>(r=>socket.listen(0,'127.0.0.1',r));const port=(socket.address() as any).port;await new Promise<void>(r=>socket.close(()=>r()));
const rpc='http://127.0.0.1:'+port;
const process=spawn('anvil',['--port',String(port),'--silent'],{stdio:'ignore'});
const account=mnemonicToAccount('test test test test test test test test test test test junk');
const key='0x'+Buffer.from(account.getHdKey().privateKey!).toString('hex') as `0x${string}`;
const client=createPublicClient({transport:http(rpc,{retryCount:0})});const wallet=createWalletClient({account,transport:http(rpc)});
execFileSync('docker',['exec',container,'createdb','-U','postgres',database]);
try {
 for(let i=0;;i++){try{await client.getChainId();break}catch{if(i>50)throw Error('ANVIL_UNAVAILABLE');await new Promise(r=>setTimeout(r,100));}}
 sql(readdirSync(resolve(api,'database-v2/supabase/migrations')).filter(f=>f.endsWith('.sql')).sort().map(f=>readFileSync(resolve(api,'database-v2/supabase/migrations',f),'utf8')).join('\n'));
 execFileSync('forge',['build'],{cwd:contracts,stdio:'pipe'});
 const artifact=JSON.parse(readFileSync(resolve(contracts,'out/JokersOfNeonProfile.sol/JokersOfNeonProfile.json'),'utf8'));
 const deployed=await client.waitForTransactionReceipt({hash:await wallet.deployContract({abi:artifact.abi,bytecode:artifact.bytecode.object,chain:null})});
 const address=deployed.contractAddress!;
 const executor=randomUUID(), deployment=randomUUID(), player=randomUUID(), profile=randomUUID(), walletId=randomUUID(), runtime=randomUUID(), acct=randomUUID(), command=randomUUID();
 const beneficiary=account.address.toLowerCase();
 sql(`insert into catalog.chains(chain_key,adapter_key,network_id,core_chain_id,display_name,status,confirmation_policy) values('test:celo','evm','31337',2,'profile test','enabled','{"confirmations":1,"finality":"local"}');
 insert into catalog.rulesets values('profile_test','test','{"progression":{"run_completion_level":3}}',sha256('fixture'),now());
 insert into catalog.seasons values(1,'test',now()-interval '1 day',now()+interval '1 day','profile_test');
 insert into catalog.chain_seasons values('test:celo',1,'active');
 insert into identity.players(player_id,display_name) values(${q(player)},'Fixture');
 insert into identity.wallets(wallet_id,player_id,chain_key,address,verified_at,proof_digest) values(${q(walletId)},${q(player)},'test:celo',${q(beneficiary)},now(),sha256('fixture'));
 insert into identity.chain_profiles(profile_id,player_id,chain_key,wallet_id) values(${q(profile)},${q(player)},'test:celo',${q(walletId)});
 insert into progression.profiles(profile_id,rules_version,tier,highest_level,highest_round,completed_games,version) values(${q(profile)},'profile_test',2,3,9,1,4);
 insert into chain.deployments(deployment_id,chain_key,contract_key,version,address,abi_hash,starts_at_block,manifest_ref) values(${q(deployment)},'test:celo','jokers-of-neon-profile',1,${q(address.toLowerCase())},sha256('fixture'),0,'test');
 insert into chain.executors(executor_id,chain_key,address,signer_ref,status) values(${q(executor)},'test:celo',${q(beneficiary)},'TEST_SIGNER','ready');
 insert into chain.profile_mirrors values(${q(executor)},${q(deployment)},true);
 insert into gameplay.runtimes(runtime_id,world_address,deployment_digest,endpoint_ref,status) values(${q(runtime)},'0x123',sha256('fixture'),'local','active');
 insert into gameplay.runtime_accounts(account_id,profile_id,runtime_id,address,status) values(${q(acct)},${q(profile)},${q(runtime)},'0x123','ready');
 insert into ops.commands(command_id,profile_id,kind,idempotency_key,request_hash) values(${q(command)},${q(profile)},'game.create','fixture',sha256('fixture'));
 insert into gameplay.games(game_id,profile_id,chain_key,season_id,runtime_id,account_id,admission_command_id,rules_version,beneficiary_address,player_name,mode,tier,context,context_hash,status,activated_at) overriding system value
 values(1,${q(profile)},'test:celo',1,${q(runtime)},${q(acct)},${q(command)},'profile_test',${q(beneficiary)},'Fixture','normal',1,'{}',sha256('fixture'),'active',now());
 insert into ops.events(source_kind,source_instance,source_key,kind,schema_version,profile_id,chain_key,game_id,runtime_id,payload,payload_hash,occurred_at)
 values('runtime',${q(runtime)},'fact:1','game.fact',1,${q(profile)},'test:celo',1,${q(runtime)},'{"sequence":"1","kind":"level_completed","amount":3}',sha256('fixture'),now());
 insert into ops.events(source_kind,source_instance,source_key,kind,schema_version,profile_id,chain_key,game_id,runtime_id,payload,payload_hash,occurred_at)
 values('runtime',${q(runtime)},'terminal:1','game.terminal',1,${q(profile)},'test:celo',1,${q(runtime)},'{}',sha256('fixture'),now());
 insert into gameplay.results(game_id,profile_id,chain_key,runtime_id,source_event_id,level,round,score,finished_at,facts)
 select 1,${q(profile)},'test:celo',${q(runtime)},event_id,3,9,123,now(),'{}' from ops.events where source_key='terminal:1';`);
 const source=query(`set role service_role; select api.profile_mirror_work(${q(executor)});`)[0];
 assert.equal(sql(`select count(*) from chain.operations;`),'3','creation + win + progression');
 const rawGame=['1','0','8','0x123','0','123','3','0','9','0','0','0','1','4','5','0','0','0','1','123','150','0','0','1','7'];
 const rawStats=['0','0','0','2',...Array(19).fill('0')];
 const snapshot=profileSnapshot(source,rawGame,['1','1','0','42','0','0','1','0'],rawStats);
 assert.deepEqual(snapshot.game[3],[42]);
 assert.throws(()=>profileSnapshot({...source,game_id:'4294967296'},rawGame,['0'],rawStats),/OVERFLOW/);
 assert.throws(()=>profileSnapshot({...source,player_account:'0x456'},rawGame,['0'],rawStats),/MISMATCH/);
 sql(`set role service_role; select api.capture_profile_game(${q(executor)},1,${json(snapshot)}); select api.capture_profile_game(${q(executor)},1,${json(snapshot)});`);
 assert.equal(sql('select count(*) from chain.operations;'),'6');
 assert.deepEqual(query(`set role service_role; select api.profile_mirror_work(${q(executor)});`),[]);
 assert.throws(()=>sql(`set role service_role; select api.capture_profile_game(${q(executor)},1,${json({...snapshot,game:[1,beneficiary,999,...snapshot.game.slice(3)]})});`));
 assert.equal(sql("select has_function_privilege('anon','api.profile_mirror_work(uuid)','execute');"),'f');
 assert.equal(sql("select count(*) from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname='chain' and cl.relname like 'profile_%' and cl.relkind='r' and not cl.relrowsecurity;"),'0');
 const e=query(`select api.nft_executor(${q(executor)});`) as Executor;
 const config={enabled:true,contractAddress:address,runtimes:[{runtimeId:runtime,rpcUrl:'http://127.0.0.1:1',gameSystemAddress:'0x123',gameViewsAddress:'0x456'}]};
 let mirror=new ProfileMirror(db,executor,rpc,key,config);
 await mirror.ready(e);
 const paused=new ProfileMirror(db,executor,rpc,key,{...config,enabled:false});
 const beforeNonce=await client.getTransactionCount({address:account.address});
 await paused.pollLeased({job_id:'unused',lease_token:'unused'} as any,e);
 assert.equal(await client.getTransactionCount({address:account.address}),beforeNonce,'config off cannot send');
 assert.equal(sql('select count(*) from chain.submissions;'),'0','config off cannot sign or reserve a nonce');
 const lease=query(`set role service_role; select api.claim_processing_job('nft-executor',${q(executor)},${json({executor_id:executor})},'fixture','processing-v1');`);
 await assert.rejects(mirror.pollLeased({...lease,lease_token:randomUUID()},e),/PROCESSING_LEASE_LOST/);
 failPrepare=true;
 await assert.rejects(mirror.pollLeased(lease,e),/SIMULATED_LOST_PREPARE_RESPONSE/);
 const before=sql('select tx_hash from chain.profile_submission_payloads;');
 // A real NFT operation must contend for the same persisted executor nonce.
 const nftDeployment=randomUUID(), nftCollection=randomUUID(), nftOperation=randomUUID();
 sql(`begin;
 insert into chain.deployments(deployment_id,chain_key,contract_key,version,address,abi_hash,starts_at_block,manifest_ref) values(${q(nftDeployment)},'test:celo','cards',1,'0x0000000000000000000000000000000000000456',sha256('nft'),0,'fixture');
 insert into chain.collections values(${q(nftCollection)},'test:celo',${q(nftDeployment)},'fixture','fixture');
 insert into chain.operations(operation_id,profile_id,chain_key,deployment_id,kind,source_kind,source_key,beneficiary_address,ordering_key,version,payload,payload_hash)
 values(${q(nftOperation)},${q(profile)},'test:celo',${q(nftDeployment)},'mint_nft','fixture','nft',${q(beneficiary)},'fixture:nft',1,'{"protocol":"mint-card-v1","card":{}}',sha256('nft'));
 do $$ begin
 assert private.next_nft_operation(${q(executor)}) is null;
 begin
 perform private.prepare_leased_nft_submission(${q(lease.job_id)},${q(lease.lease_token)},${q(executor)},${q(nftOperation)},encode(sha256('nft'),'hex'),'99','{}','0x123');
 raise exception 'EXPECTED_NONCE_BLOCK';
 exception when others then if sqlerrm<>'NFT_EXECUTOR_NOT_READY' then raise; end if; end;
 end $$; rollback;`);
 assert.equal(sql("select count(*) from chain.submissions where status='prepared';"),'1');
 assert.equal(query(`select api.next_nft_operation(${q(executor)});`),null,'profile reservation blocks NFT nonce');
 assert.equal(query(`select api.next_profile_operation(${q(executor)});`),null,'only one open nonce');
 // Neither switch permits a persisted transaction to be sent while the other is off.
 await paused.pollLeased(lease,e,false);
 assert.equal(await client.getTransactionCount({address:account.address}),beforeNonce);
 sql(`update chain.profile_mirrors set enabled=false where executor_id=${q(executor)};`);
 await mirror.pollLeased(lease,e);
 assert.equal(await client.getTransactionCount({address:account.address}),beforeNonce,'DB off prevents retries');
 assert.equal(sql('select count(*) from chain.submissions;'),'1');
 assert.deepEqual(query(`select api.profile_mirror_work(${q(executor)});`),[]);
 assert.equal(query(`select api.next_profile_operation(${q(executor)});`),null);
 sql(`update chain.profile_mirrors set enabled=true where executor_id=${q(executor)};`);
 mirror=new ProfileMirror(db,executor,rpc,key,config);
 failNote=true;
 await mirror.pollLeased(lease,e,false);
 assert.equal(sql('select tx_hash from chain.profile_submission_payloads;'),before,'restart reuses the signed transaction');
 for(let i=0;i<12;i++){
  sql("update chain.profile_submission_payloads set next_check_at=now();");
  await mirror.pollLeased(lease,e);
  if(sql("select count(*) from chain.operations where status<>'confirmed';")==='0')break;
 }
 assert.equal(sql("select count(*) from chain.operations where status='confirmed';"),'6');
 const stats=await client.readContract({address,abi:artifact.abi,functionName:'getPlayerStats',args:[beneficiary]}) as any;
 assert.equal(stats.gamesPlayed,1);assert.equal(stats.gamesWon,1);assert.equal(stats.highCardPlayed,2);
 const game=await client.readContract({address,abi:artifact.abi,functionName:'getGameData',args:[1]}) as any;
 assert.equal(game.playerScore,123);assert.deepEqual(game.specials,[42]);
 const round=await client.readContract({address,abi:artifact.abi,functionName:'getRoundData',args:[1,9]}) as any;
 assert.deepEqual(round.rages,[7]);
 sql('update chain.profile_submission_payloads set next_check_at=now();');
 await mirror.reconcileFinality();
 assert.equal(sql('select count(*) from chain.profile_submission_payloads where finalized;'),'6');
 for(let i=0;i<2;i++)await mirror.pollLeased(lease,e);
 assert.equal(sql('select count(*) from chain.submissions;'),'6','replaying the queue cannot create additive duplicates');
 // A confirmed receipt disappearing must quarantine the shared nonce lane, never add stats again.
 const snap=await client.request({method:'evm_snapshot' as any});
 sql(`select private.enqueue_profile_operation(${q(executor)},${q(profile)},'profile.created','reorg-fixture',${json([beneficiary,1,0,...Array(20).fill(0)])},'addPlayerStats');`);
 await mirror.pollLeased(lease,e);
 sql('update chain.profile_submission_payloads set next_check_at=now();');
 await mirror.pollLeased(lease,e);
 await client.request({method:'evm_revert' as any,params:[snap] as any});
 sql('update chain.profile_submission_payloads set next_check_at=now();');
 await mirror.reconcileFinality();
 assert.equal(sql(`select status from chain.executors where executor_id=${q(executor)};`),'reconciling');
 assert.equal((await client.readContract({address,abi:artifact.abi,functionName:'getPlayerStats',args:[beneficiary]}) as any).gamesPlayed,1);
 console.log('PASS: migrations, service-role/RLS, journal identity, snapshot validation, idempotent capture, shared nonce, stale lease, lost prepare/send responses, restart, all four Profile methods, finality and reorg quarantine.');
} finally {
 process.kill('SIGTERM');
 execFileSync('docker',['exec',container,'dropdb','-U','postgres','--force',database]);
}
