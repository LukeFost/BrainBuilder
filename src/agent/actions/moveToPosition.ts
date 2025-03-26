import { Action, State } from '../types';
import { Bot } from 'mineflayer'; // Use specific Bot type
import { IndexedData } from 'minecraft-data'; // Import type
import { goals as PathfinderGoals } from 'mineflayer-pathfinder';

export const moveToPositionAction: Action = {
  name: 'moveToPosition',
  description: 'Move to a specific position. Args: <x> <y> <z>',
  execute: async (bot: Bot, mcData: IndexedData, args: string[], currentState: State): Promise<string> => {
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

      // Check if goal changed *before* starting the potentially long move
      if (currentState.currentGoal === "Waiting for instructions") {
          console.log(`[Action:moveToPosition] Stopping action before starting move due to changed goal.`);
          return "Action stopped by user.";
      }

      await bot.pathfinder.goto(target);

      // Check if goal changed *after* the move completed (less critical, but good practice)
      if (currentState.currentGoal === "Waiting for instructions") {
          console.log(`[Action:moveToPosition] Goal changed during move. Reporting success but stopping next cycle.`);
          // Action technically succeeded, but the loop will stop next.
      } else {
          console.log(`[Action:moveToPosition] Successfully reached or got close to (${x}, ${y}, ${z})`);
      }
      return `Moved to position (${x}, ${y}, ${z})`;
    } catch (error: any) {
      const errorMsg = `Failed to move to position (${x}, ${y}, ${z}): ${error.message || error}`;
      console.error(`[Action:moveToPosition] ${errorMsg}`);
      return errorMsg;
    }
  }
};
