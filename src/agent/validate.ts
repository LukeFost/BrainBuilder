import { State } from './types';
import { actions } from './actions/index';

export class ValidateManager {
  constructor() {}

  async validate(currentState: State): Promise<Partial<State>> {
    console.log("--- Running Validate Node ---");
    
    if (!currentState.lastAction) {
      console.log("[ValidateManager] No action to validate");
      return { lastActionResult: "No action to validate" };
    }

    // Strip markdown formatting
    let cleanAction = this.stripMarkdown(currentState.lastAction);
    
    // Parse the action and arguments
    const parts = cleanAction.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const actionName = parts[0];
    
    // Check if the action exists
    if (!actionName || !actions[actionName]) {
      console.error(`[ValidateManager] Invalid action: ${actionName}`);
      return { 
        lastAction: "askForHelp",
        lastActionResult: `Unknown action: ${actionName}. Please try a different approach.`
      };
    }
    
    // If action is valid, update the lastAction with the cleaned version
    console.log(`[ValidateManager] Validated action: ${cleanAction}`);
    return { lastAction: cleanAction };
  }
  
  /**
   * Strips markdown formatting from the action string
   */
  private stripMarkdown(action: string): string {
    // Remove code block markers
    let cleaned = action.replace(/```[a-z]*\n/g, '').replace(/```/g, '');
    
    // Remove leading numbers and dots (from numbered lists)
    cleaned = cleaned.replace(/^\d+\.\s*/, '');
    
    // Trim whitespace
    cleaned = cleaned.trim();
    
    return cleaned;
  }
}
