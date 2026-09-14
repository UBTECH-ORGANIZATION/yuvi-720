# Creator Loft Assets

Self-hosted Poly Haven models, licensed CC0 1.0:
https://creativecommons.org/publicdomain/zero/1.0/

- Gamepad: Josh Dean, https://polyhaven.com/a/gamepad
- Gaming console: Sean Buckley, https://polyhaven.com/a/gaming_console
- Rubber duck toy: Plat251, https://polyhaven.com/a/rubber_duck_toy
- Digital wrist watch: Adrian C, https://polyhaven.com/a/digital_wrist_watch
- Concrete floor 02: https://polyhaven.com/a/concrete_floor_02

The supplied 2K glTF models and their PBR textures are unchanged. Runtime
instances are scaled uniformly to fit existing prize displays. Artwork embedded
in these assets is not an endorsement of Spark by the asset authors.

Run `node frontend/scripts/import-loft-assets.mjs` to reproduce downloads.
The importer verifies source MD5 hashes and records dependencies in manifest.json.
The application serves these files locally and does not call Poly Haven's API.

## Original Three.js Assemblies

The cabinets, racing simulator, air-hockey table, VR station, phones,
smartwatches, headphones, plush prizes, collectible figures, signs and printed
playfields are original runtime models in `LoftCabinets.ts`, `LoftPrizes.ts`
and `LoftFabrication.ts`. They are not third-party downloads and are not
covered by the Poly Haven manifest. No Sketchfab assets were imported.

## Gaming Room Artwork

`GamingRoomArtwork.ts` draws eight custom game-inspired wall illustrations
and the localized Yubi's Gaming Room neon title. These are not official game
screenshots or publisher-supplied assets. Game names and depicted characters
belong to their respective rights holders; the Poly Haven CC0 license does not
apply to this artwork. No third-party game images were downloaded.

The wall bays retain their original positions and dimensions. Additional neon
uses 64 instanced segments (two draws including halos), without extra real
lights. Machine lettering is omitted; catalog names remain localized.

All machines use the normal room catalog and saved transforms. Version-six
lofts receive the three new machine types in storage, without relocating
existing furniture. New lofts include them in the default arrangement.

Run `node frontend/scripts/verify-loft.mjs` with Vite on port 5173 for isolated
desktop/mobile, Hebrew/Arabic/English, decoded-asset and movement checks.
The check also captures all eight posters and the main title in both viewports
and all three languages, verifying framing and nonblank pixels.
The fixture does not read or write learner state. Its screenshots and report
are generated under `.runtime/loft-review/`.