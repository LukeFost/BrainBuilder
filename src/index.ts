import * as mineflayer from 'mineflayer';
import * as dotenv from 'dotenv';
import mcData = require('minecraft-data');
import * as pathfinder from 'mineflayer-pathfinder';
import { Planner } from './agent/planner';
import { MemoryManager } from './agent/memory';
import { actions } from './agent/actions';
import { State } from './agent/types';

// Load environment variables
dotenv.config();

// Bot configuration
const botConfig = {
  host: 'localhost', // or your LAN IP address
  port: parseInt(process.env.MINECRAFT_PORT || '25565'), // LAN port from Minecraft
  username: 'AIBot',
  version: '1.21.1', // Updated to match your LAN world version
  auth: 'offline' as 'offline' // Type assertion to fix type error
};

// Create bot
const bot = mineflayer.createBot(botConfig);
const memoryManager = new MemoryManager(undefined, 10, process.env.OPENAI_API_KEY);
const planner = new Planner(process.env.OPENAI_API_KEY || '');

// Define initial state
const state: State = {
  memory: memoryManager.fullMemory,
  inventory: { items: {} },
  surroundings: {
    nearbyBlocks: [],
    nearbyEntities: [],
    position: { x: 0, y: 0, z: 0 }
  },
  currentGoal: 'Collect wood and build a small shelter'
};

// Bot event handlers
bot.once('spawn', () => {
  console.log('Bot has spawned');
  
  try {
    // Initialize pathfinder plugin
    bot.loadPlugin(pathfinder.pathfinder);
    const mcDataInstance = mcData(bot.version);
    const defaultMove = new pathfinder.Movements(bot, mcDataInstance);
    
    bot.pathfinder.setMovements(defaultMove);
    console.log('Pathfinder initialized successfully');
  } catch (error) {
    console.error('Error initializing pathfinder:', error);
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
    state.currentPlan = undefined;
    bot.chat(`New goal set: ${newGoal}`);
    memoryManager.addToShortTerm(`Player ${username} set a new goal: ${newGoal}`);
  } else if (message === 'status') {
    const status = `Goal: ${state.currentGoal || 'None'}\nPlan: ${state.currentPlan?.join(', ') || 'None'}\nLast action: ${state.lastAction || 'None'}\nResult: ${state.lastActionResult || 'None'}`;
    bot.chat(status);
  } else if (message === 'memory') {
    bot.chat(`Short-term memory: ${memoryManager.shortTerm.join(', ')}`);
    bot.chat(`Long-term memory summary available`);
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
    // Could implement a way to stop current activities
    bot.chat('Stopping current activity');
    memoryManager.addToShortTerm(`Player ${username} requested to stop current activity`);
  } else if (message === 'explore') {
    state.currentGoal = 'Explore the surroundings and gather information';
    state.currentPlan = undefined;
    bot.chat('Switching to exploration mode');
    memoryManager.addToShortTerm(`Player ${username} requested exploration mode`);
  } else if (message.startsWith('follow ')) {
    const targetName = message.slice(7);
    bot.chat(`Following ${targetName}`);
    // Could implement follow functionality
  }
});

bot.on('kicked', console.log);
bot.on('error', console.log);

// Agent loop
async function startAgentLoop() {
  console.log('Starting agent loop');
  
  try {
    // Agent loop - runs every 2 seconds
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
    }, 2000);
  } catch (error) {
    console.error('Error starting agent:', error);
  }
}

// Observe function
async function observe() {
  // Update state with current observations
  const position = bot.entity.position;
  
  // Get inventory
  const inventory: Record<string, number> = {};
  bot.inventory.items().forEach(item => {
    inventory[item.name] = (inventory[item.name] || 0) + item.count;
  });
  
  // Get nearby blocks (simplified)
  const nearbyBlocks: string[] = [];
  for (let x = -5; x <= 5; x++) {
    for (let y = -5; y <= 5; y++) {
      for (let z = -5; z <= 5; z++) {
        const block = bot.blockAt(position.offset(x, y, z));
        if (block && block.name !== 'air') {
          nearbyBlocks.push(block.name);
        }
      }
    }
  }
  
  // Get nearby entities
  const nearbyEntities = Object.values(bot.entities)
    .filter((entity: any) => entity.position.distanceTo(bot.entity.position) < 10)
    .map((entity: any) => entity.name || entity.username || entity.type);
  
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
}

// Think function
async function think() {
  // If no plan or plan is completed, create a new one
  if (!state.currentPlan || state.currentPlan.length === 0) {
    console.log("Creating new plan...");
    const plan = await planner.createPlan(state, state.currentGoal || 'Explore and survive');
    state.currentPlan = plan;
    return;
  }
  
  // Decide next action
  const nextAction = await planner.decideNextAction(state);
  state.lastAction = nextAction;
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
  
  // Execute action
  if (actions[actionName]) {
    try {
      console.log(`Executing action: ${actionName} with args: ${args.join(', ')}`);
      const result = await actions[actionName].execute(bot, args);
      
      // Update memory with action result
      memoryManager.addToShortTerm(`Action: ${state.lastAction} - Result: ${result}`);
      
      // If this was from a plan, remove it from the plan
      if (state.currentPlan && state.currentPlan.length > 0 && 
          state.currentPlan[0].startsWith(actionName)) {
        state.currentPlan = state.currentPlan.slice(1);
      }
      
      state.lastActionResult = result;
      state.memory = memoryManager.fullMemory;
    } catch (error) {
      const errorMsg = `Failed to execute ${actionName}: ${error}`;
      memoryManager.addToShortTerm(errorMsg);
      state.lastActionResult = errorMsg;
      state.memory = memoryManager.fullMemory;
    }
  } else {
    const errorMsg = `Unknown action: ${actionName}`;
    memoryManager.addToShortTerm(errorMsg);
    state.lastActionResult = errorMsg;
    state.memory = memoryManager.fullMemory;
  }
}