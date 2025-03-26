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

    // Check if we're stuck in a loop - more aggressive detection
    if (state.memory.shortTerm.length >= 2) { // Reduced from 3 to 2 for faster detection
      const recentActions = state.memory.shortTerm.slice(-2).filter(entry => 
        entry.includes(`Action: ${lastAction}`));
      
      if (recentActions.length >= 2) {
        // Check if the results are similar (not necessarily identical)
        const similarResults = recentActions.every(action => {
          const resultPart = action.split('Result:')[1]?.trim() || '';
          return resultPart.includes('not found in inventory') || 
                 resultPart.includes('Not enough') ||
                 resultPart.includes('Cannot place') ||
                 resultPart.includes('Failed to');
        });
        
        if (similarResults) {
          return {
            needsReplanning: true,
            reason: `Stuck in a loop: Similar failures for action "${lastAction}" detected`
          };
        }
      }
    }
    
    // Check if we're repeating the same failing action - more aggressive detection
    if (state.lastAction === this.lastAction && 
        (state.lastActionResult.toLowerCase().includes('fail') || 
         state.lastActionResult.toLowerCase().includes('error') ||
         state.lastActionResult.toLowerCase().includes('not enough') ||
         state.lastActionResult.toLowerCase().includes('not found in inventory') ||
         state.lastActionResult.toLowerCase().includes('cannot place'))) {
      
      this.failureCount++;
      console.log(`Critic: Same action "${state.lastAction}" failed ${this.failureCount} times`);
      
      // Reduced threshold from 2 to 1 - immediately replan on repeated failure
      if (this.failureCount >= 1) {
        // Reset counter after triggering replan
        this.failureCount = 0;
        return {
          needsReplanning: true,
          reason: `Action "${state.lastAction}" failed with result: "${state.lastActionResult}"`
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
