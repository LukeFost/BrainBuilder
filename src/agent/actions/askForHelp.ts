import { Action, State } from '../types';
import { Bot } from 'mineflayer'; // Use specific Bot type
import { IndexedData } from 'minecraft-data'; // Import type

export const askForHelpAction: Action = {
    name: 'askForHelp',
    description: 'Ask the user (player) a question via chat. Args: <question string>',
    execute: async (bot: Bot, mcData: IndexedData, args: string[], currentState: State): Promise<string> => {
        const question = args.join(' ');
        if (question) {
            bot.chat(`[Help Needed] ${question}`);
            return `Asked for help: "${question}"`;
        } else {
            // Ask a generic question if none provided
            bot.chat("[Help Needed] I'm stuck but didn't formulate a question. What should I do?");
            return "Tried to ask for help, but no specific question was provided.";
        }
    }
};
