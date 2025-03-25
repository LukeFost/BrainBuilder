import { Action, State } from './types'; // Import State
import * as mineflayer from 'mineflayer';
import mcData = require('minecraft-data');
import { goals } from 'mineflayer-pathfinder';
import { Coder } from './coder'; // Import the Coder class
import { config } from 'dotenv'; // Import dotenv config to access API key

config(); // Load .env variables

// Keep existing actions...

export const actions: Record<string, Action> = {
  // ... (keep existing collectBlock, moveToPosition, etc.) ...

  collectBlock: {
    name: 'collectBlock',
    description: 'Collect a specific type of block',
    execute: async (bot: any, args: string[], currentState: State) => { // Add currentState
      const [blockType, countStr] = args;
      const count = parseInt(countStr, 10) || 1;
      
      console.log(`[Action:collectBlock] Request to collect ${count} ${blockType}`);
      
      try {
        const pathfinder = bot.pathfinder; // Ensure pathfinder is available
        if (!pathfinder) {
          const errorMsg = "Pathfinder plugin not available for collectBlock.";
          console.error(`[Action:collectBlock] ${errorMsg}`);
          return errorMsg;
        }
        
        const dataForVersion = mcData(bot.version);
        
        // Handle common block name variations
        let actualBlockType = blockType;
        if (blockType === 'wood' || blockType === 'log') {
          // Try to find any type of log
          const logTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
          for (const logType of logTypes) {
            if (dataForVersion.blocksByName[logType]) {
              actualBlockType = logType;
              console.log(`[Action:collectBlock] Translating '${blockType}' to specific block type: ${actualBlockType}`);
              break;
            }
          }
        }
        
        const blockData = dataForVersion.blocksByName[actualBlockType];
        
        if (!blockData) {
          const errorMsg = `Block type '${actualBlockType}' (from '${blockType}') not found in minecraft-data for version ${bot.version}`;
          console.error(`[Action:collectBlock] ${errorMsg}`);
          return errorMsg;
        }
        
        const blockId = blockData.id;
        console.log(`[Action:collectBlock] Searching for block '${actualBlockType}' (ID: ${blockId})`);
        
        // Collect multiple blocks
        let collectedCount = 0;
        for (let i = 0; i < count; i++) {
          // Find the block
          const block = bot.findBlock({
            matching: blockId,
            maxDistance: 32,
            useExtraInfo: true // May help find blocks slightly better
          });
          
          if (!block) {
            if (collectedCount === 0) {
              const message = `Could not find ${actualBlockType} nearby within 32 blocks.`;
              console.log(`[Action:collectBlock] ${message}`);
              return message;
            } else {
              const message = `Collected ${collectedCount} ${actualBlockType} (couldn't find more)`;
              console.log(`[Action:collectBlock] ${message}`);
              return message;
            }
          }
          
          console.log(`[Action:collectBlock] Found ${actualBlockType} at (${block.position.x}, ${block.position.y}, ${block.position.z}). Moving to it.`);
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
          collectedCount++;
          
          // Update inventory in currentState
          if (currentState && currentState.inventory && currentState.inventory.items) {
            currentState.inventory.items[actualBlockType] = (currentState.inventory.items[actualBlockType] || 0) + 1;
          }
          
          console.log(`[Action:collectBlock] Successfully collected ${actualBlockType} (${collectedCount}/${count}).`);
          
          // Small delay between collecting blocks to avoid overwhelming the server
          if (i < count - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        return `Collected ${collectedCount} ${actualBlockType}`;
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
    execute: async (bot: any, args: string[], currentState: State) => { // Add currentState
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
    execute: async (bot: any, args: string[], currentState: State) => { // Add currentState
      const [itemName, countStr] = args;
      const count = parseInt(countStr, 10) || 1;
      
      try {
        const dataForVersion = mcData(bot.version);
        const item = dataForVersion.itemsByName[itemName];
        
        if (!item) return `Item ${itemName} not found`;
        
        // Special handling for planks from logs
        if (itemName.includes('planks')) {
          // Determine which log type to use based on the planks requested
          const logType = itemName.replace('_planks', '_log');
          const logCount = Math.ceil(count / 4); // Each log makes 4 planks
          
          // Check if we have enough logs
          if (!currentState.inventory.items[logType] || currentState.inventory.items[logType] < logCount) {
            return `Not enough ${logType} to craft ${count} ${itemName}. Have ${currentState.inventory.items[logType] || 0} logs, need ${logCount}.`;
          }
          
          // Try to find the recipe
          const recipe = bot.recipesFor(item.id)[0];
          if (!recipe) {
            // If recipe not found but we have logs, simulate crafting
            console.log(`[Action:craftItem] Recipe not found for ${itemName}, simulating crafting from ${logCount} ${logType}`);
            
            // Update inventory
            currentState.inventory.items[logType] -= logCount;
            currentState.inventory.items[itemName] = (currentState.inventory.items[itemName] || 0) + (logCount * 4);
            
            return `Crafted ${logCount * 4} ${itemName} from ${logCount} ${logType} [SIMULATED]`;
          }
        }
        
        const recipe = bot.recipesFor(item.id)[0];
        if (!recipe) return `No recipe found for ${itemName}`;
        
        await bot.craft(recipe, count);
        
        // Update inventory in currentState
        if (currentState && currentState.inventory && currentState.inventory.items) {
          // This is simplified - in reality crafting would consume ingredients
          currentState.inventory.items[itemName] = (currentState.inventory.items[itemName] || 0) + count;
        }
        
        return `Crafted ${count} ${itemName}`;
      } catch (error) {
        return `Failed to craft ${itemName}: ${error}`;
      }
    }
  },

  lookAround: {
    name: 'lookAround',
    description: 'Look around and gather information about surroundings',
    execute: async (bot: any, args: string[], currentState: State) => { // Add currentState
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
    execute: async (bot: any, args: string[], currentState: State) => { // Add currentState
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
    execute: async (bot: any, args: string[], currentState: State) => { // Add currentState
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
    execute: async (bot: any, args: string[], currentState: State) => { // Add currentState
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
    execute: async (bot: any, args: string[], currentState: State) => { // Add currentState
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
    execute: async (bot: any, args: string[], currentState: State) => { // Add currentState
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
  },

  // --- NEW ACTION ---
  generateAndExecuteCode: {
    name: 'generateAndExecuteCode',
    description: 'Generates and executes JavaScript code using an LLM to perform a complex or novel task described in natural language. Use for tasks not covered by other specific actions. Input args: <task description string>',
    execute: async (bot: any, args: string[], currentState: State) => { // Add currentState
      const taskDescription = args.join(' ');
      if (!taskDescription) {
        return "Error: No task description provided for code generation.";
      }

      // Special handling for buildShelter task
      if (taskDescription.includes('build a shelter') || taskDescription.includes('build shelter') || args[0] === 'buildShelter') {
        // Check if we have enough wood first
        const logTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
        const plankTypes = ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks'];
        
        let totalWoodCount = 0;
        let logCount = 0;
        
        // Count logs (each log = 4 planks)
        for (const logType of logTypes) {
          const count = currentState.inventory.items[logType] || 0;
          logCount += count;
          totalWoodCount += count * 4; // Each log can make 4 planks
        }
        
        // Count planks
        for (const plankType of plankTypes) {
          const count = currentState.inventory.items[plankType] || 0;
          totalWoodCount += count;
        }
        
        if (totalWoodCount < 20) {
          // Instead of just returning an error, suggest what to do next
          if (logCount > 0 && logCount < 5) {
            return `Not enough wood to build a shelter. Have ${logCount} logs (${totalWoodCount} planks equivalent). Need to collect more logs first.`;
          } else if (logCount >= 5) {
            return `Have ${logCount} logs but need to craft them into planks first. Try 'craftItem oak_planks ${logCount * 4}'`;
          } else {
            return `No wood available. Need to collect at least 5 logs first.`;
          }
        }
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return "Error: OPENAI_API_KEY is not configured. Cannot generate code.";
      }

      // Instantiate the Coder
      const coder = new Coder(bot, apiKey);

      try {
        // Execute the generation and execution loop
        const result = await coder.generateAndExecute(taskDescription, currentState); // Pass state

        // Return the final result message
        return result.message;
      } catch (error: any) {
        console.error(`[Action:generateAndExecuteCode] Unexpected error: ${error}`);
        return `Failed to generate or execute code: ${error.message || error}`;
      }
    }
  },
};
