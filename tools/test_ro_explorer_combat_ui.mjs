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
  /function updatePlayerVitals\(values, options = \{\}\)/,
  '探索頁提供角色 HP／SP 狀態同步入口');
assert.match(explorer,
  /updatePlayerVitals\(\{\s*hp: result\.playerHp,\s*maxHp: result\.playerMaxHp,\s*sp: result\.playerSp,\s*maxSp: result\.playerMaxSp,/,
  '主遊戲戰鬥回覆更新角色 HP／SP');
assert.match(explorer,
  /if \(result\.requestType === 'status_tick'\) \{\s*if \(result\.requestId !== pendingStatusTickId\) return;\s*pendingStatusTickId = null;\s*updatePlayerVitals\(\{[\s\S]*?\}\);\s*updatePlayerProgress\(result\);/,
  '持續傷害回覆立即刷新探索等級、經驗與鋅幣');
assert.match(explorer,
  /if \(!pendingCombatRequest \|\| result\.requestId !== pendingCombatRequest\.requestId\) return;[\s\S]*?updatePlayerVitals\(\{\s*hp: result\.playerHp,[\s\S]*?\}, \{ showDamage: true \}\);\s*updatePlayerProgress\(result\);/,
  '普攻／技能回覆立即刷新探索等級、經驗與鋅幣');
assert.match(explorer,
  /updateRoExplorerGauge\(monsterHpGauge, monsterHpBar, monsterHpValue, hp, maxHp\)/,
  '目前目標 HP 會轉成可見血條');
console.log('原生探索戰鬥 UI 目標隔離與 HP／SP 狀態列接線測試通過。');

assert.match(explorer,
  /if \(skill\.isSelfBuff\) \{\s*queuedCombatSkill = null;\s*sendRoExplorerSkillRequest\(entry, skill\);\s*return;\s*\}/,
  '自身增益不需要先走到怪物附近');
assert.match(explorer,
  /if \(result\.accepted && \(!result\.isSelfBuff \|\| Number\(result\.damageDealt\) > 0\)\) \{/,
  '自身增益不會因零傷害被畫成 MISS');
assert.match(explorer,
  /const note = result\.isSelfBuff\s*\? skillName \+ ' 已施放，自身增益已生效。'/,
  '自身增益顯示施放成功訊息');
const html = fs.readFileSync(path.join(root, 'tools/ro_explorer.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
assert.match(html, /id="support-skill"/, '探索角色狀態面板提供獨立恢復／輔助清單');
assert.match(html, /id="cast-support-skill"/, '探索角色狀態面板提供無目標施放按鈕');
assert.match(explorer,
  /function requestRoExplorerSupportSkill\(skill\)[\s\S]*?type: 'support_skill'[\s\S]*?mapId: mapInfo\.mapId, skillId: skill\.id/,
  '恢復／輔助命令不需要怪物目標');
assert.match(ui, /'support_skill'[\s\S]*?castRoExplorerSupportSkill\(command\.sessionId, command\.mapId, command\.skillId\)/,
  '主遊戲橋接把無目標輔助技能交給主引擎');
assert.match(explorer,
  /if \(result\.requestType === 'support_skill'\)[\s\S]*?updatePlayerVitals\([\s\S]*?updatePlayerProgress\(result\)[\s\S]*?return;/,
  '恢復／輔助回覆更新 HP／SP 與進度 HUD，不讀取怪物目標');
console.log('原生探索自身增益與恢復／輔助 UI 接線測試通過。');
