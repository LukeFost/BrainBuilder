import { Action, State } from '../types';
import { Bot } from 'mineflayer'; // Use specific Bot type
import { IndexedData } from 'minecraft-data'; // Import type

export const lookAroundAction: Action = {
  name: 'lookAround',
  description: 'Look around and gather information about surroundings. Args: None',
  execute: async (bot: Bot, mcData: IndexedData, args: string[], currentState: State): Promise<string> => {
    // This action primarily relies on ObserveManager to update state.
    // Here, we just return a summary based on the *current* bot state,
    // acknowledging that the full update happens in the observe phase.
    const position = bot.entity.position;
    const nearbyEntities = Object.values(bot.entities)
      .filter((entity: any) => entity !== bot.entity && entity.position.distanceTo(bot.entity.position) < 20)
      .map((entity: any) => entity.displayName || entity.name || entity.username || entity.type);

    const block = bot.blockAt(position.floored());
    // Use mcData to get a potentially more reliable block name
    const blockName = block ? (mcData.blocks[block.type]?.name ?? block.name) : 'unknown';

    return `Looking around: I see ${nearbyEntities.join(', ') || 'nothing nearby'}. Standing on ${blockName} at position (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`;
  }
};
