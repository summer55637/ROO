import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const explorer = fs.readFileSync(path.join(root, 'tools/ro_explorer.mjs'), 'utf8');

assert.match(ui,
  /!\['attack', 'skill', 'status_tick', 'vitals'\]\.includes\(command\.type\)/,
  '主遊戲允許原生探索讀取生命值快照');
assert.match(ui,
  /if \(command\.type === 'vitals'\) \{\s*result = state \? \{\s*ok: true, accepted: true,\s*playerHp: state\.hp,\s*playerMaxHp: state\.maxHp,\s*playerSp: state\.sp,\s*playerMaxSp: state\.maxSp(?:,|\s*\})/,
  '生命值快照必須讀取主遊戲當前 HP／SP');
assert.match(explorer,
  /function requestRoExplorerVitals\(\)[\s\S]*?type: 'vitals',[\s\S]*?localStorage\.setItem\(RO_EXPLORER_COMBAT_COMMAND_KEY, JSON\.stringify\(command\)\)/,
  '探索頁定時向同源主遊戲請求新快照');
assert.match(explorer,
  /if \(result\.requestType === 'vitals'\) \{\s*if \(result\.requestId !== pendingVitalsRequestId\) return;\s*pendingVitalsRequestId = null;\s*if \(result\.ok && result\.accepted\) updatePlayerVitals\(/,
  '探索頁只接受本次輪詢的回覆並更新狀態條');
assert.match(explorer,
  /vitalsPollTimer = window\.setInterval\(requestRoExplorerVitals, 1000\)/,
  '生命值輪詢頻率限制為每秒一次');
assert.match(explorer,
  /window\.addEventListener\('pagehide',[\s\S]*?clearInterval\(vitalsPollTimer\)[\s\S]*?pendingVitalsRequestId = null/,
  '離開頁面會停止輪詢並清除待回覆識別碼');
assert.match(explorer,
  /window\.addEventListener\('pageshow',[\s\S]*?setVitalsPollingMode\('native'\)/,
  '從 BFCache 返回會恢復生命值同步');

console.log('原生探索 HP／SP 即時同步橋接測試通過。');
