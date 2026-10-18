/*
 * main.js —— 《幸运四叶草：自然与命运》(Lucky Clover: Nature & Destiny) 生产环境主入口
 * 兼容 Minecraft 基岩版 1.21.60+ (@minecraft/server 1.17.0)
 * 负责：
 *   1. 除草掉落普通四叶草 + 幸运矿镐挖矿额外收益 + 野生/培育四叶草植株采收与休眠重生
 *   2. 注册全部物品与方块自定义组件（兼容 1.x worldInitialize 与 2.x startup 双通道）
 *   3. 4 阶段种植培育、骨粉催熟（限阶段三）、金露培育剂环境变异与神龛交互
 *   4. 3 套专属盔甲（幸运藤叶、金叶守护、命运行者）单件与 2/4 件套效果、主动/受击护佑
 *   5. 3 把核心武器（翠藤短刃、命运镰刃、四叶祈愿弓）与四叶守护灵三阶段 Boss 战斗逻辑
 *   6. 迷路的旅人三选一交互、四叶草精灵伴随与《幸运植物图鉴》六栏进度追踪
 */

import { world, system, ItemStack, GameMode, EquipmentSlot } from "@minecraft/server";
import {
  GRASS_DROP_RATES,
  CLOVER_ITEM_ID,
  GOLDEN_CLOVER_ITEM_ID,
  ITEM_IDS,
  PLANT_BLOCK_IDS,
  ENTITY_IDS,
  PARTICLE_IDS,
  safePlayAnimation,
  CLOVER_EVENTS,
  GOLDEN_EXCLUSIVE_EVENTS,
  TOTAL_WEIGHT,
  OFFHAND_LUCK_INTERVAL_TICKS,
  OFFHAND_BLESSING_EFFECT,
  evaluateDrop,
  rollCloverEvent,
  rollGoldenCloverEvent,
  goldenPoolInfo,
  consumeOneOf,
  refreshOffhandLuck,
  harvestCloverPlant,
  handleCropTick,
  resolveEnvironmentMutation,
  triggerOreEchoScan,
  handleShrineInteraction,
  tryNaturalCloverSpawn,
  getGuardianBattleState,
  handleAlmanacUse,
  recordAlmanacProgress,
  getEquippedArmorIds,
  getArmorSetCount,
  isOnCooldown,
  setCooldown,
  addLeafShield,
  getLeafShield,
  consumeLeafShield,
  spawnGiftItem,
  safeAddEffect,
  safePlaySound,
  safeSpawnParticle,
  safeMessage,
  safeActionBar,
  randInt,
  pickRandom,
  log
} from "./lucky_core.js";

const ALL_CLOVER_PLANTS = new Set([
  PLANT_BLOCK_IDS.THREE_LEAF,
  PLANT_BLOCK_IDS.WILD_LUCKY,
  PLANT_BLOCK_IDS.GOLD_VEIN,
  PLANT_BLOCK_IDS.MORNING_DEW,
  PLANT_BLOCK_IDS.MOONLIGHT,
  PLANT_BLOCK_IDS.EMBER,
  PLANT_BLOCK_IDS.STARLIGHT,
  PLANT_BLOCK_IDS.STAGE_2,
  PLANT_BLOCK_IDS.STAGE_3,
  PLANT_BLOCK_IDS.STAGE_4
]);

const RARE_CLOVER_PLANTS = new Set([
  PLANT_BLOCK_IDS.WILD_LUCKY,
  PLANT_BLOCK_IDS.GOLD_VEIN,
  PLANT_BLOCK_IDS.MORNING_DEW,
  PLANT_BLOCK_IDS.MOONLIGHT,
  PLANT_BLOCK_IDS.EMBER,
  PLANT_BLOCK_IDS.STARLIGHT,
  PLANT_BLOCK_IDS.SHRINE
]);

const PLANTABLE_SOILS = new Set([
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

// ============================================================================
// 1. 监听玩家破坏方块：除草掉落 + 野生/培育植物采收 + 幸运矿镐额外矿产
// ============================================================================
function onPlayerBreakBlock(event) {
  try {
    const { player, block, brokenBlockPermutation } = event;
    const brokenId = brokenBlockPermutation.type.id;
    const dimension = block.dimension;
    const centerPos = {
      x: block.location.x + 0.5,
      y: block.location.y + 0.35,
      z: block.location.z + 0.5
    };

    // A. 若破坏的是四叶草生态植株，执行采收与休眠重生判定
    if (ALL_CLOVER_PLANTS.has(brokenId)) {
      harvestCloverPlant(player, { typeId: brokenId, location: block.location }, dimension, false);
      return;
    }

    // B. 采集主手信息（防刷校验 + 时运加成 + 幸运矿镐判定）
    let mainhandTypeId = undefined;
    let hasSilkTouch = false;
    let fortuneLevel = 0;
    const equippable = player.getComponent("minecraft:equippable");
    const mainhandItem = equippable?.getEquipment(EquipmentSlot.Mainhand);
    if (mainhandItem) {
      mainhandTypeId = mainhandItem.typeId;
      const enchantable = mainhandItem.getComponent("minecraft:enchantable");
      if (enchantable) {
        hasSilkTouch = enchantable.hasEnchantment("silk_touch");
        fortuneLevel = enchantable.getEnchantment("fortune")?.level ?? 0;
      }
    }

    // C. 幸运矿镐挖掘矿石时的额外馈赠（不无限翻倍，严格遵守 7.5 节平衡）
    if (
      mainhandTypeId === ITEM_IDS.PICKAXE &&
      !hasSilkTouch &&
      player.getGameMode() !== GameMode.creative &&
      (brokenId.includes("_ore") || brokenId === "minecraft:ancient_debris" || brokenId === "minecraft:amethyst_cluster")
    ) {
      recordAlmanacProgress(player, "equipment", ITEM_IDS.PICKAXE);
      if (Math.random() < 0.32) {
        let bonusItem = ITEM_IDS.LUCKY_POLLEN;
        if (brokenId.includes("iron")) bonusItem = "minecraft:raw_iron";
        else if (brokenId.includes("gold")) bonusItem = ITEM_IDS.GOLDEN_DEW;
        else if (brokenId.includes("copper")) bonusItem = "minecraft:raw_copper";
        else if (brokenId.includes("diamond")) bonusItem = ITEM_IDS.MORNING_DEW;
        else if (brokenId.includes("emerald")) bonusItem = "minecraft:emerald";
        else if (brokenId.includes("lapis")) bonusItem = "minecraft:lapis_lazuli";
        else if (brokenId.includes("redstone")) bonusItem = "minecraft:redstone";
        else if (brokenId.includes("coal")) bonusItem = "minecraft:coal";
        spawnGiftItem(dimension, centerPos, bonusItem, 1);
        safeSpawnParticle(dimension, "minecraft:wax_on_particle", centerPos);
        safePlaySound(player, "random.orb", { pitch: 1.35, volume: 0.7 });
      }
    }

    // D. 原有 4 类野草掉落普通幸运四叶草判定（含幸运藤叶 2 件套额外植物材料加成）
    if (GRASS_DROP_RATES[brokenId] === undefined) return;

    const verdict = evaluateDrop({
      blockId: brokenId,
      isCreative: player.getGameMode() === GameMode.creative,
      mainhandTypeId,
      hasSilkTouch,
      fortuneLevel,
      roll: Math.random()
    });

    // 幸运藤叶两件套：探索除草时有小概率额外获得四叶草叶片或花粉
    if (verdict.applicable && !verdict.blocked && getArmorSetCount(player, "vine") >= 2 && Math.random() < 0.08) {
      spawnGiftItem(dimension, centerPos, Math.random() < 0.7 ? ITEM_IDS.CLOVER_LEAF : ITEM_IDS.LUCKY_POLLEN, 1);
    }

    if (!verdict.applicable || !verdict.dropped) return;

    dimension.spawnItem(new ItemStack(CLOVER_ITEM_ID, 1), centerPos);
    safeSpawnParticle(dimension, "minecraft:villager_happy", centerPos);
    safePlaySound(player, "block.sweet_berry_bush.pick_berries", { pitch: 1.25, volume: 0.9 });
    log(`drop ok | ${player.name} | ${brokenId} | chance=${verdict.finalChance.toFixed(3)} | pos=${block.location.x},${block.location.y},${block.location.z}`);
  } catch (e) {
    log("playerBreakBlock handler error:", e);
  }
}

// ============================================================================
// 2. 监听玩家与方块交互：骨粉催熟、金露培育剂变异、播种四叶草、右键采收与神龛交互
// ============================================================================
function handleBlockInteraction(player, block) {
  try {
    if (!player || !block) return;
    const blockId = block.typeId;
    const dimension = block.dimension;
    const bLoc = block.location;
    const center = { x: bLoc.x + 0.5, y: bLoc.y + 0.5, z: bLoc.z + 0.5 };

    // 防抖冷却（避免同一次点击触发多次）
    if (isOnCooldown(player, "block_interact_debounce")) return;
    setCooldown(player, "block_interact_debounce", 5);

    // 1) 四叶草神龛交互
    if (blockId === PLANT_BLOCK_IDS.SHRINE) {
      handleShrineInteraction(player, block, dimension);
      return;
    }

    const eq = player.getComponent("minecraft:equippable");
    const held = eq?.getEquipment(EquipmentSlot.Mainhand);
    const heldId = held?.typeId;

    // 2) 手持四叶草种子包在土壤上播种
    if (heldId === ITEM_IDS.SEED_PACKET && PLANTABLE_SOILS.has(blockId)) {
      const above = dimension.getBlock({ x: bLoc.x, y: bLoc.y + 1, z: bLoc.z });
      if (above && (above.typeId === "minecraft:air" || above.typeId === "minecraft:short_grass")) {
        consumeOneOf(player, ITEM_IDS.SEED_PACKET);
        above.setType(PLANT_BLOCK_IDS.STAGE_1);
        recordAlmanacProgress(player, "planted");
        safeSpawnParticle(dimension, "minecraft:crop_growth_emitter", { x: bLoc.x + 0.5, y: bLoc.y + 1.2, z: bLoc.z + 0.5 });
        safePlaySound(player, "dig.grass", { pitch: 1.2, volume: 0.9 });
        safeActionBar(player, "§a[幸运花园] 已种下四叶草幼苗（阶段一），可使用骨粉催熟或等待自然生长！");
        return;
      }
    }

    // 3) 手持骨粉催熟（严格遵守 4.2 & 12.3 节：骨粉只能催熟阶段 1/2 及休眠植株，不可直接刷出阶段 4 稀有变异）
    if (heldId === "minecraft:bone_meal") {
      if (blockId === PLANT_BLOCK_IDS.STAGE_1) {
        consumeOneOf(player, "minecraft:bone_meal");
        block.setType(PLANT_BLOCK_IDS.STAGE_2);
        safeSpawnParticle(dimension, "minecraft:crop_growth_emitter", center);
        safePlaySound(player, "item.bone_meal.use", { pitch: 1.1, volume: 1.0 });
        safeActionBar(player, "§a[幸运花园] 幼苗已成长为普通四叶草丛（阶段二）！");
        return;
      }
      if (blockId === PLANT_BLOCK_IDS.STAGE_2 || blockId === PLANT_BLOCK_IDS.DORMANT) {
        consumeOneOf(player, "minecraft:bone_meal");
        block.setType(blockId === PLANT_BLOCK_IDS.DORMANT ? PLANT_BLOCK_IDS.WILD_LUCKY : PLANT_BLOCK_IDS.STAGE_3);
        safeSpawnParticle(dimension, "minecraft:crop_growth_emitter", center);
        safePlaySound(player, "item.bone_meal.use", { pitch: 1.2, volume: 1.0 });
        safeActionBar(player, "§a[幸运花园] 植株已成熟为幸运四叶草（阶段三）！若需培育特殊变异，请配合环境或使用【金露培育剂】。");
        return;
      }
      if (blockId === PLANT_BLOCK_IDS.STAGE_3) {
        safeMessage(player, "§e[培育提示] 植株已达普通成熟阶段！骨粉无法直接催生稀有变异，请使用【金露培育剂】或在湿润/月夜环境下等待自然变异。");
        return;
      }
    }

    // 4) 手持【金露培育剂】对成熟四叶草（阶段三或野生四叶草）尝试诱导变异（65% 成功率，遵守 4.4 节不保证 100% 复制）
    if (heldId === ITEM_IDS.CULTIVATOR && (blockId === PLANT_BLOCK_IDS.STAGE_3 || blockId === PLANT_BLOCK_IDS.WILD_LUCKY)) {
      consumeOneOf(player, ITEM_IDS.CULTIVATOR);
      if (Math.random() < 0.65) {
        const mutatedId = resolveEnvironmentMutation(dimension, bLoc, true);
        block.setType(mutatedId);
        recordAlmanacProgress(player, "mutation", mutatedId);
        safeSpawnParticle(dimension, "minecraft:totem_particle", center);
        safePlaySound(player, "random.levelup", { pitch: 1.35, volume: 1.0 });
        safeMessage(player, `§6§l[金露培育·变异成功] §e成熟四叶草吸收了金露灵气，变异为稀有品种【${mutatedId.replace("lucky:", "")}】！`);
      } else {
        spawnGiftItem(dimension, center, ITEM_IDS.LUCKY_POLLEN, 1);
        safeSpawnParticle(dimension, "minecraft:villager_happy", center);
        safePlaySound(player, "item.bone_meal.use", { pitch: 0.9, volume: 1.0 });
        safeMessage(player, "§e[金露培育] 本次变异尝试未完全突破，但植株凝结出了 1 份幸运花粉！");
      }
      return;
    }

    // 5) 右键直接采收成熟四叶草或稀有变异植株
    if (
      blockId === PLANT_BLOCK_IDS.STAGE_3 ||
      blockId === PLANT_BLOCK_IDS.STAGE_4 ||
      blockId === PLANT_BLOCK_IDS.WILD_LUCKY ||
      blockId === PLANT_BLOCK_IDS.GOLD_VEIN ||
      blockId === PLANT_BLOCK_IDS.MORNING_DEW ||
      blockId === PLANT_BLOCK_IDS.MOONLIGHT ||
      blockId === PLANT_BLOCK_IDS.EMBER ||
      blockId === PLANT_BLOCK_IDS.STARLIGHT
    ) {
      if (harvestCloverPlant(player, block, dimension, true)) {
        if (blockId !== PLANT_BLOCK_IDS.STAGE_3 && blockId !== PLANT_BLOCK_IDS.WILD_LUCKY) {
          block.setType(PLANT_BLOCK_IDS.DORMANT);
        }
        safeSpawnParticle(dimension, "minecraft:villager_happy", center);
        safePlaySound(player, "block.sweet_berry_bush.pick_berries", { pitch: 1.2, volume: 0.9 });
      }
    }
  } catch (e) {
    log("handleBlockInteraction error:", e);
  }
}

// ============================================================================
// 3. 物品使用处理（普通四叶草、金叶四叶草、三大消耗品、四叶祈愿弓、幸运矿镐、图鉴）
// ============================================================================
function handleCloverUse(event, itemId, isGolden) {
  try {
    const player = event.source;
    if (!player || player.typeId !== "minecraft:player") return;

    const dimension = player.dimension;
    const location = player.location;

    consumeOneOf(player, itemId);

    const chosenEvent = isGolden ? rollGoldenCloverEvent() : rollCloverEvent(player);
    log(`use | ${player.name} | ${chosenEvent.id} | golden=${isGolden} | weight=${chosenEvent.weight}`);
    chosenEvent.execute(player, dimension, location);

    if (chosenEvent.id.startsWith("event_G")) {
      recordAlmanacProgress(player, "golden_event", chosenEvent.id);
    } else {
      recordAlmanacProgress(player, "event", chosenEvent.id);
    }
  } catch (e) {
    log("onCompleteUse error:", e);
  }
}

function handlePollenBottleUse(event) {
  try {
    const player = event.source;
    if (!player) return;
    consumeOneOf(player, ITEM_IDS.POLLEN_BOTTLE);
    safeAddEffect(player, "speed", 1200, { amplifier: 1, showParticles: true });
    safeAddEffect(player, "jump_boost", 1200, { amplifier: 1, showParticles: true });
    safeAddEffect(player, "haste", 1200, { amplifier: 0, showParticles: false });
    safeSpawnParticle(player.dimension, "minecraft:crop_growth_emitter", player.location);
    safePlaySound(player, "item.honey_bottle.drink", { pitch: 1.2, volume: 1.0 });
    safeMessage(player, "§e[幸运花粉瓶] 清甜的花粉灵气充盈全身，获得 60 秒速度 II、跳跃提升 II 与急迫 I！");
  } catch (e) {
    log("handlePollenBottleUse error:", e);
  }
}

function handleGreenAmuletUse(event) {
  try {
    const player = event.source;
    if (!player) return;
    const charges = addLeafShield(player, 2, 4);
    safeAddEffect(player, "regeneration", 200, { amplifier: 1, showParticles: true });
    safeAddEffect(player, "resistance", 600, { amplifier: 0, showParticles: true });
    safeSpawnParticle(player.dimension, "minecraft:totem_particle", {
      x: player.location.x,
      y: player.location.y + 1,
      z: player.location.z
    });
    safePlaySound(player, "item.totem.use", { pitch: 1.4, volume: 0.7 });
    safeMessage(player, `§a§l[绿叶护符] §a翡翠叶片环绕护体！获得 2 层绿叶碎盾防护（当前 ${charges} 层）与 30 秒抗性提升！`);
  } catch (e) {
    log("handleGreenAmuletUse error:", e);
  }
}

function handleDestinyBottleUse(event) {
  try {
    const player = event.source;
    if (!player) return;
    const dim = player.dimension;
    const loc = player.location;
    consumeOneOf(player, ITEM_IDS.DESTINY_BOTTLE);

    // 命运祈愿瓶：触发一次高阶命运恩赐或特殊奇迹
    const miracle = pickRandom(GOLDEN_EXCLUSIVE_EVENTS);
    miracle.execute(player, dim, loc);
    safeAddEffect(player, "strength", 900, { amplifier: 1, showParticles: true });
    addLeafShield(player, 2, 4);
    recordAlmanacProgress(player, "golden_event", miracle.id);
    safeMessage(player, "§d§l[命运祈愿瓶] §d星辉与命运之力交织，额外赋予你 45 秒力量 II 与 2 层守护叶盾！");
  } catch (e) {
    log("handleDestinyBottleUse error:", e);
  }
}

function handleWishBowUse(event) {
  try {
    const player = event.source;
    if (!player) return;
    const dim = player.dimension;
    const loc = player.location;
    const view = player.getViewDirection();
    recordAlmanacProgress(player, "equipment", ITEM_IDS.WISH_BOW);

    // 检查是否有幸运花粉可强化箭矢
    const empowered = consumeOneOf(player, ITEM_IDS.LUCKY_POLLEN);
    const spawnPos = {
      x: loc.x + view.x * 1.4,
      y: loc.y + 1.5 + view.y * 1.2,
      z: loc.z + view.z * 1.4
    };

    // 发射本包的独立箭矢模型（lucky:pollen_wish_arrow）；若该实体不可用则回退原版箭
    let arrow = null;
    try {
      arrow = dim.spawnEntity("lucky:pollen_wish_arrow", spawnPos);
    } catch (e) {
      log("pollen_wish_arrow spawn failed, fallback to vanilla arrow:", e);
      try { arrow = dim.spawnEntity("minecraft:arrow", spawnPos); } catch (e2) { log("vanilla arrow spawn failed:", e2); }
    }
    if (arrow) {
      const power = empowered ? 3.2 : 2.5;
      arrow.applyImpulse({ x: view.x * power, y: view.y * power + 0.08, z: view.z * power });
      // 6 秒后自行清场，避免实体堆积
      system.runTimeout(() => { try { arrow.remove(); } catch (e) {} }, 120);
    }
    safePlaySound(player, "random.bow", { pitch: empowered ? 1.35 : 1.15, volume: 1.0 });

    // 沿射线上触发绿叶爆散/减速控制与射手风行加速（带内置冷却）
    if (!isOnCooldown(player, "wish_bow_proc")) {
      setCooldown(player, "wish_bow_proc", 60); // 3 秒内置冷却
      safeAddEffect(player, "speed", 120, { amplifier: 1, showParticles: false });
      const hitCenter = {
        x: loc.x + view.x * 6,
        y: loc.y + 1.0 + view.y * 6,
        z: loc.z + view.z * 6
      };
      safeSpawnParticle(dim, "minecraft:crop_growth_emitter", hitCenter);
      const targets = dim.getEntities({ location: hitCenter, maxDistance: 4.5 });
      for (const t of targets) {
        if (t.id === player.id || t.typeId === "minecraft:item") continue;
        try {
          t.addEffect("slowness", empowered ? 100 : 60, { amplifier: 1, showParticles: true });
          if (empowered) {
            t.applyDamage(5);
          }
        } catch (e) {}
      }
      if (empowered) {
        safeActionBar(player, "§a[四叶祈愿弓] §e消耗 1 份幸运花粉发射【强化祈愿箭】，触发范围绿叶爆散与风行加速！");
      }
    }
  } catch (e) {
    log("handleWishBowUse error:", e);
  }
}

function handlePickaxeUse(event) {
  try {
    const player = event.source;
    if (!player) return;
    recordAlmanacProgress(player, "equipment", ITEM_IDS.PICKAXE);
    triggerOreEchoScan(player, player.dimension, player.location, 10);
  } catch (e) {
    log("handlePickaxeUse error:", e);
  }
}

function handleSeedPacketUse(event) {
  try {
    const player = event.source;
    if (!player) return;
    const dim = player.dimension;
    const loc = player.location;
    const bx = Math.floor(loc.x);
    const by = Math.floor(loc.y);
    const bz = Math.floor(loc.z);
    const below = dim.getBlock({ x: bx, y: by - 1, z: bz });
    const current = dim.getBlock({ x: bx, y: by, z: bz });
    if (below && PLANTABLE_SOILS.has(below.typeId) && current && (current.typeId === "minecraft:air" || current.typeId === "minecraft:short_grass")) {
      consumeOneOf(player, ITEM_IDS.SEED_PACKET);
      current.setType(PLANT_BLOCK_IDS.STAGE_1);
      recordAlmanacProgress(player, "planted");
      safeSpawnParticle(dim, "minecraft:crop_growth_emitter", { x: bx + 0.5, y: by + 0.5, z: bz + 0.5 });
      safePlaySound(player, "dig.grass", { pitch: 1.2, volume: 0.9 });
      safeActionBar(player, "§a[幸运花园] 已在脚下种下四叶草幼苗（阶段一）！");
    } else {
      safeActionBar(player, "§e[四叶草种子包] 请站在草方块、泥土、耕地或苔藓块上使用以播种！");
    }
  } catch (e) {
    log("handleSeedPacketUse error:", e);
  }
}

function handleCultivatorItemUse(event) {
  try {
    const player = event.source;
    if (!player) return;
    const dim = player.dimension;
    const loc = player.location;
    const bx = Math.floor(loc.x);
    const by = Math.floor(loc.y);
    const bz = Math.floor(loc.z);

    // 扫描玩家周围 2 格内的成熟四叶草植株（阶段三或野生幸运四叶草）
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          const b = dim.getBlock({ x: bx + dx, y: by + dy, z: bz + dz });
          if (b && (b.typeId === PLANT_BLOCK_IDS.STAGE_3 || b.typeId === PLANT_BLOCK_IDS.WILD_LUCKY)) {
            consumeOneOf(player, ITEM_IDS.CULTIVATOR);
            if (Math.random() < 0.65) {
              const mutatedId = resolveEnvironmentMutation(dim, b.location, true);
              b.setType(mutatedId);
              recordAlmanacProgress(player, "mutation", mutatedId);
              safeSpawnParticle(dim, "minecraft:totem_particle", { x: b.location.x + 0.5, y: b.location.y + 0.6, z: b.location.z + 0.5 });
              safePlaySound(player, "random.levelup", { pitch: 1.35, volume: 1.0 });
              safeMessage(player, `§6§l[金露培育·变异成功] §e身旁的四叶草植株成功变异为【${mutatedId.replace("lucky:", "")}】！`);
            } else {
              spawnGiftItem(dim, b.location, ITEM_IDS.LUCKY_POLLEN, 1);
              safePlaySound(player, "item.bone_meal.use", { pitch: 0.9, volume: 1.0 });
              safeMessage(player, "§e[金露培育] 本次变异尝试未完全突破，植株产出了 1 份幸运花粉。");
            }
            return;
          }
        }
      }
    }
    safeActionBar(player, "§e[金露培育剂] 请靠近成熟的四叶草植株（阶段三）使用以诱导变异！");
  } catch (e) {
    log("handleCultivatorItemUse error:", e);
  }
}

// ============================================================================
// 4. 战斗、护盾、套装反击与武器特效监听 (entityHurt & entityDie)
// ============================================================================
function onEntityHurt(event) {
  try {
    const hurtEntity = event.hurtEntity;
    const attacker = event.damageSource?.damagingEntity;
    const damage = event.damage ?? 1;

    // A. 当玩家受伤时：检查绿叶护盾、藤叶胸甲/四件套、金叶胸甲/四件套、命运行者胸甲
    if (hurtEntity && hurtEntity.typeId === "minecraft:player") {
      const player = hurtEntity;
      const pDim = player.dimension;
      const pLoc = player.location;

      // 1) 守护绿叶/黄金护盾抵伤
      if (consumeLeafShield(player)) {
        safeAddEffect(player, "regeneration", 100, { amplifier: 2, showParticles: true });
        safeAddEffect(player, "absorption", 200, { amplifier: 0, showParticles: true });
        safeSpawnParticle(pDim, "minecraft:totem_particle", { x: pLoc.x, y: pLoc.y + 1, z: pLoc.z });
        safePlaySound(player, "random.glass", { pitch: 1.3, volume: 0.9 });
        safeActionBar(player, `§a[守护绿叶] 一片护体绿叶破碎，为你化解冲击并恢复生命！（剩余护盾：${getLeafShield(player)}）`);
      }

      // 2) 幸运藤叶套装：胸甲减伤与 4 件套【自然护佑】
      const vineCount = getArmorSetCount(player, "vine");
      if (vineCount >= 1 && damage >= 3 && !isOnCooldown(player, "vine_armor_guard")) {
        setCooldown(player, "vine_armor_guard", 240); // 12 秒冷却
        safeAddEffect(player, "resistance", 80, { amplifier: 0, showParticles: true });
        safeAddEffect(player, "regeneration", 80, { amplifier: 0, showParticles: true });
        safeSpawnParticle(pDim, "minecraft:crop_growth_emitter", pLoc);
      }
      if (vineCount >= 4 && !isOnCooldown(player, "vine_4pc_blessing")) {
        setCooldown(player, "vine_4pc_blessing", 600); // 30 秒冷却
        addLeafShield(player, 1, 4);
        safeAddEffect(player, "absorption", 300, { amplifier: 0, showParticles: true });
        safeAddEffect(player, "regeneration", 120, { amplifier: 1, showParticles: true });
        safeMessage(player, "§a[幸运藤叶·四件套] 触发【自然护佑】，藤蔓为你编织出绿叶护盾与生命甘霖！");
      }

      // 3) 金叶守护套装：胸甲与 4 件套【金色护佑】
      const goldCount = getArmorSetCount(player, "golden_leaf");
      if (goldCount >= 4 && !isOnCooldown(player, "gold_4pc_aegis")) {
        setCooldown(player, "gold_4pc_aegis", 700); // 35 秒冷却
        addLeafShield(player, 2, 4);
        safeAddEffect(player, "absorption", 400, { amplifier: 1, showParticles: true });
        safeAddEffect(player, "resistance", 200, { amplifier: 1, showParticles: true });
        safeSpawnParticle(pDim, "minecraft:totem_particle", { x: pLoc.x, y: pLoc.y + 1, z: pLoc.z });
        safePlaySound(player, "item.totem.use", { pitch: 1.3, volume: 0.7 });
        safeMessage(player, "§6§l[金叶守护·四件套] §e触发【金色护佑】，金叶圣盾为你凝结 2 层叶盾与高阶抗性！");
      }

      // 4) 命运行者套装：受击激发战斗潜能
      const destinyCount = getArmorSetCount(player, "destiny");
      if (destinyCount >= 2 && !isOnCooldown(player, "destiny_counter")) {
        setCooldown(player, "destiny_counter", 200); // 10 秒冷却
        safeAddEffect(player, "strength", 100, { amplifier: 0, showParticles: true });
        safeAddEffect(player, "speed", 100, { amplifier: 1, showParticles: true });
      }
    }

    // B. 当玩家作为攻击者命中目标时：检查翠藤短刃、命运镰刃、命运行者 2 件套、四叶守护灵阶段机制
    if (attacker && attacker.typeId === "minecraft:player" && hurtEntity) {
      const player = attacker;
      const dim = hurtEntity.dimension;
      const tLoc = hurtEntity.location;
      const eq = player.getComponent("minecraft:equippable");
      const mainhand = eq?.getEquipment(EquipmentSlot.Mainhand);
      const weaponId = mainhand?.typeId;

      // 1) 四叶守护灵 Boss 护盾与黄金弱点结算
      if (hurtEntity.typeId === ENTITY_IDS.GUARDIAN) {
        const bState = getGuardianBattleState(hurtEntity.id);
        if (bState) {
          if (bState.shieldActive) {
            // 阶段一藤蔓护盾开启期间，回复部分生命模拟正面减伤并弹开提示
            const hp = hurtEntity.getComponent("minecraft:health");
            if (hp) {
              hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + damage * 0.55));
            }
            safePlaySound(player, "item.shield.block", { pitch: 1.2, volume: 0.8 });
          } else if (bState.weaknessWindow) {
            // 阶段三黄金弱点窗口，额外造成 4 点弱点伤害
            const hp = hurtEntity.getComponent("minecraft:health");
            if (hp && hp.currentValue > 5) {
              hp.setCurrentValue(Math.max(1, hp.currentValue - 4));
            }
            safeSpawnParticle(dim, "minecraft:totem_particle", { x: tLoc.x, y: tLoc.y + 1.2, z: tLoc.z });
            safePlaySound(player, "chime.amethyst_block", { pitch: 1.5, volume: 1.0 });
          }
        }
      }

      // 2) 武器一：翠藤短刃 (lucky:emerald_vine_dagger) —— 机动与藤蔓束缚控制
      if (weaponId === ITEM_IDS.DAGGER) {
        recordAlmanacProgress(player, "equipment", ITEM_IDS.DAGGER);
        if (Math.random() < 0.35) {
          safeRun("dagger bind", () => {
            hurtEntity.addEffect("slowness", 60, { amplifier: 2, showParticles: true });
          });
          safeAddEffect(player, "speed", 60, { amplifier: 1, showParticles: false });
          safeSpawnParticle(dim, PARTICLE_IDS.NATURE_SWIRL, tLoc);
          safePlaySound(player, "step.vine", { pitch: 1.2, volume: 0.9 });
          safeActionBar(player, "§a[翠藤短刃] 触发【藤蔓束缚】，禁锢目标并提升自身机动！");
        }
      }

      // 3) 武器二：命运镰刃 (lucky:destiny_scythe) —— 三态命运判定（暴击 / 恩赐 / 可控反噬）
      if (weaponId === ITEM_IDS.SCYTHE && !isOnCooldown(player, "destiny_scythe_proc")) {
        setCooldown(player, "destiny_scythe_proc", 30); // 1.5 秒内置冷却
        recordAlmanacProgress(player, "equipment", ITEM_IDS.SCYTHE);
        const roll = Math.random();
        const hasDestiny4pc = getArmorSetCount(player, "destiny") >= 4;

        if (roll < 0.45) {
          // 45%：强化横扫攻击
          safeSpawnParticle(dim, PARTICLE_IDS.DESTINY_PULSE, { x: tLoc.x, y: tLoc.y + 1, z: tLoc.z });
          safePlaySound(player, "sweep", { pitch: 1.1, volume: 1.0 });
          const nearby = dim.getEntities({ location: tLoc, maxDistance: 3.0 });
          for (const ne of nearby) {
            if (ne.id !== player.id && ne.typeId !== "minecraft:item") {
              try { ne.applyDamage(4); } catch (e) {}
            }
          }
          safeActionBar(player, "§d§l[命运镰刃·星辉强化] §d镰刃激发命运横扫，对周围敌人造成额外星辉伤害！");
        } else if (roll < 0.80) {
          // 35%：为持有者提供短暂增益
          safeAddEffect(player, "strength", 120, { amplifier: 1, showParticles: true });
          safeAddEffect(player, "speed", 120, { amplifier: 1, showParticles: false });
          safeAddEffect(player, "regeneration", 80, { amplifier: 0, showParticles: false });
          safeActionBar(player, "§b[命运镰刃·命运眷顾] 获得 6 秒力量 II、速度 II 与生命恢复！");
        } else {
          // 20%：轻微可控反噬（若穿戴命运行者四件套则反噬转化为增益）
          if (hasDestiny4pc) {
            safeAddEffect(player, "strength", 100, { amplifier: 1, showParticles: true });
            safeActionBar(player, "§5[命运镰刃·行者逆转] 命运行者套装将镰刃反噬逆转为【力量 II】！");
          } else {
            safeAddEffect(player, "slowness", 45, { amplifier: 0, showParticles: false });
            safeActionBar(player, "§7[命运镰刃·轻微反噬] 镰刃的命运波动使你步伐微滞 2 秒！");
          }
        }
      }

      // 4) 命运行者两件套：攻击附带星火溅射
      if (getArmorSetCount(player, "destiny") >= 2 && Math.random() < 0.25) {
        safeSpawnParticle(dim, "minecraft:endrod", { x: tLoc.x, y: tLoc.y + 1, z: tLoc.z });
      }
    }
  } catch (e) {
    log("onEntityHurt error:", e);
  }
}

function onEntityDie(event) {
  try {
    const dead = event.deadEntity;
    const killer = event.damageSource?.damagingEntity;
    if (!dead) return;
    // 实体被 /kill 或其它方式移除时，在这一帧里可能已经失效；直接读属性会抛
    // InvalidEntityError，旧版会往控制台刷十几行错误。先探测，失效就安静返回。
    let dim, loc, deadTypeId;
    try {
      dim = dead.dimension;
      loc = dead.location;
      deadTypeId = dead.typeId;
    } catch (e) {
      return;
    }

    // 1) 四叶守护灵 Boss 击败结算演出与专属奖励
    if (deadTypeId === ENTITY_IDS.GUARDIAN) {
      safeSpawnParticle(dim, "minecraft:totem_particle", { x: loc.x, y: loc.y + 1.5, z: loc.z });
      spawnGiftItem(dim, loc, ITEM_IDS.GUARDIAN_EMBLEM, 1);
      spawnGiftItem(dim, loc, ITEM_IDS.NATURE_ESSENCE, randInt(2, 3));
      spawnGiftItem(dim, loc, ITEM_IDS.DESTINY_SHARD, randInt(1, 2));
      spawnGiftItem(dim, loc, PLANT_BLOCK_IDS.MOONLIGHT, 1);

      for (const p of dim.getPlayers({ location: loc, maxDistance: 36 })) {
        recordAlmanacProgress(p, "guardian_win", "flawless");
        safePlaySound(p, "ui.toast.challenge_complete", { pitch: 1.0, volume: 1.0 });
        safeMessage(
          p,
          "§6§l========================================\n" +
          "§e§l★ 试炼完成：成功击败【四叶守护灵】！ ★\n" +
          "§a已掉落：【守护灵印记】、【自然精华】、【命运碎片】与【月辉四叶草】！\n" +
          "§6§l========================================"
        );
      }
      return;
    }

    // 2) 玩家击杀普通生物时的翠藤短刃掉落与命运行者战靴加速
    if (killer && killer.typeId === "minecraft:player") {
      const player = killer;
      const eq = player.getComponent("minecraft:equippable");
      const mainhand = eq?.getEquipment(EquipmentSlot.Mainhand);
      if (mainhand?.typeId === ITEM_IDS.DAGGER && Math.random() < 0.25) {
        spawnGiftItem(dim, loc, Math.random() < 0.6 ? ITEM_IDS.CLOVER_LEAF : ITEM_IDS.LUCKY_POLLEN, 1);
      }
      if (getArmorSetCount(player, "destiny") >= 1) {
        safeAddEffect(player, "speed", 100, { amplifier: 1, showParticles: false });
      }
    }
  } catch (e) {
    log("onEntityDie error:", e);
  }
}

// ============================================================================
// 5. 迷路的旅人 (lucky:wandering_traveler) 三选一交互处理
// ============================================================================
const travelerSelectionMap = new Map(); // player.id -> 0 | 1 | 2
const TRAVELER_OPTIONS = [
  {
    name: "① 园艺培育礼盒（四叶草种子包x2 + 金露培育剂x1 + 晨露珠x2）",
    give(dim, loc) {
      spawnGiftItem(dim, loc, ITEM_IDS.SEED_PACKET, 2);
      spawnGiftItem(dim, loc, ITEM_IDS.CULTIVATOR, 1);
      spawnGiftItem(dim, loc, ITEM_IDS.MORNING_DEW, 2);
    }
  },
  {
    name: "② 矿脉探险礼盒（黄金露珠x2 + 绿宝石x4 + 幸运花粉瓶x1）",
    give(dim, loc) {
      spawnGiftItem(dim, loc, ITEM_IDS.GOLDEN_DEW, 2);
      spawnGiftItem(dim, loc, "minecraft:emerald", 4);
      spawnGiftItem(dim, loc, ITEM_IDS.POLLEN_BOTTLE, 1);
    }
  },
  {
    name: "③ 神秘命运盲盒（自然精华x1 + 随机稀有四叶草植株x1）",
    give(dim, loc) {
      spawnGiftItem(dim, loc, ITEM_IDS.NATURE_ESSENCE, 1);
      const rare = pickRandom([PLANT_BLOCK_IDS.GOLD_VEIN, PLANT_BLOCK_IDS.MORNING_DEW, PLANT_BLOCK_IDS.MOONLIGHT]);
      spawnGiftItem(dim, loc, rare, 1);
    }
  }
];

function onPlayerInteractWithEntity(event) {
  try {
    const { player, target } = event;
    if (!player || !target || target.typeId !== ENTITY_IDS.TRAVELER) return;

    if (isOnCooldown(player, "traveler_interact")) return;
    setCooldown(player, "traveler_interact", 8);

    const curIdx = travelerSelectionMap.get(player.id) || 0;
    if (player.isSneaking) {
      const nextIdx = (curIdx + 1) % TRAVELER_OPTIONS.length;
      travelerSelectionMap.set(player.id, nextIdx);
      safePlaySound(player, "random.click", { pitch: 1.2, volume: 1.0 });
      safeActionBar(player, `§e[迷路的旅人] 已切换回礼选项：§a${TRAVELER_OPTIONS[nextIdx].name} §7(普通右键确认领取)`);
      return;
    }

    const chosen = TRAVELER_OPTIONS[curIdx];
    safePlayAnimation(target, "animation.wandering_traveler.offer_gift");
    chosen.give(target.dimension, target.location);
    safeSpawnParticle(target.dimension, "minecraft:heart_particle", {
      x: target.location.x,
      y: target.location.y + 1.5,
      z: target.location.z
    });
    safePlaySound(player, "mob.wanderingtrader.yes", { pitch: 1.2, volume: 1.0 });
    safeMessage(player, `§e[迷路的旅人] 「感谢你的指点！这是送给你的 §a${chosen.name}§e，祝旅途好运！」`);
    system.run(() => {
      try { if (target.isValid()) target.remove(); } catch (e) {}
    });
  } catch (e) {
    log("onPlayerInteractWithEntity error:", e);
  }
}

// ============================================================================
// 6. 套装常驻效果 & 稀有野生植物靠近提示粒子循环
// ============================================================================
function tickArmorAndEcologyRadar() {
  for (const player of world.getAllPlayers()) {
    try {
      refreshOffhandLuck(player);

      const equippedIds = getEquippedArmorIds(player);
      for (const eid of equippedIds) {
        if (eid && eid.startsWith("lucky:")) {
          recordAlmanacProgress(player, "equipment", eid);
        }
      }

      const dim = player.dimension;
      const loc = player.location;

      // 1) 花粉护腿 / 金叶护腿 / 逐风靴 自然地形机动辅助
      if (equippedIds.includes("lucky:vine_leggings") || equippedIds.includes("lucky:golden_leaf_leggings")) {
        const below = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y) - 1, z: Math.floor(loc.z) });
        if (below && PLANTABLE_SOILS.has(below.typeId)) {
          safeAddEffect(player, "speed", 120, { amplifier: 0, showParticles: false });
        }
      }
      if (equippedIds.includes("lucky:vine_boots")) {
        safeAddEffect(player, "jump_boost", 120, { amplifier: 0, showParticles: false });
      }
      if (equippedIds.includes("lucky:golden_leaf_boots")) {
        safeAddEffect(player, "fire_resistance", 120, { amplifier: 0, showParticles: false });
      }
      if (equippedIds.includes("lucky:golden_leaf_helmet")) {
        const shields = getLeafShield(player);
        if (shields > 0) {
          safeActionBar(player, `§6[金叶冠冕] 当前守护叶盾层数：§a${"🍀".repeat(shields)} (${shields}/4)`);
        }
      }

      // 2) 稀有野生植物靠近微光线索（普通距离 5 格，佩戴【幸运叶冠】或【命运行者兜帽】扩展至 10 格）
      const hasRadarHelmet = equippedIds.includes("lucky:vine_helmet") || equippedIds.includes("lucky:destiny_helmet");
      const scanRadius = hasRadarHelmet ? 9 : 4;
      const bx = Math.floor(loc.x);
      const by = Math.floor(loc.y);
      const bz = Math.floor(loc.z);
      let foundRare = null;

      for (let dx = -scanRadius; dx <= scanRadius && !foundRare; dx += 2) {
        for (let dy = -2; dy <= 2 && !foundRare; dy++) {
          for (let dz = -scanRadius; dz <= scanRadius && !foundRare; dz += 2) {
            try {
              const b = dim.getBlock({ x: bx + dx, y: by + dy, z: bz + dz });
              if (b && RARE_CLOVER_PLANTS.has(b.typeId)) {
                foundRare = { id: b.typeId, x: bx + dx + 0.5, y: by + dy + 0.6, z: bz + dz + 0.5 };
              }
            } catch (e) {}
          }
        }
      }

      if (foundRare) {
        const isGoldOrShrine = foundRare.id === PLANT_BLOCK_IDS.GOLD_VEIN || foundRare.id === PLANT_BLOCK_IDS.SHRINE;
        safeSpawnParticle(dim, isGoldOrShrine ? "minecraft:wax_on_particle" : "minecraft:villager_happy", foundRare);
        if (hasRadarHelmet) {
          safePlaySound(player, "chime.amethyst_block", { pitch: 1.4, volume: 0.35 });
        }
      }
    } catch (e) {
      log("tickArmorAndEcologyRadar player error:", e);
    }
  }
}

// ============================================================================
// 7. 激活并安装所有事件与自定义组件
// ============================================================================
export function install() {
  world.afterEvents.playerBreakBlock.subscribe(onPlayerBreakBlock);

  try {
    world.afterEvents.playerInteractWithBlock?.subscribe((ev) => {
      handleBlockInteraction(ev.player, ev.block);
    });
  } catch (e) {
    log("playerInteractWithBlock subscribe skipped:", e);
  }

  try {
    world.afterEvents.playerInteractWithEntity?.subscribe(onPlayerInteractWithEntity);
  } catch (e) {
    log("playerInteractWithEntity subscribe skipped:", e);
  }

  try {
    world.afterEvents.entityHurt?.subscribe(onEntityHurt);
  } catch (e) {
    log("entityHurt subscribe skipped:", e);
  }

  try {
    world.afterEvents.entityDie?.subscribe(onEntityDie);
  } catch (e) {
    log("entityDie subscribe skipped:", e);
  }

  // 注册物品与方块自定义组件（兼容 1.x worldInitialize 与 2.x startup）
  let componentsRegistered = false;
  const registerAllCustomComponents = (initEvent, source) => {
    if (componentsRegistered) return;
    const itemReg = initEvent?.itemComponentRegistry;
    const blockReg = initEvent?.blockComponentRegistry;
    if (!itemReg && !blockReg) return;
    componentsRegistered = true;

    if (itemReg) {
      itemReg.registerCustomComponent("lucky:clover_use", {
        onCompleteUse(event) { handleCloverUse(event, CLOVER_ITEM_ID, false); }
      });
      itemReg.registerCustomComponent("lucky:golden_clover_use", {
        onCompleteUse(event) { handleCloverUse(event, GOLDEN_CLOVER_ITEM_ID, true); }
      });
      itemReg.registerCustomComponent("lucky:seed_packet_use", {
        onCompleteUse(event) { handleSeedPacketUse(event); }
      });
      itemReg.registerCustomComponent("lucky:pollen_bottle_use", {
        onCompleteUse(event) { handlePollenBottleUse(event); }
      });
      itemReg.registerCustomComponent("lucky:cultivator_use", {
        onCompleteUse(event) { handleCultivatorItemUse(event); }
      });
      itemReg.registerCustomComponent("lucky:amulet_use", {
        onCompleteUse(event) { handleGreenAmuletUse(event); }
      });
      itemReg.registerCustomComponent("lucky:destiny_bottle_use", {
        onCompleteUse(event) { handleDestinyBottleUse(event); }
      });
      itemReg.registerCustomComponent("lucky:almanac_use", {
        onCompleteUse(event) { handleAlmanacUse(event.source); }
      });
      itemReg.registerCustomComponent("lucky:wish_bow_use", {
        onCompleteUse(event) { handleWishBowUse(event); }
      });
      itemReg.registerCustomComponent("lucky:pickaxe_use", {
        onCompleteUse(event) { handlePickaxeUse(event); }
      });
    }

    if (blockReg) {
      blockReg.registerCustomComponent("lucky:plant_behavior", {
        onPlayerInteract(event) {
          handleBlockInteraction(event.player, event.block);
        }
      });
      blockReg.registerCustomComponent("lucky:crop_tick", {
        onTick(event) {
          handleCropTick(event.block, event.dimension);
        }
      });
      blockReg.registerCustomComponent("lucky:shrine_interact", {
        onPlayerInteract(event) {
          handleShrineInteraction(event.player, event.block, event.dimension);
        }
      });
    }

    log(`custom components registered via ${source}`);
  };

  const trySignal = (label, getter, use) => {
    try {
      const signal = getter();
      if (!signal) return false;
      signal.subscribe(use);
      log(`component registry path armed: ${label}`);
      return true;
    } catch (e) {
      log(`component registry path unavailable: ${label} (${e})`);
      return false;
    }
  };

  trySignal(
    "world.beforeEvents.worldInitialize (1.x)",
    () => world.beforeEvents?.worldInitialize,
    (initEvent) => registerAllCustomComponents(initEvent, "worldInitialize (1.x)")
  );
  trySignal(
    "system.beforeEvents.startup (2.x)",
    () => system.beforeEvents?.startup,
    (startupEvent) => registerAllCustomComponents(startupEvent, "system.beforeEvents.startup (2.x)")
  );



  // 新玩家入场时在身边先种一小片野生四叶草，保证一眼能看到
  let welcomeSeeded = false;
  world.afterEvents.playerSpawn.subscribe((ev) => {
    if (!ev.initialSpawn) return;
    const pl = ev.player;
    system.runTimeout(() => {
      try {
        for (let i = 0; i < 3; i++) tryNaturalCloverSpawn(pl);
      } catch (e) {}
    }, 60);
    void welcomeSeeded;
  });

  // 既有世界的自然播种（老存档区块不会再生成）
  system.runInterval(() => {
    try {
      for (const p of world.getAllPlayers()) {
        if (Math.random() < 0.5) tryNaturalCloverSpawn(p);
      }
    } catch (e) {}
  }, 120);

  // 每 5 秒执行一次副手祝福、盔甲套装被动与稀有四叶草生态感知雷达
  system.runInterval(tickArmorAndEcologyRadar, OFFHAND_LUCK_INTERVAL_TICKS);

  // 清理上次重载遗留的临时奇遇生物（防止生物堆积，遵守 12.6 性能预算）
  const sweepOrphanEntities = (label) => {
    try {
      let removed = 0;
      for (const dimId of ["overworld", "nether", "the_end"]) {
        const dim = world.getDimension(dimId);
        for (const e of dim.getEntities({ type: "minecraft:allay" })) {
          if (e.nameTag === "§b四叶草伴舞精灵") { e.remove(); removed++; }
        }
      }
      if (removed > 0) log(`orphan cleanup | ${label} | removed=${removed}`);
    } catch (e) {
      log("orphan cleanup failed:", e);
    }
  };
  for (const delay of [40, 200, 600]) system.runTimeout(() => sweepOrphanEntities("t" + delay), delay);

  const golden = goldenPoolInfo();
  log(`Lucky Clover: Nature & Destiny v2.1.19 loaded | MCBE 1.21.60+ | events=${CLOVER_EVENTS.length} totalWeight=${TOTAL_WEIGHT} | goldenPool=${golden.count}/${golden.weight}`);
}

install();
