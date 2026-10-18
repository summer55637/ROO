# RO 地圖通行格資料流程

本流程把作者已取得授權的 RO 客戶端 .gat 地形檔轉成靜態 JSON，供純前端與 GitHub Pages 使用；不需要遊戲伺服器或建置後端。

## 轉換

先將對應地圖的 .gat 檔放在本機工作目錄，再執行：

    node tools/convert_gat.js --input /path/to/prontera.gat --out data/maps/prontera.walk.json --map prontera

整批轉換已解出的多張地圖（只掃資料夾第一層的 `.gat` 檔）：

    node tools/convert_gat.js --input-dir /path/to/extracted/maps --out-dir data/maps

每張地圖會依檔名輸出成小寫的 `<mapId>.walk.json`。即使其中某張失敗，工具仍會繼續處理其餘檔案，最後列出成功／失敗數；只要有失敗，程序就會以非零狀態結束，適合接進自動化檢查。

輸出只保留通行格，不保留四角高度資料，並使用 RLE 壓縮，避免把每格展開成大量 JSON 布林值。地圖 ID 必須與遊戲資料中的 map.id 一致。

## 格子規則

- 格式版本：GAT 1.2／1.3；檔頭為 GRAT。
- 檔頭 14 bytes；每格 20 bytes，地形欄位從每格偏移 16 開始，原始欄位長 32-bit；地形類型讀取低 16-bit。
- 座標原點是西南角；x 向東、y 向北，從 0 開始。GAT 單格為 5 個 RO 世界單位；GND 每個地面方格跨 2×2 個 GAT 格（10 個世界單位）。使用 ragx 的 `--world-scale 0.2` 時，每個 GAT 格在 GLB 中寬 1 單位。
- 地形類型 0、2、3、4、6 可走；1（障礙）與 5（懸崖）不可走。未知類型保守視為不可走，與 rAthena 的 map_gat2cell() 保持一致。
- GAT 1.3 以 32-bit 地形欄位的最高位標記水域（原始小端數值例如 `0x80000001`；讀取偏移 `+18` 的高字時旗標為 `0x8000`）。只在版本 1.3 解讀此旗標；版本 1.2 同位置可能是未定義資料，必須忽略。水域標記只供統計，不會覆寫地形通行判定。

參考：
- [Ragnarok GAT 格式](https://github.com/rdw-archive/RagnarokFileFormats/blob/master/GAT.MD)
- [rAthena map_gat2cell()](https://github.com/rathena/rathena/blob/master/src/map/map.cpp#L3279-L3298)：實際將 0、2、3、4、6 判定為可走，1、5 不可走；本專案通行格轉換沿用此判定。

## 尋路核心

js/map_pathfinding.js 提供解碼器、格子判定、A* 八方向尋路、最近可走格查找與畫面座標轉格工具。A* 使用 Uint32／Int32／Uint8 定長陣列保存分數、前驅與封閉集合，降低大型地圖的瀏覽器記憶體壓力。對角移動不能穿過兩個障礙格形成的牆角。 另提供 ragx GLB 世界座標與 GAT 格座標的雙向轉換：以地形原點為中心、-Z 為北，每格 5 個世界單位並接受 `--world-scale`；這個工具只處理水平面座標，不猜測 GAT 高度。

目前倉庫尚未納入真正地圖的 .gat 通行資料，也尚未完成 .gnd 地圖渲染；因此這次先落實資料轉換與可測試的尋路核心，尚不把它冒充成已完成的 RO 地圖碰撞。實際遊戲接線需在地圖專屬圖面與轉換後通行格對齊後完成。


## 渲染器與素材來源調查（2026-10-18）

### 格式依據
- [GAT 格式](https://github.com/rdw-archive/RagnarokFileFormats/blob/master/GAT.MD)：逐格高度與地形通行類型。
- [GND 格式](https://github.com/rdw-archive/RagnarokFileFormats/blob/master/GND.MD)：地面網格、材質索引、UV、頂點色與光照貼圖。
- [RSW 格式](https://github.com/rdw-archive/RagnarokFileFormats/blob/master/RSW.MD)：地圖場景設定、物件位置與關聯資源。
- [rAthena 地形判定](https://github.com/rathena/rathena/blob/master/src/map/map.cpp)：核對 GAT 地形種類是否可走。

### 可參考的實作與工具
- [ragx](https://github.com/joaopedrosgs/ragx)：MIT 授權的本機轉換工具，支援 GAT 1.2／1.3、GND 1.7–1.9、RSW 1.9–2.7，可從本機客戶端 GRF 輸出 glTF／GLB。程式碼的 MIT 授權不等於 RO 素材授權；輸入只用作者已獲授權的客戶端素材。
- [roBrowser](https://github.com/vthibault/roBrowser)：JavaScript／WebGL 的 RO 瀏覽器端實作。可研究其 GND、GAT、RSW loader 與地圖 renderer；移植程式碼前，先確認 GPL-3.0 與本倉庫條款的相容性。
- [ragassets](https://github.com/adsonpleal/ragassets)：MIT 授權的素材解析／服務程式，適合參考資源組織；正式遊戲不把公開示範服務當執行時依賴。

### 地圖座標校對
使用作者獲授權的本機 RO 客戶端轉換單張地圖，先驗證 GND 與 GAT 格線重疊；不必先轉換整個世界。

    ragx maps prontera --client "C:/Gravity/Ragnarok" --format glb --world-scale 0.2 --out ./tmp/roo-map

輸出 GLB 後，開啟 tools/map_preview.html，選取 tmp/roo-map/maps/prontera.glb 與相同地圖的原始 prontera.gat。兩個檔案的地圖 ID 必須一致；不一致時會停止疊圖，避免誤校對。世界比例必須與轉換參數一致：例如 --world-scale 0.2 時，預覽比例設為 0.2（每個 GAT 格寬 1 個 glTF 單位）。此比例可調整，但 GLB 與 GAT 必須使用同一比例。預覽工具可旋轉／縮放並疊加可走、阻擋與水域標記；它只供開發校對，未加入遊戲執行流程。Three.js 使用固定版本 CDN 僅限這個工具頁，遊戲本體仍不依賴它。

## 尚未完成的下一階段

1. 從作者已獲授權的客戶端素材抽取實際地圖及其相依材質／模型，先選一張小範圍地圖驗證；不把外部服務作為正式素材來源。
2. 在純前端實作或挑選授權相容的 GND 渲染層，對齊 GND 地面座標、畫面投影與 GAT 通行格座標。
3. 把點擊目的地接上 GAT A* 路徑，逐格移動並保存位置；在地圖資產及畫面投影未接妥前，不宣稱已完成真正的 RO 地形碰撞。
