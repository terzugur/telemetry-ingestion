import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TelemetryServiceStack } from '../lib/telemetry-service-stack';

const app = new cdk.App();

new TelemetryServiceStack(app, 'TelemetryServiceStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'Telemetry Service for IoT Chargers',
});
