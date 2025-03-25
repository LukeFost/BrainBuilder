import { State } from './types';

export class Critic {
  private lastAction: string | undefined;
  private lastActionResult: string | undefined;
  private failureCount: number = 0;
  private maxFailures: number = 2; // Allow 2 failures of the same action before suggesting replan

  evaluate(state: State): { needsReplanning: boolean; reason: string } {
    // Default response
    const defaultResponse = { needsReplanning: false, reason: '' };
    
    // If no last action or result, can't evaluate
    if (!state.lastAction || !state.lastActionResult) {
      return defaultResponse;
    }

    const lastActionResult = state.lastActionResult || '';
    const lastAction = state.lastAction || '';

    // Check if we're stuck in a loop
    if (state.memory.shortTerm.length >= 3) {
      const recentActions = state.memory.shortTerm.slice(-3).filter(entry => 
        entry.includes(`Action: ${lastAction}`));
      
      if (recentActions.length >= 3 && recentActions.every(action => 
        action.includes(lastActionResult))) {
        return {
          needsReplanning: true,
          reason: `Stuck in a loop: Same action "${lastAction}" failing with "${lastActionResult}" repeatedly`
        };
      }
    }
    
    // Check if we're repeating the same failing action
    if (state.lastAction === this.lastAction && 
        (state.lastActionResult.toLowerCase().includes('fail') || 
        state.lastActionResult.toLowerCase().includes('error') ||
        state.lastActionResult.toLowerCase().includes('not enough'))) {
      
      this.failureCount++;
      console.log(`Critic: Same action "${state.lastAction}" failed ${this.failureCount} times`);
      
      if (this.failureCount >= this.maxFailures) {
        // Reset counter after triggering replan
        this.failureCount = 0;
        return {
          needsReplanning: true,
          reason: `Same action "${state.lastAction}" failed ${this.maxFailures} times with result: "${state.lastActionResult}"`
        };
      }
    } else if (state.lastAction !== this.lastAction) {
      // Reset counter when action changes
      this.failureCount = 0;
    }
    
    // Update last action and result for next evaluation
    this.lastAction = state.lastAction;
    this.lastActionResult = state.lastActionResult;
    
    // Check for resource prerequisites not being met
    if (lastActionResult?.includes('Not enough') || 
        lastActionResult?.includes('need more') ||
        lastActionResult?.includes('Need ')) {
      return {
        needsReplanning: true,
        reason: `Resource prerequisite not met: ${lastActionResult}`
      };
    }
    
    // Check for explicit failures
    if (lastActionResult?.includes('failed') || 
        lastActionResult?.includes('could not') ||
        lastActionResult?.includes('unable to')) {
      return {
        needsReplanning: true,
        reason: `Action failed: ${lastActionResult}`
      };
    }
    
    // Check if goal was achieved
    if (state.currentGoal && state.lastActionResult && 
        state.lastActionResult.toLowerCase().includes('success') &&
        state.lastActionResult.toLowerCase().includes(state.currentGoal.toLowerCase())) {
      return {
        needsReplanning: true,
        reason: 'Goal appears to be achieved, should create new plan'
      };
    }
    
    return defaultResponse;
  }
}
