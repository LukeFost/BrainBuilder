// --- New Memory Structure Types ---

export interface RecentActionEntry {
  timestamp: number;
  action: string;
  result: string;
}

export interface LocationEntry {
  name: string;
  coordinates: { x: number; y: number; z: number };
  description?: string;
  timestamp: number;
}

export interface RecipeKnowledgeEntry {
  itemName: string;
  recipeId?: number; // Or store ingredients/shape if needed
  source: 'learned' | 'used';
  timestamp: number;
}

export interface EntityEncounterEntry {
  entityType: string;
  location: { x: number; y: number; z: number };
  outcome: 'attacked' | 'avoided' | 'observed' | 'traded';
  timestamp: number;
}

export interface CompletedGoalEntry {
  goal: string;
  timestamp: number;
  stepsTaken?: number; // Optional: track complexity
}

export interface FailurePatternEntry {
  action: string;
  reason: string; // Extracted reason (e.g., 'not_found', 'insufficient_resources')
  count: number;
  lastTimestamp: number;
}

export interface ShortTermMemory {
  recentActions: RecentActionEntry[]; // Replaces the simple string array
  currentGoalState?: any; // Placeholder for current goal state object
  tacticalObservations?: any[]; // Placeholder for tactical observations
}

export interface KnowledgeBase {
  locations: Record<string, LocationEntry>; // Use name as key
  recipeKnowledge: Record<string, RecipeKnowledgeEntry>; // Use itemName as key
  entityEncounters: EntityEncounterEntry[];
  completedGoals: CompletedGoalEntry[];
  failurePatterns: Record<string, FailurePatternEntry>; // Use action:reason as key
}

export interface LongTermMemory {
  knowledgeBase: KnowledgeBase;
  // MemoryIndexer placeholder - not implemented yet
}

export interface StructuredMemory {
  shortTerm: ShortTermMemory;
  longTerm: LongTermMemory;
}

// --- Update State Interface ---

export interface State {
    memory: StructuredMemory; // Use the new structured memory type
    inventory: Inventory;
    surroundings: Surroundings;
    currentGoal?: string;
    currentPlan?: string[];
    lastAction?: string;
    lastActionResult?: string;
    next?: string;
}

// --- Keep Inventory, Surroundings, Action interfaces as they are ---
export interface Inventory {
    items: Record<string, number>;
  }
  
  export interface Surroundings {
    nearbyBlocks: string[];
    nearbyEntities: string[];
    position: { x: number; y: number; z: number };
    dayTime?: string;
    timeDescription?: string; // Add human-readable time description
    biome?: string;
    health?: number; // Add health
    food?: number;   // Add food/hunger
    isSleeping?: boolean; // Track if bot is sleeping
  }

  // Import necessary types (adjust path if needed)
  import { IndexedData } from 'minecraft-data';
  import { Bot } from 'mineflayer'; // Use specific Bot type

  export interface Action {
    name: string;
    description: string;
    // Update execute signature to include Bot, mcData, args, and State
    execute: (bot: Bot, mcData: IndexedData, args: string[], currentState: State) => Promise<string>;
  }

  // ... rest of the file remains the same
