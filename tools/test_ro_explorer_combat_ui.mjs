import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const explorer = fs.readFileSync(path.join(root, 'tools/ro_explorer.mjs'), 'utf8');

assert.match(explorer,
  /function renderSelectedRoExplorerMonster\(entry, note\) \{\s*if \(!entry \|\| entry !== selectedMonsterEntry\) return;/,
  '怪物資訊面板只能由目前選取的目標更新');
assert.match(explorer,
  /const wasSelected = selectedMonsterEntry === entry;\s*if \(wasSelected\) selectedMonsterRing\.visible = false;\s*if \(activeCombatTarget === entry\) activeCombatTarget = null;\s*if \(wasSelected\) \{\s*renderSelectedRoExplorerMonster\(entry, '已擊敗；持續傷害與獎勵由主遊戲引擎結算。'\);\s*setStatus\('持續傷害擊敗 '/,
  '未選取怪物的持續傷害死亡不會覆蓋目前面板');
assert.match(explorer,
  /const wasSelected = selectedMonsterEntry === entry;\s*if \(wasSelected\) selectedMonsterRing\.visible = false;\s*if \(activeCombatTarget === entry\) activeCombatTarget = null;\s*if \(wasSelected\) \{\s*renderSelectedRoExplorerMonster\(entry, '已擊敗；經驗、職業經驗、金幣及掉落由主遊戲引擎結算。'\);\s*setStatus\('擊敗 '/,
  '非目前選取目標的普攻／技能死亡不會覆蓋狀態訊息');
assert.match(explorer,
  /if \(selectedMonsterEntry === entry\) \{\s*setStatus\(result\.error/,
  '舊目標的錯誤回報不會覆蓋新目標狀態');
assert.match(explorer,
  /function updatePlayerVitals\\(values, options = \\(\{\}\\)\\)/,
  '探索頁提供角色 HP／SP 狀態同步入口');
assert.match(explorer,
  /updatePlayerVitals\(\{\s*hp: result\.playerHp,\s*maxHp: result\.playerMaxHp,\s*sp: result\.playerSp,\s*maxSp: result\.playerMaxSp,/,
  '主遊戲戰鬥回覆更新角色 HP／SP');
assert.match(explorer,
  /updateRoExplorerGauge\(monsterHpGauge, monsterHpBar, monsterHpValue, hp, maxHp\)/,
  '目前目標 HP 會轉成可見血條');
console.log('原生探索戰鬥 UI 目標隔離與 HP／SP 狀態列接線測試通過。');
