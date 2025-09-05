import { DeployableProject, DeploymentLogUpdate, DeploymentState } from '@mosaiq/nsm-common/types';
import { API_ROUTES } from '@mosaiq/nsm-common/routes';
import { execOnHost, execSafe, HostExecMessage, sendMessageToNsmExecutor } from './execUtils';
import * as fs from 'fs/promises';

export const deployProject = async (deployable: DeployableProject) => {
    try {
        await cloneRepository(deployable);

        await injectDotenv(deployable.projectId, deployable.dotenv, deployable.logId);
        await handleNginx(deployable.projectId, deployable.nginxConf, deployable.logId);
        await handleCertbot(deployable.domainsToCertify, deployable.logId);
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

const handleNginx = async (projectId: string, nginxConf: string, logId: string): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping nginx configuration');
        await sendLogToControlPlane(logId, 'Not in production mode, skipping nginx configuration\n', DeploymentState.DEPLOYING);
        return;
    }
    const nginxReloadCommand = 'nginx -s reload';
    const nginxConfFile = `${projectId}.conf`;
    const nginxConfPath = `${process.env.CONTROL_PLANE_WORKER_NGINX_DIR}/${nginxConfFile}`;
    try {
        await fs.writeFile(nginxConfPath, nginxConf);
        await sendLogToControlPlane(logId, `Successfully wrote nginx config to ${nginxConfPath}\n`, DeploymentState.DEPLOYING);
    } catch (e: any) {
        throw new Error(`Error writing nginx config file: ${e.message}`);
    }
    try {
        const { out: nginxOut, code: nginxCode } = await execOnHost(nginxReloadCommand, 10000, async (data: string) => {
            await sendLogToControlPlane(logId, data, DeploymentState.DEPLOYING);
        });
    } catch (e: any) {
        throw new Error(`Error reloading nginx: ${e.message}`);
    }
};

const handleCertbot = async (domains: string[], logId: string): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping certbot execution');
        await sendLogToControlPlane(logId, 'Not in production mode, skipping certbot execution\n', DeploymentState.DEPLOYING);
        return;
    }
    if (domains.length === 0) {
        await sendLogToControlPlane(logId, 'No domains to certify, skipping certbot execution\n', DeploymentState.DEPLOYING);
        return;
    }
    const domainArgs = domains.map((d) => `-d ${d}`).join(' ');
    const certbotCommand = `certbot certonly --nginx ${domainArgs} --agree-tos --non-interactive`;
    try {
        const { out: certbotOut, code: certbotCode } = await execOnHost(certbotCommand, 1000 * 60 * 2, async (data: string) => {
            await sendLogToControlPlane(logId, data, DeploymentState.DEPLOYING);
        });
    } catch (e: any) {
        throw new Error(`Error running certbot command: ${e.message}`);
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
        const { out: execOut, code: execCode } = await execOnHost(deploymentCommand, timeoutms, async (data: string) => {
            await sendLogToControlPlane(logId, data, DeploymentState.DEPLOYING);
        });
        if (execCode !== 0) {
            throw new Error(`Deployment command exited with code ${execCode}: ${execOut}`);
        }
        await sendLogToControlPlane(logId, 'Deployment command completed successfully.\n', DeploymentState.DEPLOYING);
    } catch (e: any) {
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
