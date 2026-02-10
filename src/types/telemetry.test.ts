/**
 * Basic tests to verify project setup
 */

import * as fc from 'fast-check';
import {
  TelemetryEvent,
  ValidatedEvent,
  ProcessedEvent,
  StoredEvent,
} from './telemetry';

describe('Telemetry Types', () => {
  describe('Type Definitions', () => {
    it('should create a valid TelemetryEvent', () => {
      const event: TelemetryEvent = {
        chargerId: 'CHG001',
        timestamp: '2024-01-15T10:30:00Z',
        data: {
          voltage: 240.5,
          current: 32.0,
        },
      };

      expect(event.chargerId).toBe('CHG001');
      expect(event.timestamp).toBe('2024-01-15T10:30:00Z');
      expect(event.data).toBeDefined();
    });

    it('should create a valid ValidatedEvent', () => {
      const event: ValidatedEvent = {
        chargerId: 'CHG001',
        timestamp: new Date('2024-01-15T10:30:00Z'),
        data: {
          voltage: 240.5,
        },
      };

      expect(event.chargerId).toBe('CHG001');
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('should create a valid ProcessedEvent', () => {
      const event: ProcessedEvent = {
        eventId: '123e4567-e89b-12d3-a456-426614174000',
        chargerId: 'CHG001',
        timestamp: new Date('2024-01-15T10:30:00Z'),
        data: {},
        metadata: {
          receivedAt: new Date(),
          processedAt: new Date(),
        },
      };

      expect(event.eventId).toBeDefined();
      expect(event.metadata.receivedAt).toBeInstanceOf(Date);
      expect(event.metadata.processedAt).toBeInstanceOf(Date);
    });

    it('should create a valid StoredEvent', () => {
      const event: StoredEvent = {
        eventId: '123e4567-e89b-12d3-a456-426614174000',
        chargerId: 'CHG001',
        timestamp: '2024-01-15T10:30:00Z',
        data: {},
        metadata: {
          receivedAt: '2024-01-15T10:30:00Z',
          processedAt: '2024-01-15T10:30:01Z',
        },
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60,
      };

      expect(event.ttl).toBeGreaterThan(0);
      expect(typeof event.timestamp).toBe('string');
    });
  });

  describe('Property-Based Tests - Setup Verification', () => {
    it('should verify fast-check is working with arbitrary strings', () => {
      fc.assert(
        fc.property(fc.string(), (str) => {
          // Property: string length is always non-negative
          return str.length >= 0;
        }),
        { numRuns: 100 }
      );
    });

    it('should verify fast-check is working with arbitrary objects', () => {
      fc.assert(
        fc.property(
          fc.record({
            chargerId: fc.string(),
            timestamp: fc.string(),
          }),
          (obj) => {
            // Property: object has required keys
            return 'chargerId' in obj && 'timestamp' in obj;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
