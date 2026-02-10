## Architecture 
<img width="1679" height="976" alt="image" src="https://github.com/user-attachments/assets/c7f0257f-2748-42c6-aaa8-c7da2ee4ecfc" />

## Check out /docs folder for the deployment instructions and how to publish telemetry data

## Key Decisions & Reasoning
### AWS IoT Core Choice
While we could have received messages over plain HTTP, AWS IoT Core was chosen for added security and serverless integration. It provides certificate-based authentication, making communication with devices more secure. 

It also allows two-way communication: the server can send messages to devices when needed, for example for debugging, firmware updates, software updates etc.

### Lambda for Compute
Lambda was chosen for compute because it’s serverless, cost-effective, and easy to manage. Even though the load is relatively predictable (we probably know roughly how often devices send data and how many devices there are), starting with Lambda keeps costs low and setup simple.

Note: Direct Lambda-to-Lambda invocation is generally not best practice. In a full production setup, SQS would normally be used between Lambdas to decouple processing and improve reliability.

### DynamoDB Choice

DynamoDB was chosen as the storage layer, though it’s a bit of a trade-off since costs can grow with scale. Alternative storage options could depend on the type of telemetry data: for example, if telemetry consists of numeric values, and since timestamp is defined in the task, Amazon Timestream could be a more cost-efficient option.  

However, Timestream doesn’t allow deleting individual records or updating, which can be a limitation. Using DynamoDB with TTL helps reduce storage costs while keeping flexibility for data retention and deletion or updating.

And streams can be used to trigger alarms for example if we havent received any telemetry data for x minutes from a charger, alarms can be triggered 


### API Gateway Choice
API Gateway was used to expose the telemetry query Lambda via HTTP. API Gateway can be integrated with AWS WAF to add an extra layer of security, filtering requests based on IP, rate limits, or other rules before they reach the Lambda.

### Tools i used
- ** AWS Kiro ** – experimented with it for this project
- app.diagrams.net for the diagram