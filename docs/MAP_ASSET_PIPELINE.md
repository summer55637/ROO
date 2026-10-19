# RO 原生地圖資料接入

## 本輪新增

`js/ro_map.js` 提供純前端 GAT 解析器：

- 支援已確認的 GAT 1.2 / 1.3 標頭和 20-byte 格子結構。
- 解析四角高度、原始地形旗標、可行走判斷與 GAT 1.3 水面旗標。
- 支援少數舊檔的前置零位元組，並檢查檔案長度、尺寸與非有限高度。
- `ROMapData.loadGat(url)` 可從同源靜態檔案用 `fetch` 載入；不需要後端。

## 重要限制

**原生 GND/RSW 渲染仍未完成。** 倉庫目前沒有已配對的原始 GAT/GND/RSW 組合；因此不能把預覽圖宣稱為原生 3D 地圖。普隆德拉例外：已接入開源轉換專案提供的 GAT 衍生建築阻擋區，用它生成 104×104 導航格，限普隆德拉使用。

原生地圖需要把檔案配套處理：

- **GAT**：高度與地形通行資料。
- **GND**：地面網格、材質、貼圖與光照資料。
- **RSW**：場景參照、擺放物件、燈光和部分版本的水面設定。

取得匹配的地圖檔後，下一步才是把 GAT 格子座標映射至角色畫面座標，讓點擊移動尋路避開障礙，再以配對的 GND/RSW 資料渲染真正的 RO 場景。

## GAT 導航格與 A* 尋路（本輪）

`ROMapData.findPath()` 現在能在 GAT 網格上以 A* 找路，支援八方向／四方向、對角防穿角與搜尋上限。探索模組增加 `setRoExplorationGatMap()` 接口，接入匹配地圖後，點地移動會按路徑逐格行走，無路可走則拒絕移動；鍵盤／觸控方向移動仍保留原控制方式。

**目前沒有可安全啟用的完整原生地圖組合。** 倉庫仍未包含已配對的 GAT/GND/RSW 和對應畫面；所以這輪不自動將任意 GAT 套到現有通用背景，以免畫面與碰撞不一致。普隆德拉目前會從 `data/maps/prontera-blocked-zones.json` 載入來源專案衍生的阻擋區，透過 `js/ro_prontera.js` 生成暫用 GAT 格網並呼叫 `setRoExplorationGatMap(mapData)`。點擊移動會用 A* 繞開已知建築區，鍵盤／觸控移動也會阻擋進入已標記格。此格網不是原始 .gat 完整逐格資料，所以只限與此預覽配套的普隆德拉，不會套到其他地圖。GAT 的資料用途與格子高度／地形旗標已參考 [Ragnarok Research Lab 的 GAT 規格](https://ragnarokresearchlab.github.io/file-formats/gat/)。

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


## 普隆德拉碰撞接線（新增）

- `data/maps/prontera-blocked-zones.json`：182 個矩形阻擋區，取自 `portons/codex-pet-share` 生成資料，其專案文件標記這批區域來源為 GAT 網格；已附 MIT 授權文字與來源紀錄。
- `js/ro_prontera.js`：只在普隆德拉載入該靜態 JSON，建立 104×104 的暫用通行格，再交給既有 `ROMapData.findPath()`。
- 點地移動使用 A* 繞開阻擋格；WASD、方向鍵與手機方向按鈕不能穿過已標記格，遇牆會嘗試沿邊滑動。
- 離開普隆德拉會解除該碰撞格；其餘地圖不會套用同一份格網。
- 該資料只涵蓋已辨識的阻擋區，沒標記的格子暫視為可走；要達到正式原生 GAT 精度，仍需匯入該地圖的完整原始 GAT 並對齊 GND/RSW。


## 普隆德拉 3D 靜態網格渲染（新增）

- `data/maps/prontera-scene.json`：86 組已轉換地面／建築網格，15,749 個三角形；使用同一來源專案提供的轉換幾何。
- `images/maps/prontera/textures/*.webp`：86 張配套貼圖（約 2.75 MB），連同完整 MIT 授權文字一併放入倉庫。
- `js/ro_prontera_3d.js`：純前端 WebGL 1 靜態網格渲染器，不依賴 CDN、後端或執行時第三方主機。只在普隆德拉地圖選取後載入，其他地圖不下載這些資產。
- 場景可見後會把探索角色的位置投影到 3D 地面，點擊 3D 地圖則反算目的地，再沿普隆德拉衍生碰撞格尋路。
- 這是開源轉換專案產生的普隆德拉中心切片，不是完整官方客戶端 GND/RSW/RSM 讀取器；目前僅處理已轉成網格的靜態物件，尚無模型動畫、動態燈光／水面，也未將 3D 模型的遮擋深度整合至角色精靈。
