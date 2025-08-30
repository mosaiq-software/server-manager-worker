import { createDeploymentLogModel, updateDeploymentLogModel } from '@/persistence/deploymentLogPersistence';
import { getProjectByIdModel, updateProjectModel } from '@/persistence/projectPersistence';
import { execSafe, HostExecMessage, sendMessageToNsmExecutor } from '@/utils/execUtils';
import { DeploymentState } from '@mosaiq/nsm-common/types';
import {existsSync, readFileSync, truncateSync} from "fs";

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export const deployProject = async (projectId: string): Promise<string | undefined> => {
    let logId: string | undefined;
    try {
        const project = await getProjectByIdModel(projectId);
        if (!project) throw new Error('Project not found');

        if (process.env.PRODUCTION !== 'true') {
            console.log('Not in production mode, skipping deployment');
            return undefined;
        }

        await updateProjectModel(projectId, {state: DeploymentState.DEPLOYING});
        logId = await createDeploymentLogModel(projectId, 'Starting deployment...', DeploymentState.DEPLOYING);
        
        await cloneRepository(projectId, project.repoOwner, project.repoName, logId);
        const timeoutms = project.timeout || DEFAULT_TIMEOUT;
        await runDeploymentCommand(projectId, project.runCommand, timeoutms, logId);
        await updateProjectModel(projectId, {state: DeploymentState.ACTIVE});
        await updateDeploymentLogModel(logId, {log: "Deployment complete!", status: DeploymentState.ACTIVE});
    } catch (error:any) {
        console.error('Error deploying project:', error);
        await updateProjectModel(projectId, {state: DeploymentState.FAILED});
        if (logId) {
            await updateDeploymentLogModel(logId, {log: "Error deploying project:\n"+error.message, status: DeploymentState.FAILED});
        }
    }
    return logId;
};

export interface EnvFile {
    path: string;
    env: string;
    contents: string;
}

export const getReposEnvFiles = async (projectId: string): Promise<EnvFile[]> => {
    try {
        const project = await getProjectByIdModel(projectId);
        if (!project) throw new Error('Project not found');

        if (process.env.PRODUCTION !== 'true') {
            console.log('Not in production mode, skipping repository data retrieval');
            return [];
        }

        await cloneRepository(projectId, project.repoOwner, project.repoName);
        const envPaths = await getEnvFilesFromDir(`${process.env.WEBAPPS_PATH}/${projectId}`);
        const envFiles: EnvFile[] = await Promise.all(envPaths.map(async (path) => ({
            path,
            env: path.split(`${process.env.WEBAPPS_PATH}/${projectId}`)[1].split('.env')[0],
            contents: await getFileContents(path),
        })));

        return envFiles;
    } catch (error) {
        console.error('Error retrieving project:', error);
        return [];
    }
};

const getFileContents = async (filePath: string): Promise   <string> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping file retrieval');
        return '';
    }
    try {
        const { out:catOut, code:catCode } = await execSafe(`cat ${filePath}`);
        if (catCode !== 0) {
            console.error('Error retrieving file contents:', catOut);
            return '';
        }
        return catOut;
    } catch (error) {
        console.error('Error retrieving file contents:', error);
        return '';
    }
};

const getEnvFilesFromDir = async (dir: string): Promise<string[]> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping .env file retrieval');
        return [];
    }
    const {out:findOut, code:findCode} = await execSafe(`find ${dir} -name ".env*"`);
    if (findCode !== 0) {
        console.error('Error finding .env files:', findOut);
        return [];
    }
    return findOut.trim().split('\n');
};

const cloneRepository = async (projectId: string, repoOwner: string, repoName: string, logId?: string): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping repository clone');
        return;
    }
    if(logId){
        await updateDeploymentLogModel(logId, {log: "Cloning repository..."});
    }
    try {
        const {out:rmOut, code:rmCode} = await execSafe(`rm -rf ${process.env.WEBAPPS_PATH}/${projectId}`);
        if(logId){
            await updateDeploymentLogModel(logId, {log: rmOut});
        }
        if (rmCode !== 0) {
            throw new Error(`Remove directory exited with code ${rmCode}`);
        }
    } catch (e:any) {
        console.error('Error removing directory:', e);
        if(logId){
            await updateDeploymentLogModel(logId, {log: `Error removing directory: ${e.message}`});
        }
        return;
    }

    try {
        const gitSshUri = `git@github.com:${repoOwner}/${repoName}.git`;
        const cmd = `git clone --progress -c core.sshCommand="/usr/bin/ssh -i ${process.env.GIT_SSH_KEY_PATH}" ${gitSshUri} ${process.env.WEBAPPS_PATH}/${projectId}`;
        const {out:gitOut, code:gitCode} = await execSafe(cmd, 1000 * 60 * 5);
        if(logId){
            await updateDeploymentLogModel(logId, {log: gitOut});
        }
        if (gitCode !== 0) {
            throw new Error(`Git clone exited with code ${gitCode}`);
        }
        return;
    } catch (e:any) {
        console.error('Error cloning repository:', e);
        if(logId){
            await updateDeploymentLogModel(logId, {log: `Error cloning repository: ${e.message}`});
        }
        throw e;
    }
};

const runDeploymentCommand = async (projectId: string, runCommand: string, timeoutms:number, logId: string): Promise<void> => {
    if (process.env.PRODUCTION !== 'true') {
        console.log('Not in production mode, skipping deployment execution');
        return;
    }
    await updateDeploymentLogModel(logId, {log: "Running deployment command..."});
    const deploymentCommand = `(cd ${process.env.WEBAPPS_PATH}/${projectId} && ${runCommand})`;
    try {

        // Send the command
        const messageInstanceId = crypto.randomUUID();
        const message: HostExecMessage = {
            projectId,
            instanceId: messageInstanceId,
            command: deploymentCommand,
            cleanup: false,
            timeout: timeoutms || undefined
        };
        console.log('Sending command to executor:', message);
        const {out:execOut, code:execCode} = await sendMessageToNsmExecutor(message);
        await updateDeploymentLogModel(logId, {log: execOut});
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
            const workingContents = readFileSync(outWorkingFilePath, 'utf-8');
            if(workingContents.length > 0){
                console.log('Streaming output from executor...');
                truncateSync(outWorkingFilePath, 0);
                await updateDeploymentLogModel(logId, {log: workingContents});
            }
            await new Promise(r=>setTimeout(r,1000));
            if(Date.now() > maxEndTime){
                console.warn('Timed out waiting for output file from executor');
                break;
            }
            if(!existsSync(outWorkingFilePath)){
                console.log('Output file from executor no longer exists');
                break;
            }
        }
        console.log('Finalizing output file from executor...');
        const outFileContents = readFileSync(outFilePath, 'utf-8');
        await updateDeploymentLogModel(logId, {log: outFileContents});
        console.log('Deployment command output complete.');
        // Clean up the output
        const cleanupMessage: HostExecMessage = {
            projectId,
            instanceId: messageInstanceId,
            command: '',
            cleanup: true,
            timeout: undefined
        };
        console.log('Sending cleanup command to executor:', cleanupMessage);
        const {out:cleanOut, code:cleanCode} = await sendMessageToNsmExecutor(cleanupMessage);
        await updateDeploymentLogModel(logId, {log: cleanOut});
        if (cleanCode !== 0) {
            throw new Error(`Error cleaning up, code ${cleanCode}: ${cleanOut}`);
        }
    } catch (e:any) {
        console.error('Error running deployment command:', deploymentCommand, e);
        await updateDeploymentLogModel(logId, {log: `Error running deployment command: ${e.message}`});
        throw e;
    }
};
