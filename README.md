# 🍀 幸运四叶草 · Lucky Clover

> 除草概率掉落四叶草，长按祈愿触发 24 种趣味奇遇
>
> **当前版本** `v1.1.2` ｜ **最低版本** `1.21.60` ｜ **实测运行** `1.26.52.3`

[← 返回合集总仓库](https://github.com/dfy5535/minecraft-bedrock-addons)

---

## 简介

除草概率掉落四叶草，长按祈愿触发 24 种趣味奇遇。

**内容规模**

- 24 种轻量奇遇事件
- 四叶草 / 金四叶草 3D 模型 + 动画
- 副手携带持续幸运 I

## 版本与兼容性

| 项 | 值 |
|---|---|
| 当前版本 | v1.1.2 |
| 最低引擎版本 | 1.21.60 |
| 脚本 API | @minecraft/server 1.17.0 |
| 实测运行版本 | 1.26.52.3 |
| BP UUID | `2925ca6f-0c36-4c97-ad5d-77d166181c8b` |
| RP UUID | `f808f2c6-d17c-4bf7-8f7d-bf4b89ce0ee5` |

## 下载

- `dist/LuckyClover_Addon_v1.1.2_1.21.60-compat.mcaddon` — v1.1.2 · 1.21.60 兼容版

也可以在 [Releases](https://github.com/dfy5535/bedrock-lucky-clover/releases) 里按版本下载。

## 安装

1. 下载上面的 `.mcaddon` 文件
2. 双击导入（或在游戏内「设置 → 存储 → 资源包/行为包」导入）
3. 新建世界或进入已有世界，**同时启用行为包与资源包**
4. 若提示缺少依赖，请确认两个包都启用了

## 更新日志

完整历史见 [CHANGELOG.md](./CHANGELOG.md)。最新一版：

### v1.1.2 — 2026-10-17

- 🔧 **变更** — `min_engine_version` `[1,21,10]` → `[1,21,60]`（对齐项目基线）；`@minecraft/server` `1.12.0` → `1.17.0`。
- 📌 **说明** — 代码本就兼容 1.x（已用 `world.beforeEvents.worldInitialize` 双路径），**无逻辑改动**。

## 已知限制

- 除草掉落未做玩家动作级验证（需玩家实际动作，无头 Bot 能力所限）；代码写法已确认正确（使用 `brokenBlockPermutation.type.id`）。

## 源码结构

```
luckyclover/
├── README.md            ← 本页
├── CHANGELOG.md         ← 更新日志
├── behavior_packs/      ← 行为包源码
├── resource_packs/      ← 资源包源码
└── dist/                ← 构建产物 .mcaddon
```

## 许可证

代码与 JSON：**MIT**（见 [LICENSE](./LICENSE)）  
贴图与 3D 模型：**CC-BY-4.0**（见 [LICENSE-ASSETS](./LICENSE-ASSETS.md)）
