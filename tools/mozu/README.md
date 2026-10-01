# MOZU model sources

Reference material behind the 30 web models in `apps/configurator/models/mozu/*.glb`. Nothing here is used by
the build; it is kept so the models can be regenerated or re-measured from the originals.

| What | Where it came from |
|---|---|
| `step/*.step` | MOZU's CAD sources, one per product: kitchen base KF01–08, wall KH01–04, tall KT01–06, wardrobes W04–W10, side cabinets W01–03 and W_ADJ1/2 |
| `mozu-models-report.json` | The sizes (metres, `[width, height, depth]` as modelled) and byte counts that came with the drop |
| `usdz-to-glb.py` | **The script that produced the GLBs** from the iPad app's USDZ models (up-axis, scale and origin fixed the same way the iPad does it; output in millimetres, Y up, base at y = 0, footprint centred) |
| `cad/step-to-glb.mjs` | An alternative route: tessellate a STEP file with OpenCASCADE (`occt-import-js`) and write a GLB |
| `ios/import-mozu-models.mjs` | The import that built the iPad app's catalogue from the USDZ + STEP drop |

These came from the `Scan_Room-main/mozu-configurator` drop (October 2026). The scripts need tools that are not
in this repo (`usd-core`, `pygltflib`, `occt-import-js`, `@gltf-transform/core`); they are kept as documentation of
how the files were made, not as part of the build.

The configurator does not read these files. Its catalogue comes from `apps/configurator/lib/models.manifest.json`,
which `npm run models:measure -w apps/configurator` writes by measuring the GLBs.
