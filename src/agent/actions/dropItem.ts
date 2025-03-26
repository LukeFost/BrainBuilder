import { Action, State } from '../types';
import * as mineflayer from 'mineflayer';

export const dropItemAction: Action = {
  name: 'dropItem',
  description: 'Drop items from inventory. Args: <itemName> <count>',
  execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
    const [itemName, countStr] = args;
    const count = parseInt(countStr, 10) || 1; // Default to dropping 1 if count is invalid/missing
    if (!itemName) return "No item name specified to drop.";
    if (isNaN(count) || count <= 0) return "Invalid count specified for dropItem.";

    // --- Inventory Check (Using State) ---
    const stateInvCount = currentState.inventory.items[itemName] || 0;
    if (stateInvCount <= 0) {
        return `No ${itemName} in inventory to drop according to state.`;
    }
    const countToDrop = Math.min(count, stateInvCount); // Can only drop what the state says we have
    // --- End Inventory Check ---

    try {
        // Find the item type ID needed for bot.toss
        const itemToDropData = bot.registry.itemsByName[itemName];
        if (!itemToDropData) {
            return `Item type '${itemName}' not found in bot registry. Cannot drop.`;
        }

        // Use bot.toss (requires item type ID, optional metadata, count)
        await bot.toss(itemToDropData.id, null, countToDrop);

        // DO NOT update state inventory here. ObserveManager will handle it.

        return `Dropped ${countToDrop} ${itemName}`;
    } catch (error: any) {
      const errorMsg = `Failed to drop ${itemName}: ${error.message || error}`;
      console.error(`[Action:dropItem] ${errorMsg}`);
      return errorMsg;
    }
  }
};
