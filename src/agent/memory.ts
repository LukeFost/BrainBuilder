import { StructuredMemory, ShortTermMemory, LongTermMemory, KnowledgeBase, RecentActionEntry } from './types';
import { ChatOpenAI } from '@langchain/openai';
import * as fs from 'fs/promises';
import * as path from 'path';

const MEMORY_FILE = 'agent_memory.json';

export class MemoryManager {
  private model: ChatOpenAI | undefined;
  private memory: StructuredMemory;
  private maxRecentActionsSize: number; // Renamed for clarity
  private memoryFilePath: string;

  constructor(initialMemory?: Partial<StructuredMemory>, maxShortTermSize = 10, openAIApiKey?: string) {
    // Determine file path relative to the compiled JS file in dist
    this.memoryFilePath = path.join(__dirname, '..', '..', MEMORY_FILE);
    console.log(`[MemoryManager] Using memory file: ${this.memoryFilePath}`);

    // Default memory structure
    const defaultMemory: StructuredMemory = {
      shortTerm: {
        recentActions: [],
        // Initialize other short-term parts if needed
      },
      longTerm: {
        knowledgeBase: {
          locations: {},
          recipeKnowledge: {},
          entityEncounters: [],
          completedGoals: [],
          failurePatterns: {},
        },
      },
    };

    // Load memory synchronously during construction (or make constructor async)
    // Using synchronous for simplicity here, consider async if load time is an issue.
    try {
        const data = require('fs').readFileSync(this.memoryFilePath, 'utf8');
        // Inside the try block after JSON.parse(data)
        const loadedMemory = JSON.parse(data) as Partial<StructuredMemory>;
        this.memory = { // Merge loaded with defaults, ensuring all levels exist
            shortTerm: {
                recentActions: loadedMemory.shortTerm?.recentActions || defaultMemory.shortTerm.recentActions,
                currentGoalState: loadedMemory.shortTerm?.currentGoalState, // Keep if loaded
                tacticalObservations: loadedMemory.shortTerm?.tacticalObservations, // Keep if loaded
            },
            longTerm: {
                knowledgeBase: {
                    locations: loadedMemory.longTerm?.knowledgeBase?.locations || defaultMemory.longTerm.knowledgeBase.locations,
                    recipeKnowledge: loadedMemory.longTerm?.knowledgeBase?.recipeKnowledge || defaultMemory.longTerm.knowledgeBase.recipeKnowledge,
                    entityEncounters: loadedMemory.longTerm?.knowledgeBase?.entityEncounters || defaultMemory.longTerm.knowledgeBase.entityEncounters,
                    completedGoals: loadedMemory.longTerm?.knowledgeBase?.completedGoals || defaultMemory.longTerm.knowledgeBase.completedGoals,
                    failurePatterns: loadedMemory.longTerm?.knowledgeBase?.failurePatterns || defaultMemory.longTerm.knowledgeBase.failurePatterns,
                }
            },
        };
        console.log(`[MemoryManager] Loaded memory from ${this.memoryFilePath}`);

    } catch (error: any) {
        if (error.code === 'ENOENT') {
            // Inside the catch block (ENOENT)
            console.log(`[MemoryManager] No existing memory file found at ${this.memoryFilePath}. Starting fresh.`);
            this.memory = defaultMemory;
        } else {
            // Inside the catch block (other errors)
            console.error(`[MemoryManager] Error loading memory from ${this.memoryFilePath}:`, error);
            console.warn('[MemoryManager] Starting with default memory due to load error.');
            this.memory = defaultMemory;
        }
    }

        // Update max size variable name
        this.maxRecentActionsSize = maxShortTermSize; // Use the constructor arg

    // Initialize OpenAI client if API key is provided
    if (openAIApiKey) {
      this.model = new ChatOpenAI({
        openAIApiKey: openAIApiKey,
        modelName: 'gpt-3.5-turbo',
        temperature: 0,
      });
    }
  }

  async saveMemory(): Promise<void> {
      try {
          const data = JSON.stringify(this.memory, null, 2);
          await fs.writeFile(this.memoryFilePath, data, 'utf8');
          // console.log(`[MemoryManager] Saved memory to ${this.memoryFilePath}`); // Optional: too verbose?
      } catch (error) {
          console.error(`[MemoryManager] Error saving memory to ${this.memoryFilePath}:`, error);
      }
  }

    async addRecentAction(action: string, result: string): Promise<void> {
        const entry: RecentActionEntry = {
            timestamp: Date.now(),
            action: action,
            result: result,
        };
        this.memory.shortTerm.recentActions.push(entry);

        let consolidated = false;
        // Use maxRecentActionsSize here
        if (this.memory.shortTerm.recentActions.length > this.maxRecentActionsSize) {
            await this.consolidateMemory(); // Await consolidation
            consolidated = true;
        }

        // Save memory after adding or consolidating
        if (!consolidated) { // Avoid double saving if consolidated already saved
            await this.saveMemory();
        }
    }

    async consolidateMemory(): Promise<void> {
        // Determine how many items to remove (e.g., half the excess)
        const overflow = this.memory.shortTerm.recentActions.length - this.maxRecentActionsSize;
        const itemsToRemoveCount = Math.max(1, Math.ceil(overflow + (this.maxRecentActionsSize / 4))); // Remove overflow plus some buffer
        const toProcess = this.memory.shortTerm.recentActions.splice(0, itemsToRemoveCount);

        console.log(`[MemoryManager] Consolidating ${toProcess.length} oldest actions into long-term memory.`);

        // --- TODO: Implement detailed processing logic ---
        // This requires parsing action strings and results to update:
        // - this.memory.longTerm.knowledgeBase.completedGoals
        // - this.memory.longTerm.knowledgeBase.failurePatterns
        // - this.memory.longTerm.knowledgeBase.locations (e.g., from moveToPosition results)
        // - this.memory.longTerm.knowledgeBase.recipeKnowledge (from craftItem results)
        // - this.memory.longTerm.knowledgeBase.entityEncounters (from attackEntity results)

        // Example placeholder for failure pattern update (needs actual parsing)
        for (const entry of toProcess) {
            if (entry.result.toLowerCase().includes('fail')) {
                // Placeholder: Extract action type and reason
                const actionType = entry.action.split(' ')[0];
                const reason = 'unknown_failure'; // Needs proper extraction logic
                const key = `${actionType}:${reason}`;
                const existingPattern = this.memory.longTerm.knowledgeBase.failurePatterns[key];
                if (existingPattern) {
                    existingPattern.count++;
                    existingPattern.lastTimestamp = entry.timestamp;
                } else {
                    this.memory.longTerm.knowledgeBase.failurePatterns[key] = {
                        action: actionType,
                        reason: reason,
                        count: 1,
                        lastTimestamp: entry.timestamp,
                    };
                }
            }
            // Add similar logic for other knowledge base categories
        }
        // --- End TODO ---


        // Save memory after consolidation attempt
        await this.saveMemory();
    }

  get shortTerm(): RecentActionEntry[] {
            // Return a copy of the recent actions array
            return [...this.memory.shortTerm.recentActions];
        }

  get longTerm(): string {
            // Generate a concise summary string from the structured long-term memory
            const kb = this.memory.longTerm.knowledgeBase;
            const summaries: string[] = [];

            if (Object.keys(kb.locations).length > 0) {
                summaries.push(`Known locations: ${Object.keys(kb.locations).slice(0, 5).join(', ')}...`);
            }
            if (Object.keys(kb.recipeKnowledge).length > 0) {
                summaries.push(`Learned/used recipes for: ${Object.keys(kb.recipeKnowledge).slice(0, 5).join(', ')}...`);
            }
            if (kb.completedGoals.length > 0) {
                summaries.push(`Completed goals like: "${kb.completedGoals.slice(-1)[0]?.goal}"...`);
            }
            if (Object.keys(kb.failurePatterns).length > 0) {
                const recentFailure = Object.values(kb.failurePatterns).sort((a, b) => b.lastTimestamp - a.lastTimestamp)[0];
                if (recentFailure) {
                     summaries.push(`Recently failed action: ${recentFailure.action} (Reason: ${recentFailure.reason}, Count: ${recentFailure.count})`);
                }
            }

            return summaries.length > 0 ? summaries.join(' | ') : 'No significant long-term memories yet.';
        }

  get fullMemory(): StructuredMemory {
            // Return a deep copy might be safer, but for now return the structure
            // Be mindful of potential direct mutations if not copying deeply
            return this.memory;
  }
}
