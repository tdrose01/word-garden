import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState, getLevel, submitWord, createSnapshot, plantSeed, collectBloom, chooseGardenDesign, startReplay } from './game.js';
import { createBackup, parseBackup } from './persistence.js';
const fresh = () => loadState({ getItem: () => null });
const finish = state => getLevel(state).targets.reduce((s, w) => submitWord(w, s).state, state);
const garden = state => createSnapshot(state).gardenStats;
const mature = () => { let s = plantSeed(fresh(), {plotIndex:0,plantId:'daisy'}).state; for(let i=0;i<5;i++) s=finish(s); return s; };
test('bloom pays once at age five, preserves display and survives backup/reload', () => {
 let s=plantSeed(fresh(),{plotIndex:0,plantId:'daisy'}).state;
 for(let i=0;i<4;i++) s=finish(s);
 assert.equal(collectBloom(s,0).state,s);
 s=finish(s); const coins=s.coins;
 s=collectBloom(s,0).state;
 assert.equal(s.coins,coins+5); assert.equal(garden(s).plots[0].stage,'blooming');
 assert.equal(garden(s).readyBlooms,0); assert.deepEqual(garden(s).collectedSpecies,['daisy']);
 s=parseBackup(createBackup(s)); s=loadState({getItem:()=>JSON.stringify(s)});
 assert.equal(collectBloom(s,0).state,s); assert.equal(s.coins,coins+5);
 assert.equal(collectBloom(s,-1).state,s);
});
test('replant spends seeds permanently, restarts age and preserves lifetime collection/design', () => {
 let s=mature(); assert.equal(plantSeed(s,{plotIndex:0,plantId:'rose',replant:true}).state,s);
 for(let cycle=0;cycle<3;cycle++) {
  s=collectBloom(s,0).state;
  if(cycle===2) break;
  const seeds=garden(s).seedCredits;
  s=plantSeed(s,{plotIndex:0,plantId:'rose',replant:true}).state;
  assert.equal(garden(s).seedCredits,seeds-1); assert.equal(garden(s).plots[0].stage,'seedling');
  assert.equal(collectBloom(s,0).state,s);
  for(let i=0;i<5;i++) s=finish(s);
 }
 assert.equal(garden(s).collectedBloomCount,3); assert.deepEqual(garden(s).collectedSpecies,['daisy','rose']);
 assert.equal(chooseGardenDesign(s,'sunroom').state,s);
 s=chooseGardenDesign(s,'moonlit').state;
 s=plantSeed(s,{plotIndex:0,plantId:'poppy',replant:true}).state;
 s=parseBackup(createBackup(s));
 assert.equal(garden(s).design,'moonlit'); assert.equal(garden(s).collectedBloomCount,3); assert.equal(garden(s).seedsSpent,4);
});
test('legacy mature flowers need manual collection, replay cannot collect or replant', () => {
 let s=mature(); s.garden={plots:[{index:0,plantId:'poppy',plantedAt:0}]};
 const original=s.coins; s=parseBackup(createBackup(s)); assert.equal(s.coins,original);
 assert.equal(garden(s).seedsSpent,1); assert.equal(garden(s).readyBlooms,1);
 const replay=startReplay(s,0).state;
 assert.equal(collectBloom(replay,0).state,replay);
 assert.equal(plantSeed(replay,{plotIndex:1,plantId:'rose'}).state,replay);
 assert.deepEqual(finish(replay).garden,replay.garden);
});
test('strict backup rejects impossible reward, design, seed and bloom data', () => {
 const original=collectBloom(mature(),0).state;
 for(const mutate of [g=>g.seedsSpent=99,g=>g.seedsSpent=0,g=>g.collectedBloomCount=99,g=>g.collectedSpecies=['fake'],g=>g.design='sunroom',g=>g.plots[0].plantedAt=4,g=>g.plots[0].bloomCollected='yes']) {
  const s=structuredClone(original); mutate(s.garden); assert.throws(()=>parseBackup(createBackup(s)),/Invalid backup/);
 }
});
test('all 48 plots can be renewed, with separate zero-seed and successful renewal checks', () => {
 let s=fresh(); for(let i=0;i<55;i++) s=finish(s);
 for(let i=0;i<48;i++) s=plantSeed(s,{plotIndex:i,plantId:'daisy'}).state;
 for(let i=0;i<5;i++) s=finish(s);
 s=collectBloom(s,0).state;
 const before=garden(s);
 const renewed=plantSeed(s,{plotIndex:0,plantId:'rose',replant:true}).state;
 assert.notEqual(renewed,s); assert.equal(garden(renewed).seedCredits,before.seedCredits-1);
 assert.equal(garden(renewed).seedsSpent,before.seedsSpent+1);
 assert.equal(garden(renewed).plots.filter(p=>p.plantId).length,48);
 assert.equal(garden(renewed).plots[0].plantId,'rose');
 assert.equal(garden(renewed).collectedBloomCount,1);
 assert.deepEqual(garden(renewed).collectedSpecies,['daisy']);
 const exhausted={...s,garden:{...s.garden,seedsSpent:61}};
 assert.equal(garden(exhausted).seedCredits,0);
 assert.equal(plantSeed(exhausted,{plotIndex:0,plantId:'rose',replant:true}).state,exhausted);
});
