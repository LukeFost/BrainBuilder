import { Memory } from './types';
import { ChatOpenAI } from '@langchain/openai';

export class MemoryManager {
  private model: ChatOpenAI;
  private memory: Memory;
  private maxShortTermSize: number;
  
  constructor(initialMemory?: Partial<Memory>, maxShortTermSize = 10, openAIApiKey?: string) {
    this.memory = {
      shortTerm: initialMemory?.shortTerm || [],
      longTerm: initialMemory?.longTerm || '',
    };
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
  
  addToShortTerm(entry: string): void {
    this.memory.shortTerm.push(entry);
    if (this.memory.shortTerm.length > this.maxShortTermSize) {
      this.consolidateMemory();
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