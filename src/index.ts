import * as mineflayer from 'mineflayer';
import * as dotenv from 'dotenv';
import mcData = require('minecraft-data');
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
import { actions } from './agent/actions';
import { State } from './agent/types';
import { Critic } from './agent/critic'; // Import Critic

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
const planner = new Planner(process.env.OPENAI_API_KEY || '');
const critic = new Critic(); // Instantiate Critic

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
    const defaultMove = new pathfinder.Movements(bot);
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

// Observe Node: Gathers information about the environment and updates the state.
async function observeNode(currentState: GraphState): Promise<Partial<GraphState>> {
  console.log("--- Running Observe Node ---");
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

  // Return the updated parts of the state
  return {
    inventory: { items: inventory },
    surroundings: state.surroundings,
    memory: memoryManager.fullMemory // Ensure memory is fresh
  };
}


// Think Node: Decides the next action or if replanning is needed.
async function thinkNode(currentState: GraphState): Promise<Partial<GraphState>> {
  console.log("--- Running Think Node ---");
  let needsNewPlan = false;
  let nextAction: string | undefined = undefined;

  // Use the critic to evaluate if we need to replan
  // const { Critic } = require('./agent/critic'); // No longer needed, critic is instantiated globally
  // const critic = new Critic(); // No longer needed
  const evaluation = critic.evaluate(currentState); // Use the global critic instance
  
  if (evaluation.needsReplanning) {
    console.log(`Critic suggests replanning: ${evaluation.reason}`);
    needsNewPlan = true;
  }
  // Reason 1: No plan exists or current plan is completed
  else if (!currentState.currentPlan || currentState.currentPlan.length === 0) {
    console.log("Reason for new plan: No current plan or plan completed.");
    needsNewPlan = true;
  }
  // Reason 2: Last action failed significantly (customize condition as needed)
  else if (currentState.lastActionResult && currentState.lastActionResult.toLowerCase().includes('failed')) {
    console.log(`Reason for considering new plan: Last action failed - "${currentState.lastActionResult}"`);
    // Simple strategy: Always replan on failure. More complex logic could be added.
    needsNewPlan = true;
  }
  
  // Reason 3: The executed action didn't match the plan step (handled in act, but could trigger replan here too)
  // if (state.lastAction && state.currentPlan && state.currentPlan.length > 0 && state.lastAction !== state.currentPlan[0]) {
  //    console.log("Reason for considering new plan: Action deviated from plan.");
  //    needsNewPlan = true;
  // }

  if (needsNewPlan && currentState.currentGoal) {
    console.log("Creating new plan...");
    try {
      const planStepsRaw = await planner.createPlan(currentState, currentState.currentGoal);
      // Clean the plan steps: remove numbering like "1. " and filter empty lines
      const cleanedPlan = planStepsRaw
        .map(step => step.replace(/^\d+\.\s*/, '').trim())
        .filter(step => step.length > 0);
        
      console.log("New plan created:", cleanedPlan);
      // If a new plan was made, decide the first action from it
      if (cleanedPlan.length > 0) {
        nextAction = cleanedPlan[0];
        console.log(`Next action from new plan: ${nextAction}`);
        return { currentPlan: cleanedPlan, lastAction: nextAction }; // Update plan and set next action
      } else {
        console.log("New plan is empty, deciding fallback action.");
        nextAction = await planner.decideNextAction(currentState); // Fallback if plan is empty
        return { currentPlan: cleanedPlan, lastAction: nextAction };
      }
    } catch (error) {
      console.error("Error creating new plan:", error);
      nextAction = 'lookAround'; // Fallback action on planning error
      return { lastAction: nextAction };
    }
  } else {
    // If no new plan is needed, decide the next action based on the current state/plan
    console.log("Continuing with existing plan or deciding next action.");
    nextAction = await planner.decideNextAction(currentState);
    console.log(`Decided next action: ${nextAction}`);
    return { lastAction: nextAction }; // Only update the next action
  }
}


// Act Node: Executes the action decided by the 'think' node.
async function actNode(currentState: GraphState): Promise<Partial<GraphState>> {
  console.log("--- Running Act Node ---");
  const actionToPerform = currentState.lastAction; // Get action from state

  if (!actionToPerform) {
    console.log("No action decided. Skipping act node.");
    return { lastActionResult: "No action to perform" };
  }

  // Parse action and arguments
  const parts = actionToPerform.split(' ');
  const actionName = parts[0];
  const args = parts.slice(1);
  // Execute action
  if (actions[actionName]) {
    try {
      console.log(`Executing action: ${actionName} with args: ${args.join(', ')}`);
      // *** PASS currentState to execute ***
      const result = await actions[actionName].execute(bot, args, currentState);

      // Update memory with action result
      memoryManager.addToShortTerm(`Action: ${actionToPerform} - Result: ${result}`);

      let updatedPlan = currentState.currentPlan;
      // Clean the current plan step for comparison
      const currentPlanStepClean = currentState.currentPlan && currentState.currentPlan.length > 0
        ? currentState.currentPlan[0].replace(/^\d+\.\s*/, '').trim()
        : null;

      // If the executed action matches the *cleaned* first step of the plan, remove it
      if (currentPlanStepClean && actionToPerform === currentPlanStepClean) {
        console.log(`Completed plan step: ${currentState.currentPlan![0]}`); // Log original step
        updatedPlan = currentState.currentPlan!.slice(1);
      } else if (currentPlanStepClean) {
        console.log(`Executed action "${actionToPerform}" does not match current plan step "${currentState.currentPlan![0]}". Plan may need revision.`);
        // The 'think' node/critic should handle replanning based on failure or deviation.
      }

      // Return the result and potentially updated plan
      return {
        lastActionResult: result,
        currentPlan: updatedPlan,
        memory: memoryManager.fullMemory // Update memory in state
      };
    } catch (error: any) {
      const errorMsg = `Failed to execute ${actionName}: ${error.message || error}`;
      console.error(`[ActNode] ${errorMsg}`);
      memoryManager.addToShortTerm(errorMsg);
      // Return failure result and updated memory
      return {
        lastActionResult: errorMsg,
        memory: memoryManager.fullMemory
      };
    }
  } else {
    const errorMsg = `Unknown action: ${actionName}`;
    console.error(`[ActNode] ${errorMsg}`);
    memoryManager.addToShortTerm(errorMsg);
    // Return unknown action result and updated memory
    return {
      lastActionResult: errorMsg,
      memory: memoryManager.fullMemory
    };
  }
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
