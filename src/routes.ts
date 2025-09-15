import { WORKER_BODY, WORKER_RESPONSE, WORKER_ROUTES } from '@mosaiq/nsm-common/workerRoutes';
import express from 'express';
import { deployProject } from './deploy';
import { verifyAuthToken } from './auth';
import { getNextFreePorts, getOccupiedPorts } from './networkUtils';
import { getPersistentDirectories } from './persistenceUtils';
import { controlPlaneWorkerHandleConfigs } from './controlPlane';
import { listContainerData } from './dockerUtils';
import { teardownProject } from './teardown';

const publicRouter = express.Router();
const privateRouter = express.Router();

// auth for every route
privateRouter.use(async (req, res, next) => {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    if (!authHeader?.length || typeof authHeader !== 'string') {
        res.status(401).send('Unauthorized');
        return;
    }
    if (!verifyAuthToken(authHeader)) {
        res.status(403).send('Forbidden');
        return;
    }
    next();
});

publicRouter.get('/', async (req, res) => {
    try {
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
});

privateRouter.post(WORKER_ROUTES.POST_DEPLOY_PROJECT, async (req, res) => {
    const body = req.body as WORKER_BODY[WORKER_ROUTES.POST_DEPLOY_PROJECT];
    try {
        await deployProject(body);
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
});

privateRouter.post(WORKER_ROUTES.POST_FIND_NEXT_FREE_PORTS, async (req, res) => {
    const body = req.body as WORKER_BODY[WORKER_ROUTES.POST_FIND_NEXT_FREE_PORTS];
    try {
        const ports = await getNextFreePorts(body.count);
        const reply: WORKER_RESPONSE[WORKER_ROUTES.POST_FIND_NEXT_FREE_PORTS] = { ports };
        res.status(200).send(reply);
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
});

privateRouter.post(WORKER_ROUTES.POST_REQUEST_DIRECTORIES, async (req, res) => {
    const body = req.body as WORKER_BODY[WORKER_ROUTES.POST_REQUEST_DIRECTORIES];
    try {
        const pathMap = await getPersistentDirectories(body);
        const reply: WORKER_RESPONSE[WORKER_ROUTES.POST_REQUEST_DIRECTORIES] = pathMap;
        res.status(200).send(reply);
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
});

privateRouter.post(WORKER_ROUTES.POST_HANDLE_CONFIGS, async (req, res) => {
    const body = req.body as WORKER_BODY[WORKER_ROUTES.POST_HANDLE_CONFIGS];
    try {
        await controlPlaneWorkerHandleConfigs(body);
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
});

privateRouter.post(WORKER_ROUTES.POST_LIST_CONTAINERS, async (req, res) => {
    try {
        const containers = await listContainerData();
        const reply: WORKER_RESPONSE[WORKER_ROUTES.POST_LIST_CONTAINERS] = { containers };
        res.status(200).send(reply);
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
});

privateRouter.post(WORKER_ROUTES.POST_TEARDOWN_PROJECT, async (req, res) => {
    const body = req.body as WORKER_BODY[WORKER_ROUTES.POST_TEARDOWN_PROJECT];
    try {
        await teardownProject(body);
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
});

export { publicRouter, privateRouter };
