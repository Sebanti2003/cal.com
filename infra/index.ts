import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import { config } from "dotenv";

const awsConfig = new pulumi.Config("aws");
const baseConfig = new pulumi.Config("base");

const env = config({ path: "./api/.env.dev" });

const awsRegion = awsConfig.require("region");
const certificateArn = baseConfig.require("certificateArn");
const url = baseConfig.require("url");

console.log("REGION", awsRegion, url, certificateArn);
if (!awsRegion) {
  throw new Error("AWS REGION IS NOT SET");
}

const SECRETS = [
  "API_KEY_PREFIX",
  "CALCOM_LICENSE_KEY",
  "DATABASE_URL",
  "DATABASE_URL_BACKUP",
  "GITHUB_ACCESS_TOKEN",
  "NEXT_PUBLIC_WEBAPP_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "CALENDSO_ENCRYPTION_KEY",
  "EMAIL_FROM",
  "EMAIL_SERVER",
  "GOOGLE_API_CREDENTIALS",
  "GOOGLE_LOGIN_ENABLED",
  "NEXT_PUBLIC_SENDGRID_SENDER_NAME",
  "NEXT_PUBLIC_STRIPE_PUBLIC_KEY",
  "NEXT_PUBLIC_WEBSITE_URL",
  "NEXTAUTH_COOKIE_DOMAIN",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "SENDGRID_API_KEY",
  "SENDGRID_EMAIL",
  "STRIPE_CLIENT_ID",
  "STRIPE_PRIVATE_KEY",
  "TWILIO_MESSAGING_SID",
  "TWILIO_PHONE_NUMBER",
  "TWILIO_SID",
  "TWILIO_TOKEN",
  "TWILIO_VERIFY_SID",
  "YARN_ENABLE_IMMUTABLE_INSTALLS",
].map((secretKey) => {
  if (process.env.NODE_ENV === "development") {
    return `DEV_${secretKey}`;
  }
  return secretKey;
});

// Get Secret
const getSecrets = async () => {
  const res = [];
  for (let index = 0; index < SECRETS.length; index++) {
    try {
      const secretKey = SECRETS[index];
      const secret = await aws.secretsmanager.getSecret({ name: secretKey });
      if (secret && secret.arn) res.push({ name: secretKey, valueFrom: secret.arn });
    } catch (err) {
      console.info("Secret not found:", SECRETS[index]);
    }
  }
  return res;
};

const main = (secrets: { name: string; valueFrom: string }[]) => {
  // Create VPC
  const vpc = new awsx.ec2.Vpc("cal", {
    cidrBlock: "10.0.0.0/16",
  });

  // Create Security Group
  const sg = new aws.ec2.SecurityGroup("webserver-sg", {
    vpcId: vpc.vpcId,
    ingress: [
      {
        description: "allow HTTP access from anywhere",
        fromPort: 80,
        toPort: 80,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
      },
      {
        description: "allow HTTPS access from anywhere",
        fromPort: 443,
        toPort: 443,
        protocol: "tcp",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
    egress: [
      {
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
  });
  // Create ECR Image Repository
  const repository = new awsx.ecr.Repository("repository", {});
  // Create Docker Image of Api and Store in Repo
  const image = new awsx.ecr.Image("cal-api-image", {
    repositoryUrl: repository.url,
    dockerfile: "./api/Dockerfile",
    path: "../",
  });

  // Create ECS cluster
  const cluster = new awsx.classic.ecs.Cluster("cluster", {});

  // Create Application Load Balancer
  const lb = new awsx.lb.ApplicationLoadBalancer("lb", {
    securityGroups: [sg.id],
    subnetIds: vpc.publicSubnetIds,
    defaultTargetGroup: { healthCheck: { matcher: "200-299" }, port: 80, protocol: "HTTP" },
    listeners: [
      {
        port: 80,
        protocol: "HTTP",
        defaultActions: [
          {
            type: "redirect",
            redirect: {
              protocol: "HTTPS",
              port: "443",
              statusCode: "HTTP_301",
            },
          },
        ],
      },
      {
        port: 443,
        protocol: "HTTPS",
        certificateArn: certificateArn,
      },
    ],
  });

  // Create Cloudwatch LogGroup and Stream
  const logGroup = new aws.cloudwatch.LogGroup("cal-api-log-group");
  const logStream = new aws.cloudwatch.LogStream("cal-api-log-stream", {
    logGroupName: logGroup.name,
  });

  // Policy For Secrets
  const secretsManagerAccessPolicy = new aws.iam.Policy("fargate-secrets-policy", {
    policy: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "secretsmanager:GetSecretValue",
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "ecr:GetAuthorizationToken",
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ],
          Resource: "*",
        },
      ],
    },
  });

  // IAM Role To Attach To Fargate Service for Accessing Secrets
  const taskRole = new aws.iam.Role("task-exec-role", {
    assumeRolePolicy: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Principal: {
            Service: "ecs-tasks.amazonaws.com",
          },
          Effect: "Allow",
        },
      ],
    },
  });

  // Attach Policy and Role
  new aws.iam.RolePolicyAttachment("task-exec-policy-attach", {
    role: taskRole,
    policyArn: secretsManagerAccessPolicy.arn,
  });

  // Create Fargate Service
  const service = new awsx.ecs.FargateService("service", {
    cluster: cluster.cluster.arn,
    networkConfiguration: {
      subnets: vpc.privateSubnetIds,
      securityGroups: [sg.id],
      assignPublicIp: true,
    },

    desiredCount: 2,
    taskDefinitionArgs: {
      executionRole: { roleArn: taskRole.arn },
      logGroup: { skip: true },
      runtimePlatform: {
        cpuArchitecture: "ARM64",
      },
      container: {
        name: "test-api",
        image: image.imageUri,
        cpu: 1024,
        memory: 2000,
        essential: true,
        portMappings: [
          {
            containerPort: 80,
            hostPort: 80,
            targetGroup: lb.defaultTargetGroup,
          },
        ],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": logGroup.name,
            "awslogs-stream-prefix": "cal-api",
            "awslogs-region": `${awsRegion}`,
          },
        },
        secrets: secrets ?? [],
      },
    },
  });

  // Create Autoscaling for the ECS service, Scale when CPU > 75%
  const autoscaling = new aws.appautoscaling.Policy("autoscaling", {
    serviceNamespace: "ecs",
    scalableDimension: "ecs:service:DesiredCount",
    resourceId: pulumi.interpolate`service/${cluster.cluster.name}/${service.service.name}`,
    policyType: "TargetTrackingScaling",
    targetTrackingScalingPolicyConfiguration: {
      targetValue: 75.0,
      predefinedMetricSpecification: {
        predefinedMetricType: "ECSServiceAverageCPUUtilization",
      },
      scaleInCooldown: 50,
      scaleOutCooldown: 50,
    },
  });
  // Set Min and Max Number of Tasks
  const autoscalingTarget = new aws.appautoscaling.Target("my-scaling-target", {
    maxCapacity: 4, // maximum number of tasks
    minCapacity: 1, // minimum number of tasks
    resourceId: pulumi.interpolate`service/${cluster.cluster.name}/${service.service.name}`,
    scalableDimension: "ecs:service:DesiredCount",
    serviceNamespace: "ecs",
  });

  return url;
};

getSecrets().then((secrets) => {
  main(secrets);
});
