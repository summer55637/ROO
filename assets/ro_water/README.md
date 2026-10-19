# RO water type 10 animation frames

This directory bundles the 32-frame JPEG sequence named `WATER1000.jpg` through `WATER1031.jpg`, under `assets/ro_water/type10/`.

## Provenance

The matching files were retrieved from the Divine-Pride iRO gallery snapshot dated 2025-07-08:
- Gallery: https://www.divine-pride.net/Gallery/iRO/2025-07-08
- Example source file: https://www.divine-pride.net/gallery_images/iRO/2025-07-08/data/texture/%EC%9B%8C%ED%84%B0/WATER1000.jpg

The file names and the gallery's `data/texture/워터` folder identify this as the type-10 water texture sequence. All 32 frames were checked for HTTP 200, `image/jpeg`, 128×128 dimensions, and a valid non-empty payload. Combined file size is 855,077 bytes.

## Runtime

The game references these files through a URL relative to `tools/ro_map_assets.mjs`. They are bundled with ROO so the browser does not hotlink the gallery for WebGL texture use; the gallery response did not include an `Access-Control-Allow-Origin` header.

The project owner has stated that the RO rights holder has authorized the project to use RO assets. This provenance note records the public gallery snapshot used to retrieve these files; it does not imply that Divine-Pride is the rights holder or that the gallery separately granted redistribution permission. RO-related rights remain with their respective rights holder.
