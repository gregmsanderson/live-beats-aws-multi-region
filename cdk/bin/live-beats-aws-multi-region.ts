#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { FoundationStack } from "../lib/foundationStack";
import { PeeringStack } from "../lib/peeringStack";
import { PeeringRoutesStack } from "../lib/peeringRoutesStack";
import { DatabaseStack } from "../lib/databaseStack";
import { AppStack } from "../lib/appStack";
import { RoutingStack } from "../lib/routingStack";

// environment
const envPrimaryRegion = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};
console.log("Primary AWS account/region: " + JSON.stringify(envPrimaryRegion));

const envSecondaryRegion = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.SECONDARY_AWS_REGION,
};
console.log(
  "Secondary AWS account/region: " + JSON.stringify(envSecondaryRegion)
);
if (!process.env.SECONDARY_AWS_REGION) {
  // ... else get e.g "Cross stack/region references are only supported for stacks with an explicit region defined"
  console.warn("Remember to export SECONDARY_AWS_REGION");
}
// also warn if APP_HOSTNAME is not set as app will successfully deploy BUT not work properly. There
// will be a WebSocket error (since PHX_HOST will be blank). So help the user out and warn them
if (!process.env.APP_HOSTNAME) {
  console.log(
    "APP_HOSTNAME not set. Once you know that (likely after deploying the routing stack) run e.g export APP_HOSTNAME=example.com"
  );
}

const stage = "staging";
const appName = "live-beats";

const app = new cdk.App();

const foundationStackPrimary = new FoundationStack(
  app,
  "foundation-stack-primary",
  {
    env: envPrimaryRegion,
    stage: stage,
    appName: appName,
    cidr: "10.0.0.0/22", // /22 is 1024 IPs which is enough for now (peered VPCs can't have overlapping CIDR)
  }
);

// important: since the secondary region's VPC will be peered with the primary's, its CIDR can not overlap
const foundationStackSecondary = new FoundationStack(
  app,
  "foundation-stack-secondary",
  {
    env: envSecondaryRegion,
    stage: stage,
    appName: appName,
    cidr: "10.0.5.0/22", // /22 is 1024 IPs which is enough for now (peered VPCs can't have overlapping CIDR)
  }
);

// the two VPCs need to be peered. That only needs to be done in one VPC
// as the request/response creates a connection.
// IMPORTANT: you would think you could simply do e.g
// vpcs: [foundationStackPrimary.vpc, foundationStackSecondary.vpc]
// ... but no. The secondary VPC is in another region and the CDK complains id not found.
// Can you fetch it using ec2.Vpc.fromLookup ... using that id e.g with
// peerVpcId: foundationStackSecondary.vpc.vpcId ?
// Nope:
// https://github.com/aws/aws-cdk/issues/12754#issuecomment-769786855
// It's a token. Sigh. You can either pass around its ID using SSM, or hard-code in a value
// to avoid needing to. I've hard-coded in a name which is why the secondary VPC's ref/id/name
// etc is not passed to the stack
const peeringStack = new PeeringStack(app, "peering-stack", {
  env: envPrimaryRegion, // which contains the vpc that will peer with a remote one
  crossRegionReferences: true, // must enable cross region references to use reference across stacks, else CF is not happy
  stage: stage,
  appName: appName,
  vpc: foundationStackPrimary.vpc,
});

// why another stack for modifying the routes table once peered? Cross-region complications. If try and create a
// route between VPCs in different regions within one stack, run into:
// InvalidRouteTableID.NotFound (because that route ID is in the *other* region, and new ec2.CfnRoute() does not accept e.g a region param to tell it
// https://github.com/aws/aws-cdk/issues/21694
const peeringRoutesStackPrimary = new PeeringRoutesStack(
  app,
  "peering-routes-stack-primary",
  {
    env: envPrimaryRegion,
    crossRegionReferences: true, // must enable cross region references to use reference across stacks, else CF is not happy
    stage: stage,
    appName: appName,
    vpc: foundationStackPrimary.vpc,
    peeringConnection: peeringStack.peeringConnection,
    destinationCidrBlock: foundationStackSecondary.vpc.vpcCidrBlock, // the other VPC
    peeringConnectionOptions: {
      RequesterPeeringConnectionOptions: {
        AllowDnsResolutionFromRemoteVpc: true, // <- enable it (from the requester's VPC)
      },
    },
  }
);

const peeringRoutesStackSecondary = new PeeringRoutesStack(
  app,
  "peering-routes-stack-secondary",
  {
    env: envSecondaryRegion,
    crossRegionReferences: true, // must enable cross region references to use reference across stacks, else CF is not happy
    stage: stage,
    appName: appName,
    vpc: foundationStackSecondary.vpc,
    peeringConnection: peeringStack.peeringConnection,
    destinationCidrBlock: foundationStackPrimary.vpc.vpcCidrBlock, // the other VPC
    peeringConnectionOptions: {
      AccepterPeeringConnectionOptions: {
        AllowDnsResolutionFromRemoteVpc: true, // <- enable it (from the accepter's VPC)
      },
    },
  }
);

// currently there is only one database, in the primary region
const databaseStack = new DatabaseStack(app, "database-stack", {
  env: envPrimaryRegion,
  crossRegionReferences: true, // must enable cross region references to use reference across stacks, else CF is not happy
  stage: stage,
  appName: appName,
  vpc: foundationStackPrimary.vpc,
  vpcCidrBlocks: [
    foundationStackPrimary.vpc.vpcCidrBlock,
    foundationStackSecondary.vpc.vpcCidrBlock,
  ],
});

const appStackPrimary = new AppStack(app, "app-stack-primary", {
  env: envPrimaryRegion,
  crossRegionReferences: true, // must enable cross region references to use reference across stacks, else CF is not happy
  stage: stage,
  appName: appName,
  appHostname: process.env.APP_HOSTNAME || "", // to avoid a WebSocket error (can't use routingStack.acceleratorHostname yet)
  vpc: foundationStackPrimary.vpc,
  databaseCredentialsSecretArn: databaseStack.databaseCredentialsSecretArn,
  secretKeyBaseSecretArn: "",
  releaseCookieSecretArn: "",
  liveBeatsGitHubClientIdSecretArn: "",
  liveBeatsGitHubClientSecretSecretArn: "",
  containerImageUri: "", // so image will be built locally on-deploy and pushed to ECR
});

const appStackSecondary = new AppStack(app, "app-stack-secondary", {
  env: envSecondaryRegion,
  crossRegionReferences: true, // must enable cross region references to use reference across stacks, else CF is not happy
  stage: stage,
  appName: appName,
  appHostname: process.env.APP_HOSTNAME || "", // to avoid a WebSocket error (can't use routingStack.acceleratorHostname yet)
  vpc: foundationStackSecondary.vpc,
  databaseCredentialsSecretArn: databaseStack.databaseCredentialsSecretArn,
  secretKeyBaseSecretArn: appStackPrimary.secretKeyBaseSecretArn, // secrets not replicated so pass arn from primary
  releaseCookieSecretArn: appStackPrimary.releaseCookieSecretArn, // secrets not replicated so pass arn from primary
  liveBeatsGitHubClientIdSecretArn:
    appStackPrimary.liveBeatsGitHubClientIdSecretArn, // secrets not replicated so pass arn from primary
  liveBeatsGitHubClientSecretSecretArn:
    appStackPrimary.liveBeatsGitHubClientSecretSecretArn, // secrets not replicated so pass arn from primary
  containerImageUri: appStackPrimary.containerImageUri, // so the existing image will be fetched from primary ECR rather than being duplicated in the secondary region
});

// use global accelerator to pick between each region's load balancer
const routingStack = new RoutingStack(app, "routing-stack", {
  env: envPrimaryRegion,
  crossRegionReferences: true, // must enable cross region references to use reference across stacks, else CF is not happy
  stage: stage,
  appName: appName,
  ecsLoadBalancerPrimary: appStackPrimary.ecsLoadBalancer,
  ecsLoadBalancerSecondary: appStackSecondary.ecsLoadBalancer,
});
