// unfortunately as of June 2023 the AWS CDK does not support enabling private DNS resolution
// and so need a Construct for that
// https://repost.aws/questions/QUZSJe446oT2-YqWXAy-rG4Q/questions/QUZSJe446oT2-YqWXAy-rG4Q/enable-private-dns-resolution-on-peered-vpcs-using-cloudformation?
// https://gist.github.com/lfittl/78aef8a950bd1210fa67275994cb394d
// https://stackoverflow.com/questions/65213615/cdk-to-enable-dns-resolution-for-vpcpeering

import { custom_resources } from "aws-cdk-lib";
import { aws_ec2 as ec2, aws_iam as iam, aws_logs as logs } from "aws-cdk-lib";
import { Construct } from "constructs";

export interface AllowVPCPeeringDNSResolutionProps {
  vpcPeering: ec2.CfnVPCPeeringConnection;
  peeringConnectionOptions: object;
}

export class AllowVPCPeeringDNSResolution extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: AllowVPCPeeringDNSResolutionProps
  ) {
    super(scope, id);

    const onCreate: custom_resources.AwsSdkCall = {
      service: "EC2",
      action: "modifyVpcPeeringConnectionOptions",
      parameters: {
        VpcPeeringConnectionId: props.vpcPeering.ref,
        ...props.peeringConnectionOptions, // why? Can't send both else get e.g "Accepter's VPC Peering connection options cannot be modified for a different region"
      },
      physicalResourceId: custom_resources.PhysicalResourceId.of(
        `allowVPCPeeringDNSResolution:${props.vpcPeering.ref}`
      ),
    };
    const onUpdate = onCreate;
    const onDelete: custom_resources.AwsSdkCall = {
      service: "EC2",
      action: "modifyVpcPeeringConnectionOptions",
      parameters: {
        // as with create, trying to change this option for another region throws an error but without a route between VPCs (deleted as part of the same stack), reverting the DNS resolution onDelete back to false (the default) won't matter?
      },
    };

    const customResource = new custom_resources.AwsCustomResource(
      this,
      "allow-peering-dns-resolution",
      {
        installLatestAwsSdk: false, // for why see https://github.com/aws/aws-cdk/issues/23113#issuecomment-1372205791
        policy: custom_resources.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            resources: ["*"],
            actions: ["ec2:ModifyVpcPeeringConnectionOptions"],
          }),
        ]),
        logRetention: logs.RetentionDays.ONE_DAY,
        onCreate,
        onUpdate,
        onDelete,
      }
    );

    customResource.node.addDependency(props.vpcPeering);
  }
}
