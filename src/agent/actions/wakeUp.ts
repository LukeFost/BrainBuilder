import { Action, State } from '../types';
import * as mineflayer from 'mineflayer';

export const wakeUpAction: Action = {
  name: 'wakeUp',
  description: 'Wake up from sleeping. Args: None',
  execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
    try {
      // Check if actually sleeping first? bot.isSleeping might exist or need check
      await bot.wake();
      return 'Woke up';
    } catch (error: any) {
      const errorMsg = `Failed to wake up: ${error.message || error}`;
      console.error(`[Action:wakeUp] ${errorMsg}`);
      return errorMsg;
    }
  }
};
