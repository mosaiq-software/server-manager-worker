import { ProjectInstance } from '@mosaiq/nsm-common/types';
import { execOnHost } from './execUtils';

export const teardownProject = async (instance: ProjectInstance) => {
    try {
        await runTeardownCommand(instance.projectId);
    } catch (error: any) {
        console.error('Failed to deploy project:', error);
    }
};

const runTeardownCommand = async (projectId: string): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping teardown execution');
        return;
    }
    const teardownCommand = `docker compose -p ${projectId} down`;
    const pruneCommand = `docker system prune -af`;
    const deploymentCommand = `(cd ${process.env.DEPLOYMENT_PATH}/${projectId} && ${teardownCommand} && ${pruneCommand})`;
    const timeoutms = 3 * 60 * 1000; // 3 minutes
    try {
        const { out: execOut, code: execCode } = await execOnHost(deploymentCommand, timeoutms, async (data: string) => {});
        if (execCode !== 0) {
            throw new Error(`Teardown command exited with code ${execCode}: ${execOut}`);
        }
    } catch (e: any) {
        throw new Error(`Error running teardown command: ${e.message}`);
    }
};
