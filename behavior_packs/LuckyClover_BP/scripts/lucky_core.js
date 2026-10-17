/*
 * lucky_core.js —— 幸运四叶草核心逻辑（无 world 接线，可被主脚本与测试钩子共用）
 * 生产路径与测试路径共用本文件，保证「测过的就是发出去的」。
 */
/*
 * ============================================================================
 *  幸运四叶草 (Lucky Clover) — Minecraft 基岩版 1.21.61 Add-On 核心脚本
 *  依据《Minecraft 基岩版 1.21.61「幸运四叶草」轻量级 Add-On 完整策划案》实现
 *  API: @minecraft/server 1.17.0（1.21.60 / 1.21.61 稳定版）
 * ============================================================================
 */

import { system, ItemStack, EquipmentSlot, GameMode } from "@minecraft/server";

// ============================================================================
// 1. 定义 1.21.61 四类地表野草方块 ID 与基础掉落率（严格排除 minecraft:grass_block）
// ============================================================================
const GRASS_DROP_RATES = {
  "minecraft:short_grass": 0.04, // 矮草：4.0%
  "minecraft:fern": 0.045,       // 蕨：4.5%
  "minecraft:tall_grass": 0.06,  // 高草丛：6.0%
  "minecraft:large_fern": 0.065  // 大型蕨：6.5%
};

const CLOVER_ITEM_ID = "lucky:four_leaf_clover";

// ---------------------------------------------------------------------------
// 事件 10「流光经验泉」产出标定
//   真机实测：每个 minecraft:xp_orb 实体 = 1 点经验。
//   策划案 §4 表格要求「累计 35 ~ 55 点经验值」，而 §5.5 示例代码只喷 2 球 × 8 次 = 16 点，
//   与它自己的表格矛盾。本工程按**表格声明的玩家可见结果**标定：
//     每 3 tick 一次 × 8 次，每次 5~6 球 ⇒ 40 ~ 48 点（落在 35~55 内）。
// ---------------------------------------------------------------------------
const XP_FOUNTAIN_TICKS = 8;          // 共 8 次
const XP_FOUNTAIN_INTERVAL = 3;       // 每 3 tick 一次（≈1.2 秒）
const XP_FOUNTAIN_ORBS_MIN = 5;       // 每次最少经验球数
const XP_FOUNTAIN_ORBS_MAX = 6;       // 每次最多经验球数

// 诊断日志开关：每次成功掉落 / 每次事件执行各输出一行到内容日志（便于排障与验收取证）
const DEBUG_LOG = true;

function log(...args) {
  if (DEBUG_LOG) console.log("[LuckyClover]", ...args);
}

// 工具函数：生成 [min, max] 闭区间随机整数
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 工具函数：从数组中随机抽取一项
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 工具函数：从数组中不重复地随机抽取 n 项（n 不超过数组长度）
function pickDistinct(arr, n) {
  const pool = arr.slice();
  const out = [];
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

// 工具函数：在玩家前方偏上位置优雅弹出物品
function spawnGiftItem(dimension, location, typeId, amount = 1) {
  const spawnPos = {
    x: location.x,
    y: location.y + 0.6,
    z: location.z
  };
  try {
    return dimension.spawnItem(new ItemStack(typeId, amount), spawnPos);
  } catch (e) {
    // 例如区块未加载；不能让一次生成失败吃掉整个事件的其余演出与安慰奖
    log(`spawnItem skipped: ${typeId} x${amount} (${e})`);
    return null;
  }
}

// 工具函数：安全发送聊天提示（提示失败不应中断事件其余部分）
// 工具函数：安全执行一段可能抛错的操作，失败只记日志、不中断事件其余部分
function safeMessage(player, text) {
  try {
    player.sendMessage(text);
  } catch (e) {
    log("sendMessage failed:", e);
  }
}

function safeRun(label, fn) {
  try {
    return fn();
  } catch (e) {
    log(`${label} failed: ${e}`);
    return null;
  }
}

// 工具函数：安全生成实体。
// ⚠ 真机实测：和平难度下 spawnEntity 敌对生物会抛
//   EntitySpawnError: Attempting to spawn a hostile mob in a peaceful world.
//   若不做保护，事件 20/23 的后续掉落、音效、粒子、提示会被整体中断。
function safeSpawnEntity(dimension, typeId, location, nameTag) {
  try {
    const entity = dimension.spawnEntity(typeId, location);
    if (entity && nameTag) {
      try {
        entity.nameTag = nameTag;
      } catch (e) {
        log(`nameTag failed: ${nameTag} (${e})`);
      }
    }
    return entity;
  } catch (e) {
    log(`spawnEntity skipped: ${typeId} (${e})`);
    return null;
  }
}

// 工具函数：安全地给玩家施加状态效果（个别效果/时长组合在边界情况下可能抛错）
function safeAddEffect(player, effectId, duration, options) {
  try {
    player.addEffect(effectId, duration, options);
    return true;
  } catch (e) {
    log("addEffect failed:", effectId, e);
    return false;
  }
}

// 工具函数：安全地播放音效
function safePlaySound(player, soundId, options) {
  try {
    player.playSound(soundId, options);
  } catch (e) {
    log("playSound failed:", soundId, e);
  }
}

// 工具函数：安全地生成粒子
function safeSpawnParticle(dimension, particleId, location) {
  try {
    dimension.spawnParticle(particleId, location);
  } catch (e) {
    log("spawnParticle failed:", particleId, e);
  }
}



// ---------------------------------------------------------------------------
// 掉落判定：生产路径（playerBreakBlock）与测试钩子都调用这一个函数
// ---------------------------------------------------------------------------
/**
 * @param {{blockId:string, isCreative:boolean, mainhandTypeId?:string,
 *          hasSilkTouch?:boolean, fortuneLevel?:number, roll:number}} input
 */
export function evaluateDrop(input) {
  const baseChance = GRASS_DROP_RATES[input.blockId];
  if (baseChance === undefined) return { applicable: false };

  // 创造模式不掉落
  if (input.isCreative) return { applicable: true, blocked: "creative" };
  // 剪刀剪草会掉草本体，禁止掉四叶草以防无限放置循环刷
  if (input.mainhandTypeId === "minecraft:shears") return { applicable: true, blocked: "shears" };
  // 精准采集同理
  if (input.hasSilkTouch) return { applicable: true, blocked: "silk_touch" };

  // 每级时运 +1.5%
  const fortuneBonus = (input.fortuneLevel || 0) * 0.015;
  const finalChance = baseChance + fortuneBonus;
  return {
    applicable: true,
    blocked: null,
    baseChance,
    fortuneBonus,
    finalChance,
    dropped: input.roll < finalChance
  };
}

// ============================================================================
// 3. 定义 24 种四叶草微型事件池（总权重 = 1000）
// ============================================================================
const CLOVER_EVENTS = [
  // -------------------- 第一片叶：自然馈赠（权重 350） --------------------
  {
    id: "event_01_morning_bread",
    leaf: 1,
    weight: 75,
    execute(player, dim, loc) {
      spawnGiftItem(dim, loc, "minecraft:bread", randInt(2, 4));
      spawnGiftItem(dim, loc, "minecraft:golden_carrot", randInt(1, 2));
      safeSpawnParticle(dim, "minecraft:crop_growth_emitter", loc);
      safePlaySound(player, "random.burp", { pitch: 1.1, volume: 0.8 });
      safeMessage(player, "§a[自然馈赠] 四叶草化作了刚出炉的麦香食物！");
    }
  },
  {
    id: "event_02_coin_pouch",
    leaf: 1,
    weight: 70,
    execute(player, dim, loc) {
      spawnGiftItem(dim, loc, "minecraft:emerald", randInt(2, 5));
      spawnGiftItem(dim, loc, "minecraft:gold_nugget", randInt(4, 8));
      spawnGiftItem(dim, loc, "minecraft:iron_nugget", randInt(4, 8));
      safeSpawnParticle(dim, "minecraft:villager_happy", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "random.orb", { pitch: 1.3, volume: 1.0 });
      safeMessage(player, "§a[自然馈赠] 草叶间滑落了几枚闪亮的钱币与碎金！");
    }
  },
  {
    id: "event_03_rare_botany",
    leaf: 1,
    weight: 65,
    execute(player, dim, loc) {
      // 包含 1.21.50/1.21.60 苍白之园新增植物与嗅探兽远古植物
      const rarePlants = [
        "minecraft:cherry_sapling",
        "minecraft:pale_oak_sapling",
        "minecraft:open_eyeblossom",
        "minecraft:torchflower",
        "minecraft:pitcher_plant"
      ];
      // 策划案要求「随机抽 2 种」，故不重复抽取
      for (const plant of pickDistinct(rarePlants, 2)) {
        spawnGiftItem(dim, loc, plant, 1);
      }
      spawnGiftItem(dim, loc, "minecraft:bone_meal", randInt(3, 5));
      safeSpawnParticle(dim, "minecraft:crop_growth_emitter", loc);
      safePlaySound(player, "item.bone_meal.use", { pitch: 1.0, volume: 1.0 });
      safeMessage(player, "§a[自然馈赠] 远方群系的珍稀花苗随风落入你手中！");
    }
  },
  {
    id: "event_04_miner_pocket",
    leaf: 1,
    weight: 60,
    execute(player, dim, loc) {
      spawnGiftItem(dim, loc, "minecraft:raw_iron", randInt(2, 4));
      spawnGiftItem(dim, loc, "minecraft:raw_copper", randInt(3, 5));
      spawnGiftItem(dim, loc, "minecraft:lapis_lazuli", randInt(2, 3));
      spawnGiftItem(dim, loc, "minecraft:torch", 6);
      safeSpawnParticle(dim, "minecraft:wax_on_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "dig.stone", { pitch: 1.2, volume: 0.9 });
      safeMessage(player, "§a[自然馈赠] 你捡到了某位粗心矿工遗落的补给包！");
    }
  },
  {
    id: "event_05_tea_party",
    leaf: 1,
    weight: 50,
    execute(player, dim, loc) {
      spawnGiftItem(dim, loc, "minecraft:pumpkin_pie", 1);
      spawnGiftItem(dim, loc, "minecraft:cookie", randInt(3, 5));
      spawnGiftItem(dim, loc, "minecraft:honey_bottle", 1);
      spawnGiftItem(dim, loc, "minecraft:sweet_berries", 3);
      safeSpawnParticle(dim, "minecraft:heart_particle", { x: loc.x, y: loc.y + 1.2, z: loc.z });
      safePlaySound(player, "item.honey_bottle.drink", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, "§a[自然馈赠] 森林精灵邀请你共享甜蜜的林间下午茶！");
    }
  },
  {
    id: "event_06_emerald_diamond_glint",
    leaf: 1,
    weight: 30,
    execute(player, dim, loc) {
      spawnGiftItem(dim, loc, "minecraft:diamond", 1);
      spawnGiftItem(dim, loc, "minecraft:amethyst_shard", 2);
      safeSpawnParticle(dim, "minecraft:totem_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "chime.amethyst_block", { pitch: 1.2, volume: 1.0 });
      safeMessage(player, "§b§l[自然奇迹] 四叶草折射出璀璨的晶体光芒，凝结出了一颗钻石！");
    }
  },

  // -------------------- 第二片叶：生灵奇遇（权重 250） --------------------
  {
    id: "event_07_grateful_bee",
    leaf: 2,
    weight: 50,
    execute(player, dim, loc) {
      safeSpawnEntity(dim, "minecraft:bee", { x: loc.x, y: loc.y + 1.2, z: loc.z }, "§e幸运采蜜蜂");
      spawnGiftItem(dim, loc, "minecraft:honeycomb", 2);
      safeSpawnParticle(dim, "minecraft:villager_happy", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "mob.bee.pollinate", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, "§e[生灵奇遇] 一只勤劳的幸运采蜜蜂带着两块蜜脾前来报恩！");
    }
  },
  {
    id: "event_08_lucky_pig",
    leaf: 2,
    weight: 45,
    execute(player, dim, loc) {
      safeSpawnEntity(dim, "minecraft:pig", loc, "§6福气小猪");
      const gift = Math.random() < 0.5 ? "minecraft:saddle" : "minecraft:carrot_on_a_stick";
      spawnGiftItem(dim, loc, gift, 1);
      safeSpawnParticle(dim, "minecraft:heart_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "mob.pig.say", { pitch: 1.2, volume: 1.0 });
      safeMessage(player, "§e[生灵奇遇] 草丛里钻出了一只自带骑乘工具的福气小猪！");
    }
  },
  {
    id: "event_09_treasure_frog",
    leaf: 2,
    weight: 45,
    execute(player, dim, loc) {
      safeSpawnEntity(dim, "minecraft:frog", loc, "§a寻宝青蛙");
      const froglights = [
        "minecraft:pearlescent_froglight",
        "minecraft:verdant_froglight",
        "minecraft:ochre_froglight"
      ];
      spawnGiftItem(dim, loc, pickRandom(froglights), 1);
      spawnGiftItem(dim, loc, "minecraft:slime_ball", 1);
      safeSpawnParticle(dim, "minecraft:villager_happy", loc);
      safePlaySound(player, "mob.frog.ambient", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, "§e[生灵奇遇] 寻宝青蛙从草叶间跃出，吐出了一盏温润的蛙明灯！");
    }
  },
  {
    id: "event_10_xp_fountain",
    leaf: 2,
    weight: 45,
    execute(player, dim, loc) {
      safeSpawnParticle(dim, "minecraft:totem_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "random.levelup", { pitch: 1.2, volume: 0.9 });
      safeMessage(player, "§e[生灵奇遇] 浓缩的自然灵气化作经验泉水涌出！");
      let ticks = 0;
      const runId = system.runInterval(() => {
        ticks++;
        if (ticks > XP_FOUNTAIN_TICKS || !player.isValid()) {
          system.clearRun(runId);
          return;
        }
        const pLoc = player.location;
        const pDim = player.dimension;
        const orbs = randInt(XP_FOUNTAIN_ORBS_MIN, XP_FOUNTAIN_ORBS_MAX);
        for (let i = 0; i < orbs; i++) {
          safeSpawnEntity(pDim, "minecraft:xp_orb", { x: pLoc.x, y: pLoc.y + 1.2, z: pLoc.z });
        }
        safePlaySound(player, "random.orb", { pitch: 0.9 + ticks * 0.08, volume: 0.6 });
      }, XP_FOUNTAIN_INTERVAL);
    }
  },
  {
    id: "event_11_wandering_bundle",
    leaf: 2,
    weight: 40,
    execute(player, dim, loc) {
      spawnGiftItem(dim, loc, "minecraft:green_bundle", 1);
      spawnGiftItem(dim, loc, "minecraft:nautilus_shell", 1);
      spawnGiftItem(dim, loc, "minecraft:sea_pickle", 2);
      safeSpawnParticle(dim, "minecraft:villager_happy", loc);
      safePlaySound(player, "item.bundle.insert", { pitch: 1.0, volume: 1.0 });
      safeMessage(player, "§e[生灵奇遇] 你发现了流浪商人遗落在草丛里的绿色收纳袋与海螺！");
    }
  },
  {
    id: "event_12_allay_melody",
    leaf: 2,
    weight: 25,
    execute(player, dim, loc) {
      const allay = safeSpawnEntity(dim, "minecraft:allay", { x: loc.x, y: loc.y + 1.5, z: loc.z }, "§b四叶草伴舞精灵");
      const discs = [
        "minecraft:music_disc_otherside",
        "minecraft:music_disc_cat",
        "minecraft:music_disc_precipice"
      ];
      spawnGiftItem(dim, loc, pickRandom(discs), 1);
      safeSpawnParticle(dim, "minecraft:note_particle", { x: loc.x, y: loc.y + 2, z: loc.z });
      safePlaySound(player, "mob.allay.item_given", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, "§b[生灵奇遇] 悦灵为你献上了一支森林圆舞曲，并留下一张珍贵唱片！");

      // 12 秒后悦灵礼貌告别并静默移除，不留冗余实体
      system.runTimeout(() => {
        try {
          if (allay && allay.isValid()) {
            allay.dimension.spawnParticle("minecraft:heart_particle", allay.location);
            allay.remove();
          }
        } catch (e) {
          log("allay cleanup failed:", e);
        }
      }, 240);
    }
  },

  // -------------------- 第三片叶：自然祝福（权重 250） --------------------
  {
    id: "event_13_wind_blessing",
    leaf: 3,
    weight: 50,
    execute(player, dim, loc) {
      safeAddEffect(player, "speed", 900, { amplifier: 1, showParticles: true });
      safeAddEffect(player, "jump_boost", 900, { amplifier: 1, showParticles: true });
      safeSpawnParticle(dim, "minecraft:wind_explosion_emitter", loc);
      safePlaySound(player, "wind_charge.burst", { pitch: 1.2, volume: 0.8 });
      safeMessage(player, "§b[自然祝福] 轻风缠绕双足，你获得了 45 秒速度 II 与跳跃提升 II！");
    }
  },
  {
    id: "event_14_earth_affinity",
    leaf: 3,
    weight: 45,
    execute(player, dim, loc) {
      safeAddEffect(player, "haste", 1200, { amplifier: 1, showParticles: true });
      safeAddEffect(player, "night_vision", 1200, { amplifier: 0, showParticles: false });
      safeSpawnParticle(dim, "minecraft:enchanting_table_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "block.enchanting_table.use", { pitch: 1.2, volume: 0.8 });
      safeMessage(player, "§b[自然祝福] 大地亲和加身！你获得了 60 秒急迫 II 与夜视能力！");
    }
  },
  {
    id: "event_15_forest_vitality",
    leaf: 3,
    weight: 45,
    execute(player, dim, loc) {
      safeAddEffect(player, "regeneration", 300, { amplifier: 1, showParticles: true });
      safeAddEffect(player, "absorption", 1200, { amplifier: 1, showParticles: true });
      safeAddEffect(player, "saturation", 40, { amplifier: 0, showParticles: false });
      safeSpawnParticle(dim, "minecraft:heart_particle", { x: loc.x, y: loc.y + 1.2, z: loc.z });
      safePlaySound(player, "random.drink", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, "§b[自然祝福] 森林甘霖治愈了你，并为你凝结出 4 颗金色吸收护盾心！");
    }
  },
  {
    id: "event_16_breeze_feather",
    leaf: 3,
    weight: 40,
    execute(player, dim, loc) {
      safeAddEffect(player, "slow_falling", 900, { amplifier: 0, showParticles: true });
      safeAddEffect(player, "fire_resistance", 1200, { amplifier: 0, showParticles: true });
      spawnGiftItem(dim, loc, "minecraft:wind_charge", 2);
      safeSpawnParticle(dim, "minecraft:white_smoke_particle", loc);
      safePlaySound(player, "mob.breeze.shoot", { pitch: 1.2, volume: 0.9 });
      safeMessage(player, "§b[自然祝福] 清风护体！获得缓降与防火祝福，并附赠 2 枚风弹！");
    }
  },
  {
    id: "event_17_blooming_meadow",
    leaf: 3,
    weight: 35,
    execute(player, dim, loc) {
      const flowers = [
        "minecraft:dandelion",
        "minecraft:poppy",
        "minecraft:cornflower",
        "minecraft:blue_orchid",
        "minecraft:oxeye_daisy",
        "minecraft:allium"
      ];
      const baseX = Math.floor(loc.x);
      const baseY = Math.floor(loc.y);
      const baseZ = Math.floor(loc.z);
      let bloomCount = 0;

      for (let dx = -4; dx <= 4; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -4; dz <= 4; dz++) {
            try {
              const b = dim.getBlock({ x: baseX + dx, y: baseY + dy, z: baseZ + dz });
              if (b && b.typeId === "minecraft:short_grass") {
                b.setType(pickRandom(flowers));
                bloomCount++;
              }
            } catch (e) {
              // 区块未加载等情况下跳过该坐标，不影响其余方块
            }
          }
        }
      }
      if (bloomCount === 0) {
        // 如果周围没有矮草，直接补偿 3 朵花在玩家脚下
        spawnGiftItem(dim, loc, pickRandom(flowers), 3);
      }
      safeSpawnParticle(dim, "minecraft:crop_growth_emitter", loc);
      safePlaySound(player, "item.bone_meal.use", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, `§b[自然祝福] 四叶草灵气席卷四周，身旁的野草瞬间绽放出鲜花！（绽放 ${bloomCount} 处）`);
    }
  },
  {
    id: "event_18_artisan_mend",
    leaf: 3,
    weight: 35,
    execute(player, dim, loc) {
      const inv = player.getComponent("minecraft:inventory")?.container;
      let repairedItemName = null;

      const tryRepair = (item, writeBack) => {
        if (!item) return false;
        const dur = safeRun("event18 durability", () => item.getComponent("minecraft:durability"));
        if (!dur || dur.damage <= 0) return false;
        safeRun("event18 repair", () => {
          dur.damage = Math.max(0, dur.damage - 40);
          writeBack(item);
        });
        repairedItemName = item.typeId.replace("minecraft:", "");
        return true;
      };

      // ⚠ 策划案 §4 表格文字为「背包（或副手）」，但：
      //   1) §5.5 示例代码只扫 minecraft:inventory 容器（该容器不含副手槽）；
      //   2) 真机实测 @minecraft/server 1.17.0 的 EntityEquippableComponent.setEquipment()
      //      **不会持久化 ItemStack 的组件改动**（改完 durability.damage 写回后读回仍是原值），
      //      clone 写回同样无效，而「先清空槽位再写回」会直接丢物品。
      //   故副手修复在本 API 版本上无法可靠实现，此处与示例代码保持一致，只扫背包容器。
      if (inv) {
        for (let i = 0; i < inv.size; i++) {
          const item = safeRun("event18 getItem", () => inv.getItem(i));
          if (tryRepair(item, (it) => inv.setItem(i, it))) break;
        }
      }

      if (repairedItemName) {
        safeSpawnParticle(dim, "minecraft:wax_off_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
        safePlaySound(player, "random.anvil_use", { pitch: 1.3, volume: 0.8 });
        safeMessage(player, `§b[自然祝福] 巧匠精灵拂过你的行囊，为你的 [${repairedItemName}] 恢复了 40 点耐久！`);
      } else {
        spawnGiftItem(dim, loc, "minecraft:experience_bottle", 3);
        safePlaySound(player, "random.orb", { pitch: 1.2, volume: 0.9 });
        safeMessage(player, "§b[自然祝福] 你的工具完好无损，巧匠精灵改送了你 3 瓶附魔之瓶！");
      }
    }
  },

  // -------------------- 第四片叶：调皮妖精（权重 150） --------------------
  {
    id: "event_19_balloon_float",
    leaf: 4,
    weight: 30,
    execute(player, dim, loc) {
      safeAddEffect(player, "levitation", 60, { amplifier: 1, showParticles: true });
      safeAddEffect(player, "slow_falling", 160, { amplifier: 0, showParticles: true });
      spawnGiftItem(dim, loc, "minecraft:feather", 2);
      safeSpawnParticle(dim, "minecraft:endrod", loc);
      safePlaySound(player, "mob.shulker.shoot", { pitch: 1.4, volume: 0.8 });
      safeMessage(player, "§d[调皮妖精] 哎呀！这片四叶草里藏着失重气球魔法，小心飘起来咯！");
    }
  },
  {
    id: "event_20_stinky_slime",
    leaf: 4,
    weight: 25,
    execute(player, dim, loc) {
      safeAddEffect(player, "nausea", 100, { amplifier: 0, showParticles: true });
      safeSpawnEntity(dim, "minecraft:slime", loc, "§a伪装成草叶的史莱姆");
      spawnGiftItem(dim, loc, "minecraft:slime_ball", 1);
      safeSpawnParticle(dim, "minecraft:slime_particle", loc);
      safePlaySound(player, "mob.slime.squish", { pitch: 0.9, volume: 1.0 });
      safeMessage(player, "§d[调皮妖精] 呕——这根本不是四叶草，是一坨黏糊糊的史莱姆！");
    }
  },
  {
    id: "event_21_fools_gold_butter",
    leaf: 4,
    weight: 25,
    execute(player, dim, loc) {
      safeRun("event21 butter", () => {
        const butter = new ItemStack("minecraft:yellow_dye", 1);
        butter.nameTag = "§6§l传世纯金块（其实是黄油）";
        butter.setLore(["§7森林妖精的手工恶作剧纪念品", "§8虽然不能换钱，但看起来很贵"]);
        dim.spawnItem(butter, { x: loc.x, y: loc.y + 0.6, z: loc.z });
      });
      spawnGiftItem(dim, loc, "minecraft:poisonous_potato", 1);
      spawnGiftItem(dim, loc, "minecraft:baked_potato", 2);
      safeSpawnParticle(dim, "minecraft:villager_angry", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "mob.villager.no", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, "§d[调皮妖精] 你以为掉出了纯金块？仔细一看原来是一块黄油！");
    }
  },
  {
    id: "event_22_fake_creeper_firework",
    leaf: 4,
    weight: 25,
    execute(player, dim, loc) {
      safePlaySound(player, "random.fuse", { pitch: 1.0, volume: 1.0 });
      safeMessage(player, "§c[？！] 身后传来了熟悉的嘶嘶声……");
      system.runTimeout(() => {
        try {
          if (!player.isValid()) return;
          const pLoc = player.location;
          const pDim = player.dimension;
          pDim.spawnParticle("minecraft:totem_particle", {
            x: pLoc.x,
            y: pLoc.y + 1,
            z: pLoc.z
          });
          safePlaySound(player, "firework.twinkle", { pitch: 1.1, volume: 1.0 });
          spawnGiftItem(pDim, pLoc, "minecraft:gunpowder", 2);
          safeMessage(player, "§d[调皮妖精] 砰！骗你的，只是森林妖精的恶作剧烟花，送你两撮火药压压惊！");
        } catch (e) {
          log("fake creeper firework failed:", e);
        }
      }, 30);
    }
  },
  {
    id: "event_23_grass_silverfish",
    leaf: 4,
    weight: 25,
    execute(player, dim, loc) {
      safeSpawnEntity(dim, "minecraft:silverfish", loc, "§7啃草叶的小害虫");
      safeAddEffect(player, "slowness", 80, { amplifier: 0, showParticles: false });
      spawnGiftItem(dim, loc, "minecraft:iron_nugget", 3);
      safeSpawnParticle(dim, "minecraft:crit_particle", loc);
      safePlaySound(player, "mob.silverfish.say", { pitch: 1.2, volume: 0.9 });
      safeMessage(player, "§d[调皮妖精] 糟糕，这株四叶草里钻出了一只啃草叶的小害虫！");
    }
  },
  {
    id: "event_24_green_hat_prank",
    leaf: 4,
    weight: 20,
    execute(player, dim, loc) {
      safeRun("event24 hat", () => {
        const hat = new ItemStack("minecraft:leather_helmet", 1);
        hat.nameTag = "§a§l森林妖精的环保绿帽";
        hat.setLore(["§7充满了大自然生机的时尚单品"]);

        const equippable = player.getComponent("minecraft:equippable");
        const currentHead = equippable?.getEquipment(EquipmentSlot.Head);
        if (equippable && !currentHead) {
          equippable.setEquipment(EquipmentSlot.Head, hat);
        } else {
          dim.spawnItem(hat, { x: loc.x, y: loc.y + 0.6, z: loc.z });
        }
      });
      safeSpawnParticle(dim, "minecraft:villager_happy", { x: loc.x, y: loc.y + 1.5, z: loc.z });
      safePlaySound(player, "armor.equip_leather", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, "§d[调皮妖精] 森林妖精觉得你头顶太单调，送了你一顶充满生机的环保皮帽！");
    }
  }
];

// 计算总权重并按权重抽取事件
const TOTAL_WEIGHT = CLOVER_EVENTS.reduce((sum, ev) => sum + ev.weight, 0);

function rollCloverEvent() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const ev of CLOVER_EVENTS) {
    if (roll < ev.weight) return ev;
    roll -= ev.weight;
  }
  return CLOVER_EVENTS[0];
}


// ============================================================================
// 4. 消耗玩家手中的 1 株四叶草
//    策划案只扣主手；这里额外覆盖副手/背包槽，避免「副手使用不消耗」的免费祈愿漏洞。
// ============================================================================
function consumeOneOf(player, itemId) {
  if (player.getGameMode() === GameMode.creative) return;

  const equippable = player.getComponent("minecraft:equippable");
  const mainhand = equippable?.getEquipment(EquipmentSlot.Mainhand);
  if (mainhand && mainhand.typeId === itemId) {
    if (mainhand.amount > 1) {
      mainhand.amount -= 1;
      safeRun("consume mainhand", () => equippable.setEquipment(EquipmentSlot.Mainhand, mainhand));
    } else {
      safeRun("consume mainhand empty", () => equippable.setEquipment(EquipmentSlot.Mainhand, undefined));
    }
    return;
  }

  // 2) 副手。物品开启了 allow_off_hand，副手使用若不扣就会变成「免费祈愿」。
  //    ⚠ 真机实测：minecraft:inventory 容器**不包含副手槽**，只扫背包是漏的。
  const offhand = equippable?.getEquipment(EquipmentSlot.Offhand);
  if (offhand && offhand.typeId === itemId) {
    if (offhand.amount > 1) {
      offhand.amount -= 1;
      safeRun("consume offhand", () => equippable.setEquipment(EquipmentSlot.Offhand, offhand));
    } else {
      safeRun("consume offhand empty", () => equippable.setEquipment(EquipmentSlot.Offhand, undefined));
    }
    return;
  }

  // 3) 最后回退到背包中第一个匹配槽位
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (item && item.typeId === itemId) {
      if (item.amount > 1) {
        item.amount -= 1;
        safeRun("consume inv", () => inv.setItem(i, item));
      } else {
        safeRun("consume inv empty", () => inv.setItem(i, undefined));
      }
      return;
    }
  }
}


// ---------------------------------------------------------------------------
// 二期：金叶四叶草 —— 只抽前三片叶（自然馈赠 / 生灵奇遇 / 自然祝福），
//       且钻石(06) 与悦灵伴舞(12) 权重翻倍；永不触发第四片叶的调皮整蛊。
// ---------------------------------------------------------------------------
export const GOLDEN_CLOVER_ITEM_ID = "lucky:golden_clover";
export const GOLDEN_BOOSTED_EVENTS = ["event_06_emerald_diamond_glint", "event_12_allay_melody"];

const POSITIVE_EVENTS = CLOVER_EVENTS.filter((ev) => ev.leaf !== 4);
const POSITIVE_WEIGHT = POSITIVE_EVENTS.reduce(
  (sum, ev) => sum + ev.weight * (GOLDEN_BOOSTED_EVENTS.includes(ev.id) ? 2 : 1), 0);

export function rollGoldenCloverEvent() {
  let roll = Math.random() * POSITIVE_WEIGHT;
  for (const ev of POSITIVE_EVENTS) {
    const w = ev.weight * (GOLDEN_BOOSTED_EVENTS.includes(ev.id) ? 2 : 1);
    if (roll < w) return ev;
    roll -= w;
  }
  return POSITIVE_EVENTS[0];
}

export function goldenPoolInfo() {
  return {
    count: POSITIVE_EVENTS.length,
    weight: POSITIVE_WEIGHT,
    ids: POSITIVE_EVENTS.map((e) => e.id + (GOLDEN_BOOSTED_EVENTS.includes(e.id) ? "x2" : ""))
  };
}

// ---------------------------------------------------------------------------
// 二期：夹在书里的四叶草书签 —— 副手持有四叶草时，持续提供无粒子的被动祝福
//
// ⚠ 策划案二期写的是「幸运 I (luck)」。经真机验证：**Bedrock 版没有 luck 效果**——
//   addEffect("luck", …) 抛 InvalidArgumentError: Expected type: effectType；
//   BDS 1.26.52.3 引擎字符串表中不存在 luck / unluck，而其它全部原版效果均存在。
//   luck / unluck 是 Java 版专有效果。
//   故改用 Bedrock 原生、语义最接近「幸运」的 village_hero（村庄英雄：村民交易折扣），
//   机制与策划案完全一致（每 5 秒检查副手、无粒子、持续刷新、离手自然过期）。
//   策划案所述的「钓鱼更容易出宝藏」在 Bedrock 无法通过状态效果实现（那是
//   luck_of_the_sea 附魔的职责），已在交付报告中声明。
// ---------------------------------------------------------------------------
export const XP_FOUNTAIN = { ticks: XP_FOUNTAIN_TICKS, interval: XP_FOUNTAIN_INTERVAL, orbsMin: XP_FOUNTAIN_ORBS_MIN, orbsMax: XP_FOUNTAIN_ORBS_MAX };

export const OFFHAND_BLESSING_EFFECT = "village_hero";
export const OFFHAND_BLESSING_AMPLIFIER = 0;
export const OFFHAND_LUCK_INTERVAL_TICKS = 100; // 每 5 秒检查一次
export const OFFHAND_LUCK_DURATION_TICKS = 120; // 祝福持续 6 秒（略长于检查间隔，避免闪烁）

export function refreshOffhandLuck(player) {
  try {
    const equippable = player.getComponent("minecraft:equippable");
    const offhand = equippable?.getEquipment(EquipmentSlot.Offhand);
    if (offhand && offhand.typeId === CLOVER_ITEM_ID) {
      safeAddEffect(player, OFFHAND_BLESSING_EFFECT, OFFHAND_LUCK_DURATION_TICKS,
        { amplifier: OFFHAND_BLESSING_AMPLIFIER, showParticles: false });
      return true;
    }
  } catch (e) {
    log("refreshOffhandLuck failed:", e);
  }
  return false;
}

export function consumeOneClover(player) { return consumeOneOf(player, CLOVER_ITEM_ID); }

export { safeMessage, safeRun, safeSpawnEntity, GRASS_DROP_RATES, CLOVER_ITEM_ID, consumeOneOf, CLOVER_EVENTS, TOTAL_WEIGHT, rollCloverEvent, randInt, pickRandom, pickDistinct, spawnGiftItem, safeAddEffect, safePlaySound, safeSpawnParticle, log };
