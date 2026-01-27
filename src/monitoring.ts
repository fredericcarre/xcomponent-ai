/**
 * Monitoring and Logging Infrastructure
 * Winston-based JSON logging with insights generation
 */

import winston from 'winston';
import { LogEntry } from './types';

/**
 * Monitoring service
 */
export class MonitoringService {
  private logger: winston.Logger;
  private logs: LogEntry[];

  constructor() {
    this.logs = [];
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
        new winston.transports.File({ filename: 'logs/fsm-error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/fsm-combined.log' }),
      ],
    });
  }

  /**
   * Log state transition
   */
  logTransition(entry: LogEntry): void {
    this.logs.push(entry);
    this.logger.info('State transition', entry);
  }

  /**
   * Log error
   */
  logError(instanceId: string, error: string, metadata?: Record<string, any>): void {
    const entry: LogEntry = {
      instanceId,
      from: '',
      to: 'ERROR',
      event: 'error',
      time: Date.now(),
      error,
      metadata,
    };
    this.logs.push(entry);
    this.logger.error('FSM error', entry);
  }

  /**
   * Get logs for instance
   */
  getLogsForInstance(instanceId: string): LogEntry[] {
    return this.logs.filter(log => log.instanceId === instanceId);
  }

  /**
   * Get all logs
   */
  getAllLogs(): LogEntry[] {
    return this.logs;
  }

  /**
   * Get logs in time range
   */
  getLogsInRange(startTime: number, endTime: number): LogEntry[] {
    return this.logs.filter(log => log.time >= startTime && log.time <= endTime);
  }

  /**
   * Analyze logs and generate insights
   */
  analyzeLogs(_componentName: string): AnalysisInsights {
    const insights: AnalysisInsights = {
      totalTransitions: this.logs.length,
      errorCount: this.logs.filter(log => log.error).length,
      bottlenecks: [],
      suggestions: [],
      averageTransitionTime: 0,
      mostCommonStates: [],
    };

    // Count state frequencies
    const stateCounts = new Map<string, number>();
    const stateTransitionTimes = new Map<string, number[]>();

    for (let i = 0; i < this.logs.length; i++) {
      const log = this.logs[i];

      stateCounts.set(log.to, (stateCounts.get(log.to) || 0) + 1);

      // Calculate transition times
      if (i > 0 && this.logs[i - 1].instanceId === log.instanceId) {
        const timeDiff = log.time - this.logs[i - 1].time;
        const key = `${this.logs[i - 1].to}->${log.to}`;
        if (!stateTransitionTimes.has(key)) {
          stateTransitionTimes.set(key, []);
        }
        stateTransitionTimes.get(key)!.push(timeDiff);
      }
    }

    // Find most common states
    insights.mostCommonStates = Array.from(stateCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([state, count]) => ({ state, count }));

    // Identify bottlenecks (transitions taking > 5s on average)
    for (const [transition, times] of stateTransitionTimes.entries()) {
      const avg = times.reduce((sum, t) => sum + t, 0) / times.length;
      if (avg > 5000) {
        insights.bottlenecks.push({
          transition,
          averageTimeMs: avg,
          occurrences: times.length,
        });
        insights.suggestions.push(
          `Bottleneck detected: ${transition} takes ${(avg / 1000).toFixed(2)}s on average. Consider optimizing or adding timeout.`
        );
      }
    }

    // Calculate overall average
    const allTimes: number[] = [];
    stateTransitionTimes.forEach(times => allTimes.push(...times));
    if (allTimes.length > 0) {
      insights.averageTransitionTime = allTimes.reduce((sum, t) => sum + t, 0) / allTimes.length;
    }

    // Error analysis
    if (insights.errorCount > insights.totalTransitions * 0.1) {
      insights.suggestions.push(
        `High error rate: ${((insights.errorCount / insights.totalTransitions) * 100).toFixed(1)}%. Review error states and transition logic.`
      );
    }

    // Timeout suggestions
    const timeoutErrors = this.logs.filter(log => log.error && log.error.includes('timeout'));
    if (timeoutErrors.length > 0) {
      insights.suggestions.push(
        `${timeoutErrors.length} timeout errors detected. Consider reviewing timeout durations or adding retry logic.`
      );
    }

    return insights;
  }

  /**
   * Generate natural language summary
   */
  generateSummary(componentName: string): string {
    const insights = this.analyzeLogs(componentName);
    const lines: string[] = [
      `Component: ${componentName}`,
      `Total transitions: ${insights.totalTransitions}`,
      `Errors: ${insights.errorCount} (${((insights.errorCount / insights.totalTransitions) * 100).toFixed(1)}%)`,
      `Average transition time: ${(insights.averageTransitionTime / 1000).toFixed(2)}s`,
    ];

    if (insights.mostCommonStates.length > 0) {
      lines.push('\nMost common states:');
      insights.mostCommonStates.forEach(({ state, count }) => {
        lines.push(`  - ${state}: ${count} times`);
      });
    }

    if (insights.bottlenecks.length > 0) {
      lines.push('\nBottlenecks detected:');
      insights.bottlenecks.forEach(b => {
        lines.push(`  - ${b.transition}: ${(b.averageTimeMs / 1000).toFixed(2)}s (${b.occurrences} times)`);
      });
    }

    if (insights.suggestions.length > 0) {
      lines.push('\nSuggestions:');
      insights.suggestions.forEach(s => lines.push(`  - ${s}`));
    }

    return lines.join('\n');
  }

  /**
   * Clear old logs
   */
  clearOldLogs(beforeTimestamp: number): void {
    this.logs = this.logs.filter(log => log.time >= beforeTimestamp);
  }
}

/**
 * Analysis insights
 */
export interface AnalysisInsights {
  totalTransitions: number;
  errorCount: number;
  bottlenecks: Array<{
    transition: string;
    averageTimeMs: number;
    occurrences: number;
  }>;
  suggestions: string[];
  averageTransitionTime: number;
  mostCommonStates: Array<{
    state: string;
    count: number;
  }>;
}

/**
 * Create monitoring service singleton
 */
export const monitoringService = new MonitoringService();
