import { Action, State } from '../types';
import * as mineflayer from 'mineflayer';

export const lookAroundAction: Action = {
  name: 'lookAround',
  description: 'Look around and gather information about surroundings. Args: None',
  execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
    // This action primarily relies on ObserveManager to update state.
    // Here, we just return a summary based on the *current* bot state,
    // acknowledging that the full update happens in the observe phase.
    const position = bot.entity.position;
    const nearbyEntities = Object.values(bot.entities)
      .filter((entity: any) => entity !== bot.entity && entity.position.distanceTo(bot.entity.position) < 20)
      .map((entity: any) => entity.displayName || entity.name || entity.username || entity.type);

    const block = bot.blockAt(position.floored());

    return `Looking around: I see ${nearbyEntities.join(', ') || 'nothing nearby'}. Standing on ${block?.name || 'unknown'} at position (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`;
  }
};
