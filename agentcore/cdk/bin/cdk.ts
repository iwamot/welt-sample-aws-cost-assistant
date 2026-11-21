#!/usr/bin/env node
import { readAgentCoreProject, transformAgentCoreJson } from '@aws/agentcore-cdk';
import { App } from 'aws-cdk-lib';
import { AgentCoreStack } from '../lib/cdk-stack';

// `cdk` sets CDK_DEFAULT_ACCOUNT from the credentials that run it, so the stack goes to
// the caller's account without a file that names it. The stack goes to us-east-1 unless
// STACK_REGION names another Region. The sample doesn't read AWS_REGION or the profile's
// Region, so a Region set for other work in the shell doesn't move the stack.
const account = process.env.CDK_DEFAULT_ACCOUNT;
if (!account) {
  throw new Error('Run cdk with AWS credentials.');
}
const region = process.env.STACK_REGION || 'us-east-1';

// The target name goes into the stack name and the names of the main resources, so a
// different TARGET_NAME deploys a separate copy of the assistant.
const target = { name: process.env.TARGET_NAME || 'default', account, region };
const project = readAgentCoreProject();
const app = new App();
new AgentCoreStack(app, `AgentCore-${project.projectName}-${target.name}`, {
  env: { account, region },
  application: transformAgentCoreJson(project.agentCoreJson, {
    projectRoot: project.projectRoot,
    target,
  }),
});
app.synth();
