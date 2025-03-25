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
      const count = parseInt(countStr, 10) || 1; // Currently only collects 1, count isn't used in logic yet
      
      console.log(`[Action:collectBlock] Request to collect ${count} ${blockType}`);
      
      try {
        const pathfinder = bot.pathfinder; // Ensure pathfinder is available
        if (!pathfinder) {
          const errorMsg = "Pathfinder plugin not available for collectBlock.";
          console.error(`[Action:collectBlock] ${errorMsg}`);
          return errorMsg;
        }
        
        const dataForVersion = mcData(bot.version);
        const blockData = dataForVersion.blocksByName[blockType]; // Use blockData instead of blockId directly
        
        if (!blockData) {
          const errorMsg = `Block type '${blockType}' not found in Minecraft data for version ${bot.version}`;
          console.error(`[Action:collectBlock] ${errorMsg}`);
          return errorMsg;
        }
        const blockId = blockData.id;
        console.log(`[Action:collectBlock] Searching for block '${blockType}' (ID: ${blockId})`);
        
        const block = bot.findBlock({
          matching: blockId,
          maxDistance: 32,
          useExtraInfo: true // May help find blocks slightly better
        });
        
        if (!block) {
          const message = `Could not find ${blockType} nearby within 32 blocks.`;
          console.log(`[Action:collectBlock] ${message}`);
          return message;
        }
        
        console.log(`[Action:collectBlock] Found ${blockType} at (${block.position.x}, ${block.position.y}, ${block.position.z}). Moving to it.`);
        // Create a goal to get near the block to mine it
        const goal = new goals.GoalGetToBlock(block.position.x, block.position.y, block.position.z);
        
        await bot.pathfinder.goto(goal);
        console.log(`[Action:collectBlock] Reached block. Attempting to dig.`);
        
        // Ensure the bot has the right tool equipped (optional but good)
        const bestTool = pathfinder.bestHarvestTool(block);
        if (bestTool) {
          console.log(`[Action:collectBlock] Equipping best tool: ${bestTool.name}`);
          await bot.equip(bestTool, 'hand');
        }
        
        await bot.dig(block);
        
        console.log(`[Action:collectBlock] Successfully collected ${blockType}.`);
        return `Collected ${blockType}`;
      } catch (error: any) {
        const errorMsg = `Failed to collect ${blockType}: ${error.message || error}`;
        console.error(`[Action:collectBlock] ${errorMsg}`);
        return errorMsg;
      }
    }
  },
  
  moveToPosition: {
    name: 'moveToPosition',
    description: 'Move to a specific position',
    execute: async (bot: any, args: string[]) => {
      const [xStr, yStr, zStr] = args;
      const x = parseFloat(xStr);
      const y = parseFloat(yStr);
      const z = parseFloat(zStr);
      
      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        const errorMsg = `Invalid coordinates provided: (${xStr}, ${yStr}, ${zStr})`;
        console.error(`[Action:moveToPosition] ${errorMsg}`);
        return errorMsg;
      }
      
      const target = new goals.GoalBlock(x, y, z); // Or GoalNear if appropriate
      console.log(`[Action:moveToPosition] Attempting to move to (${x}, ${y}, ${z})`);
      
      try {
        // Optional: Add event listener for path calculation status
        // bot.pathfinder.once('path_update', (results) => {
        //   console.log(`[Action:moveToPosition] Path update: ${results.status}`);
        // });
        
        await bot.pathfinder.goto(target);
        
        console.log(`[Action:moveToPosition] Successfully reached or got close to (${x}, ${y}, ${z})`);
        return `Moved to position (${x}, ${y}, ${z})`;
      } catch (error: any) {
        const errorMsg = `Failed to move to position (${x}, ${y}, ${z}): ${error.message || error}`;
        console.error(`[Action:moveToPosition] ${errorMsg}`);
        return errorMsg;
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
