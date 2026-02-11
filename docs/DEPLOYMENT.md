# Telemetry Service Deployment Guide
Quick guide for deploying the Telemetry Service to AWS using AWS CDK.

## Prerequisites
- Node.js 18.x or later
- AWS CLI configured with credentials
- AWS CDK CLI: `npm install -g aws-cdk`

## Quick Start
```bash
# 1. Install dependencies
npm install

# 2. Build
npm run build

# 3. AWS Setup
aws configure
```

# 4. Bootstrap CDK (one-time per account/region)
cdk bootstrap

# 5. Deploy
cdk deploy
```

### Required Permissions

Your IAM user/role needs permissions for:
- CloudFormation, Lambda, DynamoDB, IoT Core, API Gateway, SQS, CloudWatch, IAM, S3

For initial deployment, use `AdministratorAccess` policy. For production, create a custom policy with minimum required permissions.

## Deployment Commands
```bash
# Synthesize CloudFormation template
cdk synth

# Deploy to AWS
cdk deploy

# Destroy stack
cdk destroy
```

## Post-Deployment
### 1. Get API Endpoint

After deployment, note the API endpoint from the output:
```
TelemetryServiceStack.ApiEndpoint = https://abc123.execute-api.us-east-1.amazonaws.com/prod/
```

### 2. Test Health Endpoint
```bash
curl https://YOUR_API_ENDPOINT/prod/health
```

### 3. Configure IoT Devices
See [PUBLISH_TELEMETRY.md](PUBLISH_TELEMETRY.md) for publish some telemetry data.

# Test end-to-end
curl https://YOUR_API_ENDPOINT/prod/telemetry/<chargerId>

## Environment Variables
All Lambda environment variables are auto-configured by CDK:
- `PROCESSOR_LAMBDA_NAME` - Validator Lambda
- `TABLE_NAME` - Processor and Query Lambdas
- `DLQ_URL` - Health Lambda

To deploy to a specific region:
```cmd
set CDK_DEFAULT_REGION=us-west-2
cdk deploy
```

## Production Checklist
- [ ] Run tests: `npm test`
- [ ] Change DynamoDB `removalPolicy` to `RETAIN`
- [ ] Configure CloudWatch alarm notifications (SNS)
- [ ] Enable DynamoDB Point-in-Time Recovery
- [ ] Set up API Gateway throttling
- [ ] Set up API Gateway logging
- [ ] Configure monitoring dashboards
