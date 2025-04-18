import { Action, State } from '../types';
import { Bot } from 'mineflayer'; // Use specific Bot type
import { IndexedData } from 'minecraft-data'; // Import type
import { goals as PathfinderGoals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3'; // Import Vec3
import { Block } from 'prismarine-block'; // Import Block type

export const placeBlockAction: Action = {
  name: 'placeBlock',
  description: 'Place a block at a specific position. Args: <blockType> <x> <y> <z>',
  execute: async (bot: Bot, mcData: IndexedData, args: string[], currentState: State): Promise<string> => {
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
        // Use the passed mcData instance

        // 1. Get item from bot's inventory (needed for bot.equip)
        // We already checked the state, but bot.equip needs the actual item object.
        const itemToPlace = bot.inventory.items().find((item: any) => item.name === blockType);
        if (!itemToPlace) {
            // This indicates a desync between state and reality. ObserveManager should fix it next cycle.
            console.error(`[Action:placeBlock] State showed ${blockType}, but not found in bot's actual inventory! State might be stale.`);
            return `Cannot place ${blockType}: Not found in actual inventory (state desync?).`;
        }

        // 2. Check reachability
        // Use a fixed reach distance as bot.blockInteractionRange might not exist
        const reachDistance = 4.5;
        if (bot.entity.position.distanceTo(targetPos) > reachDistance + 1) { // Add buffer
             // If too far, try moving closer first before detailed checks
             console.log(`[Action:placeBlock] Target position ${targetPos} is too far (${bot.entity.position.distanceTo(targetPos).toFixed(2)} > ${reachDistance}). Moving closer.`);
             const moveGoal = new PathfinderGoals.GoalNear(targetPos.x, targetPos.y, targetPos.z, reachDistance - 1); // Move within reach
             try {
                 await bot.pathfinder.goto(moveGoal);
                 console.log(`[Action:placeBlock] Moved closer to target position.`);
             } catch (moveError: any) {
                 return `Failed to move closer to placement target ${targetPos}: ${moveError.message}`;
             }
             // Re-check distance after moving
             if (bot.entity.position.distanceTo(targetPos) > reachDistance + 1) {
                 return `Cannot place ${blockType}: Target position ${targetPos} is still too far after attempting to move closer (${bot.entity.position.distanceTo(targetPos).toFixed(2)} > ${reachDistance}).`;
             }
        }

        // 3. Find a valid reference block and face vector
        let referenceBlock: Block | null = null; // Use imported Block type
        let faceVector: Vec3 | null = null;
        const possibleFaces = [
            new Vec3(0, -1, 0), // Place on block below (face is up)
            new Vec3(0, 1, 0),  // Place hanging from block above (face is down)
            new Vec3(-1, 0, 0), // Place on block to the west (face is east)
            new Vec3(1, 0, 0),  // Place on block to the east (face is west)
            new Vec3(0, 0, -1), // Place on block to the north (face is south)
            new Vec3(0, 0, 1)   // Place on block to the south (face is north)
        ];

        for (const face of possibleFaces) {
            const potentialRefPos = targetPos.minus(face); // Position of the block we'd click on
            const potentialRefBlock = bot.blockAt(potentialRefPos);

            // Check if the reference block is solid and within reach
            if (potentialRefBlock && potentialRefBlock.boundingBox === 'block' && bot.entity.position.distanceTo(potentialRefBlock.position.offset(0.5, 0.5, 0.5)) <= reachDistance) {
                 // Check if the target position is currently empty (or replaceable like grass)
                 const targetBlock = bot.blockAt(targetPos);
                 if (!targetBlock || targetBlock.boundingBox !== 'block' || targetBlock.name === 'air' || targetBlock.name === 'grass' || targetBlock.name === 'water') { // Allow replacing air, grass, water etc.
                    referenceBlock = potentialRefBlock;
                    faceVector = face;
                    console.log(`[Action:placeBlock] Found valid reference block: ${referenceBlock.name} at ${referenceBlock.position} with face ${faceVector}`);
                    break; // Found a valid placement strategy
                 } else {
                     console.log(`[Action:placeBlock] Target position ${targetPos} is occupied by ${targetBlock.name}, cannot use reference ${potentialRefBlock.name} at ${potentialRefPos}`);
                 }
            }
        }

        if (!referenceBlock || !faceVector) {
            return `Cannot place ${blockType}: No suitable empty space or solid reference block found adjacent to target position ${targetPos} within reach.`;
        }

        // 4. Move near the placement location (if needed, pathfinder might handle this implicitly with GoalPlaceBlock)
        // Ensure bot is looking at the reference block face? Mineflayer usually handles this.

        // *** Add check if target block is solid ***
        const targetBlock = bot.blockAt(targetPos);
        if (targetBlock && targetBlock.boundingBox === 'block' && targetBlock.name !== 'air' && targetBlock.name !== 'grass' && targetBlock.name !== 'water') { // Add other replaceable blocks if needed
            return `Failed to place ${blockType}: Target position ${targetPos} is occupied by solid block ${targetBlock.name}.`;
        }

        // 5. Equip the block
        console.log(`[Action:placeBlock] Equipping ${itemToPlace.name}`);
        await bot.equip(itemToPlace, 'hand');

        // 6. Place the block
        console.log(`[Action:placeBlock] Placing ${blockType} at ${targetPos} against ${referenceBlock.name} at ${referenceBlock.position} (face: ${faceVector})`);
        // Check if goal changed before placing
        if (currentState.currentGoal === "Waiting for instructions") {
            console.log(`[Action:placeBlock] Stopping action due to changed goal.`);
            return "Action stopped by user.";
        }
        try {
            await bot.placeBlock(referenceBlock, faceVector);
        } catch (placeError: any) {
             // Catch specific placement errors
             console.error(`[Action:placeBlock] Error during bot.placeBlock: ${placeError.message}`);
             // *** Improve timeout error message ***
             if (placeError.message.includes("Event blockUpdate") && placeError.message.includes("did not fire within timeout")) {
                 return `Failed to place ${blockType}: Placement timed out. Location ${targetPos} might be obstructed or invalid.`;
             }
             if (placeError.message.includes("Must be holding")) {
                 return `Failed to place ${blockType}: Bot wasn't holding the item correctly (equip failed?).`;
             } else if (placeError.message.includes("Interaction Failed")) {
                 return `Failed to place ${blockType}: Interaction failed. Is the spot obstructed or too far?`;
             }
             return `Failed to place ${blockType}: ${placeError.message}`; // General placement error
        }


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
