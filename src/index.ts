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
  
  let pathfinderInitialized = false;
  try {
    // Initialize pathfinder plugin
    bot.loadPlugin(pathfinder.pathfinder);
    const mcDataInstance = mcData(bot.version);
    const defaultMove = new pathfinder.Movements(bot, mcDataInstance);
    // Configure movements (optional, customize as needed)
    defaultMove.allowSprinting = true;
    defaultMove.canDig = true; // Allow breaking blocks if necessary for pathing
    bot.pathfinder.setMovements(defaultMove);
    console.log('Pathfinder initialized successfully.');
    pathfinderInitialized = true;
  } catch (error) {
    console.error('CRITICAL: Error initializing pathfinder plugin:', error);
    console.error('Movement capabilities will be severely limited or non-functional.');
    // Optional: Decide if the bot should stop or continue with limited function
    // For now, we'll let it continue but log the error clearly.
  }
  
  // Start the agent loop only if critical components like pathfinder are ready (or handle failure)
  if (pathfinderInitialized) {
    startAgentLoop();
  } else {
    console.error("Agent loop not started due to pathfinder initialization failure.");
    bot.chat("I cannot move properly. Pathfinder failed to load.");
  }
});

bot.on('chat', (username, message) => {
  // Handle commands from chat
  console.log(`[Chat] Received message from ${username}: "${message}"`); 
  if (username === bot.username) return;
  
  console.log(`[Chat] Processing command from ${username}.`);
  if (message.startsWith('goal ')) {
    const newGoal = message.slice(5);
    state.currentGoal = newGoal;
    state.currentPlan = undefined;
    bot.chat(`New goal set: ${newGoal}`);
    memoryManager.addToShortTerm(`Player ${username} set a new goal: ${newGoal}`);
    console.log(`[Chat] New goal set by ${username}: ${newGoal}`);
  } else if (message === 'status') {
    const status = `Goal: ${state.currentGoal || 'None'}\nPlan: ${state.currentPlan?.join(', ') || 'None'}\nLast action: ${state.lastAction || 'None'}\nResult: ${state.lastActionResult || 'None'}`;
    bot.chat(status);
    console.log(`[Chat] Sending status to ${username}.`);
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
  let needsNewPlan = false;
  
  // Reason 1: No plan exists or current plan is completed
  if (!state.currentPlan || state.currentPlan.length === 0) {
    console.log("Reason for new plan: No current plan or plan completed.");
    needsNewPlan = true;
  }
  
  // Reason 2: Last action failed significantly (customize condition as needed)
  if (state.lastActionResult && state.lastActionResult.toLowerCase().includes('failed')) {
    console.log(`Reason for considering new plan: Last action failed - "${state.lastActionResult}"`);
    // Simple strategy: Always replan on failure. More complex logic could be added.
    needsNewPlan = true; 
  }
  
  // Reason 3: The executed action didn't match the plan step (handled in act, but could trigger replan here too)
  // if (state.lastAction && state.currentPlan && state.currentPlan.length > 0 && state.lastAction !== state.currentPlan[0]) {
  //    console.log("Reason for considering new plan: Action deviated from plan.");
  //    needsNewPlan = true; 
  // }
  
  if (needsNewPlan && state.currentGoal) {
    console.log("Creating new plan...");
    try {
      const plan = await planner.createPlan(state, state.currentGoal);
      state.currentPlan = plan;
      console.log("New plan created:", plan);
      // If a new plan was made, decide the first action from it
      if (state.currentPlan && state.currentPlan.length > 0) {
        state.lastAction = state.currentPlan[0];
        console.log(`Next action from new plan: ${state.lastAction}`);
      } else {
        console.log("New plan is empty, deciding fallback action.");
        state.lastAction = await planner.decideNextAction(state); // Fallback if plan is empty
      }
    } catch (error) {
      console.error("Error creating new plan:", error);
      state.lastAction = 'lookAround'; // Fallback action on planning error
    }
    return; // Exit think() after attempting to create a new plan
  }
  
  // If no new plan is needed, decide the next action based on the current state/plan
  console.log("Continuing with existing plan or deciding next action.");
  const nextAction = await planner.decideNextAction(state);
  state.lastAction = nextAction;
  console.log(`Decided next action: ${state.lastAction}`);
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
      
      // If the executed action matches the first step of the plan, remove it
      if (state.currentPlan && state.currentPlan.length > 0 &&
          state.currentPlan[0] === state.lastAction) {
        console.log(`Completed plan step: ${state.currentPlan[0]}`);
        state.currentPlan = state.currentPlan.slice(1);
      } else if (state.currentPlan && state.currentPlan.length > 0) {
        console.log(`Executed action "${state.lastAction}" does not match current plan step "${state.currentPlan[0]}". Plan may need revision.`);
        // Consider adding logic here to potentially invalidate the plan if the mismatch persists
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
