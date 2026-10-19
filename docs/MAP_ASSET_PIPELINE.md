# RO 原生地圖資料接入

## 本輪新增

`js/ro_map.js` 提供純前端 GAT 解析器：

- 支援已確認的 GAT 1.2 / 1.3 標頭和 20-byte 格子結構。
- 解析四角高度、原始地形旗標、可行走判斷與 GAT 1.3 水面旗標。
- 支援少數舊檔的前置零位元組，並檢查檔案長度、尺寸與非有限高度。
- `ROMapData.loadGat(url)` 可從同源靜態檔案用 `fetch` 載入；不需要後端。

## 重要限制

**這不是已完成的原生 RO 地圖渲染，也尚未把碰撞套入探索移動。** 目前倉庫沒有與現有場景背景相配套的原生 GAT/GND/RSW 組合。為避免角色被不相干的地形格擋住，本輪只完成可測試的資料解析層。

原生地圖需要把檔案配套處理：

- **GAT**：高度與地形通行資料。
- **GND**：地面網格、材質、貼圖與光照資料。
- **RSW**：場景參照、擺放物件、燈光和部分版本的水面設定。

取得匹配的地圖檔後，下一步才是把 GAT 格子座標映射至角色畫面座標，讓點擊移動尋路避開障礙，再以配對的 GND/RSW 資料渲染真正的 RO 場景。

## GAT 導航格與 A* 尋路（本輪）

`ROMapData.findPath()` 現在能在 GAT 網格上以 A* 找路，支援八方向／四方向、對角防穿角與搜尋上限。探索模組增加 `setRoExplorationGatMap()` 接口，接入匹配地圖後，點地移動會按路徑逐格行走，無路可走則拒絕移動；鍵盤／觸控方向移動仍保留原控制方式。

**目前沒有可安全啟用的完整原生地圖組合。** 倉庫仍未包含已配對的 GAT/GND/RSW 和對應畫面；所以這輪不自動將任意 GAT 套到現有通用背景，以免畫面與碰撞不一致。取得並渲染匹配場景後，再由場景載入器呼叫 `setRoExplorationGatMap(mapData)`。GAT 的資料用途與格子高度／地形旗標已參考 [Ragnarok Research Lab 的 GAT 規格](https://ragnarokresearchlab.github.io/file-formats/gat/)。

## 水面波紋（本輪）

`js/ro_water.js` 在既有水域圖層加入純 Canvas 波紋擴散；水下場景改畫緩慢流動的光紋。只在 `renderMapBackground()` 判定為水域時掛載，沒有外部網路依賴，並限制畫布像素比以控制手機成本。

這是現有背景上的程序化視覺效果，**不是原生 RO 的 RSW/GND 水面渲染**，也沒有取代地圖原始素材。原生水面仍須有同一地圖的 GAT/GND/RSW、材質與動畫影格配套後才能接入。

## 格式參考

- [Ragnarok Research Lab — GAT](https://ragnarokresearchlab.github.io/file-formats/gat/)
- [Ragnarok Research Lab — GND](https://ragnarokresearchlab.github.io/file-formats/gnd/)
- [Ragnarok Research Lab — RSW](https://ragnarokresearchlab.github.io/file-formats/rsw/)
- [rAthena — Map_SetGatCell](https://github.com/rathena/rathena/wiki/Map_SetGatCell)
- [RagX：RO 素材轉 GLTF 等格式的開源工具](https://github.com/joaopedrosgs/ragx)
- [ragassets：從本機 GRF 萃取素材的開源工具](https://github.com/adsonpleal/ragassets)

外部工具僅作格式與轉換參考；遊戲執行時仍以 ROO 自己的靜態檔案為準，不依賴第三方服務。


## 普隆德拉 2D 地圖預覽（新增）

`images/maps/prontera-minimap.webp` 取自開源專案 `portons/codex-pet-share` 的已生成俯視預覽，並依其 MIT 授權附帶完整授權文字及來源紀錄。只在 `prontera` 地圖選取時顯示，作為更明確的普隆德拉畫面素材；此圖不等於原生地圖渲染，亦不啟用 GAT 碰撞／尋路。遊戲執行時使用倉庫內靜態檔，不呼叫外部來源。
