export interface State {
    memory: Memory;
    inventory: Inventory;
    surroundings: Surroundings;
    currentGoal?: string;
    currentPlan?: string[];
    lastAction?: string;
    lastActionResult?: string;
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