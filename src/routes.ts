import { WORKER_BODY, WORKER_ROUTES } from '@mosaiq/nsm-common/workerRoutes';
import express from 'express';
import { deployProject } from './deploy';
import { verifyAuthToken } from './auth';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
});

router.post(WORKER_ROUTES.POST_DEPLOY_PROJECT, async (req, res) => {
    const body = req.body as WORKER_BODY[WORKER_ROUTES.POST_DEPLOY_PROJECT];
    const authHeader = req.headers['Authorization'];
    try {
        if (!authHeader?.length || typeof authHeader !== 'string') {
            res.status(401).send('Unauthorized');
            return;
        }
        if (!verifyAuthToken(authHeader)) {
            res.status(403).send('Forbidden');
            return;
        }
        await deployProject(body);
        res.status(204).send();
    } catch (error) {
        console.error(error);
        res.status(500).send();
    }
});

export default router;
