# Stage Configuration Elements

The stage configuration JSON supports the following keys. These values control both layout and game rules for each stage.

- `gameTime` – total game time in seconds
- `orderTimeLimit` – time limit per order in seconds
- `wrongOrderPenalty` – score penalty when delivering the wrong dish
- `actionZones` – list of zones where players perform actions. Each zone has:
  - `x`, `y`, `width`, `height`
  - `action` – e.g. `cut`, `bake`
  - `display` – text shown while working
  - `occupied` – whether currently in use
- `deliveryZone` – zone where dishes are delivered. Contains `x`, `y`, `width`, `height`
- `staticObstacles` – array of obstacles. Each obstacle has `x`, `y`, `width` and `height`
- `foodGenerators` – list of generators that spawn ingredients. Each entry has `x`, `y`, `width`, `height` and `nextFood`
- `transferObjects` – list of teleporters. Each entry has `sourceZone` and `destination`, both with `x`, `y`, `width`, `height`
- `customItems` – definitions for additional items
- `combinationRecipes` – item combination rules
- `cookingRecipes` – cooking steps for items
- `dishList` – list of dishes appearing in orders
- `orderMapping` – mapping of item types to dish names

These keys are returned by `/api/default_config` and stored for each stage in `/stages/<key>.json`.