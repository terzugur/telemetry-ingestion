/**
 * Event Processor Lambda Function
 * 
 * Responsibilities:
 * - Accept validated event from Validator Lambda
 * - Generate unique eventId (UUID)
 * - Enrich event with metadata (receivedAt, processedAt)
 * - Store event in DynamoDB using AWS SDK
 * - Publish CloudWatch metrics (processing duration, success/failure)
 * - Configure Lambda DLQ for failed events
 */

import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { randomUUID } from 'crypto';
import { ValidatedEvent, ProcessedEvent, StoredEvent } from '../../types/telemetry';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const cloudwatchClient = new CloudWatchClient({});

const TABLE_NAME = process.env.TABLE_NAME || 'TelemetryEvents';
const METRICS_NAMESPACE = 'TelemetryService';
const TTL_DAYS = 90;

// Enriches a validated event with metadata
function enrichEvent(validatedEvent: ValidatedEvent): ProcessedEvent {
  const now = new Date();
  
  return {
    eventId: randomUUID(), // Generate unique eventId
    chargerId: validatedEvent.chargerId,
    timestamp: new Date(validatedEvent.timestamp),
    data: validatedEvent.data,
    metadata: {
      receivedAt: now,
      processedAt: now,
    },
  };
}

// Converts ProcessedEvent to StoredEvent format for DynamoDB
function toStoredEvent(processedEvent: ProcessedEvent): StoredEvent {
  const ttl = Math.floor(Date.now() / 1000) + (TTL_DAYS * 24 * 60 * 60);
  
  return {
    eventId: processedEvent.eventId,
    chargerId: processedEvent.chargerId,
    timestamp: processedEvent.timestamp.toISOString(),
    data: processedEvent.data,
    metadata: {
      receivedAt: processedEvent.metadata.receivedAt.toISOString(),
      processedAt: processedEvent.metadata.processedAt.toISOString(),
    },
    ttl,
  };
}

// Stores event in DynamoDB
async function storeEvent(storedEvent: StoredEvent): Promise<void> {
  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: storedEvent,
  });

  await docClient.send(command);
}

// Publishes CloudWatch metrics
async function publishMetrics(
  processingDuration: number,
  status: 'success' | 'failure'
): Promise<void> {
  const command = new PutMetricDataCommand({
    Namespace: METRICS_NAMESPACE,
    MetricData: [
      {
        MetricName: 'ProcessingDuration',
        Value: processingDuration,
        Unit: StandardUnit.Milliseconds,
        Timestamp: new Date(),
      },
      {
        MetricName: 'EventsProcessed',
        Value: 1,
        Unit: StandardUnit.Count,
        Timestamp: new Date(),
        Dimensions: [
          {
            Name: 'Status',
            Value: status,
          },
        ],
      },
    ],
  });

  try {
    await cloudwatchClient.send(command);
  } catch (error) {
    // Log metric publishing errors but don't fail the function
    console.error('Failed to publish metrics:', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Lambda handler for Event Processor
 * Triggered asynchronously by Validator Lambda
 */
export const handler: Handler = async (event: ValidatedEvent) => {
  const startTime = Date.now();
  
  console.log('Processing validated event:', {
    chargerId: event.chargerId,
    timestamp: event.timestamp,
  });

  try {
    const processedEvent = enrichEvent(event);
    
    console.log('Enriched event with metadata:', {
      eventId: processedEvent.eventId,
      chargerId: processedEvent.chargerId,
    });

    // Convert to storage format
    const storedEvent = toStoredEvent(processedEvent);

    await storeEvent(storedEvent);
    
    console.log('Successfully stored event in DynamoDB:', {
      eventId: storedEvent.eventId,
      chargerId: storedEvent.chargerId,
      timestamp: storedEvent.timestamp,
    });

    const processingDuration = Date.now() - startTime;
    await publishMetrics(processingDuration, 'success');

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Event processed successfully',
        eventId: processedEvent.eventId,
      }),
    };
  } catch (error) {
    // Log error with context for debugging
    console.error('Failed to process event:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      event: event,
      timestamp: new Date().toISOString(),
    });

    // Publish failure metrics
    const processingDuration = Date.now() - startTime;
    await publishMetrics(processingDuration, 'failure');

    // Lambda will retry up to 2 times (total 3 attempts) with exponential backoff
    // If all retries fail, event will be sent to DLQ
    throw error;
  }
};
