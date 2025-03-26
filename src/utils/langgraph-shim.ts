// --- LangGraph Shim (Remove when SDK exports these) ---
// Define your own StateGraph and END until the langgraph-sdk exports them
export class StateGraph<T> {
  channels: Record<string, { value: any }>;
  nodes: Map<string, (state: T) => Promise<Partial<T>>>;
  edges: Map<string, string[]>;
  entryPoint: string | null;

  constructor(options: { channels: Record<string, { value: any }> }) {
    this.channels = options.channels;
    this.nodes = new Map();
    this.edges = new Map();
    this.entryPoint = null;
  }

  addNode(name: string, fn: (state: T) => Promise<Partial<T>>) {
    this.nodes.set(name, fn);
    return this;
  }

  setEntryPoint(name: string) {
    this.entryPoint = name;
    return this;
  }

  addEdge(from: string, to: string) {
    if (!this.edges.has(from)) {
      this.edges.set(from, []);
    }
    this.edges.get(from)!.push(to);
    return this;
  }

  compile() {
    return {
      stream: (initialState: T, options?: { recursionLimit?: number }) => {
        const limit = options?.recursionLimit || 100;
        let currentNode = this.entryPoint;
        let state = { ...initialState };
        const graph = this;
        
        return {
          [Symbol.asyncIterator]() {
            return (async function* () {
              for (let i = 0; i < limit; i++) {
                if (!currentNode) break;
                
                const nodeFn = graph.nodes.get(currentNode);
                if (!nodeFn) break;
                
                const result = await nodeFn(state);
                state = { ...state, ...result };
                
                yield { [currentNode]: result };
                
                const nextNodes = graph.edges.get(currentNode) || [];
                currentNode = nextNodes[0] || null; // Simple sequential execution for shim
              }
            })();
          }
        };
      }
    };
  }
}

export const END = "end"; // Placeholder for LangGraph's END sentinel
