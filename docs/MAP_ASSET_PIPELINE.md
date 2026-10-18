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

## 格式參考

- [Ragnarok Research Lab — GAT](https://ragnarokresearchlab.github.io/file-formats/gat/)
- [Ragnarok Research Lab — GND](https://ragnarokresearchlab.github.io/file-formats/gnd/)
- [Ragnarok Research Lab — RSW](https://ragnarokresearchlab.github.io/file-formats/rsw/)
- [rAthena — Map_SetGatCell](https://github.com/rathena/rathena/wiki/Map_SetGatCell)
- [RagX：RO 素材轉 GLTF 等格式的開源工具](https://github.com/joaopedrosgs/ragx)
- [ragassets：從本機 GRF 萃取素材的開源工具](https://github.com/adsonpleal/ragassets)

外部工具僅作格式與轉換參考；遊戲執行時仍以 ROO 自己的靜態檔案為準，不依賴第三方服務。
