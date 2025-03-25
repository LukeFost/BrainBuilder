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
  }
  
  async createPlan(state: State, goal: string): Promise<string[]> {
    const prompt = `
You are a Minecraft agent tasked with creating a plan to achieve a goal.

Current inventory: ${JSON.stringify(state.inventory)}
Current surroundings: ${JSON.stringify(state.surroundings)}
Short-term memory: ${state.memory.shortTerm.join('\n')}
Long-term memory: ${state.memory.longTerm}

Goal: ${goal}

Create a step-by-step plan to achieve this goal. Each step should be a single action.
Available actions:
- collectBlock <blockType> <count>
- moveToPosition <x> <y> <z>
- craftItem <itemName> <count>
- lookAround
- attackEntity <entityName>
- placeBlock <blockType> <x> <y> <z>
- sleep
- wakeUp
- dropItem <itemName> <count>
- generateAndExecuteCode <task description string> (Use for complex/novel tasks not covered by other actions)

Output your plan as a list of steps, one per line. Prefer specific actions when possible. Use generateAndExecuteCode only when necessary.
`;

    const response = await this.model.invoke([
      { role: 'system', content: prompt }
    ]);
    
    // Parse the response into individual steps
    return response.content.toString().split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  }
  
  async decideNextAction(state: State): Promise<string> {
    const prompt = `
You are a Minecraft agent deciding what to do next.

Current inventory: ${JSON.stringify(state.inventory)}
Current surroundings: ${JSON.stringify(state.surroundings)}
Short-term memory: ${state.memory.shortTerm.join('\n')}
Long-term memory: ${state.memory.longTerm}

Current goal: ${state.currentGoal || 'None set'}
Current plan: ${state.currentPlan?.join('\n') || 'No plan'}
Last action: ${state.lastAction || 'None'}
Last action result: ${state.lastActionResult || 'None'}

Decide what to do next. You can:
1. Follow the next step in your current plan
2. Create a new plan if the current one isn't working
3. Explore your surroundings if you need more information

Output your decision as an action command:
- collectBlock <blockType> <count>
- moveToPosition <x> <y> <z>
- craftItem <itemName> <count>
- lookAround
- attackEntity <entityName>
- placeBlock <blockType> <x> <y> <z>
- sleep
- wakeUp
- dropItem <itemName> <count>
- generateAndExecuteCode <task description string>

Output ONLY the single action command to execute next. Prefer specific actions over code generation unless necessary.
`;

    // If there's a plan, suggest the next step but let the LLM confirm/override
    let suggestedNext = state.currentPlan && state.currentPlan.length > 0 ? state.currentPlan[0] : '';
    if (suggestedNext) {
        prompt += `\nSuggested next step from plan: ${suggestedNext}`;
    }

    const response = await this.model.invoke([
      { role: 'system', content: prompt }
    ]);
    
    return response.content.toString().trim();
  }
}
