import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";

export interface FoundationStackProps extends StackProps {
  stage: string;
  appName: string;
  cidr: string;
}

export class FoundationStack extends Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    // vpc
    // https://docs.aws.amazon.com/vpc/latest/userguide/vpc-cidr-blocks.html
    // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.VpcProps.html#interface-vpcprops
    // note: cidr is used in their example but is deprecated. Supports between /16 (65k IPs) and /28 (16 IPs).
    // note: had to set a vpcName since while it would be fine not to here, when it later comes to peering
    // with the VPC in the other AWS region ... can't pass a reference, or even its ID as a prop. Doesn't work because
    // it's cross-region. CDK errors. So need to use fromLookup() ... but that needs to use e.g a name, known in advance, Hence
    // giving each VPC a name so it can then be fetched using that name in the peeringStack
    this.vpc = new ec2.Vpc(this, `${props.stage}-${props.appName}-vpc`, {
      vpcName: `${props.stage}-${props.appName}-vpc`,
      ipAddresses: ec2.IpAddresses.cidr(props.cidr),
      natGateways: 0, // to reduce cost (default is to make NAT gateway, and one per AZ)
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24, // change as needed
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24, // change as needed
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });
  }
}
