import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib/core";
import * as elasticloadbalancingv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as globalaccelerator from "aws-cdk-lib/aws-globalaccelerator";
import * as globalaccelerator_endpoints from "aws-cdk-lib/aws-globalaccelerator-endpoints";

export interface RoutingStackProps extends StackProps {
  stage: string;
  appName: string;
  ecsLoadBalancerPrimary: elasticloadbalancingv2.ApplicationLoadBalancer;
  ecsLoadBalancerSecondary: elasticloadbalancingv2.ApplicationLoadBalancer;
}

export class RoutingStack extends Stack {
  public readonly acceleratorHostname: string;

  constructor(scope: Construct, id: string, props: RoutingStackProps) {
    super(scope, id, props);

    // note: give it a name if its name is not lowercase
    const accelerator = new globalaccelerator.Accelerator(
      this,
      `${props.stage}-${props.appName}-accelerator`,
      {
        //acceleratorName: `${props.stage}-${props.appName}-accelerator`,
      }
    );

    // ideally appStack could fetch this as props for appHostname (which it uses for PHX_HOST)
    // but the problem is at that point the accelerator does not exist. And can't create it
    // in advance since it needs at least one endpoint And that endpoint is a load balancer. Which is created
    // for the app! Hmm.
    this.acceleratorHostname = accelerator.dnsName;

    const acceleratorListener = accelerator.addListener(
      `${props.stage}-${props.appName}-accelerator-listener`,
      {
        //listenerName: `${props.stage}-${props.appName}-accelerator-listener`,
        clientAffinity: globalaccelerator.ClientAffinity.SOURCE_IP,
        portRanges: [{ fromPort: 80 }],
      }
    );

    // first endpoint group, for the load balancer in the primary region
    acceleratorListener.addEndpointGroup(
      `${props.stage}-${props.appName}-accelerator-listener-group1`,
      {
        region: props.env?.region,
        healthCheckInterval: Duration.seconds(10),
        healthCheckPath: "/signin",
        healthCheckThreshold: 1,
        healthCheckProtocol: globalaccelerator.HealthCheckProtocol.HTTP,
        endpoints: [
          new globalaccelerator_endpoints.ApplicationLoadBalancerEndpoint(
            props.ecsLoadBalancerPrimary,
            { preserveClientIp: true, weight: 128 }
          ),
        ],
      }
    );

    // second endpoint group, for the load balancer in the secondary region
    acceleratorListener.addEndpointGroup(
      `${props.stage}-${props.appName}-accelerator-listener-group2`,
      {
        region: process.env.SECONDARY_AWS_REGION,
        healthCheckInterval: Duration.seconds(10),
        healthCheckPath: "/signin",
        healthCheckThreshold: 1,
        healthCheckProtocol: globalaccelerator.HealthCheckProtocol.HTTP,
        endpoints: [
          new globalaccelerator_endpoints.ApplicationLoadBalancerEndpoint(
            props.ecsLoadBalancerSecondary,
            { preserveClientIp: true, weight: 128 }
          ),
        ],
      }
    );

    // show hostname
    new cdk.CfnOutput(
      this,
      "Accelerator hostname (export as APP_HOSTNAME before you deploy the app stacks)",
      {
        value: this.acceleratorHostname,
      }
    );
  }
}
