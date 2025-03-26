export interface State {
    memory: Memory;
    inventory: Inventory;
    surroundings: Surroundings;
    currentGoal?: string;
    currentPlan?: string[];
    lastAction?: string; // The action decided by the 'think' node
    lastActionResult?: string; // The result of the 'act' node
    next?: string; // Helper for conditional edges in the graph
  }
  export interface Memory {
    shortTerm: string[];
    longTerm: string;
  }
  
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
