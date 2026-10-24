# Paradigm Engine

A fiction-first framework that uses anime as a medium to run any game or world. A game system for Foundry Virtual Tabletop V14.

## Install

Paste the manifest URL into Foundry's Install System dialog:

```
https://github.com/EikoSakura/paradigm-engine/releases/latest/download/system.json
```

## Distance

Distance is measured from you to your target, token edge to token edge, and counted in tiles the cardinal way: axis distances add, so a diagonal counts 2. Every scene measures 1 tile per grid square — created, imported, and existing maps are all set to tiles, and square grids count diagonal movement as 2. Within one tile you are Engaged.

Dragging a token counts the tiles moved from the drag origin. With one token controlled, hovering another visible token draws a range line labeled with the distance between them. Display only; nothing is enforced. `game.system.api.getDistance(tokenA, tokenB)` returns units, tiles, engaged, and label.
