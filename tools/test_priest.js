/* 祭司 19 技能照官方名單重排（#95）。

   使用者對照 https://ro.ntome.com/skill/pr（＝倉庫裡的 `ro_skill_data/js_data/sk_pr.js`）
   逐支指定了效果。這支盯兩件事：
     1. 名單本身——19 支、名字跟官方一字不差、沒有自己複製的分身
     2. 那批新東西的機制——全體 buff 的分享與過期、防禦屬性、中毒免疫、
        鋅幣消耗、普攻沉默、隊友復活

   官方名單直接讀 `ro_skill_data/js_data/sk_pr.js`，不在測試裡另抄一份。

     node tools/test_priest.js  */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./harness');
const t = H.tester();

// 官方那份（19 支的 id 順序照網頁上二轉那一欄）
const OFFICIAL_IDS = ['PR_MACEMASTERY', 'MG_SRECOVERY', 'PR_SANCTUARY', 'PR_MAGNIFICAT',
  'PR_GLORIA', 'PR_KYRIE', 'PR_IMPOSITIO', 'PR_SUFFRAGIUM', 'PR_ASPERSIO', 'PR_BENEDICTIO',
  'MG_SAFETYWALL', 'PR_SLOWPOISON', 'PR_STRECOVERY', 'PR_RESURRECTION', 'PR_LEXDIVINA',
  'PR_TURNUNDEAD', 'PR_LEXAETERNA', 'PR_MAGNUS', 'PR_REDEMPTIO'];
const officialCtx = {};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '..', 'ro_skill_data', 'js_data', 'sk_pr.js'), 'utf8'),
  officialCtx);
const OFFICIAL = officialCtx.class_skill;

const g = H.boot();
const prSkills = g.JOB_TREE.priest.skills;
const byName = {};
prSkills.forEach(s => { byName[s.name] = s; });

// ---- 1. 名單本身 ----------------------------------------------------------
{
  t.eq('祭司剛好 19 支', prSkills.length, 19);
  const missing = OFFICIAL_IDS.map(k => OFFICIAL[k].nameZh).filter(n => !byName[n]);
  t.eq('官方 19 支的名字全部找得到', missing.join('、'), '');
  const extra = prSkills.map(s => s.name)
    .filter(n => !OFFICIAL_IDS.some(k => OFFICIAL[k].nameZh === n));
  t.eq('沒有官方名單以外的技能', extra.join('、'), '');
  /* 等級上限跟官方對齊，三支例外：
       捨身取義  官方寫 0（不是靠加點拿的），本作給 1
       聖母之頌歌 使用者指定壓成 1 級
       沉默之術   使用者指定改成 1 級的被動 */
  const LV_EXEMPT = ['捨身取義', '聖母之頌歌', '沉默之術'];
  const lvBad = OFFICIAL_IDS.map(k => OFFICIAL[k])
    .filter(o => !LV_EXEMPT.includes(o.nameZh) && byName[o.nameZh].maxLv !== o.maxLv)
    .map(o => `${o.nameZh} ${byName[o.nameZh].maxLv}≠${o.maxLv}`);
  t.eq('等級上限跟官方一致（三支使用者指定的例外除外）', lvBad.join('、'), '');
  t.eq('聖母之頌歌壓成 1 級', byName['聖母之頌歌'].maxLv, 1);
  t.eq('沉默之術壓成 1 級', byName['沉默之術'].maxLv, 1);
}
{
  /* 暗之障壁官方就是 `MG_SAFETYWALL`，法師與祭司學的是**同一支**。
     以前祭司自己複製了一份 `darkbarrier`，兩支同名同效果。 */
  t.ok('沒有 darkbarrier 這個分身了', !g.SKILLS.darkbarrier);
  t.eq('祭司的暗之障壁就是法師那支', byName['暗之障壁'].id, 'safetywall');
  t.ok('法師線也還拿得到', (g.JOB_TREE.mage.skills || []).some(s => s.id === 'safetywall'));
}
{
  /* `isQuest` 在本作等於「自動給 Lv1、不能加點」——掛在有 3~10 級的技能上
     就是把它永久鎖死在 Lv1。只有 maxLv 1 的那兩支留著。 */
  const quest = prSkills.filter(s => s.isQuest);
  t.eq('任務技能只剩 maxLv 1 的那兩支', quest.map(s => s.name).sort().join('、'), '天使之怒、捨身取義');
  t.ok('鈍器使用熟練度點得到 Lv10', !byName['鈍器使用熟練度'].isQuest);
  t.ok('復活術點得到 Lv4', !byName['復活術'].isQuest);
}

// ---- 1b. 服事那 15 支（#96）------------------------------------------------
{
  const AL = Object.keys(OFFICIAL).filter(k => k.startsWith('AL_'));
  const ac = g.JOB_TREE.acolyte;
  const mine = {};
  ac.skills.forEach(s => { mine[s.name] = s; });

  t.eq('職業名是「服事」', ac.name, '服事');
  t.eq('服事剛好 15 支', ac.skills.length, 15);
  const miss = AL.map(k => OFFICIAL[k].nameZh).filter(n => !mine[n]);
  t.eq('官方 15 支的名字全部找得到', miss.join('、'), '');
  const extra = ac.skills.map(s => s.name).filter(n => !AL.some(k => OFFICIAL[k].nameZh === n));
  t.eq('沒有官方名單以外的技能', extra.join('、'), '');
  const lvBad = AL.map(k => OFFICIAL[k]).filter(o => mine[o.nameZh] && o.maxLv > 0
    && mine[o.nameZh].maxLv !== o.maxLv).map(o => o.nameZh);
  t.eq('等級上限跟官方一致', lvBad.join('、'), '');

  /* 官方只有神聖之光是 `maxLv: 0`（不靠加點拿的），其餘 14 支都要自己點。
     本作以前把瞬間移動／傳送之陣／光獵／光之障壁／天使之護五支標成任務技能，
     等於「自動給 Lv1、而且永遠加不了點」——天使之護有 10 級卻只吃得到 Lv1。 */
  const quest = ac.skills.filter(s => s.isQuest).map(s => s.name);
  t.eq('任務技能只有神聖之光', quest.join('、'), '神聖之光');
  t.eq('官方那邊也只有它是 maxLv 0',
    AL.filter(k => OFFICIAL[k].maxLv === 0).map(k => OFFICIAL[k].nameZh).join('、'), '神聖之光');
  t.eq('天使之護點得到 Lv10', mine['天使之護'].maxLv, 10);
}

// ---- 1c. 服事新做的三支（#97）----------------------------------------------
{
  const gg = H.boot();
  H.mkChar(gg, { path: ['acolyte'], job: 'acolyte' });

  // 神聖之光：官方 125% 聖屬性魔法，而且是轉職給的那一支
  const hl = gg.SKILLS.holylight;
  t.eq('神聖之光是攻擊技能', hl.type, 'magic');
  t.eq('聖屬性', hl.element, 'holy');
  t.eq('倍率 125%', hl.mult[0], 1.25);
  t.eq('轉職就會給', gg.state.learnedSkills.holylight, 1);

  // 治療術：被動，只解沉默／混亂／黑暗
  H.learn(gg, 'cure', 1);
  gg.recomputeDerived(false);
  t.ok('被動掛上了', gg.state.hasPartyAutoCure);
  gg.state.playerAil = {};
  ['silence', 'confusion', 'blind', 'bleed'].forEach(x => gg.applyPlayerAilment(x, { sec: 60 }));
  gg.state.partyAutoCureReadyAt = 0;
  gg.tickPartyAutoCure();
  t.eq('三種都解掉了，出血留著', Object.keys(gg.state.playerAil).join('、'), 'bleed');
  // 內部冷卻 10 秒：剛用過就不能再解
  gg.applyPlayerAilment('blind', { sec: 60 });
  gg.tickPartyAutoCure();
  t.ok('冷卻中不會再解', !!gg.state.playerAil.blind);
}
{
  // 天使之障壁：全體 DEF +% 與最大HP 固定值
  const { g: gg, ally } = party();
  // 天使之障壁是服事的技能，祭司的點數池不同——要先給服事那格點數才點得下去
  gg.state.jobSkillPoints.acolyte = 200;
  H.learn(gg, 'angelusbarrier', 10);
  const hp0 = gg.state.maxHp;
  t.eq('放之前沒有防禦加成', gg.buffMult('def').mult, 1);
  gg.castSkill('angelusbarrier');
  gg.recomputeDerived(false);
  t.near('Lv10 防禦 +50%', gg.buffMult('def').mult, 1.5, 0.001);
  t.eq('Lv10 最大HP +500', gg.state.maxHp - hp0, 500);
  t.ok('隊友也拿到兩個 buff',
    (ally.buffs || []).filter(b => b.skillId === 'angelusbarrier').length === 2);
}

// ---- 2. 全體輔助技 --------------------------------------------------------
function party() {
  const gg = H.boot();
  // 另一格存檔，拿來當隊友
  const src = H.boot();
  H.mkChar(src, { path: ['swordsman', 'knight'], job: 'knight', baseLevel: 60 });
  src.state.name = '隊友A';
  gg.localStorage.setItem(gg.getSlotKey(1), JSON.stringify(src.state));

  H.mkChar(gg, { path: ['acolyte', 'priest'], job: 'priest', baseLevel: 99 });
  gg.state.name = '主角';
  gg.state.gold = 5000000;
  gg.changeMap(gg.MAPS.find(m => (m.monsters || []).length === 0).id);
  gg.hireAlly('1');
  const ally = gg.state.allies[0];
  ally.buffs = [];
  return { g: gg, ally };
}
const PARTY_SKILLS = ['magnificat', 'gloria', 'kyrie', 'impositio_manus',
  'aspersio', 'sanctuary_holy', 'slowpoison'];
{
  t.eq('七支寫著「全體」的都標了 party',
    PARTY_SKILLS.filter(id => !g.SKILLS[id].party).join('、'), '');
  const wrong = prSkills.filter(s => s.party && !/全體/.test(s.desc || '')).map(s => s.name);
  t.eq('標了 party 的敘述都寫著全體', wrong.join('、'), '');
}
{
  const { g: gg, ally } = party();
  H.learn(gg, 'gloria', 5);
  t.ok('放得出來', gg.castSkill('gloria'));
  const mine = gg.state.buffs.find(b => b.skillId === 'gloria');
  const his = ally.buffs.find(b => b.skillId === 'gloria');
  t.ok('玩家身上有', !!mine);
  t.ok('隊友身上也有一份', !!his);
  t.ok('是兩個不同的物件（殘餘時間各自算）', mine !== his);
  t.eq('內容一樣', his.flatBonus, mine.flatBonus);
}
{
  // 過期：隊友那份也要自己消失（tickBuffs 只跑玩家那一份）
  const { g: gg, ally } = party();
  H.learn(gg, 'slowpoison', 1);          // Lv1 只有 10 秒
  gg.castSkill('slowpoison');
  t.eq('隊友拿到 1 個 buff', ally.buffs.length, 1);
  for (let i = 0; i < 101; i++) gg.tickAllyBuffs();   // 101 × 100ms
  t.eq('10 秒後隊友那份過期了', ally.buffs.length, 0);
}
{
  // 護盾不能共用同一個物件，不然一個人挨打全隊的盾一起磨光
  const { g: gg, ally } = party();
  H.learn(gg, 'kyrie', 10);
  gg.castSkill('kyrie');
  const mine = (gg.state.shields || []).find(sh => sh.id === 'kyrie');
  const his = (ally.shields || []).find(sh => sh.id === 'kyrie');
  t.ok('雙方都有盾', !!mine && !!his);
  t.ok('是兩面不同的盾', mine !== his);
  // 耐久照各自的 maxHp 算：血薄的祭司不該發給坦克一面只有自己血量三成的盾
  t.eq('隊友那面照隊友的 maxHp 算', his.remainingHp, Math.round(ally.maxHp * 0.30));
  const hp0 = his.remainingHp;
  gg.absorbWithShields(gg.state, 999999);
  t.eq('打爆玩家的盾，隊友那面完全沒動', his.remainingHp, hp0);
  t.eq('玩家的盾破了', (gg.state.shields || []).length, 0);
}
{
  // 重放不疊加：同一支技能的舊 buff 要先清掉
  const { g: gg, ally } = party();
  H.learn(gg, 'gloria', 5);
  gg.castSkill('gloria');
  gg.state.cooldowns = {};
  gg.castSkill('gloria');
  t.eq('隊友身上只有一份幸運之頌歌', ally.buffs.filter(b => b.skillId === 'gloria').length, 1);
}

// ---- 3. 聖之祈福：防禦屬性 -------------------------------------------------
{
  const gg = H.boot();
  H.mkChar(gg, { path: ['acolyte', 'priest'], job: 'priest' });
  H.learn(gg, 'sanctuary_holy', 5);
  t.eq('沒放之前是無屬性', gg.state.playerElement, 'none');
  gg.castSkill('sanctuary_holy');
  gg.recomputeDerived(false);      // 遊戲裡是 tickBuffs 每 100ms 幫你做這件事
  t.eq('放完變聖屬', gg.state.playerElement, 'holy');
  gg.state.buffs = gg.state.buffs.filter(b => b.type !== 'elearmor');
  gg.recomputeDerived(false);
  t.eq('過期後回到無屬性', gg.state.playerElement, 'none');
}

// ---- 4. 緩毒術：中毒免疫 ---------------------------------------------------
{
  const gg = H.boot();
  H.mkChar(gg, { path: ['acolyte', 'priest'], job: 'priest' });
  H.learn(gg, 'slowpoison', 4);
  t.ok('沒放之前中得了毒', gg.applyPlayerAilment('poison'));
  gg.castSkill('slowpoison');
  gg.recomputeDerived(false);
  t.eq('放下去就把身上的毒解掉', (gg.state.playerAil || {}).poison, undefined);
  t.eq('抗性拉到 100', gg.state.ailResist.poison, 100);
  t.ok('再中毒也中不了', !gg.applyPlayerAilment('poison'));
  t.ok('別的狀態照樣中得了', gg.applyPlayerAilment('stun'));
}

// ---- 5. 撒水祈福：鋅幣 -----------------------------------------------------
{
  const gg = H.boot();
  H.mkChar(gg, { path: ['acolyte', 'priest'], job: 'priest' });
  H.learn(gg, 'aspersio', 5);
  gg.state.gold = 5000;
  t.ok('放得出來', gg.castSkill('aspersio'));
  t.eq('扣 1500 鋅幣', gg.state.gold, 3500);
  t.ok('武器附上聖屬', gg.state.buffs.some(b => b.type === 'holyweapon'));
  gg.state.cooldowns = {};
  gg.state.gold = 100;
  t.ok('錢不夠就放不出來', !gg.castSkill('aspersio'));
  t.eq('放不出來就不扣錢', gg.state.gold, 100);
}

// ---- 6. 沉默之術：普攻觸發 -------------------------------------------------
{
  const gg = H.boot();
  H.mkChar(gg, { path: ['acolyte', 'priest'], job: 'priest' });
  t.eq('已經是被動', gg.SKILLS.impositio.type, 'passive');
  H.learn(gg, 'impositio', 1);
  gg.recomputeDerived(false);
  t.ok('被動掛上了', gg.state.hasAttackSilenceProc);
  t.eq('機率 20%', gg.state.attackSilenceChance, 20);

  const mon = H.mon(gg, { defId: 'poring', hp: 9e9 });
  const md = gg.MONSTERS.poring;
  let silenced = 0;
  const originalRandom = gg.Math.random;
  let rollIndex = 0;
  try {
    // 100 個均勻分布的百分位重複兩輪，讓 20% 機率測試完全可重現。
    gg.Math.random = () => ((rollIndex++ * 37) % 100) / 100;
    for (let i = 0; i < 200; i++) {
      gg.state.attackSilenceReadyAt = 0;    // 內部冷卻歸零，單純量機率
      mon.ail = {};
      gg.tryPriestProcs(mon, md);
      if (mon.ail && mon.ail.silence) silenced++;
    }
  } finally {
    gg.Math.random = originalRandom;
  }
  t.eq('200 次均勻抽樣應觸發 40 次沉默', silenced, 40);

  // 內部冷卻：剛觸發過就不該再中
  gg.state.attackSilenceReadyAt = Date.now() + 10000;
  mon.ail = {};
  for (let i = 0; i < 50; i++) gg.tryPriestProcs(mon, md);
  t.ok('冷卻中一次都不會觸發', !(mon.ail && mon.ail.silence));
}

// ---- 7. 復活術：扶起隊友 ---------------------------------------------------
{
  const { g: gg, ally } = party();
  H.learn(gg, 'resurrection', 4);          // Lv4＝回 80%、冷卻 60 秒、SP 60
  gg.recomputeDerived(true);
  t.ok('被動掛上了', gg.state.hasAutoRevive1);

  ally._downed = true;
  ally.hp = 0;
  ally._reviveAt = Date.now() + 999999;    // 葉子那條路還在冷卻，證明不是它救的
  const leaf0 = gg.getItemQty(gg.ALLY_REVIVE_ITEM);
  const sp0 = gg.state.sp;
  t.ok('扶得起來', gg.tryPriestReviveAlly(ally));
  t.ok('隊友站起來了', !ally._downed);
  t.eq('回 80% HP', ally.hp, Math.round(ally.maxHp * 0.8));
  t.eq('沒有吃掉天地樹葉子', gg.getItemQty(gg.ALLY_REVIVE_ITEM), leaf0);
  t.eq('扣了 60 SP', sp0 - gg.state.sp, 60);

  // 跟自己那半邊共用同一個冷卻——分兩份等於憑空多一次復活
  ally._downed = true;
  t.ok('冷卻中扶不起來', !gg.tryPriestReviveAlly(ally));
  /* 自己那半邊共用同一個冷卻——分兩份等於憑空多一次復活。
     （`tryAutoRevive()` 這時會落到捨身取義那條，所以驗的是復活術自己的旗標） */
  gg.state.hp = 0;
  const revive1Ready = Date.now() < gg.state.autoRevive1ReadyAt;
  t.ok('復活術自己也還在冷卻中', revive1Ready);
}

// ---- 8. 神威祈福：ATK 加成 -------------------------------------------------
{
  const { g: gg, ally } = party();
  H.learn(gg, 'impositio_manus', 5);
  /* `buff_atk` 不寫進 state.atk，是在算傷害時乘 `buffMult('atk')` */
  t.eq('放之前沒有加成', gg.buffMult('atk').mult, 1);
  gg.castSkill('impositio_manus');
  t.near('玩家 ATK ×1.15', gg.buffMult('atk').mult, 1.15, 0.001);
  t.ok('隊友也拿到了', ally.buffs.some(b => b.skillId === 'impositio_manus'));
}

process.exit(t.report('服事 15 + 祭司 19 技能'));
