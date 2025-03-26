// Node Built-ins (None used directly here, but good practice)

// External Libraries
import * as mineflayer from 'mineflayer';
import * as dotenv from 'dotenv';
import * as mcDataModule from 'minecraft-data';
import * as pathfinder from 'mineflayer-pathfinder';
import { BaseMessage } from "@langchain/core/messages"; // Keep for potential future use

// Local Modules & Types
import { State } from './agent/types';
import { MemoryManager } from './agent/memory';
import { ThinkManager } from './agent/think';
import { ObserveManager } from './agent/observe';
import { actions } from './agent/actions/index'; // Assuming actions are correctly exported from index

// --- Constants ---
const DEFAULT_GOAL = 'Collect wood and build a small shelter';
const RECURSION_LIMIT = 150; // Max steps before the graph stops itself

// --- Utility Functions ---

// Handle both CommonJS and ES module versions of minecraft-data
const mcData = (version: string) => {
  try {
    if (typeof mcDataModule === 'function') {
      return mcDataModule(version);
    } else if (mcDataModule.default && typeof mcDataModule.default === 'function') {
      return mcDataModule.default(version);
    }
    // Direct require as fallback if needed, though the above should cover most cases
    return require('minecraft-data')(version);
  } catch (error: any) {
    console.error(`[mcData] Critical failure loading minecraft-data for version ${version}:`, error);
    throw new Error(`Unable to initialize minecraft-data for version ${version}: ${error.message}`);
  }
};


// --- LangGraph Shim (Remove when SDK exports these) ---
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

const END = "end"; // Placeholder for LangGraph's END sentinel

// --- Configuration & Initialization ---

// Load environment variables
dotenv.config();

// Bot configuration
const botConfig = {
  host: process.env.MINECRAFT_HOST || 'localhost', // Allow host override
  port: parseInt(process.env.MINECRAFT_PORT || '25565'),
  username: process.env.BOT_USERNAME || 'AIBot', // Allow username override
  version: process.env.MINECRAFT_VERSION || '1.21.1', // Allow version override
  auth: (process.env.MINECRAFT_AUTH || 'offline') as mineflayer.Auth // Type assertion
};

// Create bot instance
const bot = mineflayer.createBot(botConfig);

// Initialize core agent components
const memoryManager = new MemoryManager(undefined, 10, process.env.OPENAI_API_KEY);
const thinkManager = new ThinkManager(process.env.OPENAI_API_KEY || '');
let observeManager: ObserveManager | null = null; // Initialize later in observeNode

// Define the LangGraph state object structure using our existing State interface
type GraphState = State;

// --- Global State for Initialization and Chat Commands ---
// This object holds the initial state and is updated by chat commands.
// The observeNode reads the currentGoal from here each cycle.
const initialAppState: State = {
  memory: memoryManager.fullMemory, // Start with memory from manager
  inventory: { items: {} }, // Start empty, observeNode will populate
  surroundings: { // Start empty, observeNode will populate
    nearbyBlocks: [],
    nearbyEntities: [],
    position: { x: 0, y: 0, z: 0 },
    // Health/Food will be populated by observeNode
  },
  currentGoal: DEFAULT_GOAL,
  currentPlan: undefined, // Start with no plan
  lastAction: undefined,
  lastActionResult: undefined,
};


// --- Bot Event Handlers ---

bot.once('spawn', async () => {
  console.log(`Bot '${bot.username}' spawned successfully.`);
  console.log("MemoryManager created/loaded."); // MemoryManager logs its own status

  let pathfinderInitialized = false;
  try {
    bot.loadPlugin(pathfinder.pathfinder);
    const mcDataInstance = mcData(bot.version); // Ensure mcData is loaded for pathfinder
    const defaultMove = new pathfinder.Movements(bot, mcDataInstance); // Pass mcDataInstance
    defaultMove.allowSprinting = true;
    defaultMove.canDig = true;
    bot.pathfinder.setMovements(defaultMove);
    console.log('Pathfinder initialized successfully.');
    pathfinderInitialized = true;
  } catch (error: any) { // Explicitly type error
    console.error('CRITICAL: Error initializing pathfinder plugin:', error.message || error);
    console.error('Movement capabilities will be severely limited or non-functional.');
  }

  if (pathfinderInitialized) {
    startAgentLoop(); // Start the main agent loop
  } else {
    console.error("Agent loop NOT started due to pathfinder initialization failure.");
    try {
      bot.chat("Error: My movement system (Pathfinder) failed to load. I cannot move effectively.");
    } catch (chatError) {
      console.error("Failed to send pathfinder error message via chat.");
    }
  }
});

// --- Chat Command Handling ---
// Updates the global `initialAppState` which is then read by `observeNode`.
bot.on('chat', (username, message) => {
  // Ignore messages from the bot itself
  if (username === bot.username) return;

  console.log(`[Chat] Received message from ${username}: "${message}"`);

  // Simple command parsing
  const command = message.toLowerCase().trim();
  const args = message.trim().split(' ').slice(1);

  if (command.startsWith('goal ')) {
    const newGoal = args.join(' ').trim();
    if (newGoal) {
      initialAppState.currentGoal = newGoal;
      initialAppState.currentPlan = undefined; // Clear plan to force replanning
      bot.chat(`Okay, new goal set: ${newGoal}`);
      memoryManager.addToShortTerm(`Player ${username} set a new goal: ${newGoal}`);
      console.log(`[Chat] Global goal updated by ${username}: ${newGoal}`);
    } else {
      bot.chat("Please provide a goal description after 'goal ' (e.g., 'goal build a house').");
    }
  } else if (command === 'status') {
    // Report status based on the global state (might be slightly behind graph state but good enough for chat)
    const status = `Goal: ${initialAppState.currentGoal || 'None'} | Plan Step: ${initialAppState.currentPlan?.[0] || 'N/A'} | Last Action: ${initialAppState.lastAction || 'None'} | Last Result: ${initialAppState.lastActionResult || 'None'}`;
    bot.chat(status);
    console.log(`[Chat] Sending status to ${username}.`);
  } else if (command === 'memory') {
    bot.chat(`Short-term memory (last 5): ${memoryManager.shortTerm.slice(-5).join(' | ')}`);
    // Avoid showing potentially large long-term memory in chat
    bot.chat(`Long-term memory summary is tracked internally.`);
  } else if (command === 'inventory') {
    // Use the global state's inventory for quick reporting
    const items = Object.entries(initialAppState.inventory.items)
      .filter(([, count]) => count > 0) // Only show items with count > 0
      .map(([item, count]) => `${item}: ${count}`)
      .join(', ');
    bot.chat(`Inventory (from state): ${items || 'Empty'}`);
  } else if (command === 'help') {
    bot.chat(`Available commands: goal <text>, status, memory, inventory, help, explore`);
  } else if (command === 'explore') {
    initialAppState.currentGoal = 'Explore the surroundings and gather information';
    initialAppState.currentPlan = undefined; // Force replan for exploration
    bot.chat('Okay, switching to exploration mode.');
    memoryManager.addToShortTerm(`Player ${username} requested exploration mode`);
    console.log(`[Chat] Global goal updated by ${username}: Explore`);
  }
  // Removed 'stop' and 'follow' as they weren't implemented and require graph interaction
});

bot.on('kicked', (reason) => console.warn('Bot was kicked from server:', reason));
bot.on('error', (err) => console.error('Bot encountered a runtime error:', err));
bot.on('end', (reason) => console.log('Bot disconnected:', reason)); // Handle disconnects


// --- Graph Nodes ---

// Observe Node: Gathers information and merges the current goal from global state.
async function observeNode(currentState: GraphState): Promise<Partial<GraphState>> {
  console.log("--- Running Observe Node ---");

  // Initialize ObserveManager on first run
  if (!observeManager) {
    observeManager = new ObserveManager(bot);
  }

  try {
    // Get observations from the manager
    const observationResult = await observeManager.observe(currentState);

    // Merge observations, fresh memory, and the current goal from the global state
    const updatedState: Partial<GraphState> = {
      ...observationResult,
      memory: memoryManager.fullMemory, // Ensure memory is up-to-date
      currentGoal: initialAppState.currentGoal // ** Crucial: Read goal from global state **
    };

    // Update the global state's inventory/surroundings for chat commands like 'status'/'inventory'
    // This keeps the chat commands somewhat synchronized without directly manipulating graph state.
    if (updatedState.inventory) initialAppState.inventory = updatedState.inventory;
    if (updatedState.surroundings) initialAppState.surroundings = updatedState.surroundings;

    return updatedState;
  } catch (error: any) {
    console.error('[ObserveNode] Error during observation:', error.message || error);
    // Return minimal state update on error to allow graph to potentially recover
    return {
        memory: memoryManager.fullMemory,
        currentGoal: initialAppState.currentGoal, // Still provide goal
        lastActionResult: `Observation failed: ${error.message || error}` // Report failure
    };
  }
}


// Think Node: Uses the ThinkManager to decide the next action or replan.
async function thinkNode(currentState: GraphState): Promise<Partial<GraphState>> {
  console.log("--- Running Think Node ---");
  try {
    // Delegate all thinking logic to the ThinkManager
    const thinkResult = await thinkManager.think(currentState);

    // Update global state for status reporting consistency
    if (thinkResult.lastAction) initialAppState.lastAction = thinkResult.lastAction;
    if (thinkResult.currentPlan !== undefined) initialAppState.currentPlan = thinkResult.currentPlan; // Update if plan changes

    return thinkResult;
  } catch (error: any) { // Explicitly type error
    console.error('[ThinkNode] Error during thinking process:', error.message || error);
    const fallbackAction = 'askForHelp An internal error occurred during thinking.';
    initialAppState.lastAction = fallbackAction; // Update global state
    initialAppState.currentPlan = [fallbackAction]; // Set plan to fallback
    return { lastAction: fallbackAction, currentPlan: [fallbackAction] };
  }
}


// Act Node: Executes the action decided by the 'think' node.
async function actNode(currentState: GraphState): Promise<Partial<GraphState>> {
  console.log("--- Running Act Node ---");
  const actionToPerform = currentState.lastAction;

  if (!actionToPerform) {
    console.log("[ActNode] No action decided. Skipping act node.");
    const result = "No action to perform";
    initialAppState.lastActionResult = result; // Update global state
    return { lastActionResult: result };
  }

  // Basic argument parsing (handles spaces in quoted arguments)
  const parts = actionToPerform.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const actionName = parts[0];
  const actionArgs = parts.slice(1).map(arg => arg.replace(/^"|"$/g, '')); // Remove surrounding quotes

  let result: string;
  let executionSuccess = false;

  if (actionName && actions[actionName]) {
    try {
      console.log(`[ActNode] Executing action: ${actionName} with args: [${actionArgs.join(', ')}]`);
      // Pass the current graph state to the action
      result = await actions[actionName].execute(bot, actionArgs, currentState);
      // Basic success check (can be refined per action if needed)
      const failureKeywords = ['fail', 'error', 'cannot', 'not found', 'invalid', 'unable', 'no ']; // Added 'no ' for "no bed found" etc.
      executionSuccess = !failureKeywords.some(keyword => result.toLowerCase().includes(keyword));
      console.log(`[ActNode] Action Result: ${result} (Success: ${executionSuccess})`);
    } catch (error: any) { // Explicitly type error
      result = `Failed to execute ${actionName}: ${error.message || error}`;
      console.error(`[ActNode] ${result}`);
      executionSuccess = false;
    }
  } else {
    result = `Unknown or invalid action: ${actionName}`;
    console.error(`[ActNode] ${result}`);
    executionSuccess = false;
  }

  // Update memory (always update with the result)
  // Use await as addToShortTerm is now async
  await memoryManager.addToShortTerm(`Action: ${actionToPerform} -> Result: ${result}`);

  let updatedPlan = currentState.currentPlan;

  // Advance the plan ONLY if the execution was successful AND it matched the plan
  if (executionSuccess && currentState.currentPlan && currentState.currentPlan.length > 0) {
    // Clean the current plan step for comparison (remove numbering, trim)
    const currentPlanStepClean = currentState.currentPlan[0].replace(/^\d+\.\s*/, '').trim();

    // Compare the executed action string with the cleaned plan step string
    if (actionToPerform === currentPlanStepClean) {
      console.log(`[ActNode] Completed plan step: "${currentState.currentPlan[0]}"`);
      updatedPlan = currentState.currentPlan.slice(1); // Advance plan
    } else {
      console.warn(`[ActNode] Executed action "${actionToPerform}" succeeded but did not match planned step "${currentPlanStepClean}". Plan might be outdated or action was opportunistic.`);
      // Let ThinkManager decide if replanning is needed based on this state.
    }
  } else if (!executionSuccess && currentState.currentPlan && currentState.currentPlan.length > 0) {
      console.log(`[ActNode] Action "${actionToPerform}" failed or was unsuccessful. Plan step "${currentState.currentPlan[0]}" not completed. ThinkManager will assess.`);
      // ThinkManager will handle replanning based on the failure result in the next cycle.
  }

  // Update global state for status reporting consistency
  initialAppState.lastActionResult = result;
  initialAppState.currentPlan = updatedPlan; // Keep global plan sync'd

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
    // Using 'null' as default value is fine for objects/arrays that will be populated
    memory: { value: null },
    inventory: { value: null },
    surroundings: { value: null },
    currentGoal: { value: null },
    currentPlan: { value: null },
    lastAction: { value: null },
    lastActionResult: { value: null },
    // 'next' channel is not used in this simple loop, can be removed if not needed for conditional edges later
  }
});

// Add nodes to the graph
workflow.addNode("observe", observeNode);
workflow.addNode("think", thinkNode);
workflow.addNode("act", actNode);

// Define edges for the observe -> think -> act loop
workflow.setEntryPoint("observe");
workflow.addEdge("observe", "think");
workflow.addEdge("think", "act");
workflow.addEdge("act", "observe"); // Loop back to observe

// Compile the graph into a runnable application
const app = workflow.compile();


// --- Agent Loop ---
async function startAgentLoop() {
  console.log('Starting agent loop using LangGraph...');

  try {
    // Prepare the absolute initial state for the graph's first run.
    // Run observeNode once manually BEFORE the loop to get initial sensor data.
    // Pass a minimal state object, observeNode will populate it.
    const initialSensorData = await observeNode({
        memory: initialAppState.memory, // Provide initial memory
        inventory: initialAppState.inventory,
        surroundings: initialAppState.surroundings,
        currentGoal: initialAppState.currentGoal // Provide initial goal
        // Plan, lastAction, lastActionResult start undefined
    });

    // Merge the initial sensor data with the rest of the initialAppState (like goal)
    const graphInitialRunState: GraphState = {
        ...initialAppState, // Includes goal, initial memory etc.
        ...initialSensorData // Overwrites/adds initial inventory, surroundings, position, health, food
    };

    console.log("Graph Initial Run State:", graphInitialRunState);

    // Stream the graph execution from the initial state
    const stream = app.stream(graphInitialRunState, {
        recursionLimit: RECURSION_LIMIT
    });

    // Process each step of the graph execution stream
    for await (const step of stream) {
        const nodeName = Object.keys(step)[0];
        const nodeOutput = step[nodeName];

        console.log(`--- Finished Node: ${nodeName} ---`);
        // Selectively log output to avoid excessive noise, e.g., log only action results
        if (nodeName === 'act' && nodeOutput.lastActionResult) {
             console.log(`Result: ${nodeOutput.lastActionResult}`);
        } else if (nodeName === 'think' && nodeOutput.lastAction) {
             console.log(`Next Action: ${nodeOutput.lastAction}`);
        }
        // console.log("Full Node Output:", nodeOutput); // Uncomment for detailed debugging

        console.log('---------------------');

        // Optional delay between cycles to prevent API rate limits or high CPU usage
        // await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 second delay
    }

    console.log(`Agent loop finished (reached recursion limit ${RECURSION_LIMIT} or END node).`);

  } catch (error: any) { // Explicitly type error
    console.error('FATAL: Error running LangGraph agent loop:', error.message || error);
    if (error.stack) {
        console.error("Stack Trace:", error.stack);
    }
    // Attempt to inform the user in-game if possible
    try {
        bot.chat("A critical error occurred in my main loop. Please check the console log for details.");
    } catch (chatError: any) {
        console.error("Failed to send critical error message via chat:", chatError.message || chatError);
    }
  }
}

// --- Main Execution ---
// The bot.once('spawn', ...) handler above will call startAgentLoop()
// No further explicit call is needed here.
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
    const mcDataInstance = mcData(bot.version as string);
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
