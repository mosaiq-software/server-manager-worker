import { API_ROUTES } from '@mosaiq/nsm-common/routes';
import { DeployableControlPlaneConfig, DeploymentLogUpdate, DeploymentState } from '@mosaiq/nsm-common/types';
import { execOnHost } from './execUtils';
import * as fs from 'fs/promises';

export const controlPlaneWorkerHandleConfigs = async (config: DeployableControlPlaneConfig) => {
    await handleCertbot(config.domainsToCertify, config.logId);
    await handleNginx(config.projectId, config.nginxConf, config.logId);
};

const handleNginx = async (projectId: string, nginxConf: string, logId: string): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping nginx configuration');
        await sendLogToControlPlane(logId, 'Not in production mode, skipping nginx configuration\n', DeploymentState.DEPLOYING);
        return;
    }
    const nginxReloadCommand = 'nginx -s reload';
    const nginxConfDir = process.env.CONTROL_PLANE_WORKER_NGINX_DIR;
    if (!nginxConfDir) {
        throw new Error('Nginx configuration directory not set in environment variables');
    }
    const nginxConfFile = `${projectId}.conf`;
    const nginxConfPath = `${nginxConfDir}/${nginxConfFile}`;
    try {
        await fs.mkdir(nginxConfDir, { recursive: true });
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
    const errors: Error[] = [];
    for (const domain of domains) {
        const certbotDelete = `certbot delete --cert-name ${domain} --non-interactive`;
        const certbotCreate = `certbot certonly --nginx -d ${domain} --agree-tos --non-interactive`;
        const certbotCommands = `(${certbotDelete}; ${certbotCreate})`;
        try {
            const { out: certbotOut, code: certbotCode } = await execOnHost(certbotCommands, 1000 * 60 * 2, async (data: string) => {
                await sendLogToControlPlane(logId, data, DeploymentState.DEPLOYING);
            });
            if (certbotCode !== 0) {
                errors.push(new Error(`Certbot command failed for domain ${domain} with exit code ${certbotCode}`));
            }
        } catch (e: any) {
            errors.push(new Error(`Error running certbot for domain ${domain}: ${e.message}`));
        }
    }
    if (errors.length > 0) {
        throw new Error(`Certbot encountered errors: ${errors.map((e) => e.message).join('; ')}`);
    }
};

export const sendLogToControlPlane = async (logId: string, logContents: string, status: DeploymentState): Promise<void> => {
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
