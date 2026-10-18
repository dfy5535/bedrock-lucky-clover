/*
 * lucky_core.js —— 《幸运四叶草：自然与命运》(Lucky Clover: Nature & Destiny) 核心逻辑
 * 兼容 Minecraft 基岩版 1.21.60+ (@minecraft/server 1.17.0)
 * 完整保留原版 24 种奇遇、除草掉落、时运加成、副手祝福与金叶规则及全部导出接口，
 * 并扩展：7 种野生与跨维度植物生态、休眠重生、4 阶段培育与环境变异、40 种完整奇遇池、
 * 5 种金叶专属奇迹、3 套盔甲套装、3 把核心武器、幸运矿镐、四叶草神龛、四叶守护灵三阶段 Boss 与六栏图鉴系统。
 */

import { system, ItemStack, EquipmentSlot, GameMode } from "@minecraft/server";

// ============================================================================
// 1. 定义 1.21.60 四类地表野草方块 ID 与基础掉落率（严格排除 minecraft:grass_block）
// ============================================================================
export const GRASS_DROP_RATES = {
  "minecraft:short_grass": 0.06,  // 矮草：6.0%
  "minecraft:grass": 0.06,        // 旧版本 id 兼容（1.21.50 之前叫 grass）
  "minecraft:fern": 0.065,       // 蕨：6.5%
  "minecraft:tall_grass": 0.07,   // 高草丛：7.0%
  "minecraft:tallgrass": 0.07,    // 旧版本 id 兼容
  "minecraft:large_fern": 0.075  // 大型蕨：7.5%
};

export const CLOVER_ITEM_ID = "lucky:four_leaf_clover";
export const GOLDEN_CLOVER_ITEM_ID = "lucky:golden_clover";

// 新增核心材料、消耗品、装备、植物与实体 ID 常量
export const ITEM_IDS = {
  CLOVER_LEAF: "lucky:clover_leaf",
  LUCKY_POLLEN: "lucky:lucky_pollen",
  MORNING_DEW: "lucky:morning_dew",
  GOLDEN_DEW: "lucky:golden_dew",
  NATURE_ESSENCE: "lucky:nature_essence",
  DESTINY_SHARD: "lucky:destiny_shard",
  GUARDIAN_EMBLEM: "lucky:guardian_emblem",
  SEED_PACKET: "lucky:clover_seed_packet",
  POLLEN_BOTTLE: "lucky:lucky_pollen_bottle",
  CULTIVATOR: "lucky:golden_dew_cultivator",
  GREEN_AMULET: "lucky:green_leaf_amulet",
  DESTINY_BOTTLE: "lucky:destiny_wish_bottle",
  ALMANAC: "lucky:clover_almanac",
  DAGGER: "lucky:emerald_vine_dagger",
  SCYTHE: "lucky:destiny_scythe",
  WISH_BOW: "lucky:four_leaf_wish_bow",
  PICKAXE: "lucky:lucky_pickaxe"
};

export const PLANT_BLOCK_IDS = {
  THREE_LEAF: "lucky:wild_three_leaf_clover",
  WILD_LUCKY: "lucky:wild_lucky_clover",
  GOLD_VEIN: "lucky:gold_vein_clover",
  MORNING_DEW: "lucky:morning_dew_clover",
  MOONLIGHT: "lucky:moonlight_clover",
  EMBER: "lucky:ember_clover",
  STARLIGHT: "lucky:starlight_clover",
  DORMANT: "lucky:dormant_clover_plant",
  STAGE_1: "lucky:clover_crop_stage_1",
  STAGE_2: "lucky:clover_crop_stage_2",
  STAGE_3: "lucky:clover_crop_stage_3",
  STAGE_4: "lucky:clover_crop_stage_4",
  SHRINE: "lucky:clover_shrine"
};

export const PARTICLE_IDS = {
  NATURE_SWIRL: "lucky:nature_leaf_swirl",
  GOLDEN_BURST: "lucky:golden_shield_burst",
  MORNING_DEW: "lucky:morning_dew_drip",
  MOONLIGHT: "lucky:moonlight_ribbon",
  DESTINY_PULSE: "lucky:destiny_star_pulse",
  GUARDIAN_TELEGRAPH: "lucky:guardian_telegraph_ring"
};

export function safePlayAnimation(entity, animName) {
  try {
    if (entity && typeof entity.playAnimation === "function") {
      entity.playAnimation(animName);
      return true;
    }
  } catch (e) {
    log("playAnimation skipped:", animName, e);
  }
  return false;
}

const PROTECTED_BLOCKS = new Set([
  "minecraft:chest", "minecraft:trapped_chest", "minecraft:barrel", "minecraft:ender_chest",
  "minecraft:shulker_box", "minecraft:bed",
  "minecraft:beacon", "minecraft:enchanting_table", "minecraft:mob_spawner",
  "minecraft:end_portal_frame", "minecraft:end_portal", "minecraft:portal", "minecraft:bedrock"
]);

function safeSetBlock(dimension, pos, typeId) {
  try {
    const b = dimension.getBlock(pos);
    if (!b) return false;
    if (PROTECTED_BLOCKS.has(b.typeId)) return false;
    b.setType(typeId);
    return true;
  } catch (e) {
    // 单个方块放置失败不应中断整座建筑
    log("safeSetBlock skipped:", typeId, e);
    return false;
  }
}

/**
 * 升级版 7x7x5 多方块四叶草神龛圣殿建筑（共 156 个实际世界方块，与神龛 .geo.json 的 100 个 3D 几何立方体严格分开统计）：
 * - y-2 层 (49 方块)：7x7 苔石与苔石砖稳固地基
 * - y-1 层 (49 方块)：5x5 錾制石砖/苔石砖主祭坛台基 + 四向入口台阶 (12) + 四角花坛护边 (12)
 * - y~y+2 层 (20 方块)：四角 3 格高实心苔石砖与苔石墙立柱 (4x3=12) + 四侧护栏矮墙 (8)
 * - y+3 层 (20 方块)：与四根立柱完全相连的 5x5 顶部苔石砖/盛开杜鹃花叶拱梁外框 (16) + 四角悬挂祈愿灯笼 (4)
 * - y+4 层 (9 方块)：3x3 顶部盛开杜鹃花叶圣冠与中心海晶灯天顶核心
 * - y 层 (9 方块)：中心四叶草神龛主方块 (1) + 四角珍稀四叶草花坛供奉 (4) + 四向覆地苔藓步道 (4)
 * 合计：49 + 49 + 20 + 20 + 9 + 9 = 156 个世界方块。
 */
export function buildShrineSanctuary(dimension, centerLoc) {
  try {
    const cx = Math.floor(centerLoc.x);
    const cy = Math.floor(centerLoc.y);
    const cz = Math.floor(centerLoc.z);

    // 防止多人或同一玩家重复触发叠加生成：检查顶部圣冠海晶灯与立柱是否已存在
    const topCore = dimension.getBlock({ x: cx, y: cy + 4, z: cz });
    const cornerCap = dimension.getBlock({ x: cx + 2, y: cy + 2, z: cz + 2 });
    if (topCore?.typeId === "minecraft:sea_lantern" && cornerCap?.typeId === "minecraft:chiseled_stone_bricks") {
      return false;
    }

    let placedCount = 0;

    // 1. y-2 层：7x7 苔石与苔石砖地基 (49 blocks)
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const isEdge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
        if (safeSetBlock(dimension, { x: cx + dx, y: cy - 2, z: cz + dz }, isEdge ? "minecraft:mossy_cobblestone" : "minecraft:mossy_stone_bricks")) {
          placedCount++;
        }
      }
    }

    // 2. y-1 层：5x5 主台基 (25) + 四向三格入口台阶 (12) + 四角花坛护边 (12) = 49 blocks
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        let blockId = "minecraft:mossy_stone_bricks";
        if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2) {
          const isAxisOrCorner = (Math.abs(dx) === 2 && Math.abs(dz) === 2) || dx === 0 || dz === 0;
          blockId = isAxisOrCorner ? "minecraft:chiseled_stone_bricks" : "minecraft:mossy_stone_bricks";
        } else if (Math.abs(dx) <= 1 || Math.abs(dz) <= 1) {
          blockId = "minecraft:mossy_stone_brick_stairs";
        } else {
          blockId = "minecraft:mossy_cobblestone";
        }
        if (safeSetBlock(dimension, { x: cx + dx, y: cy - 1, z: cz + dz }, blockId)) {
          placedCount++;
        }
      }
    }

    // 3. y ~ y+2 层：四角 3 格高立柱 (12) + 四侧护栏矮墙 (8) = 20 blocks
    const corners = [[-2, -2], [2, -2], [-2, 2], [2, 2]];
    for (const [dx, dz] of corners) {
      if (safeSetBlock(dimension, { x: cx + dx, y: cy, z: cz + dz }, "minecraft:mossy_stone_bricks")) placedCount++;
      if (safeSetBlock(dimension, { x: cx + dx, y: cy + 1, z: cz + dz }, "minecraft:mossy_cobblestone_wall")) placedCount++;
      if (safeSetBlock(dimension, { x: cx + dx, y: cy + 2, z: cz + dz }, "minecraft:chiseled_stone_bricks")) placedCount++;
    }
    const balustrades = [
      [-2, -1], [-2, 1], [2, -1], [2, 1],
      [-1, -2], [1, -2], [-1, 2], [1, 2]
    ];
    for (const [dx, dz] of balustrades) {
      if (safeSetBlock(dimension, { x: cx + dx, y: cy, z: cz + dz }, "minecraft:mossy_cobblestone_wall")) placedCount++;
    }

    // 4. y+3 层：连接四根立柱的 5x5 顶部拱梁外框 (16) + 四角内侧悬挂祈愿灯笼 (4) = 20 blocks
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2) {
          const isCornerOrMid = (Math.abs(dx) === 2 && Math.abs(dz) === 2) || dx === 0 || dz === 0;
          const beamId = isCornerOrMid ? "minecraft:mossy_stone_bricks" : "minecraft:azalea_leaves_flowered";
          if (safeSetBlock(dimension, { x: cx + dx, y: cy + 3, z: cz + dz }, beamId)) placedCount++;
        }
      }
    }
    const innerCorners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dz] of innerCorners) {
      if (safeSetBlock(dimension, { x: cx + dx, y: cy + 3, z: cz + dz }, "minecraft:lantern")) placedCount++;
    }

    // 5. y+4 层：3x3 盛开杜鹃花叶圣冠与中心海晶灯核心 = 9 blocks
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const crownId = (dx === 0 && dz === 0) ? "minecraft:sea_lantern" : "minecraft:azalea_leaves_flowered";
        if (safeSetBlock(dimension, { x: cx + dx, y: cy + 4, z: cz + dz }, crownId)) placedCount++;
      }
    }

    // 6. y 层：四角四叶草花坛供奉 (4) + 四向覆地苔藓步道 (4) + 中心四叶草神龛 (1) = 9 blocks
    if (safeSetBlock(dimension, { x: cx + 1, y: cy, z: cz + 1 }, "lucky:wild_three_leaf_clover")) placedCount++;
    if (safeSetBlock(dimension, { x: cx - 1, y: cy, z: cz - 1 }, "lucky:gold_vein_clover")) placedCount++;
    if (safeSetBlock(dimension, { x: cx + 1, y: cy, z: cz - 1 }, "lucky:wild_lucky_clover")) placedCount++;
    if (safeSetBlock(dimension, { x: cx - 1, y: cy, z: cz + 1 }, "lucky:morning_dew_clover")) placedCount++;

    const cardinalWalk = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [dx, dz] of cardinalWalk) {
      if (safeSetBlock(dimension, { x: cx + dx, y: cy, z: cz + dz }, "minecraft:moss_carpet")) placedCount++;
    }
    if (safeSetBlock(dimension, { x: cx, y: cy, z: cz }, "lucky:clover_shrine")) placedCount++;

    return placedCount > 0;
  } catch (e) {
    log("buildShrineSanctuary skipped:", e);
    return false;
  }
}

export const ENTITY_IDS = {
  SPRITE: "lucky:clover_sprite",
  TRAVELER: "lucky:wandering_traveler",
  GUARDIAN: "lucky:clover_guardian"
};

// 事件 10「流光经验泉」产出标定
const XP_FOUNTAIN_TICKS = 8;
const XP_FOUNTAIN_INTERVAL = 3;
const XP_FOUNTAIN_ORBS_MIN = 5;
const XP_FOUNTAIN_ORBS_MAX = 6;
export const XP_FOUNTAIN = {
  ticks: XP_FOUNTAIN_TICKS,
  interval: XP_FOUNTAIN_INTERVAL,
  orbsMin: XP_FOUNTAIN_ORBS_MIN,
  orbsMax: XP_FOUNTAIN_ORBS_MAX
};

const DEBUG_LOG = true;

export function log(...args) {
  if (DEBUG_LOG) console.log("[LuckyClover]", ...args);
}

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickDistinct(arr, n) {
  const pool = arr.slice();
  const out = [];
  while (out.length < n && pool.length > 0) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

export function spawnGiftItem(dimension, location, typeId, amount = 1) {
  const spawnPos = {
    x: location.x,
    y: location.y + 0.6,
    z: location.z
  };
  try {
    return dimension.spawnItem(new ItemStack(typeId, amount), spawnPos);
  } catch (e) {
    log(`spawnItem skipped: ${typeId} x${amount} (${e})`);
    return null;
  }
}

export function safeMessage(player, text) {
  try {
    player.sendMessage(text);
  } catch (e) {
    log("sendMessage failed:", e);
  }
}

export function safeActionBar(player, text) {
  try {
    player.onScreenDisplay?.setActionBar(text);
  } catch (e) {
    log("setActionBar failed:", e);
  }
}

export function safeRun(label, fn) {
  try {
    return fn();
  } catch (e) {
    log(`${label} failed: ${e}`);
    return null;
  }
}

export function safeSpawnEntity(dimension, typeId, location, nameTag) {
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

export function safeAddEffect(player, effectId, duration, options) {
  try {
    // 若玩家穿戴金叶守护套装（2件及以上），延长正面祝福持续时间 35%
    let finalDuration = duration;
    const positiveEffects = [
      "speed", "jump_boost", "haste", "night_vision", "regeneration",
      "absorption", "saturation", "slow_falling", "fire_resistance",
      "resistance", "strength", "village_hero"
    ];
    if (positiveEffects.includes(effectId) && getArmorSetCount(player, "golden_leaf") >= 2) {
      finalDuration = Math.floor(duration * 1.35);
    }
    player.addEffect(effectId, finalDuration, options);
    return true;
  } catch (e) {
    log("addEffect failed:", effectId, e);
    return false;
  }
}

export function safePlaySound(player, soundId, options) {
  try {
    player.playSound(soundId, options);
  } catch (e) {
    log("playSound failed:", soundId, e);
  }
}

export function safeSpawnParticle(dimension, particleId, location) {
  try {
    dimension.spawnParticle(particleId, location);
  } catch (e) {
    log("spawnParticle failed:", particleId, e);
  }
}

// ============================================================================
// 2. 玩家状态、护盾、冷却与图鉴持久化管理 (DynamicProperties + 内存回退)
// ============================================================================
const memoryStore = new Map();
const shieldCharges = new Map(); // player.id -> number of green/golden leaf shield charges
const cooldownMap = new Map();   // `${player.id}:${key}` -> expireTick

export function isOnCooldown(player, key) {
  const id = player?.id || "anon";
  const now = system.currentTick || 0;
  const exp = cooldownMap.get(`${id}:${key}`) || 0;
  return now < exp;
}

export function getCooldownRemainingSec(player, key) {
  const id = player?.id || "anon";
  const now = system.currentTick || 0;
  const exp = cooldownMap.get(`${id}:${key}`) || 0;
  return Math.max(0, Math.ceil((exp - now) / 20));
}

export function setCooldown(player, key, ticks) {
  const id = player?.id || "anon";
  const now = system.currentTick || 0;
  cooldownMap.set(`${id}:${key}`, now + ticks);
}

export function addLeafShield(player, charges = 1, maxCharges = 4) {
  const id = player?.id || "anon";
  const cur = shieldCharges.get(id) || 0;
  const next = Math.min(maxCharges, cur + charges);
  shieldCharges.set(id, next);
  return next;
}

export function getLeafShield(player) {
  return shieldCharges.get(player?.id || "anon") || 0;
}

export function consumeLeafShield(player) {
  const id = player?.id || "anon";
  const cur = shieldCharges.get(id) || 0;
  if (cur <= 0) return false;
  shieldCharges.set(id, cur - 1);
  return true;
}

function defaultAlmanacData() {
  return {
    tab: 0,
    plants: [],      // 已发现植物 ID
    events: [],      // 已触发奇遇 ID
    goldenEvents: [],// 已触发金叶奇迹 ID
    plantedCount: 0,
    harvestCount: 0,
    mutationCount: 0,
    mutations: [],   // 已培育出的变异品种
    equipment: [],   // 已制作/穿戴过的专属装备
    shrinesFound: 0,
    spritesMet: 0,
    travelersMet: 0,
    guardiansDefeated: 0,
    flawlessGuardian: false,
    claimedAchievements: []
  };
}

export function loadAlmanac(player) {
  const id = player?.id || "anon";
  try {
    const raw = player.getDynamicProperty("lucky:almanac_v2");
    if (typeof raw === "string" && raw.length > 2) {
      const parsed = JSON.parse(raw);
      return { ...defaultAlmanacData(), ...parsed };
    }
  } catch (e) {
    // 兼容不支持或未初始化 DynamicProperty 的环境
  }
  if (!memoryStore.has(id)) {
    memoryStore.set(id, defaultAlmanacData());
  }
  return memoryStore.get(id);
}

export function saveAlmanac(player, data) {
  const id = player?.id || "anon";
  memoryStore.set(id, data);
  try {
    player.setDynamicProperty("lucky:almanac_v2", JSON.stringify(data));
  } catch (e) {
    // 忽略测试环境无动态属性错误
  }
}

export function recordAlmanacProgress(player, type, value) {
  if (!player) return;
  const data = loadAlmanac(player);
  let firstUnlockMsg = null;

  if (type === "plant" && value && !data.plants.includes(value)) {
    data.plants.push(value);
    const clueMap = {
      [PLANT_BLOCK_IDS.THREE_LEAF]: "常分布于平原、草甸与森林边缘，可采集叶片与种子包",
      [PLANT_BLOCK_IDS.WILD_LUCKY]: "分布于草甸与繁花森林，采收后多数会进入休眠并再次生长",
      [PLANT_BLOCK_IDS.GOLD_VEIN]: "极稀有金色叶脉品种，偏好富饶草甸或使用金露培育剂变异",
      [PLANT_BLOCK_IDS.MORNING_DEW]: "偏好繁花森林、水源旁或雨后湿润环境的灵秀变异品种",
      [PLANT_BLOCK_IDS.MOONLIGHT]: "偏好夜间月光照射下的草甸与高地，蕴含浓郁自然精华",
      [PLANT_BLOCK_IDS.EMBER]: "耐受下界高温的奇异品种，生长于绯红/诡异菌岩或下界岩",
      [PLANT_BLOCK_IDS.STARLIGHT]: "末地虚空星辉孕育的传奇四叶草，蕴含命运碎片之力"
    };
    if (clueMap[value]) {
      firstUnlockMsg = `§2[图鉴登记] §a首次记录植物品种！生态线索：§f${clueMap[value]}`;
    }
  } else if (type === "event" && value && !data.events.includes(value)) {
    data.events.push(value);
  } else if (type === "golden_event" && value && !data.goldenEvents.includes(value)) {
    data.goldenEvents.push(value);
  } else if (type === "planted") {
    data.plantedCount = (data.plantedCount || 0) + 1;
  } else if (type === "harvest") {
    data.harvestCount = (data.harvestCount || 0) + 1;
  } else if (type === "mutation") {
    data.mutationCount = (data.mutationCount || 0) + 1;
    if (value && !data.mutations.includes(value)) {
      data.mutations.push(value);
    }
  } else if (type === "equipment" && value && !data.equipment.includes(value)) {
    data.equipment.push(value);
  } else if (type === "shrine") {
    data.shrinesFound = (data.shrinesFound || 0) + 1;
    if (data.shrinesFound === 1) {
      firstUnlockMsg = "§6[图鉴登记] §e首次发现【四叶草神龛】！向神龛提交普通四叶草、黄金露珠或自然精华可祈福或开启守护灵试炼。";
    }
  } else if (type === "sprite") {
    data.spritesMet = (data.spritesMet || 0) + 1;
  } else if (type === "traveler") {
    data.travelersMet = (data.travelersMet || 0) + 1;
  } else if (type === "guardian_win") {
    data.guardiansDefeated = (data.guardiansDefeated || 0) + 1;
    if (value === "flawless") data.flawlessGuardian = true;
  }

  saveAlmanac(player, data);
  if (firstUnlockMsg) {
    safeMessage(player, firstUnlockMsg);
  }
}

// ============================================================================
// 3. 掉落判定：生产路径（playerBreakBlock）与测试钩子都调用这一个函数
// ============================================================================
export function evaluateDrop(input) {
  const baseChance = GRASS_DROP_RATES[input.blockId];
  if (baseChance === undefined) return { applicable: false };

  if (input.mainhandTypeId === "minecraft:shears") return { applicable: true, blocked: "shears" };
  if (input.hasSilkTouch) return { applicable: true, blocked: "silk_touch" };

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
// 4. 装备套装检测辅助函数
// ============================================================================
export function getEquippedArmorIds(player) {
  try {
    const eq = player.getComponent("minecraft:equippable");
    if (!eq) return [];
    return [
      eq.getEquipment(EquipmentSlot.Head)?.typeId,
      eq.getEquipment(EquipmentSlot.Chest)?.typeId,
      eq.getEquipment(EquipmentSlot.Legs)?.typeId,
      eq.getEquipment(EquipmentSlot.Feet)?.typeId
    ].filter(Boolean);
  } catch (e) {
    return [];
  }
}

export function getArmorSetCount(player, prefix) {
  const ids = getEquippedArmorIds(player);
  const targetPrefix = `lucky:${prefix}_`;
  return ids.filter((id) => id && id.startsWith(targetPrefix)).length;
}

// ============================================================================
// 5. 完整 40 种四叶草奇遇事件池（保留原 24 种 + 新增 16 种，总基础权重严格为 1000）
//    第一类：自然馈赠（10种，总重 350）
//    第二类：生灵奇遇（10种，总重 250）
//    第三类：自然祝福（10种，总重 250）
//    第四类：调皮妖精与命运反转（10种，总重 150）
// ============================================================================
export const CLOVER_EVENTS = [
  // -------------------- 第一片叶：自然馈赠（权重 350） --------------------
  {
    id: "event_01_morning_bread",
    name: "晨露麦香",
    leaf: 1,
    category: "普通奖励",
    weight: 50,
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
    name: "林间钱袋",
    leaf: 1,
    category: "普通奖励",
    weight: 45,
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
    name: "远方花苗",
    leaf: 1,
    category: "普通奖励",
    weight: 42,
    execute(player, dim, loc) {
      const rarePlants = [
        "minecraft:cherry_sapling",
        "minecraft:pale_oak_sapling",
        "minecraft:open_eyeblossom",
        "minecraft:torchflower",
        "minecraft:pitcher_plant"
      ];
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
    name: "矿工补给包",
    leaf: 1,
    category: "普通奖励",
    weight: 40,
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
    name: "林间下午茶",
    leaf: 1,
    category: "普通奖励",
    weight: 35,
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
    name: "璀璨晶芒",
    leaf: 1,
    category: "特殊事件",
    weight: 22,
    execute(player, dim, loc) {
      spawnGiftItem(dim, loc, "minecraft:diamond", 1);
      spawnGiftItem(dim, loc, "minecraft:amethyst_shard", 2);
      safeSpawnParticle(dim, "minecraft:totem_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "chime.amethyst_block", { pitch: 1.2, volume: 1.0 });
      safeMessage(player, "§b§l[自然奇迹] 四叶草折射出璀璨的晶体光芒，凝结出了一颗钻石！");
    }
  },
  {
    id: "event_25_morning_dew_condense",
    name: "晨露凝珠",
    leaf: 1,
    category: "特殊事件",
    weight: 34,
    execute(player, dim, loc) {
      spawnGiftItem(dim, loc, ITEM_IDS.MORNING_DEW, randInt(1, 2));
      spawnGiftItem(dim, loc, ITEM_IDS.LUCKY_POLLEN, randInt(1, 2));
      if (Math.random() < 0.35) {
        spawnGiftItem(dim, loc, ITEM_IDS.SEED_PACKET, 1);
      }
      safeSpawnParticle(dim, PARTICLE_IDS.MORNING_DEW, { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "random.orb", { pitch: 1.4, volume: 0.9 });
      safeMessage(player, "§b[自然馈赠·晨露凝珠] 四叶草上方凝聚出晶莹露珠，你获得了晨露珠与幸运花粉！");
    }
  },
  {
    id: "event_26_seed_rain",
    name: "种子雨",
    leaf: 1,
    category: "普通奖励",
    weight: 32,
    execute(player, dim, loc) {
      const seeds = [
        "minecraft:wheat_seeds",
        "minecraft:pumpkin_seeds",
        "minecraft:melon_seeds",
        "minecraft:beetroot_seeds",
        "minecraft:torchflower_seeds"
      ];
      spawnGiftItem(dim, loc, pickRandom(seeds), randInt(2, 4));
      spawnGiftItem(dim, loc, ITEM_IDS.SEED_PACKET, randInt(1, 2));
      safeSpawnParticle(dim, "minecraft:crop_growth_emitter", { x: loc.x, y: loc.y + 1.5, z: loc.z });
      safePlaySound(player, "item.bone_meal.use", { pitch: 1.2, volume: 1.0 });
      safeMessage(player, "§a[自然馈赠·种子雨] 漫天种子随微风飘落，你收获了四叶草种子包与农作物良种！");
    }
  },
  {
    id: "event_27_gardener_toolbag",
    name: "园丁遗失的工具袋",
    leaf: 1,
    category: "普通奖励",
    weight: 28,
    execute(player, dim, loc) {
      spawnGiftItem(dim, loc, "minecraft:bone_meal", randInt(4, 6));
      spawnGiftItem(dim, loc, ITEM_IDS.CLOVER_LEAF, randInt(2, 4));
      spawnGiftItem(dim, loc, "minecraft:flower_pot", 1);
      if (Math.random() < 0.25) {
        spawnGiftItem(dim, loc, PLANT_BLOCK_IDS.THREE_LEAF, 2);
      }
      safeSpawnParticle(dim, "minecraft:wax_on_particle", loc);
      safePlaySound(player, "item.bundle.insert", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, "§a[自然馈赠·园丁工具袋] 你发现了园丁遗落的绒布袋，装有骨粉、叶片与精致花盆！");
    }
  },
  {
    id: "event_28_leaf_trail_treasure",
    name: "叶痕寻宝",
    leaf: 1,
    category: "特殊事件",
    weight: 22,
    execute(player, dim, loc) {
      const angle = Math.random() * Math.PI * 2;
      const dist = randInt(6, 10);
      const targetPos = {
        x: Math.floor(loc.x + Math.cos(angle) * dist) + 0.5,
        y: Math.floor(loc.y),
        z: Math.floor(loc.z + Math.sin(angle) * dist) + 0.5
      };
      safePlaySound(player, "chime.amethyst_block", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, "§a§l[自然馈赠·叶痕寻宝] §a四叶草化作一道延伸向远处的绿叶轨迹，快沿着粒子线索寻找宝藏点！");

      let step = 0;
      const runId = system.runInterval(() => {
        step++;
        if (step > 25 || !player.isValid()) {
          system.clearRun(runId);
          return;
        }
        const pLoc = player.location;
        const pDim = player.dimension;
        for (let i = 1; i <= 5; i++) {
          const t = i / 5;
          safeSpawnParticle(pDim, "minecraft:villager_happy", {
            x: pLoc.x + (targetPos.x - pLoc.x) * t,
            y: pLoc.y + 0.5,
            z: pLoc.z + (targetPos.z - pLoc.z) * t
          });
        }
        const d = Math.hypot(pLoc.x - targetPos.x, pLoc.z - targetPos.z);
        if (d <= 2.8 || step === 25) {
          system.clearRun(runId);
          const dropLoc = d <= 2.8 ? targetPos : pLoc;
          spawnGiftItem(pDim, dropLoc, ITEM_IDS.NATURE_ESSENCE, 1);
          spawnGiftItem(pDim, dropLoc, ITEM_IDS.GOLDEN_DEW, 1);
          spawnGiftItem(pDim, dropLoc, ITEM_IDS.LUCKY_POLLEN, 2);
          safeSpawnParticle(pDim, "minecraft:totem_particle", { x: dropLoc.x, y: dropLoc.y + 1, z: dropLoc.z });
          safePlaySound(player, "random.levelup", { pitch: 1.3, volume: 1.0 });
          safeMessage(player, "§6[叶痕寻宝] 你顺着叶痕找到了隐藏的自然秘宝：自然精华与黄金露珠！");
        }
      }, 10);
    }
  },

  // -------------------- 第二片叶：生灵奇遇（权重 250） --------------------
  {
    id: "event_07_grateful_bee",
    name: "报恩蜜蜂",
    leaf: 2,
    category: "生灵事件",
    weight: 32,
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
    name: "福气小猪",
    leaf: 2,
    category: "生灵事件",
    weight: 28,
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
    name: "寻宝青蛙",
    leaf: 2,
    category: "生灵事件",
    weight: 28,
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
    name: "流光经验泉",
    leaf: 2,
    category: "生灵事件",
    weight: 28,
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
    name: "行商遗袋",
    leaf: 2,
    category: "生灵事件",
    weight: 26,
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
    name: "悦灵圆舞曲",
    leaf: 2,
    category: "特殊事件",
    weight: 18,
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
  {
    id: "event_29_fox_guide",
    name: "狐狸引路",
    leaf: 2,
    category: "生灵事件",
    weight: 24,
    execute(player, dim, loc) {
      const fox = safeSpawnEntity(dim, "minecraft:fox", { x: loc.x + 1.5, y: loc.y, z: loc.z + 1.5 }, "§6引路灵狐");
      safePlaySound(player, "mob.fox.ambient", { pitch: 1.2, volume: 1.0 });
      safeMessage(player, "§e[生灵奇遇·狐狸引路] 一只通人性的灵狐衔着草叶出现，正引导你前往藏宝草丛！");
      let ticks = 0;
      const runId = system.runInterval(() => {
        ticks++;
        if (ticks > 8 || !player.isValid()) {
          system.clearRun(runId);
          if (fox && fox.isValid()) {
            const fLoc = fox.location;
            spawnGiftItem(fox.dimension, fLoc, ITEM_IDS.MORNING_DEW, 1);
            spawnGiftItem(fox.dimension, fLoc, ITEM_IDS.SEED_PACKET, 1);
            spawnGiftItem(fox.dimension, fLoc, "minecraft:emerald", 2);
            safeSpawnParticle(fox.dimension, "minecraft:villager_happy", fLoc);
            safeMessage(player, "§e[狐狸引路] 灵狐在草丛边刨出了晨露珠、四叶草种子包与绿宝石！");
            try { fox.remove(); } catch (e) {}
          } else if (player.isValid()) {
            spawnGiftItem(player.dimension, player.location, ITEM_IDS.MORNING_DEW, 1);
            spawnGiftItem(player.dimension, player.location, ITEM_IDS.SEED_PACKET, 1);
          }
          return;
        }
        if (fox && fox.isValid()) {
          safeSpawnParticle(fox.dimension, "minecraft:villager_happy", fox.location);
        }
      }, 20);
    }
  },
  {
    id: "event_30_bee_migration",
    name: "蜂群迁徙",
    leaf: 2,
    category: "生灵事件",
    weight: 24,
    execute(player, dim, loc) {
      const bees = [];
      for (let i = 0; i < 2; i++) {
        const b = safeSpawnEntity(dim, "minecraft:bee", { x: loc.x + (i === 0 ? 1.2 : -1.2), y: loc.y + 1.3, z: loc.z }, "§e迁徙花蜂");
        if (b) bees.push(b);
      }
      spawnGiftItem(dim, loc, ITEM_IDS.LUCKY_POLLEN, randInt(2, 3));
      spawnGiftItem(dim, loc, "minecraft:honey_bottle", 1);
      safeSpawnParticle(dim, "minecraft:crop_growth_emitter", { x: loc.x, y: loc.y + 1.2, z: loc.z });
      safePlaySound(player, "mob.bee.pollinate", { pitch: 1.2, volume: 1.0 });
      safeMessage(player, "§e[生灵奇遇·蜂群迁徙] 迁徙的花蜂群掠过身旁，为你洒下了饱满的幸运花粉与蜂蜜！");
      system.runTimeout(() => {
        for (const b of bees) {
          try { if (b && b.isValid()) b.remove(); } catch (e) {}
        }
      }, 220);
    }
  },
  {
    id: "event_31_clover_sprite_companion",
    name: "草灵的陪伴",
    leaf: 2,
    category: "特殊事件",
    weight: 22,
    execute(player, dim, loc) {
      const sprite = safeSpawnEntity(dim, ENTITY_IDS.SPRITE, { x: loc.x + 1, y: loc.y + 1.2, z: loc.z + 1 }, "§a四叶草守护小草灵");
      safePlayAnimation(sprite, "animation.clover_sprite.cast");
      safeSpawnParticle(dim, PARTICLE_IDS.NATURE_SWIRL, { x: loc.x + 1, y: loc.y + 1.2, z: loc.z + 1 });
      recordAlmanacProgress(player, "sprite");
      safeAddEffect(player, "regeneration", 200, { amplifier: 0, showParticles: true });
      safeSpawnParticle(dim, "minecraft:villager_happy", { x: loc.x, y: loc.y + 1.5, z: loc.z });
      safePlaySound(player, "mob.allay.ambient_without_item", { pitch: 1.3, volume: 1.0 });
      safeMessage(player, "§a§l[生灵奇遇·草灵的陪伴] §a一只友善的四叶草精灵围绕着你翩翩起舞，为你带来自然治愈！");

      let step = 0;
      const runId = system.runInterval(() => {
        step++;
        if (step > 10 || !player.isValid()) {
          system.clearRun(runId);
          if (player.isValid()) {
            const pLoc = player.location;
            const pDim = player.dimension;
            spawnGiftItem(pDim, pLoc, ITEM_IDS.NATURE_ESSENCE, 1);
            spawnGiftItem(pDim, pLoc, ITEM_IDS.CLOVER_LEAF, 2);
            safeMessage(player, "§a[草灵的陪伴] 四叶草精灵告别前，为你留下了一份珍贵的【自然精华】与叶片！");
          }
          try { if (sprite && sprite.isValid()) sprite.remove(); } catch (e) {}
          return;
        }
        if (sprite && sprite.isValid()) {
          safeSpawnParticle(sprite.dimension, "minecraft:villager_happy", sprite.location);
        }
      }, 20);
    }
  },
  {
    id: "event_32_lost_traveler",
    name: "迷路的旅人",
    leaf: 2,
    category: "特殊事件",
    weight: 20,
    execute(player, dim, loc) {
      const traveler = safeSpawnEntity(dim, ENTITY_IDS.TRAVELER, { x: loc.x + 1.5, y: loc.y, z: loc.z + 1.5 }, "§e迷路的草药旅人 (右键交互领礼)");
      recordAlmanacProgress(player, "traveler");
      safeSpawnParticle(dim, "minecraft:villager_happy", { x: loc.x + 1.5, y: loc.y + 1, z: loc.z + 1.5 });
      safePlaySound(player, "mob.wanderingtrader.yes", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, "§e§l[生灵奇遇·迷路的旅人] §e一位背着草药行囊的旅人出现在你身旁！右键与他互动可自选回礼（潜行右键切换礼盒类型）！");
      // 若玩家未在 30 秒内手动交互，自动赠送一份园艺培育礼盒并离开
      system.runTimeout(() => {
        try {
          if (traveler && traveler.isValid()) {
            if (player && player.isValid()) {
              spawnGiftItem(player.dimension, player.location, ITEM_IDS.SEED_PACKET, 1);
              spawnGiftItem(player.dimension, player.location, ITEM_IDS.GOLDEN_DEW, 1);
              safeMessage(player, "§e[迷路的旅人] 旅人踏上归途前，将一份四叶草种子包与黄金露珠留在了你身边！");
            }
            traveler.remove();
          }
        } catch (e) {}
      }, 600);
    }
  },

  // -------------------- 第三片叶：自然祝福（权重 250） --------------------
  {
    id: "event_13_wind_blessing",
    name: "清风缠足",
    leaf: 3,
    category: "祝福事件",
    weight: 32,
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
    name: "大地亲和",
    leaf: 3,
    category: "祝福事件",
    weight: 28,
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
    name: "森林甘霖",
    leaf: 3,
    category: "祝福事件",
    weight: 28,
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
    name: "清风护体",
    leaf: 3,
    category: "祝福事件",
    weight: 26,
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
    name: "繁花绽放",
    leaf: 3,
    category: "祝福事件",
    weight: 24,
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
            } catch (e) {}
          }
        }
      }
      if (bloomCount === 0) {
        spawnGiftItem(dim, loc, pickRandom(flowers), 3);
      }
      safeSpawnParticle(dim, "minecraft:crop_growth_emitter", loc);
      safePlaySound(player, "item.bone_meal.use", { pitch: 1.1, volume: 1.0 });
      safeMessage(player, `§b[自然祝福] 四叶草灵气席卷四周，身旁的野草瞬间绽放出鲜花！（绽放 ${bloomCount} 处）`);
    }
  },
  {
    id: "event_18_artisan_mend",
    name: "巧匠修缮",
    leaf: 3,
    category: "祝福事件",
    weight: 24,
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
        repairedItemName = item.typeId.replace("minecraft:", "").replace("lucky:", "");
        return true;
      };

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
  {
    id: "event_33_moss_light_step",
    name: "苔足轻行",
    leaf: 3,
    category: "祝福事件",
    weight: 24,
    execute(player, dim, loc) {
      safeAddEffect(player, "speed", 600, { amplifier: 1, showParticles: false });
      safePlaySound(player, "step.moss", { pitch: 1.2, volume: 1.0 });
      safeMessage(player, "§b[自然祝福·苔足轻行] 自然之力托起你的步伐，行走间绿叶随行，移动更加轻盈！");
      let t = 0;
      const runId = system.runInterval(() => {
        t++;
        if (t > 15 || !player.isValid()) {
          system.clearRun(runId);
          return;
        }
        safeSpawnParticle(player.dimension, "minecraft:villager_happy", player.location);
      }, 20);
    }
  },
  {
    id: "event_34_ore_echo",
    name: "矿脉回响",
    leaf: 3,
    category: "祝福事件",
    weight: 22,
    execute(player, dim, loc) {
      triggerOreEchoScan(player, dim, loc, 8);
    }
  },
  {
    id: "event_35_guardian_green_leaf",
    name: "守护绿叶",
    leaf: 3,
    category: "祝福事件",
    weight: 22,
    execute(player, dim, loc) {
      const charges = addLeafShield(player, 2, 4);
      safeAddEffect(player, "resistance", 600, { amplifier: 0, showParticles: true });
      safeSpawnParticle(dim, "minecraft:totem_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "item.totem.use", { pitch: 1.4, volume: 0.7 });
      safeMessage(player, `§a§l[自然祝福·守护绿叶] §a四片翡翠绿叶环绕周身，为你提供下次受击碎叶抵伤护盾（当前护盾层数：${charges}）！`);
    }
  },
  {
    id: "event_36_spring_revival",
    name: "春日复苏",
    leaf: 3,
    category: "祝福事件",
    weight: 20,
    execute(player, dim, loc) {
      const grown = advanceNearbyCrops(dim, loc, 5);
      spawnGiftItem(dim, loc, ITEM_IDS.LUCKY_POLLEN, 2);
      safeSpawnParticle(dim, "minecraft:crop_growth_emitter", loc);
      safePlaySound(player, "item.bone_meal.use", { pitch: 1.15, volume: 1.0 });
      safeMessage(player, `§b[自然祝福·春日复苏] 春风吹拂四周花园，促进了 ${grown} 株四叶草或农作物成长，并凝结出 2 份幸运花粉！`);
    }
  },

  // -------------------- 第四片叶：调皮妖精与命运反转（权重 150） --------------------
  {
    id: "event_19_balloon_float",
    name: "失重气球",
    leaf: 4,
    category: "恶作剧事件",
    weight: 18,
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
    name: "黏糊史莱姆",
    leaf: 4,
    category: "恶作剧事件",
    weight: 16,
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
    name: "愚人黄油",
    leaf: 4,
    category: "恶作剧事件",
    weight: 16,
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
    name: "惊魂假烟花",
    leaf: 4,
    category: "恶作剧事件",
    weight: 16,
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
    name: "啃叶小害虫",
    leaf: 4,
    category: "恶作剧事件",
    weight: 15,
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
    name: "环保绿帽",
    leaf: 4,
    category: "恶作剧事件",
    weight: 13,
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
  },
  {
    id: "event_37_unlucky_exchange",
    name: "倒霉交换",
    leaf: 4,
    category: "恶作剧事件",
    weight: 15,
    execute(player, dim, loc) {
      const hasDestinySet = getArmorSetCount(player, "destiny") >= 4;
      if (!hasDestinySet) {
        safeAddEffect(player, "slowness", 80, { amplifier: 1, showParticles: true });
      } else {
        safeAddEffect(player, "speed", 160, { amplifier: 1, showParticles: true });
      }
      safePlaySound(player, "mob.witch.ambient", { pitch: 1.2, volume: 0.9 });
      safeMessage(player, "§d[命运反转·倒霉交换] 调皮妖精短暂绊住了你的脚步……但紧接着塞给你一份补偿礼！");
      system.runTimeout(() => {
        if (!player.isValid()) return;
        const pLoc = player.location;
        const pDim = player.dimension;
        spawnGiftItem(pDim, pLoc, ITEM_IDS.GOLDEN_DEW, 1);
        spawnGiftItem(pDim, pLoc, ITEM_IDS.MORNING_DEW, 1);
        spawnGiftItem(pDim, pLoc, ITEM_IDS.LUCKY_POLLEN, 2);
        safeSpawnParticle(pDim, "minecraft:villager_happy", pLoc);
        safePlaySound(player, "random.orb", { pitch: 1.3, volume: 1.0 });
        safeMessage(player, "§a[倒霉交换·反转] 你获得了黄金露珠、晨露珠与双份幸运花粉作为补偿！");
      }, 60);
    }
  },
  {
    id: "event_38_runaway_chest",
    name: "会逃跑的宝箱",
    leaf: 4,
    category: "恶作剧事件",
    weight: 14,
    execute(player, dim, loc) {
      const chestPos = { x: loc.x + 2.5, y: loc.y + 0.5, z: loc.z + 2.5 };
      safeSpawnParticle(dim, "minecraft:totem_particle", chestPos);
      safePlaySound(player, "random.chestopen", { pitch: 1.3, volume: 1.0 });
      safeMessage(player, "§d[调皮妖精·会逃跑的宝箱] 前方浮现出一只闪闪发光的宝箱幻影！快靠近它！");
      system.runTimeout(() => {
        if (!player.isValid()) return;
        const pLoc = player.location;
        const pDim = player.dimension;
        safeSpawnParticle(pDim, "minecraft:crop_growth_emitter", pLoc);
        safePlaySound(player, "random.pop", { pitch: 1.2, volume: 1.0 });
        spawnGiftItem(pDim, pLoc, ITEM_IDS.CLOVER_LEAF, 3);
        spawnGiftItem(pDim, pLoc, "minecraft:emerald", randInt(2, 4));
        spawnGiftItem(pDim, pLoc, ITEM_IDS.LUCKY_POLLEN, 1);
        safeMessage(player, "§d[会逃跑的宝箱] 噗！宝箱幻影化作漫天飞叶散开，留下了绿宝石、四叶草叶片与花粉！");
      }, 45);
    }
  },
  {
    id: "event_39_rabbit_stampede",
    name: "兔群大暴走",
    leaf: 4,
    category: "恶作剧事件",
    weight: 14,
    execute(player, dim, loc) {
      const rabbits = [];
      for (let i = 0; i < 3; i++) {
        const r = safeSpawnEntity(dim, "minecraft:rabbit", {
          x: loc.x + (i - 1) * 1.2,
          y: loc.y + 0.5,
          z: loc.z + (i % 2 === 0 ? 1 : -1)
        }, "§e暴走幸运兔");
        if (r) rabbits.push(r);
      }
      spawnGiftItem(dim, loc, "minecraft:golden_carrot", 2);
      spawnGiftItem(dim, loc, "minecraft:rabbit_foot", 1);
      spawnGiftItem(dim, loc, ITEM_IDS.CLOVER_LEAF, 2);
      safeSpawnParticle(dim, "minecraft:heart_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "mob.rabbit.hop", { pitch: 1.2, volume: 1.0 });
      safeMessage(player, "§d[调皮妖精·兔群大暴走] 一群欢脱的幸运兔蹦跳着掠过，留下了金胡萝卜与幸运兔脚！");
      system.runTimeout(() => {
        for (const r of rabbits) {
          try { if (r && r.isValid()) r.remove(); } catch (e) {}
        }
      }, 200);
    }
  },
  {
    id: "event_40_price_of_luck",
    name: "好运的代价",
    leaf: 4,
    category: "特殊事件",
    weight: 13,
    execute(player, dim, loc) {
      const hasDestinySet = getArmorSetCount(player, "destiny") >= 4;
      if (!hasDestinySet) {
        safeAddEffect(player, "weakness", 100, { amplifier: 0, showParticles: true });
      } else {
        safeAddEffect(player, "strength", 200, { amplifier: 1, showParticles: true });
      }
      safePlaySound(player, "mob.wither.spawn", { pitch: 1.8, volume: 0.5 });
      safeMessage(player, "§d§l[命运试炼·好运的代价] §d命运天平晃动！撑过接下来的小型试炼即可赢得高阶命运碎片！");

      const slime = safeSpawnEntity(dim, "minecraft:slime", { x: loc.x + 2, y: loc.y + 0.5, z: loc.z }, "§d命运试炼史莱姆");
      system.runTimeout(() => {
        if (!player.isValid()) return;
        const pLoc = player.location;
        const pDim = player.dimension;
        spawnGiftItem(pDim, pLoc, ITEM_IDS.DESTINY_SHARD, 1);
        spawnGiftItem(pDim, pLoc, ITEM_IDS.NATURE_ESSENCE, 1);
        safeSpawnParticle(pDim, "minecraft:totem_particle", { x: pLoc.x, y: pLoc.y + 1, z: pLoc.z });
        safePlaySound(player, "random.levelup", { pitch: 1.25, volume: 1.0 });
        safeMessage(player, "§5§l[好运的代价·试炼完成] §d你成功跨越了命运波动，获得了珍稀的【命运碎片】与【自然精华】！");
        try { if (slime && slime.isValid()) slime.remove(); } catch (e) {}
      }, 80);
    }
  }
];

// ============================================================================
// 6. 金叶四叶草专属新增 5 大奇迹（第 6.1 节）
// ============================================================================
export const GOLDEN_EXCLUSIVE_EVENTS = [
  {
    id: "event_G1_golden_harvest",
    name: "黄金丰收",
    leaf: 1,
    weight: 35,
    execute(player, dim, loc) {
      const grown = advanceNearbyCrops(dim, loc, 6);
      spawnGiftItem(dim, loc, "minecraft:golden_carrot", 3);
      spawnGiftItem(dim, loc, ITEM_IDS.SEED_PACKET, 2);
      spawnGiftItem(dim, loc, ITEM_IDS.GOLDEN_DEW, 1);
      safeSpawnParticle(dim, "minecraft:crop_growth_emitter", loc);
      safePlaySound(player, "item.bone_meal.use", { pitch: 1.2, volume: 1.0 });
      safeMessage(player, `§6§l[金叶奇迹·黄金丰收] §e金色灵雨滋润大地，催熟周围 ${grown} 株作物，并赐予黄金露珠与种子包！`);
    }
  },
  {
    id: "event_G2_sprite_supreme_gift",
    name: "精灵的高级馈赠",
    leaf: 2,
    weight: 30,
    execute(player, dim, loc) {
      const sprite = safeSpawnEntity(dim, ENTITY_IDS.SPRITE, { x: loc.x + 1, y: loc.y + 1.4, z: loc.z }, "§6金叶祝祷草灵");
      recordAlmanacProgress(player, "sprite");
      spawnGiftItem(dim, loc, ITEM_IDS.GOLDEN_DEW, 2);
      spawnGiftItem(dim, loc, ITEM_IDS.NATURE_ESSENCE, 1);
      spawnGiftItem(dim, loc, ITEM_IDS.LUCKY_POLLEN, 2);
      safeSpawnParticle(dim, "minecraft:totem_particle", { x: loc.x, y: loc.y + 1.2, z: loc.z });
      safePlaySound(player, "mob.allay.item_given", { pitch: 1.25, volume: 1.0 });
      safeMessage(player, "§6§l[金叶奇迹·精灵的高级馈赠] §e金叶草灵降临，献上黄金露珠、自然精华与幸运花粉！");
      system.runTimeout(() => {
        try { if (sprite && sprite.isValid()) sprite.remove(); } catch (e) {}
      }, 200);
    }
  },
  {
    id: "event_G3_lost_treasure",
    name: "失落宝藏",
    leaf: 1,
    weight: 28,
    execute(player, dim, loc) {
      spawnGiftItem(dim, loc, "minecraft:emerald", randInt(4, 7));
      spawnGiftItem(dim, loc, "minecraft:gold_ingot", randInt(2, 4));
      spawnGiftItem(dim, loc, ITEM_IDS.NATURE_ESSENCE, 1);
      safeSpawnParticle(dim, "minecraft:totem_particle", { x: loc.x, y: loc.y + 1, z: loc.z });
      safePlaySound(player, "chime.amethyst_block", { pitch: 1.3, volume: 1.0 });
      safeMessage(player, "§6§l[金叶奇迹·失落宝藏] §e金叶四叶草为你开启了林间失落的宝匣，涌出绿宝石、金锭与自然精华！");
    }
  },
  {
    id: "event_G4_golden_aegis",
    name: "黄金护佑",
    leaf: 3,
    weight: 30,
    execute(player, dim, loc) {
      const charges = addLeafShield(player, 3, 4);
      safeAddEffect(player, "absorption", 1800, { amplifier: 2, showParticles: true });
      safeAddEffect(player, "resistance", 900, { amplifier: 0, showParticles: true });
      safeAddEffect(player, "regeneration", 300, { amplifier: 1, showParticles: true });
      safeSpawnParticle(dim, "minecraft:totem_particle", { x: loc.x, y: loc.y + 1.2, z: loc.z });
      safePlaySound(player, "item.totem.use", { pitch: 1.3, volume: 0.8 });
      safeMessage(player, `§6§l[金叶奇迹·黄金护佑] §e金叶壁垒加身！获得 3 层守护叶盾（当前 ${charges} 层）、吸收 III 与抗性提升！`);
    }
  },
  {
    id: "event_G5_moonlight_guidance",
    name: "月辉指引",
    leaf: 3,
    weight: 20,
    execute(player, dim, loc) {
      spawnGiftItem(dim, loc, ITEM_IDS.MORNING_DEW, 2);
      spawnGiftItem(dim, loc, ITEM_IDS.GOLDEN_DEW, 1);
      // 在玩家前方合适地面生成一株稀有野生植物（月辉或金脉四叶草）作为指引奇遇！
      try {
        const bx = Math.floor(loc.x) + 2;
        const by = Math.floor(loc.y);
        const bz = Math.floor(loc.z) + 2;
        const targetBlock = dim.getBlock({ x: bx, y: by, z: bz });
        if (targetBlock && (targetBlock.typeId === "minecraft:air" || targetBlock.typeId === "minecraft:short_grass")) {
          const rareBlockId = Math.random() < 0.5 ? PLANT_BLOCK_IDS.MOONLIGHT : PLANT_BLOCK_IDS.GOLD_VEIN;
          targetBlock.setType(rareBlockId);
          safeSpawnParticle(dim, "minecraft:endrod", { x: bx + 0.5, y: by + 0.8, z: bz + 0.5 });
        }
      } catch (e) {}
      safePlaySound(player, "block.beacon.activate", { pitch: 1.4, volume: 0.8 });
      safeMessage(player, "§9§l[金叶奇迹·月辉指引] §b星月之光在你身旁凝结出一株珍稀变异四叶草植株，并赐予露珠！");
    }
  }
];

export const TOTAL_WEIGHT = CLOVER_EVENTS.reduce((sum, ev) => sum + ev.weight, 0);

export function rollCloverEvent(player = null) {
  // 支持环境触发权重微调与命运行者套装加成；无参数调用时严格按基础权重抽取
  if (!player) {
    let roll = Math.random() * TOTAL_WEIGHT;
    for (const ev of CLOVER_EVENTS) {
      if (roll < ev.weight) return ev;
      roll -= ev.weight;
    }
    return CLOVER_EVENTS[0];
  }

  const destinyCount = getArmorSetCount(player, "destiny");
  const isUnderground = (player.location?.y ?? 64) < 48;
  const weightedPool = CLOVER_EVENTS.map((ev) => {
    let w = ev.weight;
    if (isUnderground && (ev.id === "event_34_ore_echo" || ev.id === "event_04_miner_pocket")) {
      w *= 1.6;
    }
    if (destinyCount >= 4 && ev.category === "特殊事件") {
      w *= 1.4;
    }
    return { ev, w };
  });
  const sumW = weightedPool.reduce((s, item) => s + item.w, 0);
  let roll = Math.random() * sumW;
  for (const item of weightedPool) {
    if (roll < item.w) return item.ev;
    roll -= item.w;
  }
  return CLOVER_EVENTS[0];
}

export const GOLDEN_BOOSTED_EVENTS = ["event_06_emerald_diamond_glint", "event_12_allay_melody"];
const POSITIVE_EVENTS = [
  ...CLOVER_EVENTS.filter((ev) => ev.leaf !== 4),
  ...GOLDEN_EXCLUSIVE_EVENTS
];
const POSITIVE_WEIGHT = POSITIVE_EVENTS.reduce(
  (sum, ev) => sum + ev.weight * (GOLDEN_BOOSTED_EVENTS.includes(ev.id) ? 2 : 1),
  0
);

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

// ============================================================================
// 7. 消耗玩家手中的 1 件指定物品
// ============================================================================
export function consumeOneOf(player, itemId) {
  if (player.getGameMode() === GameMode.creative) return true;

  const equippable = player.getComponent("minecraft:equippable");
  const mainhand = equippable?.getEquipment(EquipmentSlot.Mainhand);
  if (mainhand && mainhand.typeId === itemId) {
    if (mainhand.amount > 1) {
      mainhand.amount -= 1;
      safeRun("consume mainhand", () => equippable.setEquipment(EquipmentSlot.Mainhand, mainhand));
    } else {
      safeRun("consume mainhand empty", () => equippable.setEquipment(EquipmentSlot.Mainhand, undefined));
    }
    return true;
  }

  const offhand = equippable?.getEquipment(EquipmentSlot.Offhand);
  if (offhand && offhand.typeId === itemId) {
    if (offhand.amount > 1) {
      offhand.amount -= 1;
      safeRun("consume offhand", () => equippable.setEquipment(EquipmentSlot.Offhand, offhand));
    } else {
      safeRun("consume offhand empty", () => equippable.setEquipment(EquipmentSlot.Offhand, undefined));
    }
    return true;
  }

  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return false;
  for (let i = 0; i < inv.size; i++) {
    const item = inv.getItem(i);
    if (item && item.typeId === itemId) {
      if (item.amount > 1) {
        item.amount -= 1;
        safeRun("consume inv", () => inv.setItem(i, item));
      } else {
        safeRun("consume inv empty", () => inv.setItem(i, undefined));
      }
      return true;
    }
  }
  return false;
}

export function consumeOneClover(player) {
  return consumeOneOf(player, CLOVER_ITEM_ID);
}

// ============================================================================
// 8. 副手持有四叶草祝福 & 套装常驻被动效果
// ============================================================================
export const OFFHAND_BLESSING_EFFECT = "village_hero";
export const OFFHAND_BLESSING_AMPLIFIER = 0;
export const OFFHAND_LUCK_INTERVAL_TICKS = 100;
export const OFFHAND_LUCK_DURATION_TICKS = 120;

export function refreshOffhandLuck(player) {
  try {
    const equippable = player.getComponent("minecraft:equippable");
    const offhand = equippable?.getEquipment(EquipmentSlot.Offhand);
    if (offhand && (offhand.typeId === CLOVER_ITEM_ID || offhand.typeId === GOLDEN_CLOVER_ITEM_ID)) {
      safeAddEffect(player, OFFHAND_BLESSING_EFFECT, OFFHAND_LUCK_DURATION_TICKS, {
        amplifier: offhand.typeId === GOLDEN_CLOVER_ITEM_ID ? 1 : OFFHAND_BLESSING_AMPLIFIER,
        showParticles: false
      });
      return true;
    }
    if (offhand && offhand.typeId === ITEM_IDS.GREEN_AMULET) {
      safeAddEffect(player, "resistance", OFFHAND_LUCK_DURATION_TICKS, {
        amplifier: 0,
        showParticles: false
      });
      return true;
    }
  } catch (e) {
    log("refreshOffhandLuck failed:", e);
  }
  return false;
}

// ============================================================================
// 9. 野生植物采收、休眠重生、四阶段培育与环境变异系统
// ============================================================================

// ============================================================================
// 8.5 既有世界的自然播种：老存档里已经生成过的区块不会再有 feature 生成，
//     这里用一个很轻的运行时播种补上，让玩家在草地上探索时能遇到野生四叶草。
// ============================================================================
// 自然播种用的可种植土（lucky_core 内独立定义，避免依赖 main.js 的 PLANTABLE_SOILS）
const NATURAL_SOILS = new Set([
  "minecraft:grass_block",
  "minecraft:dirt",
  "minecraft:coarse_dirt",
  "minecraft:dirt_with_roots",
  "minecraft:farmland",
  "minecraft:podzol",
  "minecraft:moss_block",
  "minecraft:mud",
  "minecraft:crimson_nylium",
  "minecraft:warped_nylium",
  "minecraft:end_stone"
]);

const NATURAL_REPLACEABLE = new Set([
  "minecraft:air",
  "minecraft:short_grass",
  "minecraft:grass",
  "minecraft:fern",
  "minecraft:tall_grass",
  "minecraft:tallgrass"
]);

const seededSpots = new Map(); // playerId -> [{x,y,z,t}] 运行时补种记录（用于本地上限）

export function tryNaturalCloverSpawn(player) {
  try {
    const dim = player.dimension;
    const loc = player.location;
    const dimId = dim.id || "minecraft:overworld";
    const bx = Math.floor(loc.x), by = Math.floor(loc.y), bz = Math.floor(loc.z);

    // 附近已经够多就换地方长（用脚本侧记录，避免逐格扫描的开销与漏数）
    const nowTick = system.currentTick || 0;
    const tracked = (seededSpots.get(player.id) || []).filter(p =>
      Math.abs(p.x - bx) <= 16 && Math.abs(p.z - bz) <= 16 && nowTick - p.t < 20 * 60 * 10
    );
    seededSpots.set(player.id, tracked);
    if (tracked.length >= 10) return false;

    // 该维度对应的品种
    let id, altId;
    if (dimId.indexOf("nether") >= 0) { id = PLANT_BLOCK_IDS.EMBER; altId = PLANT_BLOCK_IDS.EMBER; }
    else if (dimId.indexOf("the_end") >= 0) { id = PLANT_BLOCK_IDS.STARLIGHT; altId = PLANT_BLOCK_IDS.STARLIGHT; }
    else { id = PLANT_BLOCK_IDS.THREE_LEAF; altId = PLANT_BLOCK_IDS.WILD_LUCKY; }

    for (let attempt = 0; attempt < 20; attempt++) {
      const r = 8 + Math.random() * 6;            // 8~14 格：看得到但不会在眼前凭空出现
      const a = Math.random() * Math.PI * 2;
      const dx = Math.round(Math.cos(a) * r);
      const dz = Math.round(Math.sin(a) * r);
      const dy = Math.floor(Math.random() * 5) - 2;
      let ground = null, target = null;
      try {
        ground = dim.getBlock({ x: bx + dx, y: by + dy - 1, z: bz + dz });
        target = dim.getBlock({ x: bx + dx, y: by + dy, z: bz + dz });
      } catch (e) { continue; }
      if (!ground || !target) continue;
      if (!NATURAL_SOILS.has(ground.typeId)) continue;
      if (!NATURAL_REPLACEABLE.has(target.typeId)) continue;
      const roll = Math.random();
      const chosen = roll < 0.90 ? id : (roll < 0.98 ? altId : PLANT_BLOCK_IDS.GOLD_VEIN);
      try {
        target.setType(chosen);
        tracked.push({ x: bx + dx, y: by + dy, z: bz + dz, t: nowTick });
        seededSpots.set(player.id, tracked);
        safeSpawnParticle(dim, "minecraft:villager_happy", { x: bx + dx + 0.5, y: by + dy + 0.4, z: bz + dz + 0.5 });
        return true;
      } catch (e) { continue; }
    }
  } catch (e) {
    log("tryNaturalCloverSpawn failed:", e);
  }
  return false;
}

export function advanceNearbyCrops(dimension, centerLoc, radius = 4) {
  const bx = Math.floor(centerLoc.x);
  const by = Math.floor(centerLoc.y);
  const bz = Math.floor(centerLoc.z);
  let count = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        try {
          const b = dimension.getBlock({ x: bx + dx, y: by + dy, z: bz + dz });
          if (!b) continue;
          if (b.typeId === PLANT_BLOCK_IDS.STAGE_1) {
            b.setType(PLANT_BLOCK_IDS.STAGE_2);
            count++;
          } else if (b.typeId === PLANT_BLOCK_IDS.STAGE_2) {
            b.setType(PLANT_BLOCK_IDS.STAGE_3);
            count++;
          } else if (b.typeId === PLANT_BLOCK_IDS.DORMANT) {
            b.setType(PLANT_BLOCK_IDS.WILD_LUCKY);
            count++;
          }
        } catch (e) {}
      }
    }
  }
  return count;
}

export function resolveEnvironmentMutation(dimension, blockLoc, forcedByCultivator = false) {
  try {
    const dimId = dimension.id || "minecraft:overworld";
    if (dimId.includes("nether")) return PLANT_BLOCK_IDS.EMBER;
    if (dimId.includes("the_end")) return PLANT_BLOCK_IDS.STARLIGHT;

    // 检查下方是否有金块/金矿或使用了金露培育剂
    const below2 = dimension.getBlock({ x: blockLoc.x, y: blockLoc.y - 2, z: blockLoc.z });
    if (below2 && (below2.typeId.includes("gold") || below2.typeId === "minecraft:raw_gold_block")) {
      return PLANT_BLOCK_IDS.GOLD_VEIN;
    }

    // 检查周围 2 格是否有水源或苔藓块 -> 晨露四叶草
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const near = dimension.getBlock({ x: blockLoc.x + dx, y: blockLoc.y - 1, z: blockLoc.z + dz });
        if (near && (near.typeId.includes("water") || near.typeId === "minecraft:moss_block")) {
          return PLANT_BLOCK_IDS.MORNING_DEW;
        }
      }
    }

    if (forcedByCultivator) {
      const pool = [PLANT_BLOCK_IDS.GOLD_VEIN, PLANT_BLOCK_IDS.MORNING_DEW, PLANT_BLOCK_IDS.MOONLIGHT];
      return pickRandom(pool);
    }
    return Math.random() < 0.5 ? PLANT_BLOCK_IDS.MORNING_DEW : PLANT_BLOCK_IDS.MOONLIGHT;
  } catch (e) {
    return PLANT_BLOCK_IDS.GOLD_VEIN;
  }
}

export function handleCropTick(block, dimension) {
  try {
    if (!block) return;
    const id = block.typeId;
    const loc = block.location;
    if (id === PLANT_BLOCK_IDS.DORMANT) {
      block.setType(PLANT_BLOCK_IDS.WILD_LUCKY);
      safeSpawnParticle(dimension, "minecraft:crop_growth_emitter", { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 });
    } else if (id === PLANT_BLOCK_IDS.STAGE_1) {
      block.setType(PLANT_BLOCK_IDS.STAGE_2);
    } else if (id === PLANT_BLOCK_IDS.STAGE_2) {
      block.setType(PLANT_BLOCK_IDS.STAGE_3);
    } else if (id === PLANT_BLOCK_IDS.STAGE_3) {
      // 自然环境低概率变异为阶段四特殊品种
      if (Math.random() < 0.22) {
        const mutatedId = resolveEnvironmentMutation(dimension, loc, false);
        block.setType(mutatedId);
        safeSpawnParticle(dimension, "minecraft:totem_particle", { x: loc.x + 0.5, y: loc.y + 0.6, z: loc.z + 0.5 });
      }
    }
  } catch (e) {
    log("handleCropTick error:", e);
  }
}

export function harvestCloverPlant(player, block, dimension, isRightClick = false) {
  if (!block) return false;
  const blockId = block.typeId;
  const loc = { x: block.location.x + 0.5, y: block.location.y + 0.3, z: block.location.z + 0.5 };
  const vineBonus = player ? getArmorSetCount(player, "vine") >= 2 : false;

  const giveVineBonus = () => {
    if (vineBonus && Math.random() < 0.35) {
      spawnGiftItem(dimension, loc, Math.random() < 0.5 ? ITEM_IDS.CLOVER_LEAF : ITEM_IDS.LUCKY_POLLEN, 1);
    }
  };

  if (blockId === PLANT_BLOCK_IDS.THREE_LEAF || blockId === PLANT_BLOCK_IDS.STAGE_2) {
    spawnGiftItem(dimension, loc, ITEM_IDS.CLOVER_LEAF, randInt(1, 2));
    if (Math.random() < 0.35) spawnGiftItem(dimension, loc, ITEM_IDS.SEED_PACKET, 1);
    giveVineBonus();
    recordAlmanacProgress(player, "plant", PLANT_BLOCK_IDS.THREE_LEAF);
    recordAlmanacProgress(player, "harvest");
    if (isRightClick && blockId === PLANT_BLOCK_IDS.STAGE_2) {
      block.setType(PLANT_BLOCK_IDS.STAGE_1);
    }
    return true;
  }

  if (blockId === PLANT_BLOCK_IDS.WILD_LUCKY || blockId === PLANT_BLOCK_IDS.STAGE_3) {
    spawnGiftItem(dimension, loc, CLOVER_ITEM_ID, 1);
    spawnGiftItem(dimension, loc, ITEM_IDS.CLOVER_LEAF, 1);
    if (Math.random() < 0.5) spawnGiftItem(dimension, loc, ITEM_IDS.SEED_PACKET, 1);
    if (Math.random() < 0.35) spawnGiftItem(dimension, loc, ITEM_IDS.LUCKY_POLLEN, 1);
    giveVineBonus();
    recordAlmanacProgress(player, "plant", PLANT_BLOCK_IDS.WILD_LUCKY);
    recordAlmanacProgress(player, "harvest");

    // 采收后休眠机制：培育植株回到阶段二，野生幸运四叶草 80% 进入休眠植株
    const blockPos = { x: block.location.x, y: block.location.y, z: block.location.z };
    if (blockId === PLANT_BLOCK_IDS.STAGE_3) {
      system.run(() => {
        try { dimension.getBlock(blockPos)?.setType(PLANT_BLOCK_IDS.STAGE_2); } catch (e) {}
      });
    } else if (Math.random() < 0.8) {
      system.run(() => {
        try {
          dimension.getBlock(blockPos)?.setType(PLANT_BLOCK_IDS.DORMANT);
          if (player) safeActionBar(player, "§a[生态采收] 野生四叶草已进入短暂休眠，过一段时间将重新生长！");
        } catch (e) {}
      });
    }
    return true;
  }

  if (blockId === PLANT_BLOCK_IDS.GOLD_VEIN || blockId === PLANT_BLOCK_IDS.STAGE_4) {
    spawnGiftItem(dimension, loc, ITEM_IDS.GOLDEN_DEW, randInt(1, 2));
    spawnGiftItem(dimension, loc, ITEM_IDS.LUCKY_POLLEN, 1);
    if (Math.random() < 0.4) spawnGiftItem(dimension, loc, GOLDEN_CLOVER_ITEM_ID, 1);
    giveVineBonus();
    recordAlmanacProgress(player, "plant", PLANT_BLOCK_IDS.GOLD_VEIN);
    recordAlmanacProgress(player, "harvest");
    const blockPos = { x: block.location.x, y: block.location.y, z: block.location.z };
    if (Math.random() < 0.55) {
      system.run(() => {
        try { dimension.getBlock(blockPos)?.setType(PLANT_BLOCK_IDS.DORMANT); } catch (e) {}
      });
    }
    return true;
  }

  if (blockId === PLANT_BLOCK_IDS.MORNING_DEW) {
    spawnGiftItem(dimension, loc, ITEM_IDS.MORNING_DEW, randInt(1, 2));
    spawnGiftItem(dimension, loc, ITEM_IDS.LUCKY_POLLEN, randInt(1, 2));
    giveVineBonus();
    recordAlmanacProgress(player, "plant", PLANT_BLOCK_IDS.MORNING_DEW);
    recordAlmanacProgress(player, "harvest");
    const blockPos = { x: block.location.x, y: block.location.y, z: block.location.z };
    if (Math.random() < 0.7) {
      system.run(() => {
        try { dimension.getBlock(blockPos)?.setType(PLANT_BLOCK_IDS.DORMANT); } catch (e) {}
      });
    }
    return true;
  }

  if (blockId === PLANT_BLOCK_IDS.MOONLIGHT) {
    spawnGiftItem(dimension, loc, ITEM_IDS.NATURE_ESSENCE, 1);
    spawnGiftItem(dimension, loc, ITEM_IDS.MORNING_DEW, 1);
    if (Math.random() < 0.3) spawnGiftItem(dimension, loc, ITEM_IDS.DESTINY_SHARD, 1);
    giveVineBonus();
    recordAlmanacProgress(player, "plant", PLANT_BLOCK_IDS.MOONLIGHT);
    recordAlmanacProgress(player, "harvest");
    const blockPos = { x: block.location.x, y: block.location.y, z: block.location.z };
    if (Math.random() < 0.45) {
      system.run(() => {
        try { dimension.getBlock(blockPos)?.setType(PLANT_BLOCK_IDS.DORMANT); } catch (e) {}
      });
    }
    return true;
  }

  if (blockId === PLANT_BLOCK_IDS.EMBER) {
    spawnGiftItem(dimension, loc, ITEM_IDS.NATURE_ESSENCE, 1);
    spawnGiftItem(dimension, loc, "minecraft:blaze_powder", randInt(1, 2));
    if (player) safeAddEffect(player, "fire_resistance", 900, { amplifier: 0, showParticles: true });
    recordAlmanacProgress(player, "plant", PLANT_BLOCK_IDS.EMBER);
    recordAlmanacProgress(player, "harvest");
    return true;
  }

  if (blockId === PLANT_BLOCK_IDS.STARLIGHT) {
    spawnGiftItem(dimension, loc, ITEM_IDS.DESTINY_SHARD, 1);
    spawnGiftItem(dimension, loc, ITEM_IDS.NATURE_ESSENCE, 1);
    if (player) safeAddEffect(player, "slow_falling", 600, { amplifier: 0, showParticles: true });
    recordAlmanacProgress(player, "plant", PLANT_BLOCK_IDS.STARLIGHT);
    recordAlmanacProgress(player, "harvest");
    return true;
  }

  return false;
}

// ============================================================================
// 10. 探矿回响 (Ore Echo) 扫描实现（事件 34 与 幸运矿镐主动能力共用）
// ============================================================================
export function triggerOreEchoScan(player, dimension, centerLoc, radius = 8) {
  const bx = Math.floor(centerLoc.x);
  const by = Math.floor(centerLoc.y);
  const bz = Math.floor(centerLoc.z);
  let oreCount = 0;
  let nearestOre = null;
  let nearestDist = 999;

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        try {
          const b = dimension.getBlock({ x: bx + dx, y: by + dy, z: bz + dz });
          if (!b) continue;
          const tid = b.typeId;
          if (tid.includes("_ore") || tid === "minecraft:ancient_debris" || tid === "minecraft:amethyst_cluster") {
            oreCount++;
            const d = Math.hypot(dx, dy, dz);
            if (d < nearestDist) {
              nearestDist = d;
              nearestOre = { x: bx + dx + 0.5, y: by + dy + 0.5, z: bz + dz + 0.5, id: tid };
            }
          }
        } catch (e) {}
      }
    }
  }

  safePlaySound(player, "chime.amethyst_block", { pitch: 1.25, volume: 1.0 });
  if (nearestOre) {
    // 朝最近矿脉方向生成一串微光粒子指引（不透视全图，仅提供方向回响）
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      safeSpawnParticle(dimension, "minecraft:endrod", {
        x: centerLoc.x + (nearestOre.x - centerLoc.x) * t,
        y: centerLoc.y + 1.0 + (nearestOre.y - (centerLoc.y + 1.0)) * t,
        z: centerLoc.z + (nearestOre.z - centerLoc.z) * t
      });
    }
    const cleanName = nearestOre.id.replace("minecraft:", "").replace("deepslate_", "");
    safeMessage(player, `§b[矿脉回响] 叮——周围 ${radius} 格内共感应到 ${oreCount} 处矿石！最近矿脉：[${cleanName}]（约 ${Math.round(nearestDist)} 格）`);
  } else {
    safeAddEffect(player, "haste", 400, { amplifier: 0, showParticles: false });
    safeMessage(player, `§b[矿脉回响] 周围 ${radius} 格内未感应到明显矿脉，大地的回响赋予了你 20 秒急迫 I！`);
  }
}

// ============================================================================
// 11. 四叶草神龛交互与【四叶守护灵】三阶段 Boss 战系统（第 8 部分）
// ============================================================================
const activeGuardianBattles = new Map(); // entity.id -> state

export function handleShrineInteraction(player, block, dimension) {
  if (!player || !block) return;
  recordAlmanacProgress(player, "shrine");

  const eq = player.getComponent("minecraft:equippable");
  const held = eq?.getEquipment(EquipmentSlot.Mainhand);
  const heldId = held?.typeId;
  const sLoc = { x: block.location.x + 0.5, y: block.location.y + 1.1, z: block.location.z + 0.5 };

    // 0) 潜行手持金叶四叶草点击神龛 -> 展开完整【四叶草神龛圣殿】多方块建筑结构
  if (player.isSneaking && heldId === GOLDEN_CLOVER_ITEM_ID) {
    consumeOneOf(player, GOLDEN_CLOVER_ITEM_ID);
    buildShrineSanctuary(dimension, block.location);
    safeSpawnParticle(dimension, PARTICLE_IDS.GOLDEN_BURST, sLoc);
    safePlaySound(player, "block.enchanting_table.use", { pitch: 1.1, volume: 1.0 });
    safeMessage(player, "§6§l[四叶草神龛·圣殿展开] §a金叶灵力注入大地，神龛四周升起了完整的苔石花坛与四柱圣殿结构！");
    return;
  }

  // 1) 提交自然精华或月辉四叶草 -> 开启【四叶守护灵试炼】
  if (heldId === ITEM_IDS.NATURE_ESSENCE || heldId === PLANT_BLOCK_IDS.MOONLIGHT || heldId === ITEM_IDS.DESTINY_BOTTLE) {
    if (isOnCooldown(player, "shrine_trial")) {
      safeMessage(player, `§e[四叶草神龛] 神龛试炼刚结束不久，请等待 ${getCooldownRemainingSec(player, "shrine_trial")} 秒后再发起试炼。`);
      return;
    }
    // 检查附近是否已有守护灵
    const existing = dimension.getEntities({ type: ENTITY_IDS.GUARDIAN, location: sLoc, maxDistance: 24 });
    if (existing && existing.length > 0) {
      safeMessage(player, "§c[四叶草神龛] 附近已存在正在进行的四叶守护灵试炼！");
      return;
    }

    consumeOneOf(player, heldId);
    setCooldown(player, "shrine_trial", 1200); // 60 秒冷却
    safeSpawnParticle(dimension, "minecraft:totem_particle", sLoc);
    safePlaySound(player, "block.beacon.activate", { pitch: 1.1, volume: 1.0 });
    safeMessage(player, "§6§l[四叶草神龛·试炼开启] §e神龛共鸣！3 秒后【四叶守护灵】将降临试炼场地，请注意观察护盾与弱点时机！");

    system.runTimeout(() => {
      startGuardianBossTrial(player, dimension, sLoc);
    }, 60);
    return;
  }

  // 2) 提交金叶四叶草或黄金露珠 -> 黄金祝祷与自然精华转化
  if (heldId === GOLDEN_CLOVER_ITEM_ID || heldId === ITEM_IDS.GOLDEN_DEW) {
    if (isOnCooldown(player, "shrine_gold_offering")) {
      safeMessage(player, `§e[四叶草神龛] 神龛黄金祝祷冷却中（剩余 ${getCooldownRemainingSec(player, "shrine_gold_offering")} 秒）。`);
      return;
    }
    consumeOneOf(player, heldId);
    setCooldown(player, "shrine_gold_offering", 600); // 30 秒冷却
    addLeafShield(player, 2, 4);
    safeAddEffect(player, "absorption", 1200, { amplifier: 1, showParticles: true });
    safeAddEffect(player, "regeneration", 300, { amplifier: 1, showParticles: true });
    spawnGiftItem(dimension, sLoc, ITEM_IDS.NATURE_ESSENCE, 1);
    safeSpawnParticle(dimension, "minecraft:totem_particle", sLoc);
    safePlaySound(player, "chime.amethyst_block", { pitch: 1.3, volume: 1.0 });
    safeMessage(player, "§6[四叶草神龛] 神龛接纳了你的黄金供奉，赐予你【自然精华】x1、黄金护盾与吸收祝福！");
    return;
  }

  // 3) 提交普通四叶草 -> 轻风祈福与花粉馈赠（带冷却，防无限刷高级材料）
  if (heldId === CLOVER_ITEM_ID) {
    if (isOnCooldown(player, "shrine_clover_offering")) {
      safeMessage(player, `§a[四叶草神龛] 神龛正在消化自然灵气（剩余 ${getCooldownRemainingSec(player, "shrine_clover_offering")} 秒）。`);
      return;
    }
    consumeOneOf(player, CLOVER_ITEM_ID);
    setCooldown(player, "shrine_clover_offering", 300); // 15 秒冷却
    safeAddEffect(player, "speed", 900, { amplifier: 1, showParticles: true });
    safeAddEffect(player, "regeneration", 200, { amplifier: 0, showParticles: true });
    spawnGiftItem(dimension, sLoc, ITEM_IDS.LUCKY_POLLEN, randInt(1, 2));
    safeSpawnParticle(dimension, "minecraft:villager_happy", sLoc);
    safePlaySound(player, "random.orb", { pitch: 1.2, volume: 1.0 });
    safeMessage(player, "§a[四叶草神龛] 你向神龛献上四叶草，获得轻风祝福与幸运花粉！");
    return;
  }

  // 4) 空手或持其他物品点击 -> 显示神龛说明
  safePlaySound(player, "chime.amethyst_block", { pitch: 1.0, volume: 0.8 });
  safeMessage(
    player,
    "§6§l=== 【四叶草神龛】交互指南 ===\n" +
    "§a· 手持【普通四叶草】点击：§f祈求神龛轻风祝福并获取幸运花粉\n" +
    "§6· 手持【金叶四叶草/黄金露珠】点击：§f祈求黄金护盾并凝练【自然精华】\n" +
    "§d· 手持【自然精华/月辉四叶草/命运祈愿瓶】点击：§f开启三阶段【四叶守护灵】Boss 试炼！"
  );
}

export function startGuardianBossTrial(player, dimension, spawnLoc) {
  const boss = safeSpawnEntity(dimension, ENTITY_IDS.GUARDIAN, spawnLoc, "§a§l四叶守护灵 §e[阶段一：守护之叶]");
  if (!boss) {
    // 若和平模式无法生成怪物，改为召唤草灵试炼官并进行和平试炼挑战
    safeMessage(player, "§e[四叶守护灵试炼] 当前世界处于和平模式，四叶守护灵化身为和平灵韵赠予你试炼褒奖！");
    spawnGiftItem(dimension, spawnLoc, ITEM_IDS.GUARDIAN_EMBLEM, 1);
    spawnGiftItem(dimension, spawnLoc, ITEM_IDS.NATURE_ESSENCE, 2);
    spawnGiftItem(dimension, spawnLoc, ITEM_IDS.DESTINY_SHARD, 1);
    recordAlmanacProgress(player, "guardian_win", "flawless");
    return;
  }

  const state = {
    bossId: boss.id,
    challengerId: player?.id,
    phase: 1,
    shieldActive: false,
    weaknessWindow: false,
    playerHitCount: 0,
    summonedIds: [],
    ticks: 0
  };
  activeGuardianBattles.set(boss.id, state);

  const runId = system.runInterval(() => {
    try {
      if (!boss || !boss.isValid()) {
        system.clearRun(runId);
        cleanupGuardianSummons(dimension, state);
        activeGuardianBattles.delete(state.bossId);
        return;
      }

      state.ticks++;
      const hpComp = boss.getComponent("minecraft:health");
      const curHp = hpComp?.currentValue ?? 160;
      const maxHp = hpComp?.effectiveMax ?? 160;
      const hpRatio = curHp / maxHp;
      const bLoc = boss.location;

      // 阶段切换判定
      if (hpRatio <= 0.35 && state.phase < 3) {
        state.phase = 3;
        state.shieldActive = false;
        boss.nameTag = "§6§l四叶守护灵 §c[阶段三：黄金觉醒]";
        safePlayAnimation(boss, "animation.clover_guardian.golden_awaken");
        safeSpawnParticle(dimension, PARTICLE_IDS.GOLDEN_BURST, { x: bLoc.x, y: bLoc.y + 1.2, z: bLoc.z });
        safeSpawnParticle(dimension, "minecraft:totem_particle", { x: bLoc.x, y: bLoc.y + 1.5, z: bLoc.z });
        if (player?.isValid()) {
          safePlaySound(player, "mob.wither.break_block", { pitch: 1.2, volume: 0.9 });
          safeMessage(player, "§6§l[守护灵试炼·阶段三] §e四叶守护灵进入【黄金觉醒】！每次风暴释放后将暴露 3.5 秒黄金弱点窗口！");
        }
      } else if (hpRatio <= 0.70 && state.phase < 2) {
        state.phase = 2;
        state.shieldActive = false;
        boss.nameTag = "§a§l四叶守护灵 §b[阶段二：风与命运]";
        safeSpawnParticle(dimension, "minecraft:wind_explosion_emitter", { x: bLoc.x, y: bLoc.y + 1.2, z: bLoc.z });
        if (player?.isValid()) {
          safePlaySound(player, "wind_charge.burst", { pitch: 1.0, volume: 1.0 });
          safeMessage(player, "§b§l[守护灵试炼·阶段二] §b守护灵唤起【风与命运】！注意横向走位躲避疾风冲锋与叶片冲击！");
        }
      }

      // 各阶段周期技能（每 5 秒触发一次）
      if (state.ticks % 5 === 0) {
        if (state.phase === 1) {
          // 阶段一：藤蔓护盾开启/关闭切换 + 少量护卫召唤
          state.shieldActive = !state.shieldActive;
          if (state.shieldActive) {
            boss.nameTag = "§2§l四叶守护灵 §a[藤蔓护盾开启]";
            safePlayAnimation(boss, "animation.clover_guardian.shield_expand");
            safeSpawnParticle(dimension, PARTICLE_IDS.NATURE_SWIRL, { x: bLoc.x, y: bLoc.y + 1.2, z: bLoc.z });
            safeSpawnParticle(dimension, "minecraft:crop_growth_emitter", { x: bLoc.x, y: bLoc.y + 1.2, z: bLoc.z });
            if (player?.isValid()) safeActionBar(player, "§2[守护灵] 藤蔓护盾已展开（正面减伤），等待护盾消散时机！");
          } else {
            boss.nameTag = "§a§l四叶守护灵 §e[护盾关闭·可全力进攻]";
            if (player?.isValid()) safeActionBar(player, "§e[守护灵] 藤蔓护盾已收起，快发起进攻！");
          }
        } else if (state.phase === 2) {
          // 阶段二：预警光环 + 旋风叶片震击动画
          safeSpawnParticle(dimension, PARTICLE_IDS.GUARDIAN_TELEGRAPH, { x: bLoc.x, y: bLoc.y + 0.2, z: bLoc.z });
          safePlayAnimation(boss, "animation.clover_guardian.wind_storm");
          safeSpawnParticle(dimension, "minecraft:wind_explosion_emitter", { x: bLoc.x, y: bLoc.y + 1, z: bLoc.z });
          if (player?.isValid()) {
            const dist = Math.hypot(player.location.x - bLoc.x, player.location.z - bLoc.z);
            if (dist <= 6.5) {
              safeAddEffect(player, "slowness", 40, { amplifier: 0, showParticles: true });
              safeActionBar(player, "§b[守护灵] 旋风叶片掠过！保持移动闪避！");
            }
          }
        } else if (state.phase === 3) {
          // 阶段三：黄金风暴与黄金弱点窗口交替
          state.weaknessWindow = !state.weaknessWindow;
          if (state.weaknessWindow) {
            boss.nameTag = "§e§l四叶守护灵 §6[★黄金弱点暴露★]";
            safePlayAnimation(boss, "animation.clover_guardian.weakness_exposed");
            safeSpawnParticle(dimension, PARTICLE_IDS.GOLDEN_BURST, { x: bLoc.x, y: bLoc.y + 1.2, z: bLoc.z });
            safeSpawnParticle(dimension, "minecraft:wax_on_particle", { x: bLoc.x, y: bLoc.y + 1.5, z: bLoc.z });
            if (player?.isValid()) {
              safePlaySound(player, "chime.amethyst_block", { pitch: 1.5, volume: 1.0 });
              safeActionBar(player, "§6§l[★弱点窗口★] 守护灵核心暴露！此时攻击造成 150% 伤害！");
            }
          } else {
            boss.nameTag = "§6§l四叶守护灵 §c[阶段三：黄金觉醒]";
        safePlayAnimation(boss, "animation.clover_guardian.golden_awaken");
        safeSpawnParticle(dimension, PARTICLE_IDS.GOLDEN_BURST, { x: bLoc.x, y: bLoc.y + 1.2, z: bLoc.z });
            safeSpawnParticle(dimension, "minecraft:totem_particle", { x: bLoc.x, y: bLoc.y + 1.2, z: bLoc.z });
          }
        }
      }
    } catch (e) {
      log("guardian AI loop error:", e);
    }
  }, 20);
}

function cleanupGuardianSummons(dimension, state) {
  if (!state || !state.summonedIds) return;
  for (const eid of state.summonedIds) {
    try {
      for (const e of dimension.getEntities()) {
        if (e.id === eid && e.isValid()) e.remove();
      }
    } catch (e) {}
  }
}

export function getGuardianBattleState(entityId) {
  return activeGuardianBattles.get(entityId) || null;
}

// ============================================================================
// 12. 《幸运植物图鉴》(Lucky Clover Almanac) 六大栏目与成就收藏系统（第 9 部分）
// ============================================================================
export const ALMANAC_TABS = [
  "01 植物生态图鉴",
  "02 幸运奇遇图鉴",
  "03 花园培育图鉴",
  "04 专属装备图鉴",
  "05 神龛探索图鉴",
  "06 成就与收藏奖"
];

export const ACHIEVEMENT_DEFS = [
  { id: "ach_first_clover", title: "初遇幸运", desc: "首次触发幸运四叶草奇遇", check: (d) => d.events.length >= 1, rewardItem: ITEM_IDS.CLOVER_LEAF, rewardCount: 3 },
  { id: "ach_botanist", title: "四叶草植物学家", desc: "发现 4 种以上不同的四叶草植物品种", check: (d) => d.plants.length >= 4, rewardItem: ITEM_IDS.GOLDEN_DEW, rewardCount: 2 },
  { id: "ach_all_plants", title: "自然生态大师", desc: "集齐全部 7 种主世界与跨维度四叶草品种", check: (d) => d.plants.length >= 7, rewardItem: ITEM_IDS.NATURE_ESSENCE, rewardCount: 2 },
  { id: "ach_gardener", title: "幸运花园园主", desc: "累计播种并收获 5 次四叶草植株", check: (d) => d.harvestCount >= 5, rewardItem: ITEM_IDS.CULTIVATOR, rewardCount: 2 },
  { id: "ach_mutator", title: "变异培育专家", desc: "成功培育出特殊变异四叶草植株", check: (d) => d.mutationCount >= 1, rewardItem: ITEM_IDS.NATURE_ESSENCE, rewardCount: 1 },
  { id: "ach_event_seeker", title: "命运见证者", desc: "累计解锁 15 种不同的四叶草奇遇", check: (d) => d.events.length >= 15, rewardItem: GOLDEN_CLOVER_ITEM_ID, rewardCount: 2 },
  { id: "ach_event_master", title: "传奇奇遇收藏家", desc: "累计解锁 30 种以上的四叶草奇遇", check: (d) => d.events.length >= 30, rewardItem: ITEM_IDS.DESTINY_SHARD, rewardCount: 2 },
  { id: "ach_armorer", title: "绿叶与黄金武装", desc: "制作或穿戴至少 4 件四叶草专属装备或武器", check: (d) => d.equipment.length >= 4, rewardItem: ITEM_IDS.NATURE_ESSENCE, rewardCount: 2 },
  { id: "ach_shrine_pilgrim", title: "神龛朝圣者", desc: "在世界中发现并与四叶草神龛互动", check: (d) => d.shrinesFound >= 1, rewardItem: ITEM_IDS.GOLDEN_DEW, rewardCount: 2 },
  { id: "ach_guardian_slayer", title: "守护灵试炼征服者", desc: "成功完成四叶守护灵三阶段试炼", check: (d) => d.guardiansDefeated >= 1, rewardItem: ITEM_IDS.DESTINY_SHARD, rewardCount: 2 }
];

export function handleAlmanacUse(player) {
  if (!player) return;
  const data = loadAlmanac(player);

  // 潜行使用时切换栏目
  if (player.isSneaking) {
    data.tab = ((data.tab || 0) + 1) % ALMANAC_TABS.length;
    saveAlmanac(player, data);
    safePlaySound(player, "item.book.page_turn", { pitch: 1.15, volume: 1.0 });
    safeActionBar(player, `§2[幸运植物图鉴] §a当前栏目：§e【${ALMANAC_TABS[data.tab]}】 §7(直接右键翻阅详情)`);
    return;
  }

  safePlaySound(player, "item.book.put", { pitch: 1.1, volume: 1.0 });
  const tab = data.tab || 0;

  if (tab === 0) {
    const allPlants = [
      [PLANT_BLOCK_IDS.THREE_LEAF, "普通三叶草", "平原/森林/草甸"],
      [PLANT_BLOCK_IDS.WILD_LUCKY, "野生幸运四叶草", "草甸/繁花森林 (采收后休眠重生)"],
      [PLANT_BLOCK_IDS.GOLD_VEIN, "金脉四叶草", "草甸极稀有 / 金露培育变异"],
      [PLANT_BLOCK_IDS.MORNING_DEW, "晨露四叶草", "繁花森林/水源旁湿润变异"],
      [PLANT_BLOCK_IDS.MOONLIGHT, "月辉四叶草", "夜间草甸 / 月光环境变异"],
      [PLANT_BLOCK_IDS.EMBER, "余烬四叶草", "下界绯红/诡异森林耐热品种"],
      [PLANT_BLOCK_IDS.STARLIGHT, "星辉四叶草", "末地外岛星辉品种"]
    ];
    const lines = [`§2§l=== 《幸运植物图鉴》· [01 植物生态 (${data.plants.length}/7)] ===`];
    for (const [pid, pname, penv] of allPlants) {
      const unlocked = data.plants.includes(pid);
      lines.push(unlocked ? `§a✔ 【${pname}】 §7— 分布/条件：${penv}` : `§8✖ 【？？？】 §7— 尚未发现（提示：探索或培育解锁）`);
    }
    lines.push("§7（提示：潜行+右键可切换至下一栏目）");
    safeMessage(player, lines.join("\n"));
  } else if (tab === 1) {
    const lines = [
      `§2§l=== 《幸运植物图鉴》· [02 幸运奇遇 (${data.events.length}/40 | 金叶奇迹 ${data.goldenEvents.length}/5)] ===`,
      `§a· 自然馈赠 (Leaf 1)：§f已记录 ${CLOVER_EVENTS.filter(e => e.leaf === 1 && data.events.includes(e.id)).length} / 10 种`,
      `§e· 生灵奇遇 (Leaf 2)：§f已记录 ${CLOVER_EVENTS.filter(e => e.leaf === 2 && data.events.includes(e.id)).length} / 10 种`,
      `§b· 自然祝福 (Leaf 3)：§f已记录 ${CLOVER_EVENTS.filter(e => e.leaf === 3 && data.events.includes(e.id)).length} / 10 种`,
      `§d· 调皮妖精 (Leaf 4)：§f已记录 ${CLOVER_EVENTS.filter(e => e.leaf === 4 && data.events.includes(e.id)).length} / 10 种`,
      `§6· 金叶专属奇迹：§f已记录 ${data.goldenEvents.length} / 5 种`
    ];
    safeMessage(player, lines.join("\n"));
  } else if (tab === 2) {
    const lines = [
      "§2§l=== 《幸运植物图鉴》· [03 花园培育图鉴] ===",
      `§a· 累计播种次数：§f${data.plantedCount} 次   §a累计采收次数：§f${data.harvestCount} 次`,
      `§6· 成功培育特殊变异：§f${data.mutationCount} 次（已解锁变异品种：${data.mutations.length} 种）`,
      "§e· 培育秘诀：",
      "  §71. 使用【四叶草种子包】在草地/泥土/耕地种下阶段一幼苗；",
      "  §72. 骨粉可加速普通生长至阶段三，但不会直接刷出稀有变异；",
      "  §73. 在水源旁（晨露）、夜间（月辉）或使用【金露培育剂】（金脉）可触发阶段四变异！"
    ];
    safeMessage(player, lines.join("\n"));
  } else if (tab === 3) {
    const lines = [
      `§2§l=== 《幸运植物图鉴》· [04 专属装备图鉴 (已收集 ${data.equipment.length}/16)] ===`,
      "§a· 幸运藤叶套装 (4件)：§f叶冠稀有植株雷达 | 2件套采草额外材料 | 4件套【自然护佑】",
      "§6· 金叶守护套装 (4件)：§f状态显示与高阶防护 | 2件套祝福延时+35% | 4件套【金色护佑】",
      "§d· 命运行者套装 (4件)：§f神龛感知与暴击增益 | 2件套星火附加 | 4件套【反转负面反噬】",
      "§b· 核心武器与工具：§f翠藤短刃（藤蔓束缚）、命运镰刃（三态命运）、四叶祈愿弓（绿叶爆散）、幸运矿镐（矿脉回响）"
    ];
    safeMessage(player, lines.join("\n"));
  } else if (tab === 4) {
    const lines = [
      "§2§l=== 《幸运植物图鉴》· [05 神龛与特殊生灵探索] ===",
      `§6· 发现四叶草神龛：§f${data.shrinesFound} 次`,
      `§a· 邂逅四叶草精灵：§f${data.spritesMet} 次`,
      `§e· 偶遇迷路的旅人：§f${data.travelersMet} 次`,
      `§d· 击败四叶守护灵：§f${data.guardiansDefeated} 次 ${data.flawlessGuardian ? "§6(★已达成无伤/完美试炼★)" : ""}`
    ];
    safeMessage(player, lines.join("\n"));
  } else {
    // Tab 5: 成就收藏与自动领奖
    const lines = ["§2§l=== 《幸运植物图鉴》· [06 成就收藏与里程碑奖励] ==="];
    let newlyClaimed = 0;
    for (const ach of ACHIEVEMENT_DEFS) {
      const done = ach.check(data);
      const claimed = data.claimedAchievements.includes(ach.id);
      if (done && !claimed) {
        data.claimedAchievements.push(ach.id);
        spawnGiftItem(player.dimension, player.location, ach.rewardItem, ach.rewardCount);
        newlyClaimed++;
        lines.push(`§6★ 【${ach.title}】 §a(刚达成！已发放奖励) §7— ${ach.desc}`);
      } else if (done) {
        lines.push(`§a✔ 【${ach.title}】 §7— ${ach.desc}`);
      } else {
        lines.push(`§8✖ 【${ach.title}】 §7— ${ach.desc}`);
      }
    }
    if (newlyClaimed > 0) {
      saveAlmanac(player, data);
      safePlaySound(player, "random.levelup", { pitch: 1.2, volume: 1.0 });
    }
    safeMessage(player, lines.join("\n"));
  }
}
