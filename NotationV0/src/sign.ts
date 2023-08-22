import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as taskLib from 'azure-pipelines-task-lib/task';
import * as toolLib from 'azure-pipelines-tool-lib/tool';

import { AZURE_KV_PLUGIN_VERSION_FILE, AZURE_KV_VERSION_LOCK_FILE, NOTATION, NOTATION_BINARY, PLUGINS } from './lib/constants';
import { getDownloadInfo, installFromURL } from './lib/install';

import { getArtifactReferences } from './lib/variables';
import { getConfigHome } from './lib/fs';
import { getVaultCredentials } from './lib/credentials';
import { notationRunner } from './lib/runner';

export async function sign(): Promise<void> {
    const artifactRefs = getArtifactReferences();
    const keyid = taskLib.getInput('keyid', true) || '';
    const signatureFormat = taskLib.getInput('signatureFormat', false) || 'cose';
    const allowReferrerAPI = taskLib.getBoolInput('allowReferrersAPI', false);
    const debug = taskLib.getVariable('system.debug');
    let env = { ...process.env };
    if (allowReferrerAPI) {
        env["NOTATION_EXPERIMENTAL"] = "1";
    }

    const pluginName = taskLib.getInput('plugin', true);
    switch (pluginName) {
        case 'azureKeyVault':
            // azure-kv plugin specific inputs
            const cacerts = taskLib.getInput('cacerts', false) || '';
            const selfSignedCert = taskLib.getBoolInput('selfSigned', false);
            const keyVaultPluginEnv = { ...env, ...await getVaultCredentials() }
            await installAzureKV();
            await notationRunner(artifactRefs, async (artifactRef: string) => {
                return taskLib.tool(NOTATION_BINARY)
                    .arg(['sign', artifactRef,
                        '--plugin', 'azure-kv',
                        '--id', keyid,
                        '--signature-format', signatureFormat])
                    .argIf(allowReferrerAPI, '--allow-referrers-api')
                    .argIf(cacerts, `--plugin-config=ca_certs=${cacerts}`)
                    .argIf(selfSignedCert, '--plugin-config=self_signed=true')
                    .argIf(debug && debug.toLowerCase() === 'true', '--debug')
                    .exec({ env: keyVaultPluginEnv });
            })
            break;
        default:
            throw new Error(`Unknown plugin: ${pluginName}`);
    }
}

// install azurekv plugin
async function installAzureKV(): Promise<void> {
    // check if the plugin is already installed
    let binaryName = 'notation-azure-kv';
    if (os.platform() == 'win32') {
        binaryName += '.exe';
    }
    const pluginDir = path.join(getConfigHome(), NOTATION, PLUGINS, 'azure-kv');
    if (taskLib.exist(path.join(pluginDir, binaryName))) {
        console.log('notation-azure-kv plugin is already installed');
        return;
    }

    const urlInfo = getDownloadInfo(getAzureKVPluginVersion(), AZURE_KV_PLUGIN_VERSION_FILE);
    const downloadURL = urlInfo.url;
    const checksum = urlInfo.checksum;

    await installFromURL(downloadURL, checksum, pluginDir);
}

function getAzureKVPluginVersion(): string {
    // get the Azure KV plugin version based on the version lock file.
    const notationVersion = toolLib.findLocalToolVersions(NOTATION_BINARY)[0];

    // read the version lock file
    const versionLockFile = path.join(__dirname, '..', 'data', AZURE_KV_VERSION_LOCK_FILE);
    const versionLockData = fs.readFileSync(versionLockFile, 'utf8');
    const versionMap = JSON.parse(versionLockData);
    if (!(notationVersion in versionMap)) {
        throw new Error(`Cannot find Notation version ${notationVersion} in ${AZURE_KV_VERSION_LOCK_FILE}`);
    }
    return versionMap[notationVersion];
}
