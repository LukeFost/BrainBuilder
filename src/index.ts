// Standard Node.js imports
// (None used directly here, but can be added as needed)

// External Libraries
import * as mineflayer from 'mineflayer';
import * as dotenv from 'dotenv';
import * as mcDataModule from 'minecraft-data';
import * as pathfinder from 'mineflayer-pathfinder';

// Local Modules & Types
import { State } from './agent/types';
import { MemoryManager } from './agent/memory';
import { ThinkManager } from './agent/think';
import { ObserveManager } from './agent/observe';
import { actions } from './agent/actions/index';
import { StateGraph, END } from './utils/langgraph-shim';

// --- Constants ---
const DEFAULT_GOAL = 'Collect wood and build a small shelter';
const RECURSION_LIMIT = 150; // Max steps before the graph stops itself
const LOG_PREFIX = {
  CHAT: '[Chat]',
  OBSERVE: '[ObserveNode]',
  THINK: '[ThinkNode]',
  ACT: '[ActNode]',
  SYSTEM: '[System]'
};

// --- Utility Functions ---

/**
 * Resolves the minecraft-data module regardless of how it's exported
 */
const getMcData = (version: string) => {
  try {
    // Use dynamic import to avoid TypeScript treating it as a type
    const mcData = require('minecraft-data');
    return mcData(version);
  } catch (error: any) {
    console.error(`${LOG_PREFIX.SYSTEM} Critical failure loading minecraft-data for version ${version}:`, error);
    throw new Error(`Unable to initialize minecraft-data for version ${version}: ${error.message}`);
  }
};

/**
 * Safely sends a chat message, handling potential errors
 */
const safeChatSend = (message: string): void => {
  try {
    bot.chat(message);
  } catch (error: any) {
    console.error(`${LOG_PREFIX.SYSTEM} Failed to send chat message:`, error.message || error);
  }
};

/**
 * Initializes the pathfinder plugin
 * @returns Whether initialization was successful
 */
const initializePathfinder = (): boolean => {
  try {
    bot.loadPlugin(pathfinder.pathfinder);
    const mcDataInstance = getMcData(bot.version);
    const defaultMove = new pathfinder.Movements(bot, mcDataInstance);
    defaultMove.allowSprinting = true;
    defaultMove.canDig = true;
    bot.pathfinder.setMovements(defaultMove);
    console.log(`${LOG_PREFIX.SYSTEM} Pathfinder initialized successfully.`);
    return true;
  } catch (error: any) {
    console.error(`${LOG_PREFIX.SYSTEM} CRITICAL: Error initializing pathfinder plugin:`, error.message || error);
    console.error(`${LOG_PREFIX.SYSTEM} Movement capabilities will be severely limited or non-functional.`);
    return false;
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
    // Use require directly to avoid TypeScript treating mcDataModule as a type
    const mcData = require('minecraft-data');
    const mcDataInstance = mcData(bot.version);
    const defaultMove = new pathfinder.Movements(bot, mcDataInstance);
    defaultMove.allowSprinting = true;
    defaultMove.canDig = true;
    bot.pathfinder.setMovements(defaultMove);
    console.log('Pathfinder initialized successfully.');
    pathfinderInitialized = true;
  } catch (error: any) {
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

// --- Command Handlers ---

/**
 * Handles the 'goal' command
 */
const handleGoalCommand = (username: string, args: string[]): void => {
  const newGoal = args.join(' ').trim();
  if (newGoal) {
    agentConfig.currentGoal = newGoal;
    agentConfig.currentPlan = undefined;
    safeChatSend(`Okay, new goal set: ${newGoal}`);
    memoryManager.addToShortTerm(`Player ${username} set a new goal: ${newGoal}`);
    console.log(`${LOG_PREFIX.CHAT} Agent goal updated by ${username}: ${newGoal}`);
  } else {
    safeChatSend("Please provide a goal description after 'goal ' (e.g., 'goal build a house').");
  }
};

/**
 * Handles the 'status' command
 */
const handleStatusCommand = (): void => {
  const status = `Goal: ${agentConfig.currentGoal || 'None'} | Plan Step: ${agentConfig.currentPlan?.[0] || 'N/A'} | Last Action: ${agentConfig.lastAction || 'None'} | Last Result: ${agentConfig.lastActionResult || 'None'}`;
  safeChatSend(status);
  console.log(`${LOG_PREFIX.CHAT} Sending status.`);
};

/**
 * Handles the 'memory' command
 */
const handleMemoryCommand = (): void => {
  safeChatSend(`Short-term memory (last 5): ${memoryManager.shortTerm.slice(-5).join(' | ')}`);
  safeChatSend(`Long-term memory summary is tracked internally.`);
};

/**
 * Handles the 'inventory' command
 */
const handleInventoryCommand = (): void => {
  const items = Object.entries(agentConfig.inventory.items)
    .filter(([, count]) => count > 0)
    .map(([item, count]) => `${item}: ${count}`)
    .join(', ');
  safeChatSend(`Inventory (from state): ${items || 'Empty'}`);
};

/**
 * Handles the 'help' command
 */
const handleHelpCommand = (): void => {
  safeChatSend(`Available commands: goal <text>, status, memory, inventory, help, explore`);
};

/**
 * Handles the 'explore' command
 */
const handleExploreCommand = (username: string): void => {
  agentConfig.currentGoal = 'Explore the surroundings and gather information';
  agentConfig.currentPlan = undefined;
  safeChatSend('Okay, switching to exploration mode.');
  memoryManager.addToShortTerm(`Player ${username} requested exploration mode`);
  console.log(`${LOG_PREFIX.CHAT} Agent goal updated by ${username}: Explore`);
};

/**
 * Handles incoming chat messages and commands
 */
const handleChatMessage = (username: string, message: string): void => {
  // Ignore messages from the bot itself
  if (username === bot.username) return;

  console.log(`${LOG_PREFIX.CHAT} Received message from ${username}: "${message}"`);

  // Parse command and arguments
  const parts = message.trim().split(' ');
  const cmdBase = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  // Handle different commands
  switch (cmdBase) {
    case 'goal':
      handleGoalCommand(username, args);
      break;
    case 'status':
      handleStatusCommand();
      break;
    case 'memory':
      handleMemoryCommand();
      break;
    case 'inventory':
      handleInventoryCommand();
      break;
    case 'help':
      handleHelpCommand();
      break;
    case 'explore':
      handleExploreCommand(username);
      break;
    default:
      // No command or unrecognized command - do nothing
      break;
  }
};

/**
 * Handles the bot's initial spawn
 */
const handleSpawn = async (): Promise<void> => {
  console.log(`${LOG_PREFIX.SYSTEM} Bot '${bot.username}' spawned successfully.`);
  console.log(`${LOG_PREFIX.SYSTEM} MemoryManager created/loaded.`);

  const pathfinderInitialized = initializePathfinder();

  if (pathfinderInitialized) {
    startAgentLoop();
  } else {
    console.error(`${LOG_PREFIX.SYSTEM} Agent loop NOT started due to pathfinder initialization failure.`);
    safeChatSend("Error: My movement system (Pathfinder) failed to load. I cannot move effectively.");
  }
};

/**
 * Sets up all bot event handlers
 */
const setupEventHandlers = (): void => {
  bot.once('spawn', handleSpawn);
  bot.on('chat', handleChatMessage);
  bot.on('kicked', (reason) => console.warn(`${LOG_PREFIX.SYSTEM} Bot was kicked from server:`, reason));
  bot.on('error', (err) => console.error(`${LOG_PREFIX.SYSTEM} Bot encountered a runtime error:`, err));
  bot.on('end', (reason) => console.log(`${LOG_PREFIX.SYSTEM} Bot disconnected:`, reason));
};


// --- Graph Nodes ---

/**
 * Observe Node: Gathers information and merges the current goal from global state.
 */
const observeNode = async (currentState: GraphState): Promise<Partial<GraphState>> => {
  console.log(`${LOG_PREFIX.OBSERVE} Running observation...`);

  try {
    // Get observations from the manager
    const observationResult = await observeManager.observe(currentState);

    // Merge observations, fresh memory, and the current goal from agentConfig
    return {
      ...observationResult,
      memory: memoryManager.fullMemory,
      currentGoal: agentConfig.currentGoal
    };
  } catch (error: any) {
    console.error(`${LOG_PREFIX.OBSERVE} Error during observation:`, error.message || error);
    return {
      memory: memoryManager.fullMemory,
      currentGoal: agentConfig.currentGoal,
      lastActionResult: `Observation failed: ${error.message || error}`
    };
  }
};


/**
 * Think Node: Uses the ThinkManager to decide the next action or replan.
 */
const thinkNode = async (currentState: GraphState): Promise<Partial<GraphState>> => {
  console.log(`${LOG_PREFIX.THINK} Determining next action...`);
  
  try {
    const thinkResult = await thinkManager.think(currentState);

    // Update agentConfig for status reporting consistency
    if (thinkResult.lastAction) agentConfig.lastAction = thinkResult.lastAction;
    if (thinkResult.currentPlan !== undefined) agentConfig.currentPlan = thinkResult.currentPlan;

    return thinkResult;
  } catch (error: any) {
    console.error(`${LOG_PREFIX.THINK} Error during thinking process:`, error.message || error);
    const fallbackAction = 'askForHelp An internal error occurred during thinking.';
    agentConfig.lastAction = fallbackAction;
    agentConfig.currentPlan = [fallbackAction];
    return { lastAction: fallbackAction, currentPlan: [fallbackAction] };
  }
};


/**
 * Determines if the plan should advance based on action success and matching
 */
const shouldAdvancePlan = (
  executionSuccess: boolean, 
  currentPlan: string[] | undefined, 
  actionToPerform: string
): boolean => {
  if (!executionSuccess || !currentPlan || currentPlan.length === 0) {
    return false;
  }
  
  // Clean the current plan step for comparison
  const currentPlanStepClean = currentPlan[0].replace(/^\d+\.\s*/, '').trim();
  
  // Check if action matches plan step
  if (actionToPerform === currentPlanStepClean) {
    console.log(`${LOG_PREFIX.ACT} Completed plan step: "${currentPlan[0]}"`);
    return true;
  } else {
    console.warn(`${LOG_PREFIX.ACT} Executed action "${actionToPerform}" succeeded but did not match planned step "${currentPlanStepClean}".`);
    return false;
  }
};

/**
 * Act Node: Executes the action decided by the 'think' node.
 */
const actNode = async (currentState: GraphState): Promise<Partial<GraphState>> => {
  console.log(`${LOG_PREFIX.ACT} Executing action...`);
  
  const actionToPerform = currentState.lastAction;

  if (!actionToPerform) {
    console.log(`${LOG_PREFIX.ACT} No action decided. Skipping act node.`);
    const result = "No action to perform";
    agentConfig.lastActionResult = result;
    return { lastActionResult: result };
  }

  // Parse action and arguments
  const parts = actionToPerform.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const actionName = parts[0];
  const actionArgs = parts.slice(1).map(arg => arg.replace(/^"|"$/g, ''));

  let result: string;
  let executionSuccess = false;

  // Execute the action
  if (actionName && actions[actionName]) {
    try {
      console.log(`${LOG_PREFIX.ACT} Executing: ${actionName} with args: [${actionArgs.join(', ')}]`);
      result = await actions[actionName].execute(bot, actionArgs, currentState);
      
      // Check for success based on result text
      const failureKeywords = ['fail', 'error', 'cannot', 'not found', 'invalid', 'unable', 'no '];
      executionSuccess = !failureKeywords.some(keyword => result.toLowerCase().includes(keyword));
      
      console.log(`${LOG_PREFIX.ACT} Result: ${result} (Success: ${executionSuccess})`);
    } catch (error: any) {
      result = `Failed to execute ${actionName}: ${error.message || error}`;
      console.error(`${LOG_PREFIX.ACT} ${result}`);
      executionSuccess = false;
    }
  } else {
    result = `Unknown or invalid action: ${actionName}`;
    console.error(`${LOG_PREFIX.ACT} ${result}`);
    executionSuccess = false;
  }

  // Update memory
  await memoryManager.addToShortTerm(`Action: ${actionToPerform} -> Result: ${result}`);

  // Update plan if needed
  let updatedPlan = currentState.currentPlan;
  if (shouldAdvancePlan(executionSuccess, currentState.currentPlan, actionToPerform)) {
    updatedPlan = currentState.currentPlan!.slice(1);
  }

  // Update agentConfig for status reporting
  agentConfig.lastActionResult = result;
  agentConfig.currentPlan = updatedPlan;

  return {
    lastActionResult: result,
    currentPlan: updatedPlan,
    memory: memoryManager.fullMemory
  };
};


/**
 * Creates the workflow graph for the agent
 */
const createWorkflowGraph = (): StateGraph<GraphState> => {
  const workflow = new StateGraph<GraphState>({
    channels: {
      memory: { value: null },
      inventory: { value: null },
      surroundings: { value: null },
      currentGoal: { value: null },
      currentPlan: { value: null },
      lastAction: { value: null },
      lastActionResult: { value: null },
    }
  });

  // Add nodes
  workflow.addNode("observe", observeNode);
  workflow.addNode("think", thinkNode);
  workflow.addNode("act", actNode);

  // Define edges
  workflow.setEntryPoint("observe");
  workflow.addEdge("observe", "think");
  workflow.addEdge("think", "act");
  workflow.addEdge("act", "observe");

  return workflow;
};


/**
 * Prepares the initial state for the agent loop
 */
const getInitialState = async (): Promise<GraphState> => {
  // Create minimal initial state
  const initialObservationState: Partial<GraphState> = {
    memory: agentConfig.memory,
    inventory: agentConfig.inventory,
    surroundings: agentConfig.surroundings,
    currentGoal: agentConfig.currentGoal
  };
  
  // Get initial sensor data
  const initialSensorData = await observeManager.observe(initialObservationState as GraphState);

  // Update agentConfig with initial observations
  agentConfig.inventory = initialSensorData.inventory ?? agentConfig.inventory;
  agentConfig.surroundings = initialSensorData.surroundings ?? agentConfig.surroundings;

  // Create complete initial state
  return {
    ...agentConfig,
    ...initialSensorData,
    memory: memoryManager.fullMemory
  };
};

/**
 * Logs the completion of a node in the graph
 */
const logNodeCompletion = (nodeName: string, nodeOutput: any): void => {
  console.log(`--- Finished Node: ${nodeName} ---`);
  
  // Log only relevant information based on node type
  if (nodeName === 'act' && nodeOutput.lastActionResult) {
    console.log(`Result: ${nodeOutput.lastActionResult}`);
  } else if (nodeName === 'think' && nodeOutput.lastAction) {
    console.log(`Next Action: ${nodeOutput.lastAction}`);
  }
  
  console.log('---------------------');
};

/**
 * Handles errors in the agent loop
 */
const handleAgentLoopError = (error: any): void => {
  console.error(`${LOG_PREFIX.SYSTEM} FATAL: Error running LangGraph agent loop:`, error.message || error);
  
  if (error.stack) {
    console.error("Stack Trace:", error.stack);
  }
  
  safeChatSend("A critical error occurred in my main loop. Please check the console log for details.");
};

/**
 * Starts the main agent loop using LangGraph
 */
const startAgentLoop = async (): Promise<void> => {
  console.log(`${LOG_PREFIX.SYSTEM} Starting agent loop using LangGraph...`);

  try {
    // Get initial observations
    const initialState = await getInitialState();
    console.log(`${LOG_PREFIX.SYSTEM} Initial state prepared.`);

    // Create and run the graph
    const workflow = createWorkflowGraph();
    const app = workflow.compile();
    
    // Stream the graph execution
    const stream = app.stream(initialState, { recursionLimit: RECURSION_LIMIT });

    // Process each step
    for await (const step of stream) {
      const nodeName = Object.keys(step)[0];
      const nodeOutput = step[nodeName];

      logNodeCompletion(nodeName, nodeOutput);
    }

    console.log(`${LOG_PREFIX.SYSTEM} Agent loop finished (reached recursion limit ${RECURSION_LIMIT} or END node).`);
  } catch (error: any) {
    handleAgentLoopError(error);
  }
};

// --- Initialize Core Components ---
dotenv.config();
const bot = mineflayer.createBot({
  host: process.env.MINECRAFT_HOST || 'localhost',
  port: parseInt(process.env.MINECRAFT_PORT || '25565'),
  username: process.env.BOT_USERNAME || 'AIBot',
  version: process.env.MINECRAFT_VERSION || '1.21.1',
  auth: (process.env.MINECRAFT_AUTH || 'offline') as mineflayer.Auth
});

// Initialize core agent components
const memoryManager = new MemoryManager(undefined, 10, process.env.OPENAI_API_KEY);
const thinkManager = new ThinkManager(process.env.OPENAI_API_KEY || '');
const observeManager = new ObserveManager(bot);

// Define the agent configuration and state tracking object
const agentConfig: State = {
  memory: memoryManager.fullMemory,
  inventory: { items: {} },
  surroundings: {
    nearbyBlocks: [],
    nearbyEntities: [],
    position: { x: 0, y: 0, z: 0 }
  },
  currentGoal: DEFAULT_GOAL
};

// Set up event handlers
setupEventHandlers();

// The bot.once('spawn', ...) handler will call startAgentLoop()
