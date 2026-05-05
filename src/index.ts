/*
 * Copyright 2021 SpinalCom - www.spinalcom.com
 *
 * This file is part of SpinalCore.
 *
 * Please read all of the following terms and conditions
 * of the Free Software license Agreement ("Agreement")
 * carefully.
 *
 * This Agreement is a legally binding contract between
 * the Licensee (as defined below) and SpinalCom that
 * sets forth the terms and conditions that govern your
 * use of the Program. By installing and/or using the
 * Program, you agree to abide by all the terms and
 * conditions stated or referenced herein.
 *
 * If you do not agree to abide by these terms and
 * conditions, do not demonstrate your acceptance and do
 * not install or use the Program.
 * You should have received a copy of the license along
 * with this file. If not, see
 * <http://resources.spinalcom.com/licenses.pdf>.
 */

import ConfigFile from 'spinal-lib-organ-monitoring';
import {
  Process,
  spinalCore,
  FileSystem,
  Model,
  BindProcess,
} from 'spinal-core-connectorjs';
import {
  SpinalGraphService,
  SpinalContext,
  SpinalNodeRef,
  SpinalNode as SpNode
} from 'spinal-env-viewer-graph-service';

import type { SpinalNode } from 'spinal-model-graph';

import { SpinalAttribute } from 'spinal-models-documentation';

import { CronJob } from 'cron';
import { performance } from 'perf_hooks';
import moment from 'moment';
import { setInterval } from 'timers';

import {
  spinalAnalysisFactoryService,
  spinalAnalysisExecutionService,
  spinalAnalyticNodeManagerService,
  IAnalysisConfigJSON,
} from 'spinal-model-analysis';

import { logExecutionResult } from './utils';


require('dotenv').config();

type ModelBinding = {
  entity: SpinalNodeRef;
  model: Model;
  bindProcess: Process;
};

type TriggerProcesses = {
  Intervals: NodeJS.Timeout[];
  Bindings: ModelBinding[];
  CronJobs: CronJob[];
};
type AnalyticProcesses = {
  [analyticId: string]: TriggerProcesses;
};

//@ts-ignore
FileSystem.onConnectionError = async (error_code: number) => {
  process.exit(error_code);
};

const config1: IAnalysisConfigJSON = {
  contextName: 'MyAnalysisContext',
  analysisName: 'Temperature Sum',
  description: 'Sums temperatures from child sensors',
  anchorNodeId: "SpinalNode-91105bdb-c183-9010-ee00-78fac4a8d2b2-1879f44b78f",  // must be loaded in graph

  // Step 2: Get children of anchor target as work nodes
  worknodeResolver: {
    blocks: [
      { ref: 'node', algorithmName: 'CURRENT_NODE' },
      { ref: 'kids', algorithmName: 'GET_NODE_CHILDREN', inputs: ['node'], parameters: { regex: 'groupHasgeographicRoom' } },
    ],
  },

  // Step 3a: For each work node, gather data into registers
  inputWorkflow: {
    blocks: [
      { ref: 'node', algorithmName: 'CURRENT_NODE' },
      { ref: 'sid', algorithmName: 'GET_NODE_SERVER_ID', inputs: ['node'] },
      { ref: 'setI0', algorithmName: 'SET_INPUT_REGISTER', inputs: ['sid'], registerAs: 'I0' },
    ],
  },

  // Step 3b: Use registers to do work
  executionWorkflow: {
    blocks: [
      { ref: 'i0', algorithmName: 'FETCH_INPUT_REGISTER', parameters: { registerName: 'I0' } },
      { ref: 'sum', algorithmName: 'COPY_FIRST_NUMBER', inputs: ['i0'] },
    ],
  },
};


const config2: IAnalysisConfigJSON = {
  contextName: 'MyAnalysisContext',
  analysisName: 'MyAnalysisTest',
  description: 'Test',
  anchorNodeId: "SpinalNode-91105bdb-c183-9010-ee00-78fac4a8d2b2-1879f44b78f",  // must be loaded in graph

  // Step 2: Get children of anchor target as work nodes
  worknodeResolver: {
    blocks: [
      { ref: 'kids', algorithmName: 'GET_NODE_CHILDREN', parameters: { regex: 'groupHasgeographicRoom' } },
    ],
  },

  // Step 3a: For each work node, gather data into registers
  inputWorkflow: {
    blocks: [
      { ref: 'sid', algorithmName: 'GET_NODE_SERVER_ID' },
      { ref: 'setI0', algorithmName: 'SET_INPUT_REGISTER', inputs: ['sid'], registerAs: 'I0' },
    ],
  },

  // Step 3b: Use registers to do work
  executionWorkflow: {
    blocks: [
      { ref: 'i0', algorithmName: 'FETCH_INPUT_REGISTER', parameters: { registerName: 'I0' } },
      { ref: 'sum', algorithmName: 'COPY_FIRST_NUMBER', inputs: ['i0'] },
    ],
  },
};


const config3: IAnalysisConfigJSON = {
  contextName: "MyAnalysisContext",
  analysisName: "MyAnalysisTest",
  anchorNodeId: "SpinalNode-91105bdb-c183-9010-ee00-78fac4a8d2b2-1879f44b78f",
  worknodeResolver: {
    blocks: [
      { ref: "kids", algorithmName: "GET_NODE_CHILDREN", inputs: ["$node"], parameters: { "regex": "groupHasgeographicRoom" } }
    ]
  },
  inputWorkflow: {
    blocks: [
      { ref: "Liste des Profiles ControlPoint", algorithmName: "GET_NODE_CHILDREN", inputs: ["$node"], parameters: { "regex": "hasControlPoint" } },
      { ref: "Filtre profils de command", algorithmName: "FILTER_NODE", inputs: ["Liste des Profiles ControlPoint"], parameters: { "filterProperty": "name", "regexFilter": "Command" } },
      { ref: "Profil de command", algorithmName: "FIRST_NODE", inputs: ["Filtre profils de command"] },

      { ref: "Liste des ControlPoints", algorithmName: "GET_NODE_CHILDREN", inputs: ["Profil de command"], parameters: { "regex": "hasBmsEndpoint" } },
      { ref: "Filtre ControlPoints", algorithmName: "FILTER_NODE", inputs: ["Liste des ControlPoints"], parameters: { "filterProperty": "name", "regexFilter": "COMMAND_TEMPERATURE" } },
      { ref: "ControlPoint", algorithmName: "FIRST_NODE", inputs: ["Filtre ControlPoints"] },
      { ref: "setI0", algorithmName: "SET_INPUT_REGISTER", inputs: ["ControlPoint"], registerAs: "I0" }
    ]
  },
  executionWorkflow: {
    blocks: [
      { ref: "Control Point COMMAND_TEMPERATURE", algorithmName: "FETCH_INPUT_REGISTER", parameters: { "registerName": "I0" } },
      { ref: "Valeur actuelle", algorithmName: "ENDPOINT_NODE_CURRENT_VALUE", inputs: ["Control Point COMMAND_TEMPERATURE"] }
    ]
  }
}


const config4: IAnalysisConfigJSON = {
  contextName: "MyAnalysisContext",
  analysisName: "MyAnalysisTest-config4",
  anchorNodeId: "SpinalNode-91105bdb-c183-9010-ee00-78fac4a8d2b2-1879f44b78f",
  worknodeResolver: {
    blocks: [
      { ref: "kids", algorithmName: "GET_NODE_CHILDREN", inputs: ["$node"], parameters: { "regex": "groupHasgeographicRoom" } }
    ]
  },
  inputWorkflow: {
    blocks: [
      { ref: "Liste des Profiles ControlPoint", algorithmName: "GET_NODE_CHILDREN", inputs: ["$node"], parameters: { "regex": "hasControlPoint" } },
      { ref: "Filtre profils de command", algorithmName: "FILTER_NODE", inputs: ["Liste des Profiles ControlPoint"], parameters: { "filterProperty": "name", "regexFilter": "Command" } },
      { ref: "Profil de command", algorithmName: "FIRST_NODE", inputs: ["Filtre profils de command"] },
      { ref: "Liste des ControlPoints", algorithmName: "GET_NODE_CHILDREN", inputs: ["Profil de command"], parameters: { "regex": "hasBmsEndpoint" } },
      { ref: "setI0", algorithmName: "SET_INPUT_REGISTER", inputs: ["Liste des ControlPoints"], registerAs: "I0" }

    ]
  },
  executionWorkflow: {
    blocks: [
      { ref: "COMMAND CPs", algorithmName: "FETCH_INPUT_REGISTER", parameters: { "registerName": "I0" } },
      {
        ref: "allValues",
        algorithmName: "FOREACH",
        inputs: ["COMMAND CPs"],
        subWorkflow: {
          outputRef: "val",
          blocks: [
            { ref: "val", algorithmName: "ENDPOINT_NODE_CURRENT_VALUE", inputs: ["$item"] }
          ]
        }
      },
      { ref: "sum", algorithmName: "SUM_NUMBERS", inputs: ["allValues"] },

    ]
  }
}





class SpinalMain {

  hubConnection!: FileSystem;


  constructor() { }

  public init() {

    console.log('Done.');
    console.log('Init connection to HUB...');
    const host = process.env.SPINALHUB_PORT
      ? `${process.env.SPINALHUB_IP}:${process.env.SPINALHUB_PORT}`
      : process.env.SPINALHUB_IP;
    const url = `${process.env.SPINALHUB_PROTOCOL}://${process.env.USER_ID}:${process.env.USER_PASSWORD}@${host}/`;
    console.log('Connecting to', url);
    const conn = spinalCore.connect(url);
    this.hubConnection = conn;
    ConfigFile.init(
      conn,
      process.env.ORGAN_NAME!,
      process.env.ORGAN_TYPE!,
      process.env.SPINALHUB_IP!,
      parseInt(process.env.SPINALHUB_PORT!)
    );
    return new Promise((resolve, reject) => {
      spinalCore.load(
        conn,
        process.env.DIGITALTWIN_PATH!,
        async (graph: any) => {
          await SpinalGraphService.setGraph(graph);
          console.log('Done.');
          resolve(graph);
        },
        () => {
          console.log(
            'Connection failed ! Please check your config file and the state of the hub.'
          );
          reject();
        }
      );
    });



  }

  async load<T extends Model>(server_id: number): Promise<T> {
    if (!server_id) {
      return Promise.reject('Invalid serverId');
    }
    if (typeof FileSystem._objects[server_id] !== 'undefined') {
      // @ts-ignore
      return Promise.resolve(FileSystem._objects[server_id]);
    }
    try {
      return await this.hubConnection.load_ptr(server_id);
    } catch (error) {
      throw new Error(`Error loading model with server_id: ${server_id}`);
    }
  }



  private isSpinalNodeArray(nodes: any): boolean {
    return Array.isArray(nodes) && nodes.every(node => node.getName && typeof node.getName === 'function');
  }




  public async initJob() {

    const node: SpinalNode<any> = await this.load(1019638080);
    SpinalGraphService._addNode(node);

    let analysisNode;
    analysisNode = await spinalAnalyticNodeManagerService.getAnalysisNode('MyAnalysisContext', 'MyAnalysisTest-config4');
    if (!analysisNode) {
      analysisNode = await spinalAnalysisFactoryService.createFromJSON(config4);
    }

    const result = await spinalAnalysisExecutionService.executeAnalysis(analysisNode);

    logExecutionResult(result);


  }
}



async function Main() {
  const spinalMain = new SpinalMain();
  await spinalMain.init();

  await spinalAnalyticNodeManagerService.createContext('MyAnalysisContext');


  await spinalMain.initJob();


}
Main();
