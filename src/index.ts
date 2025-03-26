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
import { State, Inventory, Surroundings, RecentActionEntry } from './agent/types'; // Remove 'Memory', Add 'RecentActionEntry' if needed elsewhere, or remove if not. Let's assume it might be needed for type safety in chat handlers.
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
// This mirrors the State type but might be used specifically by LangGraph if needed
interface AgentState {
  state: State;
  config?: RunnableConfig; // Optional config for LangGraph runs
}

// --- Graph Nodes ---
// observeManager and mcDataInstance are now guaranteed to be initialized before startAgentLoop is called

// Node functions operate on AgentState and return Partial<AgentState> for channel updates
async function runObserveNodeWrapper(agentState: AgentState): Promise<Partial<AgentState>> { // Revert return type
  console.log("--- Running Observe Node ---");
  let newState: State;
  if (!observeManager || !mcDataInstance) { // Add check for mcDataInstance too
      console.error("ObserveManager or mcDataInstance not initialized!");
      newState = { ...agentState.state, lastActionResult: "Error: Core components not ready." };
  } else {
      // Pass the current state from the wrapper to the original observe function
      const observationResult = await observeManager.observe(agentState.state);
      // Merge the observation result back into the state within the wrapper
      newState = { ...agentState.state, ...observationResult, memory: memoryManager.fullMemory };
  }
  // Return an object matching Partial<AgentState>
  return { state: newState }; // Revert return statement structure
}

async function runThinkNodeWrapper(agentState: AgentState): Promise<Partial<AgentState>> { // Revert return type
  console.log("--- Running Think Node ---");
  let newState: State;
  try {
    // Pass the current state from the wrapper to the original think function
    const thinkResult = await thinkManager.think(agentState.state);
    // Merge the think result back into the state within the wrapper
    newState = { ...agentState.state, ...thinkResult };
  } catch (error: unknown) {
    console.error('[ThinkNode] Error during thinking process:', error);
    // Update the state within the wrapper on error
    newState = { ...agentState.state, lastAction: 'askForHelp An internal error occurred during thinking.' };
  }
  // Return an object matching Partial<AgentState>
  return { state: newState }; // Revert return statement structure
}

async function runValidateNodeWrapper(agentState: AgentState): Promise<Partial<AgentState>> { // Revert return type
  console.log("--- Running Validate Node ---");
  let newState: State;
  try {
    // Pass the current state from the wrapper to the validate function
    const validateResult = await validateManager.validate(agentState.state);
    // Merge the validation result back into the state within the wrapper
    newState = { ...agentState.state, ...validateResult };
  } catch (error: unknown) {
    console.error('[ValidateNode] Error during validation process:', error);
    // Update the state within the wrapper on error
    newState = {
      ...agentState.state,
      lastAction: 'askForHelp',
      lastActionResult: 'An internal error occurred during validation.'
    };
  }
  // Return an object matching Partial<AgentState>
  return { state: newState }; // Revert return statement structure
}

async function runActNodeWrapper(agentState: AgentState): Promise<Partial<AgentState>> { // Revert return type
  console.log("--- Running Act Node ---");
  const currentState = agentState.state; // Get state from wrapper
  const actionToPerform = currentState.lastAction;

  if (!actionToPerform) {
    console.log("[ActNode] No action decided. Skipping act node.");
    // Return updated wrapper state
    const newState = { ...currentState, lastActionResult: "No action to perform" };
    // Return an object matching Partial<AgentState>
    return { state: newState }; // Revert return statement structure
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

  // await memoryManager.addToShortTerm(`Action: ${actionToPerform} -> Result: ${result}`);
  await memoryManager.addRecentAction(actionToPerform, result); // Use the new method

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
  // Return an object matching Partial<AgentState>
  return { state: newState }; // Revert return statement structure
}

async function runResultAnalysisNodeWrapper(agentState: AgentState): Promise<Partial<AgentState>> { // Revert return type
  console.log("--- Running Result Analysis Node ---");
  let newState: State;
  try {
    // Pass the current state from the wrapper to the result analysis function
    const analysisResult = await resultAnalysisManager.analyze(agentState.state);
    // Merge the analysis result back into the state within the wrapper
    newState = { ...agentState.state, ...analysisResult };
  } catch (error: unknown) {
    console.error('[ResultAnalysisNode] Error during result analysis process:', error);
    // Update the state within the wrapper on error
    newState = {
      ...agentState.state,
      lastAction: 'askForHelp',
      lastActionResult: 'An internal error occurred during result analysis.'
    };
  }
  // Return an object matching Partial<AgentState>
  return { state: newState }; // Revert return statement structure
}


// --- Build the Graph ---
const workflow = new StateGraph<AgentState>({
  channels: {
    // Channel for the 'state' property of AgentState
    state: {
        // Reducer operates on the State object. Ensure it always returns State.
        // 'left' will be the result of 'default' on the first run.
        value: (left: State, right?: State) => right ?? left,
        // Default provides the initial State object
        default: (): State => currentAgentState // Explicitly type the default return
    },
    // Channel for the 'config' property of AgentState
    config: {
        // Reducer operates on the RunnableConfig object
        value: (left?: RunnableConfig, right?: RunnableConfig) => right ?? left, // Take new config if provided
        // Default provides the initial RunnableConfig object
        default: () => ({ recursionLimit: 300 } as RunnableConfig) // Default config
    }
  }
});

// Add nodes using the wrapper functions
workflow.addNode("observe", runObserveNodeWrapper);
workflow.addNode("think", runThinkNodeWrapper);
workflow.addNode("validate", runValidateNodeWrapper);
workflow.addNode("act", runActNodeWrapper);
workflow.addNode("resultAnalysis", runResultAnalysisNodeWrapper);

// Define edges without 'as any' for better type checking
// First set the entry point
workflow.setEntryPoint("observe"); // Start with observe node

// Then add the edges to form a cycle with conditional ending
workflow.addEdge("observe", "think");

// Define the conditional logic after the 'think' node
// Ensure the input type is explicitly AgentState
function shouldContinueOrEnd(agentState: AgentState): "end" | "validate" {
  const shouldEnd = agentState.state.currentGoal === "Waiting for instructions" &&
                    agentState.state.lastAction?.includes("askForHelp") &&
                    !agentState.state.lastActionResult?.includes("New goal");
  
  if (shouldEnd) {
    console.log("[Graph Condition] Think -> END");
    return "end";
  } else {
    console.log("[Graph Condition] Think -> validate");
    return "validate";
  }
}

// Add conditional edges from 'think'
workflow.addConditionalEdges(
  "think", // Source node
  shouldContinueOrEnd, // Function to decide the next node
  { // Mapping of function return values to target nodes
    "end": END, // Use END directly
    "validate": "validate",
  }
);


// Validate always goes to act
workflow.addEdge("validate", "act");

// Act now goes to result analysis instead of directly to observe
workflow.addEdge("act", "resultAnalysis");

// Result analysis goes to observe to complete the loop
workflow.addEdge("resultAnalysis", "observe");

// Compile the graph
const app = workflow.compile();


// --- LangGraph Agent Loop ---
// Replace the entire body of startAgentLoop with this:
async function startAgentLoop() {
  console.log('Starting LangGraph agent loop...');
  const streamConfig: RunnableConfig = { recursionLimit: 300 }; // Config for invoke

  try {
    // --- Initial observation (remains outside the loop) ---
    console.log("--- Initial Observation ---");
    // Use the wrapper node function for consistency, passing the initial AgentState
    const initialObservationResult = await runObserveNodeWrapper({ state: currentAgentState });
    if (initialObservationResult.state) {
        currentAgentState = initialObservationResult.state; // Update shared state from the wrapper's result
        console.log("Initial State Populated:", JSON.stringify(currentAgentState, null, 2)); // Log initial state clearly
    } else {
        console.error("Failed to get initial state from observation.");
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

        // Invoke the graph with the current state wrapped in AgentState
        // The result will be the final AgentState when the graph run finishes (hits END or limit)
        const result: AgentState | undefined = await app.invoke({ state: currentAgentState }, streamConfig);

        // Update the shared state with the final result of the graph execution
        if (result && result.state) {
            currentAgentState = result.state; // Update shared state with the final state from the graph run
            console.log("=== Graph Invocation Complete ===");
            // Check if the graph ended because the goal was completed
            if (currentAgentState.currentGoal === "Waiting for instructions") {
                 console.log("Goal completed! Waiting for new instructions...");
                 // No need to chat here, the 'think' node should have handled the 'askForHelp' action
            }
            // console.log("Final State after invocation:", JSON.stringify(currentAgentState, null, 2)); // Optional detailed log
        } else {
            console.warn("[Agent Loop] Graph invocation finished with unexpected result:", result);
            // Avoid getting stuck, maybe force observation or wait
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
