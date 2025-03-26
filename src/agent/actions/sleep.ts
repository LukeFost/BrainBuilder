import { Action, State } from '../types';
import * as mineflayer from 'mineflayer';
import { goals as PathfinderGoals } from 'mineflayer-pathfinder';

export const sleepAction: Action = {
  name: 'sleep',
  description: 'Sleep in a nearby bed. Args: None',
  execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
    try {
      // Find a bed nearby
      const bed = bot.findBlock({
        matching: (block: any) => bot.isABed(block), // Use helper function
        maxDistance: 10 // Search within 10 blocks
      });

      if (!bed) return 'No bed found nearby';

      // Move to the bed if pathfinder is available
      if (bot.pathfinder) {
          const goal = new PathfinderGoals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2); // Get within 2 blocks
          console.log(`[Action:sleep] Moving to bed at ${bed.position}`);
          await bot.pathfinder.goto(goal);
          console.log(`[Action:sleep] Reached bed.`);
      } else {
          console.log(`[Action:sleep] Pathfinder not available, attempting to sleep from current position.`);
      }

      // Attempt to sleep
      await bot.sleep(bed);
      return 'Sleeping in bed';
    } catch (error: any) {
      // Handle common sleep errors
      if (error.message && error.message.toLowerCase().includes('too far')) {
          return 'Failed to sleep: Bed is too far away.';
      } else if (error.message && error.message.toLowerCase().includes('not possible')) {
          return 'Failed to sleep: It is not night time or the bed is obstructed.';
      }
      // Generic error
      const errorMsg = `Failed to sleep: ${error.message || error}`;
      console.error(`[Action:sleep] ${errorMsg}`);
      return errorMsg;
    }
  }
};
