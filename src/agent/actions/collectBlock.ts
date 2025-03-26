import { Action, State } from '../types';
import { Bot } from 'mineflayer'; // Use specific Bot type
import { IndexedData } from 'minecraft-data'; // Import type
import { goals as PathfinderGoals } from 'mineflayer-pathfinder';

export const collectBlockAction: Action = {
  name: 'collectBlock',
  description: 'Collect a specific type of block. Args: <blockType> <count>',
  execute: async (bot: Bot, mcData: IndexedData, args: string[], currentState: State): Promise<string> => {
    const [blockType, countStr] = args;
    const count = parseInt(countStr, 10) || 1;
    let collectedCount = 0; // Tracks how many were successfully collected in *this* execution
    let message = '';

    console.log(`[Action:collectBlock] Request to collect ${count} ${blockType}`);

    // --- Inventory Pre-Check (Using State) ---
    let actualBlockTypeForCheck = blockType;
    // Use the passed mcData instance
    // Handle common block name variations for the check
    if (blockType === 'wood' || blockType === 'log') {
        const logTypesCheck = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
        for (const logType of logTypesCheck) {
            if (mcData.blocksByName[logType]) {
                actualBlockTypeForCheck = logType; // Use the first specific log type found for checking inventory
                break;
            }
        }
    } catch (e) { /* ignore mcData errors during check */ }

    // Use the inventory count from the provided state
    const currentInvCount = currentState.inventory.items[actualBlockTypeForCheck] || 0;

    if (currentInvCount >= count) {
      const successMsg = `Already have enough ${actualBlockTypeForCheck} (${currentInvCount}/${count}) according to current state.`;
      console.log(`[Action:collectBlock] ${successMsg}`);
      return successMsg;
    } else {
      console.log(`[Action:collectBlock] Need ${count}, state shows ${currentInvCount} of ${actualBlockTypeForCheck}. Starting collection.`);
      // Calculate how many more are needed based on state
      // Note: This might be slightly off if state was stale, but ObserveManager corrects next cycle.
    }
    // --- End Inventory Pre-Check ---

    // Simulation mode handling
    if (!bot.pathfinder) {
      console.log(`[Action:collectBlock] Simulating collecting ${count} ${blockType}`);
      bot.chat(`Collecting ${count} ${blockType} [SIMULATED]`);
      // DO NOT update currentState.inventory here
      return `Collected ${count} ${blockType} [SIMULATED]`;
    }

    // Real mode with pathfinder
    try {
      // Use the passed mcData instance
      // Handle common block name variations
      let actualBlockType = blockType;
      if (blockType === 'wood' || blockType === 'log') {
        const logTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
        for (const logType of logTypes) {
          if (mcData.blocksByName[logType]) {
            actualBlockType = logType;
            console.log(`[Action:collectBlock] Translating '${blockType}' to specific block type: ${actualBlockType}`);
            break;
          }
        }
      }

      const blockData = mcData.blocksByName[actualBlockType];
      if (!blockData) {
        return `Block type '${actualBlockType}' (from '${blockType}') not found in mcData`;
      }
      const blockId = blockData.id;
      // Calculate how many more we *attempt* to collect in this run
      const neededCount = count - currentInvCount; // Target based on state

      for (let i = 0; i < neededCount; i++) {
        const currentTotal = currentInvCount + i; // Track total count including initial inventory
        console.log(`[Action:collectBlock] Searching for block ${i + 1}/${neededCount} (total ${currentTotal + 1}/${count}) of '${actualBlockType}' (ID: ${blockId})`);
        const block = bot.findBlock({
          matching: blockId,
          maxDistance: 32,
          useExtraInfo: true
        });

        if (!block) {
          message = `Could not find more ${actualBlockType} nearby (attempted ${i}/${neededCount}, state had ${currentInvCount}).`;
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
        collectedCount++; // Increment count collected *in this action*
        console.log(`[Action:collectBlock] Successfully collected one ${actualBlockType} (attempt ${i + 1}/${neededCount}). Total collected this run: ${collectedCount}.`);

        // Small delay
        if (i < neededCount - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      if (!message) {
        if (collectedCount > 0) {
            message = `Collected ${collectedCount} ${actualBlockType}.`;
        } else {
            message = `Found no ${actualBlockType} to collect this run.`;
        }
      }
      console.log(`[Action:collectBlock] Finished: ${message}`);
      // Return message indicating how many were collected *this run*
      return message;

    } catch (error: any) {
      const errorMsg = `Failed during collect ${blockType}: ${error.message || error}`;
      console.error(`[Action:collectBlock] ${errorMsg}`);
      // Return message indicating partial success/failure
      return `${errorMsg} (Collected ${collectedCount} this run)`;
    }
  }
};
