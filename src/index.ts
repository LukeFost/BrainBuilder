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
import { SkillRepository } from './agent/skills/skillRepository'; // Import SkillRepository
// Import actions from the new index file
import { actions } from './agent/actions/index';
import { State, Memory, Inventory, Surroundings } from './agent/types';
import { ThinkManager } from './agent/think';
import { ObserveManager } from './agent/observe';

// Load environment variables
dotenv.config();

// --- LangGraph Client Setup ---
// const client = new Client({
//   apiUrl: "YOUR_LANGGRAPH_API_URL", // Replace with your LangGraph Cloud API URL if using cloud
//   defaultHeaders: {
//     "X-API-Key": "YOUR_LANGGRAPH_API_KEY", // Replace if using LangGraph Cloud API Key
//   },
// });
// For local execution without LangGraph Cloud, the client is not strictly needed for the graph itself.

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
// Import IndexedData type
import { IndexedData } from 'minecraft-data';
// Initialize mcData instance - will be set in 'spawn'
let mcDataInstance: IndexedData;

// --- Agent Core Components ---
const memoryManager = new MemoryManager();
// Declare variables for components that need async initialization or bot instance
let skillRepository: SkillRepository;
let planner: Planner;
let thinkManager: ThinkManager;
let observeManager: ObserveManager | null = null; // Initialize lazily or here

// Define initial state structure (values will be populated)
const initialState: State = {
  memory: memoryManager.fullMemory,
  inventory: { items: {} },
  surroundings: {
    nearbyBlocks: [],
    nearbyEntities: [],
    position: { x: 0, y: 0, z: 0 }
  },
  currentGoal: 'Collect 10 oak_log and craft a crafting_table', // Updated initial goal
  // Ensure all required fields from State type are present
  lastAction: undefined,
  lastActionResult: undefined,
  currentPlan: undefined,
};

// Bot event handlers
bot.once('spawn', async () => {
  console.log('Bot has spawned');
  console.log("MemoryManager created.");

  let pathfinderInitialized = false;
  try {
    // Initialize pathfinder plugin
    bot.loadPlugin(pathfinder.pathfinder);
    // Initialize mcData here now that bot.version is available
    mcDataInstance = mcData(bot.version);
    if (!mcDataInstance) {
        console.error(`CRITICAL: Failed to load minecraft-data for version ${bot.version}. Many actions will fail.`);
        // Optionally stop the bot or prevent loop start
        return;
    }
    console.log(`minecraft-data loaded for version ${bot.version}.`);
    // Create Movements using the bot and mcDataInstance
    const defaultMove = new pathfinder.Movements(bot, mcDataInstance); // Pass mcDataInstance
    defaultMove.allowSprinting = true;
    defaultMove.canDig = true;
    bot.pathfinder.setMovements(defaultMove);
    console.log('Pathfinder initialized successfully.');
    pathfinderInitialized = true;
  } catch (error) {
    console.error('CRITICAL: Error initializing pathfinder plugin:', error);
    console.error('Movement capabilities will be severely limited or non-functional.');
  }

  // Initialize components requiring await or bot instance here
  // Explicitly pass the filename string to the constructor
  skillRepository = new SkillRepository('skills_library.json');
  await skillRepository.loadSkills(); // Load skills from the file

  planner = new Planner(process.env.OPENAI_API_KEY || '', skillRepository); // Pass API key and skills
  thinkManager = new ThinkManager(planner); // Pass the planner instance
  // Pass mcDataInstance to ObserveManager constructor
  observeManager = new ObserveManager(bot, mcDataInstance);

  if (pathfinderInitialized) {
    // Ensure observeManager is initialized before starting the loop
    if (!observeManager) {
       console.error("CRITICAL: ObserveManager failed to initialize. Cannot start agent loop.");
       return;
    }
    startAgentLoop();
  } else {
    console.error("Agent loop not started due to pathfinder initialization failure.");
    bot.chat("I cannot move properly. Pathfinder failed to load.");
    // Optionally, stop the bot or prevent the agent loop if pathfinder is critical
    return;
  }
});

// --- Chat Command Handling ---
// We need a way to update the state used by the LangGraph loop.
// A simple approach is to have a mutable `currentAgentState` object.
let currentAgentState: State = { ...initialState }; // Initialize with initial state

bot.on('chat', async (username, message) => {
  console.log(`[Chat] Received message from ${username}: "${message}"`);
  if (username === bot.username) return;

  console.log(`[Chat] Processing command from ${username}.`);
  if (message.startsWith('goal ')) {
    const newGoal = message.slice(5);
    // Update the shared state
    currentAgentState.currentGoal = newGoal;
    currentAgentState.currentPlan = undefined; // Force replan
    currentAgentState.lastActionResult = `New goal received: ${newGoal}`; // Inform the agent loop
    bot.chat(`New goal set: ${newGoal}`);
    await memoryManager.addToShortTerm(`Player ${username} set a new goal: ${newGoal}`);
    console.log(`[Chat] New goal set by ${username}: ${newGoal}`);
  } else if (message === 'status') {
    // Read from the shared state
    const status = `Goal: ${currentAgentState.currentGoal || 'None'}\nPlan: ${currentAgentState.currentPlan?.join(', ') || 'None'}\nLast action: ${currentAgentState.lastAction || 'None'}\nResult: ${currentAgentState.lastActionResult || 'None'}`;
    bot.chat(status);
    console.log(`[Chat] Sending status to ${username}.`);
  } else if (message === 'memory') {
    bot.chat(`Short-term memory: ${memoryManager.shortTerm.join(', ')}`);
    // Add long-term summary if available in memoryManager
    // bot.chat(`Long-term memory summary: ${memoryManager.longTermSummary}`);
  } else if (message === 'inventory') {
    // Read from the shared state
    const items = Object.entries(currentAgentState.inventory.items)
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
    // Update shared state - potentially clear plan/action?
    currentAgentState.currentPlan = undefined;
    currentAgentState.lastAction = undefined;
    currentAgentState.lastActionResult = 'Activity stopped by user.';
    await memoryManager.addToShortTerm(`Player ${username} requested to stop current activity`);
  } else if (message === 'explore') {
    // Update shared state
    currentAgentState.currentGoal = 'Explore the surroundings and gather information';
    currentAgentState.currentPlan = undefined;
    currentAgentState.lastActionResult = 'Switched to exploration mode.';
    bot.chat('Switching to exploration mode');
    await memoryManager.addToShortTerm(`Player ${username} requested exploration mode`);
  }
  // Remove 'follow' command for now as it's not implemented as an action
  // else if (message.startsWith('follow ')) {
  //   const targetName = message.slice(7);
  //   bot.chat(`Following ${targetName}`);
  // }
});

bot.on('kicked', console.log);
bot.on('error', console.log);


// --- LangGraph Definition ---

// Define the state structure for the graph
// This mirrors the State type but might be used specifically by LangGraph if needed
interface AgentState {
  state: State;
  config?: RunnableConfig; // Optional config for LangGraph runs
}

// --- Graph Nodes ---
// observeManager and mcDataInstance are now guaranteed to be initialized before startAgentLoop is called

// Node functions now operate on the AgentState wrapper
async function runObserveNodeWrapper(agentState: AgentState): Promise<Partial<AgentState>> {
  console.log("--- Running Observe Node ---");
  if (!observeManager || !mcDataInstance) { // Add check for mcDataInstance too
      console.error("ObserveManager or mcDataInstance not initialized!");
      return { state: { ...agentState.state, lastActionResult: "Error: Core components not ready." } };
  }
  // Pass the current state from the wrapper to the original observe function
  const observationResult = await observeManager.observe(agentState.state);
  // Merge the observation result back into the state within the wrapper
  const newState = { ...agentState.state, ...observationResult, memory: memoryManager.fullMemory };
  return { state: newState };
}

async function runThinkNodeWrapper(agentState: AgentState): Promise<Partial<AgentState>> {
  console.log("--- Running Think Node ---");
  try {
    // Pass the current state from the wrapper to the original think function
    const thinkResult = await thinkManager.think(agentState.state);
    // Merge the think result back into the state within the wrapper
    const newState = { ...agentState.state, ...thinkResult };
    return { state: newState };
  } catch (error: unknown) {
    console.error('[ThinkNode] Error during thinking process:', error);
    // Update the state within the wrapper on error
    const newState = { ...agentState.state, lastAction: 'askForHelp An internal error occurred during thinking.' };
    return { state: newState };
  }
}

async function runActNodeWrapper(agentState: AgentState): Promise<Partial<AgentState>> {
  console.log("--- Running Act Node ---");
  const currentState = agentState.state; // Get state from wrapper
  const actionToPerform = currentState.lastAction;

  if (!actionToPerform) {
    console.log("[ActNode] No action decided. Skipping act node.");
    // Return updated wrapper state
    return { state: { ...currentState, lastActionResult: "No action to perform" } };
  }

  const parts = actionToPerform.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const actionName = parts[0];
  const args = parts.slice(1).map((arg: string) => arg.replace(/^"|"$/g, ''));

  let result: string;
  let executionSuccess = false;

  if (actionName && actions[actionName]) {
    try {
      console.log(`[ActNode] Executing action: ${actionName} with args: ${args.join(', ')}`);
      // Pass the current state (from wrapper) and mcDataInstance to the action execution context
      if (!mcDataInstance) {
          // This check prevents runtime errors if spawn failed silently
          result = "Critical Error: mcDataInstance is not initialized. Cannot execute action.";
          console.error(`[ActNode] ${result}`);
          executionSuccess = false;
      } else {
          result = await actions[actionName].execute(bot, mcDataInstance, args, currentState);
          executionSuccess = !result.toLowerCase().includes('fail') && !result.toLowerCase().includes('error');
          console.log(`[ActNode] Action Result: ${result}`);
      }
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

  // Update plan only on successful execution of the planned step
  if (executionSuccess && currentState.currentPlan && currentState.currentPlan.length > 0) {
      // Clean both the executed action and the plan step for comparison
      const executedActionClean = actionToPerform.replace(/^\d+\.\s*/, '').trim();
      const currentPlanStepClean = currentState.currentPlan[0].replace(/^\d+\.\s*/, '').trim();

      if (executedActionClean === currentPlanStepClean) {
          console.log(`[ActNode] Completed plan step: ${currentState.currentPlan[0]}`);
          updatedPlan = currentState.currentPlan.slice(1); // Advance the plan
      } else {
          console.warn(`[ActNode] Executed action "${executedActionClean}" succeeded but did not match planned step "${currentPlanStepClean}". Plan might be outdated or action deviated.`);
          // Let Think node decide if replan is needed based on the result and state.
      }
  } else if (!executionSuccess) {
      console.log(`[ActNode] Action "${actionToPerform}" failed or did not succeed. Plan step not completed.`);
      // Let Think node handle failure and decide on replanning.
  }

  // Construct the new state for the wrapper
  const newState = {
      ...currentState,
      lastActionResult: result,
      currentPlan: updatedPlan,
      memory: memoryManager.fullMemory // Ensure memory is updated
  };
  // Return the updated wrapper state
  return { state: newState };
}


// --- Build the Graph ---
const workflow = new StateGraph<AgentState>({
  channels: {
    state: {
        // The value reducer takes the existing channel value and the new value
        // and returns the updated channel value.
        value: (left: State, right: State) => right, // Always take the latest state update
        // The default value is used if the channel is accessed before it's been assigned.
        default: () => currentAgentState // Start with the mutable currentAgentState
    }
    // Add config channel if needed for passing RunnableConfig through the graph
    // config: {
    //   value: (left?: RunnableConfig, right?: RunnableConfig) => right ?? left,
    //   default: () => ({ recursionLimit: 150 } as RunnableConfig)
    // }
  }
});

// Add nodes using the wrapper functions
workflow.addNode("observe", runObserveNodeWrapper);
workflow.addNode("think", runThinkNodeWrapper);
workflow.addNode("act", runActNodeWrapper);

// Define edges
workflow.setEntryPoint("observe"); // Start with observation
workflow.addEdge("observe", "think"); // After observing, think
workflow.addEdge("think", "act");   // After thinking, act
workflow.addEdge("act", "observe"); // After acting, observe again (loop)

// Compile the graph
const app = workflow.compile();


// --- LangGraph Agent Loop ---
async function startAgentLoop() {
  console.log('Starting LangGraph agent loop...');

  try {
    // Initial observation to populate state before the loop starts feeding it
    console.log("--- Initial Observation ---");
    // Use the wrapper node function for consistency, passing the initial AgentState
    const initialObservationResult = await runObserveNodeWrapper({ state: currentAgentState });
    if (initialObservationResult.state) {
        currentAgentState = initialObservationResult.state; // Update shared state from the wrapper's result
    }
    console.log("Initial State Populated:", currentAgentState);


    // Use app.stream to run the graph loop
    const streamConfig: RunnableConfig = { recursionLimit: 150 }; // Adjust recursion limit as needed

    // The loop continuously processes state updates from the graph stream
    // Pass the initial AgentState wrapper to the stream
    for await (const event of app.stream({ state: currentAgentState }, streamConfig)) {
        // The event object contains the output of the node that just ran,
        // keyed by the node name. The 'state' channel is automatically updated.

        // Log based on which node's output is present in the event
        if (event.observe) {
            console.log("\n=== Cycle End: OBSERVE ===");
            // Update the shared state from the graph's latest state channel value
            // Note: LangGraph automatically merges the output state into the channel
            // We update our external `currentAgentState` to reflect the graph's internal state
            currentAgentState = event.observe.state;
            console.log("Shared State Updated After Observe");
        } else if (event.think) {
            console.log("\n=== Cycle End: THINK ===");
            currentAgentState = event.think.state;
            console.log("Shared State Updated After Think. Next Action:", currentAgentState.lastAction);
        } else if (event.act) {
            console.log("\n=== Cycle End: ACT ===");
            currentAgentState = event.act.state;
            console.log("Shared State Updated After Act. Result:", currentAgentState.lastActionResult);
            // Optional delay after acting
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
             // This might happen for intermediate steps or if __end__ is reached
             console.log("Graph stream event without specific node output:", event);
        }

        // Optional: Add termination condition check here if needed
        // if (some_condition(currentAgentState)) {
        //   console.log("Agent loop terminating.");
        //   break; // Exit the for await loop
        // }
    }
    console.log("Agent loop finished or was interrupted.");

  } catch (error: unknown) {
    console.error('Error running LangGraph agent loop:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
        console.error(error.stack);
    }
  }
}
