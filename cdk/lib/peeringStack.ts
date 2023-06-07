import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";

export interface PeeringStackProps extends StackProps {
  stage: string;
  appName: string;
  vpc: ec2.Vpc; // the VPC in the primary region (as only need one VPC to make the request)
}

export class PeeringStack extends Stack {
  public readonly peeringConnection: ec2.CfnVPCPeeringConnection;

  constructor(scope: Construct, id: string, props: PeeringStackProps) {
    super(scope, id, props);

    // note: seems CDK throws an error if try to pass in an ec2.Vpc for the secondary region's VPC
    // (because that exists in another region and it's not smart enough to realise that e.g by looking at its arn).
    // So have to fetch the vpc in the secondary region which will then peer with. To further complicate this, there
    // isn't a fromArn() equivalent. Could use th VPC's ID with fromLookup():
    // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.VpcLookupOptions.html
    // ... but can't. Since can't use tokens with Vpc.fromLookup(). Concrete values only. Hence can't use props.peerVpcId
    // either. Would have to either pass its ID between regions using SSM (icky) or hard-code in nam/tags (also icky)
    const secondaryVpc = ec2.Vpc.fromLookup(this, "secondary-vpc", {
      region: process.env.SECONDARY_AWS_REGION,
      vpcName: `${props.stage}-${props.appName}-vpc`, // match the name given in foundation stack
    });

    // peer them
    // Expose the connection for the route stacks to use (can't be done in this stack as the ID
    // of each route in the secondary region would not be found in *this* region. Get a InvalidRouteTableID.NotFound)
    // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ec2.CfnVPCPeeringConnection.html
    this.peeringConnection = new ec2.CfnVPCPeeringConnection(
      this,
      `${props.stage}-${props.appName}-peer`,
      {
        vpcId: props.vpc.vpcId,
        peerVpcId: secondaryVpc.vpcId,
        peerRegion: process.env.SECONDARY_AWS_REGION, // else it can't find it as it will look for it in the same region
      }
    );
  }
}
