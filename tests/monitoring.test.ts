/**
 * Monitoring Service Tests
 */

import { MonitoringService } from '../src/monitoring';
import { LogEntry } from '../src/types';

describe('MonitoringService', () => {
  let monitoring: MonitoringService;

  beforeEach(() => {
    monitoring = new MonitoringService();
  });

  describe('Logging', () => {
    it('should log transitions', () => {
      const entry: LogEntry = {
        instanceId: 'test-1',
        from: 'Start',
        to: 'Processing',
        event: 'BEGIN',
        time: Date.now(),
      };

      monitoring.logTransition(entry);

      const logs = monitoring.getAllLogs();
      expect(logs.length).toBe(1);
      expect(logs[0]).toEqual(entry);
    });

    it('should log errors', () => {
      monitoring.logError('test-1', 'Test error', { detail: 'error detail' });

      const logs = monitoring.getAllLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].error).toBe('Test error');
      expect(logs[0].metadata?.detail).toBe('error detail');
    });

    it('should get logs for specific instance', () => {
      monitoring.logTransition({
        instanceId: 'test-1',
        from: 'Start',
        to: 'Processing',
        event: 'BEGIN',
        time: Date.now(),
      });

      monitoring.logTransition({
        instanceId: 'test-2',
        from: 'Start',
        to: 'Processing',
        event: 'BEGIN',
        time: Date.now(),
      });

      const logs = monitoring.getLogsForInstance('test-1');
      expect(logs.length).toBe(1);
      expect(logs[0].instanceId).toBe('test-1');
    });

    it('should get logs in time range', () => {
      const now = Date.now();

      monitoring.logTransition({
        instanceId: 'test-1',
        from: 'Start',
        to: 'Processing',
        event: 'BEGIN',
        time: now - 2000,
      });

      monitoring.logTransition({
        instanceId: 'test-2',
        from: 'Start',
        to: 'Processing',
        event: 'BEGIN',
        time: now,
      });

      const logs = monitoring.getLogsInRange(now - 1000, now + 1000);
      expect(logs.length).toBe(1);
      expect(logs[0].instanceId).toBe('test-2');
    });
  });

  describe('Analysis', () => {
    beforeEach(() => {
      // Setup test data
      const baseTime = Date.now();

      monitoring.logTransition({
        instanceId: 'test-1',
        from: 'Start',
        to: 'Processing',
        event: 'BEGIN',
        time: baseTime,
      });

      monitoring.logTransition({
        instanceId: 'test-1',
        from: 'Processing',
        to: 'Success',
        event: 'COMPLETE',
        time: baseTime + 1000,
      });

      monitoring.logTransition({
        instanceId: 'test-2',
        from: 'Start',
        to: 'Processing',
        event: 'BEGIN',
        time: baseTime + 2000,
      });

      monitoring.logError('test-2', 'Failed');
    });

    it('should analyze logs', () => {
      const insights = monitoring.analyzeLogs('TestComponent');

      expect(insights.totalTransitions).toBe(4);
      expect(insights.errorCount).toBe(1);
      expect(insights.mostCommonStates.length).toBeGreaterThan(0);
    });

    it('should detect high error rates', () => {
      // Add more errors
      for (let i = 0; i < 5; i++) {
        monitoring.logError(`test-${i}`, 'Error');
      }

      const insights = monitoring.analyzeLogs('TestComponent');
      expect(insights.suggestions.some(s => s.includes('High error rate'))).toBe(true);
    });

    it('should generate summary', () => {
      const summary = monitoring.generateSummary('TestComponent');

      expect(summary).toContain('TestComponent');
      expect(summary).toContain('Total transitions');
      expect(summary).toContain('Errors');
    });

    it('should identify bottlenecks', () => {
      const baseTime = Date.now();

      // Create slow transitions
      for (let i = 0; i < 5; i++) {
        monitoring.logTransition({
          instanceId: `test-${i}`,
          from: 'Processing',
          to: 'Slow',
          event: 'SLOW_OPERATION',
          time: baseTime + i * 10000,
        });

        monitoring.logTransition({
          instanceId: `test-${i}`,
          from: 'Slow',
          to: 'Complete',
          event: 'DONE',
          time: baseTime + i * 10000 + 6000, // 6 second delay
        });
      }

      const insights = monitoring.analyzeLogs('TestComponent');
      expect(insights.bottlenecks.length).toBeGreaterThan(0);
    });
  });

  describe('Cleanup', () => {
    it('should clear old logs', () => {
      const oldTime = Date.now() - 10000;
      const newTime = Date.now();

      monitoring.logTransition({
        instanceId: 'test-1',
        from: 'Start',
        to: 'Processing',
        event: 'BEGIN',
        time: oldTime,
      });

      monitoring.logTransition({
        instanceId: 'test-2',
        from: 'Start',
        to: 'Processing',
        event: 'BEGIN',
        time: newTime,
      });

      monitoring.clearOldLogs(newTime - 1000);

      const logs = monitoring.getAllLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].instanceId).toBe('test-2');
    });
  });
});
