import * as mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';

declare module 'mineflayer-pathfinder' {
  export interface Goals {
    GoalBlock: new (x: number, y: number, z: number) => Goal;
    GoalNear: new (x: number, y: number, z: number, range: number) => Goal;
    GoalXZ: new (x: number, z: number) => Goal;
    GoalY: new (y: number) => Goal;
    GoalGetToBlock: new (x: number, y: number, z: number) => Goal;
    GoalFollow: new (entity: Entity, range: number) => Goal;
    GoalInvert: new (goal: Goal) => Goal;
    GoalCompositeAny: new (goals: Goal[]) => Goal;
    GoalCompositeAll: new (goals: Goal[]) => Goal;
  }

  export interface Goal {
    isEnd: (node: any) => boolean;
    heuristic: (node: any) => number;
    hasChanged: () => boolean;
  }

  export interface Movements {
    canDig: boolean;
    allow1by1towers: boolean;
    maxDropDown: number;
    allowParkour: boolean;
    canJump: boolean;
    canJumpOut: boolean;
    blocksToAvoid: Set<number>;
    liquidsToAvoid: Set<number>;
    maxFallDrop: number;
    allowSprinting: boolean;
    scafoldingBlocks: any[];
  }

  export interface Pathfinder {
    bestHarvestTool: (block: any) => Item | null;
    getPathTo: (
      goal: Goal,
      options?: { timeout?: number; tickTimeout?: number }
    ) => Promise<Path>;
    goto: (
      goal: Goal,
      options?: { timeout?: number; tickTimeout?: number }
    ) => Promise<void>;
    setMovements: (movements: Movements) => void;
    isMoving: () => boolean;
    stop: () => void;
  }

  export interface Path {
    path: Vec3[];
    status: 'success' | 'partial' | 'timeout' | 'noPath';
    visitedNodes: number;
    generatedNodes: number;
    cost: number;
    time: number;
  }

  export const pathfinder: (bot: mineflayer.Bot) => void;
  export class Movements {
    constructor(bot: mineflayer.Bot, mcData: any);
  }

  export const goals: Goals;
}

declare module 'mineflayer' {
  interface Bot {
    pathfinder: Pathfinder;
  }
}