# Known Issues

## 1. Tomato assets are not resolved correctly
- `AssetCache.resolvePath()` assumes ingredient filenames match the item type without the `ingredient_` prefix, so `ingredient_tomato` is loaded from `/static/new_items/tomato.png`, which is not present in the repository.【F:static/game/asset-cache.js†L40-L45】
- The tomato sprites are provided as `/static/new_items/TMT.png` and `/static/new_items/TMT_slice.png` in the shared item definitions, so tomato previews rely on filenames that never match the cache lookup.【F:utils.py†L68-L78】
- UI fallbacks repeat the same assumption, so generator icons, cooking overlays, and order thumbnails for tomatoes degrade to placeholders whenever the explicit image path is missing.【F:static/game/ui-manager.js†L149-L158】

## 2. Legacy counter and zone textures are still hard-coded
- Both the runtime asset cache and the stage editor still point action zones, delivery counters, generators, and obstacles to the legacy textures under `/static/assets/…` (for example `cooking_zone1.png` and `food_generator.png`).【F:static/game/asset-cache.js†L56-L74】【F:static/scripts/stage_editor.js†L46-L58】
- Because these files retain the old decorative frames, the unwanted borders remain visible whenever a stage relies on the defaults instead of the trimmed burger-era art.

## 3. Stage configuration sanitisation overwrites custom order settings
- `sanitize_config()` unconditionally rebuilds `dishList` and `orderMapping` for every burger dish type, disregarding any user-supplied configuration.【F:app.py†L146-L153】
- Any attempt to limit the available orders (for example, serving only plain burgers in a training stage) is discarded, so the game will always generate every burger recipe regardless of the stage author’s intent.
