import { State, SpatialMemoryEntry } from './types'; // Import SpatialMemoryEntry
import { Bot } from 'mineflayer';
import { IndexedData } from 'minecraft-data'; // Import mcData type
import { MemoryManager } from './memory'; // Import MemoryManager
import { Vec3 } from 'vec3'; // Import Vec3

export class ObserveManager {
  private bot: Bot;
  private mcData: IndexedData; // Store mcData instance
  private memoryManager: MemoryManager; // Store MemoryManager instance
  private observationRadius = 5; // How far around the bot to observe spatially

  constructor(bot: Bot, mcData: IndexedData, memoryManager: MemoryManager) { // Accept MemoryManager
    this.bot = bot;
    this.mcData = mcData; // Store it
    this.memoryManager = memoryManager; // Store it
  }

  // Return only Surroundings and Inventory updates
  async observe(currentState: State): Promise<Pick<State, 'surroundings' | 'inventory'>> {
    console.log("--- Running Observe Manager ---");
    
    // Update state with current observations
    const position = this.bot.entity.position;
    
    // Get inventory - directly from bot
    const inventory: Record<string, number> = {};
    this.bot.inventory.items().forEach(item => {
      inventory[item.name] = (inventory[item.name] || 0) + item.count;
    });
    
    // Get nearby blocks
    const nearbyBlocks: string[] = [];
    for (let x = -5; x <= 5; x++) {
      for (let y = -5; y <= 5; y++) {
        for (let z = -5; z <= 5; z++) {
          const block = this.bot.blockAt(position.offset(x, y, z));
          if (block && block.name !== 'air') {
            nearbyBlocks.push(block.name);
          }
        }
      }
    }
    
    // Get nearby entities
    const nearbyEntities = Object.values(this.bot.entities)
      .filter((entity: any) => entity.position.distanceTo(this.bot.entity.position) < 10)
      .map((entity: any) => entity.name || entity.username || entity.type);
    
    // Check for inventory discrepancies between state and actual bot inventory
    if (currentState.inventory && currentState.inventory.items) {
      let discrepancyFound = false;
      
      // Check items in state that might not be in actual inventory
      for (const [itemName, count] of Object.entries(currentState.inventory.items)) {
        if (!inventory[itemName] || inventory[itemName] !== count) {
          console.warn(`[ObserveManager] Inventory discrepancy: State shows ${count} ${itemName}, but bot has ${inventory[itemName] || 0}`);
          discrepancyFound = true;
        }
      }
      
      // Check items in actual inventory that might not be in state
      for (const [itemName, count] of Object.entries(inventory)) {
        if (!currentState.inventory.items[itemName] || currentState.inventory.items[itemName] !== count) {
          console.warn(`[ObserveManager] Inventory discrepancy: Bot has ${count} ${itemName}, but state shows ${currentState.inventory.items[itemName] || 0}`);
          discrepancyFound = true;
        }
      }
      
      if (discrepancyFound) {
        console.log(`[ObserveManager] Correcting inventory state to match actual bot inventory`);
      }
    }

    // --- Spatial Observation ---
    const spatialUpdates: Record<string, SpatialMemoryEntry> = {};
    const now = Date.now();
    const radius = this.observationRadius;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const relativePos = new Vec3(dx, dy, dz);
          const absolutePos = position.plus(relativePos);
          const block = this.bot.blockAt(absolutePos);
          if (block && block.name !== 'air') {
            const coordKey = `${absolutePos.x.toFixed(0)},${absolutePos.y.toFixed(0)},${absolutePos.z.toFixed(0)}`;
            spatialUpdates[coordKey] = {
              blockName: block.name,
              timestamp: now,
              // entities: [] // TODO: Add nearby entity info here if needed
            };
          }
        }
      }
    }
    // Update spatial memory directly
    await this.memoryManager.updateSpatialMemory(spatialUpdates);
    // --- End Spatial Observation ---

    // Get time and biome with more detailed time information
    const timeOfDay = this.bot.time.timeOfDay;
    const isDay = (timeOfDay >= 0 && timeOfDay < 13000) || timeOfDay > 23000;
    const isNight = timeOfDay >= 13000 && timeOfDay <= 23000;
    const timeDescription = isDay ? "day" : "night";
    const biomeId = this.bot.world.getBiome(position.floored()); // Get biome ID
    const biomeName = this.mcData.biomes[biomeId]?.name ?? 'unknown'; // Convert ID to name using mcData

    // Return the updated parts of the state
    return {
      inventory: { items: inventory }, // Always use the actual bot inventory
      surroundings: {
        nearbyBlocks: Array.from(new Set(nearbyBlocks)),
        nearbyEntities,
        position: {
          x: position.x,
          y: position.y,
          z: position.z
        },
        health: this.bot.health,
        food: this.bot.food,
        dayTime: timeOfDay.toString(), // Convert number to string
        timeDescription: timeDescription, // Add human-readable time description
        biome: biomeName, // Use the biome name string
        isSleeping: this.bot.isSleeping || false // Track if bot is sleeping
      }
      // DO NOT return memory updates here anymore
    };
  }
}
