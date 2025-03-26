import { Action, State } from '../types';
import * as mineflayer from 'mineflayer';
import * as mcDataModule from 'minecraft-data';
import { goals as PathfinderGoals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3'; // Import Vec3

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

export const placeBlockAction: Action = {
  name: 'placeBlock',
  description: 'Place a block at a specific position. Args: <blockType> <x> <y> <z>',
  execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
    const [blockType, xStr, yStr, zStr] = args;
    const targetPos = new Vec3(parseFloat(xStr), parseFloat(yStr), parseFloat(zStr)); // Use Vec3

    if (isNaN(targetPos.x) || isNaN(targetPos.y) || isNaN(targetPos.z)) {
        return `Invalid coordinates for placeBlock: ${args.join(', ')}`;
    }

    console.log(`[Action:placeBlock] Request to place ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`);

    // --- Inventory Check (Using State) ---
    const stateInvCount = currentState.inventory.items[blockType] || 0;
    if (stateInvCount <= 0) {
        console.error(`[Action:placeBlock] Block ${blockType} not found in state inventory!`);
        return `Cannot place ${blockType}: Not found in inventory according to state.`;
    }
    // --- End Inventory Check ---

    // Simulation mode handling
    if (!bot.pathfinder) {
        console.log(`[Action:placeBlock] Simulating placement of ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`);
        bot.chat(`Placing ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) [SIMULATED]`);
        // DO NOT update currentState.inventory here
        return `Placed ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) [SIMULATED]`;
    }

    // Real mode with pathfinder
    try {
        const dataForVersion = mcData(bot.version as string);

        // 1. Get item from bot's inventory (needed for bot.equip)
        // We already checked the state, but bot.equip needs the actual item object.
        const itemToPlace = bot.inventory.items().find((item: any) => item.name === blockType);
        if (!itemToPlace) {
            // This indicates a desync between state and reality. ObserveManager should fix it next cycle.
            console.error(`[Action:placeBlock] State showed ${blockType}, but not found in bot's actual inventory! State might be stale.`);
            return `Cannot place ${blockType}: Not found in actual inventory (state desync?).`;
        }

        // 2. Find a reference block and face vector
        // Strategy: Try placing on the block directly below the target position.
        const referenceBlockPos = targetPos.offset(0, -1, 0); // Use Vec3 offset
        const referenceBlock = bot.blockAt(referenceBlockPos);

        if (!referenceBlock || referenceBlock.name === 'air' || referenceBlock.boundingBox !== 'block') {
            // TODO: Add more sophisticated reference block finding (adjacent blocks)
            return `Cannot place ${blockType}: No solid reference block found below target position (${referenceBlockPos.x}, ${referenceBlockPos.y}, ${referenceBlockPos.z}) to place against. Found ${referenceBlock?.name}.`;
        }

        // The face vector points from the reference block towards the target block.
        // For placing on top, the face vector is (0, 1, 0)
        const faceVector = new Vec3(0, 1, 0); // Assuming placement on top for simplicity

        // 3. Move near the placement location (near the reference block)
        // Goal is to be close enough to interact with the reference block.
        const goal = new PathfinderGoals.GoalPlaceBlock(targetPos, bot.world, {
            range: 3, // Adjust range as needed
            faces: [faceVector] // Specify the face we intend to click
        });
        // const goal = new PathfinderGoals.GoalNear(referenceBlockPos.x, referenceBlockPos.y, referenceBlockPos.z, 3); // Simpler alternative

        console.log(`[Action:placeBlock] Moving near reference block at ${referenceBlockPos}`);
        await bot.pathfinder.goto(goal);
        console.log(`[Action:placeBlock] Reached near reference block.`);

        // 4. Equip the block
        console.log(`[Action:placeBlock] Equipping ${itemToPlace.name}`);
        await bot.equip(itemToPlace, 'hand');

        // 5. Place the block
        console.log(`[Action:placeBlock] Placing ${blockType} against ${referenceBlock.name} at ${referenceBlockPos} (face: ${faceVector})`);
        await bot.placeBlock(referenceBlock, faceVector);

        // DO NOT update state inventory here. ObserveManager will handle it.

        return `Placed ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`;

    } catch (error: any) {
        const errorMsg = `Failed to place ${blockType}: ${error.message || error}`;
        console.error(`[Action:placeBlock] ${errorMsg}`);
        if (error.message && (error.message.includes('Cannot place block') || error.message.includes('dig instead') || error.message.includes('No block has been placed'))) {
             return `Failed to place ${blockType}: Placement obstructed, too far, or invalid location? (${error.message})`;
        }
        return errorMsg;
    }
  }
};
