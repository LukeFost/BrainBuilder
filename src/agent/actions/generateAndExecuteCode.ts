import { Action, State } from '../types';
import * as mineflayer from 'mineflayer';
import { Coder } from '../coder'; // Assuming Coder is in the parent directory
import { config } from 'dotenv';

config(); // Load .env variables

export const generateAndExecuteCodeAction: Action = {
  name: 'generateAndExecuteCode',
  description: 'Generates and executes JavaScript code using an LLM to perform a complex or novel task described in natural language. Use for tasks not covered by other specific actions. Input args: <task description string>',
  execute: async (bot: mineflayer.Bot, args: string[], currentState: State): Promise<string> => {
    const taskDescription = args.join(' ');
    if (!taskDescription) {
      return "Error: No task description provided for code generation.";
    }

    // Removed the specific 'build shelter' pre-check logic.
    // The planner/thinker should ensure prerequisites or the generated code should handle checks.
    console.log(`[Action:generateAndExecuteCode] Received task: "${taskDescription}"`);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return "Error: OPENAI_API_KEY is not configured. Cannot generate code.";
    }

    // Instantiate Coder here or ensure it's passed/available
    const coder = new Coder(bot, apiKey);

    try {
      // Pass the current state to the coder for context
      const result = await coder.generateAndExecute(taskDescription, currentState);
      // Return the message from the coder's execution result
      return result.message;
    } catch (error: any) {
      console.error(`[Action:generateAndExecuteCode] Unexpected error during code generation/execution: ${error}`);
      return `Failed to generate or execute code for task "${taskDescription}": ${error.message || error}`;
    }
  }
};
