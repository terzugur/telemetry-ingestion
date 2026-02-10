/**
 * Shared type definitions for the Telemetry Service
 */

/**
 * TelemetryEvent - Incoming event from IoT chargers
 * This is the raw event structure received from AWS IoT Core
 */
export interface TelemetryEvent {
  chargerId: string;
  timestamp: string; // ISO8601 format
  data?: Record<string, any>; // Flexible telemetry data
}

/**
 * ValidatedEvent - Event after validation
 * Timestamp is parsed into a Date object for processing
 */
export interface ValidatedEvent {
  chargerId: string;
  timestamp: Date;
  data?: Record<string, any>;
}

/**
 * ProcessedEvent - Event after processing with metadata
 * Includes unique identifier and processing timestamps
 */
export interface ProcessedEvent {
  eventId: string; // UUID
  chargerId: string;
  timestamp: Date;
  data?: Record<string, any>;
  metadata: {
    receivedAt: Date;
    processedAt: Date;
  };
}

/**
 * StoredEvent - Event format in DynamoDB
 * All dates are converted to ISO8601 strings for storage
 */
export interface StoredEvent {
  eventId: string;
  chargerId: string;
  timestamp: string; // ISO8601
  data?: Record<string, any>;
  metadata: {
    receivedAt: string; // ISO8601
    processedAt: string; // ISO8601
  };
  ttl: number; // Unix timestamp for expiration (90 days)
}

/**
 * ValidationError - Structure for validation errors
 */
export interface ValidationError {
  status: 'error';
  message: string;
  code: 'VALIDATION_ERROR';
}

/**
 * HealthCheckResponse - Health check endpoint response
 */
export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    dynamodb: 'healthy' | 'degraded' | 'unhealthy';
    iotCore?: 'healthy' | 'degraded' | 'unhealthy';
    dlqDepth?: number;
  };
}

/**
 * QueryResponse - Response from query endpoint
 */
export interface QueryResponse {
  chargerId: string;
  timestamp: string;
  data?: Record<string, any>;
  metadata: {
    receivedAt: string;
    processedAt: string;
  };
}

/**
 * NotFoundResponse - Response when charger has no telemetry
 */
export interface NotFoundResponse {
  status: 'not_found';
  message: string;
}
