import { Memory } from './types';
import { ChatOpenAI } from '@langchain/openai';
import * as fs from 'fs/promises';
import * as path from 'path';

const MEMORY_FILE = 'agent_memory.json';

export class MemoryManager {
  private model: ChatOpenAI | undefined;
  private memory: Memory;
  private maxShortTermSize: number;
  private memoryFilePath: string;

  constructor(initialMemory?: Partial<Memory>, maxShortTermSize = 10, openAIApiKey?: string) {
    // Determine file path relative to the compiled JS file in dist
    this.memoryFilePath = path.join(__dirname, '..', '..', MEMORY_FILE);
    console.log(`[MemoryManager] Using memory file: ${this.memoryFilePath}`);

    // Default memory structure
    const defaultMemory: Memory = {
      shortTerm: initialMemory?.shortTerm || [],
      longTerm: initialMemory?.longTerm || '',
    };

    // Load memory synchronously during construction (or make constructor async)
    // Using synchronous for simplicity here, consider async if load time is an issue.
    try {
        const data = require('fs').readFileSync(this.memoryFilePath, 'utf8');
        const loadedMemory = JSON.parse(data);
        this.memory = { // Merge loaded with defaults/initial
            shortTerm: loadedMemory.shortTerm || defaultMemory.shortTerm,
            longTerm: loadedMemory.longTerm || defaultMemory.longTerm,
        };
        console.log(`[MemoryManager] Loaded memory from ${this.memoryFilePath}`);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log(`[MemoryManager] No existing memory file found at ${this.memoryFilePath}. Starting fresh.`);
            this.memory = defaultMemory;
        } else {
            console.error(`[MemoryManager] Error loading memory from ${this.memoryFilePath}:`, error);
            console.warn('[MemoryManager] Starting with default memory due to load error.');
            this.memory = defaultMemory;
        }
    }


    this.maxShortTermSize = maxShortTermSize;

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

  async addToShortTerm(entry: string): Promise<void> { // Make async
    this.memory.shortTerm.push(entry);
    let consolidated = false;
    if (this.memory.shortTerm.length > this.maxShortTermSize) {
      await this.consolidateMemory(); // Await consolidation
      consolidated = true;
    }
    // Save memory after adding or consolidating
    if (!consolidated) { // Avoid double saving if consolidated already saved
         await this.saveMemory();
    }
  }

  async consolidateMemory(): Promise<void> {
    // Items to remove from short-term memory
    const toRemove = this.memory.shortTerm.slice(0, this.memory.shortTerm.length - this.maxShortTermSize / 2);
    this.memory.shortTerm = this.memory.shortTerm.slice(this.memory.shortTerm.length - this.maxShortTermSize / 2);
    
    if (this.model) {
      try {
        // Use OpenAI to create a summary if model is available
        const prompt = `
Summarize the following events in a Minecraft context. Create a concise 1-2 sentence summary:

${toRemove.join('\n')}

Your summary should capture the key information and be written in past tense.
`;

        const response = await this.model.invoke([
          { role: 'system', content: prompt }
        ]);
        
        const summary = response.content.toString().trim();
        
        // Add summary to long-term memory
        this.memory.longTerm += `\n- ${summary}`;
      } catch (error) {
        // Fallback to simple concatenation if API call fails
        console.error('Memory consolidation error:', error);
        this.memory.longTerm += `\n- ${toRemove.join('\n- ')}`;
      }
    } else {
      // If no model available, just concatenate the entries
      this.memory.longTerm += `\n- ${toRemove.join('\n- ')}`;
    }
    // Save memory after consolidation
    await this.saveMemory();
  }

  get shortTerm(): string[] {
    return [...this.memory.shortTerm];
  }
  
  get longTerm(): string {
    return this.memory.longTerm;
  }
  
  get fullMemory(): Memory {
    return {
      shortTerm: [...this.memory.shortTerm],
      longTerm: this.memory.longTerm,
    };
  }
}
