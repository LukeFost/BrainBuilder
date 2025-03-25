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
- collectBlock <blockType> <count>
- buildShelter

Output your plan as a list of steps, one per line.
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
      result = await buildShelter(args);
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
      const blockId = mcData.blocksByName[blockType]?.id;
      
      if (!blockId) {
        return `Block ${blockType} not found in minecraft-data`;
      }
      
      // Find the block
      const block = bot.findBlock({
        matching: blockId,
        maxDistance: 32
      });
      
      if (!block) {
        return `Could not find ${blockType} nearby`;
      }
      
      // Move to the block
      bot.chat(`Moving to ${blockType} at (${block.position.x}, ${block.position.y}, ${block.position.z})`);
      await bot.moveToPosition(block.position.x, block.position.y, block.position.z);
      
      // Dig the block
      bot.chat(`Mining ${blockType}`);
      await bot.dig(block);
      
      return `Collected ${blockType}`;
    } catch (e) {
      // If anything fails, fall back to simulation
      console.log(`Error in real block collection, simulating instead: ${e.message}`);
      bot.chat(`Collecting ${count} ${blockType} [SIMULATED due to error]`);
      return `Collected ${blockType} [SIMULATED]`;
    }
  } catch (error) {
    return `Failed to collect ${blockType}: ${error}`;
  }
}

async function buildShelter(args) {
  try {
    // Simulated shelter building
    console.log('Simulating building a shelter');
    bot.chat('Building a shelter [SIMULATED]');
    
    // Check if we have wood in the inventory
    const woodCount = currentState.inventory.items['oak_planks'] || 0;
    if (woodCount < 20) {
      return 'Not enough wood to build a shelter (need at least 20)';
    }
    
    // Building steps (for now just simulate)
    bot.chat('Step 1: Clearing area [SIMULATED]');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    bot.chat('Step 2: Building floor [SIMULATED]');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    bot.chat('Step 3: Building walls [SIMULATED]');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    bot.chat('Step 4: Building roof [SIMULATED]');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    bot.chat('Step 5: Adding door [SIMULATED]');
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return 'Successfully built a small shelter';
  } catch (error) {
    return `Failed to build shelter: ${error}`;
  }
}
