/**
 * Health Check Lambda Function
 * Checks the health status of the Telemetry Service components
 */

import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});
const sqsClient = new SQSClient({});

const TABLE_NAME = process.env.TABLE_NAME || 'TelemetryEvents';
const DLQ_URL = process.env.DLQ_URL;

interface ComponentStatus {
  dynamodb: 'healthy' | 'degraded' | 'unhealthy';
  dlq?: 'healthy' | 'degraded' | 'unhealthy';
  dlqDepth?: number;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: ComponentStatus;
}

// Check DynamoDB table status
async function checkDynamoDBHealth(): Promise<'healthy' | 'unhealthy'> {
  try {
    const command = new DescribeTableCommand({
      TableName: TABLE_NAME,
    });
    
    const response = await dynamoClient.send(command);
    
    // Check if table is active
    if (response.Table?.TableStatus === 'ACTIVE') {
      return 'healthy';
    }
    
    return 'unhealthy';
  } catch (error) {
    console.error('Error checking DynamoDB health:', error);
    return 'unhealthy';
  }
}

// Check SQS Dead Letter Queue depth
async function checkDLQHealth(): Promise<{ status: 'healthy' | 'degraded'; depth: number }> {
  if (!DLQ_URL) {
    // If DLQ URL is not configured, assume healthy
    return { status: 'healthy', depth: 0 };
  }

  try {
    const command = new GetQueueAttributesCommand({
      QueueUrl: DLQ_URL,
      AttributeNames: ['ApproximateNumberOfMessages'],
    });
    
    const response = await sqsClient.send(command);
    const depth = parseInt(response.Attributes?.ApproximateNumberOfMessages || '0', 10);
    
    // Degraded if DLQ has more than 10 messages
    const status = depth > 10 ? 'degraded' : 'healthy';
    
    return { status, depth };
  } catch (error) {
    console.error('Error checking DLQ health:', error);
    // If we can't check DLQ, assume healthy (don't fail health check)
    return { status: 'healthy', depth: 0 };
  }
}

/**
 * Lambda handler for health check endpoint
 * 
 * @param event - API Gateway event
 * @returns API Gateway response with health status
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Run health checks in parallel for speed
    const [dynamoHealth, dlqHealth] = await Promise.all([
      checkDynamoDBHealth(),
      checkDLQHealth(),
    ]);

    // Build component status
    const components: ComponentStatus = {
      dynamodb: dynamoHealth,
    };

    if (DLQ_URL) {
      components.dlq = dlqHealth.status;
      components.dlqDepth = dlqHealth.depth;
    }

    // Determine overall status
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    
    if (dynamoHealth === 'unhealthy') {
      overallStatus = 'unhealthy';
    } else if (dlqHealth.status === 'degraded') {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    const response: HealthResponse = {
      status: overallStatus,
      components,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error in health check:', error);

    // Return unhealthy status if health check itself fails
    const response: HealthResponse = {
      status: 'unhealthy',
      components: {
        dynamodb: 'unhealthy',
      },
    };

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    };
  }
};
