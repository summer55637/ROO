# Repository Guidelines

## Response Style (核心原則：精簡回應，節省 Token)

1. **嚴禁客套話。** 不要回答「好的」、「我了解了」、「這是一個好問題」或任何寒暄。
2. **直奔主題。** 直接提供答案，不重複問題、不做冗長的前情提要。
3. **結構化表達。** 優先使用簡短列點或表格，每點不超過 20 字。
4. **刪除冗贅。** 去掉不必要的形容詞、副詞與轉折詞，語句極度精煉。

同一原則適用於程式碼註解與測試斷言（見下方 Testing Guidelines）。

## Fixed Product Requirements (Must Follow)

Read [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) before project work. The target is a **genuine single-player RO H5 game**, pure front-end, published on a free GitHub Pages URL. It must remain 100% free and non-commercial, with no ads, IAP, subscriptions, paid unlocks, backend, or multiplayer server. Reuse the existing RO data and mechanics wherever possible. The project author has stated that full RO-related usage authorization has been obtained; use that as the project premise, and refer to the author's authorization documents for specific scope. Do not describe the project as unlicensed or merely RO-style.

## Project Structure & Module Organization

This repository currently contains a build-free browser idle game, but its fixed product target is a genuine single-player H5 Ragnarok Online game, not merely a RO-inspired clone. `index.html` is the entry point and defines the ordered loading of browser scripts. Keep that order intact: the files in `js/` share globals rather than ES modules. Core simulation and persistence live in `js/engine.js`; UI rendering and DOM events live in `js/ui.js`; game data is divided among `data.js`, `skills.js`, `jobs.js`, `monster_skills.js`, and supporting tables. Read `docs/PROJECT_SPEC.md` before proposing or implementing project changes.

Use `css/style.css` for layout and component styling, and `css/ro-theme.css` for theme tokens. Runtime assets belong in `images/`, `music/`, and `WAV/`; preserve ID-based filenames such as `images/items/501.png`. Source datasets and conversion inputs live in the `ro_*_data/` directories and root YAML/JSON files. Keep implementation notes and plans in `docs/`; reserve `tools/` for Node/Python data-maintenance scripts and test suites.

## Build, Test, and Development Commands

There is no build step or `npm` script. Install the small tooling dependency set with `npm install` when needed.

- `python -m http.server 8000` — serve the game locally; open `http://localhost:8000/`.
- `node tools/test.js` — run the complete mechanics regression suite.
- `node tools/test_smoke.js` — scan all game data through the engine.
- `node tools/check_syntax.js` — validate `js/data.js` syntax after data edits.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, single-quoted strings, and `const`/`let` rather than `var`. Use `camelCase` for functions and state fields, `UPPER_SNAKE_CASE` for shared constants, and lowercase underscore-separated data IDs (for example, `lk_spiralpierce`). Prefer extending declarative data tables over hard-coding content in `engine.js`. No formatter or linter is configured; match nearby code and avoid broad reformatting of large data files.

## Testing Guidelines

Add focused suites as `tools/test_<feature>.js` and register them in `tools/test.js`. Use `tools/harness.js` so tests exercise the same scripts as the game; assert gameplay behavior rather than implementation details. Run the full suite before submitting engine or data changes. The harness deliberately excludes `ui.js`, so manually check affected flows in a browser, including saved-game behavior when relevant. No coverage threshold is enforced.

**Keep suites small — assertions cost tokens to write and to read.** The harness exists to make verification cheap; padding a suite with restatements of the data file undoes that. Assert only what could plausibly break:

- **Worth asserting:** a value that has to travel through a pipeline (buff pushed → someone reads it), an interaction between two systems, a rule that is easy to regress (internal cooldowns, resource ordering, self-damage floors), and any bug you actually hit while building the feature.
- **Not worth asserting:** re-reading numbers straight out of `skills.js` (`spCost[0] === 30`, `maxLv === 5`, `duration[0] === 60`), "the id exists", "the name is X", or one assertion per level of a ten-level array. Those only prove the file says what the file says.

A suite of 30 sharp assertions beats 140 that mostly echo the data. Prefer one assertion that measures real behaviour (cast the skill, read the damage) over five that inspect fields.

## Commit & Pull Request Guidelines

Recent commits use concise Chinese summaries describing the completed feature or fix, combining tightly related work with ` + ` (for example, `傷害公式優化` or `轉生系統 + 進階二轉框架`). Keep commits focused and avoid vague messages. PRs should describe player-visible effects, list verification commands, link related issues or docs, and include screenshots for visual/UI changes. Cite the source when changing RO-derived formulas or data.
