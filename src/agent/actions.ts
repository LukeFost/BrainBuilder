import { Action, State } from './types';
import * as mineflayer from 'mineflayer';
import mcData from 'minecraft-data';
import { goals as PathfinderGoals } from 'mineflayer-pathfinder'; // Import goals with alias
import { Vec3 } from 'vec3'; // Import Vec3
import { Coder } from './coder';
import { config } from 'dotenv';

config(); // Load .env variables

export const actions: Record<string, Action> = {
  collectBlock: {
    name: 'collectBlock',
    description: 'Collect a specific type of block. Args: <blockType> <count>',
    execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
      const [blockType, countStr] = args;
      const count = parseInt(countStr, 10) || 1;
      let collectedCount = 0;
      let message = '';

      console.log(`[Action:collectBlock] Request to collect ${count} ${blockType}`);

      // --- Inventory Pre-Check ---
      // Use actualBlockType after potential translation below if needed, but check with original first
      let actualBlockTypeForCheck = blockType;
      // Handle common block name variations for the check
      if (blockType === 'wood' || blockType === 'log') {
          const dataForVersionCheck = mcData(bot.version);
          const logTypesCheck = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
          for (const logType of logTypesCheck) {
              if (dataForVersionCheck.blocksByName[logType]) {
                  actualBlockTypeForCheck = logType; // Use the first specific log type found for checking inventory
                  break;
              }
          }
      }
      const currentInvCount = currentState.inventory.items[actualBlockTypeForCheck] || 0;
      if (currentInvCount >= count) {
          const successMsg = `Already have enough ${actualBlockTypeForCheck} (${currentInvCount}/${count}).`;
          console.log(`[Action:collectBlock] ${successMsg}`);
          return successMsg;
      } else {
          console.log(`[Action:collectBlock] Need ${count}, have ${currentInvCount} of ${actualBlockTypeForCheck}. Starting collection.`);
          // Adjust count needed if some are already present
          collectedCount = currentInvCount; // Start count from what we have
          // Note: The loop below needs adjustment to use the remaining needed count
      }
      // --- End Inventory Pre-Check ---


      // Simulation mode handling
      if (!bot.pathfinder) {
        console.log(`[Action:collectBlock] Simulating collecting ${count} ${blockType}`);
        bot.chat(`Collecting ${count} ${blockType} [SIMULATED]`);
        // Update inventory even in simulation
        let actualBlockTypeSim = blockType;
        try {
            const mcDataSim = require('minecraft-data')(bot.version);
            if (blockType === 'wood' || blockType === 'log') {
                const logTypesSim = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
                for (const logType of logTypesSim) {
                    if (mcDataSim.blocksByName[logType]) {
                        actualBlockTypeSim = logType;
                        break;
                    }
                }
            }
        } catch (e) { /* ignore mcData errors in sim */ }
        currentState.inventory.items[actualBlockTypeSim] = (currentState.inventory.items[actualBlockTypeSim] || 0) + count;
        return `Collected ${count} ${actualBlockTypeSim} [SIMULATED]`;
      }

      // Real mode with pathfinder
      try {
        const dataForVersion = mcData(bot.version);

        // Handle common block name variations
        let actualBlockType = blockType;
        if (blockType === 'wood' || blockType === 'log') {
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
          return `Block type '${actualBlockType}' (from '${blockType}') not found in minecraft-data`;
        }
        const blockId = blockData.id;
        const neededCount = count - collectedCount; // Calculate how many more are needed

        for (let i = 0; i < neededCount; i++) { // Loop only for the needed amount
          const currentTotal = collectedCount + i; // Track total count including initial inventory
          console.log(`[Action:collectBlock] Searching for block ${i + 1}/${neededCount} (total ${currentTotal + 1}/${count}) of '${actualBlockType}' (ID: ${blockId})`);
          const block = bot.findBlock({
            matching: blockId,
            maxDistance: 32,
            useExtraInfo: true
          });

          if (!block) {
            message = `Could not find more ${actualBlockType} nearby (found ${collectedCount}/${count}).`;
            console.log(`[Action:collectBlock] ${message}`);
            break; // Stop if no more blocks are found
          }

          console.log(`[Action:collectBlock] Found ${actualBlockType} at (${block.position.x}, ${block.position.y}, ${block.position.z}). Moving to it.`);
          // Use pathfinder goals directly
          const goal = new PathfinderGoals.GoalGetToBlock(block.position.x, block.position.y, block.position.z);

          await bot.pathfinder.goto(goal);
          console.log(`[Action:collectBlock] Reached block. Attempting to dig.`);

          // Optional: Equip best tool
          const bestTool = bot.pathfinder.bestHarvestTool(block);
          if (bestTool) {
            console.log(`[Action:collectBlock] Equipping best tool: ${bestTool.name}`);
            await bot.equip(bestTool, 'hand');
          }

          await bot.dig(block);
          // collectedCount is now the running total, including initial inventory
          collectedCount++; // Increment the total count
          // Update inventory immediately after collecting
          currentState.inventory.items[actualBlockType] = collectedCount; // Set inventory to the new total
          console.log(`[Action:collectBlock] Successfully collected ${actualBlockType} (total ${collectedCount}/${count}).`);

          // Small delay
          if (i < neededCount - 1) { // Adjust loop condition check
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }

        if (!message) {
            message = `Collected ${collectedCount} ${actualBlockType}`;
        }
        console.log(`[Action:collectBlock] Finished: ${message}`);
        return message; // Return collected count message

      } catch (error: any) {
        const errorMsg = `Failed during collect ${blockType}: ${error.message || error}`;
        console.error(`[Action:collectBlock] ${errorMsg}`);
        // Return message indicating partial success/failure
        return `${errorMsg} (Collected ${collectedCount}/${count})`;
      }
    }
  },

  moveToPosition: {
    name: 'moveToPosition',
    description: 'Move to a specific position. Args: <x> <y> <z>',
    execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
      const [xStr, yStr, zStr] = args;
      const x = parseFloat(xStr);
      const y = parseFloat(yStr);
      const z = parseFloat(zStr);

      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        const errorMsg = `Invalid coordinates provided: (${xStr}, ${yStr}, ${zStr})`;
        console.error(`[Action:moveToPosition] ${errorMsg}`);
        return errorMsg;
      }

      const target = new PathfinderGoals.GoalBlock(x, y, z); // Or GoalNear if appropriate
      console.log(`[Action:moveToPosition] Attempting to move to (${x}, ${y}, ${z})`);

      try {
        // Check if pathfinder is available before using it
        if (!bot.pathfinder) {
            console.log(`[Action:moveToPosition] Simulating movement to (${x}, ${y}, ${z})`);
            bot.chat(`Moving to (${x}, ${y}, ${z}) [SIMULATED]`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate time
            return `Moved to position (${x}, ${y}, ${z}) [SIMULATED]`;
        }

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
    description: 'Craft an item. Args: <itemName> <count>',
    execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
      const [itemName, countStr] = args;
      const count = parseInt(countStr, 10) || 1;
      console.log(`[Action:craftItem] Attempting to craft ${count} ${itemName}`);

      try {
        const dataForVersion = mcData(bot.version);
        const itemToCraft = dataForVersion.itemsByName[itemName];

        if (!itemToCraft) return `Item '${itemName}' not found in minecraft-data`;

        // --- Specific Plank Crafting Logic ---
        if (itemName.includes('_planks')) {
          const logType = itemName.replace('_planks', '_log');
          let actualLogType = logType;
          if (!currentState.inventory.items[logType] || currentState.inventory.items[logType] === 0) {
              const availableLogTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
              for (const altLog of availableLogTypes) {
                  if (currentState.inventory.items[altLog] && currentState.inventory.items[altLog] > 0) {
                      actualLogType = altLog;
                      console.log(`[Action:craftItem] Using available log type '${actualLogType}' instead of '${logType}'`);
                      break;
                  }
              }
          }

          const requiredLogs = Math.ceil(count / 4);
          const availableLogs = currentState.inventory.items[actualLogType] || 0;

          if (availableLogs < requiredLogs) {
            return `Not enough ${actualLogType} (or any logs) to craft ${count} ${itemName}. Have ${availableLogs}, need ${requiredLogs}.`;
          }

          // Simulate crafting: Consume logs, add planks
          const planksToCraft = requiredLogs * 4;
          console.log(`[Action:craftItem] Simulating crafting ${planksToCraft} ${itemName} from ${requiredLogs} ${actualLogType}`);
          bot.chat(`Crafting ${planksToCraft} ${itemName} [SIMULATED]`);
          currentState.inventory.items[actualLogType] = availableLogs - requiredLogs;
          if (currentState.inventory.items[actualLogType] <= 0) {
              delete currentState.inventory.items[actualLogType];
          }
          currentState.inventory.items[itemName] = (currentState.inventory.items[itemName] || 0) + planksToCraft;
          return `Crafted ${planksToCraft} ${itemName} from ${requiredLogs} ${actualLogType}`;
        }

        // --- General Recipe Logic ---
        if (bot.recipesFor) {
             const recipe = bot.recipesFor(itemToCraft.id, null, 1, null)[0]; // Hand recipe
             if (recipe) {
                 console.log(`[Action:craftItem] Found hand recipe for ${itemName}. Attempting craft.`);
                 // Check ingredients
                 let canCraft = true;
                 let missingIngredients = [];
                 if (recipe.delta) {
                     for (const ingredient of recipe.delta) {
                         if (ingredient.count < 0) {
                             const ingredientName = dataForVersion.items[ingredient.id]?.name;
                             const requiredCount = -ingredient.count * count;
                             if (!ingredientName || (currentState.inventory.items[ingredientName] || 0) < requiredCount) {
                                 canCraft = false;
                                 missingIngredients.push(`${requiredCount} ${ingredientName || `item ID ${ingredient.id}`}`);
                             }
                         }
                     }
                 } else { console.warn(`[Action:craftItem] Hand recipe for ${itemName} has no delta.`); }

                 if (canCraft) {
                     // Pass undefined instead of null for crafting table argument
                     await bot.craft(recipe, count, undefined);
                     console.log(`[Action:craftItem] bot.craft called for ${count} ${itemName} (hand)`);
                     // Update state inventory
                     if (recipe.delta) {
                         for (const itemChange of recipe.delta) {
                             const changedItemName = dataForVersion.items[itemChange.id]?.name;
                             if (changedItemName) {
                                 currentState.inventory.items[changedItemName] = (currentState.inventory.items[changedItemName] || 0) + (itemChange.count * count);
                                 if (currentState.inventory.items[changedItemName] <= 0) { delete currentState.inventory.items[changedItemName]; }
                             }
                         }
                     } else { currentState.inventory.items[itemName] = (currentState.inventory.items[itemName] || 0) + count; }
                     return `Crafted ${count} ${itemName}`;
                 } else {
                     const message = `Not enough ingredients for hand craft ${count} ${itemName}. Missing: ${missingIngredients.join(', ')}`;
                     console.log(`[Action:craftItem] ${message}`);
                     return message;
                 }
             } else {
                 // Check for recipe requiring crafting table
                 const tableRecipe = bot.recipesFor(itemToCraft.id, null, 1, true)[0]; // craftingTable = true
                 if (tableRecipe) {
                     const craftingTableBlock = bot.findBlock({
                         matching: dataForVersion.blocksByName['crafting_table']?.id,
                         maxDistance: 4
                     });
                     if (!craftingTableBlock) {
                         return `Cannot craft ${itemName}. Need a crafting table nearby.`;
                     }
                     console.log(`[Action:craftItem] Found table recipe for ${itemName}. Attempting craft.`);
                     // Check ingredients
                     let canCraftWithTable = true;
                     let missingTableIngredients = [];
                     if (tableRecipe.delta) {
                         for (const ingredient of tableRecipe.delta) {
                             if (ingredient.count < 0) {
                                 const ingredientName = dataForVersion.items[ingredient.id]?.name;
                                 const requiredCount = -ingredient.count * count;
                                 if (!ingredientName || (currentState.inventory.items[ingredientName] || 0) < requiredCount) {
                                     canCraftWithTable = false;
                                     missingTableIngredients.push(`${requiredCount} ${ingredientName || `item ID ${ingredient.id}`}`);
                                 }
                             }
                         }
                     } else { console.warn(`[Action:craftItem] Table recipe for ${itemName} has no delta.`); }

                     if (canCraftWithTable) {
                         await bot.craft(tableRecipe, count, craftingTableBlock);
                         console.log(`[Action:craftItem] bot.craft called for ${count} ${itemName} using crafting table.`);
                         // Update state inventory
                         if (tableRecipe.delta) {
                             for (const itemChange of tableRecipe.delta) {
                                 const changedItemName = dataForVersion.items[itemChange.id]?.name;
                                 if (changedItemName) {
                                     currentState.inventory.items[changedItemName] = (currentState.inventory.items[changedItemName] || 0) + (itemChange.count * count);
                                     if (currentState.inventory.items[changedItemName] <= 0) { delete currentState.inventory.items[changedItemName]; }
                                 }
                             }
                         } else { currentState.inventory.items[itemName] = (currentState.inventory.items[itemName] || 0) + count; }
                         return `Crafted ${count} ${itemName} using crafting table`;
                     } else {
                         const message = `Not enough ingredients for table craft ${count} ${itemName}. Missing: ${missingTableIngredients.join(', ')}`;
                         console.log(`[Action:craftItem] ${message}`);
                         return message;
                     }
                 } else {
                     return `No recipe found for ${itemName} (checked hand and table)`;
                 }
             }
        } else {
             return `Crafting ${itemName} is not fully implemented (bot.recipesFor not available). Only plank crafting supported.`;
        }

      } catch (error: any) {
        const errorMsg = `Failed to craft ${itemName}: ${error.message || error}`;
        console.error(`[Action:craftItem] ${errorMsg}`);
        return errorMsg;
      }
    }
  },

  lookAround: {
    name: 'lookAround',
    description: 'Look around and gather information about surroundings. Args: None',
    execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
      const position = bot.entity.position;
      const nearbyEntities = Object.values(bot.entities)
        .filter((entity: any) => entity !== bot.entity && entity.position.distanceTo(bot.entity.position) < 20)
        .map((entity: any) => entity.displayName || entity.name || entity.username || entity.type);

      const block = bot.blockAt(position.floored());

      return `Looking around: I see ${nearbyEntities.join(', ') || 'nothing nearby'}. Standing on ${block?.name || 'unknown'} at position (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`;
    }
  },

  attackEntity: {
    name: 'attackEntity',
    description: 'Attack a nearby entity. Args: <entityName>',
    execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
      const [entityName] = args;
      if (!entityName) return "No entity name specified for attack.";

      try {
        const targetEntity = Object.values(bot.entities)
          .find((e: any) => e !== bot.entity &&
                           e.position.distanceTo(bot.entity.position) < 10 &&
                           ( (e.name && e.name.toLowerCase().includes(entityName.toLowerCase())) ||
                             (e.username && e.username.toLowerCase().includes(entityName.toLowerCase())) ||
                             (e.type && e.type.toLowerCase().includes(entityName.toLowerCase())) ||
                             (e.displayName && e.displayName.toLowerCase().includes(entityName.toLowerCase())) )
                );

        if (!targetEntity) return `Could not find entity matching '${entityName}' nearby`;

        if (bot.pathfinder) {
            const goal = new PathfinderGoals.GoalNear(targetEntity.position.x, targetEntity.position.y, targetEntity.position.z, 2);
            console.log(`[Action:attackEntity] Moving closer to ${targetEntity.displayName || entityName}`);
            await bot.pathfinder.goto(goal);
            console.log(`[Action:attackEntity] Reached near ${targetEntity.displayName || entityName}`);
        } else {
            console.log(`[Action:attackEntity] Pathfinder not available, attempting attack from current position.`);
        }

        await bot.attack(targetEntity);
        return `Attacked ${targetEntity.displayName || entityName}`;
      } catch (error: any) {
        const errorMsg = `Failed to attack ${entityName}: ${error.message || error}`;
        console.error(`[Action:attackEntity] ${errorMsg}`);
        return errorMsg;
      }
    }
  },

  placeBlock: {
    name: 'placeBlock',
    description: 'Place a block at a specific position. Args: <blockType> <x> <y> <z>',
    execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
      const [blockType, xStr, yStr, zStr] = args;
      const targetPos = new Vec3(parseFloat(xStr), parseFloat(yStr), parseFloat(zStr)); // Use Vec3

      if (isNaN(targetPos.x) || isNaN(targetPos.y) || isNaN(targetPos.z)) {
          return `Invalid coordinates for placeBlock: ${args.join(', ')}`;
      }

      console.log(`[Action:placeBlock] Request to place ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`);

      if (!bot.pathfinder) {
          console.log(`[Action:placeBlock] Simulating placement of ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`);
          bot.chat(`Placing ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) [SIMULATED]`);
          if (currentState.inventory.items[blockType]) {
              currentState.inventory.items[blockType] -= 1;
              if (currentState.inventory.items[blockType] <= 0) { delete currentState.inventory.items[blockType]; }
          }
          return `Placed ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) [SIMULATED]`;
      }

      try {
          const mcData = require('minecraft-data')(bot.version);

          // 1. Check inventory
          const itemInInventory = bot.inventory.items().find((item: any) => item.name === blockType);
          if (!itemInInventory) {
              return `Cannot place ${blockType}: Not found in inventory.`;
          }

          // 2. Find a reference block and face vector
          // Strategy: Try placing on the block directly below the target position.
          const referenceBlockPos = targetPos.offset(0, -1, 0); // Use Vec3 offset
          const referenceBlock = bot.blockAt(referenceBlockPos);

          if (!referenceBlock || referenceBlock.name === 'air') {
              // TODO: Add more sophisticated reference block finding (adjacent blocks)
              return `Cannot place ${blockType}: No solid block found below target position (${referenceBlockPos.x}, ${referenceBlockPos.y}, ${referenceBlockPos.z}) to place against.`;
          }

          // The face vector points from the reference block towards the target block.
          const faceVector = targetPos.minus(referenceBlockPos); // Calculate face vector
          // Normalize faceVector to one of the 6 cardinal directions (simplified)
          let mainAxis = 'y';
          if (Math.abs(faceVector.x) > Math.abs(faceVector.y) && Math.abs(faceVector.x) > Math.abs(faceVector.z)) mainAxis = 'x';
          else if (Math.abs(faceVector.z) > Math.abs(faceVector.y)) mainAxis = 'z';

          const finalFaceVector = new Vec3(0,0,0);
          if (mainAxis === 'x') finalFaceVector.x = Math.sign(faceVector.x);
          else if (mainAxis === 'y') finalFaceVector.y = Math.sign(faceVector.y);
          else finalFaceVector.z = Math.sign(faceVector.z);

          if (finalFaceVector.y !== 1) { // Simple check if not placing on top
             console.warn(`[Action:placeBlock] Calculated face vector ${finalFaceVector} is not (0,1,0). Placement might be tricky.`);
             // For now, we'll proceed assuming the simple case works, but this needs refinement
             // For robust placement, need to check reachability and potentially adjust bot position/look direction.
          }


          // 3. Move near the placement location
          const goal = new PathfinderGoals.GoalNear(referenceBlockPos.x, referenceBlockPos.y, referenceBlockPos.z, 3);
          console.log(`[Action:placeBlock] Moving near reference block at ${referenceBlockPos}`);
          await bot.pathfinder.goto(goal);
          console.log(`[Action:placeBlock] Reached near reference block.`);

          // 4. Equip the block
          console.log(`[Action:placeBlock] Equipping ${itemInInventory.name}`);
          await bot.equip(itemInInventory, 'hand');

          // 5. Place the block
          console.log(`[Action:placeBlock] Placing ${blockType} against ${referenceBlock.name} at ${referenceBlockPos} (face: ${finalFaceVector})`);
          await bot.placeBlock(referenceBlock, finalFaceVector);

          // Update state inventory
          if (currentState.inventory.items[blockType]) {
              currentState.inventory.items[blockType] -= 1;
              if (currentState.inventory.items[blockType] <= 0) { delete currentState.inventory.items[blockType]; }
          }

          return `Placed ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`;

      } catch (error: any) {
          const errorMsg = `Failed to place ${blockType}: ${error.message || error}`;
          console.error(`[Action:placeBlock] ${errorMsg}`);
          if (error.message && (error.message.includes('Cannot place block') || error.message.includes('dig instead'))) {
               return `Failed to place ${blockType}: Placement obstructed, too far, or invalid location? (${error.message})`;
          }
          return errorMsg;
      }
    }
  },

  sleep: {
    name: 'sleep',
    description: 'Sleep in a nearby bed. Args: None',
    execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
      try {
        const bed = bot.findBlock({
          matching: (block: any) => bot.isABed(block),
          maxDistance: 10
        });

        if (!bed) return 'No bed found nearby';

        if (bot.pathfinder) {
            const goal = new PathfinderGoals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2);
            console.log(`[Action:sleep] Moving to bed at ${bed.position}`);
            await bot.pathfinder.goto(goal);
            console.log(`[Action:sleep] Reached bed.`);
        } else {
            console.log(`[Action:sleep] Pathfinder not available, attempting to sleep from current position.`);
        }

        await bot.sleep(bed);
        return 'Sleeping in bed';
      } catch (error: any) {
        if (error.message && error.message.toLowerCase().includes('too far')) {
            return 'Failed to sleep: Bed is too far away.';
        } else if (error.message && error.message.toLowerCase().includes('not possible')) {
            return 'Failed to sleep: It is not night time or the bed is obstructed.';
        }
        const errorMsg = `Failed to sleep: ${error.message || error}`;
        console.error(`[Action:sleep] ${errorMsg}`);
        return errorMsg;
      }
    }
  },

  wakeUp: {
    name: 'wakeUp',
    description: 'Wake up from sleeping. Args: None',
    execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
      try {
        await bot.wake();
        return 'Woke up';
      } catch (error: any) {
        const errorMsg = `Failed to wake up: ${error.message || error}`;
        console.error(`[Action:wakeUp] ${errorMsg}`);
        return errorMsg;
      }
    }
  },

  dropItem: {
    name: 'dropItem',
    description: 'Drop items from inventory. Args: <itemName> <count>',
    execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
      const [itemName, countStr] = args;
      const count = parseInt(countStr, 10) || 1;
      if (!itemName) return "No item name specified to drop.";
      if (isNaN(count) || count <= 0) return "Invalid count specified for dropItem.";

      try {
        const itemToDrop = bot.inventory.items().find((item: any) => item.name === itemName);
        if (!itemToDrop) return `No ${itemName} in inventory to drop`;

        await bot.toss(itemToDrop.type, null, count);

        currentState.inventory.items[itemName] = (currentState.inventory.items[itemName] || 0) - count;
        if (currentState.inventory.items[itemName] <= 0) {
            delete currentState.inventory.items[itemName];
        }

        return `Dropped ${count} ${itemName}`;
      } catch (error: any) {
        const errorMsg = `Failed to drop ${itemName}: ${error.message || error}`;
        console.error(`[Action:dropItem] ${errorMsg}`);
        return errorMsg;
      }
    }
  },

  askForHelp: {
      name: 'askForHelp',
      description: 'Ask the user (player) a question via chat. Args: <question string>',
      execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
          const question = args.join(' ');
          if (question) {
              bot.chat(`[Help Needed] ${question}`);
              return `Asked for help: "${question}"`;
          } else {
              bot.chat("[Help Needed] I'm stuck but didn't formulate a question.");
              return "Tried to ask for help, but no question was specified.";
          }
      }
  },

  generateAndExecuteCode: {
    name: 'generateAndExecuteCode',
    description: 'Generates and executes JavaScript code using an LLM to perform a complex or novel task described in natural language. Use for tasks not covered by other specific actions. Input args: <task description string>',
    execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
      const taskDescription = args.join(' ');
      if (!taskDescription) {
        return "Error: No task description provided for code generation.";
      }

      // Special handling for buildShelter task
      if (taskDescription.toLowerCase().includes('build a shelter') || taskDescription.toLowerCase().includes('build shelter')) {
        const logTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
        const plankTypes = ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks'];
        let totalWoodCount = 0;
        let logCount = 0;
        for (const logType of logTypes) {
          const count = currentState.inventory.items[logType] || 0;
          logCount += count;
          totalWoodCount += count * 4;
        }
        for (const plankType of plankTypes) {
          totalWoodCount += currentState.inventory.items[plankType] || 0;
        }
        const minWoodNeeded = 20;
        if (totalWoodCount < minWoodNeeded) {
          if (logCount > 0 && logCount < Math.ceil(minWoodNeeded / 4)) {
            return `Not enough wood to build a shelter. Have ${logCount} logs (~${totalWoodCount} planks). Need ~${minWoodNeeded} planks total. Collect more logs first.`;
          } else if (logCount >= Math.ceil(minWoodNeeded / 4)) {
            const planksToCraft = logCount * 4;
            const suggestedPlankType = logTypes.find(lt => currentState.inventory.items[lt] > 0)?.replace('_log', '_planks') || 'oak_planks';
            return `Have ${logCount} logs but need to craft them into planks first. Try 'craftItem ${suggestedPlankType} ${planksToCraft}'`;
          } else {
            return `No wood available. Need to collect at least ${Math.ceil(minWoodNeeded / 4)} logs first.`;
          }
        }
        console.log(`[Action:generateAndExecuteCode] Sufficient wood (${totalWoodCount} planks equivalent) detected for shelter task. Proceeding with code generation.`);
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return "Error: OPENAI_API_KEY is not configured. Cannot generate code.";
      }

      const coder = new Coder(bot, apiKey);

      try {
        const result = await coder.generateAndExecute(taskDescription, currentState);
        return result.message;
      } catch (error: any) {
        console.error(`[Action:generateAndExecuteCode] Unexpected error: ${error}`);
        return `Failed to generate or execute code: ${error.message || error}`;
      }
    }
  },
};
