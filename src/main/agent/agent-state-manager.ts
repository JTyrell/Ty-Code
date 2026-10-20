export enum AgentMode {
  Plan = 'plan',
  Execute = 'execute',
  Hybrid = 'hybrid'
}

export interface TodoItem {
  id: string;
  task: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'high' | 'medium' | 'low';
  context?: string;
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: number;
}

export class AgentStateManager {
  currentMode: AgentMode = AgentMode.Hybrid;
  todos: TodoItem[] = [];
  iterationCount = 0;
  maxIterations = 70;
  toolCallHistory: ToolCallRecord[] = [];
  private estimatedTokenUsage = 0;

  addTodo(task: string, priority: 'high' | 'medium' | 'low' = 'medium'): string {
    const id = `todo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.todos.push({
      id,
      task,
      status: 'pending',
      priority,
      context: ''
    });
    return id;
  }

  addTodos(tasks: Array<{ task: string; priority?: 'high' | 'medium' | 'low' }>): string[] {
    return tasks.map(({ task, priority = 'medium' }) => this.addTodo(task, priority));
  }

  restoreTodos(tasks: TodoItem[]): void {
    this.todos = Array.isArray(tasks)
      ? tasks.filter((task) => task && typeof task.id === 'string' && typeof task.task === 'string')
      : [];
  }

  updateTodoStatus(id: string, status: TodoItem['status']): void {
    const todo = this.todos.find(t => t.id === id);
    if (todo) {
      todo.status = status;
      if (status === 'in_progress') {
        this.todos.filter(t => t.id !== id && t.status === 'in_progress').forEach(t => t.status = 'pending');
      }
    }
  }

  getNextPendingTodo(): TodoItem | null {
    const pending = this.todos.filter(t => t.status === 'pending');
    if (pending.length === 0) return null;
    pending.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
    return pending[0];
  }

  getActiveTodo(): TodoItem | null {
    return this.todos.find(t => t.status === 'in_progress') || null;
  }

  getCompletedTodos(): TodoItem[] {
    return this.todos.filter(t => t.status === 'completed');
  }

  getFailedTodos(): TodoItem[] {
    return this.todos.filter(t => t.status === 'failed');
  }

  recordToolCall(tool: string, args: Record<string, unknown>, result: unknown): void {
    this.toolCallHistory.push({
      tool,
      args,
      result,
      timestamp: Date.now()
    });
  }

  updateTokenUsage(tokens: number): void {
    this.estimatedTokenUsage = tokens;
  }

  shouldCompactContext(): boolean {
    return this.estimatedTokenUsage > 85_000;
  }

  getCompactSummary(): string {
    const completed = this.getCompletedTodos();
    const failed = this.getFailedTodos();
    const recentTools = this.toolCallHistory.slice(-10);
    
    let summary = '## Context Summary\n';
    if (completed.length > 0) {
      summary += `### Completed Tasks (${completed.length})\n`;
      completed.forEach(t => {
        summary += `- ${t.task}\n`;
      });
      summary += '\n';
    }
    if (failed.length > 0) {
      summary += `### Failed Tasks (${failed.length})\n`;
      failed.forEach(t => {
        summary += `- ${t.task} (FAILED)\n`;
      });
      summary += '\n';
    }
    if (recentTools.length > 0) {
      summary += `### Recent Tool Activity\n`;
      recentTools.forEach(r => {
        summary += `- ${r.tool}(${JSON.stringify(r.args).slice(0, 80)}) -> ${JSON.stringify(r.result).slice(0, 100)}\n`;
      });
    }
    return summary;
  }

  resetRun(): void {
    this.todos = [];
    this.iterationCount = 0;
    this.toolCallHistory = [];
    this.estimatedTokenUsage = 0;
  }

  reset(): void {
    this.todos = [];
    this.iterationCount = 0;
    this.toolCallHistory = [];
    this.estimatedTokenUsage = 0;
    this.currentMode = AgentMode.Hybrid;
  }

  allTodosComplete(): boolean {
    return this.todos.length > 0 && this.todos.every(t => t.status === 'completed');
  }

  hasPendingTodos(): boolean {
    return this.todos.some(t => t.status === 'pending');
  }

  getPendingCount(): number {
    return this.todos.filter(t => t.status === 'pending').length;
  }
}

export function createAgentStateManager(): AgentStateManager {
  return new AgentStateManager();
}

export const agentStateManager = new AgentStateManager();