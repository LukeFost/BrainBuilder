import { State } from './types';
import { Planner } from './planner'; // Keep this import

export class ThinkManager {
  private planner: Planner; // Planner instance will be passed in
  private lastFailedAction: string | null = null;
  private consecutiveFailureCount: number = 0;
  private maxConsecutiveFailures: number = 2; // Replan after 2 consecutive failures of the *same* action

  constructor(planner: Planner) { // Accept Planner instance
    this.planner = planner; // Store the passed-in planner instance
  }

  async think(currentState: State): Promise<Partial<State>> {
    console.log("--- Running Think Manager ---");
    let needsReplan = false;
    let reason = "";

    // --- Start Integrated Critic Logic ---
    const lastAction = currentState.lastAction;
    const lastResult = currentState.lastActionResult?.toLowerCase() || '';

    // Condition 1: No plan exists or plan is completed
    if (!currentState.currentPlan || currentState.currentPlan.length === 0) {
      needsReplan = true;
      reason = "No current plan or plan completed.";
    }

    // Condition 2: Last action failed critically OR was unknown
    if (!needsReplan && lastResult) {
        // Add "unknown action" to keywords
        const criticalFailureKeywords = ['not enough', 'cannot place', 'not found in inventory', 'no recipe', 'need a crafting table', 'unknown action'];
        if (criticalFailureKeywords.some(keyword => lastResult.includes(keyword))) {
            needsReplan = true;
            // Update reason slightly for clarity
            reason = `Critical failure or unknown action in last step: "${currentState.lastActionResult}"`;
        }
    }

    // Optional: Reset consecutive failure counter on unknown action
    if (lastResult.includes('unknown action')) {
        this.lastFailedAction = null; // Prevent consecutive counter increment for unknown actions
        this.consecutiveFailureCount = 0;
    }

    // Condition 3: Track consecutive failures of the *same* action
    if (lastAction && lastResult.includes('fail')) { // Check for general 'fail' keyword
        if (lastAction === this.lastFailedAction) {
            this.consecutiveFailureCount++;
            console.log(`[ThinkManager] Action "${lastAction}" failed ${this.consecutiveFailureCount} consecutive times.`);
            if (this.consecutiveFailureCount >= this.maxConsecutiveFailures) {
                needsReplan = true;
                reason = `Action "${lastAction}" failed ${this.consecutiveFailureCount} times consecutively. Last error: ${currentState.lastActionResult}`;
                this.consecutiveFailureCount = 0; // Reset counter after forcing replan
            }
        } else {
            // New action failed, reset counter
            this.lastFailedAction = lastAction;
            this.consecutiveFailureCount = 1;
        }
    } else if (lastAction && !lastResult.includes('fail')) {
         // Reset failure tracking on success or non-failure result
         this.lastFailedAction = null;
         this.consecutiveFailureCount = 0;
    }
    // --- End Integrated Critic Logic ---


    // --- Decision Making ---
    let nextAction: string;
    let newPlan: string[] | undefined = undefined;

    if (needsReplan && currentState.currentGoal) {
      console.log(`[ThinkManager] Replanning needed. Reason: ${reason}`);
      try {
        newPlan = await this.planner.createPlan(currentState, currentState.currentGoal);
        if (newPlan.length > 0) {
          nextAction = newPlan[0];
          console.log(`[ThinkManager] New plan created. First action: ${nextAction}`);
        } else {
          // Fallback if planner returns empty plan
          console.warn("[ThinkManager] Planner returned empty plan. Falling back to 'askForHelp'.");
          nextAction = 'askForHelp I seem to be stuck or the planner failed. What should I do?';
          newPlan = [nextAction]; // Set plan to the fallback action
        }
      } catch (error) {
        console.error("[ThinkManager] Error during planning:", error);
        // Fallback on planning error
        nextAction = 'askForHelp I encountered an error while trying to plan. Please advise.';
        newPlan = [nextAction]; // Set plan to the fallback action
      }
      // Reset failure counter when replanning occurs
      this.lastFailedAction = null;
      this.consecutiveFailureCount = 0;

      return {
        currentPlan: newPlan,
        lastAction: nextAction
      };

    } else if (currentState.currentPlan && currentState.currentPlan.length > 0) {
      // Continue with the existing plan
      nextAction = currentState.currentPlan[0];
      console.log(`[ThinkManager] Continuing plan. Next action: ${nextAction}`);
      // Return only the next action; plan modification happens in actNode
      return { lastAction: nextAction };
    } else {
      // Should ideally be caught by replan logic, but as a final fallback:
      console.warn("[ThinkManager] No plan and replan not triggered. Falling back to 'lookAround'.");
      nextAction = 'lookAround';
      return { lastAction: nextAction, currentPlan: [nextAction] }; // Provide a minimal plan
    }
  }
}
