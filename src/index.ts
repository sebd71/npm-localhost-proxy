/**
 * npm_install_proxy -- localhost NPM registry to `npm install` without network
 *
 * Copyright (C) 2020  SUSE LLC
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { argv } from 'process'
import { spawn } from 'child_process'
import { URL } from 'url';

import { Registry } from './registry';
import { Service } from './service';
import { TarballRegistryBackend } from './fs_registry';
import { DirRegistryBackend } from './dir_registry'

const concurrent_processes = 100;
const install_options: string[] = [];

function registerTarballsFromCommandline(registry: Registry): Promise<number> {
    const processes: Promise<number>[] = [];
    for (let i = 0; i < concurrent_processes; i++)
        processes.push(Promise.resolve(0));
    for (let i = 2; i < argv.length; ++i) {
        processes[i % concurrent_processes] = processes[i % concurrent_processes].then((processed) => registry.register(argv[i]).then(n => {
            if (n == 0)
                install_options.push(argv[i]);

            return processed + n;
        }));
    }

    return Promise.all(processes).then((vals) => {
        let total = 0;
        for (let i = 0; i < vals.length; ++i)
            total += vals[i];

        console.log(`Serving ${total} packages`);
        return total;
    });
}

function setupServerAndGetPort(service: Service, registry: Registry): Promise<number> {
    return new Promise(accepted => {
        const server = service.run(registry).on("listening", () => {
            const addr = server.address();
            console.log(addr);
            if (typeof addr === 'object')
                accepted(addr.port);
        });
    });
}

function configureNpmToSpecificLocalhostPort(service: Service, port: number | Promise<number>): Promise<void> {
    return new Promise((accept, reject) => {
        spawn("/usr/bin/npm", ['config', 'set', 'registry', service.url.toString()], { stdio: 'inherit' })
            .on("exit", (code) => {
                code === 0 ? accept() : reject();
            });
    });
}

function runNpmInstall(): Promise<void> {
    if (install_options.length === 0) {
        console.log("npm install skipped");
        return Promise.reject("npm install skipped");
    }

    return new Promise((accept, reject) => {
        spawn("/usr/bin/npm", install_options, { stdio: 'inherit' })
            .on("exit", (code) => {
                code === 0 ? accept() : reject("NPM returned code: " + code);
            });
    });
}

function printHelpInformation() {
    console.log("   usage: index [--help] [--serve] [ npm files | npm tarball directories ] ... [npm run options]");
    console.log("--serve   run registry as a 'daemon'");
    console.log("--help    prints this help message");
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function mainEntryFunction(): void {
    let serve = false;
    if (argv.includes("--help")) {
        printHelpInformation();
    }
    if (argv.includes("--serve")) {
        serve = true;
    }

    const registry = new Registry();
    registry.addBackend(new TarballRegistryBackend);
    registry.addBackend(new DirRegistryBackend);
    const service = new Service({ url: new URL("http://localhost") });
    registry.serviceProvider = service;

    console.log("Initializing registry...");
    registerTarballsFromCommandline(registry)
        .then(() => setupServerAndGetPort(service, registry))
        .then(port => configureNpmToSpecificLocalhostPort(service, port))
        .then(() => {
            if (serve) {
                console.log("Npm local server running...");
                return sleep(24 * 60 * 60 * 100);
            } else {
                console.log("Install packaging: npm ", install_options);
                return runNpmInstall();
            }
        })
        .then(() => {
            console.log("npm done. Shutting down proxy");
            return service.stop()
        })
        .catch(msg => {
            console.log("An error occurred: " + msg);
            process.exit(1);
        });
}

if (require.main === module)
    mainEntryFunction();

export { mainEntryFunction }

