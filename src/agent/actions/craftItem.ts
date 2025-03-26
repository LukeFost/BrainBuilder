import { Action, State } from '../types';
import * as mineflayer from 'mineflayer';
import * as mcDataModule from 'minecraft-data';

// Simplified mcData import (adjust as needed or use a utility)
// Handle both CommonJS and ES module versions of minecraft-data
const mcData = (version: string) => {
  try {
    if (typeof mcDataModule === 'function') {
      return mcDataModule(version);
    } else if (mcDataModule.default && typeof mcDataModule.default === 'function') {
      return mcDataModule.default(version);
    } else {
      // Direct require as fallback
      return require('minecraft-data')(version);
    }
  } catch (error: any) {
    console.error(`[mcData] Error initializing minecraft-data for version ${version}:`, error);
    // Last resort fallback - direct require with error handling
    try {
      return require('minecraft-data')(version);
    } catch (e: any) {
      console.error(`[mcData] Critical failure loading minecraft-data:`, e);
      throw new Error(`Unable to initialize minecraft-data for version ${version}: ${e.message}`);
    }
  }
};

export const craftItemAction: Action = {
  name: 'craftItem',
  description: 'Craft an item. Args: <itemName> <count>',
  execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
    const [itemName, countStr] = args;
    const count = parseInt(countStr, 10) || 1;
    console.log(`[Action:craftItem] Attempting to craft ${count} ${itemName}`);

    // Normalize item names - handle common variations
    let normalizedItemName = itemName;
    if (itemName === 'wooden_planks') {
      normalizedItemName = 'oak_planks'; // Default to oak if generic 'wooden' is used
      console.log(`[Action:craftItem] Normalized 'wooden_planks' to 'oak_planks'`);
    }
    // Add other normalizations if needed (e.g., 'log' -> 'oak_log')

    try {
      const dataForVersion = mcData(bot.version as string);

      // Check if item exists in minecraft-data
      const itemToCraft = dataForVersion.itemsByName[normalizedItemName];
      if (!itemToCraft) {
        console.error(`[Action:craftItem] Item '${normalizedItemName}' not found in minecraft-data`);
        return `Item '${normalizedItemName}' not found in minecraft-data`;
      }

      // --- Specific Plank Crafting Logic ---
      if (normalizedItemName.includes('_planks')) {
        const logType = normalizedItemName.replace('_planks', '_log');
        let actualLogType = logType;

        // Check state inventory for the specific log type
        const stateInventory = currentState.inventory.items;

        // If we don't have the specific log type in state, check for any available log type in state
        if (!stateInventory[logType] || stateInventory[logType] === 0) {
          const availableLogTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
          for (const altLog of availableLogTypes) {
            if (stateInventory[altLog] && stateInventory[altLog] > 0) {
              actualLogType = altLog;
              console.log(`[Action:craftItem] Using available log type '${actualLogType}' from state instead of '${logType}'`);
              break;
            }
          }
        }

        const requiredLogs = Math.ceil(count / 4);
        const availableLogs = stateInventory[actualLogType] || 0;

        if (availableLogs < requiredLogs) {
          return `Not enough ${actualLogType} according to state to craft ${count} ${normalizedItemName}. Have ${availableLogs}, need ${requiredLogs}.`;
        }

        // Use the game's actual crafting system if available
        if (bot.recipesFor) {
          try {
            // Find the recipe for planks (usually requires 1 log)
            const recipes = bot.recipesFor(itemToCraft.id, null, 1, null); // Hand craft
            if (recipes.length > 0) {
              const recipe = recipes[0];
              // Craft enough times to get the desired plank count
              // We need 'requiredLogs' number of logs to make 'count' planks
              // The recipe usually takes 1 log and makes 4 planks.
              // We need to call craft 'requiredLogs' times.
              await bot.craft(recipe, requiredLogs, null); // Craft 'requiredLogs' times
              // DO NOT update state inventory here. ObserveManager will handle it.
              return `Crafted ${requiredLogs * 4} ${normalizedItemName} from ${requiredLogs} ${actualLogType}`;
            } else {
                return `No hand-crafting recipe found for ${normalizedItemName}.`;
            }
          } catch (craftError: any) {
            console.error(`[Action:craftItem] Error using bot.craft for planks:`, craftError);
            return `Failed to craft ${normalizedItemName}: ${craftError.message || craftError}`;
          }
        } else {
          return `Crafting ${normalizedItemName} failed: bot.recipesFor not available.`;
        }
      }

      // --- General Recipe Logic ---
      if (bot.recipesFor) {
        // Try hand recipe first
        const handRecipe = bot.recipesFor(itemToCraft.id, null, 1, null)[0];
        if (handRecipe) {
          console.log(`[Action:craftItem] Found hand recipe for ${normalizedItemName}. Checking ingredients in state.`);

          // Check ingredients using state inventory
          const stateInventory = currentState.inventory.items;
          let canCraft = true;
          let missingIngredients = [];

          if (handRecipe.delta) {
            for (const ingredient of handRecipe.delta) {
              if (ingredient.count < 0) { // Negative count means ingredient is consumed
                const ingredientItem = dataForVersion.items[ingredient.id];
                const ingredientName = ingredientItem?.name;
                const requiredCount = -ingredient.count * count; // Total needed for the desired count
                if (!ingredientName) {
                    canCraft = false;
                    missingIngredients.push(`Unknown item ID ${ingredient.id}`);
                    continue;
                }
                if ((stateInventory[ingredientName] || 0) < requiredCount) {
                  canCraft = false;
                  missingIngredients.push(`${requiredCount} ${ingredientName} (have ${(stateInventory[ingredientName] || 0)})`);
                }
              }
            }
          } else {
            console.warn(`[Action:craftItem] Hand recipe for ${normalizedItemName} has no delta. Cannot verify ingredients.`);
            // Proceed cautiously, or return error? Let's try crafting anyway.
          }

          if (canCraft) {
            await bot.craft(handRecipe, count, null); // Craft using hand
            console.log(`[Action:craftItem] bot.craft called for ${count} ${normalizedItemName} (hand)`);
            // DO NOT update state inventory here.
            return `Crafted ${count} ${normalizedItemName}`;
          } else {
            const message = `Not enough ingredients in state for hand craft ${count} ${normalizedItemName}. Missing: ${missingIngredients.join(', ')}`;
            console.log(`[Action:craftItem] ${message}`);
            return message;
          }
        }

        // If no hand recipe, check for recipe requiring crafting table
        const tableRecipe = bot.recipesFor(itemToCraft.id, null, 1, true)[0]; // craftingTable = true
        if (tableRecipe) {
          const craftingTableBlock = bot.findBlock({
            matching: dataForVersion.blocksByName['crafting_table']?.id,
            maxDistance: 4 // Check within reasonable distance
          });

          if (!craftingTableBlock) {
            return `Cannot craft ${normalizedItemName}. Need a crafting table nearby.`;
          }

          console.log(`[Action:craftItem] Found table recipe for ${normalizedItemName}. Checking ingredients in state.`);

          // Check ingredients using state inventory
          const stateInventory = currentState.inventory.items;
          let canCraftWithTable = true;
          let missingTableIngredients = [];

          if (tableRecipe.delta) {
            for (const ingredient of tableRecipe.delta) {
              if (ingredient.count < 0) {
                const ingredientItem = dataForVersion.items[ingredient.id];
                const ingredientName = ingredientItem?.name;
                const requiredCount = -ingredient.count * count;
                if (!ingredientName) {
                    canCraftWithTable = false;
                    missingTableIngredients.push(`Unknown item ID ${ingredient.id}`);
                    continue;
                }
                if ((stateInventory[ingredientName] || 0) < requiredCount) {
                  canCraftWithTable = false;
                  missingTableIngredients.push(`${requiredCount} ${ingredientName} (have ${(stateInventory[ingredientName] || 0)})`);
                }
              }
            }
          } else {
            console.warn(`[Action:craftItem] Table recipe for ${normalizedItemName} has no delta. Cannot verify ingredients.`);
          }

          if (canCraftWithTable) {
            await bot.craft(tableRecipe, count, craftingTableBlock); // Craft using table
            console.log(`[Action:craftItem] bot.craft called for ${count} ${normalizedItemName} using crafting table.`);
            // DO NOT update state inventory here.
            return `Crafted ${count} ${normalizedItemName} using crafting table`;
          } else {
            const message = `Not enough ingredients in state for table craft ${count} ${normalizedItemName}. Missing: ${missingTableIngredients.join(', ')}`;
            console.log(`[Action:craftItem] ${message}`);
            return message;
          }
        } else {
          return `No recipe found for ${normalizedItemName} (checked hand and table)`;
        }
      } else {
        return `Crafting ${normalizedItemName} failed: bot.recipesFor not available.`;
      }

    } catch (error: any) {
      const errorMsg = `Failed to craft ${itemName}: ${error.message || error}`;
      console.error(`[Action:craftItem] ${errorMsg}`);
      return errorMsg;
    }
  }
};
