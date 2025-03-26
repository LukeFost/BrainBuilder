import * as mineflayer from 'mineflayer';
import * as dotenv from 'dotenv';
// Import minecraft-data using require to avoid TypeScript treating it as a type
const mcData = require('minecraft-data');
import * as pathfinder from 'mineflayer-pathfinder';
import { Client } from "@langchain/langgraph-sdk";
import { BaseMessage } from "@langchain/core/messages";
import { StateGraph, END } from "@langchain/langgraph";
// Add near other @langchain imports
import { RunnableLambda, RunnableConfig } from "@langchain/core/runnables";

import { Planner } from './agent/planner';
import { MemoryManager } from './agent/memory';
import { SkillRepository } from './agent/skills/skillRepository'; // Import SkillRepository
// Import actions from the new index file
import { actions } from './agent/actions/index';
import { State, Inventory, Surroundings, RecentActionEntry, StructuredMemory } from './agent/types'; // Remove 'Memory', Add 'RecentActionEntry' if needed elsewhere, or remove if not. Let's assume it might be needed for type safety in chat handlers.
import { ThinkManager } from './agent/think';
import { ObserveManager } from './agent/observe';
import { ValidateManager } from './agent/validate';
import { ResultAnalysisManager } from './agent/resultAnalysis';

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
let validateManager: ValidateManager;
let resultAnalysisManager: ResultAnalysisManager;

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
    const defaultMove = new pathfinder.Movements(bot); // Remove mcDataInstance
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
  validateManager = new ValidateManager();
  resultAnalysisManager = new ResultAnalysisManager();

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
    // await memoryManager.addToShortTerm(`Player ${username} set a new goal: ${newGoal}`);
    await memoryManager.addRecentAction(`Player command: goal`, `User ${username} set goal: ${newGoal}`);
    console.log(`[Chat] New goal set by ${username}: ${newGoal}`);
  } else if (message === 'status') {
    // Read from the shared state
    const status = `Goal: ${currentAgentState.currentGoal || 'None'}\nPlan: ${currentAgentState.currentPlan?.join(', ') || 'None'}\nLast action: ${currentAgentState.lastAction || 'None'}\nResult: ${currentAgentState.lastActionResult || 'None'}`;
    bot.chat(status);
    console.log(`[Chat] Sending status to ${username}.`);
  } else if (message === 'memory') {
    const recentActionsText = memoryManager.shortTerm // Access the getter which returns RecentActionEntry[]
                .slice(-5) // Get last 5
                .map(e => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.action.substring(0,30)}... -> ${e.result.substring(0,40)}...`)
                .join('\n');
            bot.chat(`== Recent Actions (last 5) ==\n${recentActionsText || 'None'}`);
            bot.chat(`== Long Term Summary ==\n${memoryManager.longTerm}`); // Access the getter
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
    // await memoryManager.addToShortTerm(`Player ${username} requested to stop current activity`);
    await memoryManager.addRecentAction(`Player command: stop`, `User ${username} requested stop`);
  } else if (message === 'explore') {
    // Update shared state
    currentAgentState.currentGoal = 'Explore the surroundings and gather information';
    currentAgentState.currentPlan = undefined;
    currentAgentState.lastActionResult = 'Switched to exploration mode.';
    bot.chat('Switching to exploration mode');
    // await memoryManager.addToShortTerm(`Player ${username} requested exploration mode`);
    await memoryManager.addRecentAction(`Player command: explore`, `User ${username} requested exploration`);
  }
  // Handle general questions about goals
  else if (message.toLowerCase().includes('what') && 
          (message.toLowerCase().includes('goal') || 
           message.toLowerCase().includes('doing') || 
           message.toLowerCase().includes('task'))) {
    // Respond to questions about the goal
    const currentGoal = currentAgentState.currentGoal || 'No specific goal set';
    bot.chat(`My current goal is: ${currentGoal}`);
    console.log(`[Chat] Responding to goal question from ${username}`);
    // await memoryManager.addToShortTerm(`Player ${username} asked about my goal`);
    await memoryManager.addRecentAction(`Player query: goal`, `User ${username} asked about goal`);
  }
  // Default response for unrecognized messages
  else {
    bot.chat(`I'm not sure how to respond to that. Type 'help' for a list of commands I understand.`);
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
// We will use the existing State interface directly
// interface AgentState {
//   state: State;
//   config?: RunnableConfig; // Optional config for LangGraph runs
// }

// --- Graph Nodes ---
// Node functions return state updates
async function runObserveNode(state: State): Promise<Partial<State>> {
  console.log("--- Running Observe Node ---");
  if (!observeManager || !mcDataInstance) {
    console.error("ObserveManager or mcDataInstance not initialized!");
    // Return state update
    return { lastActionResult: "Error: Core components not ready." };
  } else {
    // Get the observation updates
    const observationResult = await observeManager.observe(state);
    // Update memory
    return {
      ...observationResult,
      memory: memoryManager.fullMemory
    };
  }
}

async function runThinkNode(state: State): Promise<Partial<State>> {
  console.log("--- Running Think Node ---");
  try {
    // Get the think updates
    const thinkResult = await thinkManager.think(state);
    console.log("[Graph] Think completed");
    return thinkResult; // Return state updates
  } catch (error: unknown) {
    console.error('[ThinkNode] Error during thinking process:', error);
    return { 
      lastAction: 'askForHelp An internal error occurred during thinking.'
    };
  }
}

async function runValidateNode(state: State): Promise<Partial<State>> {
  console.log("--- Running Validate Node ---");
  try {
    // Get the validation updates
    const validateResult = await validateManager.validate(state);
    return validateResult;
  } catch (error: unknown) {
    console.error('[ValidateNode] Error during validation process:', error);
    return {
      lastAction: 'askForHelp',
      lastActionResult: 'An internal error occurred during validation.'
    };
  }
}

async function runActNode(state: State): Promise<Partial<State>> {
  console.log("--- Running Act Node ---");
  const actionToPerform = state.lastAction;

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
      if (!mcDataInstance) {
        result = "Critical Error: mcDataInstance is not initialized. Cannot execute action.";
        console.error(`[ActNode] ${result}`);
        executionSuccess = false;
      } else {
        result = await actions[actionName].execute(bot, mcDataInstance, args, state);
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

  await memoryManager.addRecentAction(actionToPerform, result);

  let updatedPlan = state.currentPlan;

  if (executionSuccess && state.currentPlan && state.currentPlan.length > 0) {
    const executedActionClean = actionToPerform.replace(/^\d+\.\s*/, '').trim();
    const currentPlanStepClean = state.currentPlan[0].replace(/^\d+\.\s*/, '').trim();

    if (executedActionClean === currentPlanStepClean) {
      console.log(`[ActNode] Completed plan step: ${state.currentPlan[0]}`);
      updatedPlan = state.currentPlan.slice(1);
    } else {
      console.warn(`[ActNode] Executed action "${executedActionClean}" succeeded but did not match planned step "${currentPlanStepClean}". Plan might be outdated or action deviated.`);
    }
  } else if (!executionSuccess) {
    console.log(`[ActNode] Action "${actionToPerform}" failed or did not succeed. Plan step not completed.`);
  }

  return {
    lastActionResult: result,
    currentPlan: updatedPlan,
    memory: memoryManager.fullMemory
  };
}

async function runResultAnalysisNode(state: State): Promise<Partial<State>> {
  console.log("--- Running Result Analysis Node ---");
  try {
    const analysisResult = await resultAnalysisManager.analyze(state);
    return analysisResult;
  } catch (error: unknown) {
    console.error('[ResultAnalysisNode] Error during result analysis process:', error);
    return {
      lastAction: 'askForHelp',
      lastActionResult: 'An internal error occurred during result analysis.'
    };
  }
}

// Add a start node that returns state updates
async function startNode(): Promise<Partial<State>> {
  return {}; // Return empty state updates
}


// --- Build the Graph ---
// Create a StateGraph instance with State as the state type and channels
const workflow = new StateGraph<State>({
  channels: {
    memory: {
      value: (left: StructuredMemory, right?: StructuredMemory) => right ?? left, 
      default: () => currentAgentState.memory
    },
    inventory: {
      value: (left: Inventory, right?: Inventory) => right ?? left,
      default: () => currentAgentState.inventory
    },
    surroundings: {
      value: (left: Surroundings, right?: Surroundings) => right ?? left,
      default: () => currentAgentState.surroundings
    },
    currentGoal: {
      value: (left?: string, right?: string) => right ?? left,
      default: () => currentAgentState.currentGoal
    },
    currentPlan: {
      value: (left?: string[], right?: string[]) => right ?? left,
      default: () => currentAgentState.currentPlan
    },
    lastAction: {
      value: (left?: string, right?: string) => right ?? left,
      default: () => currentAgentState.lastAction
    },
    lastActionResult: {
      value: (left?: string, right?: string) => right ?? left,
      default: () => currentAgentState.lastActionResult
    }
  }
});

// Add nodes with proper typing
workflow.addNode("__start__", startNode);
workflow.addNode("observe", runObserveNode);
workflow.addNode("think", runThinkNode);
workflow.addNode("validate", runValidateNode);
workflow.addNode("act", runActNode);
workflow.addNode("resultAnalysis", runResultAnalysisNode);

// Set the entry point and add edges with the proper syntax
workflow.addEdge(START, "observe"); // Use START constant
workflow.addEdge("observe", "think");

// Add conditional edges
workflow.addConditionalEdges(
  "think",
  (state: State) => {
    if (state.lastAction?.includes("askForHelp") && state.currentGoal === "Waiting for instructions") {
      return END; // Use END constant
    }
    return "validate";
  },
  // Providing a path map helps with type checking and visualization
  {
    validate: "validate",
    [END]: END,
  }
);

workflow.addEdge("validate", "act");
workflow.addEdge("act", "resultAnalysis");
workflow.addEdge("resultAnalysis", "observe");

// Compile the graph
const app = workflow.compile();


// --- LangGraph Agent Loop ---
// Agent loop implementation
async function startAgentLoop() {
  console.log('Starting LangGraph agent loop...');
  const streamConfig: RunnableConfig = { recursionLimit: 300 }; // Config for invoke

  try {
    // --- Initial observation (remains outside the loop) ---
    console.log("--- Initial Observation ---");
    // Use the wrapper node function directly with the current State
    const initialObservationUpdate = await runObserveNode(currentAgentState);
    // Merge the initial observation update into the current state
    if (initialObservationUpdate) {
      currentAgentState = { 
        ...currentAgentState,
        ...initialObservationUpdate
      };
    }
    // Check if the update contained an error message (simple check)
    if (currentAgentState.lastActionResult?.includes("Error:")) {
        console.error("Failed to get valid initial state from observation:", currentAgentState.lastActionResult);
        return; // Stop if initial observation fails
    }
    // --- End Initial Observation ---


    // --- Main Agent Loop ---
    while (true) { // Add this loop
      try {
        // Check if there's an active goal before invoking the graph
        if (!currentAgentState.currentGoal || currentAgentState.currentGoal === "Waiting for instructions") {
          // console.log("[Agent Loop] No active goal. Waiting..."); // Optional log
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          continue; // Skip to the next iteration, checking the goal again
        }

        console.log(`--- Starting New Graph Invocation for Goal: "${currentAgentState.currentGoal}" ---`);

        // Invoke the graph with null as the input (state is managed internally)
        const finalState = await app.invoke(null, streamConfig) as State | undefined;

        // Update the shared state with the final result of the graph execution
        if (finalState) {
            currentAgentState = finalState; // Update shared state with the final state from the graph run
            console.log("=== Graph Invocation Complete ===");
            // Check if the graph ended because the goal was completed
            if (currentAgentState.currentGoal === "Waiting for instructions") {
                 console.log("Goal completed! Waiting for new instructions...");
                 // The 'think' node should have set the appropriate lastAction ('askForHelp')
            }
            // console.log("Final State after invocation:", JSON.stringify(currentAgentState, null, 2)); // Optional detailed log
        } else {
            console.warn("[Agent Loop] Graph invocation finished with unexpected result (undefined).");
            // Avoid getting stuck, maybe force observation or wait? Or log error and continue?
             await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Optional: Add a small delay between cycles even when active,
        // but ensure it doesn't interfere with responsiveness
        // await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error: unknown) {
        console.error('[Agent Loop] Error during graph invocation:', error);
        // Update state to reflect error? Maybe set lastActionResult
        currentAgentState = {
            ...currentAgentState,
            lastActionResult: `Error during agent cycle: ${error instanceof Error ? error.message : String(error)}`,
            // Consider resetting the plan or goal depending on the error severity
            // currentPlan: undefined,
            // currentGoal: "Investigate and recover from error" // Or similar
        };
        // Add a delay before retrying after an error
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } // End while(true) loop

  } catch (error) {
    console.error('Critical error during agent initialization or loop setup:', error);
  } finally {
    console.log('Agent loop finished or was interrupted.');
    // Perform any cleanup here if needed
    await memoryManager.saveMemory(); // Ensure memory is saved on exit/crash
  }
}
