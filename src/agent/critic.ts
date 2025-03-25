import { State } from './types';

export class Critic {
  evaluate(state: State): { needsReplanning: boolean; reason: string } {
    // Check for repeated failures of the same action
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
    
    return { needsReplanning: false, reason: '' };
  }
}
