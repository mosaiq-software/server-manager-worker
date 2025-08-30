import { createSecretModel, deleteAllSecretsForProjectEnvModel, getAllSecretsForProjectModel, updateSecretModel } from '@/persistence/secretPersistence';
import { DotenvData, Secret } from '@mosaiq/nsm-common/types';
import { parseSampleDotenv } from '@mosaiq/nsm-common/secretUtil';

export const getAllSecretEnvsForProject = async (projectId: string): Promise<DotenvData[]> => {
    const secrets = await getAllSecretsForProjectModel(projectId);
    const envs: DotenvData[] = [];

    for (const sec of secrets) {
        let env = envs.find((e) => e.env === sec.env);
        if (!env) {
            env = {
                env: sec.env,
                secrets: [],
            };
            envs.push(env);
        }
        env.secrets.push(sec);
    }

    return envs;
};

// export const getDotenvsForProject = async (projectId: string): Promise<{ [env: string]: string }> => {
//     const envs = await getAllSecretEnvsForProject(projectId);
//     const dotenvs: { [env: string]: string } = {};

//     for (const [env, secrets] of Object.entries(envs)) {
//         dotenvs[env] = assembleDotenv(secrets);
//     }

//     return dotenvs;
// };

export const applyDotenv = async (dotenv: string, projectId: string, env: string) => {
    const updatedSecrets = parseSampleDotenv(dotenv, projectId, env);

    const projectSecrets = await getAllSecretsForProjectModel(projectId);
    const currentSecrets = projectSecrets.filter((sec) => sec.env === env);

    for (const uSec of updatedSecrets) {
        const currentSecret = currentSecrets.find((sec) => sec.secretName === uSec.secretName);
        if (currentSecret) {
            uSec.secretValue = currentSecret.secretValue;
        }
    }

    await deleteAllSecretsForProjectEnvModel(projectId, env);
    for (const sec of updatedSecrets) {
        createSecretModel(sec);
    }
};

export const updateEnvironmentVariable = async (projectId: string, envName: string, varName: string, newValue: string) => {
    await updateSecretModel(projectId, envName, varName, newValue);
};
