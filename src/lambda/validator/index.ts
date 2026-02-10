/**
 * Event Validator Lambda Function
 * 
 * Responsibilities:
 * - Accept events from AWS IoT Core trigger
 * - Validate required fields (chargerId, timestamp)
 * - Validate chargerId format (regex: [A-Za-z0-9_-]+)
 * - Validate timestamp format (ISO8601) and ensure not in future
 * - Log validation errors to CloudWatch
 * - Invoke Processor Lambda asynchronously for valid events
 */

import { Handler } from 'aws-lambda';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { TelemetryEvent, ValidatedEvent } from '../../types/telemetry';
import { isValidChargerId, isValidTimestamp, isFutureTimestamp } from '../../utils/validation';

const lambdaClient = new LambdaClient({});
const cloudwatchClient = new CloudWatchClient({});
const PROCESSOR_LAMBDA_NAME = process.env.PROCESSOR_LAMBDA_NAME || 'telemetry-processor';
const METRICS_NAMESPACE = 'TelemetryService';

// Validation result type
interface ValidationResult {
  isValid: boolean;
  error?: string;
  rejectionReason?: string;
  validatedEvent?: ValidatedEvent;
}

// Validates a telemetry event
function validateEvent(event: any): ValidationResult {
  if (!event.chargerId) {
    return {
      isValid: false,
      error: 'Validation failed: missing required field "chargerId"',
      rejectionReason: 'MissingChargerId',
    };
  }

  if (!event.timestamp) {
    return {
      isValid: false,
      error: 'Validation failed: missing required field "timestamp"',
      rejectionReason: 'MissingTimestamp',
    };
  }

  if (!isValidChargerId(event.chargerId)) {
    return {
      isValid: false,
      error: `Validation failed: invalid chargerId format "${event.chargerId}". Must match pattern [A-Za-z0-9_-]+`,
      rejectionReason: 'InvalidChargerIdFormat',
    };
  }

  if (!isValidTimestamp(event.timestamp)) {
    return {
      isValid: false,
      error: `Validation failed: invalid timestamp format "${event.timestamp}". Must be valid ISO8601 format`,
      rejectionReason: 'InvalidTimestampFormat',
    };
  }

  // Parse timestamp for future check
  const parsedTimestamp = new Date(event.timestamp);

  if (isFutureTimestamp(parsedTimestamp)) {
    return {
      isValid: false,
      error: `Validation failed: timestamp "${event.timestamp}" is in the future (beyond 5-minute clock skew tolerance)`,
      rejectionReason: 'FutureTimestamp',
    };
  }

  // Event is valid
  const validatedEvent: ValidatedEvent = {
    chargerId: event.chargerId,
    timestamp: parsedTimestamp,
    data: event.data,
  };

  return {
    isValid: true,
    validatedEvent,
  };
}

// Invokes the Processor Lambda asynchronously
async function invokeProcessorLambda(validatedEvent: ValidatedEvent): Promise<void> {
  const command = new InvokeCommand({
    FunctionName: PROCESSOR_LAMBDA_NAME,
    InvocationType: 'Event', // Asynchronous invocation
    Payload: JSON.stringify(validatedEvent),
  });

  await lambdaClient.send(command);
}

// Publishes CloudWatch metrics for validation
async function publishValidationMetrics(
  validated: boolean,
  rejectionReason?: string
): Promise<void> {
  const metricData = [];

  if (validated) {
    metricData.push({
      MetricName: 'EventsValidated',
      Value: 1,
      Unit: StandardUnit.Count,
      Timestamp: new Date(),
    });
  } else {
    metricData.push({
      MetricName: 'EventsRejected',
      Value: 1,
      Unit: StandardUnit.Count,
      Timestamp: new Date(),
      Dimensions: rejectionReason ? [
        {
          Name: 'RejectionReason',
          Value: rejectionReason,
        },
      ] : undefined,
    });
  }

  const command = new PutMetricDataCommand({
    Namespace: METRICS_NAMESPACE,
    MetricData: metricData,
  });

  try {
    await cloudwatchClient.send(command);
  } catch (error) {
    // Log metric publishing errors but don't fail the function
    console.error('Failed to publish validation metrics:', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Lambda handler for Event Validator
 * Triggered by AWS IoT Core rule
 */
export const handler: Handler = async (event: TelemetryEvent) => {
  console.log('Received event:', JSON.stringify(event));

  // Validate the event
  const validationResult = validateEvent(event);

  if (!validationResult.isValid) {
    console.error('Validation error:', {
      error: validationResult.error,
      event: event,
      timestamp: new Date().toISOString(),
    });
    
    // Publish EventsRejected metric
    await publishValidationMetrics(false, validationResult.rejectionReason);
    
    // Invalid events are logged but not retried
    return;
  }

  // Publish EventsValidated metric
  await publishValidationMetrics(true);

  try {
    await invokeProcessorLambda(validationResult.validatedEvent!);
    console.log('Successfully forwarded event to Processor Lambda:', {
      chargerId: validationResult.validatedEvent!.chargerId,
      timestamp: validationResult.validatedEvent!.timestamp.toISOString(),
    });
  } catch (error) {
    console.error('Failed to invoke Processor Lambda:', {
      error: error instanceof Error ? error.message : String(error),
      event: validationResult.validatedEvent,
    });
    throw error; // Let Lambda retry mechanism handle this
  }
};
