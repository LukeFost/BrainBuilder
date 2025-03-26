import { State } from './types';

export class ResultAnalysisManager {
  private failurePatterns: Record<string, number> = {}; // Track failure patterns
  private maxFailureCount = 3; // Max failures before adaptation
  private lastActionResult: string | null = null;

  constructor() {}

  async analyze(currentState: State): Promise<Partial<State>> {
    console.log("--- Running Result Analysis ---");
    
    if (!currentState.lastAction || !currentState.lastActionResult) {
      console.log("[ResultAnalysisManager] No action or result to analyze");
      return currentState;
    }

    const action = currentState.lastAction;
    const result = currentState.lastActionResult;
    
    // Store the last result for comparison
    this.lastActionResult = result;
    
    // Check if the action succeeded
    const isSuccess = this.isActionSuccessful(action, result);
    
    if (!isSuccess) {
      // Track failure patterns
      const failureKey = this.getFailureKey(action, result);
      this.failurePatterns[failureKey] = (this.failurePatterns[failureKey] || 0) + 1;
      
      console.log(`[ResultAnalysisManager] Action "${action}" failed. Pattern "${failureKey}" count: ${this.failurePatterns[failureKey]}`);
      
      // If we've seen this failure too many times, adapt the plan
      if (this.failurePatterns[failureKey] >= this.maxFailureCount) {
        console.log(`[ResultAnalysisManager] Detected repeated failure pattern "${failureKey}". Adapting plan.`);
        return this.adaptPlan(currentState, failureKey);
      }
    } else {
      // Reset failure patterns for successful actions
      const actionType = action.split(' ')[0];
      Object.keys(this.failurePatterns).forEach(key => {
        if (key.startsWith(actionType)) {
          delete this.failurePatterns[key];
        }
      });
    }
    
    return currentState;
  }
  
  /**
   * Determines if an action was successful based on the result
   */
  private isActionSuccessful(action: string, result: string): boolean {
    // Check for common failure indicators in the result
    const failureIndicators = [
      'fail', 'error', 'cannot', 'unable', 'not found', 
      'no recipe', 'unknown action', 'not enough'
    ];
    
    return !failureIndicators.some(indicator => 
      result.toLowerCase().includes(indicator)
    );
  }
  
  /**
   * Creates a key to track failure patterns
   */
  private getFailureKey(action: string, result: string): string {
    // Extract the action type (first word)
    const actionType = action.split(' ')[0];
    
    // Extract a failure reason
    let failureReason = 'unknown';
    
    if (result.includes('not found')) failureReason = 'not_found';
    else if (result.includes('not enough')) failureReason = 'insufficient_resources';
    else if (result.includes('no recipe')) failureReason = 'no_recipe';
    else if (result.includes('unknown action')) failureReason = 'unknown_action';
    else if (result.includes('too far')) failureReason = 'too_far';
    else if (result.includes('```')) failureReason = 'markdown_error';
    
    return `${actionType}:${failureReason}`;
  }
  
  /**
   * Adapts the plan based on failure patterns
   */
  private adaptPlan(state: State, failureKey: string): Partial<State> {
    const [actionType, failureReason] = failureKey.split(':');
    
    // If we don't have a plan, there's nothing to adapt
    if (!state.currentPlan || state.currentPlan.length === 0) {
      console.log(`[ResultAnalysisManager] No plan to adapt. Requesting help.`);
      return {
        lastAction: `askForHelp I'm having trouble with ${actionType} (${failureReason}). What should I do instead?`,
        currentPlan: [`askForHelp I'm having trouble with ${actionType} (${failureReason}). What should I do instead?`]
      };
    }
    
    // Get the current plan
    const currentPlan = [...state.currentPlan];
    
    // Different adaptation strategies based on failure type
    switch (failureReason) {
      case 'markdown_error':
        // For markdown errors, try to clean up the action and retry
        console.log(`[ResultAnalysisManager] Adapting plan for markdown error in ${actionType}`);
        // The validate node should handle this, but as a backup:
        const cleanedAction = state.lastAction?.replace(/```[a-z]*\n/g, '').replace(/```/g, '').trim();
        return {
          lastAction: cleanedAction,
          lastActionResult: `Retrying with cleaned action: ${cleanedAction}`
        };
        
      case 'insufficient_resources':
        // For resource issues, try to collect the needed resources
        console.log(`[ResultAnalysisManager] Adapting plan for insufficient resources in ${actionType}`);
        // Try to extract what resource is needed from the result
        const resourceMatch = state.lastActionResult?.match(/need (\d+) ([a-z_]+)/i);
        if (resourceMatch) {
          const count = resourceMatch[1];
          const resource = resourceMatch[2];
          
          // Add resource collection to the beginning of the plan
          const newPlan = [`collectBlock ${resource} ${count}`, ...currentPlan];
          return {
            currentPlan: newPlan,
            lastAction: `collectBlock ${resource} ${count}`,
            lastActionResult: `Adapting plan to collect needed resource: ${count} ${resource}`
          };
        }
        break;
        
      case 'not_found':
      case 'too_far':
        // For not found or too far issues, try exploring or moving
        console.log(`[ResultAnalysisManager] Adapting plan for ${failureReason} in ${actionType}`);
        // Look around and then try a different location
        const newPlan = ['lookAround', ...currentPlan];
        return {
          currentPlan: newPlan,
          lastAction: 'lookAround',
          lastActionResult: `Adapting plan to look around and find ${actionType} target`
        };
        
      case 'unknown_action':
        // For unknown actions, skip and move to the next step
        console.log(`[ResultAnalysisManager] Skipping unknown action ${state.lastAction}`);
        if (currentPlan.length > 0) {
          // Skip to the next action in the plan
          const nextAction = currentPlan[0];
          const remainingPlan = currentPlan.slice(1);
          return {
            currentPlan: remainingPlan,
            lastAction: nextAction,
            lastActionResult: `Skipping problematic action and moving to next step: ${nextAction}`
          };
        }
        break;
        
      default:
        // For other issues, try a general recovery strategy
        console.log(`[ResultAnalysisManager] General recovery for ${failureReason} in ${actionType}`);
        // Reset the failure counter for this pattern
        this.failurePatterns[failureKey] = 0;
        
        // If we have more steps in the plan, try the next one
        if (currentPlan.length > 0) {
          const nextAction = currentPlan[0];
          const remainingPlan = currentPlan.slice(1);
          return {
            currentPlan: remainingPlan,
            lastAction: nextAction,
            lastActionResult: `Skipping problematic action and moving to next step: ${nextAction}`
          };
        }
    }
    
    // If no specific adaptation worked, ask for help
    return {
      lastAction: `askForHelp I'm having trouble with ${actionType} (${failureReason}). What should I do instead?`,
      currentPlan: [`askForHelp I'm having trouble with ${actionType} (${failureReason}). What should I do instead?`]
    };
  }
}
