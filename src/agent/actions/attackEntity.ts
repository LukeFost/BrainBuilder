import { Action, State } from '../types';
import { Bot } from 'mineflayer'; // Use specific Bot type
import { IndexedData } from 'minecraft-data'; // Import type
import { goals as PathfinderGoals } from 'mineflayer-pathfinder';

export const attackEntityAction: Action = {
  name: 'attackEntity',
  description: 'Attack a nearby entity. Args: <entityName>',
  execute: async (bot: Bot, mcData: IndexedData, args: string[], currentState: State): Promise<string> => {
    const [entityName] = args;
    if (!entityName) return "No entity name specified for attack.";

    try {
      // Find target based on current bot perception
      const targetEntity = Object.values(bot.entities)
        .find((e: any) => e !== bot.entity &&
                         e.position.distanceTo(bot.entity.position) < 10 && // Check distance
                         ( (e.name && e.name.toLowerCase().includes(entityName.toLowerCase())) ||
                           (e.username && e.username.toLowerCase().includes(entityName.toLowerCase())) ||
                           (e.type && e.type.toLowerCase().includes(entityName.toLowerCase())) ||
                           (e.displayName && e.displayName.toLowerCase().includes(entityName.toLowerCase())) )
              );

      if (!targetEntity) return `Could not find entity matching '${entityName}' nearby`;

      // Move closer if pathfinder available
      if (bot.pathfinder) {
          const goal = new PathfinderGoals.GoalNear(targetEntity.position.x, targetEntity.position.y, targetEntity.position.z, 2); // Goal within 2 blocks
          console.log(`[Action:attackEntity] Moving closer to ${targetEntity.displayName || entityName}`);
          await bot.pathfinder.goto(goal);
          console.log(`[Action:attackEntity] Reached near ${targetEntity.displayName || entityName}`);
      } else {
          console.log(`[Action:attackEntity] Pathfinder not available, attempting attack from current position.`);
      }

      // Attack the entity
      await bot.attack(targetEntity);
      return `Attacked ${targetEntity.displayName || entityName}`;
    } catch (error: any) {
      const errorMsg = `Failed to attack ${entityName}: ${error.message || error}`;
      console.error(`[Action:attackEntity] ${errorMsg}`);
      return errorMsg;
    }
  }
};
