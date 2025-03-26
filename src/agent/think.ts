import { State } from './types';
import { Planner } from './planner';

export class ThinkManager {
  private planner: Planner;
  private lastFailedAction: string | null = null;
  private failureCount: number = 0;
  private maxFailureRetries: number = 2;

  constructor(openAIApiKey: string) {
    this.planner = new Planner(openAIApiKey);
  }

  async think(currentState: State): Promise<Partial<State>> {
    console.log("--- Running Think Manager ---");
    let needsNewPlan = false;
    let nextAction: string | undefined = undefined;
    let reason = "";

    // Check if the last action failed
    if (currentState.lastActionResult && 
        (currentState.lastActionResult.toLowerCase().includes('failed') ||
         currentState.lastActionResult.toLowerCase().includes('not enough') ||
         currentState.lastActionResult.toLowerCase().includes('not found in inventory') ||
         currentState.lastActionResult.toLowerCase().includes('cannot place'))) {
      
      // Track repeated failures of the same action
      if (currentState.lastAction === this.lastFailedAction) {
        this.failureCount++;
        console.log(`ThinkManager: Same action "${currentState.lastAction}" failed ${this.failureCount} times`);
        
        if (this.failureCount >= this.maxFailureRetries) {
          needsNewPlan = true;
          reason = `Action "${currentState.lastAction}" failed ${this.failureCount} times. Last error: ${currentState.lastActionResult}`;
          this.failureCount = 0; // Reset counter
        }
      } else {
        this.lastFailedAction = currentState.lastAction || null;
        this.failureCount = 1;
      }
    } else {
      // Reset failure tracking on success
      this.lastFailedAction = null;
      this.failureCount = 0;
    }

    // Check if we need a new plan for other reasons
    if (!needsNewPlan) {
      if (!currentState.currentPlan || currentState.currentPlan.length === 0) {
        needsNewPlan = true;
        reason = "No current plan or plan completed";
      }
    }

    if (needsNewPlan && currentState.currentGoal) {
      console.log(`ThinkManager: Creating new plan. Reason: ${reason}`);
      try {
        const planSteps = await this.planner.createPlan(currentState, currentState.currentGoal);
        
        if (planSteps.length > 0) {
          nextAction = planSteps[0];
          return { 
            currentPlan: planSteps, 
            lastAction: nextAction 
          };
        } else {
          nextAction = 'lookAround'; // Fallback
          return { lastAction: nextAction };
        }
      } catch (error) {
        console.error("ThinkManager: Error creating plan:", error);
        nextAction = 'lookAround'; // Fallback on error
        return { lastAction: nextAction };
      }
    } else {
      // Continue with existing plan
      nextAction = await this.planner.decideNextAction(currentState);
      return { lastAction: nextAction };
    }
  }
}
