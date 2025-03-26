import { State } from './types';
import { Planner } from './planner'; // Keep this import

export class ThinkManager {
  private planner: Planner; // Planner instance will be passed in
  private lastFailedAction: string | null = null;
  private consecutiveFailureCount: number = 0;
  private maxConsecutiveFailures: number = 2; // Replan after 2 consecutive failures of the *same* action

  // --- New properties for loop detection ---
  private actionHistory: { action: string; result: string; timestamp: number }[] = [];
  private readonly maxHistorySize = 20; // How many recent actions to store for pattern matching
  private readonly loopDetectionThreshold = 3; // How many repetitions trigger a breakout
  private readonly loopPatternLength = 3; // Minimum length of a repeating pattern (e.g., A->B->C repeats)
  private lastBreakoutAction: string | null = null; // Prevent immediate re-breakout
  // --- End new properties ---

  constructor(planner: Planner) { // Accept Planner instance
    this.planner = planner; // Store the passed-in planner instance
  }

  async think(currentState: State): Promise<Partial<State>> {
    console.log("--- Running Think Manager ---");

    // --- Add executed action to history (if available) ---
    if (currentState.lastAction && currentState.lastActionResult) {
        this.actionHistory.push({
            action: currentState.lastAction,
            result: currentState.lastActionResult,
            timestamp: Date.now()
        });
        // Keep history size limited
        if (this.actionHistory.length > this.maxHistorySize) {
            this.actionHistory.shift(); // Remove oldest entry
        }
    }
    // --- End history update ---

    
    // Check if goal is already completed before doing anything else
    if (this.isGoalCompleted(currentState)) {
      console.log("[ThinkManager] Goal already completed!");
      return { 
        lastAction: "askForHelp The goal has been achieved! What would you like me to do next?",
        currentPlan: undefined,
        currentGoal: "Waiting for instructions" // Set the goal to waiting state
      };
    }
    
    // Special handling for "Waiting for instructions" state
    if (currentState.currentGoal === 'Waiting for instructions') {
      // If we've already asked for help multiple times, do something more interesting
      const recentActions = currentState.memory.shortTerm.recentActions; // Get the array of action entries
      const askForHelpCount = recentActions.filter(entry => // Filter based on the 'action' property
        entry.action.includes('askForHelp') &&
        (entry.action.includes('What would you like me to do next?') ||
         entry.action.includes('goal has been achieved'))
      ).length;
      
      if (askForHelpCount >= 2) {
        // Do something more interesting - explore the world
        console.log("[ThinkManager] Breaking help request loop with exploration");
        
        // Generate a random position to explore
        const currentPos = currentState.surroundings.position;
        const randomOffset = Math.floor(Math.random() * 10) - 5; // -5 to +5
        const newX = Math.floor(currentPos.x) + randomOffset;
        const newZ = Math.floor(currentPos.z) + randomOffset;
        const newY = Math.floor(currentPos.y); // Keep same Y level for safety
        
        return {
          lastAction: `moveToPosition ${newX} ${newY} ${newZ}`,
          currentPlan: [`moveToPosition ${newX} ${newY} ${newZ}`, "lookAround"],
          next: "explore" // Add a 'next' property to help with graph control flow
        };
      } else {
        // Ask for help, but only once or twice
        return {
          lastAction: "askForHelp What would you like me to do next?",
          currentPlan: ["askForHelp What would you like me to do next?"],
          next: "wait" // Add a 'next' property to help with graph control flow
        };
      }
    }
    
    // Check if it's night time and we should sleep
    if (this.shouldSleep(currentState)) {
      console.log("[ThinkManager] It's night time. Should try to sleep.");
      return {
        lastAction: "sleep",
        currentPlan: ["sleep"]
      };
    }
    
    // Check if we're sleeping and it's day time (time to wake up)
    if (this.shouldWakeUp(currentState)) {
      console.log("[ThinkManager] It's day time. Should wake up.");
      return {
        lastAction: "wakeUp",
        currentPlan: ["wakeUp"]
      };
    }

    // --- Loop Detection ---
    const loopDetected = this.detectLoop();
    if (loopDetected && currentState.lastAction !== this.lastBreakoutAction) {
        console.warn(`[ThinkManager] Loop detected! Triggering breakout strategy.`);
        const breakoutAction = this.getBreakoutAction(currentState);
        this.lastBreakoutAction = breakoutAction; // Record the breakout action
        // Clear history partially to prevent immediate re-detection after breakout
        this.actionHistory = this.actionHistory.slice(-Math.floor(this.maxHistorySize / 2));
        return {
            lastAction: breakoutAction,
            currentPlan: [breakoutAction], // Set plan to just the breakout action
            lastActionResult: "Attempting loop breakout strategy." // Add context
        };
    } else if (loopDetected && currentState.lastAction === this.lastBreakoutAction) {
        console.log("[ThinkManager] Loop detected, but last action was already a breakout. Proceeding normally.");
    }
    // Reset breakout tracker if no loop detected or if last action wasn't a breakout
    if (!loopDetected || currentState.lastAction !== this.lastBreakoutAction) {
         this.lastBreakoutAction = null;
    }
    // --- End Loop Detection ---


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
  
  /**
   * Determines if the current goal has been completed based on inventory and other state
   */
  private isGoalCompleted(state: State): boolean {
    // Parse the current goal
    const goal = state.currentGoal || '';
    
    // If we're already in "Waiting for instructions" state, don't treat it as completed
    if (goal === 'Waiting for instructions') {
      return false;
    }
    
    // Check for "Collect X oak_log and craft a crafting_table" pattern
    if (goal.match(/collect\s+(\d+)\s+oak_log\s+and\s+craft\s+a\s+crafting_table/i)) {
      const match = goal.match(/collect\s+(\d+)\s+oak_log/i);
      const requiredLogs = match ? parseInt(match[1]) : 0;
      
      // Check if we have enough logs and at least one crafting table
      const hasEnoughLogs = (state.inventory.items['oak_log'] || 0) >= requiredLogs;
      const hasCraftingTable = (state.inventory.items['crafting_table'] || 0) >= 1;
      
      if (hasEnoughLogs && hasCraftingTable) {
        console.log(`[ThinkManager] Goal completed! Has ${state.inventory.items['oak_log'] || 0}/${requiredLogs} oak_log and ${state.inventory.items['crafting_table'] || 0} crafting_table`);
        return true;
      }
      return false;
    }
    
    // Check for sleep-related goals
    if (goal.toLowerCase().includes('sleep') || goal.toLowerCase().includes('rest')) {
      // If the goal was to sleep and we've slept, consider it complete
      if (state.lastAction?.includes('sleep') && 
          state.lastActionResult?.toLowerCase().includes('sleeping')) {
        console.log(`[ThinkManager] Sleep goal completed!`);
        return true;
      }
    }
    
    // Add more goal completion checks for other common goals
    if (goal.toLowerCase().includes('explore')) {
      // For exploration goals, we can consider them completed after a certain number of actions
      // or after visiting a certain number of unique locations
      const actionCount = state.memory.shortTerm.recentActions.length; // Count entries in recentActions
      if (actionCount >= 10) { // Check total number of recent actions recorded
        console.log(`[ThinkManager] Exploration goal considered complete after ${actionCount} recent actions recorded`);
        return true;
      }
    }
    
    // For collecting specific items
    const collectMatch = goal.match(/collect\s+(\d+)\s+([a-z_]+)/i);
    if (collectMatch) {
      const requiredCount = parseInt(collectMatch[1]);
      const itemName = collectMatch[2].toLowerCase();
      const currentCount = state.inventory.items[itemName] || 0;
      
      if (currentCount >= requiredCount) {
        console.log(`[ThinkManager] Collection goal completed! Has ${currentCount}/${requiredCount} ${itemName}`);
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Determines if the bot should try to sleep based on time of day
   */
  private shouldSleep(state: State): boolean {
    // Check if it's night time
    const timeOfDay = state.surroundings.dayTime ? parseInt(state.surroundings.dayTime) : 0;
    
    // In Minecraft, night time is roughly between 13000 and 23000 ticks
    const isNightTime = timeOfDay >= 13000 && timeOfDay <= 23000;
    
    // Don't try to sleep if we're already sleeping
    const alreadySleeping = state.lastAction === "sleep" && 
                           state.lastActionResult?.toLowerCase().includes("sleeping");
    
    // Don't try to sleep if we just failed to sleep
    const justFailedToSleep = state.lastAction === "sleep" && 
                             state.lastActionResult?.toLowerCase().includes("fail");
    
    return isNightTime && !alreadySleeping && !justFailedToSleep;
  }
  
  /**
   * Determines if the bot should wake up based on time of day
   */
  private shouldWakeUp(state: State): boolean {
    // Check if it's day time
    const timeOfDay = state.surroundings.dayTime ? parseInt(state.surroundings.dayTime) : 0;
    
    // In Minecraft, day time is roughly between 0 and 13000 ticks or after 23000
    const isDayTime = (timeOfDay >= 0 && timeOfDay < 13000) || timeOfDay > 23000;
    
    // Check if we're currently sleeping
    const isSleeping = state.lastAction === "sleep" && 
                      state.lastActionResult?.toLowerCase().includes("sleeping");

    return isDayTime && (isSleeping === true);
  }

        // Add these methods inside the ThinkManager class

        /**
         * Detects repeating sequences of actions in the history.
         */
        private detectLoop(): boolean {
            if (this.actionHistory.length < this.loopPatternLength * this.loopDetectionThreshold) {
                return false; // Not enough history to detect a loop
            }

            // Check for repeating patterns of length `loopPatternLength`
            const lastPattern = this.actionHistory.slice(-this.loopPatternLength);
            if (lastPattern.length < this.loopPatternLength) return false; // Should not happen with check above, but safety

            let repetitions = 0;
            for (let i = 1; i < this.loopDetectionThreshold; i++) {
                const previousPattern = this.actionHistory.slice(
                    -(this.loopPatternLength * (i + 1)),
                    -(this.loopPatternLength * i)
                );

                if (previousPattern.length < this.loopPatternLength) break; // Not enough history further back

                // Compare action strings of the patterns
                const actionsMatch = lastPattern.every((actionEntry, index) =>
                    actionEntry.action === previousPattern[index]?.action
                );

                if (actionsMatch) {
                    repetitions++;
                } else {
                    break; // Sequence broken
                }
            }

            // If the pattern repeated enough times consecutively
            if (repetitions >= this.loopDetectionThreshold - 1) { // Need threshold-1 matches for threshold repetitions
                const repeatingActions = lastPattern.map(e => e.action).join(' -> ');
                console.log(`[ThinkManager] Detected repeating pattern (${repetitions + 1} times): ${repeatingActions}`);
                return true;
            }

            return false;
        }

        /**
         * Selects a random breakout strategy.
         */
        private getBreakoutAction(currentState: State): string {
            const strategies = [
                'explore', // Force exploration
                'lookAround', // Force observation
                'askHelpLoop' // Ask for help specifically about the loop
            ];

            const choice = Math.floor(Math.random() * strategies.length);

            switch (strategies[choice]) {
                case 'explore':
                    const currentPos = currentState.surroundings.position;
                    const randomOffset = Math.floor(Math.random() * 16) - 8; // -8 to +8
                    const newX = Math.floor(currentPos.x) + randomOffset;
                    const newZ = Math.floor(currentPos.z) + randomOffset;
                    const newY = Math.floor(currentPos.y);
                    console.log(`[ThinkManager] Breakout Strategy: Explore to ${newX},${newY},${newZ}`);
                    return `moveToPosition ${newX} ${newY} ${newZ}`;
                case 'lookAround':
                    console.log(`[ThinkManager] Breakout Strategy: Look Around`);
                    return 'lookAround';
                case 'askHelpLoop':
                default:
                    const recentPattern = this.actionHistory.slice(-this.loopPatternLength).map(e => e.action).join('; ');
                    console.log(`[ThinkManager] Breakout Strategy: Ask for Help`);
                    return `askForHelp I seem to be stuck in a loop repeating actions like: ${recentPattern}. What should I do differently?`;
            }
        }

        // ... (isGoalCompleted, shouldSleep, shouldWakeUp methods remain here) ...
}
