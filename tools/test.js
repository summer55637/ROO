/* 一次跑完所有測試。

     node tools/test.js

   任何一支失敗就整體 exit 1，所以可以直接接在 commit 前面當關卡。
   新增測試檔只要放進下面的 SUITES。

   **跑得到什麼、跑不到什麼**：這些測試載入的是 js/ 底下同一份程式碼，
   走的是真正的 recomputeDerived / castSkill / playerAttack，
   所以數值與機制的錯抓得到（buff 推了沒人讀、倍率乘錯尺度、條件式加成沒生效…）。
   但**沒有載入 js/ui.js**，畫面長什麼樣、分頁會不會炸，還是得開瀏覽器看。
*/
const { execFileSync } = require('child_process');
const path = require('path');

const SUITES = [
  'test_smoke.js',        // 全庫掃描，先跑：這支掛了通常代表載入或資料壞了
  'test_lordknight.js',   // 領主騎士 8 技能（#58）
  'test_assassincross.js',// 十字刺客 5 技能 + 技能點溢出修復（#59）
  'test_whitesmith.js',   // 神匠 5 技能 + 進階二轉取代二轉（#60）
  'test_sniper.js',      // 狙擊之王 4 技能 + 轉職理由（#61）
  'test_highwizard.js',  // 高等巫師 6 技能（#63）
  'test_highpriest.js',  // 高階祭司 4 技能 + 進階二轉收尾（#64）
  'test_bossslaves.js',  // 召喚小弟 + BOSS 模式限近戰（#65）
  'test_crusader.js',    // 十字軍 10 技能 + requiresEquip（#66）
  'test_bard_dancer.js', // 詩人與舞孃 + 互斥組與合奏（#68）
  'test_rogue.js',       // 流氓 13 技能 + 卸除疊加與抄襲（#69）
  'test_monk.js',        // 武僧 17 技能 + 氣球體與連段（#70）
  'test_sage.js',        // 賢者 22 技能 + 元素領域與資源取用（#71）
  'test_alchemist.js',   // 鍊金術士 16 技能 + 場域召喚與折扣鏈（#72）
  'test_paladin.js',     // 聖殿十字軍 4 技能 + 分支線轉生斷層（#74）
  'test_professor.js',   // 智者 8 技能 + ATK 命中判定規則（#76）
  'test_clown_gypsy.js', // 搞笑藝人／冷豔舞姬 5 技能（#77）
  'test_creator.js',     // 創造者 3 技能（#78）
  'test_stalker_champion.js', // 神行太保 4 + 武術宗師 4 技能（#79）
  'test_expcurve.js',    // 經驗曲線重配 + 破表怪物 + GM 測試鈕（#80）
  'test_codex.js',       // 圖鑑尋寶導航：出現率／道具→怪→圖整條鏈（#81）
  'test_party.js',       // 隊友系統：換身戰鬥／獎勵導向／承傷分配／復活（#83）
  'test_priest.js',      // 祭司 19 技能：全體輔助／防禦屬性／中毒免疫／普攻沉默／隊友復活（#95）
  'test_hpsp.js',        // HP/SP 官方公式：拿掉 hpMod/spMod、轉生 ×1.25（#92）
  'test_relics.js',      // 遺物系統：2/3/5 門檻、互斥倍率、濺射、掉落閘門、遺物券（#113）
  'test_equipfx.js',     // 裝備自身特效：加成表接線、無視物防、觸發型籃子（#127）
  'test_ammo.js',        // 箭矢：整條弓箭手線的自動選種與自動補貨（#129）
  'test_party_buffs.js', // 各職業的隊伍效果：party 旗標涵蓋面與互斥組分享（#130）
  'test_cardsets.js',    // 職業套卡：單張不白拿、湊齊才生效、套裝標籤（#134）
  'test_idle_offline.js',// 掛機結算：切分頁即離線、隊友也要算、收益紀錄（#135）
  'test_cardfx_136.js',  // 巴風特濺射、達納托斯卡片、無視物防要對普攻生效（#136）
  'test_drops_138.js',   // 緋紅上架、自動念咒吃學習等級、圖鑑分類（#138）
  'test_vending_ore_148.js', // 露天商店上架與原石全部合成（#148）
  'test_spawn_sfx_146.js', // 生怪速度顯示與事件音效（#146）
  'test_offline_kill_drops_145.js', // 離線結算漏掉的擊殺時效果（#145）
  'test_boxes_143.js',   // 箱子一次開啟：數量守恆、紀錄合併、上限（#143）
  'test_equipsets_144.js',// 說明欄有、實裝沒有的三組裝備套裝（#144）
  'test_images.js',      // 圖檔接線：別名指得到、圖鑑內不再長出缺圖（#141）
  'test_autosell_sync.js', // 自動販賣清單跨存檔同步（#140）
  'test_saveio.js',      // 存檔匯出/匯入：序列化、遷移、覆寫與失敗還原
  'test_exploration.js', // 探索移動：位置範圍、切圖重設、舊存檔遷移
  'test_map_pathfinding.js', // GAT 通行格、A* 繞路與地圖座標轉換
];

let failed = 0;
for (const f of SUITES) {
  try {
    process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, f)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  } catch (e) {
    if (e.stdout) process.stdout.write(e.stdout);
    failed++;
  }
}
console.log(failed ? `\n❌ ${failed}/${SUITES.length} 個測試檔有失敗` : `\n全部通過（${SUITES.length} 個測試檔）`);
process.exit(failed ? 1 : 0);
