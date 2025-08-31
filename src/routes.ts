import { WORKER_BODY, WORKER_PARAMS, WORKER_RETURN, WORKER_ROUTES } from '@mosaiq/nsm-common/workerRoutes';
import express from 'express';
import { deployProject } from './deploy';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        res.status(200).send('NSM Worker Node');
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal server error');
    }
});

router.post(WORKER_ROUTES.POST_DEPLOY_PROJECT, async (req, res) => {
    const body = req.body as WORKER_BODY[WORKER_ROUTES.POST_DEPLOY_PROJECT];
    const params = req.params as WORKER_PARAMS[WORKER_ROUTES.POST_DEPLOY_PROJECT];
    try {
        await deployProject(body);
        const reply: WORKER_RETURN[WORKER_ROUTES.POST_DEPLOY_PROJECT] = undefined;
        res.status(200).send(reply);
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal server error');
    }
});

export default router;
