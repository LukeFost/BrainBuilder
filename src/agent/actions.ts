import { Action } from './types';
import * as mineflayer from 'mineflayer';
import mcData = require('minecraft-data');
import { goals } from 'mineflayer-pathfinder';

export const actions: Record<string, Action> = {
  collectBlock: {
    name: 'collectBlock',
    description: 'Collect a specific type of block',
    execute: async (bot: any, args: string[]) => {
      const [blockType, countStr] = args;
      const count = parseInt(countStr, 10) || 1;
      
      try {
        const pathfinder = bot.pathfinder;
        const dataForVersion = mcData(bot.version);
        const blockId = dataForVersion.blocksByName[blockType]?.id;
        
        if (!blockId) return `Block ${blockType} not found`;
        
        const block = bot.findBlock({
          matching: blockId,
          maxDistance: 32
        });
        
        if (!block) return `Could not find ${blockType} nearby`;
        
        await bot.pathfinder.goto(block.position);
        await bot.dig(block);
        
        return `Collected ${blockType}`;
      } catch (error) {
        return `Failed to collect ${blockType}: ${error}`;
      }
    }
  },
  
  moveToPosition: {
    name: 'moveToPosition',
    description: 'Move to a specific position',
    execute: async (bot: any, args: string[]) => {
      const [x, y, z] = args.map(arg => parseFloat(arg));
      
      try {
        await bot.pathfinder.goto({ x, y, z });
        return `Moved to position (${x}, ${y}, ${z})`;
      } catch (error) {
        return `Failed to move to position: ${error}`;
      }
    }
  },
  
  craftItem: {
    name: 'craftItem',
    description: 'Craft an item',
    execute: async (bot: any, args: string[]) => {
      const [itemName, countStr] = args;
      const count = parseInt(countStr, 10) || 1;
      
      try {
        const dataForVersion = mcData(bot.version);
        const item = dataForVersion.itemsByName[itemName];
        
        if (!item) return `Item ${itemName} not found`;
        
        const recipe = bot.recipesFor(item.id)[0];
        if (!recipe) return `No recipe found for ${itemName}`;
        
        await bot.craft(recipe, count);
        return `Crafted ${count} ${itemName}`;
      } catch (error) {
        return `Failed to craft ${itemName}: ${error}`;
      }
    }
  },

  lookAround: {
    name: 'lookAround',
    description: 'Look around and gather information about surroundings',
    execute: async (bot: any, args: string[]) => {
      const nearbyEntities = Object.values(bot.entities)
        .filter((entity: any) => entity.position.distanceTo(bot.entity.position) < 20)
        .map((entity: any) => entity.name || entity.username || entity.type);
      
      const position = bot.entity.position;
      const block = bot.blockAt(position);
      
      return `Looking around: I see ${nearbyEntities.join(', ')}. Standing on ${block?.name || 'unknown'} at position (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`;
    }
  },
  
  attackEntity: {
    name: 'attackEntity',
    description: 'Attack a nearby entity',
    execute: async (bot: any, args: string[]) => {
      const [entityName] = args;
      
      try {
        // Find entity by name
        const entity = Object.values(bot.entities)
          .find((e: any) => (e.name === entityName || e.username === entityName || e.type === entityName) 
            && e.position.distanceTo(bot.entity.position) < 10);
        
        if (!entity) return `Could not find ${entityName} nearby`;
        
        // Get close to the entity first
        await bot.pathfinder.goto(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2));
        
        // Attack the entity
        await bot.attack(entity);
        return `Attacked ${entityName}`;
      } catch (error) {
        return `Failed to attack ${entityName}: ${error}`;
      }
    }
  },
  
  placeBlock: {
    name: 'placeBlock',
    description: 'Place a block at a specific position',
    execute: async (bot: any, args: string[]) => {
      const [blockType, x, y, z] = args;
      const position = { x: parseFloat(x), y: parseFloat(y), z: parseFloat(z) };
      
      try {
        const dataForVersion = mcData(bot.version);
        const block = dataForVersion.blocksByName[blockType];
        
        if (!block) return `Block type ${blockType} not found`;
        
        // Find the block in inventory
        const item = bot.inventory.items().find((item: any) => item.name === blockType);
        if (!item) return `No ${blockType} in inventory`;
        
        // Equip the block
        await bot.equip(item, 'hand');
        
        // Find a reference block (adjacent to where we want to place the new block)
        const point = bot.entity.position.offset(0, -1, 0);
        const refBlock = bot.blockAt(point);
        
        if (!refBlock) return 'Could not find reference block';
        
        // Move to position near placement location
        await bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 3));
        
        // Place the block
        const targetPos = new bot.vec3(position.x, position.y, position.z);
        await bot.placeBlock(refBlock, targetPos);
        return `Placed ${blockType} at (${position.x}, ${position.y}, ${position.z})`;
      } catch (error) {
        return `Failed to place block: ${error}`;
      }
    }
  },
  
  sleep: {
    name: 'sleep',
    description: 'Sleep in a nearby bed',
    execute: async (bot: any, args: string[]) => {
      try {
        // Find a bed
        const bed = bot.findBlock({
          matching: block => bot.isABed(block),
          maxDistance: 10
        });
        
        if (!bed) return 'No bed found nearby';
        
        // Move to the bed
        await bot.pathfinder.goto(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2));
        
        // Sleep in the bed
        await bot.sleep(bed);
        return 'Sleeping in bed';
      } catch (error) {
        return `Failed to sleep: ${error}`;
      }
    }
  },
  
  wakeUp: {
    name: 'wakeUp',
    description: 'Wake up from sleeping',
    execute: async (bot: any, args: string[]) => {
      try {
        await bot.wake();
        return 'Woke up';
      } catch (error) {
        return `Failed to wake up: ${error}`;
      }
    }
  },
  
  dropItem: {
    name: 'dropItem',
    description: 'Drop items from inventory',
    execute: async (bot: any, args: string[]) => {
      const [itemName, countStr] = args;
      const count = parseInt(countStr, 10) || 1;
      
      try {
        // Find the item in inventory
        const item = bot.inventory.items().find((item: any) => item.name === itemName);
        if (!item) return `No ${itemName} in inventory`;
        
        // Drop the item
        await bot.toss(item.type, null, count);
        return `Dropped ${count} ${itemName}`;
      } catch (error) {
        return `Failed to drop item: ${error}`;
      }
    }
  }
};