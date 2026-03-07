# Changelog

## [0.3.0](https://github.com/arenahito/minico/compare/v0.2.1...v0.3.0) (2026-03-07)


### Features

* **chat:** add fast mode toggle persistence ([47fa781](https://github.com/arenahito/minico/commit/47fa7813f8109323830018442dd81156f9ce3351))
* **threads:** move new thread action to panel header ([ad7047e](https://github.com/arenahito/minico/commit/ad7047e177dc779d2cc4073e73c2c85f265cac67))


### Bug Fixes

* **chat:** auto-resize composer from two to eight rows ([67378b1](https://github.com/arenahito/minico/commit/67378b1e2d1caecadc1e73663d7261ae5012d5eb))
* **chat:** style inline code with blue text ([0deaff9](https://github.com/arenahito/minico/commit/0deaff9cb7b8e22ae3ebd8211dc7e242c1c3553e))

## [0.2.1](https://github.com/arenahito/minico/compare/v0.2.0...v0.2.1) (2026-02-23)


### Bug Fixes

* **windows:** hide app-server console window on startup ([1c1cc8d](https://github.com/arenahito/minico/commit/1c1cc8d01b19564820a9169f417bcac2580d522a))

## [0.2.0](https://github.com/arenahito/minico/compare/v0.1.0...v0.2.0) (2026-02-23)


### Features

* add configurable codex personality per turn ([ff52f45](https://github.com/arenahito/minico/commit/ff52f45b950dfc320efadb44e44ea05795854f40))
* add dark theme setting and app-wide theme switching ([36bced7](https://github.com/arenahito/minico/commit/36bced795f0abbb89f3edda5ce8e0e120b3df76e))
* **bootstrap:** initialize minico tauri workspace baseline ([7909cd5](https://github.com/arenahito/minico/commit/7909cd5d26a85b4db51cf44ce9c186d6cabbfa5c))
* **chat:** support mermaid blocks and code copy actions ([0248434](https://github.com/arenahito/minico/commit/024843438690ce5c2dac368ac14913f21b432b4b))
* **core:** add auth and thread-turn orchestration commands ([bec803e](https://github.com/arenahito/minico/commit/bec803e803d3188d334b90b66a99e0487d48b91e))
* **diagnostics:** add error catalog, log export, and verification guide ([d71b832](https://github.com/arenahito/minico/commit/d71b83229cc9745fa71f0963eddadbba07c06e4c))
* **facade:** add handshake retry and recovery policy ([798c9ca](https://github.com/arenahito/minico/commit/798c9ca93b6c7bd596b0cbee782806e0eb56ce6b))
* improve thread/chat UX and non-blocking app-server integration ([d51e40c](https://github.com/arenahito/minico/commit/d51e40c96305cb34f36b42bdd24f24ca15219e5f))
* **rpc:** implement app-server process and jsonl client ([77d19f8](https://github.com/arenahito/minico/commit/77d19f8a99a0bf88bef23343791c4d247626d2c3))
* **settings:** add persistent minico config and validation ([625df74](https://github.com/arenahito/minico/commit/625df744d6ee13c0743ff24818ed023f726c9e17))
* **ui:** add markdown code syntax highlighting ([d10802b](https://github.com/arenahito/minico/commit/d10802b6779c378b6522023f86d979277957da64))
* **ui:** wire login chat shell and approval dialogs ([900b19f](https://github.com/arenahito/minico/commit/900b19f2b81165a53d0d5b0367955a877ccb774b))
* **window:** add backend placement restore and lifecycle hooks ([375b69a](https://github.com/arenahito/minico/commit/375b69adf3953121d13e14fdf642fef104766eb1))
* **workspace:** add fallback-safe cwd resolution ([dec45a0](https://github.com/arenahito/minico/commit/dec45a01150093f95124187d30a33fb8d7af8056))


### Bug Fixes

* **auth:** prevent checking-account stalls with timeout and scoped polling ([3daea2b](https://github.com/arenahito/minico/commit/3daea2b7d4d51238c2270a480e5427eadc4b86de))
* **ci:** set rust-toolchain input explicitly ([ecd20c9](https://github.com/arenahito/minico/commit/ecd20c92d251f4d5f049e9f1961c8897660196f2))
* **core:** guard windows-only test imports for clippy ([c26fd1d](https://github.com/arenahito/minico/commit/c26fd1d8e0a416905f7b0eab4cb439df71960d93))
* **core:** harden recovery and rpc/process cleanup ([402e9d4](https://github.com/arenahito/minico/commit/402e9d4a6f65dae0af377dd4c2de9d2d51b468b4))
* prevent startup auth stalls and improve auth UI feedback ([8b395cb](https://github.com/arenahito/minico/commit/8b395cb972c133c46ffcace36c9ede9725f790fe))
* **window:** align placement units and honor monitor workArea ([b0bd577](https://github.com/arenahito/minico/commit/b0bd577081b825d07a61fd16ee289d7b9d16a0a1))
