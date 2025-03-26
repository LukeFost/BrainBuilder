import * as mineflayer from 'mineflayer';
import * as dotenv from 'dotenv';
// Import minecraft-data using require to avoid TypeScript treating it as a type
const mcData = require('minecraft-data');
import * as pathfinder from 'mineflayer-pathfinder';
import { Client } from "@langchain/langgraph-sdk";
import { BaseMessage } from "@langchain/core/messages";
import { StateGraph, END } from "@langchain/langgraph";
import { RunnableConfig } from "@langchain/core/runnables";

import { Planner } from './agent/planner';
import { MemoryManager } from './agent/memory';
// Import actions from the new index file
import { actions } from './agent/actions/index';
import { State, Memory, Inventory, Surroundings } from './agent/types';
import { ThinkManager } from './agent/think';
import { ObserveManager } from './agent/observe';

// Load environment variables
dotenv.config();

// Bot configuration
const botConfig = {
  host: 'localhost', // or your LAN IP address
  port: parseInt(process.env.MINECRAFT_PORT || '25565'), // LAN port from Minecraft
  username: 'AIBot',
  version: '1.21.1', // Updated to match your LAN world version
  auth: 'offline' as 'offline' // Type assertion for auth property
};

// Create bot
const bot = mineflayer.createBot(botConfig);
// Initialize the memory manager
const memoryManager = new MemoryManager();
const thinkManager = new ThinkManager(process.env.OPENAI_API_KEY || '');

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
bot.once('spawn', async () => {
  console.log('Bot has spawned');
  console.log("MemoryManager created.");

  let pathfinderInitialized = false;
  try {
    // Initialize pathfinder plugin
    bot.loadPlugin(pathfinder.pathfinder);
    // Fix mcData initialization by passing only the version
    const mcDataInstance = mcData(bot.version);
    // Create Movements using only the bot (mcDataInstance is used internally)
    const defaultMove = new pathfinder.Movements(bot);
    defaultMove.allowSprinting = true;
    defaultMove.canDig = true;
    bot.pathfinder.setMovements(defaultMove);
    console.log('Pathfinder initialized successfully.');
    pathfinderInitialized = true;
  } catch (error) {
    console.error('CRITICAL: Error initializing pathfinder plugin:', error);
    console.error('Movement capabilities will be severely limited or non-functional.');
  }
  
  if (pathfinderInitialized) {
    startAgentLoop();
  } else {
    console.error("Agent loop not started due to pathfinder initialization failure.");
    bot.chat("I cannot move properly. Pathfinder failed to load.");
  }
});

// --- Chat Command Handling ---
bot.on('chat', async (username, message) => {
  console.log(`[Chat] Received message from ${username}: "${message}"`); 
  if (username === bot.username) return;
  
  console.log(`[Chat] Processing command from ${username}.`);
  if (message.startsWith('goal ')) {
    const newGoal = message.slice(5);
    state.currentGoal = newGoal;
    state.currentPlan = undefined;
    bot.chat(`New goal set: ${newGoal}`);
    // Make sure to await the async method
    await memoryManager.addToShortTerm(`Player ${username} set a new goal: ${newGoal}`);
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
    bot.chat('Stopping current activity');
    await memoryManager.addToShortTerm(`Player ${username} requested to stop current activity`);
  } else if (message === 'explore') {
    state.currentGoal = 'Explore the surroundings and gather information';
    state.currentPlan = undefined;
    bot.chat('Switching to exploration mode');
    await memoryManager.addToShortTerm(`Player ${username} requested exploration mode`);
  } else if (message.startsWith('follow ')) {
    const targetName = message.slice(7);
    bot.chat(`Following ${targetName}`);
  }
});

bot.on('kicked', console.log);
bot.on('error', console.log);

// --- Graph Nodes ---
// Create an instance of ObserveManager
let observeManager: ObserveManager | null = null;

// Helper function for graph workflow
async function runObserveNode(currentState: State): Promise<Partial<State>> {
  console.log("--- Running Observe Node ---");
  
  if (!observeManager) {
    observeManager = new ObserveManager(bot);
  }
  
  const observationResult = await observeManager.observe(currentState);
  
  return {
    ...observationResult,
    memory: memoryManager.fullMemory
  };
}

async function runThinkNode(currentState: State): Promise<Partial<State>> {
  console.log("--- Running Think Node ---");
  try {
    return await thinkManager.think(currentState);
  } catch (error: unknown) {
    console.error('[ThinkNode] Error during thinking process:', error);
    return { lastAction: 'askForHelp An internal error occurred during thinking.' };
  }
}

async function runActNode(currentState: State): Promise<Partial<State>> {
  console.log("--- Running Act Node ---");
  const actionToPerform = currentState.lastAction;

  if (!actionToPerform) {
    console.log("[ActNode] No action decided. Skipping act node.");
    return { lastActionResult: "No action to perform" };
  }

  const parts = actionToPerform.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const actionName = parts[0];
  const args = parts.slice(1).map((arg: string) => arg.replace(/^"|"$/g, ''));

  let result: string;
  let executionSuccess = false;

  if (actionName && actions[actionName]) {
    try {
      console.log(`[ActNode] Executing action: ${actionName} with args: ${args.join(', ')}`);
      result = await actions[actionName].execute(bot, args, currentState);
      executionSuccess = !result.toLowerCase().includes('fail') && !result.toLowerCase().includes('error');
      console.log(`[ActNode] Action Result: ${result}`);
    } catch (error: unknown) {
      result = `Failed to execute ${actionName}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[ActNode] ${result}`);
      executionSuccess = false;
    }
  } else {
    result = `Unknown action: ${actionName}`;
    console.error(`[ActNode] ${result}`);
    executionSuccess = false;
  }

  await memoryManager.addToShortTerm(`Action: ${actionToPerform} -> Result: ${result}`);

  let updatedPlan = currentState.currentPlan;

  if (executionSuccess && currentState.currentPlan && currentState.currentPlan.length > 0) {
    const currentPlanStepClean = currentState.currentPlan[0].replace(/^\d+\.\s*/, '').trim();

    if (actionToPerform === currentPlanStepClean) {
      console.log(`[ActNode] Completed plan step: ${currentState.currentPlan[0]}`);
      updatedPlan = currentState.currentPlan.slice(1);
    } else {
      console.warn(`[ActNode] Executed action "${actionToPerform}" succeeded but did not match planned step "${currentState.currentPlan[0]}". Plan might be outdated.`);
    }
  } else if (!executionSuccess && currentState.currentPlan && currentState.currentPlan.length > 0) {
    console.log(`[ActNode] Action "${actionToPerform}" failed. Plan step "${currentState.currentPlan[0]}" not completed.`);
  }

  return {
    lastActionResult: result,
    currentPlan: updatedPlan,
    memory: memoryManager.fullMemory
  };
}

// --- Manual Agent Loop Implementation ---
// Since LangGraph integration is causing type issues, we'll use a straightforward loop
async function startAgentLoop() {
  console.log('Starting agent loop');

  try {
    // Initial setup
    let currentState = { ...state };
    
    // Run initial observation to populate surroundings
    const initialObservation = await runObserveNode(currentState);
    currentState = { ...currentState, ...initialObservation };
    
    console.log("Initial State:", currentState);
    
    // Main agent loop
    while (true) {
      // Run the think node
      console.log("\n=== CYCLE: THINK ===");
      const thinkResult = await runThinkNode(currentState);
      currentState = { ...currentState, ...thinkResult };
      console.log("After Think:", currentState.lastAction);
      
      // Run the act node
      console.log("\n=== CYCLE: ACT ===");
      const actResult = await runActNode(currentState);
      currentState = { ...currentState, ...actResult };
      console.log("After Act:", currentState.lastActionResult);
      
      // Run observe node
      console.log("\n=== CYCLE: OBSERVE ===");
      const observeResult = await runObserveNode(currentState);
      currentState = { ...currentState, ...observeResult };
      console.log("After Observe: Updated surroundings and memory");
      
      // Optional: Add delay between cycles to not overwhelm the system
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error: unknown) {
    console.error('Error running agent loop:', error instanceof Error ? error.message : error);
  }
}
