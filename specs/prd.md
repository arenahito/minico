# minico PRD v0.3.2
**codex app-server / ChatGPT managed OAuth only / No API keys (forever)**

- Status: Approved ✅ (2026-02-22) / Updated ✅ (2026-02-22)
- 対象: 初期リリース (V0)
- 重要方針（確定）:
  - minico は **Codex app-server** をバックエンドとして利用（OpenAI/ChatGPT への直接 HTTP はしない）
  - 認証は **ChatGPT managed OAuth のみ**（minico 内で OAuth 実装はしない）
  - **APIキーによる利用は今後も一切サポートしない**
  - 承認ルール/権限判断は **Codex 側の設定に寄せる**（minico は承認 UI と応答のみ）
  - minico 設定は \*\*ミニマム\*\*（Codex 側で設定できないものだけ保持）
  - app-server は同梱しない。既定では PATH 上の `codex` を使って `codex app-server` を起動し、必要なら `codex.path` で実行ファイルを指定できる

---

## 1. 背景 / 目的

minico は「claude code のようなロングタスク」ではなく、**日常の小さなタスク**（文章作成、要約、手順化、雑務の整理など）を高速にこなすデスクトップアプリとして提供する。

ローカルでの安全なコマンド/ファイル操作や承認フローは、Codex が提供する仕組み（sandbox + approvals）を再利用し、minico 側の実装を薄く保つ。

---

## 2. 目標 (Goals)

- ChatGPT サブスク前提で、**ブラウザログイン（managed OAuth）だけで利用開始**できる
- スレッド（会話）を作成し、ストリーミング出力を UI に表示できる
- コマンド実行/ファイル変更が必要な場合は **承認 UI** を出し、ユーザーの意思決定を app-server に返せる
- minico の設定は最小限（ウィンドウ位置・サイズなど）に抑える
- コーディング用途の Codex（CLI/IDE）と、日常業務用途の minico で **履歴を分離できるオプション**を用意する（CODEX_HOME 分離）

---

## 3. 非目標 (Non-goals)

- APIキーによる利用（今後もサポートしない）
- minico 内での OAuth 実装（今後も実装しない）
- OpenAI Responses API などの HTTP API を minico が直接叩く
- Codex 設定（`config.toml`）を minico が自動生成・自動編集する
- 長時間バックグラウンドタスク、並列長期実行（V0では対象外）

---

## 4. 想定ユーザーと主要ユースケース

### ユーザー像
- 日常業務で「短い文章/手順/要約/整理」を頻繁に行う人
- ローカルファイル/コマンド操作を伴うこともあるが、**コーディングが主目的ではない**人

### 主要ユースケース（例）
- メール/報告の下書き、議事録の要約、ToDo への分解
- 仕様の要点整理、手順書の作成
- （必要時）ワークスペース内での軽い変更、コマンド実行（承認付き）

---

## 5. 全体アーキテクチャ

### 方式
- minico はローカルで `codex app-server` を起動（既定）し、**JSON-RPC 2.0** で双方向通信する
  - 既定 transport: stdio の JSONL（1行1JSON）
- スレッド/ターン/アイテムは app-server のプリミティブとして扱う

### 構成（概略）
- UI: 会話 UI、承認 UI、ログイン UI、設定 UI（最小）
- Core: app-server client、イベントループ、状態管理
- Storage: minico 設定（JSON/TOML）＋「最近開いた」程度（任意）
- Codex: thread/turn 履歴や承認ポリシーは Codex が管理

---

## 6. 認証要件（ChatGPT only）

### サポートする認証
- app-server の `account/login/start`（`type: "chatgpt"`）で開始し、返ってくる `authUrl` をブラウザで開く
- 完了は `account/login/completed` / `account/updated` の notify を待つ

### サポートしない認証（将来も）
- `type: "apiKey"` は UI/実装ともに提供しない（将来も）
- `type: "chatgptAuthTokens"`（外部トークン供給）も minico では使わない（将来も）

### APIキーでログイン済み環境への挙動
- `account/read` で APIキー認証を検出した場合:
  - 「APIキーはサポート外」を表示
  - `account/logout` → `chatgpt` ログインへ誘導

---

## 7. 会話履歴（Codex と minico の分離方針）

### 原則（V0）
- 会話履歴は Codex が保存する thread/turn をそのまま利用（minico 独自 DB での会話保存はしない）
- minico の履歴 UI は `thread/list` を使う
- minico の履歴一覧は **既定で `sourceKinds: ["appServer"]` にフィルタ**し、Codex CLI/IDE の会話と UI 上は混ざらないようにする

### “完全分離”オプション（A: CODEX_HOME 分離）
- minico 設定で「分離 ON」の場合:
  - app-server 起動時に `CODEX_HOME=~/.minico/codex/` を設定して起動する
- 既定（分離 OFF）:
  - `CODEX_HOME` を指定せず、通常の `~/.codex` を利用する（Codex CLI/IDE と同じ層）

### `config.toml` の扱い
- minico は `config.toml` を **生成しない**
- `~/.minico/codex/` 配下に `config.toml` が無くても app-server は **デフォルト設定で動作**する前提

---

## 8. minico 設定（ミニマム）

### 目的
- Codex 側で設定できない「アプリの UX 都合」だけ保持する

### 設定項目（V0で保持する）
1) **Codex 実行ファイル（任意）**
- `codex.path: string | null`
- default: `null`（未指定）
- `null/未指定` の場合は PATH 上の `codex` を解決して使用する
- 指定されている場合はそのパスを優先して使用する
- minico は起動コマンドを固定し、常に `<codex> app-server` を起動する（ユーザーが引数を指定する機能は持たない）

2) **Codex home 分離**（パス文字列は持たない）
- `codex.homeIsolation: boolean`
- default: `false`
- `true` のときのみ `CODEX_HOME=~/.minico/codex/`

3) **ウィンドウ位置・サイズの永続化**
- `window.placement`（位置 x,y とサイズ w,h、maximized 等）
- 注意: 物理座標/論理座標（DPIスケール）差分で復元が壊れることがあるため、保存・復元ロジックに安全策（クランプ/モニタ再検出）を入れる（詳細設計で規定）

### 設定項目（持たない）
- APIキー、プロバイダ endpoint、モデル選択、承認ルール、OAuth 設定など（すべて Codex 側へ）
---

## 9. V0 機能要件（一覧）

### 必須 (P0)
- app-server 起動（stdio JSONL）と initialize ハンドシェイク（`codex.path` 未指定なら PATH の `codex` を使用）
- `account/read` によるログイン状態確認、`chatgpt` ログイン導線
- thread:
  - `thread/start`, `thread/resume`, `thread/list`（履歴UI）
- turn:
  - `turn/start`, `turn/interrupt`（キャンセル）
- 承認:
  - `item/commandExecution/requestApproval`
  - `item/fileChange/requestApproval`
- minico設定:
  - `codex.path`
  - `codex.homeIsolation`
  - window placement の保存・復元

### あると良い (P1)
- `thread/archive/unarchive`
- `thread/name/set`
- `thread/compact/start`
- エラーのユーザーフレンドリ表示（Unauthorized/UsageLimit等）

---



## 9.5. 配布 / インストール要件（codex同梱なし）

- minico は `codex`（Codex CLI）を同梱しない。
- 既定では PATH 上の `codex` を使用し、見つからない場合は「インストール/パス指定」導線を表示する。
- `codex.path` が設定されている場合は、そのパスの実行ファイル存在確認と実行権限確認を行う。
- `codex` のバージョン互換が疑われる場合（initialize失敗等）は、更新案内を表示する。

---

## 10. 非機能要件

- 安全性: Codex の sandbox + approvals を尊重し、minico は勝手に自動承認しない
- 回復性:
  - app-server 過負荷（`-32001`）はリトライ可能（指数バックオフ）
  - app-server 異常終了時は再起動と状態復旧（ログイン状態再確認）
- 観測性: ログレベル切替、診断ログの書き出し（ユーザーが提出できる）

---

## 11. 受け入れ基準（DoD）

- 初回起動で app-server が起動し initialize が成功する
- 未ログインなら `chatgpt` ログインフローが開始でき、完了後に会話できる
- `thread/start` → `turn/start` の 1 往復が UI 上で成立する
- コマンド/ファイル変更が発生した場合、承認 UI を出して accept/decline が反映される
- `codex.homeIsolation=true` にすると `~/.minico/codex/` 側に履歴が保存され、分離される（minicoはconfig生成しない）
- window placement が保存され、次回起動で安全に復元される（DPI差分で画面外に出ない）

---

## 12. 参考資料

- Codex App Server: https://developers.openai.com/codex/app-server/
- app-server README（生テキスト）: https://raw.githubusercontent.com/openai/codex/main/codex-rs/app-server/README.md
- Codex Security: https://developers.openai.com/codex/security/
- Codex Config basics: https://developers.openai.com/codex/config-basic/
- Codex Config advanced: https://developers.openai.com/codex/config-advanced/
- Codex Sample config: https://developers.openai.com/codex/config-sample/
