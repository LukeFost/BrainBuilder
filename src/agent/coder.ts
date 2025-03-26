import { ChatOpenAI } from '@langchain/openai';
import { Bot } from 'mineflayer';
import { State } from './types';
import { ESLint } from 'eslint';
// Import SES dynamically to handle potential missing module
let Compartment: any;
try {
  const ses = require('ses');
  Compartment = ses.Compartment;
} catch (e) {
  console.warn('SES module not available, sandbox functionality will be limited');
  // Mock Compartment for type checking
  Compartment = class {
    constructor(endowments: any) { this.endowments = endowments; }
    evaluate(code: string) { 
      console.warn('Using unsafe eval instead of SES Compartment');
      // This is unsafe but allows compilation - should be replaced with proper sandboxing
      return Function('return ' + code)();
    }
    private endowments: any;
  };
}
import * as fs from 'fs/promises';
import * as path from 'path';
import { Vec3 } from 'vec3'; // Import Vec3

// Define a safe logger function to be used inside the sandbox
const safeLog = (bot: Bot | null, ...args: any[]) => {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  console.log('[Generated Code]', message);
  // Optionally, chat the message in-game (be careful not to spam)
  // bot?.chat(`[Code] ${message.substring(0, 100)}`); // Limit message length
};

// Define the structure for the execution result
interface ExecutionResult {
  success: boolean;
  message: string;
  interrupted?: boolean;
  timedout?: boolean; // Add if timeout logic is implemented
}

export class Coder {
  private model: ChatOpenAI;
  private bot: Bot;
  private eslint: ESLint;
  private fileCounter: number = 0;
  private codeDir: string = path.join(__dirname, '..', '..', 'generated_code'); // Directory to save code
  private interruptFlag: boolean = false; // Flag to signal interruption

  // Basic template for the generated code
  private readonly codeTemplate = `
// Safe log function available: log(bot, message)
// Bot object available: bot (with limited, safe properties/methods)
// Vec3 available for vector math

async function main(bot, log, Vec3) {
  try {
    /* CODE HERE */
  } catch (error) {
    log(bot, 'Execution Error:', error.message || error);
    return 'Execution failed: ' + (error.message || error);
  }
}
module.exports = main; // Use module.exports for SES compatibility
`;

  // Template used for linting (might be slightly different if needed)
  private readonly codeLintTemplate = this.codeTemplate;

  constructor(bot: Bot, openAIApiKey: string) {
    this.bot = bot;
    this.model = new ChatOpenAI({
      openAIApiKey: openAIApiKey,
      modelName: 'gpt-4o-mini', // Or your preferred model
      temperature: 0.1, // Low temperature for code generation
    });
    // Configure ESLint programmatically (basic example)
    this.eslint = new ESLint({
        useEslintrc: false, // Don't look for .eslintrc files
        overrideConfig: {
            // Use older ESLint config format for programmatic API compatibility
            parserOptions: {
                ecmaVersion: 2021,
                sourceType: "module", // Or "commonjs" if your template uses require
            },
            env: {
                es2021: true,
                node: false // Don't assume full Node.js environment in sandbox
            },
            globals: {
                // Define globals available in the sandbox
                bot: 'readonly',
                log: 'readonly',
                Vec3: 'readonly',
                require: 'readonly', // If using require in template/sandbox
                module: 'readonly', // If using module.exports
                console: 'readonly', // Allow console if needed, though safeLog is preferred
                setTimeout: 'readonly', // Allow setTimeout if needed
                Promise: 'readonly',
                // async/await are keywords, not globals
                globalThis: 'readonly', // Allow access to the sandboxed globalThis
            },
            rules: {
                // Add specific rules if needed, e.g., 'no-undef' is important
                'no-undef': 'error',
                'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_|bot|log|Vec3|require|module|globalThis' }], // Ignore specific globals
                // Add more rules as desired
            }
        }
    });

    // Ensure the directory for saving code exists
    fs.mkdir(this.codeDir, { recursive: true }).catch(console.error);
  }

  // Method to signal interruption
  interrupt() {
    this.interruptFlag = true;
  }

  private sanitizeCode(code: string): string {
    // Basic sanitization: trim whitespace
    // More complex sanitization could be added here if needed
    return code.trim();
  }

  private async writeFilePromise(filepath: string, data: string): Promise<void> {
    try {
      await fs.writeFile(filepath, data, 'utf8');
      console.log(`[Coder] Saved generated code to ${filepath}`);
    } catch (error) {
      console.error(`[Coder] Error saving code to ${filepath}:`, error);
    }
  }

  // --- Code Validation (Linting) ---
  private async lintCode(code: string): Promise<string | null> {
    console.log('[Coder] Linting code...');
    let result = '#### CODE LINTING ERRORS ###\n';
    let hasErrors = false;

    // Note: Custom skill checking logic from the example is omitted for brevity
    // It would require defining the 'skills' and 'world' objects available in the sandbox
    // and comparing against them.

    try {
      const lintResults = await this.eslint.lintText(code);
      const codeLines = code.split('\n');

      lintResults.forEach((lintResult: any) => {
        if (lintResult.messages.length > 0) {
          hasErrors = true;
          lintResult.messages.forEach((exc: any, index: number) => {
            const errorLine = exc.line ? (codeLines[exc.line - 1]?.trim() || 'N/A') : 'N/A';
            result += `# ERROR ${index + 1}\n`;
            result += `  Message: ${exc.message} (${exc.ruleId || 'general'})\n`;
            result += `  Location: Line ${exc.line || 'N/A'}, Column ${exc.column || 'N/A'}\n`;
            result += `  Related Code: ${errorLine}\n---\n`;
          });
        }
      });

      if (hasErrors) {
        console.warn('[Coder] Linting finished with errors.');
        return result + 'The code contains linting errors and cannot be executed.';
      }

      console.log('[Coder] Linting finished successfully.');
      return null; // No errors found
    } catch (error: any) {
      console.error('[Coder] Error during linting process:', error);
      return `Linting process failed: ${error.message || error}`;
    }
  }

  // --- Code Staging and Sandboxing ---
  private async stageCode(code: string): Promise<{ func: { main: Function } | null, src_lint_copy: string, error?: string }> {
    console.log('[Coder] Staging code for execution...');
    // 1. Sanitize
    code = this.sanitizeCode(code);

    // 2. Inject Interruption Checks and Logging (Simplified)
    // Replace console.log - prioritize this replacement
    code = code.replace(/console\.log\(/g, 'log(bot, ');
    // Add interruption checks (basic version)
    // A more robust approach might involve AST manipulation
    code = code.replace(/;\n/g, `; if (globalThis.shouldInterrupt()) { log(bot, "Code interrupted."); return "Interrupted"; }\n`);

    // 3. Wrap in Template
    let src = '';
    for (const line of code.split('\n')) {
      src += `    ${line}\n`; // Indent code for the template
    }
    const srcForEval = this.codeTemplate.replace('/* CODE HERE */', src);
    const srcLintCopy = this.codeLintTemplate.replace('/* CODE HERE */', src); // For linting

    // 4. Save the code (optional but good for debugging)
    const filename = `${this.fileCounter++}.js`;
    const filepath = path.join(this.codeDir, filename);
    await this.writeFilePromise(filepath, srcForEval);

    // 5. Create Secure Compartment
    try {
      // Define exactly what the sandboxed code can access
      const endowments = {
        bot: this.createSafeBotProxy(), // Expose only safe bot properties/methods
        log: safeLog,
        Vec3: Vec3, // Provide Vec3
        setTimeout: setTimeout, // Allow setTimeout
        Promise: Promise,
        // Add other safe utilities or constants if needed
        // DO NOT expose 'fs', 'child_process', 'eval', 'Function', etc.
        globalThis: { // Define a limited globalThis for the sandbox
            shouldInterrupt: () => this.interruptFlag, // Function to check interruption
            // Add other safe globals if necessary
        }
      };

      const compartment = new Compartment(endowments, {}, {
          // SES options if needed
      });

      // 6. Evaluate the code within the compartment
      // Use evaluate for CommonJS style (module.exports)
      const mainFn = compartment.evaluate(srcForEval);

      if (typeof mainFn !== 'function') {
          throw new Error('Generated code did not export a main function.');
      }

      console.log('[Coder] Code staged successfully.');
      return { func: { main: mainFn }, src_lint_copy: srcLintCopy };

    } catch (error: any) {
      console.error('[Coder] Error staging or evaluating code:', error);
      return { func: null, src_lint_copy: srcLintCopy, error: `Staging/Evaluation failed: ${error.message || error}` };
    }
  }

  // --- Create a Proxy for the Bot Object ---
  // This is crucial for security. Only expose necessary and safe methods/properties.
  private createSafeBotProxy(): Partial<Bot> {
      // Whitelist safe properties and methods
      // Use 'any' temporarily to bypass strict type checking for the proxy
      const safeBot: any = {
          entity: this.bot.entity ? { // Expose only safe parts of entity
              position: this.bot.entity.position,
              velocity: this.bot.entity.velocity,
              yaw: this.bot.entity.yaw,
              pitch: this.bot.entity.pitch,
              onGround: this.bot.entity.onGround,
              // Add other safe entity properties if needed
          } : undefined,
          chat: (message: string) => {
              // Add rate limiting or further sanitization if needed
              if (message && message.length > 0 && !message.startsWith('/')) { // Prevent command execution
                  this.bot.chat(message.substring(0, 250)); // Limit length
              } else {
                  safeLog(null, "Blocked potentially unsafe chat message:", message);
              }
          },
          // Expose safe pathfinder methods IF NECESSARY and deemed safe
          // pathfinder: this.bot.pathfinder ? {
          //     goto: async (goal) => { /* Add safety checks? */ return this.bot.pathfinder.goto(goal); },
          //     stop: () => this.bot.pathfinder.stop(),
          //     isMoving: () => this.bot.pathfinder.isMoving(),
          // } : undefined,
          // Expose safe inventory methods
          inventory: this.bot.inventory ? {
              items: () => this.bot.inventory.items().map(item => ({ // Return copies, not originals
                  name: item.name,
                  count: item.count,
                  type: item.type,
                  // Omit potentially sensitive properties like NBT data
              })),
              count: (itemName: string) => {
                  const item = this.bot.registry.itemsByName[itemName];
                  return item ? this.bot.inventory.count(item.id, null) : 0;
              },
              // Add other simple, read-only inventory functions if needed
          } : undefined,
          // Expose block finding (read-only)
          findBlock: (options: any) => this.bot.findBlock(options),
          blockAt: (point: Vec3) => this.bot.blockAt(point),
          // Add other simple, safe, read-only functions as needed
          // Example: bot.time.timeOfDay
          time: this.bot.time ? {
              timeOfDay: this.bot.time.timeOfDay,
              day: this.bot.time.day,
          } : undefined,

          // *** CRITICALLY IMPORTANT: DO NOT EXPOSE ***
          // - bot.creative.* (unless heavily restricted)
          // - bot.equip, bot.unequip (can drop items, interact unexpectedly)
          // - bot.dig, bot.placeBlock (can modify world state significantly)
          // - bot.attack, bot.useOn (can interact with entities/blocks)
          // - bot.controlState (direct movement control)
          // - bot._client (raw protocol access)
          // - Any method allowing arbitrary command execution or file system access
      };
      return safeBot;
  }


  // --- Main Code Generation Loop ---
  public async generateAndExecute(taskDescription: string, currentState: State): Promise<ExecutionResult> {
    console.log(`[Coder] Starting code generation for task: "${taskDescription}"`);
    this.interruptFlag = false; // Reset interrupt flag

    // Prepare context for the LLM
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      {
        role: 'system',
        content: `You are an expert Minecraft bot programmer. Your task is to write JavaScript code to be executed by a Mineflayer bot to accomplish a specific goal.
- Use ONLY the provided 'bot' object methods/properties and the 'log(bot, ...)' function for output.
- Available bot properties/methods (simplified): ${Object.keys(this.createSafeBotProxy()).join(', ')}, Vec3 for vector math.
- Write a single \`async function main(bot, log, Vec3) { ... }\` function.
- Use 'await' for any asynchronous bot operations if available.
- The code will run in a restricted environment. Do not attempt to access the file system, network, or use 'eval' or 'new Function'.
- Return a string summarizing the result upon completion, or describing the failure.
- If the task is impossible with the available tools, return a message explaining why.
- Ensure the code is safe and does not grief or harm the environment excessively.
- Your code MUST be enclosed in a single Javascript code block (\`\`\`javascript ... \`\`\`).
Current State:
Inventory: ${JSON.stringify(currentState.inventory.items)}
Position: ${JSON.stringify(currentState.surroundings.position)}
Nearby Blocks: ${currentState.surroundings.nearbyBlocks.slice(0, 10).join(', ')}...
Nearby Entities: ${currentState.surroundings.nearbyEntities.join(', ')}
Memory: ${currentState.memory.shortTerm.slice(-3).join(' | ')}`
      },
      { role: 'user', content: `Write the JavaScript code for the following task: ${taskDescription}` }
    ];

    let code: string | null = null;
    let executionResult: ExecutionResult = { success: false, message: "Code generation failed after multiple attempts." };
    const maxRetries = 3; // Limit retries

    for (let i = 0; i < maxRetries; i++) {
      if (this.interruptFlag) return { success: false, message: "Code generation interrupted.", interrupted: true };

      console.log(`[Coder] Attempt ${i + 1} to generate code...`);
      try {
        const response = await this.model.invoke(messages.map(m => ({ role: m.role, content: m.content })));
        const responseContent = response.content.toString();
        messages.push({ role: 'assistant', content: responseContent }); // Add LLM response to history

        // Extract code
        const codeBlockMatch = responseContent.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
        if (!codeBlockMatch || !codeBlockMatch[1]) {
          console.warn('[Coder] No code block found in LLM response.');
          messages.push({ role: 'system', content: 'Error: No JavaScript code block found (```javascript ... ```). Please provide the code.' });
          continue; // Try again
        }
        code = codeBlockMatch[1];
        console.log('[Coder] Extracted code.');

        // Stage and Validate
        const stageResult = await this.stageCode(code);
        if (stageResult.error || !stageResult.func) {
            console.error('[Coder] Code staging failed:', stageResult.error);
            messages.push({ role: 'system', content: `Error during code staging: ${stageResult.error}. Please fix the code.` });
            continue; // Try again
        }

        // Lint the staged code (using the copy)
        const lintError = await this.lintCode(stageResult.src_lint_copy);
        if (lintError) {
          console.warn('[Coder] Linting errors found.');
          messages.push({ role: 'system', content: `Linting Error:\n${lintError}\nPlease fix the code.` });
          continue; // Try again
        }

        // Execute the code in the sandbox
        console.log('[Coder] Executing code...');
        this.interruptFlag = false; // Reset flag before execution
        try {
            // Execute the 'main' function from the staged code
            const executionPromise = stageResult.func.main(this.createSafeBotProxy(), safeLog, Vec3);

            // Add a timeout (e.g., 30 seconds) - Requires careful implementation
            // const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Execution timed out")), 30000));
            // const output = await Promise.race([executionPromise, timeoutPromise]);

            const output = await executionPromise; // Execute without timeout for now

            if (this.interruptFlag) {
                executionResult = { success: false, message: "Code execution was interrupted.", interrupted: true };
            } else if (typeof output === 'string' && output.toLowerCase().includes('fail')) {
                executionResult = { success: false, message: `Code execution reported failure: ${output}` };
            } else {
                executionResult = { success: true, message: `Code executed successfully. Output: ${output || 'No output'}` };
            }
            console.log(`[Coder] Execution finished. Success: ${executionResult.success}. Message: ${executionResult.message}`);

            // If successful, break the loop
            if (executionResult.success || executionResult.interrupted) {
                break;
            } else {
                 // If execution failed, add feedback and retry
                 messages.push({ role: 'system', content: `Execution failed: ${executionResult.message}. Please fix the code and try again.` });
            }

        } catch (execError: any) {
          console.error('[Coder] Code execution error:', execError);
          executionResult = { success: false, message: `Execution runtime error: ${execError.message || execError}` };
          messages.push({ role: 'system', content: `Execution failed: ${executionResult.message}. Please fix the code and try again.` });
          // Continue loop to retry
        }

      } catch (error: any) {
        console.error('[Coder] Error during generation/validation loop:', error);
        messages.push({ role: 'system', content: `An unexpected error occurred: ${error.message}. Please try again.` });
        // Add a small delay before retrying after a major error
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } // End of retry loop

    // Final summary message generation (optional)
    if (executionResult.success && code) {
        executionResult.message = `Summary of generated code execution:\nTask: ${taskDescription}\nResult: ${executionResult.message}\nCode:\n\`\`\`javascript\n${this.sanitizeCode(code)}\n\`\`\``;
    } else if (!executionResult.interrupted) {
         executionResult.message = `Failed to generate and execute code for task "${taskDescription}" after ${maxRetries} attempts. Last error: ${executionResult.message}`;
    }


    return executionResult;
  }
}
