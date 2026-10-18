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
- 檔頭 14 bytes；每格 20 bytes，地形旗標是每格偏移 16 的 16-bit 值；更新版水域旗標是偏移 18 的 16-bit 值。
- 座標原點是西南角；x 向東、y 向北，從 0 開始。
- 地形類型 0、2、3、4、6 可走；1（障礙）與 5（懸崖）不可走。未知類型保守視為不可走，與 rAthena 的 map_gat2cell() 保持一致。
- GAT 1.3 的獨立水域旗標會保留統計資訊，不把水旗標單獨當成障礙。

參考：
- [Ragnarok GAT 格式](https://github.com/rdw-archive/RagnarokFileFormats/blob/master/GAT.MD)
- [rAthena 地形通行判定](https://github.com/rathena/rathena/blob/master/src/map/map.hpp)

## 尋路核心

js/map_pathfinding.js 提供解碼器、格子判定、A* 八方向尋路、最近可走格查找與畫面座標轉格工具。對角移動不能穿過兩個障礙格形成的牆角。

目前倉庫尚未納入真正地圖的 .gat 通行資料，也尚未完成 .gnd 地圖渲染；因此這次先落實資料轉換與可測試的尋路核心，尚不把它冒充成已完成的 RO 地圖碰撞。實際遊戲接線需在地圖專屬圖面與轉換後通行格對齊後完成。
