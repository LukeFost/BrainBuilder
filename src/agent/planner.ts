import { ChatOpenAI } from '@langchain/openai';
import { State } from './types';

export class Planner {
  private model: ChatOpenAI;
  
  constructor(apiKey: string) {
    this.model = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: 'gpt-4o',
      temperature: 0.2,
    });
    this.model = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: 'gpt-4o', // Ensure this is the desired model
      temperature: 0.1, // Lower temperature for more deterministic plans
    });
  }

  async createPlan(state: State, goal: string): Promise<string[]> {
    // Add health/hunger to the state summary for better context
    const stateSummary = `
Current Health: ${state.surroundings.health ?? 'Unknown'}
Current Hunger: ${state.surroundings.food ?? 'Unknown'}
Position: ${JSON.stringify(state.surroundings.position)}
Inventory: ${JSON.stringify(state.inventory.items)}
Nearby Blocks (sample): ${state.surroundings.nearbyBlocks.slice(0, 10).join(', ')}
Nearby Entities: ${state.surroundings.nearbyEntities.join(', ')}
Short-term Memory (last 3): ${state.memory.shortTerm.slice(-3).join(' | ')}
Last Action Result: ${state.lastActionResult || 'None'}
`;

    const prompt = `
You are a Minecraft agent planner. Your task is to create a concise, step-by-step plan to achieve a goal, considering the current state.

Current State:
${stateSummary}

Goal: ${goal}

Available Actions:
- collectBlock <blockType> <count>
- moveToPosition <x> <y> <z>
- craftItem <itemName> <count>
- lookAround
- attackEntity <entityName>
- placeBlock <blockType> <x> <y> <z>
- sleep
- wakeUp
- dropItem <itemName> <count>
- generateAndExecuteCode <task description string> (Use ONLY for complex tasks not covered by other actions)
- askForHelp <question> (Use if stuck, goal unclear, or resources missing after trying)

Planning Guidelines:
1. Break the goal into small, actionable steps using ONLY the available actions.
2. Prioritize resource collection before crafting/building. Check inventory first.
3. If the last action failed (see state summary), the new plan should address the failure (e.g., get missing items).
4. Use 'askForHelp' if truly stuck or the goal is ambiguous.
5. Output ONLY the list of actions, one action per line. No explanations, numbering, or intro/outro text.

Plan:`; // Added 'Plan:' label for clarity

    try {
        const response = await this.model.invoke(prompt); // Pass prompt directly
        const responseText = response.content.toString();

        // Parse the response into individual steps, removing potential "Plan:" prefix and numbering
        const planSteps = responseText.replace(/^Plan:\s*/i, '').split('\n')
          .map(line => line.trim().replace(/^\d+\.\s*/, '')) // Remove numbering
          .filter(line => line.length > 0 && !line.startsWith('//') && !line.startsWith('#')); // Filter empty lines/comments

        console.log("[Planner] Generated Plan:", planSteps);
        if (planSteps.length === 0) {
            console.warn("[Planner] LLM generated an empty plan. Defaulting to askForHelp.");
            return ['askForHelp I generated an empty plan. What should I do next?'];
        }
        return planSteps;
    } catch (error) {
        console.error('[Planner] Error creating plan:', error);
        // Fallback plan on error
        return ['askForHelp I encountered an error while planning. What should I do?'];
    }
  }

  // REMOVED decideNextAction method
}
