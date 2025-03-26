const mineflayer = require('mineflayer');
const dotenv = require('dotenv');
const { ChatOpenAI } = require('@langchain/openai');
const { SkillRepository } = require('./agent/skills/skillRepository.js'); // Import SkillRepository

// Load environment variables
dotenv.config();

// Instantiate SkillRepository
const skillRepository = new SkillRepository();

// Bot configuration
const botConfig = {
  host: 'localhost', // or your LAN IP address
  port: parseInt(process.env.MINECRAFT_PORT || '25565'), // LAN port from Minecraft
  username: 'AIBot',
  version: '1.21.1', // Updated to match your LAN world version
  auth: 'offline'
};

console.log(`Connecting to Minecraft server at ${botConfig.host}:${botConfig.port}`);

// Create bot
const bot = mineflayer.createBot(botConfig);

// Initialize memory and state
let memory = {
  shortTerm: [],
  longTerm: 'I am an AI assistant in Minecraft. I help players build and explore.'
};

let state = {
  inventory: { items: {} },
  surroundings: {
    nearbyBlocks: [],
    nearbyEntities: [],
    position: { x: 0, y: 0, z: 0 }
  },
  currentGoal: 'Collect wood and build a small shelter',
  currentPlan: [],
  lastAction: null,
  lastActionResult: null
};

// Initialize OpenAI
const openai = new ChatOpenAI({
  openAIApiKey: process.env.OPENAI_API_KEY,
  modelName: 'gpt-4o',
  temperature: 0.2,
});

// Import actions from the new index file (assuming compiled to JS)
const { actions } = require('./agent/actions/index.js');


// Bot event handlers
bot.once('spawn', async () => { // Make spawn handler async
  console.log('Bot has spawned');
  await skillRepository.loadSkills(); // Load skills early

  try {
    // Try to initialize mineflayer-pathfinder if it's available
    try {
      // Attempt to load pathfinder plugin
      const pathfinder = require('mineflayer-pathfinder');
      bot.loadPlugin(pathfinder.pathfinder);
      
      // Set up movements
      const mcData = require('minecraft-data')(bot.version);
      const defaultMove = new pathfinder.Movements(bot, mcData);
      bot.pathfinder.setMovements(defaultMove);
      
      console.log('Pathfinder initialized successfully');
      
      // Add ability to move to specific coord
      bot.moveToPosition = async (x, y, z) => {
        const goal = new pathfinder.goals.GoalNear(x, y, z, 1);
        return bot.pathfinder.goto(goal);
      };
      
      // Set up event handler for when path finding completes
      bot.on('goal_reached', () => {
        console.log('Goal reached!');
      });
      
      // Running in real movement mode
      console.log('Bot will use real movement');
    } catch (e) {
      console.log('Pathfinder not available, running in simulation mode');
      console.log(`Pathfinder error: ${e.message}`);
      
      // Create simple movement simulation
      bot.moveToPosition = async (x, y, z) => {
        return new Promise(resolve => {
          console.log(`Simulating movement to (${x}, ${y}, ${z})`);
          bot.chat(`Moving to (${x}, ${y}, ${z}) [SIMULATED]`);
          setTimeout(resolve, 1000);
        });
      };
    }
  } catch (error) {
    console.error('Error in bot initialization:', error);
  }
  
  // Start the agent loop
  startAgentLoop();
});

bot.on('chat', (username, message) => {
  // Handle commands from chat
  if (username === bot.username) return;
  
  if (message.startsWith('goal ')) {
    const newGoal = message.slice(5);
    state.currentGoal = newGoal;
    state.currentPlan = [];
    bot.chat(`New goal set: ${newGoal}`);
    addToShortTermMemory(`Player ${username} set a new goal: ${newGoal}`);
  } else if (message === 'status') {
    const status = `Goal: ${state.currentGoal || 'None'}\nPlan: ${state.currentPlan?.join(', ') || 'None'}\nLast action: ${state.lastAction || 'None'}\nResult: ${state.lastActionResult || 'None'}`;
    bot.chat(status);
  } else if (message === 'memory') {
    bot.chat(`Short-term memory: ${memory.shortTerm.join(', ')}`);
    bot.chat(`Long-term memory available`);
  } else if (message === 'inventory') {
    const items = Object.entries(state.inventory.items)
      .map(([item, count]) => `${item}: ${count}`)
      .join(', ');
    bot.chat(`Inventory: ${items || 'Empty'}`);
  } else if (message === 'help') {
    bot.chat(`
Available commands:
- goal <text>: Set a new goal
- status: Show current status
- memory: Show memory contents
- inventory: Show inventory
- help: Show this help message
- stop: Stop current activity
- explore: Force exploration mode
    `);
  } else if (message === 'stop') {
    bot.chat('Stopping current activity');
    addToShortTermMemory(`Player ${username} requested to stop current activity`);
  } else if (message === 'explore') {
    state.currentGoal = 'Explore the surroundings and gather information';
    state.currentPlan = [];
    bot.chat('Switching to exploration mode');
    addToShortTermMemory(`Player ${username} requested exploration mode`);
  }
});

bot.on('kicked', (reason) => console.log('Bot was kicked:', reason));
bot.on('error', console.error);

// Memory management
function addToShortTermMemory(entry) {
  memory.shortTerm.push(entry);
  if (memory.shortTerm.length > 10) {
    // Move oldest entries to long-term memory
    const toRemove = memory.shortTerm.slice(0, memory.shortTerm.length - 5);
    memory.shortTerm = memory.shortTerm.slice(memory.shortTerm.length - 5);
    
    // Add to long-term memory
    memory.longTerm += `\n- ${toRemove.join('\n- ')}`;
  }
}

// Agent loop
async function startAgentLoop() {
  console.log('Starting agent loop (sequential execution)');
  let isRunning = true; // Flag to control the loop

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
      console.log("\nStopping agent loop (Ctrl+C detected)...");
      isRunning = false;
      // Optional: Add cleanup code here, like stopping pathfinder
      if (bot.pathfinder) {
          bot.pathfinder.stop();
      }
      bot.quit('Agent stopped by user.');
      // Give time for cleanup and exit
      setTimeout(() => process.exit(0), 1000);
  });

  while (isRunning) {
      try {
          console.log('\n--- Agent Cycle Start ---');
          // OBSERVE: Update state with current observations
          await observe();
          // Log concise observation summary
          const inventorySummary = Object.entries(state.inventory.items)
              .map(([name, count]) => `${name}:${count}`)
              .join(', ');
          console.log(`[Observe] Pos: ${state.surroundings.position.x.toFixed(1)},${state.surroundings.position.y.toFixed(1)},${state.surroundings.position.z.toFixed(1)} | Inv: ${inventorySummary || 'Empty'}`);


          // THINK: Plan or decide on next action
          await think();
          console.log(`[Think] Goal: ${state.currentGoal} | Plan Step: ${state.currentPlan ? state.currentPlan[0] : 'None'} | Decided Action: ${state.lastAction || 'None'}`);

          // ACT: Execute the decided action
          await act();
          // Log concise action result
          const resultSummary = state.lastActionResult?.length > 100
              ? state.lastActionResult.substring(0, 97) + '...'
              : state.lastActionResult;
          console.log(`[Act] Result: ${resultSummary}`);

          // Log current status summary
          console.log('--- Agent Cycle End ---');
          // console.log(`Goal: ${state.currentGoal}`); // Already logged in Think
          // console.log(`Plan: ${state.currentPlan?.join('\n  ') || 'None'}`); // Can be verbose

          // Check if loop should continue
          if (!isRunning) break;

          // Wait before the next cycle
          const delay = 5000; // 5 seconds
          // console.log(`Waiting ${delay / 1000} seconds...`); // Less verbose
          await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
          console.error('FATAL ERROR in agent loop:', error);
          addToShortTermMemory(`FATAL ERROR in agent loop: ${error.message}`);
          // Optional: Decide whether to stop or try to recover
          if (isRunning) {
              console.log('Attempting to continue after 10 seconds...');
              await new Promise(resolve => setTimeout(resolve, 10000));
          }
      }
  }
  console.log("Agent loop stopped.");
}

// Observe function
async function observe() {
  try {
    // Update state with current observations
    const position = bot.entity.position;
    
    // Get inventory
    const inventory = {};
    bot.inventory.items().forEach(item => {
      inventory[item.name] = (inventory[item.name] || 0) + item.count;
    });
    
    // Get nearby blocks (simplified)
    const nearbyBlocks = [];
    for (let x = -3; x <= 3; x++) {
      for (let y = -3; y <= 3; y++) {
        for (let z = -3; z <= 3; z++) {
          const block = bot.blockAt(position.offset(x, y, z));
          if (block && block.name !== 'air') {
            nearbyBlocks.push(block.name);
          }
        }
      }
    }
    
    // Get nearby entities
    const nearbyEntities = Object.values(bot.entities)
      .filter(entity => entity.position.distanceTo(bot.entity.position) < 10)
      .map(entity => entity.name || entity.username || entity.type);
    
    // Update state
    state.inventory.items = inventory;
    state.surroundings = {
      nearbyBlocks: Array.from(new Set(nearbyBlocks)),
      nearbyEntities,
      position: {
        x: position.x,
        y: position.y,
        z: position.z
      }
    };
  } catch (error) {
    console.error('Error in observe function:', error);
  }
}

// Think function
async function think() {
  try {
    let needsReplan = false;
    let reason = "";

    // Reason 1: Last action failed due to missing resources or finding items
    if (state.lastActionResult &&
        (state.lastActionResult.toLowerCase().includes('not enough') ||
         state.lastActionResult.toLowerCase().includes('could not find') ||
         state.lastActionResult.toLowerCase().includes('no recipe found') || // Added check for recipe failure
         state.lastActionResult.toLowerCase().includes('need a crafting table') // Added check for table needed
        )) {
        needsReplan = true;
        reason = `Last action failed due to prerequisites: "${state.lastActionResult}"`;
    }
    // Reason 2: No plan exists or plan is completed
    else if (!state.currentPlan || state.currentPlan.length === 0) {
        needsReplan = true;
        reason = "No current plan or plan completed.";
    }
    // Reason 3: Explicit failure message (optional, more robust check)
    else if (state.lastActionResult && state.lastActionResult.toLowerCase().includes('failed')) {
        // Avoid replanning if the failure was due to the *previous* check (e.g. "Failed during collect... (Collected 0/5)")
        if (!reason) { // Only trigger if not already caught by prerequisite check
             needsReplan = true;
             reason = `Last action explicitly failed: "${state.lastActionResult}"`;
        }
    }

    if (needsReplan) {
        console.log(`[Think] Replanning needed. Reason: ${reason}`);
        addToShortTermMemory(`Replanning needed: ${reason}`); // Add to memory
        const plan = await createPlan(); // createPlan now includes failure context
        state.currentPlan = plan;
        // Decide the first action from the new plan immediately
        if (state.currentPlan && state.currentPlan.length > 0) {
            state.lastAction = state.currentPlan[0];
            console.log(`[Think] New plan created. First action: ${state.lastAction}`);
        } else {
            state.lastAction = 'lookAround'; // Fallback if new plan is empty
             console.log(`[Think] New plan is empty. Defaulting to: ${state.lastAction}`);
        }
        return; // Exit think early as we've decided the action
    }

    // If no replan needed, decide next action from the current plan
    if (state.currentPlan && state.currentPlan.length > 0) {
        state.lastAction = state.currentPlan[0];
        // console.log(`[Think] Continuing plan. Next action: ${state.lastAction}`); // Less verbose logging
    } else {
        // Should have been caught by replan logic, but as a fallback:
        console.log("[Think] No plan and no replan triggered? Defaulting to lookAround.");
        state.lastAction = 'lookAround';
    }

  } catch (error) {
    console.error('[Think] Error in think function:', error);
    state.lastAction = 'lookAround'; // Fallback on error
  }
}

// Create a plan
async function createPlan() {
  try {
    // Add failure context to the prompt if available
    let failureContext = '';
    if (state.lastActionResult && (state.lastActionResult.toLowerCase().includes('not enough') || state.lastActionResult.toLowerCase().includes('could not find') || state.lastActionResult.toLowerCase().includes('failed') || state.lastActionResult.toLowerCase().includes('no recipe') || state.lastActionResult.toLowerCase().includes('need a crafting table'))) {
        failureContext = `\nIMPORTANT CONTEXT: Your previous action likely failed or was insufficient. The result was: "${state.lastActionResult}". Create a new plan that addresses this issue (e.g., collect missing resources *before* trying to craft/build, find a different location if blocks weren't found, craft a crafting table if needed). Do not simply repeat the failed action immediately.`;
    }

    // Get available skills for the prompt
    const availableSkills = skillRepository.getAllSkills();
    let skillsPromptSection = '';
    if (availableSkills.length > 0) {
        skillsPromptSection = `\nAvailable Skills (Use with 'executeSkill <skillName> [args...]'):\n`;
        skillsPromptSection += availableSkills.map(s => `- ${s.name}(${s.parameters.join(', ')}): ${s.description}`).join('\n');
    }

    const prompt = `
You are a helpful and resourceful Minecraft agent. Your primary goal is to survive, explore, gather resources, build, and achieve tasks set by the user or your own long-term goals.

Current Goal: ${state.currentGoal}

Current State:
- Position: ${JSON.stringify(state.surroundings.position)}
- Inventory: ${JSON.stringify(state.inventory.items)}
- Nearby Blocks (sample): ${state.surroundings.nearbyBlocks.slice(0, 15).join(', ')}
- Nearby Entities: ${state.surroundings.nearbyEntities.join(', ')}
- Recent Events (Memory): ${memory.shortTerm.slice(-5).join(' | ')}
${failureContext}

Based on the current goal and state, create a concise, step-by-step plan using ONLY the available actions below.

Available Actions:
- lookAround: Get current position, nearby blocks/entities. Useful if unsure what's nearby.
- moveToPosition <x> <y> <z>: Move to specific coordinates using pathfinding.
- collectBlock <block_type> <count>: Collect a specific number of blocks (e.g., 'collectBlock oak_log 5', 'collectBlock cobblestone 10'). Be specific with block types (oak_log, cobblestone, dirt, etc.).
- craftItem <item_name> <count>: Craft items (e.g., 'craftItem oak_planks 20', 'craftItem stick 4', 'craftItem crafting_table 1'). Assumes you have ingredients. Will fail if you don't. Requires crafting table for many recipes.
- placeBlock <block_type> <x> <y> <z>: Place a block from your inventory at specific coordinates. Requires a nearby reference block.
- attackEntity <entity_name>: Attack a nearby entity (e.g., 'attackEntity zombie').
- generateAndExecuteCode <task_description>: For complex or novel tasks not covered by other actions. Describe the task clearly (e.g., "generateAndExecuteCode Build a simple 4x4 shelter using oak_planks near 100, 64, 200"). Requires materials! Use specific actions first if possible.
- askForHelp <question>: Ask the user (player) a question via chat if you are stuck, the goal is unclear, you lack resources after trying, or need guidance. (e.g., "askForHelp I need 5 oak logs but can't find any oak trees, where should I look?", "askForHelp What kind of house should I build?").
${skillsPromptSection} {/* Add skills section here */}

Planning Guidelines:
1.  Break down the goal into small, achievable steps using the available actions.
2.  Ensure resource prerequisites are met. If you need planks, plan to 'collectBlock oak_log' first, then 'craftItem oak_planks'. If you need a tool, plan to craft it.
3.  If the previous action failed due to missing resources/items, the FIRST step of the new plan should usually be to acquire them (e.g., 'collectBlock' or 'craftItem').
4.  If the goal is vague (like 'explore'), plan actions like 'lookAround' and 'moveToPosition' to nearby interesting areas or in a consistent direction for a short distance.
5.  If you are genuinely stuck after trying, or the goal requires clarification, use 'askForHelp'. Don't get stuck in loops.
6.  You can use 'executeSkill' to perform complex actions defined in the skills library. Pass arguments as needed.
7.  Output ONLY the list of actions, one action per line. Do not add explanations or numbering.

Plan:`; // Added 'Plan:' label for clarity

    const response = await openai.invoke([
      // Use standard message format
      { role: 'system', content: prompt }
    ]);

    const responseText = response.content.toString();
    // Extract plan steps, removing potential "Plan:" prefix and numbering
    const planSteps = responseText.replace(/^Plan:\s*/i, '').split('\n')
      .map(line => line.trim().replace(/^\d+\.\s*/, '')) // Remove numbering
      .filter(line => line.length > 0 && !line.startsWith('//') && !line.startsWith('#')); // Filter empty lines and comments

    console.log("[createPlan] Generated Plan:", planSteps);
    if (planSteps.length === 0) {
        console.warn("[createPlan] LLM generated an empty plan. Defaulting to askForHelp.");
        return ['askForHelp I generated an empty plan. What should I do next?'];
    }
    return planSteps;

  } catch (error) {
    console.error('[createPlan] Error creating plan:', error);
    addToShortTermMemory(`Error creating plan: ${error.message}`);
    return ['askForHelp I encountered an error while planning. What should I do?']; // Ask for help on error
  }
}

// Decide next action
async function decideNextAction() {
  try {
    // If we have a current plan, use the next step
    if (state.currentPlan && state.currentPlan.length > 0) {
      return state.currentPlan[0];
    }
    
    const prompt = `
You are a Minecraft agent deciding what to do next.

Current inventory: ${JSON.stringify(state.inventory)}
Current surroundings: ${JSON.stringify(state.surroundings)}
Short-term memory: ${memory.shortTerm.join('\n')}
Long-term memory: ${memory.longTerm}

Current goal: ${state.currentGoal || 'None set'}
Current plan: ${state.currentPlan?.join('\n') || 'No plan'}
Last action: ${state.lastAction || 'None'}
Last action result: ${state.lastActionResult || 'None'}

Decide what to do next. You can:
1. Create a new plan if you need more information
2. Explore your surroundings if you need more information

Output your decision as an action command:
- lookAround
- moveToPosition <x> <y> <z>
- collectBlock <blockType> <count>
- buildShelter

Only output the action command, nothing else.
`;

    const response = await openai.invoke([
      { role: 'system', content: prompt }
    ]);
    
    return response.content.toString().trim();
  } catch (error) {
    console.error('Error deciding next action:', error);
    return 'lookAround';
  }
}

// Act function
async function act() {
  if (!state.lastAction) {
    state.lastActionResult = "No action decided to perform.";
    console.log("[Act] " + state.lastActionResult);
    return;
  }

  // Parse action and arguments
  const parts = state.lastAction.split(' ');
  const actionName = parts[0];
  const args = parts.slice(1);
  let result = `Unknown action: ${actionName}`; // Default result

  try {
    console.log(`[Act] Executing action: ${actionName} with args: ${args.join(', ')}`);

    // Execute action using the imported actions object
    if (actions[actionName]) {
        // Pass bot, args, and the current state to the action's execute method
        result = await actions[actionName].execute(bot, args, state);
    }
    // --- Handle executeSkill separately as it uses skillRepository ---
    else if (actionName === 'executeSkill') {
        const skillName = args[0];
        const skillArgs = args.slice(1);
        const skill = skillRepository.getSkill(skillName);

        if (!skill) {
            result = `Error: Skill "${skillName}" not found in the library.`;
        } else {
            console.log(`[Act] Executing skill: ${skillName} with args: ${skillArgs.join(', ')}`);
            // Prepare code for Coder (wrap in main function, pass args)
            const skillCodeForCoder = `
    // Skill: ${skill.name}
    // Description: ${skill.description}
    async function main(bot, log, Vec3, skillArgs) {
      log(bot, "Executing skill: ${skill.name}");
      try {
        // Make skillArgs available to the skill's code
        // Parameters defined in skill.parameters should map to skillArgs array
        ${skill.parameters.map((param, index) => `const ${param} = skillArgs[${index}];`).join('\n        ')}

        // --- Skill Code Start ---
        ${skill.code}
        // --- Skill Code End ---

        // Skills should ideally return a result string
        // If the skill code doesn't return, provide a default success message
        // Example: return "Skill ${skill.name} completed successfully.";
      } catch (error) {
        log(bot, 'Skill Execution Error (${skill.name}):', error.message || error);
        return 'Skill "${skill.name}" failed: ' + (error.message || error);
      }
    }
    module.exports = main;`;

            // Use the Coder to execute this wrapped code
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                 result = "Error: OPENAI_API_KEY is not configured. Cannot execute skill via Coder.";
            } else {
                try {
                    // --- Coder Execution Placeholder ---
                    console.warn(`[Act] Skill execution via Coder needs implementation. Simulating call for ${skillName}.`);
                    result = `Attempted to execute skill "${skillName}" (implementation pending). Code:\n${skill.code}`;
                    // --- End Placeholder ---

                    /* // Ideal Coder usage (if Coder is adapted):
                    const { Coder } = require('./agent/coder.js'); // Assuming Coder is correctly required elsewhere or passed
                    const coder = new Coder(bot, apiKey);
                    // Assume coder.executeCode(code, args) exists
                    const execResult = await coder.executeCode(skillCodeForCoder, skillArgs);
                    result = execResult.message;
                    */

                } catch (error) {
                    result = `Failed to initiate skill execution for "${skillName}": ${error.message || error}`;
                    console.error(`[Act:executeSkill] ${result}`);
                }
            }
        }
    // --- End executeSkill handler ---
    else {
      // Handle unknown actions
      console.log(`[Act] Action ${actionName} not found in actions object.`);
      result = `Action '${actionName}' is not implemented.`;
    }

    // Update memory with action result
    // Limit result length in memory
    const resultForMemory = result.length > 200 ? result.substring(0, 197) + '...' : result;
    addToShortTermMemory(`Action: ${state.lastAction} -> Result: ${resultForMemory}`);
    state.lastActionResult = result; // Store full result in state

    // If the action was the one planned, remove it from the plan
    if (state.currentPlan && state.currentPlan.length > 0 &&
        state.lastAction === state.currentPlan[0]) {
      // console.log(`[Act] Completed plan step: ${state.currentPlan[0]}`); // Less verbose
      state.currentPlan = state.currentPlan.slice(1); // Advance the plan
    } else if (state.currentPlan && state.currentPlan.length > 0) {
         console.warn(`[Act] Executed action "${state.lastAction}" did not match planned step "${state.currentPlan[0]}". Plan might be outdated or action failed.`);
         // The 'think' function will handle replanning based on the result, so no need to force replan here usually.
         // state.currentPlan = []; // Option: Invalidate plan on deviation - potentially too aggressive
    }


  } catch (error) {
    const errorMsg = `Failed during execution of ${actionName}: ${error.message || error}`;
    console.error(`[Act] ${errorMsg}`);
    addToShortTermMemory(`ERROR during action ${state.lastAction}: ${errorMsg}`);
    state.lastActionResult = errorMsg;
    // Think function will catch the failure and replan
    // state.currentPlan = []; // Force replan on any execution error
// Action implementations removed - they are now in src/agent/actions.js
