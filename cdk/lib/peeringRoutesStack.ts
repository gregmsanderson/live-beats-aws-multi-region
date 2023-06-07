import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { AllowVPCPeeringDNSResolution } from "./allowVPCPeeringDNSResolutionConstruct";

export interface PeeringRoutesStackProps extends StackProps {
  stage: string;
  appName: string;
  vpc: ec2.Vpc; // the VPC in the primary region
  peeringConnection: ec2.CfnVPCPeeringConnection;
  destinationCidrBlock: string; // CIDR in the other VPC
  peeringConnectionOptions: object;
}

export class PeeringRoutesStack extends Stack {
  constructor(scope: Construct, id: string, props: PeeringRoutesStackProps) {
    super(scope, id, props);

    // enable private DNS resolution. That is not enabled by default.
    // https://docs.aws.amazon.com/vpc/latest/peering/modify-peering-connections.html#vpc-peering-dns
    // But ... doing that is not supported by the AWS CDK (as of June 2023):
    // https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/169
    // Hmm. That is a problem. This stack uses RDS, which has a hostname. Would that resolve
    // from a peered VPC? Hmm. This idea was from:
    // https://gist.github.com/lfittl/78aef8a950bd1210fa67275994cb394d
    // which in turn was from
    // https://stackoverflow.com/questions/65213615/cdk-to-enable-dns-resolution-for-vpcpeering
    // ... so until it is supported in the CDK, this will have to do
    new AllowVPCPeeringDNSResolution(
      this,
      `${props.stage}-${props.appName}-peer-dns-resolution`,
      {
        vpcPeering: props.peeringConnection,
        peeringConnectionOptions: props.peeringConnectionOptions,
      }
    );

    // route from the public subnet(s)
    // https://stackoverflow.com/questions/62525195/adding-entry-to-route-table-with-cdk-typescript-when-its-private-subnet-alread
    props.vpc.publicSubnets.forEach(
      ({ routeTable: { routeTableId } }, index) => {
        new ec2.CfnRoute(
          this,
          `${props.stage}-${props.appName}-route-from-vpc1-public-to-vpc2-${index}`,
          {
            destinationCidrBlock: props.destinationCidrBlock,
            routeTableId,
            vpcPeeringConnectionId: props.peeringConnection.ref,
          }
        );
      }
    );

    // route from the private subnet(s)
    props.vpc.privateSubnets.forEach(
      ({ routeTable: { routeTableId } }, index) => {
        new ec2.CfnRoute(
          this,
          `${props.stage}-${props.appName}-route-from-vpc1-private-to-vpc2-${index}`,
          {
            destinationCidrBlock: props.destinationCidrBlock,
            routeTableId,
            vpcPeeringConnectionId: props.peeringConnection.ref,
          }
        );
      }
    );

    // sigh, isolatedSubnets is a separate array which are ALSO private subnets. Presumably "privateSubnets"
    // are the ones with NAT gateway/egress, while "isolatedSubnets" are private without any egress option. Need
    // those routes too if e.g a database is in a private isolated subnet in one VPC, yet needs to be accessed from
    // a peered VPC
    props.vpc.isolatedSubnets.forEach(
      ({ routeTable: { routeTableId } }, index) => {
        new ec2.CfnRoute(
          this,
          `${props.stage}-${props.appName}-route-from-vpc1-isolated-to-vpc2-${index}`,
          {
            destinationCidrBlock: props.destinationCidrBlock,
            routeTableId,
            vpcPeeringConnectionId: props.peeringConnection.ref,
          }
        );
      }
    );
  }
}
