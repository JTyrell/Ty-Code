import type { AgentPerformanceReport, AgentTelemetryEvent, AgentTelemetryRecord, AgentToolPerformanceMetric } from '../../preload/types';

export type { AgentPerformanceReport, AgentTelemetryEvent, AgentTelemetryRecord, AgentToolPerformanceMetric };

const MAX_EVENTS = 3_000;
const RECENT_ERROR_LIMIT = 10;

export class AgentObservability {
  events: AgentTelemetryRecord[] = [];

  recordEvent(event: AgentTelemetryEvent): void {
    const timestamp = Date.now();
    const record = { ...event, timestamp } as AgentTelemetryRecord;
    this.events.push(record);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  getEvents(filter?: { type?: string; startTime?: number }): AgentTelemetryRecord[] {
    if (!filter || (!filter.type && typeof filter.startTime !== 'number')) return this.events.slice();
    return this.events.filter((event) => {
      if (filter.type && event.type !== filter.type) return false;
      if (typeof filter.startTime === 'number' && event.timestamp < filter.startTime) return false;
      return true;
    });
  }

  private buildToolMetrics(): AgentToolPerformanceMetric[] {
    const perTool = new Map<string, { count: number; successCount: number; failureCount: number; totalDuration: number }>();
    for (const event of this.events) {
      if (event.type !== 'tool_call') continue;
      const entry = perTool.get(event.toolName) || { count: 0, successCount: 0, failureCount: 0, totalDuration: 0 };
      entry.count++;
      entry.totalDuration += event.duration;
      if (event.success) entry.successCount++;
      else entry.failureCount++;
      perTool.set(event.toolName, entry);
    }
    return Array.from(perTool.entries())
      .map(([toolName, entry]) => ({
        toolName,
        count: entry.count,
        successCount: entry.successCount,
        failureCount: entry.failureCount,
        successRate: entry.count > 0 ? Math.round((entry.successCount / entry.count) * 100) / 100 : 0,
        avgDuration: entry.count > 0 ? Math.round((entry.totalDuration / entry.count) * 10) / 10 : 0
      }))
      .sort((a, b) => b.count - a.count);
  }

  generateReport(): AgentPerformanceReport {
    const toolMetrics = this.buildToolMetrics();
    const totalCount = toolMetrics.reduce((sum, metric) => sum + metric.count, 0);
    const successCount = toolMetrics.reduce((sum, metric) => sum + metric.successCount, 0);
    const durationSum = this.events.filter((event) => event.type === 'tool_call').reduce((sum, event) => sum + event.duration, 0);

    const llmEvents = this.events.filter((event) => event.type === 'llm_call');
    const llmTokensIn = llmEvents.reduce((sum, event) => sum + (Number.isFinite(event.tokensIn) ? event.tokensIn : 0), 0);
    const llmTokensOut = llmEvents.reduce((sum, event) => sum + (Number.isFinite(event.tokensOut) ? event.tokensOut : 0), 0);
    const llmDurationSum = llmEvents.reduce((sum, event) => sum + event.duration, 0);

    const iterationEvents = this.events.filter((event) => event.type === 'agent_iteration');
    const iterationCompletedSum = iterationEvents.reduce((sum, event) => sum + event.todosCompleted, 0);
    const iterationRemainingSum = iterationEvents.reduce((sum, event) => sum + event.todosRemaining, 0);

    const compactionEvents = this.events.filter((event) => event.type === 'context_compaction');
    const compactionBeforeSum = compactionEvents.reduce((sum, event) => sum + event.tokensBefore, 0);
    const compactionAfterSum = compactionEvents.reduce((sum, event) => sum + event.tokensAfter, 0);

    const errorEvents = this.events.filter((event) => event.type === 'error');

    return {
      generatedAt: Date.now(),
      totalEvents: this.events.length,
      toolCalls: {
        totalCount,
        overallSuccessRate: totalCount > 0 ? Math.round((successCount / totalCount) * 100) / 100 : 0,
        averageDuration: totalCount > 0 ? Math.round((durationSum / totalCount) * 10) / 10 : 0,
        perTool: toolMetrics
      },
      llmCalls: {
        count: llmEvents.length,
        tokensIn: llmTokensIn,
        tokensOut: llmTokensOut,
        averageDuration: llmEvents.length > 0 ? Math.round((llmDurationSum / llmEvents.length) * 10) / 10 : 0
      },
      agentIterations: {
        count: iterationEvents.length,
        averageTodosCompleted: iterationEvents.length > 0 ? Math.round((iterationCompletedSum / iterationEvents.length) * 100) / 100 : 0,
        averageTodosRemaining: iterationEvents.length > 0 ? Math.round((iterationRemainingSum / iterationEvents.length) * 100) / 100 : 0
      },
      contextCompactions: {
        count: compactionEvents.length,
        averageTokensBefore: compactionEvents.length > 0 ? Math.round(compactionBeforeSum / compactionEvents.length) : 0,
        averageTokensAfter: compactionEvents.length > 0 ? Math.round(compactionAfterSum / compactionEvents.length) : 0,
        totalTokensSaved: Math.max(0, compactionBeforeSum - compactionAfterSum)
      },
      errors: {
        count: errorEvents.length,
        recentMessages: errorEvents.slice(-RECENT_ERROR_LIMIT).map((event) => event.message)
      }
    };
  }

  exportToJSON(): string {
    return JSON.stringify({
      generatedAt: Date.now(),
      totalEvents: this.events.length,
      report: this.generateReport(),
      events: this.events
    }, null, 2);
  }

  clearEvents(): void {
    this.events = [];
  }
}

export const agentObservability = new AgentObservability();
