/**
 * Query Service Lambda Function
 * Retrieves latest telemetry for a given charger
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { StoredEvent, QueryResponse, NotFoundResponse } from '../../types/telemetry';

// Initialize DynamoDB client
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const cloudwatchClient = new CloudWatchClient({});

const TABLE_NAME = process.env.TABLE_NAME || 'TelemetryEvents';
const METRICS_NAMESPACE = 'TelemetryService';

// Publishes CloudWatch metrics for query operations
async function publishQueryMetrics(duration: number): Promise<void> {
  const command = new PutMetricDataCommand({
    Namespace: METRICS_NAMESPACE,
    MetricData: [
      {
        MetricName: 'QueryDuration',
        Value: duration,
        Unit: StandardUnit.Milliseconds,
        Timestamp: new Date(),
      },
    ],
  });

  try {
    await cloudwatchClient.send(command);
  } catch (error) {
    // Log metric publishing errors but don't fail the function
    console.error('Failed to publish query metrics:', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Lambda handler for querying latest telemetry by chargerId
 * 
 * @param event - API Gateway event containing chargerId in path parameters
 * @returns API Gateway response with telemetry data or error
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  
  try {
    // Extract chargerId from path parameters
    const chargerId = event.pathParameters?.chargerId;

    if (!chargerId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'error',
          message: 'Missing required path parameter: chargerId',
        }),
      };
    }

    // Query DynamoDB for latest event
    const command = new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'chargerId = :chargerId',
      ExpressionAttributeValues: {
        ':chargerId': chargerId,
      },
      ScanIndexForward: false, // Sort by timestamp descending
      Limit: 1, // Only return the most recent event
    });

    const result = await docClient.send(command);

    // Publish QueryDuration metric
    const queryDuration = Date.now() - startTime;
    await publishQueryMetrics(queryDuration);

    // Check if any events were found
    if (!result.Items || result.Items.length === 0) {
      const notFoundResponse: NotFoundResponse = {
        status: 'not_found',
        message: 'No telemetry found for charger',
      };

      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(notFoundResponse),
      };
    }

    // Extract the most recent event
    const storedEvent = result.Items[0] as StoredEvent;

    // Format response according to QueryResponse interface
    const response: QueryResponse = {
      chargerId: storedEvent.chargerId,
      timestamp: storedEvent.timestamp,
      data: storedEvent.data,
      metadata: {
        receivedAt: storedEvent.metadata.receivedAt,
        processedAt: storedEvent.metadata.processedAt,
      },
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    // Log error for debugging
    console.error('Error querying telemetry:', error);

    // Publish QueryDuration metric even on error
    const queryDuration = Date.now() - startTime;
    await publishQueryMetrics(queryDuration);

    // Return 500 Internal Server Error for DynamoDB errors
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'error',
        message: 'Internal server error',
      }),
    };
  }
};
