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

## 原生公開 GND/GAT/RSW/RSM 探索模式（2026-10-18）

`tools/ro_explorer.html` 的「原生地圖（測試）」模式不依賴第三方模擬器 iframe，直接從公開 ragassets 端點載入同名 `.manifest.json`、`.gnd`、`.gat`、`.rsw`、共享 PNG 材質與模型資源，再以 Three.js 組出地表和目前支援的模型。遊戲內「開啟 3D 地圖探索」入口使用 `?mode=native&map=<mapId>`，直接開啟原生地圖並載入目前選定的地圖；不帶 `mode` 時仍以公開模擬器作為預設。點擊尋路只會命中標記為地表的網格，避免誤把樹木、屋頂當成目的地。地圖 ID 可輸入，例如 `prontera` 或 `tra_fild`。目前包含 RSM 1.x 與 RSM2 2.2／2.3 靜態網格、第一階段 GND lightmap/AO 及水面；動畫仍未完整支援，RSM2 真實素材仍需目視校驗。這仍是開發驗證工具，公開素材服務屬 best-effort，無 SLA；端點停用、跨來源政策或素材缺檔時，請切回公開模擬器或本機 GLB/GAT。

新增的 `tools/ro_map_assets.mjs` 負責：
- 驗證 GND 1.7／1.8／1.9 標頭、尺寸、40-byte surface 與 cube 索引；地表網格會參照鄰接方格頂點色，並在貼圖載入後做半像素 UV 內縮。
- 解析 RSW 1.3–2.7 的環境光／漫射光、太陽方向與模型擺放位置；探索頁已套用場景燈光。
- 解析 RSM 1.4–1.9、RSM2 2.2–2.3 的節點、頂點、UV、面索引與動畫資料。探索頁目前只實例化 RSM 1.x 靜態網格，暫不播放動畫，也會跳過 RSM2 幾何。
- 對 manifest 的共享材質／模型資源路徑做來源與格式驗證；素材仍由瀏覽器直接載入。

效能限制：原生探索最多載入 100 個獨立 RSM 資源、最多實例化 450 個 RSW 擺放項；超出上限或模型版本不支援時會跳過並顯示統計。這能讓大型地圖先可見，但尚不能保證完整呈現每個 RO 場景物件。GND lightmap／AO 已接第一階段貼圖合成；動態水面已接 GAT 水域格、波高頂點動畫與可用貼圖影格循環，但水域辨識精度與實際畫面仍待校驗。角色仍是開發用標記，並非正式 RO 角色動畫。原生模式依賴公開第三方素材服務與固定版本 Three.js CDN；正式遊戲不得將示範服務當成永久必要依賴。探索頁也已補回 import map，修正本機 GLB/GAT 模式的 bare module imports。

## 尚未完成的下一階段

1. 實測 RSM 1.x 模型在公開原生地圖中的位置、比例、朝向和貼圖，修正不同模型的根節點錨點。
2. 支援 RSM2 幾何、必要動畫，並合成 GND lightmap／水面；測試 GitHub Pages、手機瀏覽器與效能。
3. 將原生場景與正式 RO 角色、動畫、即時戰鬥及本機存檔串接。


## 原生水域第一階段（2026-10-18）

- `resolveRagassetsMapUrls()` 只接受同源、符合固定 hash 格式的 `_w/*.jpg` 動畫影格，避免 manifest 引入任意外部資源。
- 新增 `buildGndWaterMeshData()`，依 GAT 1.3 水域旗標建立逐格水面；GAT 1.2 的 type 6 暫作水域候選，仍需用不同真實地圖目視校驗。
- 原生探索模式會讀取 GND／RSW 的水位與動畫間隔，載入可用水面影格；素材無法載入時會退回半透明水面，不讓地圖整體載入失敗。
- 水域格線與點擊尋路分離，射線仍只接受 `rooTerrainSurface`。切換地圖會釋放非作用中的水面影格，避免持續累積 GPU 紋理。
- 回歸測試新增水域幾何、舊版候選格、空水域及共享水面 URL 路徑驗證。

GND lightmap／AO 已完成第一階段 atlas 與地表材質乘算；水面貼圖循環現在按 60 FPS 的幀間隔換算，預設每 3 幀切換一張、32 張約 1.6 秒一輪。波形仍是穩定週期的正弦近似，並非宣稱與官方客戶端逐像素一致。後續仍需針對多張真實 RO 地圖做視覺對照、檢查水域旗標／高度及手機瀏覽器效能。


## GND lightmap 與 AO 第一階段（2026-10-18）

- `parseGndBuffer()` 會依完整檔案長度辨識兩種佈局：標準 268-byte lightmap slice／56-byte surface，以及公開素材實際使用的全域 RGBA slice／40-byte surface。只靠版本號判斷會漏掉後者；無法通過尾端、surface 與 cube 長度驗證的檔案會拒絕解析。
- 標準佈局解析 8×8 灰階 shadow/AO 與 RGB lightmap；舊式佈局解析 RGBA slice，RGB 作烘焙光照、alpha 作 AO。每片保留原始像素，並由 `buildGndLightmapAtlasData()` 合成帶 1px gutter 的 atlas，預設套用 RO 常見的 16 階 RGB posterization。
- `buildGndMeshData()` 將每個 surface 的 lightmap slice 索引轉成第二組 UV。原生探索在有 lightmap 時使用地表專用 shader，將漫反射貼圖、烘焙 RGB 與 AO 相乘，避免把 RSW 已烘焙的靜態光照再當額外即時光源疊加。
- 單元測試涵蓋標準 56-byte surface、舊式 40-byte surface、slice 像素、atlas 邊界 UV 與 AO；公開素材 smoke test 會對 `prontera`、`tra_fild` 真實 GND 建立 atlas 並驗證 slice UV 數量。
- 2026-10-18 公開素材驗證：`prontera` 有 5,221 個 lightmap slices，atlas 730×720；`tra_fild` 有 2,972 個，atlas 550×550。這是解析／atlas 建置測試，不代表已通過瀏覽器畫面比對。

仍待用瀏覽器實際畫面校對光照方向、明暗比例與 AO 強度；手機、桌面與 GitHub Pages 仍未宣稱完成視覺驗收。


## GND/GAT 高度校準第一階段（2026-10-18）

- 角色定位與通行格高度改為取對應 GND cube 的四角高度，對每個 2×2 GAT 子格的中心做雙線性插值；當 GND 不可用（例如本機 GLB 模式）時，才回退到 GAT 四角平均值。尋路／碰撞仍以 GAT 為準，可見地表高度只影響角色與格線的 Y 定位。
- 新增 `compareGndGatHeights()`，以世界單位回報 mean absolute error、P95 與最大差值；真實素材檢查會列出有效樣本數，不會把刻意存在的碰撞平台／地表落差誤判成整張地圖失敗。
- 修正 lightmap/AO shader 的注入位置：乘算放在 `map_fragment` 之後、`outgoingLight` 計算之前，確保烘焙光照實際作用到 diffuse 顏色，而不是在輸出顏色已生成後才修改未使用的變數。
- 真實素材高度檢查（world scale 0.2）：`prontera` 113,992 個樣本，平均差 0.005、P95 0.000、最大差 7.175；`tra_fild` 40,000 個樣本，平均差 0.029、P95 0.000、最大差 6.251。極少數最大偏差仍需在瀏覽器中檢視其座標，不能僅憑數值自動修正 GAT/GND。

高度插值與診斷已接入開發預覽；仍需做實際畫面比對，尤其要確認差值極大的少數格是否屬於刻意製作的碰撞平台、橋面或上下層地形。


## RSW 模型座標邊界校驗（2026-10-18）

- 新增 `analyzeRswPlacementBounds()`，把 RSW 物件位置按同一個 world scale 轉到以地圖中心為原點的 Three.js 水平座標，檢查每個模型錨點是否落在 GND 地圖範圍內，並統計超出地圖的最大距離。
- `prontera`：1,303／1,303 個 RSW 模型錨點在地圖邊界內；`tra_fild`：281／281 個在界內。這證明模型位置數值範圍合理，但不等同已驗證模型根節點朝向、底部錨點或逐一貼圖正確。
- 原生探索面板會顯示高度差摘要與 RSW 擺放邊界統計，方便在實際畫面驗收時選出需檢查的地圖。


## RSM 1.x 節點轉換校正（2026-10-18）

- 參照 [ragx 的 RSM1 轉換說明與實作](https://github.com/joaopedrosgs/ragx/blob/main/ragx/model_builder.py) 及 [RSM 格式研究](https://github.com/rdw-archive/RagnarokFileFormats/blob/master/RSM.MD)：網格頂點先套用 `T(translation1) × offsetMatrix`；節點層級再套用 `T(translation2) × rotation × scale)。矩陣資料按 RSM 的 column-major 順序解讀。
- 原生 renderer 將頂點區域轉換與節點層級 TRS 分開處理；子節點繼承父節點 TRS，不再把父網格的 translation1 當子節點位移。
- 單元測試使用非對稱 offsetMatrix 與非零 translation1，檢查頂點轉換、座標軸鏡射、旋轉與縮放，避免 identity matrix 測試掩蓋轉置錯誤。
- 此階段仍不播放 RSM 旋轉／縮放／平移動畫，RSM2 幾何也不會實例化；渲染正確性仍須用真實瀏覽器畫面逐圖驗收。


## RSM 1.x 著色與平滑群組法線（2026-10-18）

- 依 [RSM 格式研究](https://github.com/rdw-archive/RagnarokFileFormats/blob/master/RSM.MD) 與 [ragx 的模型轉換說明](https://github.com/joaopedrosgs/ragx/blob/main/ragx/model_builder.py) 區分 ShadeType：0 不受光、1 逐三角面法線、2 依 smoothing group 平滑。
- 新增 `buildRsmNodeMeshData()`，在依材質拆分前先算每個節點的面法線與 smoothing-group 累加；同一位置的重複頂點可共用平滑法線，不同群組仍保留硬邊。
- 原生 renderer 直接送入計算好的 normal attribute，避免對所有模型一律呼叫 `computeVertexNormals()` 導致平面過度平滑或材質邊界產生縫。
- 單元測試覆蓋 unlit、flat、smooth、不同 smoothing group 與無效面索引；公開素材 smoke test 另外抽樣建立真實 RSM1 mesh buffers 並檢查法線及索引有限／有效。
- RSM 動畫、RSM2 幾何與瀏覽器目視驗收仍未完成。


## RSM2 2.2／2.3 靜態網格第一階段（2026-10-19）

- 公開模型素材白名單同時接受 `.rsm` 與 `.rsm2` 的固定 hash 路徑，仍限制同源 `/_m/` 位置，不接受任意外部 URL。
- RSM2 節點以絕對 transformation matrix／position 換算父節點區域 TRS；頂點保留原始 mesh 空間並做座標軸鏡射，依節點階層掛入場景。
- 2.2 使用模型層級材質索引；2.3 使用節點自己的 texture name。著色沿用 ShadeType 與平滑群組法線流程。
- 新增 RSM2 2.2／2.3 二進位 fixture、父子節點旋轉／位移檢查、網格索引與 `.rsm2` manifest URL 白名單測試；公開素材 smoke test 擴大採樣並驗證 RSM2 節點資料（若樣本含 RSM2）。
- 本階段只渲染靜態姿勢；不播放旋轉／縮放／平移或 UV 動畫。真實瀏覽器目視比對、手機／桌面及 GitHub Pages 驗收仍待完成。
