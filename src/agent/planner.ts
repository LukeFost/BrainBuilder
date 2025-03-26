import { ChatOpenAI } from '@langchain/openai';
import { State, Action } from './types';
import { SkillRepository, Skill } from './skills/skillRepository';
import { actions } from './actions/index';

export class Planner {
  private model: ChatOpenAI;
  private skillRepository: SkillRepository; // Added

  constructor(apiKey: string, skillRepository: SkillRepository) { // Updated constructor
    this.model = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: 'gpt-4o-mini', // Ensure this is the desired model
      temperature: 0.1, // Lower temperature for more deterministic plans
    });
    this.skillRepository = skillRepository; // Store skill repository
  }

  async createPlan(state: State, goal: string): Promise<string[]> {
    // Enhanced state summary including health, hunger, time, biome, memory, and plan history
    const stateSummary = `
Current Health: ${state.surroundings.health ?? 'Unknown'}
Current Hunger: ${state.surroundings.food ?? 'Unknown'}
Time of Day: ${state.surroundings.dayTime ?? 'Unknown'}
Current Biome: ${state.surroundings.biome ?? 'Unknown'}
Position: ${JSON.stringify(state.surroundings.position)}
Inventory: ${JSON.stringify(state.inventory.items)}
Nearby Blocks (sample): ${state.surroundings.nearbyBlocks?.slice(0, 10).join(', ') ?? 'None'}
Nearby Entities: ${state.surroundings.nearbyEntities?.join(', ') ?? 'None'}
Short-term Memory (last 5): ${state.memory.shortTerm?.slice(-5).join(' | ') ?? 'Empty'}
Long-term Memory Summary: ${state.memory.longTerm ?? 'None available'}
Previous Plan Steps (if any): ${state.currentPlan?.slice(0, 5).join(' -> ') ?? 'None'}
Last Action: ${state.lastAction || 'None'}
Last Action Result: ${state.lastActionResult || 'None'}
`;
    // Retrieve available skills/actions dynamically
    const availableSkills = this.skillRepository.getAllSkills();
    // Combine skill descriptions from repository with built-in actions
    const actionDescriptions = [
      // First add skills from repository
      ...availableSkills.map((skill: Skill) => `- ${skill.name}: ${skill.description}`),
      
      // Then add descriptions of built-in actions from actions module
      ...Object.entries(actions).map(([name, action]) => 
        `- ${name}: ${(action as Action).description}`)
    ].join('\n');

    const prompt = `
You are a meticulous and efficient Minecraft agent planner. Your task is to create a concise, step-by-step plan to achieve a given goal, considering the current state, available actions (skills), and past experiences.

Current State:
${stateSummary}

Goal: ${goal}

Available Actions (Skills):
${actionDescriptions}
- generateAndExecuteCode <task description string>: Use ONLY for complex tasks not covered by other actions
- askForHelp <question>: Use if stuck, goal unclear, resources missing after trying, or plan fails repeatedly

Planning Guidelines:
1.  **Analyze State:** Carefully consider inventory, surroundings, health, hunger, time, memory, and the last action's result.
2.  **Break Down Goal:** Decompose the goal into small, sequential, actionable steps using ONLY the available actions.
3.  **Resource Management:** Prioritize gathering necessary resources before attempting crafting or building. Always check inventory first.
4.  **Efficiency:** Choose the most direct sequence of actions. Use the moveToPosition action only when necessary for reaching resources or targets.
5.  **Error Handling:** If the 'Last Action Result' indicates a failure, the new plan MUST address the cause of the failure (e.g., collect missing items, choose a different location, use askForHelp). Avoid repeating failed actions without modification.
6.  **Skill Usage:** Select the most appropriate action for each step. Use generateAndExecuteCode sparingly for truly complex, multi-step procedures not covered by basic actions.
7.  **Stuck Detection:** If the same action fails multiple times or progress isn't being made, use askForHelp.
8.  **Output Format:** Output ONLY the list of planned actions, one action per line. Do NOT include explanations, numbering, comments, or any introductory/concluding text.

Plan:`; // Ensure 'Plan:' label is present for potential parsing

    try {
        console.log("[Planner] Generating plan with prompt:\n", prompt); // Log the prompt for debugging
        const response = await this.model.invoke(prompt); // Pass prompt directly
        let responseText = response.content.toString().trim(); // Trim whitespace first

        // Remove potential markdown code block fences (``` optionally followed by language name)
        responseText = responseText.replace(/^```(?:\w*\s*)?\n?/, '').replace(/\n?```$/, '');
        // Trim again after removing fences
        responseText = responseText.trim();

        // Parse the cleaned response into individual steps, removing potential "Plan:" prefix and numbering
        const planSteps = responseText.replace(/^Plan:\s*/i, '').split('\n')
          .map(line => line.trim().replace(/^\d+\.\s*/, '')) // Remove numbering
          .filter(line => line.length > 0 && !line.startsWith('//') && !line.startsWith('#')) // Filter empty lines/comments
          .filter(line => line !== '```'); // Filter out ``` lines

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
