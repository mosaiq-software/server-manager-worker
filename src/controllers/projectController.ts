import { createProjectModel, getAllProjectsModel, getProjectByIdModel, ProjectModelType, updateProjectModel } from '@/persistence/projectPersistence';
import { DeploymentState, Project } from '@mosaiq/nsm-common/types';
import { getReposEnvFiles } from './deployController';
import { applyDotenv, getAllSecretEnvsForProject } from './secretController';
import { getAllDeploymentLogs } from '@/persistence/deploymentLogPersistence';

export const getProject = async (projectId: string) => {
    const projectData = await getProjectByIdModel(projectId);
    if (!projectData) return undefined;

    const allSecretEnvs = await getAllSecretEnvsForProject(projectId);
    const deployLogs = (await getAllDeploymentLogs(projectId)).map(log => ({
        ...log, log: ''
    })).sort((a, b) => (new Date(b.createdAt || '')).getTime() - (new Date(a.createdAt || '')).getTime());

    const project: Project = {
        id: projectData.id,
        repoOwner: projectData.repoOwner,
        repoName: projectData.repoName,
        runCommand: projectData.runCommand,
        deploymentKey: projectData.deploymentKey,
        state: projectData.state,
        createdAt: projectData.createdAt,
        updatedAt: projectData.updatedAt,
        envs: allSecretEnvs,
        deployLogs: deployLogs,
    };

    return project;
};

export const getAllProjects = async (): Promise<Project[]> => {
    const projectsData = await getAllProjectsModel();
    const projects = [];
    for (const projectData of projectsData) {
        projects.push(await getProject(projectData.id) as Project);
    }
    return projects;
};

export const createProject = async (project: Project) => {
    try {
        const newProject: ProjectModelType = {
            id: project.id,
            repoOwner: project.repoOwner,
            repoName: project.repoName,
            runCommand: project.runCommand,
            deploymentKey: generateDeploymentKey(),
            state: DeploymentState.READY,
            allowCICD: !!project.allowCICD,
        };
        await createProjectModel(project.id, newProject);

        const envFiles = await getReposEnvFiles(project.id);
        for (const envFile of envFiles) {
            applyDotenv(envFile.contents, project.id, envFile.env);
        }
    } catch (error) {
        console.error('Error creating project:', error);
        return null;
    }
};

export const updateProject = async (id: string, updates: Partial<Project>) => {
    try {
        await updateProjectModel(id, updates);
    } catch (error) {
        console.error('Error updating project:', error);
        return null;
    }
};

export const verifyDeploymentKey = async (projectId: string, key: string, fromWeb: boolean): Promise<boolean> => {
    const project = await getProjectByIdModel(projectId);
    if (!project) return false;
    if(!fromWeb && !project.allowCICD) return false;
    return project.deploymentKey === key;
};

export const resetDeploymentKey = async (projectId: string): Promise<string | null> => {
    const project = await getProjectByIdModel(projectId);
    if (!project) return null;

    const newKey = generateDeploymentKey();
    await updateProjectModel(projectId, { deploymentKey: newKey });
    return newKey;
};

const generateDeploymentKey = (): string => {
    return crypto.randomUUID().replace(/-/g, '');
};
