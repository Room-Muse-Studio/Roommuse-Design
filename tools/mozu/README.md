# MOZU model sources

Reference material behind the 30 web models in `apps/configurator/models/mozu/*.glb`, and the converter that
makes them. Nothing here is used by the build.

| What | Where it came from |
|---|---|
| `step/*.step` | MOZU's CAD sources, one per product: kitchen base KF01–08, wall KH01–04, tall KT01–06, wardrobes W04–W10, side cabinets W01–03 and W_ADJ1/2 |
| `mozu-models-report.json` | The sizes (metres, `[width, height, depth]` as modelled) and byte counts that came with the drop |
| `step-to-glb-parts.mjs` | **The script that produces the GLBs** from `step/*.step`, with doors and drawers as separate nodes in their closed pose (see its header). Its own `package.json` (`occt-import-js`); not a workspace: `cd tools/mozu && npm install && node step-to-glb-parts.mjs [IDs]`, then `npm run models:measure -w apps/configurator`. It prints a table checking every closed door (thickness, inside the body, flush with the carcass front) and refuses to write a model whose doors don't close cleanly |
| `usdz-to-glb.py` | The script that produced the earlier GLBs from the iPad app's USDZ models. Those came out upside down and back to front for 29 of the 30 models (a 180° turn about x against the STEP files), with the doors fused into the body at whatever angle the designer left them |
| `cad/step-to-glb.mjs` | An alternative route: tessellate a STEP file with OpenCASCADE (`occt-import-js`) and write a GLB |
| `ios/import-mozu-models.mjs` | The import that built the iPad app's catalogue from the USDZ + STEP drop |

These came from the `Scan_Room-main/mozu-configurator` drop (October 2026). Apart from `step-to-glb-parts.mjs`,
the scripts need tools that are not in this repo (`usd-core`, `pygltflib`, `@gltf-transform/core`); they are kept
as documentation, not as part of the build.

The configurator does not read these files. Its catalogue comes from `apps/configurator/lib/models.manifest.json`,
which `npm run models:measure -w apps/configurator` writes by measuring the GLBs.
