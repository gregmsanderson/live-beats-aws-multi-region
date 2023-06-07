# Live Beats (AWS multi-region)

This repository contains the code for deploying the [Live Beats](https://github.com/fly-apps/live_beats) app to AWS Elastic Container Service using the [AWS Cloud Development Kit](https://aws.amazon.com/cdk/).

There are two folders:

- The `app` folder contains a modified version of Live Beats for AWS (for example removing Fly-specific variables).

- The `cdk` folder contains the infrastructure code to deploy it to AWS Elastic Container Service (ECS) in two AWS regions.

## Prerequisites

1. An AWS account. Even if you already have an AWS account, we **strongly** recommend creating a new one. That limits the impact of adverse events. You can group accounts within an [AWS Organization](https://docs.aws.amazon.com/controltower/latest/userguide/organizations.html) to avoid having to repeatedly enter your billing details.

2. The [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install) installed.

3. The [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed and configured.

4. [Docker](https://docs.docker.com/get-docker/) to build an image of the app.

## Deploy to AWS

**Note:** If applicable, add `--profile name` to the `aws` and `cdk` commands below. If _not_ provided, it will default to using your default AWS account.

1. Navigate to the CDK folder:

```bash
cd cdk
```

2. Install NPM packages:

```bash
npm install
```

3. Set the primary AWS region (for example `eu-west-2`):

```bash
aws configure set region eu-west-2
```

4. Export environment variables for the secondary AWS region (for example `us-west-2`) else you will see errors about it not being defined:

```bash
export SECONDARY_AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
export SECONDARY_AWS_REGION=us-west-2
```

Run `echo $SECONDARY_AWS_ACCOUNT_ID` and `echo $SECONDARY_AWS_REGION` to make sure they are correct.

5. Bootstrap the CDK in the primary AWS region:

```bash
cdk bootstrap
```

6. Bootstrap the CDK in the secondary AWS region:

```bash
cdk bootstrap aws://$SECONDARY_AWS_ACCOUNT_ID/$SECONDARY_AWS_REGION
```

Now you can deploy the stacks.

## Foundation stack

1. Deploy the foundation to the primary region which will create a new VPC:

```bash
cdk deploy foundation-stack-primary
```

2. Deploy the foundation to the secondary region which will create a new VPC:

```bash
cdk deploy foundation-stack-secondary
```

3. Those VPCs need to be peered for resources in one to communicate with the other:

```bash
cdk deploy peering-stack
```

4. Add routes to the VPC in the primary region for sending data to its peered VPC:

```bash
cdk deploy peering-routes-stack-primary
```

5. Add routes to the VPC in the secondary region for sending data to its peered VPC:

```bash
cdk deploy peering-routes-stack-secondary
```

## Database stack

1. Deploy the database. There is only one database (in the primary region) to avoid additional complexity and cost.

```bash
cdk deploy database-stack
```

## App stack

**Note:** Make sure Docker is running since when you deploy these next two stacks, an image of `/app` will be built locally.

1. Deploy the app to the primary region:

```bash
cdk deploy app-stack-primary
```

Deploying the app stack creates _placeholder_ secrets (for a GitHub app that doesn't exist yet). Make a note of those. You'll need them later. For example:

```bash
GitHubOAuthClientIDARN = arn:aws:secretsmanager:eu-west-2:12345...long-string
GitHubOAuthClientsecretARN = arn:aws:secretsmanager:eu-west-2:45678...long-string
```

2. Deploy the app to the secondary region:

```bash
cdk deploy app-stack-secondary
```

## Routing stack

Deploy the stack:

```bash
cdk deploy routing-stack
```

Deploying the routing stack should show its accelerator's global hostname. Make a note of it. You'll need that later. For example:

```bash
routing-stack.AcceleratorhostnameexportthisasAPPHOSTNAME = abcdefghi12345.awsglobalaccelerator.com
```

## Prepare the app for launch

1. Live Beats needs to know its own hostname else it shows a WebSocket error. That's the accelerator's DNS hostname, noted above:

```bash
export APP_HOSTNAME="abcdefghi12345.awsglobalaccelerator.com"
```

2. Live Beats uses GitHub for authentication. [Create a GitHub OAuth app](https://github.com/settings/applications/new). Give it a name. Set its Homepage URL to e.g `http://abcdefghi12345.awsglobalaccelerator.com` and its authorization callback URL to `http://abcdefghi12345.awsglobalaccelerator.com/oauth/callbacks/github`. Click the green button. You will be shown its client ID. Click the button below that to _Generate a new client secret_.

You can now update the two placeholder secrets `arn:` noted earlier:

```bash
aws secretsmanager update-secret --secret-id "arn:aws:secretsmanager...the-github-client-id-one" --secret-string "your-github-client-id"
aws secretsmanager update-secret --secret-id "arn:aws:secretsmanager...the-github-client-secret-one" --secret-string "your-github-client-secret"
```

3. In `lib/appStack.ts`, look for `desiredCount: 0`. Change that to `desiredCount: 1` to try one container in each region (we are not using auto-scaling).

Now re-deploy the app stack in each region. That will start a container and fetch the just-updated secrets:

```bash
cdk deploy app-stack-primary
```

```bash
cdk deploy app-stack-secondary
```

Paste the accelerator's hostname in a new browser tab. You should see the Live Beats sign in page. Click the button to sign in using your GitHub app.

## Useful commands

- `cdk synth` to emit a synthesized CloudFormation template which you can scroll through.
- `cdk diff` to compare the stack with its current state.

## Notes

- You will be prompted to approve some deploys (for example if they involve changing IAM policies). You can avoid being asked by adding `--require-approval never`.
- This project uses `v2.81.0"` for `@aws-cdk/*`.
- If you would like to generate your own `SECRET_KEY_BASE` by instead running `mix phx.gen.secret` simply update the secret we made using the same CLI call, as above. Just use the `arn` of _that_ secret which you can get from the stack, CLI or console.
- This particular app uses `libcluster` to let nodes in a cluster communicate with each other. That is currently not possible across AWS regions. Each node is only aware of peers within the same ECS cluster.
- Since this is just a demonstration, we built an image locally. You could adapt the code in `lib/appStack.ts` so _instead_ of `image: ecs.ContainerImage.fromAsset(relativeAppPath)` you would only reference an image/tag in ECR. You would then build, tag and push that image independently (such as from GitHub Actions).

## Clean up

Most AWS Resources incur a cost. Once you are sure you no longer need them, you can delete them all:

```bash
cdk destroy routing-stack
cdk destroy app-stack-secondary
cdk destroy app-stack-primary
cdk destroy database-stack
cdk destroy peering-routes-stack-secondary
cdk destroy peering-routes-stack-primary
cdk destroy peering-stack
cdk destroy foundation-stack-secondary
cdk destroy foundation-stack-primary
```

## HTTPS?

You will have noticed that the global accelerator listens on HTTP/80. If you want to use HTTPS/443, the SSL-termination is done by the load balancer running in each region. For create a HTTPS/443 listener, you must specify an SSL certificate. _That_ means using a domain that you can verify ownership of (by email or DNS), such as `example.com` . ACM can then issue a certificate and it would become available for each load balancer to select. ACM certificates are regional and so you would need to repeat this for both.

You would then modify the app stack to use `443` in place of `80`. For example for the load balancer's listener and its security group.

Finally you would edit your DNS records to CNAME your `example.com` to the accelerator's hostname.

## Errors?

The best place to start debugging is by looking at the logs. For ECS, it logs to Cloudwatch. You can also see its logs by clicking on your ECS cluster, on its service, and then on the "Logs" tab. After a successful deploy you should see something like:

```
17:41:20.680 [info] Access LiveBeatsWeb.Endpoint at http://abcdefg12345.awsglobalaccelerator.com
17:41:20.679 [info] Running LiveBeatsWeb.Endpoint with cowboy 2.9.0 at 0.0.0.0:4000 (http)
```

You should see requests every few seconds to `/signin`. That is the load balancer's health check. For containers to register behind it and be healthy, that needs to report back with a `200` status code:

```
17:41:54.954 request_id=F2WFlghur7wnLQMAAAFy [info] Sent 200 in 1ms
```

If not, any error message should indicate the problem. For example it may complain the database does not exist, or that it could not connect to it. You can then investigate (such as whether the security group allows access from the VPC or whether the VPC are correctly peered).

If you see:

```
17:48:38.799 [error] Could not check origin for Phoenix.Socket transport.
```

... _that_ is likely caused by using a different hostname than the app expects. That results in a WebSocket error (a red panel in the top-right saying "Re-establishing connection"). Make sure the container's `PHX_HOST` environment variable _exactly_ matches the hostname in the browser. In the CDK stack, we set that to the `APP_HOSTNAME`. You should have set that to the accelerator's hostname (as we are not using a custom domain like `example.com`). One thing that is _very_ easy to miss is if the _case_ does not match. For example if the DNS name uses _uppercase_ characters. Browsers can silently convert that to _lowercase_, resulting in the hostname _not_ matching what the app expects (since its case differs).

If you see:

```
18:41:58.620 [warn] [libcluster:ecs] Error {:error, {"InvalidParameterException", "Tasks cannot be empty."}} while determining nodes in cluster via ECS strategy.
```

... check the "Tasks" tab in the AWS console for the service to confirm the tasks are indeed listed as running. Each task has one container and so if you have set that as `2`, there should be two listed.

It's also worth keeping an eye on your database in the RDS console. Check the CPU load and number of connections do not seem excessively high. Any issues with that will of course impact the app. You can try adjusting the `POOL_SIZE` and re-deploying the app stack.
