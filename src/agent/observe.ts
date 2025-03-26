import { State } from './types';
import { Bot } from 'mineflayer';

export class ObserveManager {
  private bot: Bot;

  constructor(bot: Bot) {
    this.bot = bot;
  }

  async observe(currentState: State): Promise<Partial<State>> {
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
    
    // Get time and biome
    const timeOfDay = this.bot.time.timeOfDay;
    const biome = this.bot.world.getBiome(position.floored()); // Use floored position for biome

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
        timeOfDay: timeOfDay, // Added
        biome: biome // Added
      }
    };
  }
}
