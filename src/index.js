const mineflayer = require('mineflayer');
const dotenv = require('dotenv');
const { ChatOpenAI } = require('@langchain/openai');

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
  console.log('Starting agent loop');
  
  try {
    // Agent loop - runs every 5 seconds
    setInterval(async () => {
      try {
        // OBSERVE: Update state with current observations
        await observe();
        
        // THINK: Plan or decide on next action
        await think();
        
        // ACT: Execute the decided action
        await act();
        
        // Log current status
        console.log('---------------------');
        console.log(`Goal: ${state.currentGoal}`);
        console.log(`Plan: ${state.currentPlan?.join('\n  ') || 'None'}`);
        console.log(`Last action: ${state.lastAction}`);
        console.log(`Result: ${state.lastActionResult}`);
      } catch (error) {
        console.error('Error in agent loop:', error);
      }
    }, 5000);
  } catch (error) {
    console.error('Error starting agent:', error);
  }
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
    // If no plan or plan is completed, create a new one
    if (!state.currentPlan || state.currentPlan.length === 0) {
      console.log("Creating new plan...");
      const plan = await createPlan();
      state.currentPlan = plan;
      return;
    }
    
    // Decide next action
    const nextAction = await decideNextAction();
    state.lastAction = nextAction;
  } catch (error) {
    console.error('Error in think function:', error);
  }
}

// Create a plan
async function createPlan() {
  try {
    const prompt = `
You are a Minecraft agent tasked with creating a plan to achieve a goal.

Current inventory: ${JSON.stringify(state.inventory)}
Current surroundings: ${JSON.stringify(state.surroundings)}
Short-term memory: ${memory.shortTerm.join('\n')}
Long-term memory: ${memory.longTerm}

Goal: ${state.currentGoal}

Create a step-by-step plan to achieve this goal. Each step should be a single action.
Available actions:
- lookAround
- moveToPosition <x> <y> <z>
- collectBlock <blockType> <count> (use specific block types like 'oak_log', 'birch_log', etc.)
- craftItem <itemName> <count> (for crafting planks, sticks, etc.)
- buildShelter (this will use code generation to build a shelter with the materials in inventory)
- generateAndExecuteCode <task description> (for complex tasks not covered by other actions)

Output your plan as a list of steps, one per line.

IMPORTANT: For collecting wood, use specific block types like 'oak_log' or 'birch_log', not just 'wood'.
For building, make sure to collect enough logs first (at least 5-10 logs).
`;

    const response = await openai.invoke([
      { role: 'system', content: prompt }
    ]);
    
    // Parse the response into individual steps
    const lines = response.content.toString().split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
      
    // Clean up enumerated steps (remove numbers at the beginning like "1. ")
    return lines.map(line => {
      // Remove step numbers like "1. " at the beginning of lines
      return line.replace(/^\d+\.\s+/, '');
    });
  } catch (error) {
    console.error('Error creating plan:', error);
    return ['lookAround'];
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
    state.lastActionResult = "No action to perform";
    return;
  }
  
  // Parse action and arguments
  const parts = state.lastAction.split(' ');
  const actionName = parts[0];
  const args = parts.slice(1);
  
  try {
    console.log(`Executing action: ${actionName} with args: ${args.join(', ')}`);
    
    // Execute action based on type
    let result = "Action not implemented";
    
    if (actionName === 'lookAround') {
      result = await lookAround();
    } else if (actionName === 'moveToPosition') {
      result = await moveToPosition(args);
    } else if (actionName === 'collectBlock') {
      result = await collectBlock(args);
    } else if (actionName === 'buildShelter') {
      // Redirect buildShelter to generateAndExecuteCode
      console.log('Redirecting buildShelter to generateAndExecuteCode for emergent behavior');
      
      // Check if we have enough wood first
      const logTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
      const plankTypes = ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks'];
      
      let totalWoodCount = 0;
      
      // Count logs (each log = 4 planks)
      for (const logType of logTypes) {
        const count = state.inventory.items[logType] || 0;
        totalWoodCount += count * 4; // Each log can make 4 planks
      }
      
      // Count planks
      for (const plankType of plankTypes) {
        const count = state.inventory.items[plankType] || 0;
        totalWoodCount += count;
      }
      
      if (totalWoodCount < 20) {
        return `Not enough wood to build a shelter (need at least 20 planks, have ${totalWoodCount} planks equivalent)`;
      }
      
      // Use the Coder class to generate and execute code for building a shelter
      try {
        const { Coder } = require('./agent/coder');
        const coder = new Coder(bot, process.env.OPENAI_API_KEY);
        const buildTask = "Build a small shelter using the wood in my inventory. The shelter should have walls, a roof, and a door.";
        const result = await coder.generateAndExecute(buildTask, state);
        return result.message;
      } catch (error) {
        return `Failed to build shelter using code generation: ${error}`;
      }
    } else if (actionName === 'generateAndExecuteCode') {
      // Direct use of generateAndExecuteCode
      try {
        const taskDescription = args.join(' ');
        const { Coder } = require('./agent/coder');
        const coder = new Coder(bot, process.env.OPENAI_API_KEY);
        const result = await coder.generateAndExecute(taskDescription, state);
        return result.message;
      } catch (error) {
        return `Failed to execute code: ${error}`;
      }
    } else if (actionName === 'craftItem') {
      result = await craftItem(args);
    } else {
      result = `Unknown action: ${actionName}`;
    }
    
    // Update memory with action result
    addToShortTermMemory(`Action: ${state.lastAction} - Result: ${result}`);
    
    // If this was from a plan, remove it from the plan
    if (state.currentPlan && state.currentPlan.length > 0 && 
        state.currentPlan[0].startsWith(actionName)) {
      state.currentPlan = state.currentPlan.slice(1);
    }
    
    state.lastActionResult = result;
  } catch (error) {
    const errorMsg = `Failed to execute ${actionName}: ${error}`;
    addToShortTermMemory(errorMsg);
    state.lastActionResult = errorMsg;
  }
}

// Action implementations
async function craftItem(args) {
  try {
    const [itemName, countStr] = args;
    const count = parseInt(countStr, 10) || 1;
    
    console.log(`Attempting to craft ${count} ${itemName}`);
    
    // Handle crafting planks from logs
    if (itemName.includes('planks')) {
      // Determine which log type to use based on the planks requested
      const logType = itemName.replace('_planks', '_log');
      const logCount = Math.ceil(count / 4); // Each log makes 4 planks
      
      // Check if we have enough logs
      if (!state.inventory.items[logType] || state.inventory.items[logType] < logCount) {
        return `Not enough ${logType} to craft ${count} ${itemName}. Need ${logCount} logs.`;
      }
      
      // Simulate crafting
      console.log(`Simulating crafting ${count} ${itemName} from ${logCount} ${logType}`);
      bot.chat(`Crafting ${count} ${itemName} [SIMULATED]`);
      
      // Update inventory
      state.inventory.items[logType] -= logCount;
      state.inventory.items[itemName] = (state.inventory.items[itemName] || 0) + (logCount * 4);
      
      return `Crafted ${logCount * 4} ${itemName} from ${logCount} ${logType}`;
    }
    
    // Handle other crafting recipes as needed
    
    return `Crafting ${itemName} is not implemented yet`;
  } catch (error) {
    return `Failed to craft ${args[0]}: ${error}`;
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
  try {
    const [blockType, countStr] = args;
    const count = parseInt(countStr, 10) || 1;
    
    // If we can't find mineflayer-pathfinder, simulate block collection
    if (!bot.pathfinder) {
      console.log(`Simulating collecting ${count} ${blockType}`);
      bot.chat(`Collecting ${count} ${blockType} [SIMULATED]`);
      return `Collected ${blockType} [SIMULATED]`;
    }
    
    try {
      // Try to get block data
      const mcData = require('minecraft-data')(bot.version);
      
      // Handle common block name variations
      let actualBlockType = blockType;
      if (blockType === 'wood' || blockType === 'log') {
        // Try to find any type of log
        const logTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
        for (const logType of logTypes) {
          if (mcData.blocksByName[logType]) {
            actualBlockType = logType;
            console.log(`Translating '${blockType}' to specific block type: ${actualBlockType}`);
            break;
          }
        }
      }
      
      const blockId = mcData.blocksByName[actualBlockType]?.id;
      
      if (!blockId) {
        return `Block ${actualBlockType} (from ${blockType}) not found in minecraft-data`;
      }
      
      // Find the block
      const block = bot.findBlock({
        matching: blockId,
        maxDistance: 32
      });
      
      if (!block) {
        return `Could not find ${actualBlockType} nearby`;
      }
      
      // Move to the block
      bot.chat(`Moving to ${actualBlockType} at (${block.position.x}, ${block.position.y}, ${block.position.z})`);
      await bot.moveToPosition(block.position.x, block.position.y, block.position.z);
      
      // Dig the block
      bot.chat(`Mining ${actualBlockType}`);
      await bot.dig(block);
      
      // Update inventory (this is a simplification, the real bot would update inventory automatically)
      state.inventory.items[actualBlockType] = (state.inventory.items[actualBlockType] || 0) + 1;
      
      return `Collected ${actualBlockType}`;
    } catch (e) {
      // If anything fails, fall back to simulation
      console.log(`Error in real block collection, simulating instead: ${e.message}`);
      bot.chat(`Collecting ${count} ${blockType} [SIMULATED due to error]`);
      
      // Even in simulation, update the inventory for planning purposes
      const mcData = require('minecraft-data')(bot.version);
      let actualBlockType = blockType;
      if (blockType === 'wood' || blockType === 'log') {
        const logTypes = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log'];
        for (const logType of logTypes) {
          if (mcData.blocksByName[logType]) {
            actualBlockType = logType;
            break;
          }
        }
      }
      
      // Update inventory in simulation mode
      state.inventory.items[actualBlockType] = (state.inventory.items[actualBlockType] || 0) + 1;
      
      return `Collected ${actualBlockType} [SIMULATED]`;
    }
  } catch (error) {
    return `Failed to collect ${blockType}: ${error}`;
  }
}

// buildShelter function removed - we'll use generateAndExecuteCode instead
