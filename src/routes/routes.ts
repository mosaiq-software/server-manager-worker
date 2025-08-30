import { createProject, getAllProjects, getProject, resetDeploymentKey, updateProject, verifyDeploymentKey } from '@/controllers/projectController';
import { deployProject } from '@/controllers/deployController';
import { API_BODY, API_PARAMS, API_RETURN, API_ROUTES } from '@mosaiq/nsm-common/routes';
import { verify } from 'crypto';
import express from 'express';
import { DeploymentState } from '@mosaiq/nsm-common/types';
import { getDeploymentLogByIdModel } from '@/persistence/deploymentLogPersistence';
import { updateEnvironmentVariable } from '@/controllers/secretController';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        res.status(200).send('Hello from the API');
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal server error');
    }
});

router.get(API_ROUTES.GET_DEPLOY, async (req, res) => {
    const params = req.params as API_PARAMS[API_ROUTES.GET_DEPLOY];
    try {
        if (!params.projectId) {
            res.status(400).send('No projectId');
            return;
        }
        if (!params.key) {
            res.status(401).send('Unauthorized');
            return;
        }
        if (!(await verifyDeploymentKey(params.projectId, params.key, false))) {
            res.status(403).send('Forbidden');
            return;
        }
        await deployProject(params.projectId);
        const response: API_RETURN[API_ROUTES.GET_DEPLOY] = undefined;
        res.status(200).json(response);
    } catch (e: any) {
        console.error('Error getting user', e);
        res.status(500).send('Internal server error');
    }
});

router.get(API_ROUTES.GET_DEPLOY_WEB, async (req, res) => {
    const params = req.params as API_PARAMS[API_ROUTES.GET_DEPLOY_WEB];
    try {
        if (!params.projectId) {
            res.status(400).send('No projectId');
            return;
        }
        if (!params.key) {
            res.status(401).send('Unauthorized');
            return;
        }
        if (!(await verifyDeploymentKey(params.projectId, params.key, true))) {
            res.status(403).send('Forbidden');
            return;
        }
        const logId = await deployProject(params.projectId);
        const response: API_RETURN[API_ROUTES.GET_DEPLOY_WEB] = logId;
        res.status(200).json(response);
    } catch (e: any) {
        console.error('Error getting user', e);
        res.status(500).send('Internal server error');
    }
});

router.get(API_ROUTES.GET_PROJECT, async (req, res) => {
    const params = req.params as API_PARAMS[API_ROUTES.GET_PROJECT];
    try {
        if (!params.projectId) {
            res.status(400).send('No projectId');
            return;
        }
        const project = await getProject(params.projectId);
        if (!project) {
            res.status(404).send('Project not found');
            return;
        }
        const response: API_RETURN[API_ROUTES.GET_PROJECT] = project;
        res.status(200).json(response);
    } catch (e: any) {
        console.error('Error getting project', e);
        res.status(500).send('Internal server error');
    }
});

router.get(API_ROUTES.GET_PROJECTS, async (req, res) => {
    try {
        const projects = await getAllProjects();
        const response: API_RETURN[API_ROUTES.GET_PROJECTS] = projects;
        res.status(200).json(response);
    } catch (e: any) {
        console.error('Error getting projects', e);
        res.status(500).send('Internal server error');
    }
});

router.get(API_ROUTES.GET_DEPLOY_LOG, async (req, res) => {
    const params = req.params as API_PARAMS[API_ROUTES.GET_DEPLOY_LOG];
    try {
        if (!params.deployLogId) {
            res.status(400).send('No deployLogId');
            return;
        }
        const deployLog = await getDeploymentLogByIdModel(params.deployLogId);
        if (!deployLog) {
            res.status(404).send('Deploy log not found');
            return;
        }
        const response: API_RETURN[API_ROUTES.GET_DEPLOY_LOG] = deployLog;
        res.status(200).json(response);
    } catch (e: any) {
        console.error('Error getting deploy log', e);
        res.status(500).send('Internal server error');
    }
});

router.post(API_ROUTES.POST_CREATE_PROJECT, async (req, res) => {
    const body = req.body as API_BODY[API_ROUTES.POST_CREATE_PROJECT];
    try {
        if (!body || !body.id || !body.repoOwner || !body.repoName || !body.runCommand) {
            res.status(400).send('Invalid request body');
            return;
        }
        await createProject(body);
        const response: API_RETURN[API_ROUTES.POST_CREATE_PROJECT] = undefined;
        res.status(200).json(response);
    } catch (e: any) {
        console.error('Error resetting deployment key', e);
        res.status(500).send('Internal server error');
    }
});

router.post(API_ROUTES.POST_UPDATE_PROJECT, async (req, res) => {
    const body = req.body as API_BODY[API_ROUTES.POST_UPDATE_PROJECT];
    const params = req.params as API_PARAMS[API_ROUTES.POST_UPDATE_PROJECT];
    try {
        if (!params.projectId) {
            res.status(400).send('No projectId');
            return;
        }
        await updateProject(params.projectId, body);
        const response: API_RETURN[API_ROUTES.POST_UPDATE_PROJECT] = undefined;
        res.status(200).json(response);
    } catch (e: any) {
        console.error('Error updating project', e);
        res.status(500).send('Internal server error');
    }
});

router.post(API_ROUTES.POST_RESET_DEPLOYMENT_KEY, async (req, res) => {
    const params = req.params as API_PARAMS[API_ROUTES.POST_RESET_DEPLOYMENT_KEY];
    try {
        const newKey = await resetDeploymentKey(params.projectId);
        if (!newKey) {
            res.status(404).send('Project not found');
            return;
        }
        const response: API_RETURN[API_ROUTES.POST_RESET_DEPLOYMENT_KEY] = newKey;
        res.status(200).json(response);
    } catch (e: any) {
        console.error('Error resetting deployment key', e);
        res.status(500).send('Internal server error');
    }
});

router.post(API_ROUTES.POST_UPDATE_ENV_VAR, async (req, res) => {
    const params = req.params as API_PARAMS[API_ROUTES.POST_UPDATE_ENV_VAR];
    const body = req.body as API_BODY[API_ROUTES.POST_UPDATE_ENV_VAR];
    try {
        if (!params.projectId || !body.envName || !body.varName) {
            res.status(400).send('Invalid request');
            return;
        }
        await updateEnvironmentVariable(params.projectId, body.envName, body.varName, body.value);
        res.status(200).send('Environment variable updated');
    } catch (e: any) {
        console.error('Error updating environment variable', e);
        res.status(500).send('Internal server error');
    }
});

export default router;
