import { DeployableProject, DeploymentLogUpdate, DeploymentState } from '@mosaiq/nsm-common/types';
import { API_ROUTES } from '@mosaiq/nsm-common/routes';
import { execSafe, HostExecMessage, sendMessageToNsmExecutor } from './execUtils';
import * as fs from 'fs/promises';

export const deployProject = async (deployable: DeployableProject) => {
    try {
        await cloneRepository(deployable);

        await injectDotenv(deployable.projectId, deployable.dotenv, deployable.logId);

        await runDeploymentCommand(deployable.projectId, deployable.runCommand, deployable.timeout, deployable.logId);
        await sendLogToControlPlane(deployable.logId, 'Deployment steps completed successfully.\n', DeploymentState.DEPLOYED);
    } catch (error: any) {
        await sendLogToControlPlane(deployable.logId, `Failed to deploy project: ${error.message}\n`, DeploymentState.FAILED);
        console.error('Failed to deploy project:', error);
    }
};

const cloneRepository = async (deployable: DeployableProject): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping repository clone');
        await sendLogToControlPlane(deployable.logId, 'Not in production mode, skipping repository clone\n', DeploymentState.DEPLOYING);
        return;
    }

    try {
        await sendLogToControlPlane(deployable.logId, 'Cleaning up old repository...\n', DeploymentState.DEPLOYING);
        await fs.rm(`${process.env.DEPLOYMENT_PATH}/${deployable.projectId}`, { recursive: true, force: true });
    } catch (e: any) {
        throw new Error(`Error cleaning up old repository: ${e.message}`);
    }

    try {
        const gitSshUri = `git@github.com:${deployable.repoOwner}/${deployable.repoName}.git`;
        const branchFlags = deployable.repoBranch ? `-b ${deployable.repoBranch} --single-branch` : '';
        const sshFlags = `-c core.sshCommand="/usr/bin/ssh -i ${process.env.GIT_SSH_KEY_PATH}"`;
        const cmd = `git clone --progress ${branchFlags} ${sshFlags} ${gitSshUri} ${process.env.DEPLOYMENT_PATH}/${deployable.projectId}`;
        await sendLogToControlPlane(deployable.logId, `Cloning repository ${gitSshUri}...\n`, DeploymentState.DEPLOYING);
        const { out: gitOut, code: gitCode } = await execSafe(cmd, 1000 * 60 * 5);
        if (gitCode !== 0) {
            await sendLogToControlPlane(deployable.logId, `Git clone output:\n${gitOut}\n`, DeploymentState.DEPLOYING);
            throw new Error(`Git clone exited with code ${gitCode}`);
        }
        await sendLogToControlPlane(deployable.logId, `Git clone output:\n${gitOut}\n`, DeploymentState.DEPLOYING);
        return;
    } catch (e: any) {
        throw new Error(`Error cloning repository: ${e.message}`);
    }
};

const injectDotenv = async (projectId: string, dotenv: string, logId: string): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping dotenv injection');
        await sendLogToControlPlane(logId, 'Not in production mode, skipping dotenv injection\n', DeploymentState.DEPLOYING);
        return;
    }

    try {
        await fs.writeFile(`${process.env.DEPLOYMENT_PATH}/${projectId}/.env`, dotenv);
        await sendLogToControlPlane(logId, 'Successfully injected dotenv file\n', DeploymentState.DEPLOYING);
    } catch (e: any) {
        throw new Error(`Error injecting dotenv file: ${e.message}`);
    }
};

const runDeploymentCommand = async (projectId: string, runCommand: string, timeoutms: number, logId: string): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping deployment execution');
        await sendLogToControlPlane(logId, 'Not in production mode, skipping deployment execution\n', DeploymentState.DEPLOYING);
        return;
    }
    const deploymentCommand = `(cd ${process.env.DEPLOYMENT_PATH}/${projectId} && ${runCommand})`;
    try {
        // Send the command
        const messageInstanceId = crypto.randomUUID();
        const message: HostExecMessage = {
            projectId,
            instanceId: messageInstanceId,
            command: deploymentCommand,
            cleanup: false,
            timeout: timeoutms || undefined,
        };
        console.log('Sending command to executor:', message);
        await sendLogToControlPlane(logId, `Sending command to executor: ${JSON.stringify(message)}\n`, DeploymentState.DEPLOYING);
        const { out: execOut, code: execCode } = await sendMessageToNsmExecutor(message);
        // await updateDeploymentLogModel(logId, { log: execOut });
        if (execCode !== 0) {
            throw new Error(`Error sending command to executor, code ${execCode}: ${execOut}`);
        }

        // Stream in the output
        console.log('Waiting for output file from executor...');
        const outWorkingFilePath = `${process.env.NSM_OUTPUT_PATH}/${projectId}/${messageInstanceId}.out.working`;
        const outFilePath = `${process.env.NSM_OUTPUT_PATH}/${projectId}/${messageInstanceId}.out`;
        const startTime = Date.now();
        const maxEndTime = startTime + timeoutms + 2000;
        while (true) {
            try {
                const workingContents = await fs.readFile(outWorkingFilePath, 'utf-8');
                if (workingContents.length > 0) {
                    console.log('Streaming output from executor...');
                    await fs.truncate(outWorkingFilePath, 0);
                    await sendLogToControlPlane(logId, `${workingContents}\n`, DeploymentState.DEPLOYING);
                }
            } catch (e) {
                console.log('File not found:', e);
                break;
            }
            await new Promise((r) => setTimeout(r, 1000));
            if (Date.now() > maxEndTime) {
                console.warn('Timed out waiting for output file from executor');
                break;
            }
        }
        console.log('Finalizing output file from executor...');
        const outFileContents = await fs.readFile(outFilePath, 'utf-8');
        await sendLogToControlPlane(logId, `${outFileContents}\n`, DeploymentState.DEPLOYING);
        console.log('Deployment command output complete.');

        // Clean up the output
        try {
            await sendLogToControlPlane(logId, 'Cleaning up output files...\n', DeploymentState.DEPLOYING);
            fs.rm(outWorkingFilePath, { recursive: true, force: true });
            fs.rm(outFilePath, { recursive: true, force: true });
        } catch (e: any) {
            console.error('Error cleaning up output files:', e);
            await sendLogToControlPlane(logId, `Not Fatal, but error cleaning up output files: ${e.message}\n`, DeploymentState.DEPLOYING);
        }
    } catch (e: any) {
        console.error('Error running deployment command:', deploymentCommand, e);
        throw new Error(`Error running deployment command: ${e.message}`);
    }
};

const sendLogToControlPlane = async (logId: string, logContents: string, status: DeploymentState): Promise<void> => {
    const message: DeploymentLogUpdate = {
        logId,
        status,
        log: logContents,
    };
    const url = `${process.env.API_URL}${API_ROUTES.POST_DEPLOYMENT_LOG_UPDATE}`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        });
    } catch (e: any) {
        console.error('Error sending log to control plane:', e);
    }
};
