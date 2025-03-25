const mineflayer = require('mineflayer');
const dotenv = require('dotenv');
const { ChatOpenAI } = require('@langchain/openai');
const { SkillRepository } = require('./agent/skills/skillRepository.js'); // Import SkillRepository

// Load environment variables
dotenv.config();

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

// Bot event handlers
bot.once('spawn', () => {
  console.log('Bot has spawned');
  
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

    // Execute action based on type
    if (actionName === 'lookAround') {
      result = await lookAround();
    } else if (actionName === 'moveToPosition') {
      result = await moveToPosition(args);
    } else if (actionName === 'collectBlock') {
      result = await collectBlock(args);
    } else if (actionName === 'craftItem') {
      result = await craftItem(args);
    // --- Add askForHelp ---
    } else if (actionName === 'askForHelp') {
      const question = args.join(' ');
      if (question) {
        bot.chat(`[Help Needed] ${question}`);
        result = `Asked for help: "${question}"`;
      } else {
        result = "Tried to ask for help, but no question was specified.";
        bot.chat("[Help Needed] I'm stuck but didn't formulate a question."); // Ask a default question
      }
    // --- Handle generateAndExecuteCode directly ---
    } else if (actionName === 'generateAndExecuteCode') {
      try {
        const taskDescription = args.join(' ');
        if (!taskDescription) {
             result = "Error: No task description provided for code generation.";
        } else if (!process.env.OPENAI_API_KEY) {
             result = "Error: OPENAI_API_KEY not configured for code generation.";
        } else {
            // Dynamically require Coder only when needed
            // Assuming execution from dist/, the path relative to dist/index.js is ./agent/coder.js
            const { Coder } = require('./agent/coder.js'); // Use .js extension and relative path from dist/
            const coder = new Coder(bot, process.env.OPENAI_API_KEY);
            const codeResult = await coder.generateAndExecute(taskDescription, state); // Pass current state
            result = codeResult.message; // Use the message from the coder result
        }
      } catch (error) {
        result = `Failed to execute generated code: ${error.message || error}`;
        console.error("[Act:generateAndExecuteCode]", result);
      }
    // --- Add placeBlock handler ---
    } else if (actionName === 'placeBlock') {
        result = await placeBlock(args);
    // --- End placeBlock handler ---
    // --- Add executeSkill handler ---
    } else if (actionName === 'executeSkill') {
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
                    // This requires adapting the Coder class to accept raw code + args,
                    // or using a direct SES execution approach (less safe).
                    // For now, we log and return a placeholder message.
                    console.warn(`[Act] Skill execution via Coder needs implementation. Simulating call for ${skillName}.`);
                    result = `Attempted to execute skill "${skillName}" (implementation pending). Code:\n${skill.code}`;
                    // --- End Placeholder ---

                    /* // Ideal Coder usage (if Coder is adapted):
                    const { Coder } = require('./agent/coder.js');
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
    // Add other actions like attackEntity etc. if needed here
    // else if (actionName === 'attackEntity') { result = await attackEntity(args); }
    else {
      console.log(`[Act] Action ${actionName} not implemented in act() function.`);
      result = `Action '${actionName}' is not directly implemented in act().`;
      // Optional: Try to execute via generateAndExecuteCode as a fallback?
      // result = `Action ${actionName} not implemented. Consider using generateAndExecuteCode.`;
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
  }
}

// Action implementations
async function craftItem(args) {
  const [itemName, countStr] = args;
  const count = parseInt(countStr, 10) || 1;
  console.log(`[Action:craftItem] Attempting to craft ${count} ${itemName}`);

  try {
    const mcData = require('minecraft-data')(bot.version);
    const itemToCraft = mcData.itemsByName[itemName];
    if (!itemToCraft) return `Item '${itemName}' not found in minecraft-data`;

    // --- Specific Plank Crafting Logic ---
    if (itemName.includes('_planks')) {
      const logType = itemName.replace('_planks', '_log');
      // Find *any* available log type if the specific one isn't present
      let actualLogType = logType;
      if (!state.inventory.items[logType] || state.inventory.items[logType] === 0) {
          const availableLogTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
          for (const altLog of availableLogTypes) {
              if (state.inventory.items[altLog] && state.inventory.items[altLog] > 0) {
                  actualLogType = altLog;
                  console.log(`[Action:craftItem] Using available log type '${actualLogType}' instead of '${logType}'`);
                  break;
              }
          }
      }

      const requiredLogs = Math.ceil(count / 4); // 1 log -> 4 planks
      const availableLogs = state.inventory.items[actualLogType] || 0;

      if (availableLogs < requiredLogs) {
        return `Not enough ${actualLogType} (or any logs) to craft ${count} ${itemName}. Have ${availableLogs}, need ${requiredLogs}.`;
      }

      // Simulate crafting: Consume logs, add planks
      const planksToCraft = requiredLogs * 4; // Craft in multiples of 4
      console.log(`[Action:craftItem] Simulating crafting ${planksToCraft} ${itemName} from ${requiredLogs} ${actualLogType}`);
      bot.chat(`Crafting ${planksToCraft} ${itemName} [SIMULATED]`);
      state.inventory.items[actualLogType] = availableLogs - requiredLogs;
      if (state.inventory.items[actualLogType] <= 0) {
          delete state.inventory.items[actualLogType]; // Remove if zero
      }
      state.inventory.items[itemName] = (state.inventory.items[itemName] || 0) + planksToCraft; // Add crafted planks
      return `Crafted ${planksToCraft} ${itemName} from ${requiredLogs} ${actualLogType}`;
    }

    // --- General Recipe Logic (if pathfinder/recipes available) ---
    // This part requires the bot to have recipe data loaded, which might not be default
    if (bot.recipesFor) {
         const recipe = bot.recipesFor(itemToCraft.id, null, 1, null)[0]; // Check for crafting table=null first
         if (recipe) {
             console.log(`[Action:craftItem] Found recipe for ${itemName}. Attempting craft.`);
             // Check ingredients (simplified)
             let canCraft = true;
             let missingIngredients = [];
             if (recipe.delta) {
                 for (const ingredient of recipe.delta) {
                     if (ingredient.count < 0) { // Ingredient consumed
                         const ingredientName = mcData.items[ingredient.id]?.name;
                         const requiredCount = -ingredient.count * count;
                         if (!ingredientName || (state.inventory.items[ingredientName] || 0) < requiredCount) {
                             canCraft = false;
                             missingIngredients.push(`${requiredCount} ${ingredientName || `item ID ${ingredient.id}`}`);
                             // Don't return immediately, list all missing items
                         }
                     }
                 }
             } else {
                 console.warn(`[Action:craftItem] Recipe for ${itemName} has no delta, cannot verify ingredients accurately.`);
                 // Proceed cautiously, assuming ingredients are present
             }

             if (canCraft) {
                 await bot.craft(recipe, count, null); // Attempt craft
                 console.log(`[Action:craftItem] bot.craft called for ${count} ${itemName}`);
                 // Manually update state inventory based on recipe.delta
                 // Note: bot inventory might update automatically, this keeps 'state' in sync
                 if (recipe.delta) {
                     for (const itemChange of recipe.delta) {
                         const changedItemName = mcData.items[itemChange.id]?.name;
                         if (changedItemName) {
                             state.inventory.items[changedItemName] = (state.inventory.items[changedItemName] || 0) + (itemChange.count * count);
                             if (state.inventory.items[changedItemName] <= 0) {
                                 delete state.inventory.items[changedItemName];
                             }
                         }
                     }
                 } else {
                     // Less accurate update if no delta
                     state.inventory.items[itemName] = (state.inventory.items[itemName] || 0) + count;
                 }
                 return `Crafted ${count} ${itemName}`;
             } else {
                 const message = `Not enough ingredients to craft ${count} ${itemName}. Missing: ${missingIngredients.join(', ')}`;
                 console.log(`[Action:craftItem] ${message}`);
                 return message;
             }
         } else {
             // Check for recipe requiring crafting table
             const tableRecipe = bot.recipesFor(itemToCraft.id, null, 1, true)[0]; // craftingTable = true
             if (tableRecipe) {
                 return `Cannot craft ${itemName} by hand. Need a crafting table.`;
             } else {
                 return `No recipe found for ${itemName} (checked hand and table)`;
             }
         }
    } else {
         return `Crafting ${itemName} is not fully implemented (bot.recipesFor not available). Only plank crafting supported.`;
    }

  } catch (error) {
    const errorMsg = `Failed to craft ${itemName}: ${error.message || error}`;
    console.error(`[Action:craftItem] ${errorMsg}`);
    return errorMsg;
  }
}

async function lookAround() {
  const position = bot.entity.position;
  const nearbyEntities = Object.values(bot.entities)
    .filter(entity => entity.position.distanceTo(bot.entity.position) < 20)
    .map(entity => entity.name || entity.username || entity.type);
  
  const block = bot.blockAt(position);
  
  return `Looking around: I see ${nearbyEntities.join(', ') || 'nothing'}. Standing on ${block?.name || 'unknown'} at position (${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`;
}

async function moveToPosition(args) {
  try {
    const [x, y, z] = args.map(arg => parseFloat(arg));
    
    console.log(`Attempting to move to position (${x}, ${y}, ${z})`);
    bot.chat(`Moving to (${x}, ${y}, ${z})`);
    
    // Use the bot's moveToPosition method (either real or simulated)
    await bot.moveToPosition(x, y, z);
    
    // If we got here, the movement was successful
    return `Moved to position (${x}, ${y}, ${z})`;
  } catch (error) {
    return `Failed to move to position: ${error}`;
  }
}

async function collectBlock(args) {
  const [blockType, countStr] = args;
  const count = parseInt(countStr, 10) || 1;
  let collectedCount = 0;
  let message = '';

  console.log(`[Action:collectBlock] Request to collect ${count} ${blockType}`);

  // Simulation mode handling
  if (!bot.pathfinder) {
    console.log(`[Action:collectBlock] Simulating collecting ${count} ${blockType}`);
    bot.chat(`Collecting ${count} ${blockType} [SIMULATED]`);
    // Update inventory even in simulation
    // Need to determine the actual block type for inventory update
    let actualBlockTypeSim = blockType;
    try {
        const mcDataSim = require('minecraft-data')(bot.version);
        if (blockType === 'wood' || blockType === 'log') {
            const logTypesSim = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
            for (const logType of logTypesSim) {
                if (mcDataSim.blocksByName[logType]) {
                    actualBlockTypeSim = logType;
                    break;
                }
            }
        }
    } catch (e) { /* ignore mcData errors in sim */ }
    state.inventory.items[actualBlockTypeSim] = (state.inventory.items[actualBlockTypeSim] || 0) + count;
    return `Collected ${count} ${actualBlockTypeSim} [SIMULATED]`;
  }

  // Real mode with pathfinder
  try {
    const mcData = require('minecraft-data')(bot.version);
    const pathfinder = require('mineflayer-pathfinder'); // Ensure pathfinder is required here if not global

    // Handle common block name variations
    let actualBlockType = blockType;
    if (blockType === 'wood' || blockType === 'log') {
      const logTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
      for (const logType of logTypes) {
        if (mcData.blocksByName[logType]) {
          actualBlockType = logType;
          console.log(`[Action:collectBlock] Translating '${blockType}' to specific block type: ${actualBlockType}`);
          break;
        }
      }
    }

    const blockData = mcData.blocksByName[actualBlockType];
    if (!blockData) {
      return `Block type '${actualBlockType}' (from '${blockType}') not found in minecraft-data`;
    }
    const blockId = blockData.id;

    for (let i = 0; i < count; i++) {
      console.log(`[Action:collectBlock] Searching for block ${i + 1}/${count} of '${actualBlockType}' (ID: ${blockId})`);
      const block = bot.findBlock({
        matching: blockId,
        maxDistance: 32,
        useExtraInfo: true
      });

      if (!block) {
        message = `Could not find more ${actualBlockType} nearby (found ${collectedCount}/${count}).`;
        console.log(`[Action:collectBlock] ${message}`);
        break; // Stop if no more blocks are found
      }

      console.log(`[Action:collectBlock] Found ${actualBlockType} at (${block.position.x}, ${block.position.y}, ${block.position.z}). Moving to it.`);
      // Use pathfinder goals directly
      const goal = new pathfinder.goals.GoalGetToBlock(block.position.x, block.position.y, block.position.z);

      await bot.pathfinder.goto(goal);
      console.log(`[Action:collectBlock] Reached block. Attempting to dig.`);

      // Optional: Equip best tool (requires pathfinder instance)
      // const bestTool = bot.pathfinder.bestHarvestTool(block);
      // if (bestTool) {
      //   console.log(`[Action:collectBlock] Equipping best tool: ${bestTool.name}`);
      //   await bot.equip(bestTool, 'hand');
      // }

      await bot.dig(block);
      collectedCount++;
      // Update inventory immediately after collecting
      // Note: Bot inventory should update automatically, but we sync state here
      state.inventory.items[actualBlockType] = (state.inventory.items[actualBlockType] || 0) + 1;
      console.log(`[Action:collectBlock] Successfully collected ${actualBlockType} (${collectedCount}/${count}).`);

      // Small delay
      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    if (!message) {
        message = `Collected ${collectedCount} ${actualBlockType}`;
    }
    console.log(`[Action:collectBlock] Finished: ${message}`);
    return message; // Return collected count message

  } catch (error) {
    const errorMsg = `Failed during collect ${blockType}: ${error.message || error}`;
    console.error(`[Action:collectBlock] ${errorMsg}`);
    // Return message indicating partial success/failure
    return `${errorMsg} (Collected ${collectedCount}/${count})`;
  }
}

async function placeBlock(args) {
    const [blockType, xStr, yStr, zStr] = args;
    const targetPos = { x: parseFloat(xStr), y: parseFloat(yStr), z: parseFloat(zStr) };

    if (isNaN(targetPos.x) || isNaN(targetPos.y) || isNaN(targetPos.z)) {
        return `Invalid coordinates for placeBlock: ${args.join(', ')}`;
    }

    console.log(`[Action:placeBlock] Request to place ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`);

    // Check if pathfinder is available (needed for movement and potentially finding reference)
    if (!bot.pathfinder) {
        // Simulate placement if pathfinder is not available
        console.log(`[Action:placeBlock] Simulating placement of ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`);
        bot.chat(`Placing ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) [SIMULATED]`);
        // Update inventory (decrement count) - important for planning even in simulation
        state.inventory.items[blockType] = (state.inventory.items[blockType] || 0) - 1;
        if (state.inventory.items[blockType] <= 0) {
            delete state.inventory.items[blockType];
        }
        return `Placed ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) [SIMULATED]`;
        // return `Cannot execute placeBlock: Pathfinder not available.`; // Alternative: return error if simulation not desired
    }

    try {
        const mcData = require('minecraft-data')(bot.version);
        const pathfinder = require('mineflayer-pathfinder'); // Ensure pathfinder is required
        const { Vec3 } = require('vec3'); // Required for vector math

        // 1. Check inventory
        const itemInInventory = bot.inventory.items().find(item => item.name === blockType);
        if (!itemInInventory) {
            return `Cannot place ${blockType}: Not found in inventory.`;
        }

        // 2. Find a reference block and face vector
        // Strategy: Try placing on the block directly below the target position.
        const referenceBlockPos = new Vec3(targetPos.x, targetPos.y - 1, targetPos.z);
        const referenceBlock = bot.blockAt(referenceBlockPos);

        if (!referenceBlock || referenceBlock.name === 'air') {
            // Add more sophisticated reference block finding later if needed (e.g., adjacent blocks)
            return `Cannot place ${blockType}: No solid block found below target position (${referenceBlockPos.x}, ${referenceBlockPos.y}, ${referenceBlockPos.z}) to place against.`;
        }

        // The face vector points from the reference block towards the target block.
        // If placing on top, the face vector is (0, 1, 0).
        const faceVector = new Vec3(0, 1, 0); // Assuming placing on top of the block below

        // 3. Move near the placement location (optional but good practice)
        // Goal is to be within reach of the *reference* block
        const goal = new pathfinder.goals.GoalNear(referenceBlockPos.x, referenceBlockPos.y, referenceBlockPos.z, 3); // Get within 3 blocks
        console.log(`[Action:placeBlock] Moving near reference block at ${referenceBlockPos}`);
        await bot.pathfinder.goto(goal);
        console.log(`[Action:placeBlock] Reached near reference block.`);

        // 4. Equip the block
        console.log(`[Action:placeBlock] Equipping ${itemInInventory.name}`);
        await bot.equip(itemInInventory, 'hand');

        // 5. Place the block
        console.log(`[Action:placeBlock] Placing ${blockType} against ${referenceBlock.name} at ${referenceBlockPos} (face: ${faceVector})`);
        // Ensure the target position is passed correctly if needed by the API version,
        // but typically placeBlock uses reference block and face vector.
        await bot.placeBlock(referenceBlock, faceVector);

        // Update state inventory (decrement count) - important for planning
        state.inventory.items[blockType] = (state.inventory.items[blockType] || 0) - 1;
        if (state.inventory.items[blockType] <= 0) {
            delete state.inventory.items[blockType];
        }

        return `Placed ${blockType} at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`;

    } catch (error) {
        const errorMsg = `Failed to place ${blockType}: ${error.message || error}`;
        console.error(`[Action:placeBlock] ${errorMsg}`);
        // Attempt to provide more context if it's a placement error
        if (error.message && error.message.includes('Cannot place block')) {
             return `Failed to place ${blockType}: Placement obstructed or too far? (${error.message})`;
        }
        return errorMsg;
    }
}

// buildShelter function removed - we'll use generateAndExecuteCode instead
