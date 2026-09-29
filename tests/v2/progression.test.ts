import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { measurements, reduceProgression, reduceFreePackProgression, type Snapshot, type ProgressionRules } from '../../src/v2/progression.js';
import { parseGameplayFact } from '../../src/v2/gameplayFacts.js';
const rules = JSON.parse(readFileSync(new URL('../../../jokers-of-neon-api/database-v2/catalogs/season4-progression-v1.json',import.meta.url),'utf8')) as ProgressionRules;
function snapshot(): Snapshot {
  return { event_id:'9007199254740993',game_id:'9007199254740994',
    fact:{sequence:'1',kind:'level_completed',amount:3,subject:2,detail:0,flags:0}, rules:structuredClone(rules),
    profile:{version:'0',tier:0,highest_level:0,highest_round:0,completed_games:'0',lifetime_xp:'0',level:0},
    season:{xp:'0',level:0,eligible:true},day:{period_id:'day10',ordinal:'10'},level_completions:0,
    missions:[],streak:{current_length:0,longest_length:0,last_ordinal:null},protectors:null,gap_periods:[] };
}
describe('authoritative progression rules',()=>{
  it('awards diminishing level XP, floors multiplier, and stops incrementing the counter at zero',()=>{
    const s=snapshot();
    expect(reduceProgression(s).xp).toEqual([{cause:'level',amount:'15'}]);
    s.level_completions=1;s.rules.xp_multiplier=150;
    expect(reduceProgression(s).xp[0].amount).toBe('7');
    s.level_completions=2;
    expect(reduceProgression(s).level_completion).toBe(false);
    expect(reduceProgression(s).xp).toEqual([]);
  });
  it('unlocks at most two consecutive tiers using the current run; surrender gives none',()=>{
    const s=snapshot();s.profile.completed_games='50';s.profile.highest_level=9;s.profile.highest_round=6;
    s.fact={...s.fact,kind:'run_finished',amount:1,subject:2,flags:1};
    expect(reduceProgression(s).unlocks).toEqual(['specials_c']);
    s.fact.amount=9;
    expect(reduceProgression(s).unlocks).toEqual(['specials_c','powerups_cb']);
    s.fact.flags=0;
    expect(reduceProgression(s).profile.completed_games).toBe('50');
    expect(reduceProgression(s).unlocks).toEqual([]);
  });
  it('does not combine daily partial progress from different games; daily completion advances weekly and streak once',()=>{
    const s=snapshot();s.fact={...s.fact,kind:'hand_upgraded',amount:1};
    s.missions=[{assignment_id:'daily',kind:'day',progress:'4',game_progress:'0',target:'5',objective:{metric:'hand_upgraded',aggregate:'sum'},reward:{xp:10}},
      {assignment_id:'weekly',kind:'week',progress:'0',game_progress:'0',target:'1',objective:{metric:'daily_completed',aggregate:'sum'},reward:{xp:50}}];
    let result=reduceProgression(s);
    expect(result.missions[0].completed).toBe(false);expect(result.xp).toEqual([]);expect(result.streak).toBeNull();
    s.missions[0].game_progress='4';result=reduceProgression(s);
    expect(result.missions.map(m=>m.completed)).toEqual([true,true]);
    expect(result.profile.lifetime_xp).toBe('60');expect(result.season_level).toBe(2);
    expect(result.streak?.current_length).toBe(1);
    s.streak={current_length:1,longest_length:1,last_ordinal:'10'};
    expect(reduceProgression(s).streak).toBeNull();
  });
  it('protects missed days without adding them to the streak and consumes remaining protectors even if the gap breaks it',()=>{
    const s=snapshot();s.fact={...s.fact,kind:'hand_upgraded',amount:1};
    s.missions=[{assignment_id:'daily',kind:'day',progress:'0',game_progress:'0',target:'1',objective:{metric:'hand_upgraded',aggregate:'sum'},reward:{xp:10}}];
    s.streak={current_length:4,longest_length:5,last_ordinal:'7'};
    s.protectors={account_id:'p',revision:'0',balance:'2'};
    s.gap_periods=[{period_id:'day8',ordinal:'8'},{period_id:'day9',ordinal:'9'}];
    expect(reduceProgression(s).streak).toEqual({current_length:5,longest_length:5,last_ordinal:'10',reset:false,used:2,protected_period_ids:['day8','day9']});
    s.protectors.balance='1';expect(reduceProgression(s).streak?.current_length).toBe(1);
    expect(reduceProgression(s).streak?.used).toBe(1);
    s.gap_periods=[];expect(()=>reduceProgression(s)).toThrow('MISSING_STREAK_PERIOD');
  });
  it('keeps wide XP exact and uses historical season eligibility',()=>{
    const s=snapshot();s.profile.lifetime_xp='9007199254740993';s.season.eligible=false;
    expect(reduceProgression(s).profile.lifetime_xp).toBe('9007199254741008');
    expect(reduceProgression(s).season_level).toBe(0);
  });
  it('records true hand suits, neon/joker facts and raw score without inventing mission awards',()=>{
    const s=snapshot();
    expect(measurements({...s.fact,kind:'hand_played',amount:4294967295,subject:8,detail:4,flags:7},rules))
      .toMatchObject({score:4294967295n,'flush:4:0':1n,'flush:4:8':1n,neon_hands:1n,wild_joker_hands:1n});
    expect(measurements({...s.fact,kind:'card_bought',flags:9},rules)).toMatchObject({neon_joker_bought:1n,joker_added:1n,neon_added:1n});
  });
  it('rejects unsupported facts, mission objectives and rewards instead of marking them processed',()=>{
    const s=snapshot();s.fact.kind='unknown';expect(()=>reduceProgression(s)).toThrow('UNKNOWN_GAMEPLAY_FACT');
    s.fact.kind='hand_upgraded';s.missions=[{assignment_id:'d',kind:'day',progress:'0',game_progress:'0',target:'1',objective:{metric:'missing',aggregate:'sum'},reward:{xp:10}}];
    expect(()=>reduceProgression(s)).toThrow('UNKNOWN_MISSION_OBJECTIVE');
    s.missions[0].objective.metric='hand_upgraded';(s.missions[0].reward as any).pack='unsupported';
    expect(()=>reduceProgression(s)).toThrow('UNSUPPORTED_MISSION_REWARD');
  });
  it('validates source identity and retains wide sequence IDs',()=>{
    const runtime='10000000-0000-0000-0000-000000000001';
    const game={runtime_id:runtime,player_account:'0x123',profile_id:'p',world_address:'0x1',context:{rules_version:'v1',season_id:4,tier:0,is_tournament:false,player_name:'p'}};
    const raw={runtime_id:'0x'+runtime.replaceAll('-',''),player:'0x123',game_id:'9007199254740993',sequence:'9007199254740994',kind:'0x'+Buffer.from('hand_played').toString('hex'),amount:1,subject:2,detail:0,flags:0,occurred_at:1700000000};
    expect(parseGameplayFact(raw,runtime,game).fact.sequence).toBe('9007199254740994');
    expect(()=>parseGameplayFact({...raw,player:'0x456'},runtime,game)).toThrow('EVENT_PLAYER_MISMATCH');
    expect(()=>parseGameplayFact({...raw,sequence:9007199254740994},runtime,game)).toThrow('INVALID_FACT_INTEGER');
  });
});

import { V2TerminalWorker } from '../../src/v2/terminalWorker.js';
it('polling still applies the archived journal when the runtime is offline',async()=>{
  const worker=new V2TerminalWorker({supabaseUrl:'http://127.0.0.1:55321',serviceKey:'test',runtimeId:'10000000-0000-0000-0000-000000000001',endpointRef:'test',worldAddress:'0x1',gameSystemAddress:'0x1',rpcUrl:'http://127.0.0.1:1',toriiUrl:'http://127.0.0.1:1'});
  let replayed=false;
  worker.archiveNextPage=async()=>{throw new Error('RUNTIME_OFFLINE');};
  worker.replayPending=async()=>{replayed=true;return 1;};
  await expect(worker.pollOnce()).rejects.toThrow('RUNTIME_OFFLINE');
  expect(replayed).toBe(true);
});

it('command free packs complete only weekly missions and award no streak or gameplay unlocks',()=>{
  const s=snapshot();s.game_id=null;s.fact={...s.fact,kind:'free_pack_claimed',amount:1};
  s.missions=[{assignment_id:'week',kind:'week',progress:'4',game_progress:'0',target:'5',objective:{metric:'free_packs',aggregate:'sum'},reward:{xp:75}}];
  const result=reduceFreePackProgression(s);
  expect(result.xp).toEqual([{cause:'mission:week',amount:'75'}]);
  expect(result.missions[0]).toMatchObject({progress:'5',game_progress:null,delta:'1',completed:true});
  expect(result.streak).toBeNull();expect(result.unlocks).toEqual([]);expect(result.level_completion).toBe(false);
  expect(()=>reduceProgression(s)).toThrow('UNKNOWN_GAMEPLAY_FACT');
  expect(()=>reduceFreePackProgression({...s,game_id:'1'})).toThrow('INVALID_FREE_PACK_FACT');
  expect(()=>reduceFreePackProgression({...s,fact:{...s.fact,amount:2}})).toThrow('INVALID_FREE_PACK_FACT');
  s.missions[0].kind='day';expect(()=>reduceFreePackProgression(s)).toThrow('INVALID_FREE_PACK_FACT');
});
it('Core cannot submit a command-sourced free pack fact',()=>{
  const runtime='10000000-0000-0000-0000-000000000001';
  const game={runtime_id:runtime,player_account:'0x123',profile_id:'p',world_address:'0x1',context:{rules_version:'v1',season_id:4,tier:0,is_tournament:false,player_name:'p'}};
  expect(()=>parseGameplayFact({runtime_id:'0x'+runtime.replaceAll('-',''),player:'0x123',game_id:'1',sequence:'1',
    kind:'0x'+Buffer.from('free_pack_claimed').toString('hex'),amount:1,subject:0,detail:0,flags:0,occurred_at:1700000000},runtime,game)).toThrow();
});
