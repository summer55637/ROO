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

## 真實地圖探索原型（2026-10-18）

`tools/ro_explorer.html` 現在預設提供「公開地圖（免下載）」模式，內嵌公開的 [latamvisuais 地圖模擬器](https://github.com/adsonpleal/latamvisuais)，因此不用玩家先準備 GLB／GAT。進入公開預覽後，按模擬器內的地圖探索按鈕（葡萄牙文含「Caminhe com seu personagem…」）載入預設訓練場 `tra_fild`。若嵌入被瀏覽器或來源網站政策阻擋，可按「另開公開地圖來源」在新分頁操作。

資料與素材線索：
- [ragassets](https://github.com/adsonpleal/ragassets) 的公開資源主機提供地圖目錄、每張地圖的 manifest、原始 `.gat/.gnd/.rsw`、引用的模型和紋理。其 README 記錄目前資料集約 922 張地圖、跨地圖共用資源去重後約 5.8 GB。
- [latamvisuais](https://github.com/adsonpleal/latamvisuais) 已示範在瀏覽器以 Three.js 渲染 RO 地圖及角色；但它的 GAT/GND/RSW/RSM 解析器有部分註明源自 roBrowser／roBrowserLegacy。ROO 未直接複製這些解析器，以避免把 GPL 程式碼混入本專案。
- [ragx](https://github.com/joaopedrosgs/ragx) 是 MIT 授權的本機 GRF→GLB／glTF 轉換工具，並不附遊戲素材；仍保留在「本機 GLB/GAT」模式供後續自有素材整合。
- 公開預覽依賴第三方網站與其資源主機，可能變更或離線；ROO 未將第三方遊戲素材二進位檔提交進倉庫。

本機模式：
1. 若已有素材，使用 `ragx maps prontera --client \"C:/Gravity/Ragnarok\" --format glb --world-scale 0.2 --out ./tmp/roo-map` 匯出。
2. 切換「本機 GLB/GAT」，選取 `tmp/roo-map/maps/prontera.glb` 與同名 `prontera.gat`。
3. 點擊地面由 A* 尋路、沿可走格移動；位置存在獨立的 LocalStorage key，不覆寫 ROO 正式角色存檔。

目前公開模式是外部地圖檢視／探索入口，尚未跟 ROO 的角色屬性、戰鬥、技能或正式存檔共用；本機模式的地表高度、GAT 格線和點擊射線仍須用真實地圖驗證。下一個主要目標是做出相容授權的原生渲染與素材載入，不讓外部示範站成為正式遊戲的永久必要依賴。

## 原生公開 GND/GAT 測試模式（2026-10-18）

`tools/ro_explorer.html` 新增「原生地圖（測試）」模式，不經第三方模擬器 iframe，直接從公開 ragassets 端點載入同名 `.manifest.json`、`.gnd`、`.gat`、`.rsw` 與共享 PNG 材質，再以 Three.js 組出 GND 地表；點擊地面會使用既有 GAT A* 通行格尋路。地圖 ID 可輸入，例如 `prontera` 或 `tra_fild`。這只是開發驗證工具，公開素材服務屬 best-effort，無 SLA；端點停用、跨來源政策或素材缺檔時，請切回公開模擬器或使用本機 GLB/GAT。

新增的 `tools/ro_map_assets.mjs` 負責：
- 驗證 GND 1.7／1.8／1.9 標頭、尺寸、40-byte surface 與 cube 索引；不符合精確檔案長度就拒絕。地表網格會參照鄰接方格的頂點色，並在貼圖載入後做半像素 UV 內縮，減少接縫。
- 解析 RSW 1.3–2.7 的環境光／漫射光、太陽方向、模型擺放位置、點光源、音效和效果清單；探索頁已套用 RSW 光色和方向，並顯示模型位置數量。
- 依 GND 的 UV、四角高度、地表／牆面 surface，組出可供 Three.js 使用的頂點、UV、色彩及索引資料。
- 僅接受符合 ragassets 約定的共享材質 blob 路徑，拒絕外部網域與路徑跳脫；資源請求仍由瀏覽器直接發出。

目前雖已解析 RSW 的模型擺放資料，但尚未將對應 RSM/RSM2 模型幾何實例化；GND lightmap／動態水面也尚未合成，角色仍是開發用標記，並非正式 RO 角色動畫。原生模式依賴公開第三方素材服務與固定版本 Three.js CDN；正式遊戲不得將該示範服務當作永久必要依賴。另已在探索頁補回 import map，否則本機 GLB/GAT 模式的 bare module imports 無法解析。

## 尚未完成的下一階段

1. 載入 manifest 的 RSM/RSM2 模型，依 RSW 位置、旋轉、縮放實例化，再核對物件與地表的對齊。
2. 合成 GND lightmap、實作水面，並測試 GitHub Pages／手機瀏覽器中的貼圖、效能及跨來源載入狀況。
3. 將原生場景與正式角色、RO 動畫、即時戰鬥和本機存檔串接。
