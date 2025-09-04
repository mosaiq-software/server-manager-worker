import { DeployableProject, DeploymentLogUpdate, DeploymentState, NginxConfigLocationType } from '@mosaiq/nsm-common/types';
import { API_ROUTES } from '@mosaiq/nsm-common/routes';
import { assembleDotenv } from '@mosaiq/nsm-common/secretUtil';
import { execSafe, HostExecMessage, sendMessageToNsmExecutor } from './execUtils';
import { get80Server, get443Server, getCustomLocation, getProxyLocation, getRedirectLocation, getStaticLocation } from '@mosaiq/nsm-common/nginx';
import * as fs from 'fs/promises';

export const deployProject = async (deployable: DeployableProject) => {
    try {
        await cloneRepository(deployable.projectId, deployable.repoOwner, deployable.repoName, deployable.logId);

        const dotenv = assembleDotenv(deployable.secrets);
        await injectDotenv(deployable.projectId, dotenv, deployable.logId);
        // TODO handle nginx here

        await runDeploymentCommand(deployable.projectId, deployable.runCommand, deployable.timeout, deployable.logId);
        sendLogToControlPlane(deployable.logId, 'Deployment steps completed successfully.\n', DeploymentState.DEPLOYED);
    } catch (error: any) {
        sendLogToControlPlane(deployable.logId, `Failed to deploy project: ${error.message}\n`, DeploymentState.FAILED);
        console.error('Failed to deploy project:', error);
    }
};

const cloneRepository = async (projectId: string, repoOwner: string, repoName: string, logId: string): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping repository clone');
        sendLogToControlPlane(logId, 'Not in production mode, skipping repository clone\n', DeploymentState.DEPLOYING);
        return;
    }

    try {
        sendLogToControlPlane(logId, 'Cleaning up old repository...\n', DeploymentState.DEPLOYING);
        await fs.rm(`${process.env.DEPLOYMENT_PATH}/${projectId}`, { recursive: true, force: true });
    } catch (e: any) {
        throw new Error(`Error cleaning up old repository: ${e.message}`);
    }

    try {
        const gitSshUri = `git@github.com:${repoOwner}/${repoName}.git`;
        const cmd = `git clone --progress -c core.sshCommand="/usr/bin/ssh -i ${process.env.GIT_SSH_KEY_PATH}" ${gitSshUri} ${process.env.DEPLOYMENT_PATH}/${projectId}`;
        sendLogToControlPlane(logId, `Cloning repository ${gitSshUri}...\n`, DeploymentState.DEPLOYING);
        const { out: gitOut, code: gitCode } = await execSafe(cmd, 1000 * 60 * 5);
        if (gitCode !== 0) {
            throw new Error(`Git clone exited with code ${gitCode}`);
        }
        return;
    } catch (e: any) {
        throw new Error(`Error cloning repository: ${e.message}`);
    }
};

const injectDotenv = async (projectId: string, dotenv: string, logId: string): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping dotenv injection');
        sendLogToControlPlane(logId, 'Not in production mode, skipping dotenv injection\n', DeploymentState.DEPLOYING);
        return;
    }

    try {
        await fs.writeFile(`${process.env.DEPLOYMENT_PATH}/${projectId}/.env`, dotenv);
        sendLogToControlPlane(logId, 'Successfully injected dotenv file\n', DeploymentState.DEPLOYING);
    } catch (e: any) {
        throw new Error(`Error injecting dotenv file: ${e.message}`);
    }
};

const runDeploymentCommand = async (projectId: string, runCommand: string, timeoutms: number, logId: string): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping deployment execution');
        sendLogToControlPlane(logId, 'Not in production mode, skipping deployment execution\n', DeploymentState.DEPLOYING);
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
        sendLogToControlPlane(logId, `Sending command to executor: ${JSON.stringify(message)}\n`, DeploymentState.DEPLOYING);
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
                    sendLogToControlPlane(logId, `${workingContents}\n`, DeploymentState.DEPLOYING);
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
        sendLogToControlPlane(logId, `${outFileContents}\n`, DeploymentState.DEPLOYING);
        console.log('Deployment command output complete.');

        // Clean up the output
        try {
            sendLogToControlPlane(logId, 'Cleaning up output files...\n', DeploymentState.DEPLOYING);
            fs.rm(outWorkingFilePath, { recursive: true, force: true });
            fs.rm(outFilePath, { recursive: true, force: true });
        } catch (e: any) {
            console.error('Error cleaning up output files:', e);
            sendLogToControlPlane(logId, `Not Fatal, but error cleaning up output files: ${e.message}\n`, DeploymentState.DEPLOYING);
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

export const getWorkerNodeNginxConfigForProject = (project: DeployableProject) => {
    const conf = project.nginxConfig;
    if (!conf) return '';
    const servers: string[] = [];
    const upstreams: string[] = [];
    for (const server of conf.servers) {
        const hostnames = server.wildcardSubdomain ? [server.domain, `*.${server.domain}`] : [server.domain];
        const server80 = get80Server(hostnames);
        servers.push(server80);
        const locations: string[] = [];
        for (const location of server.locations) {
            switch (location.type) {
                case NginxConfigLocationType.STATIC:
                    locations.push(getStaticLocation(location));
                    break;
                case NginxConfigLocationType.PROXY:
                    {
                        // const upstreamGroup = `${project.id}_${server.index}_${location.index}`;
                        // const serverNames = server.locations.push(getProxyLocation(location));
                        locations.push(getProxyLocation(location));
                    }
                    break;
                case NginxConfigLocationType.REDIRECT:
                    locations.push(getRedirectLocation(location));
                    break;
                case NginxConfigLocationType.CUSTOM:
                    locations.push(getCustomLocation(location));
                    break;
                default:
                    throw new Error(`Unknown location type: ${(location as any).type}`);
            }
        }
        const server443 = get443Server(hostnames, locations);
        servers.push(server443);
    }

    return `
# Generated by the Node Server Manager ${new Date().toISOString()}
${servers.join('\n')}
`;
};
