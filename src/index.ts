// Node Built-ins (None used directly here, but good practice)

// Node Built-ins (Add as needed, e.g., import * as path from 'path';)

// External Libraries
import * as mineflayer from 'mineflayer';
import * as dotenv from 'dotenv';
import * as mcDataModule from 'minecraft-data';
import * as pathfinder from 'mineflayer-pathfinder';
// Removed: import { BaseMessage } from "@langchain/core/messages"; // Not used

// Local Modules & Types
import { State } from './agent/types';
import { MemoryManager } from './agent/memory';
import { ThinkManager } from './agent/think';
import { ObserveManager } from './agent/observe';
import { actions } from './agent/actions/index';
import { StateGraph, END } from './utils/langgraph-shim'; // Import the shim

// --- Constants ---
const DEFAULT_GOAL = 'Collect wood and build a small shelter';
const RECURSION_LIMIT = 150; // Max steps before the graph stops itself
// const MEMORY_FILE = 'agent_memory.json'; // Example constant if needed

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
const observeManager = new ObserveManager(bot); // Initialize here

// Define the LangGraph state object structure using our existing State interface
type GraphState = State;

// --- Agent Configuration & Status Tracking ---
// This object holds configuration (like goal) and tracks status for chat commands.
// It is updated by chat commands and read/updated by graph nodes for reporting consistency.
const agentConfig: State = { // Renamed from initialAppState
  memory: memoryManager.fullMemory, // Start with memory from manager
  inventory: { items: {} }, // Populated by initial observe, used for chat status
  surroundings: { // Populated by initial observe, used for chat status
    nearbyBlocks: [],
    nearbyEntities: [],
    position: { x: 0, y: 0, z: 0 },
    // Health/Food will be populated by initial observe
  },
  currentGoal: DEFAULT_GOAL,
  currentPlan: undefined, // Tracks the plan for status reporting
  lastAction: undefined, // Tracks last action for status reporting
  lastActionResult: undefined, // Tracks last result for status reporting
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

function handleChatMessage(username: string, message: string) {
  // Ignore messages from the bot itself
  if (username === bot.username) return;

  console.log(`[Chat] Received message from ${username}: "${message}"`);

  // Simple command parsing
  const command = message.toLowerCase().trim();
  // Handle commands with arguments more robustly
  const parts = message.trim().split(' ');
  const cmdBase = parts[0]?.toLowerCase(); // e.g., 'goal'
  const args = parts.slice(1); // e.g., ['build', 'a', 'house']

  if (cmdBase === 'goal') {
    const newGoal = args.join(' ').trim();
    if (newGoal) {
      agentConfig.currentGoal = newGoal; // Update config
      agentConfig.currentPlan = undefined; // Clear plan in config
      // NOTE: The graph will pick up the new goal in the next observeNode run.
      bot.chat(`Okay, new goal set: ${newGoal}`);
      memoryManager.addToShortTerm(`Player ${username} set a new goal: ${newGoal}`); // Keep adding to memory
      console.log(`[Chat] Agent goal updated by ${username}: ${newGoal}`);
    } else {
      bot.chat("Please provide a goal description after 'goal ' (e.g., 'goal build a house').");
    }
  } else if (cmdBase === 'status') {
    // Report status based on the agentConfig (might be slightly behind graph state but good enough for chat)
    const status = `Goal: ${agentConfig.currentGoal || 'None'} | Plan Step: ${agentConfig.currentPlan?.[0] || 'N/A'} | Last Action: ${agentConfig.lastAction || 'None'} | Last Result: ${agentConfig.lastActionResult || 'None'}`;
    bot.chat(status);
    console.log(`[Chat] Sending status to ${username}.`);
  } else if (cmdBase === 'memory') {
    bot.chat(`Short-term memory (last 5): ${memoryManager.shortTerm.slice(-5).join(' | ')}`);
    bot.chat(`Long-term memory summary is tracked internally.`);
  } else if (cmdBase === 'inventory') {
    // Use the agentConfig's inventory for quick reporting (populated by initial observe)
    const items = Object.entries(agentConfig.inventory.items)
      .filter(([, count]) => count > 0)
      .map(([item, count]) => `${item}: ${count}`)
      .join(', ');
    bot.chat(`Inventory (from state): ${items || 'Empty'}`);
  } else if (cmdBase === 'help') {
    bot.chat(`Available commands: goal <text>, status, memory, inventory, help, explore`);
  } else if (cmdBase === 'explore') {
    agentConfig.currentGoal = 'Explore the surroundings and gather information'; // Update config
    agentConfig.currentPlan = undefined; // Clear plan in config
    bot.chat('Okay, switching to exploration mode.');
    memoryManager.addToShortTerm(`Player ${username} requested exploration mode`);
    console.log(`[Chat] Agent goal updated by ${username}: Explore`);
  }
  // Removed 'stop' and 'follow' as they weren't implemented
}

// Update the bot.on('chat') handler
bot.on('chat', (username, message) => {
  handleChatMessage(username, message);
});

bot.on('kicked', (reason) => console.warn('Bot was kicked from server:', reason));
bot.on('error', (err) => console.error('Bot encountered a runtime error:', err));
bot.on('end', (reason) => console.log('Bot disconnected:', reason)); // Handle disconnects


// --- Graph Nodes ---

// Observe Node: Gathers information and merges the current goal from global state.
async function observeNode(currentState: GraphState): Promise<Partial<GraphState>> {
  console.log("--- Running Observe Node ---");

  // ObserveManager is now initialized globally

  try {
    // Get observations from the manager
    const observationResult = await observeManager.observe(currentState);

    // Merge observations, fresh memory, and the current goal from agentConfig
    const updatedState: Partial<GraphState> = {
      ...observationResult,
      memory: memoryManager.fullMemory, // Ensure memory is up-to-date
      currentGoal: agentConfig.currentGoal // ** Read goal from agentConfig **
    };

    // DO NOT update agentConfig inventory/surroundings here.
    // Initial population happens in startAgentLoop, chat commands read from there.

    return updatedState;
  } catch (error: any) {
    console.error('[ObserveNode] Error during observation:', error.message || error);
    // Return minimal state update on error to allow graph to potentially recover
    return {
        memory: memoryManager.fullMemory,
        currentGoal: agentConfig.currentGoal, // Still provide goal from agentConfig
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

    // Update agentConfig for status reporting consistency
    if (thinkResult.lastAction) agentConfig.lastAction = thinkResult.lastAction;
    if (thinkResult.currentPlan !== undefined) agentConfig.currentPlan = thinkResult.currentPlan; // Update if plan changes

    return thinkResult; // Return the result to update graph state
  } catch (error: any) { // Explicitly type error
    console.error('[ThinkNode] Error during thinking process:', error.message || error);
    const fallbackAction = 'askForHelp An internal error occurred during thinking.';
    agentConfig.lastAction = fallbackAction; // Update agentConfig
    agentConfig.currentPlan = [fallbackAction]; // Update agentConfig
    return { lastAction: fallbackAction, currentPlan: [fallbackAction] }; // Return update for graph state
  }
}


// Act Node: Executes the action decided by the 'think' node.
async function actNode(currentState: GraphState): Promise<Partial<GraphState>> {
  console.log("--- Running Act Node ---");
  const actionToPerform = currentState.lastAction;

  if (!actionToPerform) {
    console.log("[ActNode] No action decided. Skipping act node.");
    const result = "No action to perform";
    agentConfig.lastActionResult = result; // Update agentConfig
    return { lastActionResult: result }; // Return update for graph state
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

  // Update agentConfig for status reporting consistency
  agentConfig.lastActionResult = result;
  agentConfig.currentPlan = updatedPlan; // Keep agentConfig plan sync'd

  return {
    lastActionResult: result,
    currentPlan: updatedPlan, // Return potentially updated plan for graph state
    memory: memoryManager.fullMemory // Return updated memory state for graph state
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
    // Run observe once manually BEFORE the loop to get initial sensor data.
    // Pass a minimal state object reflecting agentConfig structure.
    const initialObservationState: Partial<GraphState> = {
        memory: agentConfig.memory, // Provide initial memory from config
        inventory: agentConfig.inventory, // Provide structure
        surroundings: agentConfig.surroundings, // Provide structure
        currentGoal: agentConfig.currentGoal // Provide initial goal from config
        // Plan, lastAction, lastActionResult start undefined
    };
    // Use observeManager directly for initial observation
    const initialSensorData = await observeManager.observe(initialObservationState as GraphState);

    // Merge the initial sensor data back into agentConfig for chat commands
    // and create the true initial state for the graph run.
    agentConfig.inventory = initialSensorData.inventory ?? agentConfig.inventory;
    agentConfig.surroundings = initialSensorData.surroundings ?? agentConfig.surroundings;
    // Health/Food are now within agentConfig.surroundings if observed

    const graphInitialRunState: GraphState = {
        ...agentConfig, // Includes goal, initial memory, potentially updated inv/surroundings
        ...initialSensorData, // Ensure latest observed data overwrites defaults
        memory: memoryManager.fullMemory // Ensure memory is absolutely fresh for the graph start
    };

    console.log("Graph Initial Run State:", graphInitialRunState);

    // Stream the graph execution from the initial state
    const stream = app.stream(graphInitialRunState, { // Use the fully prepared state
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
