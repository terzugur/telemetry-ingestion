import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * Main CDK Stack for Telemetry Service
 * 
 * This stack will contain:
 * - DynamoDB table for telemetry storage
 * - Lambda functions (Validator, Processor, Query)
 * - AWS IoT Core rules
 * - API Gateway for query endpoint
 * - SQS Dead Letter Queue
 * - CloudWatch alarms and metrics
 */
export class TelemetryServiceStack extends cdk.Stack {
  public readonly telemetryTable: dynamodb.Table;
  public readonly validatorLambda: nodejs.NodejsFunction;
  public readonly processorLambda: nodejs.NodejsFunction;
  public readonly processorDLQ: sqs.Queue;
  public readonly queryLambda: nodejs.NodejsFunction;
  public readonly healthLambda: nodejs.NodejsFunction;
  public readonly iotRule: iot.CfnTopicRule;
  public readonly iotRuleLogGroup: logs.LogGroup;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.telemetryTable = new dynamodb.Table(this, 'TelemetryEvents', {
      tableName: 'TelemetryEvents',
      partitionKey: {
        name: 'chargerId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development; use RETAIN in production
    });

    this.validatorLambda = new nodejs.NodejsFunction(this, 'ValidatorLambda', {
      functionName: 'telemetry-validator',
      entry: path.join(__dirname, '../src/lambda/validator/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        PROCESSOR_LAMBDA_NAME: 'telemetry-processor',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'], // AWS SDK v3 is included in Lambda runtime
      },
    });

    // Create Dead Letter Queue for failed events
    this.processorDLQ = new sqs.Queue(this, 'ProcessorDLQ', {
      queueName: 'telemetry-processor-dlq',
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // Create Processor Lambda
    this.processorLambda = new nodejs.NodejsFunction(this, 'ProcessorLambda', {
      functionName: 'telemetry-processor',
      entry: path.join(__dirname, '../src/lambda/processor/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.telemetryTable.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'], // AWS SDK v3 is included in Lambda runtime
      },
      // Configure retry behavior and DLQ
      retryAttempts: 2, // Total 3 attempts (1 initial + 2 retries)
      onFailure: new cdk.aws_lambda_destinations.SqsDestination(this.processorDLQ),
    });

    // Grant Processor Lambda permissions to write to DynamoDB
    this.telemetryTable.grantWriteData(this.processorLambda);

    // Grant Processor Lambda permissions to publish CloudWatch metrics
    this.processorLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    // Update Validator Lambda environment with Processor Lambda name
    this.validatorLambda.addEnvironment('PROCESSOR_LAMBDA_NAME', this.processorLambda.functionName);

    // Grant Validator Lambda permission to invoke Processor Lambda
    this.processorLambda.grantInvoke(this.validatorLambda);

    // Grant Validator Lambda permissions to publish CloudWatch metrics
    this.validatorLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    this.queryLambda = new nodejs.NodejsFunction(this, 'QueryLambda', {
      functionName: 'telemetry-query',
      entry: path.join(__dirname, '../src/lambda/query/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.telemetryTable.tableName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'], // AWS SDK v3 is included in Lambda runtime
      },
    });

    // Grant Query Lambda permissions to read from DynamoDB
    this.telemetryTable.grantReadData(this.queryLambda);

    // Grant Query Lambda permissions to publish CloudWatch metrics
    this.queryLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    this.healthLambda = new nodejs.NodejsFunction(this, 'HealthLambda', {
      functionName: 'telemetry-health',
      entry: path.join(__dirname, '../src/lambda/health/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(5),
      memorySize: 256,
      environment: {
        TABLE_NAME: this.telemetryTable.tableName,
        DLQ_URL: this.processorDLQ.queueUrl,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'], // AWS SDK v3 is included in Lambda runtime
      },
    });

    // Grant Health Lambda permissions to describe DynamoDB table
    this.healthLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:DescribeTable'],
      resources: [this.telemetryTable.tableArn],
    }));

    // Grant Health Lambda permissions to read SQS queue attributes
    this.healthLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sqs:GetQueueAttributes'],
      resources: [this.processorDLQ.queueArn],
    }));

    // Create CloudWatch Log Group for IoT Rule errors
    this.iotRuleLogGroup = new logs.LogGroup(this, 'IoTRuleLogGroup', {
      logGroupName: '/aws/iot/rules/telemetry-rule',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For development; use RETAIN in production
    });

    // Grant IoT Core permission to write to CloudWatch Logs
    const iotLogsRole = new iam.Role(this, 'IoTLogsRole', {
      assumedBy: new iam.ServicePrincipal('iot.amazonaws.com'),
      description: 'Role for IoT Core to write logs to CloudWatch',
    });

    iotLogsRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [this.iotRuleLogGroup.logGroupArn],
    }));

    // Grant IoT Core permission to invoke Validator Lambda
    this.validatorLambda.grantInvoke(new iam.ServicePrincipal('iot.amazonaws.com'));

    // Grant IoT Core permission to publish CloudWatch metrics
    const iotMetricsRole = new iam.Role(this, 'IoTMetricsRole', {
      assumedBy: new iam.ServicePrincipal('iot.amazonaws.com'),
      description: 'Role for IoT Core to publish CloudWatch metrics',
    });

    iotMetricsRole.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    // Create IoT Rule to route messages from telemetry/+ topic to Validator Lambda
    this.iotRule = new iot.CfnTopicRule(this, 'TelemetryIoTRule', {
      ruleName: 'telemetry_rule',
      topicRulePayload: {
        sql: "SELECT * FROM 'telemetry/+'",
        description: 'Route telemetry events from IoT chargers to Validator Lambda',
        actions: [
          {
            lambda: {
              functionArn: this.validatorLambda.functionArn,
            },
          },
          {
            cloudwatchMetric: {
              metricName: 'EventsReceived',
              metricNamespace: 'TelemetryService',
              metricUnit: 'None',
              metricValue: '1',
              roleArn: iotMetricsRole.roleArn,
            },
          },
        ],
        errorAction: {
          cloudwatchLogs: {
            logGroupName: this.iotRuleLogGroup.logGroupName,
            roleArn: iotLogsRole.roleArn,
          },
        },
        awsIotSqlVersion: '2016-03-23',
      },
    });

    // Ensure the IoT Rule depends on the Lambda permission
    this.iotRule.node.addDependency(this.validatorLambda);

    // Create REST API
    this.api = new apigateway.RestApi(this, 'TelemetryApi', {
      restApiName: 'Telemetry Service API',
      description: 'API for querying telemetry data from IoT chargers',
      deployOptions: {
        stageName: 'prod',
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Create /telemetry resource
    const telemetryResource = this.api.root.addResource('telemetry');
    
    // Create /telemetry/{chargerId} resource
    const chargerResource = telemetryResource.addResource('{chargerId}');
    
    // Create request/response models
    const errorResponseModel = this.api.addModel('ErrorResponse', {
      contentType: 'application/json',
      modelName: 'ErrorResponse',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          status: { type: apigateway.JsonSchemaType.STRING },
          message: { type: apigateway.JsonSchemaType.STRING },
        },
        required: ['status', 'message'],
      },
    });

    const telemetryResponseModel = this.api.addModel('TelemetryResponse', {
      contentType: 'application/json',
      modelName: 'TelemetryResponse',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          chargerId: { type: apigateway.JsonSchemaType.STRING },
          timestamp: { type: apigateway.JsonSchemaType.STRING },
          data: { type: apigateway.JsonSchemaType.OBJECT },
          metadata: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              receivedAt: { type: apigateway.JsonSchemaType.STRING },
              processedAt: { type: apigateway.JsonSchemaType.STRING },
            },
          },
        },
        required: ['chargerId', 'timestamp', 'data', 'metadata'],
      },
    });

    // Integrate Query Lambda with GET /telemetry/{chargerId}
    const queryIntegration = new apigateway.LambdaIntegration(this.queryLambda, {
      proxy: true,
      allowTestInvoke: true,
    });

    chargerResource.addMethod('GET', queryIntegration, {
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': telemetryResponseModel,
          },
        },
        {
          statusCode: '404',
          responseModels: {
            'application/json': errorResponseModel,
          },
        },
        {
          statusCode: '500',
          responseModels: {
            'application/json': errorResponseModel,
          },
        },
      ],
    });

    // Output API endpoint URL
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.api.url,
      description: 'Telemetry Service API endpoint',
      exportName: 'TelemetryApiEndpoint',
    });

    // Create /health resource
    const healthResource = this.api.root.addResource('health');
    
    // Create health response model
    const healthResponseModel = this.api.addModel('HealthResponse', {
      contentType: 'application/json',
      modelName: 'HealthResponse',
      schema: {
        type: apigateway.JsonSchemaType.OBJECT,
        properties: {
          status: { 
            type: apigateway.JsonSchemaType.STRING,
            enum: ['healthy', 'degraded', 'unhealthy'],
          },
          components: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              dynamodb: { 
                type: apigateway.JsonSchemaType.STRING,
                enum: ['healthy', 'degraded', 'unhealthy'],
              },
              dlq: { 
                type: apigateway.JsonSchemaType.STRING,
                enum: ['healthy', 'degraded', 'unhealthy'],
              },
              dlqDepth: { type: apigateway.JsonSchemaType.NUMBER },
            },
          },
        },
        required: ['status', 'components'],
      },
    });

    // Integrate Health Lambda with GET /health
    const healthIntegration = new apigateway.LambdaIntegration(this.healthLambda, {
      proxy: true,
      allowTestInvoke: true,
    });

    healthResource.addMethod('GET', healthIntegration, {
      methodResponses: [
        {
          statusCode: '200',
          responseModels: {
            'application/json': healthResponseModel,
          },
        },
        {
          statusCode: '500',
          responseModels: {
            'application/json': healthResponseModel,
          },
        },
      ],
    });


    // ALARMS
    // Alarm 1: Validation error rate > 5%
    const validationErrorRateAlarm = new cloudwatch.Alarm(this, 'ValidationErrorRateAlarm', {
      alarmName: 'TelemetryService-ValidationErrorRate',
      alarmDescription: 'Alert when validation error rate exceeds 5%',
      metric: new cloudwatch.MathExpression({
        expression: '(rejected / (validated + rejected)) * 100',
        usingMetrics: {
          validated: new cloudwatch.Metric({
            namespace: 'TelemetryService',
            metricName: 'EventsValidated',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          rejected: new cloudwatch.Metric({
            namespace: 'TelemetryService',
            metricName: 'EventsRejected',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm 2: Processing error rate > 5%
    const processingErrorRateAlarm = new cloudwatch.Alarm(this, 'ProcessingErrorRateAlarm', {
      alarmName: 'TelemetryService-ProcessingErrorRate',
      alarmDescription: 'Alert when processing error rate exceeds 5%',
      metric: new cloudwatch.MathExpression({
        expression: '(failures / (successes + failures)) * 100',
        usingMetrics: {
          successes: new cloudwatch.Metric({
            namespace: 'TelemetryService',
            metricName: 'EventsProcessed',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            dimensionsMap: {
              Status: 'success',
            },
          }),
          failures: new cloudwatch.Metric({
            namespace: 'TelemetryService',
            metricName: 'EventsProcessed',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
            dimensionsMap: {
              Status: 'failure',
            },
          }),
        },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm 3: Query latency p95 > 200ms
    const queryLatencyAlarm = new cloudwatch.Alarm(this, 'QueryLatencyAlarm', {
      alarmName: 'TelemetryService-QueryLatency',
      alarmDescription: 'Alert when query latency p95 exceeds 200ms',
      metric: new cloudwatch.Metric({
        namespace: 'TelemetryService',
        metricName: 'QueryDuration',
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 200,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm 4: DLQ depth > 10 messages
    const dlqDepthAlarm = new cloudwatch.Alarm(this, 'DLQDepthAlarm', {
      alarmName: 'TelemetryService-DLQDepth',
      alarmDescription: 'Alert when DLQ depth exceeds 10 messages',
      metric: this.processorDLQ.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Output alarm ARNs for reference
    new cdk.CfnOutput(this, 'ValidationErrorRateAlarmArn', {
      value: validationErrorRateAlarm.alarmArn,
      description: 'Validation error rate alarm ARN',
    });

    new cdk.CfnOutput(this, 'ProcessingErrorRateAlarmArn', {
      value: processingErrorRateAlarm.alarmArn,
      description: 'Processing error rate alarm ARN',
    });

    new cdk.CfnOutput(this, 'QueryLatencyAlarmArn', {
      value: queryLatencyAlarm.alarmArn,
      description: 'Query latency alarm ARN',
    });

    new cdk.CfnOutput(this, 'DLQDepthAlarmArn', {
      value: dlqDepthAlarm.alarmArn,
      description: 'DLQ depth alarm ARN',
    });
  }
}
