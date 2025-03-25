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
    biome?: string;
  }
  
  export interface Action {
    name: string;
    description: string;
    execute: (bot: any, args: string[]) => Promise<string>;
  }
