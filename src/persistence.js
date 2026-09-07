import { loadState, getLevel } from './game.js';
import { levels, legacyLevels, LEVEL_VERSION, getDailyLevel } from './levels.js';
import { canBuildWord } from './word-utils.js';
import { isDictionaryWord } from './dictionary.js';
import { plants } from './garden.js';

export const MAX_BACKUP_BYTES = 1024 * 1024;
export function writeProgress(state, storage) {
  try {
    (storage ?? window.localStorage).setItem('word-garden-state', JSON.stringify(state));
    return { ok: true, message: 'Saved in this browser.' };
  } catch {
    return { ok: false, message: 'Not saved: browser storage is unavailable or full. Download a backup to keep this progress.' };
  }
}
export function createBackup(state) {
  return JSON.stringify({ format: 'word-garden-backup', version: 1, state }, null, 2);
}
const fail = () => { throw new Error('Invalid backup. Your progress has not changed.'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
function fields(value, schema, required = []) {
  if (!object(value) || required.some(key => !Object.hasOwn(value,key))) fail();
  for (const [key, item] of Object.entries(value)) if (!Object.hasOwn(schema,key) || !schema[key](item)) fail();
  return true;
}
const bool = value => typeof value === 'boolean';
const words = value => Array.isArray(value) && value.length <= 1000 && new Set(value).size === value.length && value.every(word => typeof word === 'string' && /^[A-Z]{2,32}$/.test(word));
const reveals = value => Array.isArray(value) && value.length <= 1000 && new Set(value).size === value.length && value.every(word => typeof word === 'string' && /^[A-Z]{2,32}:\d{1,2}$/.test(word));
const version = value => Number.isInteger(value) && value >= 1 && value <= LEVEL_VERSION;
const progress = { solved: words, bonusFound: words, revealed: reveals, rescueUsed: bool, completed: bool };
function checkBoard(value, level) {
  if (!value.bonusFound.every(word => canBuildWord(word,level.letters) && isDictionaryWord(word) && !level.targets.includes(word))) fail();
  if (value.completed !== undefined && value.completed !== (value.solved.length === level.targets.length)) fail();
  if (!value.solved.every(word => level.targets.includes(word)) || !value.revealed.every(key => { const [word,index] = key.split(':'); return level.targets.includes(word) && Number(index) < word.length; })) fail();
}
export function parseBackup(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) fail();
  let envelope;
  try { envelope = JSON.parse(text); } catch { fail(); }
  fields(envelope, { format: v => v === 'word-garden-backup', version: v => v === 1, state: object }, ['format','version','state']);
  const s = envelope.state;
  fields(s, {
    mode: v => ['campaign','daily','replay'].includes(v), levelIndex: integer, campaignLevelVersion: version,
    coins: integer, ...progress,
    settings: v => fields(v,{sound:bool,haptics:bool},['sound','haptics']),
    garden: v => fields(v,{plots: list => Array.isArray(list) && list.length <= 48 && new Set(list.map(p=>p?.index)).size === list.length && list.every(p=>fields(p,{index:v=>integer(v)&&v<48,plantId:v=>plants.some(p=>p.id===v),plantedAt:integer},['index','plantId','plantedAt']))},['plots']),
    campaign: v => fields(v,{completedLevels:integer,cursor:integer,completedIds:v=>Array.isArray(v)&&new Set(v).size===v.length&&v.every(i=>integer(i)&&i<levels.length),completedPacks:integer,bestRun:integer,lastCompletedLevelId:integer,puzzleOrder:v=>Array.isArray(v)&&v.length<=levels.length&&new Set(v).size===v.length&&v.every(i=>integer(i)&&i<levels.length)},['completedLevels']),
    daily: v => fields(v,{...progress,dateKey:date,levelVersion:version,objectiveClaimed:bool},['dateKey','solved','bonusFound','revealed','completed']),
    dailyStats: v => fields(v,{streak:integer,totalCompletions:integer,bestStreak:integer,lastCompletedDate:v=>v===''||date(v),reward:integer,objectiveDates:v=>Array.isArray(v)&&v.length<=10000&&new Set(v).size===v.length&&v.every(date)}),
    replay: v => v === null || fields(v,{...progress,levelIndex:v=>integer(v)&&v<levels.length},['levelIndex','solved','bonusFound','revealed','completed']),
    startRandomizerVersion: integer
  }, ['mode','levelIndex','coins','solved','bonusFound','revealed']);
  if (s.mode === 'replay' && !s.replay) fail();
  const catalogLength = (s.campaignLevelVersion || 1) < 3 ? legacyLevels.length : levels.length;
  if (s.campaign?.cursor !== undefined && s.campaign.cursor >= catalogLength) fail();
  const normalized = loadState({getItem:()=>JSON.stringify(s)});
  checkBoard(s, getLevel({...normalized,mode:'campaign'}));
  if (s.daily) checkBoard(s.daily,getDailyLevel(new Date(s.daily.dateKey+'T00:00:00Z'),s.daily.levelVersion || 1));
  if (s.replay) checkBoard(s.replay,levels[s.replay.levelIndex]);
  const completions = normalized.campaign.completedLevels + normalized.dailyStats.totalCompletions;
  if (s.garden?.plots.some(p=>p.index>=Math.min(48,4+Math.floor(completions/5)*4)||p.plantedAt>completions) || (s.garden?.plots.length || 0)>1+completions) fail();
  // Preserve the stored daily board; normal gameplay rolls it over on the next day.
  if (s.daily) normalized.daily = s.daily;
  return normalized;
}
