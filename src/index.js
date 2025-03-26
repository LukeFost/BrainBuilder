import * as mineflayer from 'mineflayer';
import * as dotenv from 'dotenv';
// Import minecraft-data using require to avoid TypeScript treating it as a type
const mcData = require('minecraft-data');
import * as pathfinder from 'mineflayer-pathfinder';
import { Client } from "@langchain/langgraph-sdk";
import { BaseMessage } from "@langchain/core/messages"; // Although not used yet, good to have for potential future message passing

// Define your own StateGraph and END until the langgraph-sdk exports them
class StateGraph<T> {
  channels: Record<string, { value: any }>;
  nodes: Map<string, (state: T) => Promise<Partial<T>>>;
  edges: Map<string, string[]>;
  entryPoint: string | null;

  constructor(options: { channels: Record<string, { value: any }> }) {
    this.channels = options.channels;
    this.nodes = new Map();
    this.edges = new Map();
    this.entryPoint = null;
  }

  addNode(name: string, fn: (state: T) => Promise<Partial<T>>) {
    this.nodes.set(name, fn);
    return this;
  }

  setEntryPoint(name: string) {
    this.entryPoint = name;
    return this;
  }

  addEdge(from: string, to: string) {
    if (!this.edges.has(from)) {
      this.edges.set(from, []);
    }
    this.edges.get(from)!.push(to);
    return this;
  }

  compile() {
    return {
      stream: (initialState: T, options?: { recursionLimit?: number }) => {
        const limit = options?.recursionLimit || 100;
        let currentNode = this.entryPoint;
        let state = { ...initialState };
        const graph = this;
        
        return {
          [Symbol.asyncIterator]() {
            return (async function* () {
              for (let i = 0; i < limit; i++) {
                if (!currentNode) break;
                
                const nodeFn = graph.nodes.get(currentNode);
                if (!nodeFn) break;
                
                const result = await nodeFn(state);
                state = { ...state, ...result };
                
                yield { [currentNode]: result };
                
                const nextNodes = graph.edges.get(currentNode) || [];
                currentNode = nextNodes[0] || null;
              }
            })();
          }
        };
      }
    };
  }
}

const END = "end";

import { Planner } from './agent/planner';
import { MemoryManager } from './agent/memory';
// Import actions from the new index file
import { actions } from './agent/actions/index';
import { State } from './agent/types';
// REMOVE: import { Critic } from './agent/critic';
import { ThinkManager } from './agent/think'; // Keep this
import { ObserveManager } from './agent/observe'; // Keep this

// Define the LangGraph state object structure
// Note: We are using our existing State interface. If more complex message passing is needed later,
// we might switch to MessagesState or a custom class extending it.
type GraphState = State;

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
// REMOVE: const planner = new Planner(process.env.OPENAI_API_KEY || ''); // Planner is now inside ThinkManager
// REMOVE: const critic = new Critic();
const thinkManager = new ThinkManager(process.env.OPENAI_API_KEY || ''); // Instantiate ThinkManager directly

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
bot.once('spawn', async () => { // Add async here
  console.log('Bot has spawned');

  // Memory manager is initialized in its constructor now
  console.log("MemoryManager created.");

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

// --- Chat Command Handling ---
// Keep the existing bot.on('chat', ...) handler as is for now.
// We might integrate some commands into the graph later if needed.
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


// --- Graph Nodes ---

// Import the ObserveManager
import { ObserveManager } from './agent/observe';

// Create an instance of ObserveManager
let observeManager: ObserveManager | null = null;

// Observe Node: Gathers information about the environment and updates the state.
async function observeNode(currentState: GraphState): Promise<Partial<GraphState>> {
  console.log("--- Running Observe Node ---");
  
  // Create ObserveManager instance if not already created
  if (!observeManager) {
    observeManager = new ObserveManager(bot);
  }
  
  // Use the ObserveManager to handle the observation process
  const observationResult = await observeManager.observe(currentState);
  
  // Merge with memory
  return {
    ...observationResult,
    memory: memoryManager.fullMemory // Ensure memory is fresh
  };
}


// Think Node: Uses the ThinkManager to decide the next action or replan.
async function thinkNode(currentState: GraphState): Promise<Partial<GraphState>> {
  console.log("--- Running Think Node ---");
  // Delegate all thinking logic to the ThinkManager
  try {
      // ThinkManager now returns the necessary state updates (lastAction, potentially currentPlan)
      return await thinkManager.think(currentState);
  } catch (error) {
      console.error('[ThinkNode] Error during thinking process:', error);
      // Fallback action if think manager fails unexpectedly
      return { lastAction: 'askForHelp An internal error occurred during thinking.' };
  }
}


// Act Node: Executes the action decided by the 'think' node.
// (Keep the existing actNode implementation, ensuring it correctly updates
// the plan state after successful execution)
async function actNode(currentState: GraphState): Promise<Partial<GraphState>> {
  console.log("--- Running Act Node ---");
  const actionToPerform = currentState.lastAction;

  if (!actionToPerform) {
    console.log("[ActNode] No action decided. Skipping act node.");
    return { lastActionResult: "No action to perform" };
  }

  const parts = actionToPerform.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const actionName = parts[0];
  const args = parts.slice(1).map(arg => arg.replace(/^"|"$/g, ''));

  let result: string;
  let executionSuccess = false; // Track if execution itself succeeded

  if (actionName && actions[actionName]) {
    try {
      console.log(`[ActNode] Executing action: ${actionName} with args: ${args.join(', ')}`);
      result = await actions[actionName].execute(bot, args, currentState);
      executionSuccess = !result.toLowerCase().includes('fail') && !result.toLowerCase().includes('error'); // Basic success check
      console.log(`[ActNode] Action Result: ${result}`);
    } catch (error: any) {
      result = `Failed to execute ${actionName}: ${error.message || error}`;
      console.error(`[ActNode] ${result}`);
      executionSuccess = false;
    }
  } else {
    result = `Unknown action: ${actionName}`;
    console.error(`[ActNode] ${result}`);
    executionSuccess = false;
  }

  // Update memory (always update with the result)
  await memoryManager.addToShortTerm(`Action: ${actionToPerform} -> Result: ${result}`);

  let updatedPlan = currentState.currentPlan;

  // Advance the plan ONLY if the execution was successful AND it matched the plan
  if (executionSuccess && currentState.currentPlan && currentState.currentPlan.length > 0) {
    // Clean the current plan step for comparison (remove numbering, trim)
    const currentPlanStepClean = currentState.currentPlan[0].replace(/^\d+\.\s*/, '').trim();

    if (actionToPerform === currentPlanStepClean) {
      console.log(`[ActNode] Completed plan step: ${currentState.currentPlan[0]}`);
      updatedPlan = currentState.currentPlan.slice(1);
    } else {
      console.warn(`[ActNode] Executed action "${actionToPerform}" succeeded but did not match planned step "${currentState.currentPlan[0]}". Plan might be outdated.`);
      // Let ThinkManager decide if replanning is needed based on this state.
    }
  } else if (!executionSuccess && currentState.currentPlan && currentState.currentPlan.length > 0) {
      console.log(`[ActNode] Action "${actionToPerform}" failed. Plan step "${currentState.currentPlan[0]}" not completed.`);
      // ThinkManager will handle replanning based on the failure result.
  }


  return {
    lastActionResult: result,
    currentPlan: updatedPlan, // Return potentially updated plan
    memory: memoryManager.fullMemory // Return updated memory state
  };
}


// --- Graph Definition ---
const workflow = new StateGraph<GraphState>({
  channels: {
    // Define the structure of the state object channels
    memory: { value: null },
    inventory: { value: null },
    surroundings: { value: null },
    currentGoal: { value: null },
    currentPlan: { value: null },
    lastAction: { value: null },
    lastActionResult: { value: null },
    next: { value: null }, // Used for routing, might not be strictly needed for simple loop
  }
});

// Add nodes
workflow.addNode("observe", observeNode);
workflow.addNode("think", thinkNode);
workflow.addNode("act", actNode);

// Define edges
workflow.setEntryPoint("observe"); // Start with observing
workflow.addEdge("observe", "think"); // After observing, think
workflow.addEdge("think", "act"); // After thinking, act
workflow.addEdge("act", "observe"); // After acting, observe again (loop)

// Compile the graph
const app = workflow.compile();


// --- Agent Loop ---
async function startAgentLoop() {
  console.log('Starting agent loop using LangGraph');

  try {
    // Initial state setup before starting the loop
    // We use the global `state` object as the initial input.
    // Ensure observe runs first to populate initial surroundings etc.
    const initialState = await observeNode(state); // Run observe once to get initial data
    const fullInitialState = { ...state, ...initialState }; // Merge with existing state (like goal)

    console.log("Initial State:", fullInitialState);

    // Stream the graph execution
    const stream = app.stream(fullInitialState, {
        // recursionLimit: 100 // Optional: Set recursion limit
    });

    for await (const step of stream) {
        // Log the output of each node step
        const nodeName = Object.keys(step)[0];
        console.log(`--- Finished Node: ${nodeName} ---`);
        console.log("Output:", step[nodeName]);
        console.log('---------------------');

        // Optional: Add a delay between cycles if needed
        // await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log("Agent loop finished or stopped.");

  } catch (error) {
    console.error('Error running LangGraph agent loop:', error);
  }
}
