import { Action, State } from '../types';
import * as mineflayer from 'mineflayer';

export const askForHelpAction: Action = {
    name: 'askForHelp',
    description: 'Ask the user (player) a question via chat. Args: <question string>',
    execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
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
