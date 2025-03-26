import { ChatOpenAI } from '@langchain/openai';
// Add RecentActionEntry to this import
import { State, Action, RecentActionEntry } from './types';
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
Recent Actions (last 5): ${state.memory.shortTerm.recentActions
            .slice(-5) // Get last 5 actions
            // Add type annotation here:
            .map((entry: RecentActionEntry) => `(${new Date(entry.timestamp).toLocaleTimeString()}) ${entry.action} -> ${entry.result.substring(0, 50)}...`) // Format them
            .join(' | ') || 'None'}
Long-term Memory Summary: ${state.memory.longTerm || 'None available'} // Getter now provides summary string
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
1.  **Analyze State:** Carefully consider inventory, surroundings, health, hunger, time, memory, and the last action's result. Check inventory *before* planning to collect items you already have.
2.  **Decompose Goal:** Break down the high-level goal into small, sequential, actionable steps using ONLY the available actions.
3.  **Tool Check & Crafting:** If the goal involves mining stone or ores (like coal_ore, iron_ore), the FIRST step MUST be to ensure a pickaxe of the appropriate tier is in inventory. If not, the plan MUST start with crafting the required pickaxe (e.g., \`craftItem wooden_pickaxe 1\`). Only AFTER confirming/crafting the pickaxe should \`collectBlock\` for stone/ore be planned. Wood requires an axe (or fist), dirt/sand requires a shovel (or fist).
4.  **Prerequisites:** Ensure prerequisites are met *before* attempting an action. Examples: Have logs before crafting planks. Have a crafting table *nearby* for table-required crafts (like pickaxes, torches). Have the correct tool equipped for \`collectBlock\`.
5.  **Resource Gathering:** Prioritize gathering all necessary raw materials for a multi-step craft or build task *before* starting the crafting/building steps.
6.  **Efficiency:** Choose the most direct sequence. Use \`moveToPosition\` only when necessary to reach resources, crafting stations, or targets. Avoid unnecessary movement.
7.  **Error Handling:** If the 'Last Action Result' indicates a failure, the new plan MUST address the cause. Examples: If \`craftItem\` fails with 'Need crafting table nearby', the next plan MUST include \`placeBlock crafting_table\` before retrying the craft. If \`collectBlock\` fails with 'Need a suitable tool', the next plan MUST include crafting the required tool. Avoid repeating the exact failed action immediately.
8.  **Skill Usage:** Select the most appropriate action. Use \`generateAndExecuteCode\` sparingly for complex, multi-step procedures not covered by basic actions (e.g., building a specific structure shape).
9.  **Stuck Detection:** If the same action fails multiple times (see Last Action Result) or progress isn't being made towards the goal despite several steps, use \`askForHelp\`.
9.  **Output Format:** Output ONLY the list of planned actions, one action per line. Do NOT include explanations, numbering, comments, or any introductory/concluding text. Ensure each line is a valid action call (e.g., \`collectBlock oak_log 5\`, \`craftItem crafting_table 1\`).

Plan:`; // Ensure 'Plan:' label is present for potential parsing

    try {
        console.log("[Planner] Generating plan with prompt:\n", prompt); // Log the prompt for debugging
        const response = await this.model.invoke(prompt); // Pass prompt directly
        let responseText = response.content.toString().trim(); // Trim whitespace first

        // More robust removal of markdown code block fences (``` optionally followed by language name)
        // Handles potential whitespace around fences and variations
        responseText = responseText.replace(/^\s*```(?:\w*\s*)?\n?/, '').replace(/\n?\s*```\s*$/, '');
        // Trim again after removing fences
        responseText = responseText.trim();

        // Parse the cleaned response into individual steps, removing potential "Plan:" prefix and numbering
        const planSteps = responseText.replace(/^Plan:\s*/i, '').split('\n')
          .map(line => line.trim().replace(/^\d+\.\s*/, '')) // Remove numbering and trim each line
          .filter(line => line.length > 0 && !line.startsWith('//') && !line.startsWith('#')) // Filter empty lines/comments
          .filter(line => line.trim() !== '```'); // Trim before comparing to filter out ``` lines robustly

        console.log("[Planner] Generated Plan:", planSteps);
        if (planSteps.length === 0 && responseText.length > 0) { // Check if responseText wasn't empty before filtering
             console.warn("[Planner] Plan resulted in empty steps after filtering. Original response text:", response.content.toString());
             // Decide if askForHelp is still the right fallback
             return ['askForHelp My plan generation resulted in empty steps after filtering. What should I do?'];
        } else if (planSteps.length === 0) { // Original check for truly empty generation
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
