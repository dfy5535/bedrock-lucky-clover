/*
 * main.js —— 幸运四叶草生产接线（事件订阅 + 自定义组件注册 + 副手被动）
 * 所有玩法逻辑都在 lucky_core.js，测试钩子（main_test.js）复用同一份核心。
 *
 * 兼容基线（v1.1.0）：@minecraft/server 1.12.0 ⇔ Minecraft 1.21.10
 *   本次向下兼容的关键 API 门槛全部落在 1.12.0：
 *     · world.beforeEvents.worldInitialize / WorldInitializeBeforeEvent  → 1.12.0 新增
 *     · ItemComponentRegistry.registerCustomComponent                    → 1.12.0 新增
 *     · ItemComponentCompleteUseEvent.onCompleteUse                      → 1.12.0 新增
 *   次高门槛：ItemEnchantableComponent 1.11.0（1.21.0）、ItemDurabilityComponent 1.9.0（1.20.70）。
 *   1.12.0 之前的版本不可能运行本包，故声明 1.12.0 即为真实下限，不再虚高。
 */
import { world, system, ItemStack, GameMode, EquipmentSlot } from "@minecraft/server";
import {
  GRASS_DROP_RATES,
  CLOVER_ITEM_ID,
  GOLDEN_CLOVER_ITEM_ID,
  CLOVER_EVENTS,
  TOTAL_WEIGHT,
  OFFHAND_LUCK_INTERVAL_TICKS,
  OFFHAND_BLESSING_EFFECT,
  evaluateDrop,
  rollCloverEvent,
  rollGoldenCloverEvent,
  goldenPoolInfo,
  consumeOneOf,
  refreshOffhandLuck,
  log
} from "./lucky_core.js";

// ============================================================================
// 2. 监听玩家破坏野草事件 (world.afterEvents.playerBreakBlock)
// ============================================================================
function onPlayerBreakBlock(event) {
  try {
    const { player, block, brokenBlockPermutation } = event;
    const brokenId = brokenBlockPermutation.type.id;

    // 仅当破坏的是 4 种野草时才继续判定
    if (GRASS_DROP_RATES[brokenId] === undefined) return;

    // 采集主手信息（防刷校验 + 时运加成）
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

    // 与测试钩子共用同一条判定路径
    const verdict = evaluateDrop({
      blockId: brokenId,
      isCreative: player.getGameMode() === GameMode.creative,
      mainhandTypeId,
      hasSilkTouch,
      fortuneLevel,
      roll: Math.random()
    });

    if (!verdict.applicable || !verdict.dropped) return;

    const dimension = block.dimension;
    const centerPos = {
      x: block.location.x + 0.5,
      y: block.location.y + 0.35,
      z: block.location.z + 0.5
    };
    dimension.spawnItem(new ItemStack(CLOVER_ITEM_ID, 1), centerPos);
    safeParticle(dimension, centerPos);
    try {
      player.playSound("block.sweet_berry_bush.pick_berries", { pitch: 1.25, volume: 0.9 });
    } catch (e) {
      log("playSound failed:", e);
    }
    log(`drop ok | ${player.name} | ${brokenId} | chance=${verdict.finalChance.toFixed(3)} | pos=${block.location.x},${block.location.y},${block.location.z}`);
  } catch (e) {
    log("playerBreakBlock handler error:", e);
  }
}

function safeParticle(dimension, pos) {
  try {
    dimension.spawnParticle("minecraft:villager_happy", pos);
  } catch (e) {
    log("spawnParticle failed:", e);
  }
}

// ============================================================================
// 4. 使用物品的公共处理（普通四叶草 / 金叶四叶草）
// ============================================================================
function handleCloverUse(event, itemId, isGolden) {
  try {
    const player = event.source;
    if (!player || player.typeId !== "minecraft:player") return;

    const dimension = player.dimension;
    const location = player.location;

    // 非创造模式下消耗 1 株
    consumeOneOf(player, itemId);

    const chosenEvent = isGolden ? rollGoldenCloverEvent() : rollCloverEvent();
    log(`use | ${player.name} | ${chosenEvent.id} | golden=${isGolden} | weight=${chosenEvent.weight}`);
    chosenEvent.execute(player, dimension, location);
  } catch (e) {
    log("onCompleteUse error:", e);
  }
}

export function install() {
  world.afterEvents.playerBreakBlock.subscribe(onPlayerBreakBlock);

  // ==========================================================================
  // 5. 注册物品自定义组件
  //   两条注册通路，运行时探测后择一（同一份源码同时适配 1.x 与 2.x API 面）：
  //     · 1.12.0 ~ 1.x ：world.beforeEvents.worldInitialize → WorldInitializeBeforeEvent
  //     · 2.0.0+        ：worldInitialize 已被移除，改为 system.beforeEvents.startup
  //                       → StartupEvent（其 itemComponentRegistry 同名）
  //   旧版引擎两者都走第一条；未来只有 2.x API 面的引擎自动走第二条，不会哑火。
  // ==========================================================================
  let componentsRegistered = false;
  const registerComponents = (registry, source) => {
    if (componentsRegistered || !registry) return;
    componentsRegistered = true;
    registry.registerCustomComponent("lucky:clover_use", {
      onCompleteUse(event) { handleCloverUse(event, CLOVER_ITEM_ID, false); }
    });
    registry.registerCustomComponent("lucky:golden_clover_use", {
      onCompleteUse(event) { handleCloverUse(event, GOLDEN_CLOVER_ITEM_ID, true); }
    });
    log(`item components registered via ${source}`);
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

  const legacyArmed = trySignal(
    "world.beforeEvents.worldInitialize (1.x)",
    () => world.beforeEvents?.worldInitialize,
    (initEvent) => registerComponents(initEvent.itemComponentRegistry, "worldInitialize (1.x)")
  );
  const startupArmed = trySignal(
    "system.beforeEvents.startup (2.x)",
    () => system.beforeEvents?.startup,
    (startupEvent) => registerComponents(startupEvent.itemComponentRegistry, "system.beforeEvents.startup (2.x)")
  );

  if (!legacyArmed && !startupArmed) {
    log("no component registry signal available on this engine — custom item components disabled");
  }

  // ==========================================================================
  // 6. 二期：夹在书里的四叶草书签 —— 副手持有四叶草时持续提供无粒子幸运 I
  // ==========================================================================
  system.runInterval(() => {
    try {
      for (const player of world.getAllPlayers()) refreshOffhandLuck(player);
    } catch (e) {
      log("offhand luck tick error:", e);
    }
  }, OFFHAND_LUCK_INTERVAL_TICKS);

  // 清理上一次运行遗留的伴舞悦灵：脚本重载或服务器重启会丢失 runTimeout，
  // 导致悦灵永久留在世界里（违背策划案「防止生物堆积」的意图）。
  const sweepOrphanAllays = (label) => {
    try {
      let removed = 0;
      for (const dimId of ["overworld", "nether", "the_end"]) {
        const dim = world.getDimension(dimId);
        for (const e of dim.getEntities({ type: "minecraft:allay" })) {
          if (e.nameTag === "§b四叶草伴舞精灵") { e.remove(); removed++; }
        }
      }
      if (removed > 0) log(`orphan allay cleanup | ${label} | removed=${removed}`);
    } catch (e) {
      log("orphan allay cleanup failed:", e);
    }
  };
  // 实体从存档载入可能晚于脚本加载，故多次重试
  for (const delay of [40, 200, 600]) system.runTimeout(() => sweepOrphanAllays("t" + delay), delay);

  const golden = goldenPoolInfo();
  log(`script loaded | v1.1.0 compat (min MC 1.21.10 / @minecraft/server 1.12.0) | events=${CLOVER_EVENTS.length} totalWeight=${TOTAL_WEIGHT} | playerBreakBlock subscribed | goldenPool=${golden.count}/${golden.weight} | offhandBlessing=${OFFHAND_BLESSING_EFFECT} every ${OFFHAND_LUCK_INTERVAL_TICKS} ticks`);
}

install();
