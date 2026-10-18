# 🍀 幸运四叶草 · Lucky Clover

> 除草掉落四叶草，长按祈愿触发奇遇；可栽培、可收集，还有一座四叶草神龛和一位守护灵 Boss
>
> **当前版本** `v2.1.19` ｜ **最低版本** `1.21.60` ｜ **实测运行** `1.26.52.3`

[← 返回合集总仓库](https://github.com/dfy5535/minecraft-bedrock-addons)

---

## 简介

草类方块被破坏时概率掉落四叶草，长按祈愿触发随机奇遇。四叶草可以栽培进阶、可以献祭换奖励，
集齐图鉴后会引出四叶草神龛与三阶段守护灵 Boss。

**内容规模（v2.1.19）**

- 7 种野生 / 跨维度四叶草
- 4 阶段培育（种子 → 苗 → 成株 → 变异）
- 40 种奇遇 + 5 种金叶奇迹
- 3 套 3D 盔甲、4 件 3D 武器工具
- 四叶草神龛（献祭换奖励）
- 四叶守护灵 · 三阶段 Boss
- 收集图鉴（Almanac）

## 版本与兼容性

| 项 | 值 |
|---|---|
| 当前版本 | v2.1.19 |
| 最低引擎版本 | 1.21.60 |
| 脚本 API | `@minecraft/server` 1.17.0 |
| 实测运行版本 | 1.26.52.3 |
| BP UUID | `565505a6-e42a-4485-9af3-07ec0bd274e0` |
| RP UUID | `f38113e2-f768-4680-919b-6c2389c9dda6` |

## 语言版本（English / 日本語）

每个语言**独立打包**：只带一份语言文件（`en_US.lang` / `ja_JP.lang`），包内**不含任何中文**（连代码注释都翻过），
玩法与数值和中文版完全一致。

| 语言 | 文件 |
|---|---|
| 🇨🇳 中文 | `dist/LuckyClover_v2.1.19_1.21.60.mcaddon` |
| 🇬🇧 English | `dist/LuckyClover_v2.1.19_1.21.60-en.mcaddon` |
| 🇯🇵 日本語 | `dist/LuckyClover_v2.1.19_1.21.60-ja.mcaddon` |

> 三个包只装**一个语言**即可；UUID 各不相同，可以并存但不建议同时启用。

## 下载

- `dist/LuckyClover_v2.1.19_1.21.60.mcaddon` — v2.1.19 · 中文原版
- `dist/LuckyClover_v2.1.19_1.21.60-en.mcaddon` — v2.1.19 · English Edition
- `dist/LuckyClover_v2.1.19_1.21.60-ja.mcaddon` — v2.1.19 · 日本語版
- `dist/LuckyClover_Addon_v1.1.2_1.21.60-compat.mcaddon` — v1.1.2 · 历史版本（仅留档）

也可以在 [Releases](https://github.com/dfy5535/bedrock-lucky-clover/releases) 里按版本下载。

## 安装

1. 下载上面的 `.mcaddon` 文件
2. 双击导入（或在游戏内「设置 → 存储 → 资源包/行为包」导入）
3. 新建世界或进入已有世界，**同时启用行为包与资源包**
4. 若提示缺少依赖，请确认两个包都启用了

## 更新日志

完整历史见 [CHANGELOG.md](./CHANGELOG.md)。最新一版：

### v2.1.19 · 英日版上架 — 2026-10-18

- 🌐 **新增** — **English Edition** 与 **日本語版**：单语言打包，包内不含任何中文。
- 📦 **同步** — 仓库源码与中文包升级到 **v2.1.19**（此前仓库还停在 v1.1.2）。
- 🐛 **修复** — 早前英日版把模板字符串改写成普通字符串导致插值失效（游戏里显示 `${...}` 字面量）、
  块注释丢了结尾 `*/` 造成语法错误。均已修正。
- 🧪 **验证** — 英文包 0 个汉字；脚本通过 ES module 语法校验；BDS 1.26.52.3 真机加载无报错。

## 已知限制

- 除草掉落未做玩家动作级验证（需玩家实际动作，无头 Bot 能力所限）；代码写法已确认正确（使用 `brokenBlockPermutation.type.id`）。

## 源码结构

```
luckyclover/
├── README.md            ← 本页
├── CHANGELOG.md         ← 更新日志
├── behavior_packs/      ← 行为包源码（v2.1.19）
├── resource_packs/      ← 资源包源码（v2.1.19）
└── dist/                ← 构建产物 .mcaddon（中 / 英 / 日）
```

## 许可证

代码与 JSON：**MIT**（见 [LICENSE](./LICENSE)）  
贴图与 3D 模型：**CC-BY-4.0**（见 [LICENSE-ASSETS](./LICENSE-ASSETS.md)）
