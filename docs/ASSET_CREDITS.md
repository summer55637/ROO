# 第三方素材與授權紀錄

## 普隆德拉地圖預覽

- 檔案：`images/maps/prontera-minimap.webp`
- 來源專案：[portons/codex-pet-share](https://github.com/portons/codex-pet-share)
- 原始檔：[prontera-minimap.webp](https://github.com/portons/codex-pet-share/blob/main/public/assets/biomes/ro-prontera/prontera-minimap.webp)
- 來源授權：MIT，完整條款保存在 [`licenses/CODEX_PET_SHARE_MIT.txt`](../licenses/CODEX_PET_SHARE_MIT.txt)
- 用途：普隆德拉場景的 2D 俯視預覽；由來源專案文件記載為根據 RO 地圖幾何生成。

這是畫面背景預覽，不是 RO 原生 GND/RSW 場景渲染，也沒有帶入完整模型、動畫、光照或碰撞。它不會自動啟用 GAT 尋路。專案內其他地圖仍使用原有背景；遊戲載入時不會連線到素材來源網站。

RO 相關原始內容的使用仍依本專案作者聲明已取得的授權及其文件範圍處理。上游 MIT 條款不代表將 RO 原始內容的權利重新授予任何人。


## 普隆德拉碰撞區資料

- 檔案：`data/maps/prontera-blocked-zones.json`
- 來源專案：[`portons/codex-pet-share`](https://github.com/portons/codex-pet-share)
- 來源資料：[`roPronteraBiome.generated.ts`](https://github.com/portons/codex-pet-share/blob/27996cafa42119c86db5472af852a3ef185723f4/src/playground/core/roPronteraBiome.generated.ts)，由其公開的 3D 普隆德拉場景生成器提取。
- 授權：MIT，文字見 [`licenses/CODEX_PET_SHARE_MIT.txt`](../licenses/CODEX_PET_SHARE_MIT.txt)。
- 範圍：182 個矩形阻擋區，作為預覽地圖的導航近似；不代表完整原始 GAT 格。


## 普隆德拉 3D 場景及貼圖

- 網格檔：`data/maps/prontera-scene.json`
- 貼圖目錄：`images/maps/prontera/textures/*.webp`（86 張）
- 上游來源專案：[`portons/codex-pet-share`](https://github.com/portons/codex-pet-share)
- 上游場景：[`prontera-plaza.json`](https://github.com/portons/codex-pet-share/blob/master/public/assets/biomes/ro-prontera/prontera-plaza.json)
- 上游素材說明：[`RO_ENVIRONMENT_ASSETS.md`](https://github.com/portons/codex-pet-share/blob/master/docs/RO_ENVIRONMENT_ASSETS.md)
- 程式與轉換後資產所附授權：MIT，全文見 [`licenses/CODEX_PET_SHARE_MIT.txt`](../licenses/CODEX_PET_SHARE_MIT.txt)。

此網格已包含該開源專案轉換出的地面與靜態建築幾何；RO 原始素材的使用仍依本專案作者持有的 RO 授權文件範圍處理。執行時僅請求 ROO 倉庫內的檔案。
